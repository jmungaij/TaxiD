/**
 * SAFARID PARTNERS 360 — lifecycle timeline diff.
 *
 * Pure comparison of two consecutive lifecycle audit entries: what the visitor
 * declared before, what they declared after, and which of the four governed
 * dimensions — intent, category, maturity level and stage — actually moved.
 * Kept free of React and of Supabase so it can be unit-tested directly.
 */
import type { PartnerLifecycleAuditRow } from "@/lib/partners/history";

export type DiffField = "intent_bring" | "network_category" | "maturity_level" | "lifecycle_stage";

export const DIFF_FIELD_LABEL: Record<DiffField, string> = {
  intent_bring: "What they bring",
  network_category: "Partner category",
  maturity_level: "Maturity level",
  lifecycle_stage: "Lifecycle stage",
};

/** The drill key used for human labels, per diff field. */
export const DIFF_FIELD_KEY: Record<DiffField, "bring" | "category" | "level" | "stage"> = {
  intent_bring: "bring",
  network_category: "category",
  maturity_level: "level",
  lifecycle_stage: "stage",
};

export const DIFF_FIELDS: DiffField[] = [
  "lifecycle_stage",
  "intent_bring",
  "network_category",
  "maturity_level",
];

export interface FieldDelta {
  field: DiffField;
  before: string | null;
  after: string | null;
  changed: boolean;
  kind: "set" | "cleared" | "changed" | "unchanged";
}

export interface TimelineDiff {
  fromId: string;
  toId: string;
  fromAt: string;
  toAt: string;
  /** Minutes between the two captures, rounded to one decimal. */
  gapMinutes: number;
  deltas: FieldDelta[];
  changedFields: DiffField[];
  /** True when nothing governed moved between the two entries. */
  identical: boolean;
}

function norm(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return s === "" ? null : s;
}

function deltaOf(field: DiffField, before: string | null, after: string | null): FieldDelta {
  const changed = before !== after;
  const kind: FieldDelta["kind"] = !changed
    ? "unchanged"
    : before === null
      ? "set"
      : after === null
        ? "cleared"
        : "changed";
  return { field, before, after, changed, kind };
}

/** Diff one pair of audit entries. `from` is the earlier capture. */
export function diffAuditPair(
  from: PartnerLifecycleAuditRow,
  to: PartnerLifecycleAuditRow,
): TimelineDiff {
  const deltas = DIFF_FIELDS.map((field) =>
    deltaOf(field, norm(from[field] as string | null), norm(to[field] as string | null)),
  );
  const changedFields = deltas.filter((d) => d.changed).map((d) => d.field);
  const gap = (new Date(to.created_at).getTime() - new Date(from.created_at).getTime()) / 60_000;

  return {
    fromId: from.id,
    toId: to.id,
    fromAt: from.created_at,
    toAt: to.created_at,
    gapMinutes: Math.round(Math.max(0, gap) * 10) / 10,
    deltas,
    changedFields,
    identical: changedFields.length === 0,
  };
}

/**
 * Diffs for every consecutive pair in a session's audit trail, newest pair first.
 * Rows may arrive in either order — they are sorted oldest-first internally.
 */
export function buildTimelineDiffs(rows: PartnerLifecycleAuditRow[]): TimelineDiff[] {
  const ordered = [...rows].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  const out: TimelineDiff[] = [];
  for (let i = 1; i < ordered.length; i++) out.push(diffAuditPair(ordered[i - 1], ordered[i]));
  return out.reverse();
}
