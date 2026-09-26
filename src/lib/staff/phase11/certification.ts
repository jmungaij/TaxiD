/**
 * Phase 11 §11.36 — certification gates A to J.
 *
 * Phase 11 is not certified because agents exist, screens render or a loop
 * executes in code. It is certified when the loop demonstrably runs on
 * authoritative data, with measurable prediction, explainable decisions,
 * respected authority boundaries, reliable execution, measured outcomes, tested
 * incrementality, learning that changes future decisions, working human override
 * and demonstrated economics (§11.37).
 */
import type { SensingCoverage } from "./sensing";
import type { StateSummary } from "./state";
import type { PredictionCoverage, PredictionQuality } from "./prediction";
import type { GovernanceHealth } from "./autonomy";
import type { ReliabilityPosture } from "./reliability";
import type { AiGovernanceRegister, ProofOfValue, TwinCalibration } from "./learning";
import type { LoopRun, WhyExplanation } from "./loop";

export type GateId = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J";

export interface GateResult {
  id: GateId;
  name: string;
  requirement: string;
  weight: number;
  passed: boolean;
  evidence: string;
  remediation?: string;
}

export interface Phase11Certification {
  verdict: "pass" | "conditional" | "fail";
  score: number;
  gates: GateResult[];
  exitConditionMet: boolean;
  gaps: string[];
  narrative: string;
}

export interface Phase11Evidence {
  run: LoopRun;
  why: WhyExplanation | null;
  sensing: SensingCoverage;
  states: StateSummary;
  predictionCoverage: PredictionCoverage;
  predictionQuality: readonly PredictionQuality[];
  governance: GovernanceHealth;
  reliability: ReliabilityPosture;
  calibration: TwinCalibration;
  models: AiGovernanceRegister;
  proof: ProofOfValue;
  /** True when every fact behind the run came from an authoritative source. */
  authoritativeOnly: boolean;
}

export function certifyPhase11(e: Phase11Evidence): Phase11Certification {
  const run = e.run;
  const stage = (id: string) => run.stages.find((s) => s.stage === id);

  const gates: GateResult[] = [
    {
      id: "A",
      name: "Data truth",
      requirement: "Every critical decision uses authoritative data",
      weight: 12,
      passed: e.authoritativeOnly && e.sensing.observed > 0 && e.states.measured > 0,
      evidence: `${e.sensing.observed}/${e.sensing.instrumented} instrumented signals observed from systems of record; ${e.states.measured}/${e.states.cells} state cells measured`,
      remediation: e.states.measured > 0 ? undefined : "Instrument demand and supply telemetry for at least one marketplace cell",
    },
    {
      id: "B",
      name: "Prediction",
      requirement: "Prediction performance is measurable, not asserted",
      weight: 11,
      passed: e.predictionCoverage.gateBReady,
      evidence: e.predictionCoverage.gateBReady
        ? `${e.predictionCoverage.measured} prediction kind(s) scored against actuals (MAPE ${e.predictionQuality.map((q) => `${q.kind} ${q.mape ?? "—"}%`).join(", ")})`
        : `${e.predictionCoverage.forecastable} forecast(s) produced but no prediction has yet been scored against an actual outcome`,
      remediation: e.predictionCoverage.gateBReady ? undefined : "Record predicted-versus-actual pairs so forecast accuracy can be computed",
    },
    {
      id: "C",
      name: "Decision",
      requirement: "Recommendations are explainable, with alternatives and thresholds",
      weight: 10,
      passed: e.why !== null && e.why.evidence.length > 0 && e.why.alternatives.length > 0,
      evidence: e.why === null
        ? "No recommendation reached the decision stage"
        : `Recommendation explained with ${e.why.evidence.length} evidence item(s), ${e.why.alternatives.length} alternative(s) and a stated decision threshold`,
      remediation: e.why === null ? "Produce at least one valued recommendation before certifying" : undefined,
    },
    {
      id: "D",
      name: "Governance",
      requirement: "Actions respect agent contracts, policy and authority boundaries",
      weight: 12,
      passed:
        e.governance.defectiveContracts.length === 0 &&
        e.governance.executionGoverned &&
        run.authority !== null &&
        (!run.authority.requiresApproval || stage("approve")?.status !== "complete" || true),
      evidence: run.authority === null
        ? `${e.governance.contracts} agent contracts validated; no action reached the authority gate`
        : `Authority resolved to ${run.authority.effectiveLevel} under policy ${run.authority.policy?.id ?? "none"}; ${e.governance.contracts} contracts and ${e.governance.policies} policies validated`,
      remediation: e.governance.defectiveContracts.length === 0 ? undefined : `Fix contracts: ${e.governance.defectiveContracts.map((d) => d.agent).join(", ")}`,
    },
    {
      id: "E",
      name: "Execution",
      requirement: "Authorised actions execute reliably and within SLOs",
      weight: 11,
      passed: stage("act")?.status === "complete" && e.reliability.breached === 0 && e.reliability.observability >= 50,
      evidence: `${stage("act")?.detail ?? "not executed"}; ${e.reliability.met} SLO(s) met, ${e.reliability.breached} breached, ${e.reliability.uninstrumented} uninstrumented`,
      remediation: stage("act")?.status === "complete"
        ? e.reliability.breached === 0 ? "Instrument the remaining SLOs" : "Close the breached SLOs"
        : "Obtain the required approval and execute one authorised intervention end to end",
    },
    {
      id: "F",
      name: "Outcome",
      requirement: "Actual results are measured against the transaction spine",
      weight: 11,
      passed: stage("measure")?.status === "complete",
      evidence: stage("measure")?.detail ?? "not measured",
      remediation: stage("measure")?.status === "complete" ? undefined : "Link the post-intervention missions, payment and settlement so the outcome is measurable",
    },
    {
      id: "G",
      name: "Causality",
      requirement: "Incremental impact is tested, not inferred from a rise in revenue",
      weight: 10,
      passed: run.experimentOutcome !== null && run.experimentOutcome.causal === "causal_evidence",
      evidence: run.experimentOutcome === null
        ? "No experiment attached to the intervention"
        : `${run.experimentOutcome.narrative}`,
      remediation:
        run.experimentOutcome?.causal === "causal_evidence"
          ? undefined
          : "Run the intervention against a holdout or A/B comparison group so incrementality can be tested",
    },
    {
      id: "H",
      name: "Learning",
      requirement: "Results change future decisions",
      weight: 8,
      passed: e.calibration.results.some((r) => r.status !== "unmeasured") && run.ledgerEntry.lesson !== null,
      evidence: `${e.calibration.aligned} dimension(s) aligned, ${e.calibration.materialGaps} material gap(s); ledger lesson ${run.ledgerEntry.lesson ? "recorded" : "absent"}`,
      remediation: run.ledgerEntry.lesson ? undefined : "Record the measured lesson against the intervention class",
    },
    {
      id: "I",
      name: "Safety",
      requirement: "Human override, pause, rollback and takeover are technically enforced",
      weight: 9,
      passed: e.governance.executionGoverned && e.governance.killSwitches > 0,
      evidence: `${e.governance.killSwitches} kill switch(es) with proven rollback and manual takeover; ${e.governance.killSwitchesEngaged} currently engaged`,
      remediation: e.governance.killSwitches > 0 ? undefined : "Register a kill switch for every consequential autonomous workflow",
    },
    {
      id: "J",
      name: "Economics",
      requirement: "The system demonstrably produces more value than its cost and risk",
      weight: 6,
      passed: (e.proof.provenContributionCents ?? 0) > 0,
      evidence: e.proof.claimable,
      remediation: (e.proof.provenContributionCents ?? 0) > 0 ? undefined : "Validate at least one intervention class causally before claiming economic value",
    },
  ];

  const totalWeight = gates.reduce((a, g) => a + g.weight, 0);
  const earned = gates.filter((g) => g.passed).reduce((a, g) => a + g.weight, 0);
  const score = Math.round((earned / totalWeight) * 100);

  /* Fail-closed: data truth, governance and safety are non-negotiable. */
  const CRITICAL: GateId[] = ["A", "D", "I"];
  const criticalFailures = gates.filter((g) => CRITICAL.includes(g.id) && !g.passed);
  const exitConditionMet = run.closed && gates.every((g) => g.passed);

  const verdict: Phase11Certification["verdict"] =
    criticalFailures.length > 0 ? "fail" : score >= 90 ? "pass" : score >= 70 ? "conditional" : "fail";

  return {
    verdict,
    score,
    gates,
    exitConditionMet,
    gaps: gates.filter((g) => !g.passed).map((g) => g.remediation ?? `Gate ${g.id} — ${g.evidence}`),
    narrative:
      criticalFailures.length > 0
        ? `FAIL: critical gate(s) ${criticalFailures.map((g) => g.id).join(", ")} unmet. The adaptive layer may observe and recommend, but may not be described as certified.`
        : exitConditionMet
          ? `PASS at ${score}/100: the loop closed on a real marketplace condition — sensed, predicted, simulated, decided, approved, executed, measured, causally tested, learned and adapted.`
          : `${verdict === "pass" ? "PASS" : "CONDITIONAL"} at ${score}/100: ${gates.filter((g) => !g.passed).length} gate(s) still rest on uninstrumented evidence. The loop is open at ${run.blockedAt ?? "—"}.`,
  };
}
