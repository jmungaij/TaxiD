/**
 * Yalla Security Control Plane.
 *
 *   Asset Graph ─┐
 *   Threat/Finding ├→ Risk & Decision Engine → Remediation Orchestrator
 *   Policy/Control ┘        ↓                          ↓
 *                    Verification ─→ Regression ─→ Evidence ─→ Posture ─→ Learning
 *
 * Deterministic throughout: authorisation, policy, risk arithmetic, control
 * status and posture are computed from recorded facts. Interpretation and
 * explanation belong to Ask Yalla, which reads this layer — it never overrides it.
 */
export * from "./assetGraph";
export * from "./riskEngine";
export * from "./remediation";
export * from "./posture";
export * from "./learning";

import { rankRemediation, type SecurityFinding, type RiskAssessment } from "./riskEngine";
import { orchestrateRemediation, type RemediationPlan } from "./remediation";
import { computeSecurityPosture, type ControlResult, type SecurityPosture } from "./posture";
import { learnFrom, predictLikelyExposures, type LearningRecord } from "./learning";

export interface ControlPlaneRun {
  assessments: RiskAssessment[];
  plans: RemediationPlan[];
  posture: SecurityPosture;
  learning: LearningRecord[];
  predicted: ReturnType<typeof predictLikelyExposures>;
  /** What a human must look at first, highest risk first. */
  controlTower: Array<{ findingId: string; band: RiskAssessment["band"]; score: number; headline: string; awaiting: string }>;
}

/**
 * One deterministic pass of the control plane. Given findings and control
 * results, it ranks, plans, verifies coverage, generalises and predicts.
 */
export function runControlPlane(
  findings: SecurityFinding[],
  controlResults: ControlResult[] = [],
): ControlPlaneRun {
  const assessments = rankRemediation(findings);
  const plans = orchestrateRemediation(findings, assessments);
  const posture = computeSecurityPosture(controlResults, {
    openP0: assessments.filter((a) => a.band === "P0").length,
    openP1: assessments.filter((a) => a.band === "P1").length,
  });
  const learning = findings.map(learnFrom);
  const predicted = predictLikelyExposures(findings);

  const controlTower = assessments.map((a) => {
    const plan = plans.find((p) => p.findingId === a.findingId);
    return {
      findingId: a.findingId,
      band: a.band,
      score: a.score,
      headline: a.rationale,
      awaiting: plan?.blockedReason
        ? plan.blockedReason
        : plan?.fourEyesRequired
          ? "Second approver before the change lands."
          : "Scheduled remediation.",
    };
  });

  return { assessments, plans, posture, learning, predicted, controlTower };
}
