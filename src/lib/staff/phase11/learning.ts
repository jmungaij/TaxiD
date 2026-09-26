/**
 * Phase 11 §11.12–§11.15, §11.31 — the Digital Twin → Reality comparator, model
 * drift detection, the AI Experiment Lab, the causal learning layer and the
 * "Prove It" record.
 *
 * The rule this module enforces: revenue rising after an intervention is not
 * proof that the intervention caused it. Causal confidence is earned by a
 * comparison design — holdout, A/B, difference-in-differences or synthetic
 * control — and is otherwise reported as correlation only.
 */
import { clamp } from "@/lib/staff/phase8/provenance";

/* -------------------------------------------------------- comparator (11.12) */

export type ComparatorDimension =
  | "demand" | "supply" | "price" | "eta" | "fulfilment" | "revenue"
  | "contribution" | "customer_behaviour" | "provider_behaviour" | "liquidity";

export interface Comparison {
  dimension: ComparatorDimension;
  expected: number | null;
  actual: number | null;
  unit: "count" | "percent" | "kes" | "minutes";
  /** Tolerated variance in percent before recalibration is required. */
  tolerancePct: number;
}

export interface ComparisonResult extends Comparison {
  variancePct: number | null;
  status: "aligned" | "material_gap" | "unmeasured";
  action: string;
}

export function compare(c: Comparison): ComparisonResult {
  if (c.expected === null || c.actual === null || c.expected === 0) {
    return {
      ...c, variancePct: null, status: "unmeasured",
      action: "Instrument both the modelled expectation and the observed actual before relying on this dimension",
    };
  }
  const variancePct = Math.round(((c.actual - c.expected) / Math.abs(c.expected)) * 1000) / 10;
  const material = Math.abs(variancePct) > c.tolerancePct;
  return {
    ...c,
    variancePct,
    status: material ? "material_gap" : "aligned",
    action: material
      ? `Variance ${variancePct}% exceeds the ${c.tolerancePct}% tolerance — the twin requires recalibration on ${c.dimension}`
      : "Within tolerance — the model remains a usable representation",
  };
}

export interface TwinCalibration {
  results: ComparisonResult[];
  aligned: number;
  materialGaps: number;
  unmeasured: number;
  /** True when at least one dimension is measured and no material gap is open. */
  calibrated: boolean;
  narrative: string;
}

export function calibrateTwin(comparisons: readonly Comparison[]): TwinCalibration {
  const results = comparisons.map(compare);
  const measured = results.filter((r) => r.status !== "unmeasured");
  const gaps = results.filter((r) => r.status === "material_gap");
  return {
    results,
    aligned: results.filter((r) => r.status === "aligned").length,
    materialGaps: gaps.length,
    unmeasured: results.filter((r) => r.status === "unmeasured").length,
    calibrated: measured.length > 0 && gaps.length === 0,
    narrative:
      measured.length === 0
        ? "Expected-versus-actual cannot be computed on any dimension — the twin remains an analytical model only."
        : gaps.length === 0
          ? `${measured.length} dimension(s) compared; the model tracks reality within tolerance.`
          : `${gaps.length} dimension(s) diverge materially: ${gaps.map((g) => g.dimension).join(", ")}.`,
  };
}

/* ------------------------------------------------------------- drift (11.13) */

export interface ModelRegistryEntry {
  id: string;
  name: string;
  owner: string;
  version: string;
  purpose: string;
  trainingProvenance: string;
  evaluation: string | null;
  deployedAt: string | null;
  /** Accuracy on the current window and on the approved baseline. */
  accuracyPct: number | null;
  baselineAccuracyPct: number | null;
  /** Input distribution shift, 0-100. */
  dataDriftPct: number | null;
  /** Target relationship shift, 0-100. */
  conceptDriftPct: number | null;
  falsePositiveRate: number | null;
  falseNegativeRate: number | null;
  /** Whether calibration was checked against outcomes. */
  calibrationChecked: boolean;
  biasReviewed: boolean;
  /** Economic contribution attributable to the model in cents. */
  economicValueCents: number | null;
  retirementCriteria: string;
}

export interface DriftVerdict {
  model: ModelRegistryEntry;
  status: "healthy" | "watch" | "recalibrate" | "retire" | "unevaluated";
  issues: string[];
  /** Accuracy delta versus baseline. */
  degradationPct: number | null;
  /** Business value check — technically responding is not enough. */
  earnsItsPlace: boolean | null;
}

export function detectDrift(m: ModelRegistryEntry): DriftVerdict {
  const issues: string[] = [];
  if (m.evaluation === null) issues.push("no evaluation suite");
  if (!m.calibrationChecked) issues.push("calibration not checked");
  if (!m.biasReviewed) issues.push("bias not reviewed");
  if ((m.dataDriftPct ?? 0) > 20) issues.push(`data drift ${m.dataDriftPct}%`);
  if ((m.conceptDriftPct ?? 0) > 15) issues.push(`concept drift ${m.conceptDriftPct}%`);
  if ((m.falsePositiveRate ?? 0) > 20) issues.push(`false positives ${m.falsePositiveRate}%`);
  if ((m.falseNegativeRate ?? 0) > 20) issues.push(`false negatives ${m.falseNegativeRate}%`);

  const degradationPct =
    m.accuracyPct === null || m.baselineAccuracyPct === null
      ? null
      : Math.round((m.accuracyPct - m.baselineAccuracyPct) * 10) / 10;
  if (degradationPct !== null && degradationPct < -5) issues.push(`accuracy ${degradationPct}% below baseline`);

  const earnsItsPlace = m.economicValueCents === null ? null : m.economicValueCents > 0;
  if (earnsItsPlace === false) issues.push("no demonstrated economic value");

  const status: DriftVerdict["status"] =
    m.evaluation === null || m.accuracyPct === null
      ? "unevaluated"
      : earnsItsPlace === false || (degradationPct !== null && degradationPct < -12)
        ? "retire"
        : issues.length >= 3 || (degradationPct !== null && degradationPct < -5)
          ? "recalibrate"
          : issues.length > 0
            ? "watch"
            : "healthy";

  return { model: m, status, issues, degradationPct, earnsItsPlace };
}

export interface AiGovernanceRegister {
  models: DriftVerdict[];
  healthy: number;
  needingAction: number;
  unevaluated: number;
  /** Every production model has an owner, purpose, provenance and retirement rule. */
  fullyRegistered: boolean;
  boardActions: string[];
}

/** §11.32 — the AI Governance Board register. */
export function registerModels(models: readonly ModelRegistryEntry[]): AiGovernanceRegister {
  const verdicts = models.map(detectDrift);
  return {
    models: verdicts,
    healthy: verdicts.filter((v) => v.status === "healthy").length,
    needingAction: verdicts.filter((v) => v.status === "recalibrate" || v.status === "retire").length,
    unevaluated: verdicts.filter((v) => v.status === "unevaluated").length,
    fullyRegistered: models.every(
      (m) => m.owner.trim() && m.purpose.trim() && m.trainingProvenance.trim() && m.retirementCriteria.trim(),
    ),
    boardActions: verdicts
      .filter((v) => v.status !== "healthy")
      .map((v) => `${v.model.name} (${v.model.version}): ${v.status} — ${v.issues.join(", ") || "evaluation outstanding"}`),
  };
}

/* -------------------------------------------------- experiments & causality */

export type ComparisonMethod = "holdout" | "ab_test" | "difference_in_differences" | "synthetic_control" | "pre_post_only" | "none";

export const METHOD_LABEL: Record<ComparisonMethod, string> = {
  holdout: "Holdout group",
  ab_test: "A/B test",
  difference_in_differences: "Difference-in-differences",
  synthetic_control: "Synthetic control",
  pre_post_only: "Pre/post only (no comparison group)",
  none: "No comparison",
};

export type CausalConfidence = "causal_evidence" | "suggestive" | "correlation_only" | "not_measured";

export const CAUSAL_LABEL: Record<CausalConfidence, string> = {
  causal_evidence: "Causal evidence",
  suggestive: "Suggestive",
  correlation_only: "Correlation only",
  not_measured: "Not measured",
};

export interface Experiment {
  id: string;
  hypothesis: string;
  interventionClass: string;
  method: ComparisonMethod;
  /** Sample sizes. Treatment is required; control may be null for pre/post. */
  treatmentSamples: number | null;
  controlSamples: number | null;
  /** Contribution in cents per unit, treatment and control. */
  treatmentContributionCents: number | null;
  controlContributionCents: number | null;
  conversionTreatmentPct: number | null;
  conversionControlPct: number | null;
  costCents: number | null;
  customerExperienceDelta: number | null;
  providerExperienceDelta: number | null;
  riskDelta: number | null;
}

export interface ExperimentOutcome {
  experiment: Experiment;
  /** Incremental contribution net of cost, in cents. */
  incrementalContributionCents: number | null;
  incrementalConversionPct: number | null;
  causal: CausalConfidence;
  decision: "scale" | "iterate" | "stop" | "insufficient_evidence";
  narrative: string;
}

const MIN_SAMPLES = 20;

/** §11.14 + §11.15 — measure the outcome, then decide what may be claimed. */
export function evaluateExperiment(e: Experiment): ExperimentOutcome {
  const hasComparison = e.method !== "none" && e.method !== "pre_post_only" && (e.controlSamples ?? 0) > 0;
  const measurable =
    e.treatmentContributionCents !== null &&
    e.treatmentSamples !== null &&
    (hasComparison ? e.controlContributionCents !== null : true);

  if (!measurable) {
    return {
      experiment: e,
      incrementalContributionCents: null,
      incrementalConversionPct: null,
      causal: "not_measured",
      decision: "insufficient_evidence",
      narrative: "The outcome was not measured — no value may be claimed for this intervention class.",
    };
  }

  const perUnit =
    hasComparison && e.controlContributionCents !== null
      ? (e.treatmentContributionCents ?? 0) - e.controlContributionCents
      : (e.treatmentContributionCents ?? 0);
  const gross = perUnit * (e.treatmentSamples ?? 0);
  const incrementalContributionCents = Math.round(gross - (e.costCents ?? 0));

  const incrementalConversionPct =
    e.conversionTreatmentPct === null || e.conversionControlPct === null
      ? null
      : Math.round((e.conversionTreatmentPct - e.conversionControlPct) * 10) / 10;

  const powered = (e.treatmentSamples ?? 0) >= MIN_SAMPLES && (!hasComparison || (e.controlSamples ?? 0) >= MIN_SAMPLES);
  const causal: CausalConfidence = !hasComparison
    ? "correlation_only"
    : powered
      ? "causal_evidence"
      : "suggestive";

  const harmed = (e.customerExperienceDelta ?? 0) < -10 || (e.providerExperienceDelta ?? 0) < -10 || (e.riskDelta ?? 0) > 15;

  const decision: ExperimentOutcome["decision"] = harmed
    ? "stop"
    : incrementalContributionCents <= 0
      ? "stop"
      : causal === "causal_evidence"
        ? "scale"
        : "iterate";

  return {
    experiment: e,
    incrementalContributionCents,
    incrementalConversionPct,
    causal,
    decision,
    narrative: `${METHOD_LABEL[e.method]} on ${e.treatmentSamples} treated${
      hasComparison ? ` vs ${e.controlSamples} control` : " with no comparison group"
    }: incremental contribution KES ${Math.round(incrementalContributionCents / 100).toLocaleString()} net of cost. Claim strength: ${CAUSAL_LABEL[causal]}.${
      harmed ? " Stopped on multi-sided harm." : ""
    }`,
  };
}

/* ------------------------------------------------------------ prove it (11.31) */

export interface InterventionLedgerEntry {
  id: string;
  interventionClass: string;
  prediction: string;
  action: string;
  actualOutcome: string | null;
  variancePct: number | null;
  economicImpactCents: number | null;
  causal: CausalConfidence;
  lesson: string | null;
}

export interface ProofOfValue {
  entries: InterventionLedgerEntry[];
  validatedInterventions: number;
  /** Contribution that survives a causal comparison, in cents. */
  provenContributionCents: number | null;
  /** Contribution observed but only correlated. */
  correlatedContributionCents: number | null;
  claimable: string;
}

/** The only claim Phase 11 is permitted to make about its own value. */
export function proveValue(entries: readonly InterventionLedgerEntry[]): ProofOfValue {
  const proven = entries.filter((e) => e.causal === "causal_evidence" && e.economicImpactCents !== null);
  const correlated = entries.filter((e) => e.causal !== "causal_evidence" && e.economicImpactCents !== null);
  const sum = (rows: InterventionLedgerEntry[]) =>
    rows.length === 0 ? null : rows.reduce((a, e) => a + (e.economicImpactCents ?? 0), 0);

  const provenTotal = sum(proven);
  return {
    entries: [...entries],
    validatedInterventions: proven.length,
    provenContributionCents: provenTotal,
    correlatedContributionCents: sum(correlated),
    claimable:
      provenTotal === null
        ? "No intervention class has yet produced causally validated value — Phase 11 may not claim economic impact."
        : `This class of intervention has generated KES ${Math.round(provenTotal / 100).toLocaleString()} incremental contribution across ${proven.length} causally validated intervention(s).`,
  };
}

export function driftScore(register: AiGovernanceRegister): number {
  if (register.models.length === 0) return 0;
  return Math.round(clamp((register.healthy / register.models.length) * 100, 0, 100));
}
