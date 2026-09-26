/**
 * Phase 11 — SAFARID Autonomous Adaptive Marketplace Engine, public API.
 *
 * SAFARID does not own mobility resources. It owns the orchestration layer. Phase
 * 11 sits above that layer and closes the loop: sense, understand, predict,
 * simulate, decide, approve, act, observe, measure, learn, adapt — under human
 * governance, on authoritative data, with every unsupported figure reported as an
 * instrumentation gap.
 */
export * from "./sensing";
export * from "./state";
export * from "./prediction";
export * from "./scenario";
export * from "./autonomy";
export * from "./reliability";
export * from "./learning";
export * from "./loop";
export * from "./certification";
export * from "./dataSource";

import { assessSensing, type SensingCoverage } from "./sensing";
import { priorityState, summariseStates, type MarketplaceState, type StateSummary } from "./state";
import { assessPredictions, predict, scorePredictions, type Prediction, type PredictionCoverage, type PredictionQuality } from "./prediction";
import { assessIncentives, checkFlywheel, type FlywheelCheck, type IncentiveBalance } from "./scenario";
import { assessGovernance, KILL_SWITCHES, type GovernanceHealth } from "./autonomy";
import {
  assessReliability, classifyExceptions, respondToRisk, summariseExceptions, summariseTrust,
  type ExceptionLearning, type ReliabilityPosture, type RiskFinding, type TrustIntelligenceSummary,
} from "./reliability";
import { proveValue, registerModels, type AiGovernanceRegister, type ProofOfValue } from "./learning";
import { explainRun, runAdaptiveLoop, whatIf, type LoopRun, type WhatIfBranch, type WhyExplanation } from "./loop";
import { certifyPhase11, type Phase11Certification } from "./certification";
import {
  buildComparisons, buildExperiment, buildInterventionOptions, buildModelRegistry,
  buildPredictionInputs, buildSignals, buildSlos, buildStates, loadAdaptiveFacts, type AdaptiveFacts,
} from "./dataSource";

export interface AdaptiveState {
  facts: AdaptiveFacts;
  sensing: SensingCoverage;
  states: MarketplaceState[];
  stateSummary: StateSummary;
  priorityCell: MarketplaceState | null;
  predictions: Prediction[];
  predictionQuality: PredictionQuality[];
  predictionCoverage: PredictionCoverage;
  run: LoopRun;
  why: WhyExplanation | null;
  whatIf: WhatIfBranch[];
  incentives: IncentiveBalance[];
  flywheel: FlywheelCheck;
  governance: GovernanceHealth;
  reliability: ReliabilityPosture;
  trust: TrustIntelligenceSummary;
  exceptions: ExceptionLearning;
  models: AiGovernanceRegister;
  proof: ProofOfValue;
  certification: Phase11Certification;
  gaps: string[];
}

/**
 * Runs the whole adaptive layer once, against the real marketplace condition the
 * transaction spine can evidence today.
 */
export async function loadAdaptiveState(): Promise<AdaptiveState> {
  const facts = await loadAdaptiveFacts();

  const signals = buildSignals(facts);
  const sensing = assessSensing(signals);

  const states = buildStates(facts);
  const stateSummary = summariseStates(states);
  const priorityCell = priorityState(states) ?? states[0] ?? null;

  const predictions = priorityCell
    ? buildPredictionInputs(facts, priorityCell.id).map(predict)
    : [];
  const demandPrediction = predictions.find((p) => p.kind === "demand");

  /* Prediction accuracy is scored only from recorded predicted/actual pairs. */
  const actual = facts.dailyMissions.length === 0 ? null : facts.dailyMissions[facts.dailyMissions.length - 1];
  const outcomes =
    demandPrediction && demandPrediction.forecast.value !== null && actual !== null && facts.dailyMissions.length >= 4
      ? [{ kind: "demand" as const, predicted: demandPrediction.forecast.value, actual, confidence: demandPrediction.confidence }]
      : [];
  const predictionQuality = scorePredictions(outcomes);
  const predictionCoverage = assessPredictions(predictions, predictionQuality);

  const options = priorityCell ? buildInterventionOptions(priorityCell, facts) : [];
  const comparisons = buildComparisons(facts, demandPrediction?.forecast.value ?? null);
  const experiment = buildExperiment(facts);

  const run = runAdaptiveLoop({
    id: "p11-airport-am-peak",
    trigger: priorityCell
      ? `${priorityCell.granularity.service} demand in ${priorityCell.granularity.corridor ?? priorityCell.granularity.city} during ${priorityCell.granularity.window}`
      : "No measurable marketplace condition",
    sensing,
    state: priorityCell ?? states[0],
    prediction:
      demandPrediction ??
      predict({
        kind: "demand", cellId: "unmeasured", horizon: "n/a", unit: "count",
        history: [], source: "commercial_transactions", drivers: [], freshnessHours: null,
      }),
    options,
    agentKey: "orchestrator",
    comparisons,
    experiment,
    execution: {
      /* Nothing is claimed as executed: no authorised intervention has run yet. */
      executed: false,
      executedBy: null,
      approvedBy: null,
      observedResponse: null,
      actualMissions: null,
      actualContributionCents: null,
      paymentEvidence: facts.rows.some((r) => r.payment_ref) ? "linked in the transaction spine" : null,
      settlementEvidence: facts.settledCents === null ? null : "settlement recorded",
    },
    switches: KILL_SWITCHES,
  });

  const scenarioResults = run.optimiser.ranked;
  const governance = assessGovernance();

  const reliability = assessReliability({
    slos: buildSlos(facts),
    mttdMinutes: null,
    mttrMinutes: null,
    eventLagSeconds: null,
    reconciliation:
      facts.recognisedRevenueCents === null || facts.settledCents === null ? "unknown" : "balanced",
  });

  /* Trust findings are only those the spine can evidence — none are fabricated. */
  const riskFindings: RiskFinding[] = facts.rows.some((r) => !r.payment_ref)
    ? [
        {
          id: "risk-unlinked-payment",
          pattern: "payment_anomaly",
          subject: `${facts.rows.filter((r) => !r.payment_ref).length} transaction(s) without a linked payment reference`,
          score: 55,
          explanation: "Fulfilled transactions carry no authoritative payment reference, so revenue cannot be evidenced",
          evidence: ["commercial_transactions.payment_ref is null"],
          verified: false,
          reviewerRole: null,
        },
      ]
    : [];
  const trust = summariseTrust(riskFindings.map(respondToRisk));

  const exceptions = summariseExceptions(
    classifyExceptions(
      run.stages
        .filter((s) => s.status !== "complete")
        .map((s) => ({
          id: `exc-${s.stage}`,
          what: `Adaptive loop ${s.status} at ${s.stage}`,
          where: "Phase 11 adaptive loop",
          why: s.detail,
          affected: "marketplace intelligence",
          economicImpactCents: null,
          resolution: null,
          timeToResolveMinutes: null,
          detectedByAi: true,
          aiRecommendationWorked: null,
          humanInterventionWorked: null,
          signature: `loop:${s.stage}:${s.status}`,
        })),
    ),
  );

  const models = registerModels(buildModelRegistry(facts));
  const proof = proveValue([run.ledgerEntry]);

  const certification = certifyPhase11({
    run,
    why: explainRun(run),
    sensing,
    states: stateSummary,
    predictionCoverage,
    predictionQuality,
    governance,
    reliability,
    calibration: run.calibration,
    models,
    proof,
    authoritativeOnly: facts.transactions > 0,
  });

  return {
    facts,
    sensing,
    states,
    stateSummary,
    priorityCell,
    predictions,
    predictionQuality,
    predictionCoverage,
    run,
    why: explainRun(run),
    whatIf: whatIf(run),
    incentives: assessIncentives(scenarioResults),
    flywheel: checkFlywheel({
      missions: facts.transactions || null,
      grossValueCents: facts.grossValueCents,
      contributionCents: facts.contributionCents,
    }),
    governance,
    reliability,
    trust,
    exceptions,
    models,
    proof,
    certification,
    gaps: [
      ...facts.gaps,
      ...sensing.blindSpots.slice(0, 4).map((b) => `${b} has no system of record`),
      ...certification.gaps,
    ],
  };
}
