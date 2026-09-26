/**
 * SAFARID API PARTNERS — webhook signature verification & replay.
 *
 * Signature scheme v2 (current):
 *   SAFARID-Signature: t=<unix-seconds>,v1=<hex hmac-sha256>
 *   signed payload  = `${t}.${rawBody}`
 *
 * Verification is constant-time and timestamp-bounded so a captured delivery
 * cannot be replayed against a partner endpoint outside the tolerance window.
 * Everything here runs in the browser via Web Crypto — the console is a test
 * harness, so no partner secret ever leaves the page.
 */

export const DEFAULT_TOLERANCE_SECONDS = 300;

export type VerificationFailure =
  | "missing_header"
  | "malformed_header"
  | "unsupported_version"
  | "timestamp_out_of_tolerance"
  | "signature_mismatch";

export interface VerificationResult {
  valid: boolean;
  failure?: VerificationFailure;
  detail: string;
  expectedSignature?: string;
  providedSignature?: string;
  signedPayloadPreview?: string;
  timestampSkewSeconds?: number;
}

const encoder = new TextEncoder();

const toHex = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

/** Build the header value SAFARID would send for a payload. */
export async function signWebhook(
  secret: string,
  rawBody: string,
  timestampSeconds: number = Math.floor(Date.now() / 1000),
): Promise<{ header: string; timestamp: number; signature: string; signedPayload: string }> {
  const signedPayload = `${timestampSeconds}.${rawBody}`;
  const signature = await hmacSha256Hex(secret, signedPayload);
  return {
    header: `t=${timestampSeconds},v1=${signature}`,
    timestamp: timestampSeconds,
    signature,
    signedPayload,
  };
}

/** Timing-safe hex comparison. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyWebhook(
  secret: string,
  rawBody: string,
  headerValue: string,
  toleranceSeconds: number = DEFAULT_TOLERANCE_SECONDS,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<VerificationResult> {
  if (!headerValue?.trim()) {
    return { valid: false, failure: "missing_header", detail: "No SAFARID-Signature header was supplied. Reject the delivery with 400." };
  }

  const parts = Object.fromEntries(
    headerValue
      .split(",")
      .map((p) => p.trim().split("="))
      .filter((kv) => kv.length === 2) as [string, string][],
  );

  if (!parts.t) {
    return { valid: false, failure: "malformed_header", detail: "Header has no `t=` timestamp element." };
  }
  const versionKeys = Object.keys(parts).filter((k) => /^v\d+$/.test(k));
  if (versionKeys.length === 0) {
    return { valid: false, failure: "malformed_header", detail: "Header carries no signature element (expected `v1=`)." };
  }
  if (!parts.v1) {
    return {
      valid: false,
      failure: "unsupported_version",
      detail: `Only signature version v1 of scheme v2 is accepted; header carried ${versionKeys.join(", ")}.`,
    };
  }

  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp)) {
    return { valid: false, failure: "malformed_header", detail: "`t` is not a unix timestamp in seconds." };
  }

  const skew = nowSeconds - timestamp;
  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = await hmacSha256Hex(secret, signedPayload);

  if (Math.abs(skew) > toleranceSeconds) {
    return {
      valid: false,
      failure: "timestamp_out_of_tolerance",
      detail: `Timestamp is ${skew}s from now, outside the ±${toleranceSeconds}s tolerance. Reject as a replay.`,
      expectedSignature: expected,
      providedSignature: parts.v1,
      signedPayloadPreview: signedPayload.slice(0, 160),
      timestampSkewSeconds: skew,
    };
  }

  if (!safeEqual(expected, parts.v1)) {
    return {
      valid: false,
      failure: "signature_mismatch",
      detail:
        "Signature does not match. The usual causes are: signing the parsed/re-serialised body instead of the raw bytes, " +
        "omitting the `${t}.` prefix, or using a rotated secret.",
      expectedSignature: expected,
      providedSignature: parts.v1,
      signedPayloadPreview: signedPayload.slice(0, 160),
      timestampSkewSeconds: skew,
    };
  }

  return {
    valid: true,
    detail: `Signature valid. Timestamp skew ${skew}s, within the ±${toleranceSeconds}s window.`,
    expectedSignature: expected,
    providedSignature: parts.v1,
    signedPayloadPreview: signedPayload.slice(0, 160),
    timestampSkewSeconds: skew,
  };
}

/** Deterministic sample payload for an event, used to seed the replay console. */
export function samplePayload(event: string, payloadKeys: string[]): string {
  const values: Record<string, unknown> = {
    order_id: "ord_01J8ZKQ4T9V2M6C0EXAMPLE",
    partner_reference: "BOOKING-88213",
    service: "ride",
    total: 2450,
    assignment: { driver: "D-40219", vehicle: "KDG 118X", vehicle_class: "comfort" },
    eta_seconds: 420,
    started_at: "2026-08-25T07:31:04Z",
    completed_at: "2026-08-25T08:02:51Z",
    final_total: 2450,
    reason: "customer_request",
    cancellation_fee: 0,
    amount: 2450,
    method: "mpesa",
    reference: "SJ54K2LM9Q",
    document_id: "doc_01J8ZKR2EXAMPLE",
    kind: "tax_invoice",
    content_hash: "sha256:2f8c9b1e7a4d5c6f0b3a8e1d9c7f4a2b6e0d8c5a3f1b9e7d4c2a6f8b0e3d1c9a",
    exception_id: "rex_01J8ZKS7EXAMPLE",
    severity: "medium",
  };
  return JSON.stringify(
    {
      event,
      sent_at: new Date().toISOString(),
      delivery_id: "whd_01J8ZKT9EXAMPLE",
      data: Object.fromEntries(payloadKeys.map((k) => [k, values[k] ?? null])),
    },
    null,
    2,
  );
}
