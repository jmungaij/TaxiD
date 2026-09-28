/**
 * Phase 8 — Provenance kernel ("no hallucinated business data").
 *
 * Every commercial number in Phase 8 is a `Measure`. A Measure cannot exist
 * without declaring where it came from, how it was calculated and whether it is
 * LIVE, MODELLED, SIMULATED, DEMO/SEEDED or UNAVAILABLE. Aggregations degrade to
 * the weakest provenance of their inputs, so a single seeded row can never be
 * laundered into an actual-performance claim.
 *
 * This module is the enforcement point for §4, §28 and §33 of the Phase 8
 * specification. It deliberately has no Supabase dependency so it can be unit
 * tested and reused by every engine.
 */

export const PROVENANCES = ["LIVE", "MODELLED", "SIMULATED", "DEMO", "UNAVAILABLE"] as const;
export type Provenance = (typeof PROVENANCES)[number];

export const PROVENANCE_LABEL: Record<Provenance, string> = {
  LIVE: "LIVE",
  MODELLED: "MODELLED",
  SIMULATED: "SIMULATED",
  DEMO: "DEMO / SEEDED",
  UNAVAILABLE: "DATA NOT AVAILABLE",
};

/** Weakest-wins ordering. Index 0 is strongest. */
const STRENGTH: Provenance[] = ["LIVE", "MODELLED", "DEMO", "SIMULATED", "UNAVAILABLE"];

export type MeasureUnit = "kes" | "count" | "percent" | "hours" | "days" | "score";

export interface Measure {
  label: string;
  /** null whenever provenance is UNAVAILABLE — never a silent zero. */
  value: number | null;
  unit: MeasureUnit;
  provenance: Provenance;
  /** Authoritative table/view/derivation the number came from. */
  source: string;
  /** Human-readable calculation, so the number is reproducible by hand. */
  calculation: string;
  /** ISO timestamp of the underlying read. */
  asOf: string | null;
  /** 0-100 for MODELLED values; null for LIVE facts. */
  confidence: number | null;
  modelVersion?: string;
  /** Why the value is unavailable or degraded. */
  note?: string;
}

export function liveMeasure(
  label: string, value: number, unit: MeasureUnit, source: string, calculation: string,
  asOf = new Date().toISOString(),
): Measure {
  return { label, value, unit, provenance: "LIVE", source, calculation, asOf, confidence: null };
}

export function modelledMeasure(
  label: string, value: number, unit: MeasureUnit, source: string, calculation: string,
  confidence: number, modelVersion: string,
): Measure {
  return {
    label, value, unit, provenance: "MODELLED", source, calculation,
    asOf: new Date().toISOString(), confidence: clamp(confidence, 0, 100), modelVersion,
  };
}

export function seededMeasure(
  label: string, value: number, unit: MeasureUnit, source: string, calculation: string, evidence: string,
): Measure {
  return {
    label, value, unit, provenance: "SIMULATED", source, calculation,
    asOf: new Date().toISOString(), confidence: null, note: evidence,
  };
}

export function unavailableMeasure(
  label: string, unit: MeasureUnit, source: string, note: string,
): Measure {
  return {
    label, value: null, unit, provenance: "UNAVAILABLE", source,
    calculation: "Not calculable — required source is not admissible",
    asOf: null, confidence: null, note,
  };
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Weakest provenance across inputs. Empty input is UNAVAILABLE, not LIVE. */
export function weakestProvenance(items: readonly Provenance[]): Provenance {
  if (items.length === 0) return "UNAVAILABLE";
  let worst: Provenance = "LIVE";
  for (const p of items) {
    if (STRENGTH.indexOf(p) > STRENGTH.indexOf(worst)) worst = p;
  }
  return worst;
}

/** Only LIVE numbers may be described as actual TaxiD performance. */
export function presentableAsPerformance(m: Measure): boolean {
  return m.provenance === "LIVE" && m.value !== null;
}

/**
 * Sum measures, degrading provenance. Values that are null are skipped but
 * force the result to at best UNAVAILABLE when nothing is summable.
 */
export function sumMeasures(label: string, unit: MeasureUnit, parts: readonly Measure[]): Measure {
  const usable = parts.filter((p) => p.value !== null);
  const provenance = weakestProvenance(parts.map((p) => p.provenance));
  if (usable.length === 0) {
    return unavailableMeasure(label, unit, parts.map((p) => p.source).join(", ") || "—",
      "No contributing measure carried a value");
  }
  return {
    label,
    value: usable.reduce((a, p) => a + (p.value ?? 0), 0),
    unit,
    provenance,
    source: [...new Set(usable.map((p) => p.source))].join(" + "),
    calculation: `SUM(${usable.map((p) => p.label).join(", ")})`,
    asOf: usable.map((p) => p.asOf).filter(Boolean).sort().slice(-1)[0] ?? null,
    confidence: provenance === "MODELLED"
      ? Math.round(usable.reduce((a, p) => a + (p.confidence ?? 60), 0) / usable.length)
      : null,
    note: provenance === "LIVE" ? undefined : `Degraded to ${provenance} by contributing sources`,
  };
}

export interface ProvenanceViolation {
  measure: string;
  problem: string;
}

/**
 * Guard for §28. Returns every way a set of measures would mislead an executive
 * if rendered as production performance. An empty array is the only pass.
 */
export function auditProvenance(measures: readonly Measure[]): ProvenanceViolation[] {
  const v: ProvenanceViolation[] = [];
  for (const m of measures) {
    if (m.provenance === "UNAVAILABLE" && m.value !== null) {
      v.push({ measure: m.label, problem: "Unavailable measure carries a value" });
    }
    if (m.provenance === "MODELLED" && m.confidence === null) {
      v.push({ measure: m.label, problem: "Modelled measure discloses no confidence" });
    }
    if (m.provenance === "MODELLED" && !m.modelVersion) {
      v.push({ measure: m.label, problem: "Modelled measure discloses no model version" });
    }
    if (m.provenance === "SIMULATED" && !m.note) {
      v.push({ measure: m.label, problem: "Simulated measure discloses no seed evidence" });
    }
    if (m.value !== null && !m.source) {
      v.push({ measure: m.label, problem: "Measure carries a value with no source" });
    }
    if (m.provenance === "LIVE" && !m.asOf) {
      v.push({ measure: m.label, problem: "Live measure discloses no timestamp" });
    }
  }
  return v;
}

/** Display helper — never fabricates a figure for an unavailable measure. */
export function formatMeasure(m: Measure): string {
  if (m.value === null) return PROVENANCE_LABEL.UNAVAILABLE;
  switch (m.unit) {
    case "kes": return `KES ${Math.round(m.value).toLocaleString()}`;
    case "percent": return `${m.value.toFixed(1)}%`;
    case "hours": return `${m.value.toFixed(1)} h`;
    case "days": return `${m.value.toFixed(1)} d`;
    case "score": return `${Math.round(m.value)}/100`;
    default: return Math.round(m.value).toLocaleString();
  }
}
