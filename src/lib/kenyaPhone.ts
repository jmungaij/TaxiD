// Single source of truth for Kenyan (Safaricom) phone handling used by the
// M-Pesa flow. All M-Pesa diagnostic forms and payload builders should call
// through here so the app has one representation of a valid MSISDN.

/**
 * The MSISDN used by the M-Pesa Diagnostics screen for STK dry-runs.
 * Backed by VITE_MPESA_TEST_MSISDN so ops can rotate it without a code change;
 * defaults to the number connected to the live Paybill (4573823).
 */
export const DEFAULT_MPESA_TEST_MSISDN: string =
  (import.meta.env.VITE_MPESA_TEST_MSISDN as string | undefined)?.trim() ||
  "0712345678";

/** Strip whitespace, dashes and parentheses. */
function stripSeparators(raw: string): string {
  return raw.replace(/[\s\-()]/g, "");
}

/**
 * Normalize a Kenyan mobile number to Safaricom's `2547XXXXXXXX` /
 * `2541XXXXXXXX` MSISDN form. Returns `null` when the input can't be parsed
 * as a valid Kenyan mobile number.
 */
export function normalizeKenyanMsisdn(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = stripSeparators(String(raw));
  if (s.startsWith("+")) s = s.slice(1);
  if (s.startsWith("00")) s = s.slice(2);
  if (s.startsWith("254")) {
    // ok
  } else if (s.startsWith("0")) {
    s = `254${s.slice(1)}`;
  } else if (/^[17]\d{8}$/.test(s)) {
    s = `254${s}`;
  } else {
    return null;
  }
  // Safaricom / Airtel / Telkom mobile: 2547XXXXXXXX or 2541XXXXXXXX (12 digits)
  return /^254[17]\d{8}$/.test(s) ? s : null;
}

export function isValidKenyanMsisdn(raw: string | null | undefined): boolean {
  return normalizeKenyanMsisdn(raw) !== null;
}

/** Human-friendly display form: `0712 345 678`. */
export function formatKenyanMsisdnDisplay(raw: string): string {
  const m = normalizeKenyanMsisdn(raw);
  if (!m) return raw;
  const local = `0${m.slice(3)}`;
  return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
}
