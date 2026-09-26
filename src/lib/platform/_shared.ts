/**
 * Shared deterministic helpers for the IEOS platform layer.
 * Pure functions only — no state, no network.
 */

export function clamp(value: number, min = 0, max = 100): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function round(value: number, dp = 1): number {
  const f = 10 ** dp;
  return Math.round(value * f) / f;
}

/** FNV-1a — stable, content-derived identifiers safe to dedupe on across runs. */
export function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function pct(part: number, total: number): number {
  if (total <= 0) return 0;
  return clamp((part / total) * 100);
}

export type Grade = "certified" | "conditional" | "not_certified";

export function grade(score: number, certifyAt = 90, conditionalAt = 75): Grade {
  if (score >= certifyAt) return "certified";
  if (score >= conditionalAt) return "conditional";
  return "not_certified";
}

export type FindingSeverity = "p0" | "p1" | "p2";

export interface PlatformFinding {
  id: string;
  severity: FindingSeverity;
  subject: string;
  summary: string;
  recommendation: string;
}

export function makeFinding(
  namespace: string,
  severity: FindingSeverity,
  subject: string,
  summary: string,
  recommendation: string,
): PlatformFinding {
  return {
    id: `${namespace}-${fnv1a(`${namespace}|${severity}|${subject}|${summary}`)}`,
    severity,
    subject,
    summary,
    recommendation,
  };
}

const SEVERITY_ORDER: Record<FindingSeverity, number> = { p0: 0, p1: 1, p2: 2 };

export function sortFindings(findings: PlatformFinding[]): PlatformFinding[] {
  return [...findings].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.id.localeCompare(b.id),
  );
}
