/**
 * Multi-identifier filter parsing for the dispatch orders console.
 *
 * Accepts pasted lists (comma, newline, semicolon, tab or space separated) and
 * barcode/QR scanner payloads. Scanned text NEVER becomes a query fragment:
 * every candidate must match a strict identifier pattern before it is admitted,
 * and lookups are always parameterised (`.in("order_number", ids)`).
 */

/** TaxiD identifier schemes accepted by the console. */
export const ORDER_ID_PATTERN = /^(ORD|PKG|YAL|SHP)-[A-Z0-9]{4,24}$/;

export const MAX_IDS = 200;
export const MAX_INPUT_LENGTH = 8000;

export interface ParsedIds {
  /** Newly accepted, normalised identifiers (order preserved). */
  accepted: string[];
  /** Already present in the active set — silently ignored, never duplicated. */
  duplicates: string[];
  /** Tokens rejected because they do not match a known identifier scheme. */
  rejected: string[];
  /** True when the input pushed the set past MAX_IDS. */
  truncated: boolean;
}

/** Normalise a single token; returns null when it is not a valid identifier. */
export function normaliseOrderId(raw: string): string | null {
  const token = raw.trim().replace(/[\s,;]+$/g, "").replace(/^["'(<[]+|["')>\]]+$/g, "");
  if (!token) return null;
  // Scanners often emit lowercase or the URL form of a tracking QR code.
  const tail = token.includes("/") ? token.split("/").filter(Boolean).pop()! : token;
  const upper = tail.toUpperCase().replace(/\s+/g, "");
  if (!ORDER_ID_PATTERN.test(upper)) return null;
  return upper;
}

export function parseOrderIds(
  input: string,
  existing: readonly string[] = [],
  max: number = MAX_IDS,
): ParsedIds {
  const result: ParsedIds = { accepted: [], duplicates: [], rejected: [], truncated: false };
  if (!input) return result;
  const bounded = input.slice(0, MAX_INPUT_LENGTH);
  const seen = new Set(existing);
  for (const token of bounded.split(/[\s,;|]+/)) {
    if (!token.trim()) continue;
    const id = normaliseOrderId(token);
    if (!id) {
      result.rejected.push(token.trim());
      continue;
    }
    if (seen.has(id) || result.accepted.includes(id)) {
      result.duplicates.push(id);
      continue;
    }
    if (seen.size + result.accepted.length >= max) {
      result.truncated = true;
      break;
    }
    result.accepted.push(id);
  }
  return result;
}

/** Human summary for the filter chip row. */
export function describeIdFilter(ids: readonly string[]): string {
  if (ids.length === 0) return "No ID filter";
  return `${ids.length} ID${ids.length === 1 ? "" : "s"} filtered`;
}
