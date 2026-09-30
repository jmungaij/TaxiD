// M-Pesa Scheduled Reconciliation
// -----------------------------------------------------------------------------
// Every 5 minutes we re-check STK attempts that Daraja never called back for.
// Target rows: successful HTTP outcome, has a checkout_request_id, not yet
// reconciled, at least 3 minutes old, at most `windowMinutes` old.
//
// For each attempt we call Daraja's stkpushquery endpoint, stamp the result
// onto every attempt row that shares the checkout id (idempotency correlation
// preserved), and raise a high-severity alerts_events row on any mismatch
// (amount/receipt/status divergence between the stored expectation and Daraja).
import { withRequest, ok } from "../_shared/framework.ts";
import { requireInternalCaller } from "../_shared/internal-auth.ts";
import {
  fetchAccessToken, generatePassword, getBaseUrl, getConfig, getTimestamp,
} from "../_shared/mpesa.ts";

const DEFAULT_WINDOW_MIN = 60;
const MIN_AGE_SEC = 180; // give Daraja 3 minutes before we chase it

Deno.serve(withRequest<{ window_minutes?: number }>({
  name: "mpesa-reconcile-recent",
  auth: false,
  handler: async ({ body, admin, log, req }) => {
    requireInternalCaller(req);
    const windowMinutes = Math.min(24 * 60, Math.max(5, Number(body?.window_minutes ?? DEFAULT_WINDOW_MIN)));
    const runStart = new Date();
    const { data: runRow } = await admin.from("mpesa_reconciliation_runs")
      .insert({ window_minutes: windowMinutes }).select("id").single();
    const runId = runRow?.id as string | undefined;

    const nowMs = Date.now();
    const from = new Date(nowMs - windowMinutes * 60 * 1000).toISOString();
    const until = new Date(nowMs - MIN_AGE_SEC * 1000).toISOString();

    const { data: pending, error } = await admin
      .from("mpesa_stk_attempts")
      .select("id, checkout_request_id, amount_cents, phone_masked")
      .is("reconciled_at", null)
      .not("checkout_request_id", "is", null)
      .eq("outcome", "success")
      .gte("created_at", from)
      .lte("created_at", until)
      .order("created_at", { ascending: true })
      .limit(200);
    if (error) {
      log.error("query_failed", { error: error.message });
      if (runId) await admin.from("mpesa_reconciliation_runs")
        .update({ completed_at: new Date().toISOString(), error_count: 1, notes: { error: error.message } })
        .eq("id", runId);
      return ok({ checked: 0, reconciled: 0, mismatch: 0, still_pending: 0, errors: 1 });
    }

    // Dedupe by checkout_request_id (retries share the same one).
    const uniqueCheckouts = new Map<string, { amount_cents: number | null; phone_masked: string | null }>();
    for (const p of pending ?? []) {
      const key = p.checkout_request_id as string;
      if (!uniqueCheckouts.has(key)) {
        uniqueCheckouts.set(key, { amount_cents: p.amount_cents, phone_masked: p.phone_masked });
      }
    }

    let checked = 0, reconciled = 0, mismatch = 0, stillPending = 0, errors = 0;
    let token = "";
    try { token = await fetchAccessToken(await getConfig()); }
    catch (e) {
      log.error("oauth_failed", { error: (e as Error).message });
      if (runId) await admin.from("mpesa_reconciliation_runs")
        .update({ completed_at: new Date().toISOString(), error_count: 1, notes: { oauth_error: (e as Error).message } })
        .eq("id", runId);
      return ok({ checked: 0, reconciled: 0, mismatch: 0, still_pending: uniqueCheckouts.size, errors: 1 });
    }

    const cfg = await getConfig();
    const base = getBaseUrl(cfg.env);

    for (const [checkoutId, meta] of uniqueCheckouts) {
      checked++;
      try {
        const ts = getTimestamp();
        const pwd = generatePassword(ts, cfg.shortcode, cfg.passkey);
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 15_000);
        const res = await fetch(`${base}/mpesa/stkpushquery/v1/query`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            BusinessShortCode: cfg.shortcode, Password: pwd, Timestamp: ts,
            CheckoutRequestID: checkoutId,
          }),
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        const json: any = await res.json().catch(() => ({}));
        const code = Number(json?.ResultCode ?? json?.errorCode ?? -1);
        const desc = String(json?.ResultDesc ?? json?.errorMessage ?? "unknown");

        // Daraja returns 500.001.1001 while the STK is still open — treat as pending.
        if (String(json?.errorCode ?? "").startsWith("500.001.1001") || desc.toLowerCase().includes("processed")) {
          stillPending++;
          continue;
        }

        let mismatchFlag = false;
        let notes: string | null = null;
        // ResultCode 0 == success on Daraja. Any other code = failure/cancel.
        if (code !== 0) {
          notes = `daraja_query_negative:${code}`;
        }
        // No callback received before this sweep -> that itself is a divergence
        // worth flagging so finance can confirm the customer state.
        if (code === 0) {
          notes = "late_callback_reconciled_via_query";
          mismatchFlag = true;
        }

        const { data: updRows } = await admin.from("mpesa_stk_attempts")
          .update({
            final_result_code: code,
            final_result_desc: desc,
            reconciled_at: new Date().toISOString(),
            reconciliation_mismatch: mismatchFlag,
            reconciliation_notes: notes,
          })
          .eq("checkout_request_id", checkoutId)
          .select("id");
        reconciled += updRows?.length ?? 0;

        if (mismatchFlag) {
          mismatch++;
          await admin.from("alerts_events").insert({
            rule_name: "mpesa_late_callback_detected",
            stream: "payments",
            metric_key: "mpesa.reconciliation.late_callback",
            severity: "high",
            message: `Daraja query resolved a missing callback for CheckoutRequestID ${checkoutId}. Verify wallet crediting.`,
            context: {
              checkout_request_id: checkoutId,
              amount_cents: meta.amount_cents,
              phone_masked: meta.phone_masked,
              daraja: json,
            },
          });
        }
      } catch (e) {
        errors++;
        log.warn("reconcile_item_failed", { checkout_id: checkoutId, error: (e as Error).message });
      }
    }

    if (runId) {
      await admin.from("mpesa_reconciliation_runs").update({
        completed_at: new Date().toISOString(),
        checked_count: checked,
        reconciled_count: reconciled,
        mismatch_count: mismatch,
        still_pending_count: stillPending,
        error_count: errors,
      }).eq("id", runId);
    }

    log.info("reconcile_done", { checked, reconciled, mismatch, stillPending, errors });
    return ok({ checked, reconciled, mismatch, still_pending: stillPending, errors, run_id: runId });
  },
}));
