// provider-payout-run
//
// Automatic settlement cycle for mobility service providers (drivers, fleet
// operators, aircraft owners, truck owners). Runs on cron and does three
// things, in order:
//
//   1. provider_earnings_sync()   — accrue the 15/85 split for delivered jobs
//                                   and make earnings PAYABLE once the
//                                   customer's invoice is actually paid.
//   2. provider_payout_prepare()  — group payable earnings per operator into a
//                                   payout request awaiting finance approval.
//   3. disburse APPROVED requests — submit each one to M-Pesa B2C so the 85%
//                                   leaves the account automatically.
//
// Nothing here marks money paid: only the Daraja result callback
// (mpesa-b2c-result) can, and Yalla Mobility's 15% commission is never
// disbursed — it remains in the collection paybill.
import { withRequest, ok } from "../_shared/framework.ts";
import { requireInternalCaller } from "../_shared/internal-auth.ts";
import { getB2CConfig, submitB2C } from "../_shared/mpesa-b2c.ts";

const MAX_BATCH = Number(Deno.env.get("PROVIDER_PAYOUT_MAX_BATCH") ?? "25");

Deno.serve(withRequest({
  name: "provider-payout-run",
  auth: false, // system-only; guarded by requireInternalCaller
  handler: async ({ req, admin, log, correlationId }) => {
    requireInternalCaller(req);

    const { data: sync, error: syncErr } = await admin.rpc("provider_earnings_sync");
    if (syncErr) log.error("earnings_sync_failed", { error: syncErr.message });

    const { data: prepared, error: prepErr } = await admin.rpc("provider_payout_prepare");
    if (prepErr) log.error("payout_prepare_failed", { error: prepErr.message });

    const cfg = getB2CConfig();
    const results: Record<string, unknown>[] = [];

    const { data: approved, error: listErr } = await admin
      .from("provider_payout_requests")
      .select("id,request_reference,amount_cents")
      .eq("state", "APPROVED")
      .order("created_at", { ascending: true })
      .limit(MAX_BATCH);
    if (listErr) log.error("approved_list_failed", { error: listErr.message });

    for (const row of approved ?? []) {
      const { data: claim, error: claimErr } = await admin.rpc("provider_payout_claim", {
        p: { request_id: row.id },
      });
      if (claimErr) {
        results.push({ request_id: row.id, state: "CLAIM_FAILED", error: claimErr.message });
        continue;
      }
      const c = claim as Record<string, unknown>;
      if (c?.error) {
        results.push({ request_id: row.id, state: "REFUSED", code: c.code });
        continue;
      }
      if (String(c.state) !== "DRAFT") {
        results.push({ request_id: row.id, state: String(c.state), replay: true });
        continue;
      }
      if (!cfg.ok) {
        results.push({
          request_id: row.id,
          state: "PROVIDER_CONFIGURATION_REQUIRED",
          missing: cfg.missing,
        });
        continue;
      }

      const disbursementId = String(c.disbursement_id);
      try {
        const submission = await submitB2C({
          amount: Number(c.amount),
          msisdn: String(c.msisdn),
          originatorConversationId: disbursementId,
          remarks: `Yalla Mobility operator payout ${c.reference}`,
          occasion: String(c.request_reference ?? ""),
        });

        if (!submission.accepted) {
          results.push({
            request_id: row.id, state: "PROVIDER_REJECTED",
            response_code: submission.responseCode,
            response_description: submission.responseDescription,
          });
          continue;
        }

        await admin.rpc("payout_disbursement_mark_submitted", {
          p: {
            disbursement_id: disbursementId,
            conversation_id: submission.conversationId,
            originator_conversation_id: submission.originatorConversationId,
            response_code: submission.responseCode,
            payload: submission.raw,
          },
        });
        results.push({
          request_id: row.id, state: "PROCESSING",
          conversation_id: submission.conversationId,
        });
      } catch (e) {
        await admin.rpc("payout_disbursement_mark_unknown", {
          p: { disbursement_id: disbursementId, reason: (e as Error).message },
        });
        results.push({ request_id: row.id, state: "UNKNOWN", error: (e as Error).message });
      }
    }

    log.info("provider_payout_cycle", {
      synced: sync,
      prepared,
      submitted: results.filter((r) => r.state === "PROCESSING").length,
      considered: (approved ?? []).length,
    });

    return ok({
      earnings: sync ?? null,
      prepared: prepared ?? null,
      disbursements: results,
      provider_configured: cfg.ok,
      correlation_id: correlationId,
    });
  },
}));
