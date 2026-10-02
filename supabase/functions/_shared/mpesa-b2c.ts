import { setting, primeGatewaySettings } from "./gateway-settings.ts";
import { createHmac, timingSafeEqual } from "node:crypto";
// M-Pesa Daraja B2C (business → customer) helpers.
//
// This is the SAME authoritative Daraja integration used for collections
// (`_shared/mpesa.ts` — OAuth, shortcode, environment); B2C only adds the
// initiator identity and the encrypted security credential that Safaricom
// requires for disbursements. There is exactly one payment infrastructure:
// beneficiaries differ (driver / fleet owner), the rail does not.

import { fetchAccessToken, getBaseUrl, getConfig, formatPhoneNumber } from "./mpesa.ts";

export interface B2CConfig {
  initiatorName: string;
  securityCredential: string;
  shortcode: string;
  resultUrl: string;
  timeoutUrl: string;
  env: string;
}

export interface B2CConfigResult {
  ok: boolean;
  missing: string[];
  config: B2CConfig | null;
}

/**
 * Per-deployment callback token. Safaricom cannot sign B2C results, so the
 * ResultURL carries an unguessable token derived from a server-only secret;
 * the receiver refuses any result that does not present it.
 */
export function b2cCallbackToken(): string {
  const secret = Deno.env.get("MPESA_B2C_CALLBACK_TOKEN")?.trim()
    || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!secret) return "";
  return createHmac("sha256", secret).update("yalla:mpesa-b2c-result:v1").digest("hex");
}

function withToken(u: string): string {
  const t = b2cCallbackToken();
  if (!t) return u;
  return `${u}${u.includes("?") ? "&" : "?"}t=${t}`;
}

function functionsBase(): string {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  return `${url.replace(/\/$/, "")}/functions/v1`;
}

/**
 * Resolve B2C configuration. Fails CLOSED: when the initiator name or the
 * security credential is absent we cannot legitimately disburse, and the
 * caller must refuse with PROVIDER_CONFIGURATION_REQUIRED rather than
 * pretending a payout happened.
 */
export async function getB2CConfig(): Promise<B2CConfigResult> {
  await primeGatewaySettings();
  const base = await getConfig();
  // Safaricom's portal/test-credential tooling frequently emits the encrypted
  // password wrapped in quotes and with embedded newlines. Those characters are
  // not part of the base64 credential and make Daraja answer 2001 (invalid
  // initiator information), so normalise them here — once, centrally.
  const initiatorName = setting("MPESA_B2C_INITIATOR_NAME")?.trim() ?? "";
  const securityCredential = (setting("MPESA_B2C_SECURITY_CREDENTIAL") ?? "")
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .replace(/\s+/g, "");
  // Payouts NEVER leave the collections paybill. Operators draw against their own
  // wallet balance, and the money physically leaves a dedicated B2C (payouts)
  // short code. There is deliberately no fallback to the collections shortcode:
  // silently reusing it would make the paybill look like an operator float.
  const shortcode = setting("MPESA_B2C_SHORTCODE")?.trim() ?? "";

  const missing: string[] = [];
  if (!initiatorName) missing.push("MPESA_B2C_INITIATOR_NAME");
  if (!securityCredential) missing.push("MPESA_B2C_SECURITY_CREDENTIAL");
  // The security credential is the initiator password encrypted with Safaricom's
  // public certificate — a long base64 blob (~340+ chars). A short value, or the
  // consumer secret pasted by mistake, can never authorise a payout: refuse here
  // rather than letting Daraja answer 2001 mid-disbursement.
  else if (securityCredential.length < 128 || securityCredential === (base.consumerSecret ?? "").trim()) {
    missing.push("MPESA_B2C_SECURITY_CREDENTIAL (invalid: expected the encrypted initiator credential, not the consumer secret)");
  }
  if (!base.consumerKey) missing.push("MPESA_CONSUMER_KEY");
  if (!base.consumerSecret) missing.push("MPESA_CONSUMER_SECRET");
  if (!shortcode) {
    missing.push("MPESA_B2C_SHORTCODE (dedicated payouts short code — the collections paybill is not a payout source)");
  } else if (shortcode === (base.shortcode ?? "").trim()) {
    missing.push("MPESA_B2C_SHORTCODE (invalid: must not be the collections paybill; operator withdrawals are funded from their own wallet via a dedicated payouts short code)");
  }

  if (missing.length > 0) return { ok: false, missing, config: null };

  return {
    ok: true,
    missing: [],
    config: {
      initiatorName,
      securityCredential,
      shortcode,
      env: base.env,
      resultUrl: withToken(Deno.env.get("MPESA_B2C_RESULT_URL")?.trim() || `${functionsBase()}/mpesa-b2c-result`),
      timeoutUrl: withToken(Deno.env.get("MPESA_B2C_TIMEOUT_URL")?.trim() || `${functionsBase()}/mpesa-b2c-result`),
    },
  };
}

/**
 * Safaricom B2C transaction limits (Daraja B2C v3 documentation).
 * Enforced BEFORE submission so a doomed request never leaves an ambiguous
 * provider leg behind.
 */
export const B2C_MIN_AMOUNT_KES = 10;
export const B2C_MAX_AMOUNT_KES = 250_000;

/** Authoritative meaning of Daraja B2C ResultCodes (callback layer). */
export const B2C_RESULT_CODES: Record<string, { retryable: boolean; meaning: string }> = {
  "0": { retryable: false, meaning: "The service request is processed successfully." },
  "1": { retryable: true, meaning: "Insufficient balance in the B2C Utility account." },
  "2": { retryable: false, meaning: "Declined: amount below the allowed B2C minimum." },
  "3": { retryable: false, meaning: "Declined: amount above the allowed B2C maximum." },
  "4": { retryable: false, meaning: "Declined: would exceed the daily transfer limit." },
  "8": { retryable: false, meaning: "Declined: would exceed the maximum customer balance." },
  "11": { retryable: true, meaning: "The debit party (B2C account) is not active." },
  "21": { retryable: false, meaning: "Initiator lacks the ORG B2C API initiator role." },
  "2001": { retryable: false, meaning: "Initiator information is invalid (username, password or certificate)." },
  "2006": { retryable: true, meaning: "Declined by account rule: B2C account status disallows the transaction." },
  "2028": { retryable: false, meaning: "PartyA shortcode is not permitted to perform B2C payments." },
  "2040": { retryable: false, meaning: "Recipient is not a registered M-PESA customer." },
  "8006": { retryable: false, meaning: "The API user security credential is locked." },
  "SFC_IC0003": { retryable: false, meaning: "The recipient MSISDN does not exist on M-PESA." },
};

export function describeB2CResultCode(code: string | null): { retryable: boolean; meaning: string } {
  if (code == null) return { retryable: true, meaning: "No result code supplied by the provider." };
  return B2C_RESULT_CODES[code] ?? { retryable: false, meaning: `Unmapped provider result code ${code}.` };
}


export interface B2CSubmission {
  httpStatus: number;
  accepted: boolean;
  conversationId: string | null;
  originatorConversationId: string | null;
  responseCode: string | null;
  responseDescription: string | null;
  raw: Record<string, unknown>;
}

/**
 * Submit a B2C payment request. A 200/`ResponseCode: 0` is a SUBMISSION
 * ACKNOWLEDGEMENT ONLY — never treat it as a completed disbursement. The
 * authoritative outcome arrives on the ResultURL callback.
 */
export async function submitB2C(args: {
  amount: number;
  msisdn: string;
  originatorConversationId: string;
  remarks: string;
  occasion?: string;
}): Promise<B2CSubmission> {
  const cfg = await getB2CConfig();
  if (!cfg.ok || !cfg.config) throw new Error(`B2C_NOT_CONFIGURED:${cfg.missing.join(",")}`);
  const c = cfg.config;
  const base = await getConfig();

  // Fail closed on provider-documented limits before any network call.
  const amount = Math.round(args.amount);
  if (!Number.isFinite(amount) || amount < B2C_MIN_AMOUNT_KES) {
    throw new Error(`B2C_AMOUNT_BELOW_MINIMUM:${B2C_MIN_AMOUNT_KES}`);
  }
  if (amount > B2C_MAX_AMOUNT_KES) {
    throw new Error(`B2C_AMOUNT_ABOVE_MAXIMUM:${B2C_MAX_AMOUNT_KES}`);
  }
  const msisdn = formatPhoneNumber(args.msisdn);
  if (!/^254[17]\d{8}$/.test(msisdn)) throw new Error(`B2C_INVALID_MSISDN`);

  // Daraja expects an alphanumeric OriginatorConversationID; it is our
  // double-disbursement guard, so it stays derived 1:1 from the payout id.
  const originatorConversationId = args.originatorConversationId.replace(/[^A-Za-z0-9]/g, "").slice(0, 32);
  // Remarks must be 2..100 chars per the B2C v3 contract.
  const remarks = (args.remarks || "Fleet owner payout").slice(0, 100).padEnd(2, ".");

  const token = await fetchAccessToken(base);

  const payload: Record<string, unknown> = {
    OriginatorConversationID: originatorConversationId,
    InitiatorName: c.initiatorName,
    SecurityCredential: c.securityCredential,
    CommandID: "BusinessPayment",
    Amount: amount,
    PartyA: c.shortcode,
    PartyB: msisdn,
    Remarks: remarks,
    QueueTimeOutURL: c.timeoutUrl,
    ResultURL: c.resultUrl,
  };
  const occasion = (args.occasion ?? "").trim().slice(0, 100);
  if (occasion) payload.Occassion = occasion; // optional; Safaricom's documented spelling

  const res = await fetch(`${getBaseUrl(c.env)}/mpesa/b2c/v3/paymentrequest`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(text); } catch { json = { raw: text }; }

  return {
    httpStatus: res.status,
    accepted: res.ok && String(json.ResponseCode ?? "") === "0",
    conversationId: (json.ConversationID as string) ?? null,
    originatorConversationId: (json.OriginatorConversationID as string) ?? originatorConversationId,
    responseCode: json.ResponseCode != null
      ? String(json.ResponseCode)
      : (json.errorCode != null ? String(json.errorCode) : null),
    responseDescription: (json.ResponseDescription as string) ?? (json.errorMessage as string) ?? null,
    // Credentials are never echoed back into persisted evidence.
    raw: json,
  };
}


export interface NormalisedB2CResult {
  conversationId: string | null;
  originatorConversationId: string | null;
  resultCode: string | null;
  resultDesc: string | null;
  providerTransactionId: string | null;
  amount: number | null;
  recipient: string | null;
  transactedAt: string | null;
  isTimeout: boolean;
}

function paramMap(list: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const items = Array.isArray(list) ? list : (list as any)?.ResultParameter ?? [];
  for (const it of Array.isArray(items) ? items : [items]) {
    if (it && typeof it === "object" && "Key" in (it as any)) {
      out[String((it as any).Key)] = (it as any).Value;
    }
  }
  return out;
}

/** Parse Safaricom's B2C Result / QueueTimeout body into our payment evidence shape. */
export function normaliseB2CResult(body: Record<string, unknown>): NormalisedB2CResult {
  const result = (body.Result ?? body) as Record<string, unknown>;
  const params = paramMap((result.ResultParameters as any)?.ResultParameter ?? result.ResultParameters);
  const recipientRaw = params.ReceiverPartyPublicName ?? params.ReceiverParty ?? null;
  const amountRaw = params.TransactionAmount ?? params.Amount ?? null;
  const dateRaw = params.TransactionCompletedDateTime ?? null;

  let transactedAt: string | null = null;
  if (dateRaw) {
    // Safaricom format: 03.09.2026 16:12:55
    const m = String(dateRaw).match(/^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2}):(\d{2})$/);
    transactedAt = m
      ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4] - 3, +m[5], +m[6])).toISOString()
      : null;
  }

  const resultCode = result.ResultCode != null ? String(result.ResultCode) : null;
  return {
    conversationId: (result.ConversationID as string) ?? null,
    originatorConversationId: (result.OriginatorConversationID as string) ?? null,
    resultCode,
    resultDesc: (result.ResultDesc as string) ?? null,
    providerTransactionId: (result.TransactionID as string)
      ?? (params.TransactionReceipt as string)
      ?? null,
    amount: amountRaw != null ? Number(amountRaw) : null,
    recipient: recipientRaw ? String(recipientRaw) : null,
    transactedAt,
    isTimeout: resultCode == null || String(result.ResultDesc ?? "").toLowerCase().includes("timeout"),
  };
}

/** Constant-time check of the token presented on the callback URL. */
export function verifyB2CCallbackToken(presented: string | null): boolean {
  const expected = b2cCallbackToken();
  if (!expected || !presented || presented.length !== expected.length) return false;
  return timingSafeEqual(new TextEncoder().encode(presented), new TextEncoder().encode(expected));
}
