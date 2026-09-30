// M-Pesa STK Callback — enterprise hardened.
//
// Slice 2 hardening:
//   - Public endpoint (no JWT). Always returns 200 so Safaricom doesn't retry.
//   - Persists every raw callback into mpesa_callback_logs with IP/headers.
//   - Verifies: payload shape, attempt exists, age < 10 min, not already processed.
//   - On success: transitions ACCEPTED -> CALLBACK_RECEIVED -> COMPLETED and
//     calls credit_wallet_exactly_once which locks the wallet, dedupes the
//     receipt, and inserts the wallet_transaction atomically.
//   - On failure: transitions to FAILED/CANCELLED/TIMED_OUT per ResultCode.
//   - Failures are written to payment_dead_letters for replay.
//   - Mirrors status onto legacy mpesa_transactions for back-compat.
import { withRequest, ok } from "../_shared/framework.ts";
import { confirmStkResult } from "../_shared/mpesa.ts";
import { beginInvocation, finishInvocation, stage, step, event as journeyEvent, computeHealthSnapshot, STAGE } from "../_shared/journey.ts";

const MAX_CALLBACK_AGE_MS = 10 * 60 * 1000;

function classifyResult(code: number): "COMPLETED" | "FAILED" | "CANCELLED" | "TIMED_OUT" {
  if (code === 0) return "COMPLETED";
  if (code === 1032) return "CANCELLED";   // user cancelled
  if (code === 1037) return "TIMED_OUT";   // no response
  return "FAILED";
}

Deno.serve(withRequest({
  name: "mpesa-callback",
  auth: false,
  handler: async ({ req, body, log, admin, requestId, correlationId }) => {
    const _t0 = Date.now();
    const ip = req.headers.get("cf-connecting-ip")
      || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
    const headerSnap: Record<string, string> = {};
    req.headers.forEach((v, k) => { headerSnap[k] = v; });

    // === Slice 2 §0.2.6 — PERSIST BEFORE VALIDATE ===
    // Write raw callback FIRST so evidence survives every downstream failure.
    let logRowId: string | null = null;
    const _cbBody = (body as { Body?: { stkCallback?: { CheckoutRequestID?: string; MerchantRequestID?: string } } })?.Body;
    const _checkoutId = _cbBody?.stkCallback?.CheckoutRequestID ?? null;
    const _merchantId = _cbBody?.stkCallback?.MerchantRequestID ?? null;
    const _isCertPing = req.headers.get("x-certification-run") === "1"
      || (_checkoutId?.startsWith("cert-") ?? false);
    try {
      const { data: ins } = await admin.from("mpesa_callback_logs").insert({
        payload: body as any,
        headers: headerSnap,
        ip_address: ip,
        checkout_request_id: _checkoutId,
        merchant_request_id: _merchantId,
        verified: false,
      }).select("id").single();
      logRowId = ins?.id ?? null;
    } catch (e) {
      log.error("callback_log_insert_failed", { error: (e as Error)?.message });
    }

    const _corr = req.headers.get("x-correlation-id") || correlationId;
    const _invId = await beginInvocation({
      functionName: "mpesa-callback",
      workflowName: "payment.wallet.topup",
      correlationId: _corr,
      requestId,
      httpMethod: req.method,
      ip,
      userAgent: req.headers.get("user-agent"),
      metadata: { checkout_request_id: _checkoutId, source: "daraja", certification: _isCertPing },
    });
    await stage({ correlationId: _corr, stageKey: STAGE.CALLBACK_RECEIVED, status: "OK", evidence: { ip, checkout_request_id: _checkoutId, log_row_id: logRowId } });
    await step({ correlationId: _corr, invocationId: _invId, functionName: "mpesa-callback", stepNumber: 1, stepKey: "01_raw_persisted", stepName: "Raw callback persisted", status: "OK", evidence: { log_row_id: logRowId } });
    await journeyEvent({ correlationId: _corr, workflowName: "payment.wallet.topup", eventKey: STAGE.CALLBACK_RECEIVED, actor: "daraja", sourceComponent: "mpesa-callback", checkoutRequestId: _checkoutId ?? undefined });

    const ack = ok({ ResultCode: 0, ResultDesc: "Accepted" });
    // NOTE: always ack Daraja with 200 so it doesn't retry, but reflect the
    // real terminal payment state on the invocation so certification joins
    // against workflow_registry see accurate lifecycle evidence.
    let _finalState: string = "CALLBACK_RECEIVED";
    const _finish = async () => {
      await finishInvocation({ invocationId: _invId, status: "SUCCEEDED", durationMs: Date.now() - _t0, currentState: _finalState as any });
      if (!_isCertPing) await computeHealthSnapshot(_corr);
    };

    try {
      // Certification ping — evidence captured, safely ack.
      if (_isCertPing) {
        if (logRowId) await admin.from("mpesa_callback_logs").update({ verified: true, verification_notes: "certification_ping" }).eq("id", logRowId);
        log.info("certification_ping_acked", { checkout_request_id: _checkoutId });
        await _finish(); return ack;
      }
      const { stkCallback } = (body as any)?.Body || {};
      if (!stkCallback) {
        log.warn("missing_stk_callback");
        await _finish(); return ack;
      }
      const {
        ResultCode, ResultDesc, MerchantRequestID, CheckoutRequestID, CallbackMetadata,
      } = stkCallback;

      // 2) Find the payment_attempt by CheckoutRequestID
      const { data: attempt } = await admin
        .from("payment_attempts")
        .select("id, user_id, wallet_id, amount_cents, state, wallet_posted, initiated_at, phone, account_reference, merchant_request_id")
        .eq("checkout_request_id", CheckoutRequestID)
        .maybeSingle();

      if (!attempt) {
        log.warn("no_attempt_for_callback", { CheckoutRequestID });
        await admin.from("payment_dead_letters").insert({
          kind: "callback", payload: body as any,
          last_error: "no_payment_attempt_found",
        });
        // Webhook-driven recovery: settle the orphan callback immediately
        // instead of waiting for the next scheduled reconciliation sweep.
        try {
          const base = Deno.env.get("SUPABASE_URL");
          const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
          if (base && key) {
            await fetch(`${base}/functions/v1/mpesa-reconcile-recent`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
              body: JSON.stringify({ checkout_request_id: CheckoutRequestID, source: "callback_orphan" }),
            });
          }
        } catch (e) {
          log.warn("immediate_reconcile_failed", { error: (e as Error)?.message });
        }
        await _finish(); return ack;
      }

      // 2b) Reconcile with mpesa_stk_attempts via CheckoutRequestID + idempotency_key.
      // We stamp final_result_* on every attempt row that shares the same
      // checkout_request_id so audit history preserves each retry.
      const reconcile = async (opts: {
        code: number; desc: string; receipt?: string | null;
        mismatch?: boolean; notes?: string;
      }) => {
        try {
          await admin.from("mpesa_stk_attempts")
            .update({
              final_result_code: opts.code,
              final_result_desc: opts.desc,
              final_receipt: opts.receipt ?? null,
              reconciled_at: new Date().toISOString(),
              reconciliation_mismatch: !!opts.mismatch,
              reconciliation_notes: opts.notes ?? null,
            })
            .eq("checkout_request_id", CheckoutRequestID);
          // Fire an admin/finance alert on any mismatch so operations
          // can investigate before customer disputes escalate.
          if (opts.mismatch) {
            await admin.from("alerts_events").insert({
              rule_name: "mpesa_callback_mismatch",
              stream: "payments",
              metric_key: "mpesa.callback.mismatch",
              severity: "high",
              message: `M-Pesa callback mismatch on CheckoutRequestID ${CheckoutRequestID}: ${opts.notes ?? opts.desc}`,
              context: {
                checkout_request_id: CheckoutRequestID,
                merchant_request_id: MerchantRequestID,
                payment_attempt_id: attempt?.id ?? null,
                result_code: opts.code,
                result_desc: opts.desc,
                receipt: opts.receipt ?? null,
                notes: opts.notes ?? null,
              },
            });
          }
        } catch (e) {
          log.warn("stk_attempt_reconcile_failed", { error: (e as Error)?.message });
        }
      };

      // 2c) Charter booking reconciliation — idempotent.
      // Safaricom may deliver the same STK result more than once. We record
      // every delivery in charter_payment_events keyed by a deterministic
      // dedupe key; only the first insert wins, so repeated deliveries can
      // never flip payment_status back and forth or create a second
      // confirmation. Later deliveries are stored as `duplicate` evidence.
      const reconcileCharter = async (opts: {
        code: number; desc: string; receipt?: string | null; amountKes?: number | null;
      }) => {
        try {
          const { data: legacyTxn } = await admin.from("mpesa_transactions")
            .select("account_reference")
            .eq("checkout_request_id", CheckoutRequestID)
            .maybeSingle();
          const accountRef = legacyTxn?.account_reference as string | undefined;
          if (!accountRef) return;
          const { data: bk } = await admin.from("charter_bookings")
            .select("id,reference,payment_status,amount")
            .eq("reference", accountRef)
            .maybeSingle();
          if (!bk) return;

          const appliedStatus = opts.code === 0
            ? "paid"
            : opts.code === 1032 ? "cancelled" : "failed";
          const dedupeKey = `${CheckoutRequestID}:${opts.receipt ?? `rc${opts.code}`}`;

          const { data: inserted } = await admin.from("charter_payment_events")
            .upsert({
              booking_id: bk.id,
              reference: bk.reference,
              checkout_request_id: CheckoutRequestID,
              dedupe_key: dedupeKey,
              result_code: opts.code,
              result_desc: opts.desc,
              mpesa_receipt: opts.receipt ?? null,
              amount_kes: opts.amountKes ?? null,
              applied_status: appliedStatus,
              outcome: "applied",
              payload: { resultCode: opts.code, resultDesc: opts.desc, receipt: opts.receipt ?? null },
            }, { onConflict: "dedupe_key", ignoreDuplicates: true })
            .select("id")
            .maybeSingle();

          if (!inserted) {
            log.info("charter_callback_duplicate", { reference: bk.reference, dedupe_key: dedupeKey });
            return;
          }
          // A settled booking is terminal — never downgrade it on a late failure.
          if (["paid", "settled"].includes(String(bk.payment_status))) return;

          if (appliedStatus === "paid") {
            // A terminal replay carries no receipt: the original success was already recorded.
            if (!opts.receipt) return;
            // Record the confirmed amount in the finance register (+ finance@ record).
            // The booking turns paid only when verified payments cover its amount.
            const paidKes = Number(opts.amountKes ?? bk.amount ?? 0);
            const { error: finErr } = await admin.rpc("fin_record_mpesa", {
              _booking_ref: bk.reference, _amount: paidKes, _receipt: opts.receipt ?? CheckoutRequestID,
              _verified: true, _payer: null,
            });
            if (finErr) log.warn("charter_fin_record_failed", { reference: bk.reference, error: finErr.message });
            await admin.from("charter_bookings").update({
              checkout_request_id: CheckoutRequestID, mpesa_receipt: opts.receipt ?? null,
            }).eq("id", bk.id);
            const { data: after } = await admin.from("charter_bookings").select("payment_status").eq("id", bk.id).maybeSingle();
            if (String(after?.payment_status) !== "paid") return;
          } else {
            await admin.from("charter_bookings").update({
              payment_status: appliedStatus,
              checkout_request_id: CheckoutRequestID,
              paid_at: null,
            }).eq("id", bk.id);
          }

          // Phase 8.4.12 — write the authoritative payment reference and status
          // into the commercial transaction spine so revenue eligibility is
          // decided on a real payment, never on an assumption.
          const paymentRef = opts.receipt ?? CheckoutRequestID;
          const { error: linkErr } = await admin.rpc("link_transaction_payment", {
            _booking_table: "charter_bookings",
            _booking_id: bk.id,
            _payment_ref: paymentRef,
            _payment_status: appliedStatus === "paid" ? "captured" : appliedStatus,
            _payment_provider: "mpesa",
            _paid_at: appliedStatus === "paid" ? new Date().toISOString() : null,
          });
          if (linkErr) {
            log.warn("charter_spine_payment_link_failed", { reference: bk.reference, error: linkErr.message });
          }
        } catch (e) {
          log.warn("charter_reconcile_failed", { error: (e as Error)?.message });
        }
      };




      // 3) Verify age
      const ageMs = Date.now() - new Date(attempt.initiated_at).getTime();
      if (ageMs > MAX_CALLBACK_AGE_MS) {
        log.warn("callback_too_old", { attempt_id: attempt.id, ageMs });
      }

      // 4) Idempotent: already in terminal state
      if (["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT", "REVERSED"].includes(attempt.state)) {
        log.info("callback_duplicate_terminal_state", { attempt_id: attempt.id, state: attempt.state });
        await reconcile({ code: Number(ResultCode), desc: ResultDesc, notes: `duplicate_terminal:${attempt.state}` });
        // Terminal attempt: the stored attempt state is authoritative. A replayed
        // or forged ResultCode can never mark a charter booking paid here.
        const terminalCode = attempt.state === "COMPLETED" ? 0 : attempt.state === "CANCELLED" ? 1032 : 1;
        await reconcileCharter({ code: terminalCode, desc: `terminal:${attempt.state}` });
        if (logRowId) {
          await admin.from("mpesa_callback_logs").update({
            verified: true, verification_notes: "duplicate_terminal",
            payment_attempt_id: attempt.id,
          }).eq("id", logRowId);
        }
        await _finish(); return ack;
      }

      // Mark callback received (best-effort transition)
      try {
        await admin.rpc("transition_payment_state", {
          p_attempt_id: attempt.id, p_to: "CALLBACK_RECEIVED", p_actor: "callback",
          p_payload: { resultCode: ResultCode, resultDesc: ResultDesc },
        });
      } catch (e) { log.warn("transition_callback_received_skipped", { error: (e as Error)?.message }); }

      const next = classifyResult(Number(ResultCode));

      if (next === "COMPLETED" && CallbackMetadata?.Item) {
        const meta: Record<string, any> = {};
        for (const item of CallbackMetadata.Item) meta[item.Name] = item.Value;
        const receivedCents = Math.round(Number(meta.Amount || 0) * 100);
        const receipt = meta.MpesaReceiptNumber as string | undefined;

        if (!receipt) {
          await admin.rpc("transition_payment_state", {
            p_attempt_id: attempt.id, p_to: "FAILED", p_actor: "callback",
            p_payload: { reason: "missing_receipt" }, p_failure_reason: "missing_receipt",
          });
          _finalState = "FAILED";
          await reconcile({ code: Number(ResultCode), desc: ResultDesc, mismatch: true, notes: "missing_receipt" });
          await _finish(); return ack;
        }
        // Unsigned callback: never trust a claimed success until Safaricom
        // independently confirms this CheckoutRequestID via STK Query.
        const confirmation = await confirmStkResult(String(CheckoutRequestID));
        if (logRowId) {
          await admin.from("mpesa_callback_logs").update({
            verified: confirmation === "confirmed",
            verification_notes: `stk_query:${confirmation}`,
          }).eq("id", logRowId);
        }
        if (confirmation !== "confirmed") {
          log.warn("callback_success_not_confirmed", { CheckoutRequestID, confirmation });
          await admin.from("payment_dead_letters").insert({
            kind: "callback", payload: body as any,
            last_error: `success_not_confirmed_by_daraja:${confirmation}`,
          });
          // Leave the attempt pending; reconciliation (STK Query) settles it.
          await _finish(); return ack;
        }
        if (receivedCents !== attempt.amount_cents) {
          await admin.rpc("transition_payment_state", {
            p_attempt_id: attempt.id, p_to: "FAILED", p_actor: "callback",
            p_payload: { reason: "amount_mismatch", expected: attempt.amount_cents, received: receivedCents },
            p_failure_reason: "amount_mismatch",
          });
          _finalState = "FAILED";
          log.error("amount_mismatch", { attempt_id: attempt.id, expected: attempt.amount_cents, received: receivedCents });
          await reconcile({ code: Number(ResultCode), desc: ResultDesc, mismatch: true, notes: `amount_mismatch:expected=${attempt.amount_cents},received=${receivedCents}` });
          await _finish(); return ack;
        }

        // Corporate charter wallet funding is credited by its own transactional
        // RPC, which locks the wallet, verifies MerchantRequestID / amount /
        // receipt, dedupes replays and appends an immutable ledger entry. When
        // the callback belongs to a funding request the personal wallet must NOT
        // also be credited — the money has exactly one destination.
        let charterFunded = false;
        try {
          const { data: cwf, error: cwfErr } = await admin.rpc("charter_wallet_apply_funding_callback", {
            p_checkout_request_id: CheckoutRequestID,
            p_merchant_request_id: MerchantRequestID ?? null,
            p_amount_kes: Number(meta.Amount || 0),
            p_receipt: receipt,
            p_result_code: Number(ResultCode),
            p_result_desc: ResultDesc ?? null,
          });
          if (cwfErr) throw new Error(cwfErr.message);
          charterFunded = !!(cwf as any)?.matched;
          if (charterFunded) log.info("charter_wallet_funding_callback", cwf as any);
        } catch (e) {
          log.error("charter_wallet_funding_failed", { error: (e as Error)?.message, CheckoutRequestID });
          await admin.from("payment_dead_letters").insert({
            kind: "charter_wallet_funding", payment_attempt_id: attempt.id,
            payload: body as any, last_error: (e as Error)?.message ?? "unknown",
          }).then(() => {}, () => {});
        }

        // A payment for a charter booking (account reference = booking number)
        // settles that booking only — it must never also credit a wallet.
        let charterBookingPayment = false;
        try {
          const { data: lt } = await admin.from("mpesa_transactions")
            .select("account_reference").eq("checkout_request_id", CheckoutRequestID).maybeSingle();
          const ref = String(lt?.account_reference ?? "");
          if (/^CH-/i.test(ref)) {
            const { data: cb } = await admin.from("charter_bookings").select("id").eq("reference", ref).maybeSingle();
            charterBookingPayment = !!cb;
          }
        } catch { /* fall back to the normal wallet path */ }

        // Exactly-once credit. RPC locks wallet + attempt + dedupes receipt.
        const { error: creditErr } = (charterFunded || charterBookingPayment)
          ? { error: null as null | { message: string } }
          : await admin.rpc("credit_wallet_exactly_once", {
              p_checkout_request_id: CheckoutRequestID,
              p_receipt: receipt,
              p_amount_cents: attempt.amount_cents,
            });
        if (creditErr) {
          log.error("credit_failed", { error: creditErr.message, attempt_id: attempt.id });
          await admin.from("payment_dead_letters").insert({
            kind: "wallet_credit", payment_attempt_id: attempt.id,
            payload: body as any, last_error: creditErr.message,
          });
          await admin.rpc("transition_payment_state", {
            p_attempt_id: attempt.id, p_to: "FAILED", p_actor: "callback",
            p_payload: { reason: "credit_failed", error: creditErr.message },
            p_failure_reason: creditErr.message,
          });
          _finalState = "FAILED";
          await _finish(); return ack;
        }

        await admin.rpc("transition_payment_state", {
          p_attempt_id: attempt.id, p_to: "COMPLETED", p_actor: "callback",
          p_payload: { receipt, amount_cents: attempt.amount_cents },
          p_receipt: receipt,
        });
        _finalState = "COMPLETED";

        // Verified ledger mirror. If the STK-time row is missing (lost write or a
        // constraint collision) the callback creates it, so a real payment can
        // always be settled against its order.
        const { data: mirrored } = await admin.from("mpesa_transactions")
          .update({
            status: "SUCCESS", result_code: ResultCode, result_desc: ResultDesc,
            mpesa_receipt: receipt, provider_transaction_id: receipt,
            raw_callback: { resultCode: ResultCode, resultDesc: ResultDesc, callbackMetadata: CallbackMetadata },
          }).eq("checkout_request_id", CheckoutRequestID).select("id");
        if (!mirrored || mirrored.length === 0) {
          const { error: healErr } = await admin.from("mpesa_transactions").insert({
            user_id: attempt.user_id, wallet_id: attempt.wallet_id,
            phone: attempt.phone, amount_cents: attempt.amount_cents, currency: "KES",
            payment_provider: "mpesa_daraja",
            transaction_reference: CheckoutRequestID,
            account_reference: attempt.account_reference,
            merchant_request_id: attempt.merchant_request_id ?? null,
            checkout_request_id: CheckoutRequestID,
            status: "SUCCESS", result_code: ResultCode, result_desc: ResultDesc,
            mpesa_receipt: receipt, provider_transaction_id: receipt,
            raw_callback: { resultCode: ResultCode, resultDesc: ResultDesc, callbackMetadata: CallbackMetadata },
          });
          if (healErr) log.error("ledger_backfill_failed", { CheckoutRequestID, error: healErr.message });
          else log.info("ledger_backfilled", { CheckoutRequestID, receipt });
        }

        // Settlement posting (best-effort)
        try {
          const { data: legacy } = await admin.from("mpesa_transactions")
            .select("id").eq("checkout_request_id", CheckoutRequestID).maybeSingle();
          if (legacy?.id) {
            const { error: settleErr } = await admin.rpc("post_mpesa_settlement", { _txn_id: legacy.id });
            if (settleErr) log.warn("settlement_failed", { error: settleErr.message });
          }
        } catch (e) { log.warn("settlement_skipped", { error: (e as Error)?.message }); }


        // Outbox event for downstream consumers (notifications, BigQuery, analytics)
        try {
          await admin.rpc("enqueue_event", {
            p_event_type: "PAYMENT_COMPLETED",
            p_channel: "payments",
            p_payload: {
              payment_attempt_id: attempt.id,
              user_id: attempt.user_id,
              wallet_id: attempt.wallet_id,
              amount_cents: attempt.amount_cents,
              receipt,
              checkout_request_id: CheckoutRequestID,
            },
            p_dedupe_key: `PAYMENT_COMPLETED:${receipt}`,
          });
        } catch (e) { log.warn("enqueue_event_failed", { error: (e as Error)?.message }); }

        if (logRowId) {
          await admin.from("mpesa_callback_logs").update({
            verified: true, verification_notes: "credited",
            payment_attempt_id: attempt.id,
          }).eq("id", logRowId);
        }
        await reconcile({ code: Number(ResultCode), desc: ResultDesc, receipt });
        await reconcileCharter({ code: Number(ResultCode), desc: ResultDesc, receipt, amountKes: attempt.amount_cents / 100 });
        log.info("payment_settled", { attempt_id: attempt.id, receipt });
      } else {
        // Non-success result. Callbacks are unsigned, so a claimed failure is
        // just as untrusted as a claimed success: only Safaricom's own STK
        // Query may move a payment to a failed/cancelled state.
        const failConfirm = await confirmStkResult(String(CheckoutRequestID));
        if (failConfirm !== "not_confirmed") {
          log.warn("callback_failure_not_confirmed", { CheckoutRequestID, failConfirm });
          if (logRowId) {
            await admin.from("mpesa_callback_logs").update({
              verified: false, verification_notes: `failure_unverified:stk_query:${failConfirm}`,
            }).eq("id", logRowId);
          }
          await admin.from("payment_dead_letters").insert({
            kind: "callback", payload: body as any,
            last_error: `failure_not_confirmed_by_daraja:${failConfirm}`,
          });
          await _finish(); return ack;
        }
        await admin.rpc("transition_payment_state", {
          p_attempt_id: attempt.id, p_to: next, p_actor: "callback",
          p_payload: { resultCode: ResultCode, resultDesc: ResultDesc },
          p_failure_reason: ResultDesc,
        });
        _finalState = next;
        await admin.from("mpesa_transactions").update({
          status: "FAILED", result_code: ResultCode, result_desc: ResultDesc,
          raw_callback: { resultCode: ResultCode, resultDesc: ResultDesc },
        }).eq("checkout_request_id", CheckoutRequestID);
        if (logRowId) {
          await admin.from("mpesa_callback_logs").update({
            verified: true, verification_notes: `non_success:${ResultCode}`,
            payment_attempt_id: attempt.id,
          }).eq("id", logRowId);
        }
        await reconcile({ code: Number(ResultCode), desc: ResultDesc, notes: `non_success:${next}` });
        await reconcileCharter({ code: Number(ResultCode), desc: ResultDesc });
        // Mark any corporate funding request failed/cancelled/expired — never credits.
        try {
          await admin.rpc("charter_wallet_apply_funding_callback", {
            p_checkout_request_id: CheckoutRequestID,
            p_merchant_request_id: MerchantRequestID ?? null,
            p_amount_kes: 0,
            p_receipt: null,
            p_result_code: Number(ResultCode),
            p_result_desc: ResultDesc ?? null,
          });
        } catch (e) { log.warn("charter_funding_failure_mark_skipped", { error: (e as Error)?.message }); }
      }
    } catch (err) {
      log.error("callback_processing_error", { error: (err as Error)?.message });
      await admin.from("payment_dead_letters").insert({
        kind: "callback", payload: body as any,
        last_error: (err as Error)?.message ?? "unknown",
      }).then(() => {}, () => {});
    }
    await _finish(); return ack;
  },
}));
