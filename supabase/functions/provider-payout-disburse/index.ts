// provider-payout-disburse
//
// Sends a finance-APPROVED mobility service provider payout (the operator's
// 85% share) to their verified M-Pesa number over the SAME Daraja B2C rail
// used for carrier payouts. Yalla Mobility's 15% commission is never
// disbursed — it stays in the collection paybill.
//
//   APPROVED provider payout request
//     -> provider_payout_claim              (eligibility gate + idempotency)
//     -> Daraja B2C submission              (acknowledgement only)
//     -> payout_disbursement_mark_submitted (state PROCESSING)
//     -> [mpesa-b2c-result]                 (authoritative evidence -> PAID/FAILED)
//
// This function NEVER marks a payout paid. Only provider evidence can.
import { z } from "npm:zod@3";
import { withRequest, ok, fail, HttpError } from "../_shared/framework.ts";
import { requireInternalOrStaff } from "../_shared/internal-auth.ts";
import { getB2CConfig, submitB2C } from "../_shared/mpesa-b2c.ts";

const Body = z.object({
  request_id: z.string().uuid(),
  dry_run: z.boolean().optional().default(false),
});

const FINANCE_ROLES = ["admin", "super_admin", "finance_admin", "operations_admin"] as const;

Deno.serve(withRequest({
  name: "provider-payout-disburse",
  auth: false, // authorization handled by requireInternalOrStaff (staff or internal)
  schema: Body,
  handler: async ({ req, body, admin, log, correlationId }) => {
    const caller = await requireInternalOrStaff(req, FINANCE_ROLES);

    const { data: claim, error: claimErr } = await admin.rpc("provider_payout_claim", {
      p: { request_id: body.request_id },
    });
    if (claimErr) throw new HttpError(500, claimErr.message, "CLAIM_FAILED");
    const c = claim as Record<string, unknown>;
    if (c?.error) return fail(409, String(c.code), `Payout refused: ${String(c.code)}`, c);

    const disbursementId = String(c.disbursement_id);
    const state = String(c.state);
    const amount = Number(c.amount);
    const msisdn = String(c.msisdn);

    if (state !== "DRAFT") {
      return ok({
        disbursement_id: disbursementId,
        reference: c.reference,
        state,
        replay: true,
        message: state === "SUCCESS"
          ? "Payout already executed with provider evidence."
          : `Payout already has provider state ${state}; resolve it before retrying.`,
        correlation_id: correlationId,
      });
    }

    const cfg = await getB2CConfig();
    if (!cfg.ok) {
      log.error("b2c_not_configured", { missing: cfg.missing, disbursement_id: disbursementId });
      return fail(503, "PROVIDER_CONFIGURATION_REQUIRED",
        "M-Pesa payout credentials are not configured; payout remains DRAFT (no money moved).",
        { missing: cfg.missing, disbursement_id: disbursementId, state: "DRAFT" });
    }

    if (body.dry_run) {
      return ok({
        disbursement_id: disbursementId, state: "DRAFT", dry_run: true,
        amount, msisdn_suffix: msisdn.slice(-4), correlation_id: correlationId,
      });
    }

    let submission;
    try {
      submission = await submitB2C({
        amount,
        msisdn,
        originatorConversationId: disbursementId,
        remarks: `Yalla Mobility operator payout ${c.reference}`,
        occasion: String(c.request_reference ?? ""),
      });
    } catch (e) {
      await admin.rpc("payout_disbursement_mark_unknown", {
        p: { disbursement_id: disbursementId, reason: (e as Error).message },
      });
      log.error("b2c_submit_threw", { error: (e as Error).message, disbursement_id: disbursementId });
      return fail(504, "PROVIDER_STATE_UNKNOWN",
        "Provider submission did not return a definitive response; payout marked UNKNOWN pending reconciliation. Do not retry blindly.",
        { disbursement_id: disbursementId });
    }

    if (!submission.accepted) {
      log.error("b2c_rejected", {
        disbursement_id: disbursementId,
        response_code: submission.responseCode,
        http_status: submission.httpStatus,
      });
      return fail(502, "PROVIDER_REJECTED_REQUEST",
        submission.responseDescription ?? "M-Pesa rejected the disbursement request",
        { disbursement_id: disbursementId, response_code: submission.responseCode, state: "DRAFT" });
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

    log.info("b2c_submitted", {
      disbursement_id: disbursementId,
      conversation_id: submission.conversationId,
      caller: caller.kind,
    });

    return ok({
      disbursement_id: disbursementId,
      reference: c.reference,
      state: "PROCESSING",
      provider: "MPESA_B2C",
      conversation_id: submission.conversationId,
      message: "Payout submitted to M-Pesa. Awaiting authoritative result before it is marked paid.",
      correlation_id: correlationId,
    });
  },
}));
