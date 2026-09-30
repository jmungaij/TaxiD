// M-Pesa Daraja shared helpers
// Safaricom PayBill 4573823

export interface DarajaConfig {
  consumerKey: string;
  consumerSecret: string;
  passkey: string;
  shortcode: string;
  env: string;
}

/** Owner law: every shilling collected is paid into TaxiD PayBill 4573823. */
export const YALLA_PAYBILL = "4573823";

import { createClient } from "npm:@supabase/supabase-js@2";

let cached: { at: number; cfg: DarajaConfig } | null = null;

/**
 * Loads Daraja credentials saved through the super-admin Payment Credentials
 * form (payment_gateway_settings). Values never leave the backend.
 */
export async function getConfig(): Promise<DarajaConfig> {
  if (cached && Date.now() - cached.at < 60_000) return cached.cfg;
  const env = Deno.env.get("MPESA_ENV") || "production";
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data } = await admin.from("payment_gateway_settings")
    .select("consumer_key, consumer_secret, passkey, short_code")
    .eq("gateway", "mpesa").eq("environment", env).maybeSingle();
  if (data?.short_code && data.short_code !== YALLA_PAYBILL) {
    console.error("Saved short code differs — forcing PayBill 4573823");
  }
  const cfg: DarajaConfig = {
    consumerKey: data?.consumer_key || Deno.env.get("MPESA_CONSUMER_KEY") || "",
    consumerSecret: data?.consumer_secret || Deno.env.get("MPESA_CONSUMER_SECRET") || "",
    passkey: data?.passkey || Deno.env.get("MPESA_PASSKEY") || "",
    shortcode: YALLA_PAYBILL,
    env,
  };
  cached = { at: Date.now(), cfg };
  return cfg;
}

export function getBaseUrl(env: string): string {
  return env === "production"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";
}

export function getTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

export function generatePassword(timestamp: string, shortcode: string, passkey: string): string {
  return btoa(`${shortcode}${passkey}${timestamp}`);
}

export function formatPhoneNumber(phone: string): string {
  const cleaned = phone.replace(/[\s\-]/g, "");
  if (cleaned.startsWith("254")) return cleaned;
  if (cleaned.startsWith("0")) return `254${cleaned.slice(1)}`;
  if (cleaned.startsWith("+254")) return cleaned.slice(1);
  if (/^[17]/.test(cleaned)) return `254${cleaned}`;
  throw new Error(`Invalid phone number format: ${phone}`);
}

export async function fetchAccessToken(config: DarajaConfig): Promise<string> {
  const auth = btoa(`${config.consumerKey}:${config.consumerSecret}`);
  const url = `${getBaseUrl(config.env)}/oauth/v1/generate?grant_type=client_credentials`;
  const res = await fetch(url, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!res.ok) throw new Error(`OAuth token fetch failed: ${res.status}`);
  const data = await res.json();
  if (!data.access_token) throw new Error("No access_token in OAuth response");
  return data.access_token;
}

export interface STKPayload {
  BusinessShortCode: string;
  Password: string;
  Timestamp: string;
  TransactionType: string;
  Amount: number;
  PartyA: string;
  PartyB: string;
  PhoneNumber: string;
  CallBackURL: string;
  AccountReference: string;
  TransactionDesc: string;
}

export function buildSTKPayload(
  config: DarajaConfig,
  phone: string,
  amount: number,
  accountReference: string,
  description: string,
  callbackUrl: string
): STKPayload {
  const ts = getTimestamp();
  return {
    BusinessShortCode: config.shortcode,
    Password: generatePassword(ts, config.shortcode, config.passkey),
    Timestamp: ts,
    TransactionType: "CustomerPayBillOnline",
    Amount: Math.round(amount),
    PartyA: phone,
    PartyB: config.shortcode,
    PhoneNumber: phone,
    CallBackURL: callbackUrl,
    AccountReference: accountReference,
    TransactionDesc: description,
  };
}

/**
 * Hard per-transaction ceiling for a single M-Pesa STK push, per paying
 * MSISDN. Safaricom PayBill 4573823 is configured for a 250,000 KES maximum
 * per transaction per phone number; larger settlements must be split or paid
 * by bank transfer.
 */
export const MPESA_MAX_TXN_KES = 250_000;

export interface AmountLimitResult {
  ok: boolean;
  code?: "AMOUNT_LIMIT_EXCEEDED" | "AMOUNT_INVALID";
  message?: string;
}

/** Validates a KES amount against the per-transaction, per-MSISDN ceiling. */
export function checkTransactionLimit(amountKes: number, phone?: string): AmountLimitResult {
  if (!Number.isFinite(amountKes) || amountKes < 1) {
    return { ok: false, code: "AMOUNT_INVALID", message: "Amount must be at least KSh 1." };
  }
  if (amountKes > MPESA_MAX_TXN_KES) {
    const tail = phone ? ` for ${phone.slice(-4).padStart(phone.length, "*")}` : "";
    return {
      ok: false,
      code: "AMOUNT_LIMIT_EXCEEDED",
      message:
        `M-Pesa allows a maximum of KSh ${MPESA_MAX_TXN_KES.toLocaleString("en-KE")} per transaction per phone number${tail}. ` +
        "Split the payment into multiple transactions or contact us for a bank transfer.",
    };
  }
  return { ok: true };
}

/**
 * Server-side confirmation of an STK result directly with Safaricom.
 * Daraja callbacks are unsigned, so a callback claiming success is only
 * trusted once the STK Query API independently reports ResultCode 0.
 * Returns "confirmed", "not_confirmed" (Daraja reports a different result)
 * or "unavailable" (query could not be completed — retry via reconciliation).
 */
export async function confirmStkResult(checkoutRequestId: string): Promise<"confirmed" | "not_confirmed" | "unavailable"> {
  const config = await getConfig();
  if (!config.consumerKey || !config.consumerSecret || !config.passkey) return "unavailable";
  try {
    const token = await fetchAccessToken(config);
    const ts = getTimestamp();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    const r = await fetch(`${getBaseUrl(config.env)}/mpesa/stkpushquery/v1/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        BusinessShortCode: config.shortcode,
        Password: generatePassword(ts, config.shortcode, config.passkey),
        Timestamp: ts,
        CheckoutRequestID: checkoutRequestId,
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const j = await r.json().catch(() => ({})) as { ResultCode?: string | number; errorCode?: string };
    if (!r.ok || j.ResultCode === undefined) return "unavailable";
    return String(j.ResultCode) === "0" ? "confirmed" : "not_confirmed";
  } catch {
    return "unavailable";
  }
}
