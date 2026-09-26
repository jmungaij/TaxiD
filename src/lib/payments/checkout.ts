/**
 * Production checkout orchestrator.
 *
 * One place that owns the full customer payment lifecycle:
 *   1. Client-side validation (KES amount ceiling, Kenyan MSISDN).
 *   2. Idempotent initiation — a stable `Idempotency-Key` per checkout so a
 *      double-click, a retry or a page reload can never create two charges.
 *   3. Bounded polling of `mpesa-status` with backoff, an explicit timeout and
 *      an unambiguous terminal classification.
 *   4. Automatic reconciliation — on timeout/uncertainty we ask
 *      `mpesa-reconcile-recent` to settle the attempt against Daraja rather
 *      than leaving the customer in limbo.
 *
 * Every charge runs against Safaricom paybill 4148095 via the same
 * `mpesa-stkpush` integration the wallet top-ups use — no parallel stack.
 */
import { supabase } from "@/integrations/supabase/client";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { normalizeKenyanMsisdn } from "@/lib/kenyaPhone";

/** Paybill that receives every Yalla Mobility M-Pesa collection. */
export const YALLA_PAYBILL = "4148095";

/** Maximum a single M-Pesa transaction may carry, per paying phone number. */
export const MPESA_MAX_TXN_KES = 250_000;

export type PaymentMethod = "mpesa" | "card" | "corporate_wallet" | "bank_transfer";

export interface CheckoutRequest {
  /** Amount in whole Kenyan Shillings. */
  amountKes: number;
  /** Payer MSISDN in any Kenyan format. */
  phone: string;
  /** Human reference shown on the M-Pesa statement (e.g. booking reference). */
  reference: string;
  method?: PaymentMethod;
  /** Stable key; generated when omitted. */
  idempotencyKey?: string;
  walletType?: string;
}

export type CheckoutOutcome =
  | { state: "paid"; checkoutRequestId: string; receipt: string | null; idempotencyKey: string }
  | { state: "failed"; code: string; message: string; checkoutRequestId?: string; idempotencyKey: string }
  | { state: "timeout"; message: string; checkoutRequestId: string; idempotencyKey: string; reconciling: boolean }
  | { state: "duplicate"; message: string; idempotencyKey: string };

export interface CheckoutProgress {
  phase: "validating" | "initiating" | "awaiting_customer" | "polling" | "reconciling" | "done";
  message: string;
  attempt?: number;
}

const POLL_INTERVAL_MS = 4_000;
const POLL_TIMEOUT_MS = 120_000;

/** Deterministic-ish idempotency key for one checkout intent. */
export function makeIdempotencyKey(reference: string, amountKes: number, phone: string): string {
  const msisdn = normalizeKenyanMsisdn(phone) ?? phone;
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `co_${reference}_${amountKes}_${msisdn.slice(-4)}_${rand}`;
}

export interface ValidationResult {
  ok: boolean;
  code?: "AMOUNT_INVALID" | "AMOUNT_LIMIT_EXCEEDED" | "PHONE_INVALID";
  message?: string;
  msisdn?: string;
}

/** Mirrors the server-side rules so the customer sees the error instantly. */
export function validateCheckout(amountKes: number, phone: string): ValidationResult {
  if (!Number.isFinite(amountKes) || Math.round(amountKes) < 1) {
    return { ok: false, code: "AMOUNT_INVALID", message: "Enter an amount of at least KSh 1." };
  }
  if (Math.round(amountKes) > MPESA_MAX_TXN_KES) {
    return {
      ok: false,
      code: "AMOUNT_LIMIT_EXCEEDED",
      message: `M-Pesa allows a maximum of KSh ${MPESA_MAX_TXN_KES.toLocaleString(
        "en-KE",
      )} per transaction per phone number. Split the payment or pay the balance by bank transfer.`,
    };
  }
  const msisdn = normalizeKenyanMsisdn(phone);
  if (!msisdn) {
    return { ok: false, code: "PHONE_INVALID", message: "Enter a valid Kenyan mobile number, e.g. 0712 345 678." };
  }
  return { ok: true, msisdn };
}

/** Splits an over-limit total into compliant per-transaction instalments. */
export function splitIntoMpesaInstalments(totalKes: number): number[] {
  const total = Math.max(0, Math.round(totalKes));
  const full = Math.floor(total / MPESA_MAX_TXN_KES);
  const rest = total - full * MPESA_MAX_TXN_KES;
  const parts = Array.from({ length: full }, () => MPESA_MAX_TXN_KES);
  if (rest > 0) parts.push(rest);
  return parts;
}

async function fnError(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    return await error.context.text().catch(() => error.message);
  }
  return error instanceof Error ? error.message : String(error);
}

function classify(raw: string): { code: string; message: string } {
  const t = raw.toLowerCase();
  if (t.includes("idempotency_conflict")) {
    return { code: "IDEMPOTENCY_CONFLICT", message: "This payment reference was already used with different details." };
  }
  if (t.includes("in_flight")) {
    return { code: "IN_FLIGHT", message: "A payment for this booking is already being processed." };
  }
  if (t.includes("amount_limit_exceeded")) {
    return {
      code: "AMOUNT_LIMIT_EXCEEDED",
      message: `M-Pesa caps a single transaction at KSh ${MPESA_MAX_TXN_KES.toLocaleString("en-KE")} per phone number.`,
    };
  }
  if (t.includes("circuit_open")) {
    return { code: "CIRCUIT_OPEN", message: "M-Pesa is temporarily unavailable. Please retry in a few minutes." };
  }
  if (t.includes("rate_limited")) {
    return { code: "RATE_LIMITED", message: "Too many payment requests right now. Please retry shortly." };
  }
  if (t.includes("fraud_blocked")) {
    return { code: "FRAUD_BLOCKED", message: "This payment was blocked by our fraud policy. Contact support." };
  }
  if (t.includes("step_up_required")) {
    return { code: "STEP_UP_REQUIRED", message: "Extra verification is required before this payment can proceed." };
  }
  return { code: "PAYMENT_FAILED", message: raw.slice(0, 240) || "Payment could not be started." };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs the full M-Pesa checkout: initiate → wait for the customer → poll →
 * reconcile. Never throws; always resolves to a classified outcome.
 */
export async function runMpesaCheckout(
  req: CheckoutRequest,
  onProgress?: (p: CheckoutProgress) => void,
): Promise<CheckoutOutcome> {
  const idempotencyKey = req.idempotencyKey ?? makeIdempotencyKey(req.reference, req.amountKes, req.phone);
  const report = (p: CheckoutProgress) => onProgress?.(p);

  report({ phase: "validating", message: "Checking payment details" });
  const v = validateCheckout(req.amountKes, req.phone);
  if (!v.ok) return { state: "failed", code: v.code!, message: v.message!, idempotencyKey };

  report({ phase: "initiating", message: `Sending an M-Pesa prompt to ${v.msisdn}` });
  const { data, error } = await supabase.functions.invoke("mpesa-stkpush", {
    body: {
      amount: Math.round(req.amountKes),
      phone: v.msisdn,
      wallet_type: req.walletType ?? "personal",
      account_reference: req.reference.slice(0, 64),
      idempotency_key: idempotencyKey,
    },
    headers: { "Idempotency-Key": idempotencyKey },
  });

  if (error) {
    const detail = await fnError(error);
    const c = classify(detail);
    if (c.code === "IN_FLIGHT" || c.code === "IDEMPOTENCY_CONFLICT") {
      return { state: "duplicate", message: c.message, idempotencyKey };
    }
    return { state: "failed", code: c.code, message: c.message, idempotencyKey };
  }

  const checkoutRequestId: string | undefined =
    data?.checkoutRequestId ?? data?.data?.checkoutRequestId;
  if (!checkoutRequestId) {
    return { state: "failed", code: "NO_CHECKOUT_ID", message: "M-Pesa did not return a checkout reference.", idempotencyKey };
  }

  report({ phase: "awaiting_customer", message: "Enter your M-Pesa PIN on your phone to authorise the payment." });

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt += 1;
    await sleep(POLL_INTERVAL_MS);
    report({ phase: "polling", message: "Confirming payment with M-Pesa…", attempt });

    const { data: st, error: stErr } = await supabase.functions.invoke("mpesa-status", {
      body: { checkout_request_id: checkoutRequestId },
    });
    if (stErr) continue; // transient — keep polling until the deadline

    const status = String(st?.transaction?.status ?? st?.data?.transaction?.status ?? "").toUpperCase();
    const receipt = st?.transaction?.mpesa_receipt ?? st?.data?.transaction?.mpesa_receipt ?? null;
    if (status === "SUCCESS" || status === "COMPLETED" || status === "PAID") {
      report({ phase: "done", message: "Payment received." });
      return { state: "paid", checkoutRequestId, receipt, idempotencyKey };
    }
    if (status === "FAILED" || status === "CANCELLED" || status === "REVERSED") {
      const desc = st?.transaction?.result_desc ?? st?.data?.transaction?.result_desc ?? "The M-Pesa request was not completed.";
      return { state: "failed", code: "PAYMENT_DECLINED", message: String(desc), checkoutRequestId, idempotencyKey };
    }
  }

  // ---- Timed out: hand the attempt to automatic reconciliation ----------
  report({ phase: "reconciling", message: "Payment is taking longer than expected — reconciling with M-Pesa." });
  let reconciling = false;
  try {
    const { error: rErr } = await supabase.functions.invoke("mpesa-reconcile-recent", {
      body: { checkout_request_id: checkoutRequestId },
    });
    reconciling = !rErr;
  } catch {
    reconciling = false;
  }
  return {
    state: "timeout",
    checkoutRequestId,
    idempotencyKey,
    reconciling,
    message:
      "We haven't received confirmation from M-Pesa yet. Your payment is being reconciled automatically — " +
      "you'll get a receipt as soon as it settles, and you will not be charged twice.",
  };
}
