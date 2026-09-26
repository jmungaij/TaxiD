/**
 * Idempotency for the KYB audit-log export pipeline.
 *
 * Repeated "Retry export" clicks with the same parameters must NOT generate
 * duplicate downloads or produce inconsistent results. We achieve this in
 * two layers:
 *
 *   1. `computeExportToken` — a stable, deterministic token derived from the
 *      export format, the target document ids, and the applied filters. The
 *      same inputs always yield the same token so client, server, and audit
 *      log agree on what "the same request" means.
 *
 *   2. `InflightExportRegistry` — a per-tab in-memory guard that prevents a
 *      second concurrent submission of the same token from starting until
 *      the first one resolves, and short-circuits repeats within a small
 *      dedupe window (default 3s) by replaying the first result. This gives
 *      the audit log a single row per user intent instead of one row per
 *      button click.
 *
 * Pure module — no React, no supabase — so it can be exhaustively unit
 * tested without any harness.
 */

export type TokenInput = {
  fmt: "csv" | "pdf";
  documentIds: string[];
  filters: {
    fromDate: string;
    toDate: string;
    docTypes: string[];
    actions: string[];
  };
};

/**
 * Canonicalise the input into a stable string. Arrays are sorted so
 * `["a","b"]` and `["b","a"]` produce the same token — order of selection
 * in the UI must never split retries into distinct requests.
 */
export function canonicalizeTokenInput(input: TokenInput): string {
  const norm = {
    fmt: input.fmt,
    ids: [...input.documentIds].sort(),
    from: input.filters.fromDate || "",
    to: input.filters.toDate || "",
    types: [...input.filters.docTypes].sort(),
    actions: [...input.filters.actions].sort(),
  };
  return JSON.stringify(norm);
}

/** Non-crypto FNV-1a 32-bit hash — deterministic across browsers, no deps. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function computeExportToken(input: TokenInput): string {
  return `exp_${input.fmt}_${fnv1a(canonicalizeTokenInput(input))}`;
}

type Entry<T> =
  | { status: "inflight"; promise: Promise<T>; at: number }
  | { status: "done"; result: T; at: number };

/**
 * Per-tab dedupe registry. Two guarantees:
 *   - concurrent duplicate submissions share the same promise (no double POST)
 *   - a repeat within `dedupeMs` after success returns the cached result
 *     (retry button spam does not re-run the query)
 *
 * Failures are NOT cached — a real retry after a failure is always allowed
 * because that is the whole point of the Retry button.
 */
export class InflightExportRegistry<T = unknown> {
  private map = new Map<string, Entry<T>>();
  constructor(private dedupeMs: number = 3000, private now: () => number = () => Date.now()) {}

  /**
   * Run `producer` for `token`, or return the in-flight/cached result if
   * the same token has been submitted very recently.
   */
  async run(token: string, producer: () => Promise<T>): Promise<{ result: T; deduped: boolean }> {
    const existing = this.map.get(token);
    const t = this.now();
    if (existing) {
      if (existing.status === "inflight") {
        const result = await existing.promise;
        return { result, deduped: true };
      }
      if (existing.status === "done" && t - existing.at <= this.dedupeMs) {
        return { result: existing.result, deduped: true };
      }
    }
    const promise = producer();
    this.map.set(token, { status: "inflight", promise, at: t });
    try {
      const result = await promise;
      this.map.set(token, { status: "done", result, at: this.now() });
      return { result, deduped: false };
    } catch (e) {
      this.map.delete(token); // never cache failures
      throw e;
    }
  }

  /** Test-only: current entry status for a token. */
  peek(token: string): Entry<T> | undefined {
    return this.map.get(token);
  }

  /** Test-only: clear all entries. */
  reset(): void {
    this.map.clear();
  }
}
