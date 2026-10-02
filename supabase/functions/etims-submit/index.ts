import { primeGatewaySettings } from "../_shared/gateway-settings.ts";
// etims-submit — drains PENDING / RETRYING eTIMS invoices and submits them to tax.ke.
// Service-role only. Invoked by pg_cron / admin / etims-retry.
//
// UPGRADE (minimal, additive — no contract, table, or status-machine changes):
//   - Structured logging (fn, request_id, per-invoice stage/duration).
//   - Stale-SYNCING recovery at batch start: any invoice stuck in SYNCING for
//     >10 minutes (a prior crash mid-loop) is flipped back to RETRYING so it
//     can be re-picked. Uses the existing status vocabulary.
//   - Bounded per-call fetch timeout (handled inside submitInvoice already;
//     we additionally guard the outer loop with a per-invoice try/catch that
//     already existed — kept intact).
//   - Response shape preserved: { processed, results } (adds `recovered_stale`
//     when >0 so observability sees the recovery, without breaking callers).
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { submitInvoice, nextRetryDelayMs, validateEtimsEnv } from "../_shared/etims.ts";
import { requireInternalOrStaff, requireInternalCaller } from "../_shared/internal-auth.ts";

const BATCH_LIMIT = 25;
const STALE_SYNCING_MS = 10 * 60 * 1000; // 10 minutes

Deno.serve(async (req) => {
  await primeGatewaySettings();
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try { await requireInternalOrStaff(req, ["admin", "super_admin"]); }
  catch (e) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: (e as { status?: number }).status ?? 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  const log = (event: string, extra: Record<string, unknown> = {}) =>
    console.log(JSON.stringify({ level: "info", fn: "etims-submit", event, request_id: requestId, ts: new Date().toISOString(), ...extra }));

  // Fail-fast: required env at boot. Clear 500 beats masked upstream errors.
  const envProblems: string[] = [];
  if (!Deno.env.get("SUPABASE_URL")) envProblems.push("SUPABASE_URL is not set");
  if (!Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) envProblems.push("SUPABASE_SERVICE_ROLE_KEY is not set");
  envProblems.push(...validateEtimsEnv());
  if (envProblems.length > 0) {
    console.error(JSON.stringify({ level: "error", fn: "etims-submit", event: "config_invalid", request_id: requestId, problems: envProblems }));
    return json({ error: "etims-submit misconfigured", problems: envProblems }, 500);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    log("start");


    // Stale-SYNCING recovery — no schema changes, just a targeted UPDATE.
    // Any invoice sitting in SYNCING past the threshold is flipped back to
    // RETRYING so this run (or the next) can pick it up. Existing status vocab.
    const staleCutoff = new Date(Date.now() - STALE_SYNCING_MS).toISOString();
    const { data: recovered, error: recErr } = await supabase
      .from("etims_invoices")
      .update({ status: "RETRYING", last_error: "recovered_from_stale_syncing" })
      .eq("status", "SYNCING")
      .lt("updated_at", staleCutoff)
      .select("id");
    if (recErr) log("stale_recovery_error", { error: recErr.message });
    const recoveredStale = recovered?.length ?? 0;
    if (recoveredStale > 0) log("stale_syncing_recovered", { count: recoveredStale });

    const { data: invoices, error } = await supabase
      .from("etims_invoices")
      .select("id, invoice_number, invoice_type, currency, customer_kra_pin, customer_name, subtotal_cents, tax_total_cents, total_cents, issued_at, status, retry_count")
      .in("status", ["PENDING", "RETRYING"])
      .order("issued_at", { ascending: true })
      .limit(BATCH_LIMIT);

    if (error) throw error;
    if (!invoices || invoices.length === 0) {
      log("no_pending", { duration_ms: Date.now() - startedAt, recovered_stale: recoveredStale });
      return json({ processed: 0, recovered_stale: recoveredStale, message: "no pending invoices" });
    }

    log("batch_selected", { count: invoices.length });
    const results: Array<{ id: string; status: string }> = [];

    for (const inv of invoices) {
      const invStartedAt = Date.now();
      const { error: txErr } = await supabase
        .from("etims_invoices")
        .update({ status: "SYNCING" })
        .eq("id", inv.id);
      if (txErr) {
        log("status_syncing_failed", { invoice_id: inv.id, error: txErr.message });
        continue;
      }

      const { data: items } = await supabase
        .from("etims_invoice_items")
        .select("description, quantity, unit_price_cents, taxable_cents, tax_cents, total_cents, tax_scheme_code, tax_rate_bps")
        .eq("invoice_id", inv.id);

      const payload = {
        invoice_number: inv.invoice_number,
        invoice_type: inv.invoice_type,
        currency: inv.currency,
        customer_kra_pin: inv.customer_kra_pin,
        customer_name: inv.customer_name,
        subtotal_cents: inv.subtotal_cents,
        tax_total_cents: inv.tax_total_cents,
        total_cents: inv.total_cents,
        issued_at: inv.issued_at,
        items: (items || []).map(i => ({
          description: i.description,
          quantity: Number(i.quantity),
          unit_price_cents: i.unit_price_cents,
          taxable_cents: i.taxable_cents,
          tax_cents: i.tax_cents,
          total_cents: i.total_cents,
          tax_scheme_code: i.tax_scheme_code,
          tax_rate_bps: i.tax_rate_bps,
        })),
      };

      const attemptNumber = (inv.retry_count || 0) + 1;

      // SUBMIT_ATTEMPT
      await supabase.from("etims_sync_events").insert({
        invoice_id: inv.id,
        event_type: "SUBMIT_ATTEMPT",
        attempt_number: attemptNumber,
        request_payload: payload,
      });

      const submitStartedAt = Date.now();
      let resp: Awaited<ReturnType<typeof submitInvoice>>;
      try {
        resp = await submitInvoice(payload);
      } catch (e: any) {
        resp = { ok: false, status: 0, raw: { error: e?.message || String(e) } };
        log("submit_exception", { invoice_id: inv.id, error: e?.message || String(e) });
      }
      const durationMs = Date.now() - submitStartedAt;

      // Prefer the classified error_reason from the adapter over dumping raw
      // HTML (KRA 404 pages) into the log/UI. Fall back to a truncated body.
      const classifiedReason = (resp as any).error_reason as string | undefined;
      const rawSummary = typeof resp.raw === "string"
        ? resp.raw.slice(0, 1000)
        : JSON.stringify(resp.raw).slice(0, 1000);
      const surfacedError = resp.ok ? null : (classifiedReason || rawSummary);

      await supabase.from("etims_sync_events").insert({
        invoice_id: inv.id,
        event_type: resp.ok ? "SUBMIT_SUCCESS" : "SUBMIT_FAILURE",
        attempt_number: attemptNumber,
        request_payload: payload,
        response_payload: resp.raw as any,
        response_status: resp.status,
        duration_ms: durationMs,
        error_message: surfacedError,
      });

      if (!resp.ok) {
        log("submit_failure", {
          invoice_id: inv.id,
          status: resp.status,
          endpoint: (resp as any).endpoint,
          reason: classifiedReason || rawSummary.slice(0, 200),
        });
      }

      if (resp.ok) {
        await supabase.from("etims_invoices").update({
          status: "SYNCED",
          kra_invoice_number: resp.kra_invoice_number,
          kra_control_unit_id: resp.kra_control_unit_id,
          qr_code_payload: resp.qr_code_payload,
          kra_signature: resp.signed_invoice_hash,
          synced_at: new Date().toISOString(),
          last_error: null,
        }).eq("id", inv.id);
        await supabase.from("etims_retry_queue").delete().eq("invoice_id", inv.id);
        results.push({ id: inv.id, status: "SYNCED" });
        log("invoice_synced", { invoice_id: inv.id, attempt: attemptNumber, submit_ms: durationMs, total_ms: Date.now() - invStartedAt });
        continue;
      }

      // Failure → enqueue retry (cap at max_attempts)
      const { data: queueRow } = await supabase
        .from("etims_retry_queue")
        .select("attempt, max_attempts")
        .eq("invoice_id", inv.id)
        .maybeSingle();

      const attempt = (queueRow?.attempt ?? 0) + 1;
      const maxAttempts = queueRow?.max_attempts ?? 12;
      const errMsg = surfacedError || rawSummary;

      if (attempt > maxAttempts) {
        await supabase.from("etims_invoices").update({
          status: "FAILED", last_error: errMsg, retry_count: attemptNumber,
        }).eq("id", inv.id);
        await supabase.from("etims_retry_queue").update({
          abandoned: true,
          abandoned_at: new Date().toISOString(),
          last_attempt_at: new Date().toISOString(),
          last_error: errMsg,
          attempt,
        }).eq("invoice_id", inv.id);
        results.push({ id: inv.id, status: "FAILED" });
        log("invoice_abandoned", { invoice_id: inv.id, attempt, max_attempts: maxAttempts, submit_ms: durationMs });
      } else {
        const nextAt = new Date(Date.now() + nextRetryDelayMs(attempt)).toISOString();
        await supabase.from("etims_invoices").update({
          status: "RETRYING", last_error: errMsg, retry_count: attemptNumber,
        }).eq("id", inv.id);
        await supabase.from("etims_retry_queue").upsert({
          invoice_id: inv.id,
          attempt,
          next_retry_at: nextAt,
          last_attempt_at: new Date().toISOString(),
          last_error: errMsg,
        }, { onConflict: "invoice_id" });
        results.push({ id: inv.id, status: "RETRYING" });
        log("invoice_retry_scheduled", { invoice_id: inv.id, attempt, next_retry_at: nextAt, submit_ms: durationMs });
      }
    }

    log("complete", { processed: results.length, recovered_stale: recoveredStale, duration_ms: Date.now() - startedAt });
    return json({ processed: results.length, recovered_stale: recoveredStale, results });
  } catch (err: any) {
    console.error(JSON.stringify({ level: "error", fn: "etims-submit", event: "exception", request_id: requestId, error: err?.message || String(err), duration_ms: Date.now() - startedAt }));
    console.error("etims-submit failed", err); return json({ error: "Internal error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
