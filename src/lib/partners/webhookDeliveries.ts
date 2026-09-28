/**
 * TaxiD API PARTNERS — webhook delivery forensics.
 *
 * Reads the append-only `partner_api_webhook_deliveries` ledger. One row per
 * *attempt*, so a delivery that was retried five times appears five times and
 * the retry chain is reconstructable by `delivery_id`. Failure categories are
 * recorded by the dispatcher, never inferred in the browser.
 */

import { supabase } from "@/integrations/supabase/client";
import type { ApiEnvironment } from "./devPortal";

export type DeliveryStatus = "pending" | "delivered" | "failed" | "dead_letter";

export type FailureCategory =
  | "none"
  | "signature_mismatch"
  | "timestamp_out_of_tolerance"
  | "malformed_header"
  | "missing_header"
  | "duplicate_event"
  | "http_4xx"
  | "http_5xx"
  | "connection_error"
  | "timeout"
  | "tls_error"
  | "payload_rejected";

export interface WebhookDeliveryRow {
  id: string;
  partner_id: string;
  credential_id: string | null;
  environment: ApiEnvironment;
  event_type: string;
  event_id: string;
  delivery_id: string;
  correlation_id: string;
  endpoint_url: string;
  attempt: number;
  max_attempts: number;
  status: DeliveryStatus;
  failure_category: FailureCategory | null;
  http_status: number | null;
  response_ms: number | null;
  signature_version: string;
  signature_valid: boolean | null;
  timestamp_skew_seconds: number | null;
  payload_preview: string | null;
  error_detail: string | null;
  next_retry_at: string | null;
  created_at: string;
  delivered_at: string | null;
}

/** Operator-facing explanation of each failure category and its remedy. */
export const FAILURE_GUIDANCE: Record<FailureCategory, { label: string; cause: string; remedy: string }> = {
  none: {
    label: "No failure",
    cause: "The endpoint accepted the delivery with a 2xx response.",
    remedy: "Nothing to do.",
  },
  signature_mismatch: {
    label: "Signature mismatch",
    cause: "Your endpoint recomputed a different HMAC to the one in TaxiD-Signature.",
    remedy: "Sign the raw request bytes with the `${t}.` prefix and the current secret. Re-serialising parsed JSON is the most common cause.",
  },
  timestamp_out_of_tolerance: {
    label: "Timestamp out of tolerance",
    cause: "The `t` element was outside the ±300s replay window when verified.",
    remedy: "Synchronise your clock with NTP and verify before any slow work in the handler.",
  },
  malformed_header: {
    label: "Malformed signature header",
    cause: "The TaxiD-Signature header could not be parsed into `t` and `v1` elements.",
    remedy: "Parse the header as comma-separated key=value pairs rather than by fixed offsets.",
  },
  missing_header: {
    label: "Missing signature header",
    cause: "The endpoint reported no signature header on the request.",
    remedy: "Check for a proxy or WAF that strips non-standard headers before your service.",
  },
  duplicate_event: {
    label: "Duplicate event",
    cause: "The endpoint rejected an event id it had already processed.",
    remedy: "Expected under at-least-once delivery — return 200 for duplicates and de-duplicate on `event_id`.",
  },
  http_4xx: {
    label: "Rejected (4xx)",
    cause: "The endpoint returned a client error, so the dispatcher will not keep retrying indefinitely.",
    remedy: "Inspect the response body captured in the error detail and fix validation on your side.",
  },
  http_5xx: {
    label: "Endpoint error (5xx)",
    cause: "The endpoint returned a server error.",
    remedy: "Retries continue with exponential backoff. Check your own logs at the correlation ID.",
  },
  connection_error: {
    label: "Connection error",
    cause: "The dispatcher could not establish a TCP connection.",
    remedy: "Confirm DNS, that the host is reachable from the public internet, and that TaxiD egress is allow-listed.",
  },
  timeout: {
    label: "Timeout",
    cause: "The endpoint did not respond within the delivery timeout.",
    remedy: "Acknowledge with 2xx immediately and process asynchronously. Verification must be fast.",
  },
  tls_error: {
    label: "TLS error",
    cause: "The TLS handshake failed — usually an expired or incomplete certificate chain.",
    remedy: "Serve the full chain over TLS 1.2+ with a certificate valid for the endpoint hostname.",
  },
  payload_rejected: {
    label: "Payload rejected",
    cause: "The endpoint accepted the signature but rejected the payload schema.",
    remedy: "Treat unknown fields as additive and pin to the API version in your integration settings.",
  },
};

export interface DeliveryFilter {
  environments: ApiEnvironment[];
  statuses: DeliveryStatus[];
  /** Free-text match against correlation, delivery, event id or endpoint. */
  search: string;
}

export function defaultDeliveryFilter(): DeliveryFilter {
  return { environments: ["sandbox", "production"], statuses: [], search: "" };
}

export async function fetchWebhookDeliveries(partnerId: string, limit = 200): Promise<WebhookDeliveryRow[]> {
  const { data, error } = await supabase
    .from("partner_api_webhook_deliveries")
    .select("*")
    .eq("partner_id", partnerId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as WebhookDeliveryRow[];
}

export function filterDeliveries(rows: WebhookDeliveryRow[], f: DeliveryFilter): WebhookDeliveryRow[] {
  const q = f.search.trim().toLowerCase();
  return rows.filter((r) => {
    if (f.environments.length && !f.environments.includes(r.environment)) return false;
    if (f.statuses.length && !f.statuses.includes(r.status)) return false;
    if (!q) return true;
    return [r.correlation_id, r.delivery_id, r.event_id, r.event_type, r.endpoint_url]
      .join(" ")
      .toLowerCase()
      .includes(q);
  });
}

export interface DeliverySummary {
  attempts: number;
  delivered: number;
  failed: number;
  deadLettered: number;
  retried: number;
  successRate: number;
  topFailures: { category: FailureCategory; count: number }[];
}

export function summariseDeliveries(rows: WebhookDeliveryRow[]): DeliverySummary {
  const delivered = rows.filter((r) => r.status === "delivered").length;
  const failed = rows.filter((r) => r.status === "failed").length;
  const deadLettered = rows.filter((r) => r.status === "dead_letter").length;
  const counts = new Map<FailureCategory, number>();
  for (const r of rows) {
    if (!r.failure_category || r.failure_category === "none") continue;
    counts.set(r.failure_category, (counts.get(r.failure_category) ?? 0) + 1);
  }
  const terminal = delivered + failed + deadLettered;
  return {
    attempts: rows.length,
    delivered,
    failed,
    deadLettered,
    retried: rows.filter((r) => r.attempt > 1).length,
    successRate: terminal > 0 ? delivered / terminal : 0,
    topFailures: [...counts.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count),
  };
}

/** Group attempts into retry chains, newest chain first. */
export function retryChains(rows: WebhookDeliveryRow[]): { deliveryId: string; attempts: WebhookDeliveryRow[] }[] {
  const m = new Map<string, WebhookDeliveryRow[]>();
  for (const r of rows) m.set(r.delivery_id, [...(m.get(r.delivery_id) ?? []), r]);
  return [...m.entries()]
    .map(([deliveryId, attempts]) => ({
      deliveryId,
      attempts: attempts.slice().sort((a, b) => a.attempt - b.attempt),
    }))
    .sort((a, b) =>
      (b.attempts.at(-1)?.created_at ?? "").localeCompare(a.attempts.at(-1)?.created_at ?? ""),
    );
}
