/**
 * Answer quality gate.
 *
 * Runs before any answer leaves the intelligence layer. It cannot improve an
 * answer — it can only qualify it, or refuse it. A refusal is a legitimate
 * output: "insufficient data" is always preferred to manufactured certainty.
 */
import {
  DOMAIN_STALE_AFTER_MINUTES,
  minutesSince,
  type DataQuality,
  type DomainReading,
} from "./contract";

export type AnswerVerdict = "answered" | "qualified" | "insufficient_data" | "not_authorised";

export interface GateCheck {
  id: string;
  label: string;
  passed: boolean;
  /** Material failures force a qualified answer or a refusal. */
  material: boolean;
  detail?: string;
}

export interface GateResult {
  verdict: AnswerVerdict;
  checks: GateCheck[];
  failures: string[];
}

export interface GateInput {
  readings: DomainReading[];
  quality: DataQuality;
  /** True when the caller resolved to a known intent. */
  intentResolved: boolean;
  now?: number;
}

export function runAnswerQualityGate(input: GateInput): GateResult {
  const { readings, quality, intentResolved } = input;
  const now = input.now ?? Date.now();
  const authorised = readings.filter((r) => r.authorised);
  const withData = authorised.filter((r) => r.claims.length > 0);
  const claims = withData.flatMap((r) => r.claims);

  const staleDomains = withData.filter((r) => {
    const age = minutesSince(r.freshestAt, now);
    return age !== undefined && age > DOMAIN_STALE_AFTER_MINUTES[r.domain];
  });

  const unsourced = claims.filter((c) => !c.source);
  const unstatedAssumptions = claims.filter(
    (c) => (c.classification === "ESTIMATE" || c.classification === "PREDICTION") && !(c.assumptions?.length),
  );
  const revenueFromPotential = claims.filter(
    (c) => /revenue/i.test(c.label) && /opportunity|pipeline|potential|weighted/i.test(c.source),
  );

  const checks: GateCheck[] = [
    {
      id: "authorised",
      label: "Caller is authorised for at least one domain in scope",
      passed: authorised.length > 0,
      material: true,
      detail: authorised.length === 0 ? "no domain in scope is permitted for this account" : undefined,
    },
    {
      id: "intent",
      label: "Question resolved to a known intent",
      passed: intentResolved,
      material: false,
      detail: intentResolved ? undefined : "answered from the closest matching domains",
    },
    {
      id: "data_present",
      label: "At least one authoritative record was read",
      passed: withData.length > 0 && quality.rowsInspected >= 0 && claims.length > 0,
      material: true,
      detail: claims.length === 0 ? "no records matched inside the caller's scope" : undefined,
    },
    {
      id: "source_known",
      label: "Every claim names its source",
      passed: unsourced.length === 0,
      material: true,
      detail: unsourced.length ? `${unsourced.length} claim(s) without a source` : undefined,
    },
    {
      id: "freshness",
      label: "Underlying data is fresh enough for the domain",
      passed: staleDomains.length === 0,
      material: true,
      detail: staleDomains.length ? `stale: ${staleDomains.map((r) => r.domain).join(", ")}` : undefined,
    },
    {
      id: "class_separation",
      label: "Estimates and predictions state their assumptions",
      passed: unstatedAssumptions.length === 0,
      material: true,
      detail: unstatedAssumptions.length
        ? `${unstatedAssumptions.length} derived claim(s) without stated assumptions`
        : undefined,
    },
    {
      id: "revenue_integrity",
      label: "Pipeline value is never reported as revenue",
      passed: revenueFromPotential.length === 0,
      material: true,
      detail: revenueFromPotential.length ? "a revenue claim was built from potential value" : undefined,
    },
    {
      id: "quality_floor",
      label: "Data quality is above the answering floor",
      passed: quality.score >= 40,
      material: true,
      detail: quality.score < 40 ? `data quality ${quality.score}/100` : undefined,
    },
  ];

  const failures = checks.filter((c) => !c.passed).map((c) => c.id);
  const materialFailures = checks.filter((c) => !c.passed && c.material).map((c) => c.id);

  let verdict: AnswerVerdict = "answered";
  if (materialFailures.includes("authorised")) verdict = "not_authorised";
  else if (materialFailures.includes("data_present") || materialFailures.includes("quality_floor")) {
    verdict = "insufficient_data";
  } else if (materialFailures.length > 0 || failures.length > 0) verdict = "qualified";

  return { verdict, checks, failures };
}
