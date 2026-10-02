// mpesa-b2c-result
//
// Safaricom Daraja B2C ResultURL / QueueTimeOutURL receiver. This is the ONLY
// path that may transition a payout to SUCCESS: it persists the raw provider
// result, normalises the evidence, and hands it to
// `payout_disbursement_apply_result`, which posts the wallet entry, records
// the settlement and reconciles the amount inside one transaction.
//
// Duplicate callbacks are harmless (append-only evidence is de-duplicated by
// payload hash and terminal payouts return a replay).
import { withRequest, ok } from "../_shared/framework.ts";
import { normaliseB2CResult, verifyB2CCallbackToken } from "../_shared/mpesa-b2c.ts";

Deno.serve(withRequest({
  name: "mpesa-b2c-result",
  auth: false, // Safaricom cannot present a JWT; matching is by ConversationID.
  handler: async ({ req, admin, log }) => {
    // Only results arriving on our tokenised ResultURL may touch payouts.
    if (!verifyB2CCallbackToken(new URL(req.url).searchParams.get("t"))) {
      log.warn("b2c_result_rejected_bad_token");
      return new Response(JSON.stringify({ ResultCode: 1, ResultDesc: "Rejected" }), {
        status: 401, headers: { "Content-Type": "application/json" },
      });
    }
    let payload: Record<string, unknown> = {};
    try {
      payload = await req.json();
    } catch {
      log.warn("unparseable_result_body");
      // Always 200 to Daraja so it does not retry-storm; nothing is applied.
      return ok({ ResultCode: 0, ResultDesc: "Accepted" });
    }

    const r = normaliseB2CResult(payload);
    log.info("b2c_result_received", {
      conversation_id: r.conversationId,
      result_code: r.resultCode,
      has_txn: Boolean(r.providerTransactionId),
    });

    const { data, error } = await admin.rpc("payout_disbursement_apply_result", {
      p: {
        conversation_id: r.conversationId,
        disbursement_id: r.originatorConversationId,
        result_code: r.resultCode,
        result_desc: r.resultDesc,
        provider_transaction_id: r.providerTransactionId,
        amount: r.amount,
        recipient: r.recipient,
        transacted_at: r.transactedAt,
        payload,
      },
    });

    if (error) {
      log.error("apply_result_failed", { error: error.message, conversation_id: r.conversationId });
    } else {
      log.info("apply_result", { outcome: data });
    }

    return ok({ ResultCode: 0, ResultDesc: "Accepted" });
  },
}));
