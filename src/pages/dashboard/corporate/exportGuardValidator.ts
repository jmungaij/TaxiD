/**
 * Server-side idempotency guard for the KYB export pipeline.
 *
 * The client's `InflightExportRegistry` prevents duplicate downloads within a
 * single tab. This module defends the audit log against a stronger threat:
 *
 *   A caller reuses the SAME `request_token` with DIFFERENT filters — either
 *   maliciously (to smuggle a broader export past dedupe) or because of a
 *   token-computation bug. The audit trail must reject this cleanly.
 *
 * The rule is simple: a request_token is a hash of (fmt, ids, filters). If a
 * prior audit row exists with the same token but a canonicalised filter
 * fingerprint that differs, we MUST refuse the export with a 4xx-shaped error
 * and record a `export_audit_log_mismatch` row so the discrepancy is
 * inspectable in the admin trail.
 *
 * Pure module — no React, no supabase — so both the client pre-flight check
 * and future edge-function enforcement can share the same code path and
 * tests.
 */

import type { ExportAuditFilters } from "./exportAuditFilters";

/** Stable, order-insensitive fingerprint of the filter payload only. */
export function canonicalizeFilters(filters: ExportAuditFilters): string {
  return JSON.stringify({
    from: filters.fromDate || "",
    to: filters.toDate || "",
    types: [...filters.docTypes].sort(),
    actions: [...filters.actions].sort(),
  });
}

/** Full-payload fingerprint including fmt + ids — matches computeExportToken input. */
export function canonicalizeGuardPayload(input: {
  fmt: "csv" | "pdf";
  documentIds: string[];
  filters: ExportAuditFilters;
}): string {
  return JSON.stringify({
    fmt: input.fmt,
    ids: [...input.documentIds].sort(),
    filters: JSON.parse(canonicalizeFilters(input.filters)),
  });
}

export type PriorAttempt = {
  request_token: string;
  fmt: "csv" | "pdf";
  documentIds: string[];
  filters: ExportAuditFilters;
};

export type GuardConflict = {
  field: "fmt" | "documentIds" | "filters";
  prior: unknown;
  current: unknown;
  message: string;
};

/**
 * HTTP-style 4xx error thrown when the same token is reused with a
 * different payload. Callers should surface `.status` (409) and `.conflict`
 * verbatim to the audit log so the mismatch is inspectable.
 */
export class ExportTokenConflictError extends Error {
  readonly status = 409;
  readonly code = "export_token_filter_mismatch";
  readonly conflict: GuardConflict;
  readonly token: string;
  constructor(token: string, conflict: GuardConflict) {
    super(`Export token ${token} reused with different ${conflict.field}: ${conflict.message}`);
    this.name = "ExportTokenConflictError";
    this.token = token;
    this.conflict = conflict;
  }
}

/**
 * Compare a fresh submission against the most recent prior attempt that
 * shared the same request_token. Returns `null` when there is no conflict
 * (either no prior, or every field matches). Returns a `GuardConflict`
 * otherwise — the caller decides whether to throw or record.
 */
export function detectTokenConflict(
  prior: PriorAttempt | null,
  current: PriorAttempt,
): GuardConflict | null {
  if (!prior) return null;
  if (prior.request_token !== current.request_token) return null;
  if (prior.fmt !== current.fmt) {
    return {
      field: "fmt",
      prior: prior.fmt,
      current: current.fmt,
      message: `expected ${prior.fmt}, got ${current.fmt}`,
    };
  }
  const priorIds = [...prior.documentIds].sort().join(",");
  const currentIds = [...current.documentIds].sort().join(",");
  if (priorIds !== currentIds) {
    return {
      field: "documentIds",
      prior: prior.documentIds,
      current: current.documentIds,
      message: `document set changed (${prior.documentIds.length} → ${current.documentIds.length})`,
    };
  }
  const priorFilters = canonicalizeFilters(prior.filters);
  const currentFilters = canonicalizeFilters(current.filters);
  if (priorFilters !== currentFilters) {
    return {
      field: "filters",
      prior: prior.filters,
      current: current.filters,
      message: "filter payload does not match the token's original filters",
    };
  }
  return null;
}

/**
 * Convenience wrapper that throws when a conflict is found. Use this from
 * the client pre-flight check and from any future edge function handler.
 */
export function assertTokenReuseValid(
  prior: PriorAttempt | null,
  current: PriorAttempt,
): void {
  const conflict = detectTokenConflict(prior, current);
  if (conflict) throw new ExportTokenConflictError(current.request_token, conflict);
}
