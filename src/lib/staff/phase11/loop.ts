/**
 * Phase 11 §11.35 — the closed adaptive loop, executed against one real
 * marketplace condition.
 *
 * SENSE → UNDERSTAND → PREDICT → SIMULATE → DECIDE → APPROVE → ACT → OBSERVE →
 * MEASURE → LEARN → ADAPT.
 *
 * Each stage records whether it was completed on evidence, blocked by governance
 * or withheld for lack of instrumentation. A stage is never marked complete
 * because the code ran; it is complete when the evidence exists.
 */
import type { SensingCoverage } from "./sensing";
import type { MarketplaceState } from "./state";
import type { Prediction } from "./prediction";
import { optimiseInterventions, type InterventionOption, type OptimiserResult, INTERVENTION_LABEL } from "./scenario";
import { authoriseAction, AUTONOMY_LABEL, type AuthorityDecision, type KillSwitch } from "./autonomy";
import {
  calibrateTwin, evaluateExperiment, type Comparison, type Experiment,
  type ExperimentOutcome, type InterventionLedgerEntry, type TwinCalibration,
} from "./learning";

export const LOOP_STAGES = [
  "sense", "understand", "predict", "simulate", "decide",
  "approve", "act", "observe", "measure", "learn", "adapt",
] as const;

export type LoopStage = (typeof LOOP_STAGES)[number];

export const LOOP_STAGE_LABEL: Record<LoopStage, string> = {
  sense: "Sense",
  understand: "Understand",
  predict: "Predict",
  simulate: "Simulate",
  decide: "Decide",
  approve: "Approve",
  act: "Act",
  observe: "Observe",
  measure: "Measure",
  learn: "Learn",
  adapt: "Adapt",
};

export type StageStatus = "complete" | "blocked" | "withheld";

export interface LoopStageRecord {
  stage: LoopStage;
  status: StageStatus;
  detail: string;
  /** Where the evidence for this stage came from. */
  evidence: string;
}

export interface LoopExecution {
  /** Whether the authorised action was actually executed. */
  executed: boolean;
  executedBy: string | null;
  approvedBy: string | null;
  /** Observed supply/demand response after the action. */
  observedResponse: string | null;
  actualMissions: number | null;
  actualContributionCents: number | null;
  paymentEvidence: string | null;
  settlementEvidence: string | null;
}

export interface LoopInput {
  id: string;
  trigger: string;
  sensing: SensingCoverage;
  state: MarketplaceState;
  prediction: Prediction;
  options: readonly InterventionOption[];
  agentKey: string;
  comparisons: readonly Comparison[];
  experiment: Experiment | null;
  execution: LoopExecution;
  switches?: readonly KillSwitch[];
}

export interface LoopRun {
  id: string;
  trigger: string;
  state: MarketplaceState;
  prediction: Prediction;
  optimiser: OptimiserResult;
  authority: AuthorityDecision | null;
  calibration: TwinCalibration;
  experimentOutcome: ExperimentOutcome | null;
  ledgerEntry: InterventionLedgerEntry;
  stages: LoopStageRecord[];
  /** True only when every stage completed on evidence. */
  closed: boolean;
  blockedAt: LoopStage | null;
  narrative: string;
}

/** §11.29 — the "Why?" payload behind a recommendation. */
export interface WhyExplanation {
  recommendation: string;
  evidence: string[];
  dataSources: string[];
  assumptions: string[];
  model: string;
  confidence: number | null;
  expectedImpact: string;
  risks: string[];
  alternatives: string[];
  decisionThreshold: string;
}

/** §11.30 — the "What if?" payload behind a recommendation. */
export interface WhatIfBranch {
  question: string;
  outcome: string;
}

export function runAdaptiveLoop(input: LoopInput): LoopRun {
  const stages: LoopStageRecord[] = [];
  const optimiser = optimiseInterventions(input.state.id, input.options, input.state.valueAtRiskCents);
  const best = optimiser.best;

  /* SENSE */
  stages.push({
    stage: "sense",
    status: input.sensing.observed > 0 ? "complete" : "withheld",
    detail: `${input.sensing.observed} of ${input.sensing.instrumented} instrumented signals observed; ${input.sensing.rejected} envelope(s) rejected`,
    evidence: "Enterprise sensing layer (§11.1)",
  });

  /* UNDERSTAND */
  stages.push({
    stage: "understand",
    status: input.state.label === "unmeasured" ? "withheld" : "complete",
    detail: input.state.narrative,
    evidence: `State engine cell ${input.state.id} at ${input.state.completeness}% dimensional completeness`,
  });

  /* PREDICT */
  stages.push({
    stage: "predict",
    status: input.prediction.sufficientEvidence ? "complete" : "withheld",
    detail: input.prediction.sufficientEvidence
      ? `${input.prediction.forecast.label} ${input.prediction.forecast.value} (${input.prediction.confidence}% confidence, band ${input.prediction.uncertainty?.low}–${input.prediction.uncertainty?.high})`
      : input.prediction.forecast.note ?? "Forecast withheld",
    evidence: input.prediction.method,
  });

  /* SIMULATE */
  stages.push({
    stage: "simulate",
    status: optimiser.ranked.length > 0 ? "complete" : "withheld",
    detail: `${optimiser.ranked.length} intervention(s) valued against the do-nothing baseline; ${optimiser.unquantified} unquantified`,
    evidence: "Scenario engine (§11.4)",
  });

  /* DECIDE */
  stages.push({
    stage: "decide",
    status: best ? "complete" : "withheld",
    detail: optimiser.narrative,
    evidence: "Next Best Action optimiser ranked on EIEV (§11.5)",
  });

  /* APPROVE */
  const authority = best
    ? authoriseAction({
        agentKey: input.agentKey,
        intervention: best.option.kind,
        valueCents: best.netValueCents,
        confidence: best.option.confidence,
        switches: input.switches,
      })
    : null;

  const approvalSatisfied = authority
    ? authority.allowed && (!authority.requiresApproval || input.execution.approvedBy !== null)
    : false;

  stages.push({
    stage: "approve",
    status: authority === null ? "withheld" : approvalSatisfied ? "complete" : "blocked",
    detail: authority === null
      ? "No recommendation reached the approval gate"
      : `${AUTONOMY_LABEL[authority.effectiveLevel]}${
          authority.requiresApproval
            ? input.execution.approvedBy
              ? ` — approved by ${input.execution.approvedBy} (${authority.approverRole})`
              : ` — awaiting ${authority.approverRole}`
            : " — executes under guardrails"
        }. ${authority.reasons.join("; ")}`,
    evidence: `Policy ${authority?.policy?.id ?? "none"} · kill switch ${authority?.killSwitchScope ?? "n/a"}`,
  });

  /* ACT */
  stages.push({
    stage: "act",
    status: !approvalSatisfied ? "blocked" : input.execution.executed ? "complete" : "withheld",
    detail: !approvalSatisfied
      ? "Execution correctly blocked — authority not satisfied"
      : input.execution.executed
        ? `${INTERVENTION_LABEL[best!.option.kind]} executed by ${input.execution.executedBy ?? "the authorised workflow"}`
        : "Authorised but not yet executed",
    evidence: "Authorised intervention workflow",
  });

  /* OBSERVE */
  stages.push({
    stage: "observe",
    status: input.execution.observedResponse ? "complete" : "withheld",
    detail: input.execution.observedResponse ?? "No post-action supply or demand response observed",
    evidence: "Marketplace telemetry",
  });

  /* MEASURE */
  const measured = input.execution.actualContributionCents !== null;
  stages.push({
    stage: "measure",
    status: measured ? "complete" : "withheld",
    detail: measured
      ? `Actual contribution KES ${Math.round((input.execution.actualContributionCents ?? 0) / 100).toLocaleString()} across ${input.execution.actualMissions ?? 0} mission(s); payment ${input.execution.paymentEvidence ?? "not linked"}; settlement ${input.execution.settlementEvidence ?? "not linked"}`
      : "Actual economic outcome not measured — no value may be claimed",
    evidence: "Transaction spine (payment, settlement, contribution)",
  });

  /* LEARN */
  const calibration = calibrateTwin(input.comparisons);
  const experimentOutcome = input.experiment ? evaluateExperiment(input.experiment) : null;
  stages.push({
    stage: "learn",
    status: experimentOutcome && experimentOutcome.causal !== "not_measured" ? "complete" : "withheld",
    detail: experimentOutcome
      ? experimentOutcome.narrative
      : "No comparison design attached — the loop may not attribute value to the intervention",
    evidence: "AI Experiment Lab and causal layer (§11.14, §11.15)",
  });

  /* ADAPT */
  const adapted = calibration.results.some((r) => r.status !== "unmeasured");
  stages.push({
    stage: "adapt",
    status: adapted ? "complete" : "withheld",
    detail: calibration.narrative,
    evidence: "Digital twin → reality comparator (§11.12)",
  });

  const firstBlocked = stages.find((s) => s.status !== "complete");

  const variancePct =
    input.prediction.forecast.value === null || input.execution.actualMissions === null || input.prediction.forecast.value === 0
      ? null
      : Math.round(((input.execution.actualMissions - input.prediction.forecast.value) / input.prediction.forecast.value) * 1000) / 10;

  const ledgerEntry: InterventionLedgerEntry = {
    id: input.id,
    interventionClass: best ? INTERVENTION_LABEL[best.option.kind] : "none selected",
    prediction: input.prediction.forecast.value === null
      ? "withheld"
      : `${input.prediction.forecast.label}: ${input.prediction.forecast.value}`,
    action: input.execution.executed && best ? INTERVENTION_LABEL[best.option.kind] : "not executed",
    actualOutcome: input.execution.observedResponse,
    variancePct,
    economicImpactCents: experimentOutcome?.incrementalContributionCents ?? null,
    causal: experimentOutcome?.causal ?? "not_measured",
    lesson: experimentOutcome
      ? `${experimentOutcome.decision.replace(/_/g, " ")}: ${experimentOutcome.narrative}`
      : null,
  };

  return {
    id: input.id,
    trigger: input.trigger,
    state: input.state,
    prediction: input.prediction,
    optimiser,
    authority,
    calibration,
    experimentOutcome,
    ledgerEntry,
    stages,
    closed: firstBlocked === undefined,
    blockedAt: firstBlocked?.stage ?? null,
    narrative: firstBlocked === undefined
      ? `Loop closed on ${input.trigger}: sensed, understood, predicted, simulated, decided, approved, executed, observed, measured, learned and adapted.`
      : `Loop open at ${LOOP_STAGE_LABEL[firstBlocked.stage]} (${firstBlocked.status}): ${firstBlocked.detail}`,
  };
}

/** §11.29 — build the "Why this recommendation?" explanation from the run. */
export function explainRun(run: LoopRun): WhyExplanation | null {
  const best = run.optimiser.best ?? run.optimiser.ranked[0];
  if (!best) return null;
  return {
    recommendation: `${INTERVENTION_LABEL[best.option.kind]} — ${best.option.description}`,
    evidence: [
      run.state.narrative,
      best.rationale,
      run.prediction.sufficientEvidence
        ? `Forecast ${run.prediction.forecast.value} at ${run.prediction.confidence}% confidence`
        : "Forecast withheld for insufficient history",
    ],
    dataSources: [
      run.state.observation.asOf ? `State cell ${run.state.id} as of ${run.state.observation.asOf}` : `State cell ${run.state.id} (timestamp unknown)`,
      run.prediction.forecast.source,
    ],
    assumptions: [
      "Contribution per mission observed in the transaction spine holds for incremental missions",
      "Provider response to the intervention matches the stated confidence",
    ],
    model: run.prediction.method,
    confidence: best.option.confidence,
    expectedImpact:
      best.eiev === null
        ? "Not quantifiable"
        : `EIEV KES ${Math.round(best.eiev / 100).toLocaleString()} (contribution KES ${Math.round((best.expectedContributionCents ?? 0) / 100).toLocaleString()} less cost KES ${Math.round((best.option.costCents ?? 0) / 100).toLocaleString()})`,
    risks: [
      `Risk score ${best.option.riskScore}/100`,
      `Operational complexity ${best.option.operationalComplexity}/100`,
      ...best.harms,
    ],
    alternatives: run.optimiser.ranked
      .filter((r) => r.option.id !== best.option.id)
      .slice(0, 4)
      .map((r) => `${INTERVENTION_LABEL[r.option.kind]} — ${r.verdict}${r.eiev === null ? "" : ` (EIEV KES ${Math.round(r.eiev / 100).toLocaleString()})`}`),
    decisionThreshold: `Recommended only above zero EIEV with confidence ≥ 60% and no material customer, provider or fulfilment harm; authority capped at ${
      run.authority ? AUTONOMY_LABEL[run.authority.effectiveLevel] : "A0"
    }`,
  };
}

/** §11.30 — the "What if?" branches for a run. */
export function whatIf(run: LoopRun): WhatIfBranch[] {
  const best = run.optimiser.best ?? run.optimiser.ranked[0] ?? null;
  const scale = (n: number | null, factor: number) => (n === null ? null : Math.round(n * factor));
  const kes = (n: number | null) => (n === null ? "not quantifiable" : `KES ${Math.round(n / 100).toLocaleString()}`);

  return [
    { question: "What if we do nothing?", outcome: run.optimiser.baseline.rationale },
    {
      question: "What if we act now?",
      outcome: best ? `${INTERVENTION_LABEL[best.option.kind]} at expected EIEV ${kes(best.eiev)}` : "No feasible action is available to execute",
    },
    {
      question: "What if demand is 20% lower?",
      outcome: best ? `EIEV falls to approximately ${kes(scale(best.eiev, 0.8))} and the intervention may stop clearing its cost` : "Not applicable",
    },
    {
      question: "What if supply fails to respond?",
      outcome: best
        ? `Cost of ${kes(best.option.costCents)} is incurred with no incremental contribution — net ${kes(best.option.costCents === null ? null : -best.option.costCents)}`
        : "Not applicable",
    },
    {
      question: "What if the provider cancels?",
      outcome: "The mission re-enters matching; cancellation policy applies and the fulfilment SLO absorbs the delay",
    },
    {
      question: "What if price changes?",
      outcome: "Pricing may only move within the ±8% authorised corridor; beyond that the decision escalates to the Head of Commercial",
    },
  ];
}
