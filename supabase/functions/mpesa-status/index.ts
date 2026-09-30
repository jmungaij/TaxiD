// M-Pesa STK Push Status Query (hardened).
// ------------------------------------------------------------------
// - JWT required (own transaction OR admin/finance can look up any)
// - 30 queries / minute / user in-memory rate limit
// - Immutable audit trail in payment_audit_logs_v2
// - Circuit-breaker aware (short-circuits when breaker is OPEN)
// - Normalized response shape
import { z } from "npm:zod@3";
import { withRequest, ok, HttpError } from "../_shared/framework.ts";
import { getConfig, getBaseUrl, generatePassword, getTimestamp, fetchAccessToken } from "../_shared/mpesa.ts";

const Body = z.object({ checkout_request_id: z.string().min(1).max(200) });

const rl = new Map<string, number[]>();
function checkRate(id: string, max = 30, windowMs = 60_000): boolean {
  const now = Date.now();
  const arr = (rl.get(id) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= max) return false;
  arr.push(now); rl.set(id, arr); return true;
}

Deno.serve(withRequest<z.infer<typeof Body>>({
  name: "mpesa-status",
  auth: true,
  schema: Body,
  handler: async ({ body, user, admin, log, requestId, correlationId }) => {
    if (!user) throw new HttpError(401, "unauthorized", "UNAUTHORIZED");
    if (!checkRate(user.id)) throw new HttpError(429, "rate_limited: 30/min", "RATE_LIMITED");

    // RBAC: owner OR privileged
    const [{ data: isAdmin }, { data: isFinance }, { data: isSuper }] = await Promise.all([
      admin.rpc("has_role", { _user_id: user.id, _role: "admin" }),
      admin.rpc("has_role", { _user_id: user.id, _role: "finance_admin" }),
      admin.rpc("has_role", { _user_id: user.id, _role: "super_admin" }),
    ]);
    const privileged = !!(isAdmin || isFinance || isSuper);

    const q = admin.from("mpesa_transactions")
      .select("id,user_id,merchant_request_id,phone,amount_cents,status,mpesa_receipt,result_code,result_desc")
      .eq("checkout_request_id", body.checkout_request_id);
    const { data: mTxn } = privileged
      ? await q.maybeSingle()
      : await q.eq("user_id", user.id).maybeSingle();
    if (!mTxn) throw new HttpError(404, "transaction_not_found", "NOT_FOUND");

    // Circuit breaker (see slice 1)
    const { data: cb } = await admin.from("payment_circuit_breakers")
      .select("state,opened_at").eq("provider", "MPESA").maybeSingle();
    if (cb?.state === "OPEN") {
      throw new HttpError(503, "provider_unavailable: breaker OPEN", "CIRCUIT_OPEN");
    }

    // Attempt lookup for audit context
    const { data: attempt } = await admin.from("payment_attempts")
      .select("id,state").eq("checkout_request_id", body.checkout_request_id).maybeSingle();

    let darajaResponse: Record<string, unknown> | null = null;
    let httpStatus = 0;
    try {
      const config = await getConfig();
      const ts = getTimestamp();
      const password = generatePassword(ts, config.shortcode, config.passkey);
      const token = await fetchAccessToken(config);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15_000);
      const r = await fetch(`${getBaseUrl(config.env)}/mpesa/stkpushquery/v1/query`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          BusinessShortCode: config.shortcode, Password: password, Timestamp: ts,
          CheckoutRequestID: body.checkout_request_id,
        }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      httpStatus = r.status;
      darajaResponse = await r.json().catch(() => ({}));
    } catch (e) {
      log.warn("daraja_query_failed", { error: (e as Error).message });
    }

    // Immutable audit
    await admin.from("payment_audit_logs_v2").insert({
      payment_attempt_id: attempt?.id ?? null,
      actor: privileged ? `admin:${user.id}` : `user:${user.id}`,
      actor_user_id: user.id,
      action: "status_query",
      request_id: requestId,
      correlation_id: correlationId,
      payload: {
        checkout_request_id: body.checkout_request_id,
        local_status: mTxn.status,
        http_status: httpStatus,
        response: darajaResponse,
      },
    });

    return ok({
      ok: true,
      transaction: {
        id: mTxn.id,
        status: mTxn.status,
        amount_cents: mTxn.amount_cents,
        mpesa_receipt: mTxn.mpesa_receipt,
        result_code: mTxn.result_code,
        result_desc: mTxn.result_desc,
      },
      attempt_state: attempt?.state ?? null,
      daraja: darajaResponse,
      request_id: requestId,
      correlation_id: correlationId,
    });
  },
}));
