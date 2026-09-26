/**
 * Recommendation evidence layer.
 *
 * Every intelligence recommendation surfaced in the staff portal must be able
 * to answer three questions without leaving the screen:
 *
 *  1. Which exact source fields produced the number (table.column, and the
 *     value that was read)?
 *  2. Is any of that data seeded/simulated (seed_batch provenance) rather than
 *     production activity?
 *  3. Why is the stated confidence what it is (weighted, named factors)?
 *
 * Nothing here invents data. A field with no resolved value renders as
 * "not resolved", and a table without seed_batch provenance is reported as
 * unknown rather than assumed to be production.
 */
import { supabase } from "@/integrations/supabase/client";
import type { DataState } from "@/lib/staff/dataState";

/** One concrete field read from the platform to produce a recommendation. */
export interface EvidenceField {
  /** Physical table or view the value was read from, e.g. `crm_accounts`. */
  table: string;
  /** Column or aggregate expression, e.g. `annual_value_cents` or `count(*)`. */
  column: string;
  /** Formatted value actually read. Omitted when the read did not resolve. */
  value?: string;
  /** Row identity or filter that scoped the read, e.g. `account_id = …`. */
  recordRef?: string;
  /** ISO timestamp of the read. */
  readAt?: string;
  state: DataState;
}

/** Weighted, named reason contributing to a confidence figure. */
export interface ConfidenceFactor {
  label: string;
  /** Relative weight (any positive scale — normalised on compute). */
  weight: number;
  /** 0–1 satisfaction of this factor. */
  score: number;
  detail: string;
}

export interface ConfidenceRationale {
  /** 0–1, or null when nothing can be asserted. */
  confidence: number | null;
  rationale: string;
  factors: ConfidenceFactor[];
}

/** Seed provenance for one source table. */
export interface SeedProvenance {
  table: string;
  /** Rows attributable to a seed batch, keyed by batch label. */
  batches: { batch: string; rows: number }[];
  /** Rows with no seed_batch — i.e. produced by real platform activity. */
  productionRows: number;
  /** True when the table has no seed_batch column to inspect. */
  unknown: boolean;
}

/** The complete evidence bundle behind a single recommendation. */
export interface EvidenceBundle {
  /** Stable key of the recommendation this evidence belongs to. */
  key: string;
  title: string;
  fields: EvidenceField[];
  confidence: ConfidenceRationale;
  /** Tables to resolve seed provenance for. Defaults to the field tables. */
  provenanceTables?: string[];
  /** Notes stating what the evidence deliberately does not cover. */
  limitations?: string[];
}

/**
 * Tables that carry a `seed_batch` column. Only these can be interrogated for
 * seeded-vs-production provenance; anything else reports `unknown`.
 */
export const SEED_PROVENANCE_TABLES = [
  "crm_accounts",
  "crm_contacts",
  "crm_interactions",
  "org_entities",
  "org_objectives",
  "org_positions",
  "org_units",
  "staff_kpi_actuals",
  "staff_members",
  "staff_work_items",
] as const;

export type SeedProvenanceTable = (typeof SEED_PROVENANCE_TABLES)[number];

export function hasSeedProvenance(table: string): table is SeedProvenanceTable {
  return (SEED_PROVENANCE_TABLES as readonly string[]).includes(table);
}

/**
 * Compute a confidence figure from named factors.
 *
 * Confidence is withheld (null) when there are no factors, or when every
 * factor scores zero — a recommendation with no satisfied evidence must not
 * present a number.
 */
export function computeConfidence(factors: ConfidenceFactor[]): ConfidenceRationale {
  const usable = factors.filter((f) => f.weight > 0);
  if (usable.length === 0) {
    return {
      confidence: null,
      rationale: "Confidence withheld: no evidence factors were declared for this recommendation.",
      factors,
    };
  }
  const totalWeight = usable.reduce((sum, f) => sum + f.weight, 0);
  const weighted = usable.reduce((sum, f) => sum + f.weight * clamp01(f.score), 0);
  const confidence = weighted / totalWeight;
  if (confidence <= 0) {
    return {
      confidence: null,
      rationale: "Confidence withheld: every declared evidence factor scored zero.",
      factors,
    };
  }
  const strongest = [...usable].sort((a, b) => b.weight * b.score - a.weight * a.score)[0];
  const weakest = [...usable].sort((a, b) => a.weight * a.score - b.weight * b.score)[0];
  const rationale =
    `${Math.round(confidence * 100)}% is the weighted mean of ${usable.length} factor` +
    `${usable.length === 1 ? "" : "s"} (total weight ${round2(totalWeight)}). ` +
    `Strongest: ${strongest.label} (${Math.round(strongest.score * 100)}% at weight ${round2(strongest.weight)}). ` +
    (weakest === strongest
      ? "No offsetting factor recorded."
      : `Weakest: ${weakest.label} (${Math.round(weakest.score * 100)}% at weight ${round2(weakest.weight)}).`);
  return { confidence, rationale, factors };
}

export function confidenceLabel(c: number): "High" | "Moderate" | "Low" {
  if (c >= 0.8) return "High";
  if (c >= 0.5) return "Moderate";
  return "Low";
}

/** Map a data state to the factor score it justifies. */
export function stateScore(state: DataState): number {
  switch (state) {
    case "live":
      return 1;
    case "modelled":
      return 0.5;
    default:
      return 0;
  }
}

/**
 * Derive confidence factors from the resolved source fields themselves, so the
 * rationale is always grounded in what actually read successfully.
 */
export function factorsFromFields(fields: EvidenceField[]): ConfidenceFactor[] {
  if (fields.length === 0) return [];
  const live = fields.filter((f) => f.state === "live").length;
  const modelled = fields.filter((f) => f.state === "modelled").length;
  const unresolved = fields.filter((f) => f.state === "unavailable" || f.state === "loading").length;
  const factors: ConfidenceFactor[] = [
    {
      label: "Source resolution",
      weight: 3,
      score: fields.length ? (live + modelled * 0.5) / fields.length : 0,
      detail: `${live} of ${fields.length} field${fields.length === 1 ? "" : "s"} read live${
        modelled ? `, ${modelled} modelled` : ""
      }${unresolved ? `, ${unresolved} unresolved` : ""}.`,
    },
    {
      label: "Field coverage",
      weight: 2,
      score: Math.min(1, fields.length / 4),
      detail: `${fields.length} declared source field${fields.length === 1 ? "" : "s"}; four or more is treated as full coverage.`,
    },
  ];
  const dated = fields.filter((f) => f.readAt).map((f) => new Date(f.readAt as string).getTime());
  if (dated.length) {
    const ageHours = (Date.now() - Math.min(...dated)) / 3_600_000;
    factors.push({
      label: "Freshness",
      weight: 1,
      score: ageHours <= 1 ? 1 : ageHours <= 24 ? 0.75 : ageHours <= 168 ? 0.4 : 0.1,
      detail: `Oldest read is ${ageHours < 1 ? "under an hour" : `${Math.round(ageHours)} h`} old.`,
    });
  }
  return factors;
}

/** Fraction of rows across provenance results that came from seed batches. */
export function seededShare(rows: SeedProvenance[]): number | null {
  const known = rows.filter((r) => !r.unknown);
  if (known.length === 0) return null;
  const seeded = known.reduce((s, r) => s + r.batches.reduce((b, x) => b + x.rows, 0), 0);
  const total = seeded + known.reduce((s, r) => s + r.productionRows, 0);
  if (total === 0) return null;
  return seeded / total;
}

/** Human sentence describing provenance mix. */
export function provenanceStatement(rows: SeedProvenance[]): string {
  const share = seededShare(rows);
  if (share === null) return "Seed provenance could not be established for these sources.";
  if (share === 0) return "All inspected rows originate from production activity — no seed batch involved.";
  if (share === 1) return "Every inspected row belongs to a seed batch: treat the number as simulated, not measured.";
  return `${Math.round(share * 100)}% of inspected rows belong to a seed batch; the remainder is production activity.`;
}

/**
 * Read seed_batch provenance for the given tables. Tables without the column
 * are returned as `unknown: true`; read failures (including RLS denials) are
 * also reported as unknown rather than assumed clean.
 */
export async function fetchSeedProvenance(tables: string[]): Promise<SeedProvenance[]> {
  const unique = Array.from(new Set(tables.filter(Boolean)));
  return Promise.all(
    unique.map(async (table): Promise<SeedProvenance> => {
      if (!hasSeedProvenance(table)) {
        return { table, batches: [], productionRows: 0, unknown: true };
      }
      const { data, error } = await supabase
        // Table name is constrained to the SEED_PROVENANCE_TABLES allow-list above.
        .from(table as SeedProvenanceTable)
        .select("seed_batch")
        .limit(2000);
      if (error || !data) {
        return { table, batches: [], productionRows: 0, unknown: true };
      }
      const counts = new Map<string, number>();
      let productionRows = 0;
      for (const row of data as { seed_batch: string | null }[]) {
        if (row.seed_batch) counts.set(row.seed_batch, (counts.get(row.seed_batch) ?? 0) + 1);
        else productionRows += 1;
      }
      return {
        table,
        batches: [...counts.entries()]
          .map(([batch, rows]) => ({ batch, rows }))
          .sort((a, b) => b.rows - a.rows),
        productionRows,
        unknown: false,
      };
    }),
  );
}

/**
 * Build an evidence bundle from a recommendation that only declares narrative
 * evidence lines plus a source string (the older contract). Field values are
 * only claimed when the line contains an explicit `table.column = value`.
 */
export function bundleFromNarrative(input: {
  key: string;
  title: string;
  source: string;
  evidence: string[];
  confidence?: number;
}): EvidenceBundle {
  const readAt = new Date().toISOString();
  const fields: EvidenceField[] = input.evidence.map((line) => {
    const parsed = parseFieldLine(line);
    return parsed
      ? { ...parsed, readAt, state: "live" as DataState }
      : { table: input.source, column: "narrative evidence", value: line, readAt, state: "live" as DataState };
  });
  const derived = computeConfidence(factorsFromFields(fields));
  return {
    key: input.key,
    title: input.title,
    fields,
    confidence:
      input.confidence == null
        ? derived
        : {
            confidence: input.confidence,
            rationale: `Confidence ${Math.round(input.confidence * 100)}% is the value recorded with the signal. ${derived.rationale}`,
            factors: derived.factors,
          },
    provenanceTables: Array.from(new Set(fields.map((f) => f.table))),
    limitations: ["Evidence lines are recorded with the signal; only fields written as table.column carry a resolved value."],
  };
}

/** Parse `table.column = value` from an evidence line, if present. */
export function parseFieldLine(line: string): { table: string; column: string; value: string } | null {
  const m = /^\s*([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_()*]*)\s*[=:]\s*(.+)$/i.exec(line);
  if (!m) return null;
  return { table: m[1], column: m[2], value: m[3].trim() };
}

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
