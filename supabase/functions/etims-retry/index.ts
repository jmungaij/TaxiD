// etims-retry — pg_cron driver. Triggers etims-submit when there is work to do.
// UPGRADE (minimal, additive):
//   - Treat PENDING/RETRYING invoices as "due work" too, not only retry-queue rows.
//     Previously, a freshly inserted PENDING invoice had no path to etims-submit
//     until it appeared in etims_retry_queue — which only happens AFTER etims-submit
//     has already processed it once. That cold-start gap is why etims-submit
//     showed 0 invocations. Response shape is preserved; a `pending` field is added.
//   - Structured logs (fn, request_id, stage, duration_ms).
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

import { requireInternalOrStaff } from "../_shared/internal-auth.ts";
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Privileged worker: cron/service-role callers, or an admin "run now" button.
  try {
    await requireInternalOrStaff(req, ["admin", "super_admin"]);
  } catch (guardError) {
    const status = (guardError as { status?: number }).status ?? 401;
    return new Response(JSON.stringify({ error: (guardError as Error).message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  const log = (event: string, extra: Record<string, unknown> = {}) =>
    console.log(JSON.stringify({ level: "info", fn: "etims-retry", event, request_id: requestId, ts: new Date().toISOString(), ...extra }));

  // Fail-fast: required env. Don't invoke etims-submit if we can't even reach the DB.
  const envProblems: string[] = [];
  if (!Deno.env.get("SUPABASE_URL")) envProblems.push("SUPABASE_URL is not set");
  if (!Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) envProblems.push("SUPABASE_SERVICE_ROLE_KEY is not set");
  if (envProblems.length > 0) {
    console.error(JSON.stringify({ level: "error", fn: "etims-retry", event: "config_invalid", request_id: requestId, problems: envProblems }));
    return json({ error: "etims-retry misconfigured", problems: envProblems }, 500);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );


  try {
    log("start");

    // Due retry-queue rows (existing behaviour — unchanged contract).
    const { data: due, error: dueErr } = await supabase
      .from("etims_retry_queue")
      .select("invoice_id")
      .eq("abandoned", false)
      .lte("next_retry_at", new Date().toISOString())
      .limit(50);
    if (dueErr) throw dueErr;
    const dueCount = due?.length ?? 0;

    // NEW: also count any invoice ready for its first submit or waiting after retry.
    // etims-submit itself already selects on ["PENDING","RETRYING"] — we just make
    // sure it gets *woken up* when such rows exist.
    const { count: pendingCount, error: pendErr } = await supabase
      .from("etims_invoices")
      .select("id", { count: "exact", head: true })
      .in("status", ["PENDING", "RETRYING"]);
    if (pendErr) throw pendErr;

    const workCount = dueCount + (pendingCount ?? 0);
    if (workCount === 0) {
      log("no_work", { due: 0, pending: 0, duration_ms: Date.now() - startedAt });
      return json({ due: 0, pending: 0 });
    }

    const submitUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/etims-submit`;
    log("invoking_submit", { due: dueCount, pending: pendingCount, url_host: new URL(submitUrl).host });

    // Bounded fetch — never let a hung remote wedge the cron slot.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);
    let resp: Response;
    try {
      resp = await fetch(submitUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ trigger: "retry-cron", due: dueCount, pending: pendingCount ?? 0 }),
        signal: controller.signal,
      });
    } catch (e: any) {
      log("submit_fetch_error", { error: e?.message || String(e), duration_ms: Date.now() - startedAt });
      return json({ due: dueCount, pending: pendingCount ?? 0, submit_error: e?.message || String(e) }, 502);
    } finally {
      clearTimeout(timeout);
    }

    const body = await resp.text();
    log("complete", { status: resp.status, duration_ms: Date.now() - startedAt });
    return json({
      due: dueCount,
      pending: pendingCount ?? 0,
      submit_status: resp.status,
      submit_body: safeJson(body),
    });
  } catch (err: any) {
    console.error(JSON.stringify({ level: "error", fn: "etims-retry", event: "exception", request_id: requestId, error: err?.message || String(err), duration_ms: Date.now() - startedAt }));
    return json({ error: err?.message || String(err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function safeJson(s: string) { try { return JSON.parse(s); } catch { return s; } }
