// M-Pesa STK Push — enterprise hardened.
//
// Slice 2 hardening:
//   - Opens a payment_attempt via RPC (atomic with audit row).
//   - Honors MPESA_CALLBACK_URL secret (no fragile URL parsing).
//   - Checks distributed circuit breaker before calling Daraja.
//   - 15s AbortController timeout on Daraja fetch.
//   - Only ever transitions INITIATED -> ACCEPTED. Never marks COMPLETED here.
//   - Idempotency-key status becomes "accepted" (not "succeeded").
//   - Records failures into the breaker; opens after 20 failures in 60s.
//   - Also writes legacy mpesa_transactions row (back-compat reporting).
import { z } from "npm:zod@3";
import { withRequest, ok, fail, HttpError } from "../_shared/framework.ts";
import {
  getConfig, formatPhoneNumber, buildSTKPayload, fetchAccessToken, checkTransactionLimit,
} from "../_shared/mpesa.ts";
import { beginInvocation, finishInvocation, stage, step, transition, computeHealthSnapshot, STAGE, STK_STEPS } from "../_shared/journey.ts";

const S = STK_STEPS;
async function trace(fnArgs: { correlationId: string; invocationId: string | null; attemptId?: string | null; key: keyof typeof STK_STEPS; status: "STARTED" | "OK" | "SKIPPED" | "FAILED" | "TIMED_OUT"; latencyMs?: number; errorCode?: string; errorMessage?: string; evidence?: Record<string, unknown>; }) {
  const meta = S[fnArgs.key];
  await step({
    correlationId: fnArgs.correlationId,
    invocationId: fnArgs.invocationId,
    paymentAttemptId: fnArgs.attemptId ?? null,
    functionName: "mpesa-stkpush",
    stepNumber: meta.n,
    stepKey: fnArgs.key,
    stepName: meta.name,
    status: fnArgs.status,
    latencyMs: fnArgs.latencyMs ?? null,
    errorCode: fnArgs.errorCode ?? null,
    errorMessage: fnArgs.errorMessage ?? null,
    evidence: fnArgs.evidence ?? {},
  });
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const MPESA_CALLBACK_URL = Deno.env.get("MPESA_CALLBACK_URL")
  || `${SUPABASE_URL}/functions/v1/mpesa-callback`;
const SERVICE = "mpesa_stkpush";
const BREAKER_FAIL_THRESHOLD = 20;
const BREAKER_WINDOW_SECONDS = 60;
const BREAKER_OPEN_SECONDS = 300;
const DARAJA_TIMEOUT_MS = 15_000;

const Body = z.object({
  amount: z.number().int().min(1).max(250_000),
  phone: z.string().min(9),
  wallet_type: z.string().default("personal"),
  account_reference: z.string().max(64).optional(),
  idempotency_key: z.string().optional(),
});
type BodyT = z.infer<typeof Body>;

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function checkBreaker(admin: any, log: any): Promise<{ allowed: boolean; reason?: string }> {
  const { data } = await admin
    .from("payment_circuit_breakers")
    .select("state, reopens_at")
    .eq("service", SERVICE)
    .maybeSingle();
  if (!data) return { allowed: true };
  if (data.state === "OPEN") {
    if (data.reopens_at && new Date(data.reopens_at).getTime() <= Date.now()) {
      // promote to HALF_OPEN — let one request through
      await admin.from("payment_circuit_breakers")
        .update({ state: "HALF_OPEN", updated_at: new Date().toISOString() })
        .eq("service", SERVICE);
      log.warn("breaker_half_open");
      return { allowed: true };
    }
    return { allowed: false, reason: "circuit_open" };
  }
  return { allowed: true };
}

async function recordBreakerOutcome(admin: any, success: boolean, errorMsg?: string) {
  const { data: cur } = await admin
    .from("payment_circuit_breakers").select("*").eq("service", SERVICE).maybeSingle();
  const now = new Date();
  if (success) {
    await admin.from("payment_circuit_breakers").update({
      state: "CLOSED", failure_count: 0, success_count: (cur?.success_count ?? 0) + 1,
      window_started_at: now.toISOString(), opened_at: null, reopens_at: null,
      last_error: null, updated_at: now.toISOString(),
    }).eq("service", SERVICE);
    return;
  }
  const windowStart = cur?.window_started_at ? new Date(cur.window_started_at) : now;
  const inWindow = (now.getTime() - windowStart.getTime()) / 1000 <= BREAKER_WINDOW_SECONDS;
  const failures = (inWindow ? (cur?.failure_count ?? 0) : 0) + 1;
  const shouldOpen = failures >= BREAKER_FAIL_THRESHOLD;
  await admin.from("payment_circuit_breakers").update({
    state: shouldOpen ? "OPEN" : (cur?.state ?? "CLOSED"),
    failure_count: failures,
    window_started_at: inWindow ? (cur?.window_started_at ?? now.toISOString()) : now.toISOString(),
    opened_at: shouldOpen ? now.toISOString() : cur?.opened_at ?? null,
    reopens_at: shouldOpen ? new Date(now.getTime() + BREAKER_OPEN_SECONDS * 1000).toISOString() : cur?.reopens_at ?? null,
    last_error: errorMsg ?? null,
    updated_at: now.toISOString(),
  }).eq("service", SERVICE);
}

Deno.serve(withRequest<BodyT>({
  name: "mpesa-stkpush",
  auth: true,
  schema: Body,
  handler: async ({ req, body, user, log, admin, requestId, correlationId }) => {
    const _t0 = Date.now();
    const _invId = await beginInvocation({
      functionName: "mpesa-stkpush",
      workflowName: "payment.wallet.topup",
      correlationId,
      requestId,
      userId: user?.id ?? null,
      httpMethod: req.method,
      ip: req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? null,
      userAgent: req.headers.get("user-agent"),
      environment: Deno.env.get("MPESA_ENV") ?? null,
      metadata: { amount: body.amount, wallet_type: body.wallet_type },
    });
    await stage({ correlationId, stageKey: STAGE.FUNCTION_ENTERED, status: "OK" });
    await trace({ correlationId, invocationId: _invId, key: "01_function_entered", status: "OK" });
    await trace({ correlationId, invocationId: _invId, key: "02_body_validated", status: "OK", evidence: { amount: body.amount, wallet_type: body.wallet_type } });
    await trace({ correlationId, invocationId: _invId, key: "03_jwt_verified", status: "OK", evidence: { user_id: user?.id } });
    await transition({ correlationId, toState: "INITIATED", sourceFunction: "mpesa-stkpush" });
    try {
    const userId = user!.id;
    const amount = body.amount;
    const phone = formatPhoneNumber(body.phone);
    const walletType = body.wallet_type;
    const accountReference = body.account_reference || `TOPUP-${Date.now()}`;

    // ---- Per-transaction / per-MSISDN ceiling (KSh 250,000) ----------
    const limit = checkTransactionLimit(amount, phone);
    if (!limit.ok) {
      log.warn("amount_limit_rejected", { code: limit.code });
      await trace({ correlationId, invocationId: _invId, key: "02_body_validated", status: "FAILED", errorCode: limit.code });
      return fail(422, limit.code!, limit.message!);
    }

    // ---- Owner rule (updated): prompts go ONLY to the payer's own phone,
    // the number saved on their profile. Other people's numbers are refused.
    {
      const { data: prof } = await admin.from("profiles").select("phone").eq("user_id", userId).maybeSingle();
      let own: string | null = null;
      try { own = prof?.phone ? formatPhoneNumber(String(prof.phone)) : null; } catch { own = null; }
      if (!own) {
        return fail(422, "PROFILE_PHONE_REQUIRED", "Add your M-Pesa phone number to your profile before paying.");
      }
      if (phone !== own) {
        log.warn("non_owner_phone_rejected", {});
        return fail(403, "OWN_PHONE_ONLY", "Payment prompts can only be sent to the phone number saved on your profile.");
      }
    }

    // ---- Circuit breaker ---------------------------------------------
    const br = await checkBreaker(admin, log);
    if (!br.allowed) {
      log.warn("breaker_open_rejected");
      await trace({ correlationId, invocationId: _invId, key: "04_breaker_checked", status: "FAILED", errorCode: "CIRCUIT_OPEN" });
      return fail(503, "CIRCUIT_OPEN", "Payments temporarily unavailable. Please retry shortly.");
    }
    await trace({ correlationId, invocationId: _invId, key: "04_breaker_checked", status: "OK" });

    // ---- Idempotency --------------------------------------------------
    const idemKey =
      req.headers.get("Idempotency-Key") ||
      body.idempotency_key ||
      `${userId}:${phone}:${amount}:${accountReference}`;
    const requestHash = await sha256(JSON.stringify({ userId, phone, amount, walletType, accountReference }));

    const { data: existing } = await admin
      .from("mpesa_idempotency_keys")
      .select("status, response, request_hash")
      .eq("idempotency_key", idemKey).maybeSingle();

    if (existing) {
      if (existing.request_hash !== requestHash) {
        throw new HttpError(409, "Idempotency-Key reused with a different payload", "IDEMPOTENCY_CONFLICT");
      }
      if (existing.status === "accepted" && existing.response) {
        log.info("idempotent_replay", { idemKey });
        return ok(existing.response);
      }
      if (existing.status === "in_flight") {
        throw new HttpError(425, "Request already in flight — retry shortly", "IN_FLIGHT");
      }
    }
    await admin.from("mpesa_idempotency_keys").upsert({
      idempotency_key: idemKey, user_id: userId, request_hash: requestHash, status: "in_flight",
    }, { onConflict: "idempotency_key" });
    await trace({ correlationId, invocationId: _invId, key: "05_idempotency_resolved", status: "OK", evidence: { key_hint: idemKey.slice(0, 24) } });

    // ---- Wallet -------------------------------------------------------
    // wallets.wallet_type is a Postgres enum: personal | driver | corporate.
    // Callers may use domain aliases (e.g. corporate_charter); normalise them
    // here so a valid business request never fails on an enum cast.
    const WALLET_ALIASES: Record<string, string> = {
      corporate_charter: "corporate", charter: "corporate", corporate_wallet: "corporate",
      business: "corporate", company: "corporate", rider: "personal", user: "personal",
    };
    const walletKind = WALLET_ALIASES[walletType] ?? walletType;
    if (!["personal", "driver", "corporate"].includes(walletKind)) {
      await trace({ correlationId, invocationId: _invId, key: "06_wallet_loaded", status: "FAILED", errorCode: "WALLET_TYPE_INVALID" });
      return fail(422, "WALLET_TYPE_INVALID", `Unsupported wallet type "${walletType}". Use personal, driver or corporate.`);
    }

    const { data: wallet, error: wErr } = await admin
      .from("wallets").select("id").eq("user_id", userId).eq("wallet_type", walletKind).maybeSingle();
    if (wErr) { await trace({ correlationId, invocationId: _invId, key: "06_wallet_loaded", status: "FAILED", errorMessage: wErr.message }); throw new HttpError(500, `Wallet lookup failed: ${wErr.message}`, "WALLET_LOOKUP"); }
    let walletId = wallet?.id as string | undefined;
    if (!walletId) {
      // Provision an empty settlement wallet on demand. This never credits
      // funds — balances only ever move through the verified callback RPC.
      const { data: created, error: cErr } = await admin
        .from("wallets")
        .insert({ user_id: userId, wallet_type: walletKind, balance_cents: 0 })
        .select("id").single();
      if (cErr || !created) {
        await trace({ correlationId, invocationId: _invId, key: "06_wallet_loaded", status: "FAILED", errorCode: "WALLET_PROVISION_FAILED", errorMessage: cErr?.message });
        throw new HttpError(500, `Could not provision a ${walletKind} wallet: ${cErr?.message ?? "unknown error"}`, "WALLET_PROVISION_FAILED");
      }
      walletId = created.id;
      log.info("wallet_provisioned", { wallet_type: walletKind });
    }
    const wallet2 = { id: walletId };
    await trace({ correlationId, invocationId: _invId, key: "06_wallet_loaded", status: "OK", evidence: { wallet_id: wallet2.id } });

    // ---- Open payment attempt (atomic + audit) -----------------------
    const ip = req.headers.get("cf-connecting-ip")
      || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
    const userAgent = req.headers.get("user-agent");

    const { data: attempt, error: attErr } = await admin.rpc("create_payment_attempt", {
      p_user_id: userId,
      p_wallet_id: wallet2.id,
      p_amount_cents: amount * 100,
      p_phone: phone,
      p_idempotency_key: idemKey,
      p_account_reference: accountReference,
      p_request_id: requestId,
      p_correlation_id: correlationId,
      p_ip: ip,
      p_user_agent: userAgent,
    });
    if (attErr) {
      await admin.from("mpesa_idempotency_keys").update({
        status: "failed", completed_at: new Date().toISOString(),
        response: { error: attErr.message },
      }).eq("idempotency_key", idemKey);
      await trace({ correlationId, invocationId: _invId, key: "07_attempt_opened", status: "FAILED", errorMessage: attErr.message });
      throw new HttpError(500, `Failed to open payment attempt: ${attErr.message}`, "ATTEMPT_OPEN_FAILED");
    }
    const attemptId = (attempt as any).id;
    await trace({ correlationId, invocationId: _invId, attemptId, key: "07_attempt_opened", status: "OK" });

    // ---- Fraud engine v2 (pre-auth) ---------------------------------
    // BLOCK/CHALLENGE aborts before we ever touch Daraja. Fail-open on
    // engine errors so a fraud-service outage never takes down payments.
    try {
      const _fT0 = Date.now();
      const deviceFp = req.headers.get("x-device-fingerprint") ?? undefined;
      const { data: fraud, error: fraudErr } = await admin.functions.invoke("fraud-engine-v2", {
        body: {
          payment_attempt_id: attemptId,
          device_fingerprint: deviceFp,
          ip: ip ?? undefined,
          mode: "pre_auth",
        },
        headers: { "x-correlation-id": correlationId },
      });
      if (fraudErr) {
        log.warn("fraud_engine_error_fail_open", { error: fraudErr.message });
        await trace({ correlationId, invocationId: _invId, attemptId, key: "08_fraud_evaluated", status: "SKIPPED", latencyMs: Date.now() - _fT0, errorMessage: fraudErr.message });
      } else if (fraud?.decision === "BLOCK" || fraud?.decision === "CHALLENGE") {
        const reason = `fraud:${fraud.decision}:score=${fraud.score}`;
        await admin.rpc("transition_payment_state", {
          p_attempt_id: attemptId, p_to: "FAILED", p_actor: "system:fraud",
          p_payload: { fraud }, p_failure_reason: reason,
        });
        await admin.from("mpesa_idempotency_keys").update({
          status: "failed", completed_at: new Date().toISOString(),
          response: { error: reason, decision: fraud.decision, score: fraud.score },
        }).eq("idempotency_key", idemKey);
        await trace({ correlationId, invocationId: _invId, attemptId, key: "08_fraud_evaluated", status: "FAILED", latencyMs: Date.now() - _fT0, errorCode: fraud.decision, evidence: { score: fraud.score } });
        return fail(
          fraud.decision === "BLOCK" ? 403 : 428,
          fraud.decision === "BLOCK" ? "FRAUD_BLOCKED" : "STEP_UP_REQUIRED",
          fraud.decision === "BLOCK"
            ? "Payment blocked by fraud policy. Contact support."
            : "Additional verification required before this payment can proceed.",
        );
      } else {
        log.info("fraud_cleared", { score: fraud?.score, decision: fraud?.decision });
        await trace({ correlationId, invocationId: _invId, attemptId, key: "08_fraud_evaluated", status: "OK", latencyMs: Date.now() - _fT0, evidence: { score: fraud?.score, decision: fraud?.decision } });
      }
    } catch (e) {
      log.warn("fraud_engine_exception_fail_open", { error: (e as Error).message });
      await trace({ correlationId, invocationId: _invId, attemptId, key: "08_fraud_evaluated", status: "SKIPPED", errorMessage: (e as Error).message });
    }



    // ---- Rate limit per shortcode ------------------------------------
    const config = await getConfig();
    // Receiving-account invariant: the approved register must agree with
    // the PayBill we are about to charge into, or no prompt is sent.
    {
      const { data: rx } = await admin.from("payment_receiving_accounts")
        .select("account_number").eq("provider", "safaricom_mpesa").eq("channel", "paybill")
        .eq("status", "active").maybeSingle();
      if (config.env === "production" && rx?.account_number !== config.shortcode) {
        log.error("receiving_account_mismatch", {});
        await admin.rpc("transition_payment_state", {
          p_attempt_id: attemptId, p_to: "FAILED", p_actor: "system",
          p_payload: { reason: "receiving_account_mismatch" }, p_failure_reason: "receiving_account_mismatch",
        });
        return fail(503, "RECEIVING_ACCOUNT_UNVERIFIED", "Payments are temporarily unavailable. Please try again later.");
      }
      await admin.from("payment_attempts").update({ receiving_account: config.shortcode }).eq("id", attemptId);
    }
    const { data: granted, error: rlErr } = await admin.rpc("acquire_mpesa_token", {
      p_shortcode: config.shortcode, p_capacity: 100, p_refill: 80,
    });
    if (rlErr) log.warn("rate_limit_rpc_err", { error: rlErr.message });
    if (granted === false) {
      await admin.rpc("transition_payment_state", {
        p_attempt_id: attemptId, p_to: "FAILED", p_actor: "system",
        p_payload: { reason: "rate_limited" }, p_failure_reason: "rate_limited",
      });
      await admin.from("mpesa_idempotency_keys").update({
        status: "failed", completed_at: new Date().toISOString(),
        response: { error: "rate_limited" },
      }).eq("idempotency_key", idemKey);
      await trace({ correlationId, invocationId: _invId, attemptId, key: "09_ratelimiter_passed", status: "FAILED", errorCode: "RATE_LIMITED" });
      return fail(429, "RATE_LIMITED", "M-Pesa rate limit reached. Please retry shortly.");
    }
    await trace({ correlationId, invocationId: _invId, attemptId, key: "09_ratelimiter_passed", status: "OK" });

    // ---- Daraja STK push (with retry + per-attempt persistent log) ---
    const phoneMasked = phone.length > 4 ? `****${phone.slice(-4)}` : "****";
    const stkUrl = `${config.env === "production" ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke"}/mpesa/stkpush/v1/processrequest`;
    const MAX_ATTEMPTS = 3;
    const isTransient = (status: number, errCode?: string, errMsg?: string) => {
      if (status >= 500) return true;
      if (status === 408 || status === 429) return true;
      if (errCode === "500.001.1001") return true; // Daraja transient
      if (errMsg && /timeout|network|ECONN|fetch failed|aborted/i.test(errMsg)) return true;
      return false;
    };
    const logAttempt = async (row: Record<string, unknown>) => {
      try {
        await admin.from("mpesa_stk_attempts").insert({
          payment_attempt_id: attemptId, user_id: userId, idempotency_key: idemKey,
          request_id: requestId, correlation_id: correlationId,
          environment: config.env, shortcode: config.shortcode,
          phone_masked: phoneMasked, amount_cents: amount * 100,
          account_reference: accountReference, ...row,
        });
      } catch (e) { log.warn("attempt_log_failed", { error: (e as Error).message }); }
    };

    let stkData: any = null;
    let lastError: { code: string; message: string; status?: number; response?: unknown } | null = null;

    for (let attemptNo = 1; attemptNo <= MAX_ATTEMPTS; attemptNo++) {
      const t0 = Date.now();
      let httpStatus: number | undefined;
      let respJson: any = null;
      let errMsg: string | undefined;
      let errCode: string | undefined;
      try {
        const _oT0 = Date.now();
        const accessToken = await fetchAccessToken(config);
        await trace({ correlationId, invocationId: _invId, attemptId, key: "10_oauth_token_acquired", status: "OK", latencyMs: Date.now() - _oT0, evidence: { attempt_no: attemptNo } });
        const payload = buildSTKPayload(
          config, phone, amount, accountReference,
          "Yalla Mobility Wallet Top-up", MPESA_CALLBACK_URL,
        );
        await trace({ correlationId, invocationId: _invId, attemptId, key: "11_stk_payload_built", status: "OK", evidence: { callback_url: MPESA_CALLBACK_URL } });
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), DARAJA_TIMEOUT_MS);
        try {
          const _dT0 = Date.now();
          await trace({ correlationId, invocationId: _invId, attemptId, key: "12_daraja_request_sent", status: "STARTED", evidence: { attempt_no: attemptNo, url: stkUrl } });
          const r = await fetch(stkUrl, {
            method: "POST",
            headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal: controller.signal,
          });
          httpStatus = r.status;
          respJson = await r.json().catch(() => ({}));
          await trace({ correlationId, invocationId: _invId, attemptId, key: "13_daraja_response_parsed", status: r.ok && !respJson?.errorCode ? "OK" : "FAILED", latencyMs: Date.now() - _dT0, errorCode: respJson?.errorCode, errorMessage: respJson?.errorMessage, evidence: { http_status: r.status } });
          if (!r.ok || respJson?.errorCode) {
            errCode = respJson?.errorCode || `HTTP_${r.status}`;
            errMsg = respJson?.errorMessage || `Daraja HTTP ${r.status}`;
            throw new Error(errMsg);
          }
          stkData = respJson;
        } finally { clearTimeout(timer); }
      } catch (e) {
        errMsg = errMsg || (e as Error)?.message || "Daraja call failed";
        errCode = errCode || "DARAJA_ERROR";
        if (!httpStatus) {
          // Never reached the network — mark the send step as FAILED
          await trace({ correlationId, invocationId: _invId, attemptId, key: "12_daraja_request_sent", status: "FAILED", errorCode: errCode, errorMessage: errMsg });
        }
      }

      const latency = Date.now() - t0;
      const succeeded = !!stkData;
      const willRetry = !succeeded && attemptNo < MAX_ATTEMPTS && isTransient(httpStatus ?? 0, errCode, errMsg);

      await logAttempt({
        attempt_number: attemptNo,
        outcome: succeeded ? "success" : (willRetry ? "transient_failure" : "failure"),
        http_status: httpStatus ?? null,
        daraja_response: respJson,
        merchant_request_id: stkData?.MerchantRequestID ?? null,
        checkout_request_id: stkData?.CheckoutRequestID ?? null,
        error_code: succeeded ? null : (errCode ?? null),
        error_message: succeeded ? null : (errMsg ?? null),
        latency_ms: latency,
        will_retry: willRetry,
      });

      if (succeeded) { lastError = null; break; }
      lastError = { code: errCode ?? "DARAJA_ERROR", message: errMsg ?? "unknown", status: httpStatus, response: respJson };
      log.warn("stk_attempt_failed", { attemptNo, willRetry, errCode, errMsg, httpStatus });
      if (!willRetry) break;
      // exponential backoff w/ jitter: 300ms, 900ms
      const backoff = 300 * Math.pow(3, attemptNo - 1) + Math.floor(Math.random() * 200);
      await new Promise((res) => setTimeout(res, backoff));
    }

    if (!stkData) {
      const msg = lastError?.message || "Daraja call failed";
      await recordBreakerOutcome(admin, false, msg);
      await admin.rpc("transition_payment_state", {
        p_attempt_id: attemptId, p_to: "FAILED", p_actor: "system",
        p_payload: { error: msg, last_response: lastError?.response ?? null, environment: config.env },
        p_failure_reason: msg,
      });
      await admin.from("mpesa_idempotency_keys").update({
        status: "failed", completed_at: new Date().toISOString(),
        response: {
          error: msg,
          error_code: lastError?.code,
          http_status: lastError?.status,
          environment: config.env,
          request_id: requestId,
          correlation_id: correlationId,
          last_response: lastError?.response ?? null,
        },
      }).eq("idempotency_key", idemKey);
      throw new HttpError(502, msg, lastError?.code || "DARAJA_ERROR", {
        environment: config.env,
        request_id: requestId,
        correlation_id: correlationId,
        http_status: lastError?.status,
        last_response: lastError?.response ?? null,
      });
    }

    await recordBreakerOutcome(admin, true);

    // ---- INITIATED -> ACCEPTED ---------------------------------------
    await admin.rpc("transition_payment_state", {
      p_attempt_id: attemptId, p_to: "ACCEPTED", p_actor: "system",
      p_payload: {
        merchant_request_id: stkData.MerchantRequestID,
        checkout_request_id: stkData.CheckoutRequestID,
      },
      p_merchant_request_id: stkData.MerchantRequestID,
      p_checkout_request_id: stkData.CheckoutRequestID,
    });

    // Verified-ledger row. Settlement reads this table, so a lost write means a
    // real payment can never settle its order — the error must never be swallowed.
    // transaction_reference is per-attempt (checkout id) because account_reference
    // (the order number) legitimately repeats across top-up + balance payments and
    // is protected by a unique index.
    const { error: legacyInsertErr } = await admin.from("mpesa_transactions").insert({
      user_id: userId, wallet_id: wallet2.id,
      phone, amount_cents: amount * 100, currency: "KES",
      payment_provider: "mpesa_daraja",
      transaction_reference: stkData.CheckoutRequestID, account_reference: accountReference,
      merchant_request_id: stkData.MerchantRequestID,
      checkout_request_id: stkData.CheckoutRequestID,
      status: "PENDING",
    });
    if (legacyInsertErr) {
      log.error("ledger_row_insert_failed", {
        checkout_request_id: stkData.CheckoutRequestID,
        account_reference: accountReference,
        error: legacyInsertErr.message,
      });
      await stage({
        correlationId, paymentAttemptId: attemptId, stageKey: STAGE.DARAJA_ACCEPTED,
        status: "FAILED", evidence: { ledger_row_insert_failed: legacyInsertErr.message },
      });
    }


    const response = {
      message: "STK Push sent. Check your phone for the M-Pesa prompt.",
      paymentAttemptId: attemptId,
      checkoutRequestId: stkData.CheckoutRequestID,
      merchantRequestId: stkData.MerchantRequestID,
      requestId,
    };

    // Finalise the idempotency record. If this write is lost the key stays
    // "in_flight" and every legitimate replay gets 425 until it expires, so the
    // failure must be visible in logs rather than silently swallowed.
    const { error: idemFinaliseErr } = await admin.from("mpesa_idempotency_keys").update({
      status: "accepted", completed_at: new Date().toISOString(), response,
    }).eq("idempotency_key", idemKey);
    if (idemFinaliseErr) {
      log.error("idempotency_finalise_failed", { idemKey, error: idemFinaliseErr.message });
    }


    await stage({ correlationId, paymentAttemptId: attemptId, stageKey: STAGE.DARAJA_ACCEPTED, status: "OK", evidence: { checkout_request_id: stkData.CheckoutRequestID } });
    await transition({ correlationId, paymentAttemptId: attemptId, fromState: "INITIATED", toState: "DARAJA_ACCEPTED", sourceFunction: "mpesa-stkpush" });
    await trace({ correlationId, invocationId: _invId, attemptId, key: "14_state_transitioned", status: "OK", evidence: { to: "DARAJA_ACCEPTED" } });
    await trace({ correlationId, invocationId: _invId, attemptId, key: "15_response_returned", status: "OK" });
    await finishInvocation({ invocationId: _invId, status: "SUCCEEDED", durationMs: Date.now() - _t0, currentStep: "daraja_accepted", currentState: "DARAJA_ACCEPTED" });
    await computeHealthSnapshot(correlationId, attemptId);
    return ok(response);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const code = (err as { code?: string })?.code ?? "STKPUSH_ERROR";
      await stage({ correlationId, stageKey: STAGE.FUNCTION_ENTERED, status: "FAILED", evidence: { error: msg } });
      await finishInvocation({ invocationId: _invId, status: "FAILED", durationMs: Date.now() - _t0, errorCode: code, errorMessage: msg });
      throw err;
    }
  },
}));
