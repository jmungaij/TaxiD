/**
 * Recruitment 360 — CV/cover-letter enrichment status helpers.
 *
 * Pure shaping over the `rec_candidate_enrichment_status` view and the
 * `rec_enrichment_audit` trail: which fields are present or missing, overall
 * completeness, and readable summaries of who changed what.
 */
import type { EnrichmentAuditRow, EnrichmentStatusRow } from "./importReconciliation";

export interface EnrichmentField {
  key: string;
  label: string;
  present: boolean;
  /** Extra context shown beside the state, e.g. record counts. */
  detail?: string;
}

/** The canonical enrichment checklist for a candidate profile. */
export function enrichmentFields(row: EnrichmentStatusRow): EnrichmentField[] {
  return [
    { key: "email", label: "Email", present: row.has_email },
    { key: "phone", label: "Phone", present: row.has_phone },
    { key: "headline", label: "Headline", present: row.has_headline },
    { key: "summary", label: "Professional summary", present: row.has_summary },
    { key: "location", label: "Location", present: row.has_location },
    { key: "years", label: "Years of experience", present: row.has_experience_years },
    { key: "employer", label: "Current employer", present: row.has_current_employer },
    {
      key: "experience",
      label: "CV experience records",
      present: row.experience_count > 0,
      detail: `${row.experience_count} on file`,
    },
    { key: "skills", label: "Skills", present: row.skills_count > 0, detail: `${row.skills_count} on file` },
    {
      key: "qualifications",
      label: "Qualifications",
      present: row.qualifications_count > 0,
      detail: `${row.qualifications_count} on file`,
    },
    { key: "cover_letter", label: "Cover letter", present: row.has_cover_letter },
  ];
}

/** Labels of everything still missing — drives the "missing" badge list. */
export function missingEnrichmentFields(row: EnrichmentStatusRow): string[] {
  return enrichmentFields(row).filter((f) => !f.present).map((f) => f.label);
}

/** Completeness percentage across the checklist (0-100). */
export function enrichmentCompleteness(row: EnrichmentStatusRow): number {
  const fields = enrichmentFields(row);
  if (fields.length === 0) return 0;
  return Math.round((fields.filter((f) => f.present).length / fields.length) * 100);
}

const humanise = (v: string) => v.replace(/_/g, " ").replace(/\b[a-z]/g, (c) => c.toUpperCase());

const fmtVal = (v: unknown): string => {
  if (v === null || v === undefined || v === "") return "(empty)";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return s.length > 60 ? `${s.slice(0, 57)}…` : s;
};

/**
 * Readable one-line-per-field summary of an audit row's change payload.
 * Update rows render as "Field: old → new"; inserts render as "Field: value".
 */
export function auditChangeSummary(changes: Record<string, unknown>): string[] {
  return Object.entries(changes ?? {}).map(([key, value]) => {
    if (value !== null && typeof value === "object" && !Array.isArray(value) && "new" in (value as Record<string, unknown>)) {
      const diff = value as { old?: unknown; new?: unknown };
      return `${humanise(key)}: ${fmtVal(diff.old)} → ${fmtVal(diff.new)}`;
    }
    return `${humanise(key)}: ${fmtVal(value)}`;
  });
}

/** Who made the change, for the audit timeline. */
export function auditActor(row: EnrichmentAuditRow): string {
  return row.actor_label ?? (row.actor_user_id ? "Staff member" : "System process");
}

const ts = (iso: string | null | undefined): number => {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
};

/** Most recent enrichment/verification activity on a profile. */
export function lastEnrichmentActivity(row: EnrichmentStatusRow): number {
  return Math.max(ts(row.enrichment_verified_at), ts(row.last_enriched_at), ts(row.profile_updated_at));
}

/**
 * Which candidate the enrichment tab opens on by default: the profile with
 * the most recent enrichment or verification activity — i.e. the one staff
 * were just working on — tie-broken by completeness, then name. Returns null
 * for an empty roster. Never a bare alphabetical first: an untouched profile
 * must not outrank one that was just enriched.
 */
export function defaultEnrichmentCandidate(rows: EnrichmentStatusRow[]): EnrichmentStatusRow | null {
  if (rows.length === 0) return null;
  return [...rows].sort((a, b) => {
    const activity = lastEnrichmentActivity(b) - lastEnrichmentActivity(a);
    if (activity !== 0) return activity;
    const completeness = enrichmentCompleteness(b) - enrichmentCompleteness(a);
    if (completeness !== 0) return completeness;
    return a.full_name.localeCompare(b.full_name);
  })[0];
}
