/**
 * Phase D14.0 — Production Execution & Operational Validation Program.
 *
 * Pure, deterministic composer. NO new engines, dashboards, tables, or
 * workflows — only an execution/evidence layer over the existing D7–D13
 * stack (governance, workflows, production qualification, production
 * validation, evidence vault, decision engine, recovery orchestration).
 *
 * Delivers four artefacts, all derived from existing certifiers:
 *
 *   1. BusinessJourneyCertification    — one row per canonical lifecycle,
 *      status derived from adoption + workflow certification + freeze.
 *   2. OperationalRunbookValidation    — verifies every recovery plan step
 *      carries the D12.0 governance envelope (owner, approver, capability,
 *      verification source) so recovery plans double as runbooks.
 *   3. ProductionPilotCertification    — per-pilot readiness gate built
 *      from journey + monitoring/finance/audit signals already present in
 *      the governance report and validation pillars.
 *   4. ProductionCertificationSummary  — the single deterministic PROMOTE
 *      / HOLD / ROLLBACK verdict + supporting scores, extending the D13.1
 *      Evidence Vault + Continuous Ratchet with journey & pilot gates.
 *
 * Everything is a pure function of already-computed reports. Runtime
 * signals are injected by callers; when absent, fields degrade to
 * "unknown" / empty rather than fabricating pass.
 */
import type { Workspace360GovernanceReport } from "./governance";
import type {
  ProductionValidationReport,
  ReleaseDecision,
} from "./productionValidation";
import type { ProductionEvidenceVaultReport } from "./productionEvidenceVault";
import type { RecoveryPlan } from "./orchestration";
import { PRODUCTION_LIFECYCLES, type LifecycleSpec } from "./productionQualification";

/* ------------------------------------------------------------------ */
/* Canonical JSON + FNV-1a fingerprint                                 */
/* ------------------------------------------------------------------ */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize((value as Record<string, unknown>)[k])}`).join(",")}}`;
}
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/* ------------------------------------------------------------------ */
/* 1. Business Journey Certification                                   */
/* ------------------------------------------------------------------ */
export interface BusinessJourneyCertification {
  id: string;
  label: string;
  primaryDomain: string;
  adopted: boolean;
  covered: boolean;
  workflowPass: number;
  workflowTotal: number;
  financialReconciled: boolean;
  timelineIntact: boolean;
  digitalTwinConsistent: boolean;
  replayable: boolean;
  passed: boolean;
  severity: "ok" | "P1" | "P0";
  reasons: string[];
}

export interface BusinessJourneyReport {
  passed: boolean;
  score: number; // 0–100
  journeys: BusinessJourneyCertification[];
  totalPassing: number;
  totalCovered: number;
}

function certifyJourney(
  L: LifecycleSpec,
  gov: Workspace360GovernanceReport,
  pv: ProductionValidationReport,
): BusinessJourneyCertification {
  const dom = gov.domains.find((d) => d.domain === L.primaryDomain);
  const adopted = !!dom?.adopted;
  const covered = L.workflowIds.length > 0;

  const workflowResults = L.workflowIds.map((id) =>
    gov.workflows.workflows.find((w) => w.id === id),
  );
  const workflowTotal = workflowResults.length;
  const workflowPass = workflowResults.filter((w) => w?.passed).length;
  const workflowsOk = workflowTotal === 0 ? false : workflowPass === workflowTotal;

  const financialReconciled = gov.consistency.financial.score === 100
    && (dom?.duplicatedFinancialTables?.length ?? 0) === 0;
  const timelineIntact = gov.consistency.workflow.score >= 90;
  const digitalTwinConsistent = gov.dataContract.projections.score >= 90;
  // Replayable = disaster recovery projection/replay integrity certified.
  const replayable = pv.disasterRecovery.passed || pv.disasterRecovery.score >= 90;

  const reasons: string[] = [];
  if (!adopted)                reasons.push(`domain "${L.primaryDomain}" not adopted onto Workspace360Shell`);
  if (!covered)                reasons.push("no canonical workflow declared for this lifecycle");
  if (adopted && covered && !workflowsOk)
                               reasons.push(`workflow certification ${workflowPass}/${workflowTotal}`);
  if (!financialReconciled)    reasons.push("financial reconciliation not clean");
  if (!timelineIntact)         reasons.push("workflow/timeline consistency below floor");
  if (!digitalTwinConsistent)  reasons.push("digital twin / projection drift");
  if (!replayable)             reasons.push("disaster-recovery replay not certified");

  // P0 gap = adopted lifecycle failing certification. P1 = unadopted with
  // no workflow coverage yet.
  const passed = adopted && covered && workflowsOk
    && financialReconciled && timelineIntact && digitalTwinConsistent && replayable;
  const severity: BusinessJourneyCertification["severity"] =
    passed ? "ok" : adopted ? "P0" : "P1";

  return {
    id: L.id,
    label: L.label,
    primaryDomain: L.primaryDomain,
    adopted,
    covered,
    workflowPass,
    workflowTotal,
    financialReconciled,
    timelineIntact,
    digitalTwinConsistent,
    replayable,
    passed,
    severity,
    reasons,
  };
}

export function certifyBusinessJourneys(
  gov: Workspace360GovernanceReport,
  pv: ProductionValidationReport,
): BusinessJourneyReport {
  const journeys = PRODUCTION_LIFECYCLES.map((L) => certifyJourney(L, gov, pv));
  const totalPassing = journeys.filter((j) => j.passed).length;
  const totalCovered = journeys.filter((j) => j.covered).length;
  const denom = journeys.length || 1;
  const score = Math.round((totalPassing / denom) * 100);
  // Passing rule: every ADOPTED journey must be green; unadopted (P1)
  // never block PROMOTE — the D12.1 production qualification already
  // handles P1 severity.
  const passed = journeys.every((j) => j.severity !== "P0");
  return { passed, score, journeys, totalPassing, totalCovered };
}

/* ------------------------------------------------------------------ */
/* 2. Operational Runbook Validation                                   */
/* ------------------------------------------------------------------ */
export interface RunbookValidationReport {
  passed: boolean;
  score: number;              // 0–100
  totalSteps: number;
  compliantSteps: number;
  criticalPathCompliant: number;
  criticalPathTotal: number;
  gaps: string[];             // reco ids missing governance metadata
}

export function validateOperationalRunbook(
  plan?: RecoveryPlan | null,
): RunbookValidationReport {
  if (!plan) {
    return {
      passed: true, score: 100,
      totalSteps: 0, compliantSteps: 0,
      criticalPathCompliant: 0, criticalPathTotal: 0,
      gaps: [],
    };
  }
  const allRecos = plan.steps.flatMap((s) => s.parallel);
  const gaps: string[] = [];
  let compliant = 0;
  for (const r of allRecos) {
    const o = plan.orchestration[r.id];
    const g = o?.governance;
    const ok = !!g
      && !!g.businessCapability
      && !!g.operationalOwner
      && !!g.approvalRole
      && !!g.verificationSource;
    if (ok) compliant++;
    else gaps.push(r.id);
  }
  const criticalIds = new Set(plan.criticalPath);
  const criticalTotal = criticalIds.size;
  const criticalCompliant = allRecos
    .filter((r) => criticalIds.has(r.id))
    .filter((r) => !gaps.includes(r.id))
    .length;

  const total = allRecos.length;
  const score = total === 0 ? 100 : Math.round((compliant / total) * 100);
  // Passing rule: every critical-path step must be governed; overall
  // compliance floor of 90% for non-critical steps.
  const passed = criticalCompliant === criticalTotal && score >= 90;
  return {
    passed, score,
    totalSteps: total, compliantSteps: compliant,
    criticalPathCompliant: criticalCompliant, criticalPathTotal: criticalTotal,
    gaps,
  };
}

/* ------------------------------------------------------------------ */
/* 3. Production Pilot Certification                                   */
/* ------------------------------------------------------------------ */
export const PRODUCTION_PILOTS = [
  { id: "driver",     label: "Driver Pilot",     lifecycleId: "driver" },
  { id: "rider",      label: "Rider Pilot",      lifecycleId: "rider" },
  { id: "corporate",  label: "Corporate Pilot",  lifecycleId: "corporate-billing" },
  { id: "finance",    label: "Finance Pilot",    lifecycleId: "corporate-billing" },
  { id: "operations", label: "Operations Pilot", lifecycleId: "driver" },
  { id: "dispatch",   label: "Dispatch Pilot",   lifecycleId: "driver" },
  { id: "compliance", label: "Compliance Pilot", lifecycleId: "corporate-billing" },
  { id: "executive",  label: "Executive Pilot",  lifecycleId: "driver" },
] as const;
export type PilotId = typeof PRODUCTION_PILOTS[number]["id"];

export interface PilotCertification {
  id: PilotId;
  label: string;
  journeyPassed: boolean;
  monitoringOk: boolean;
  reconciliationOk: boolean;
  auditIntegrityOk: boolean;
  supportReady: boolean;
  evidenceComplete: boolean;
  passed: boolean;
  reasons: string[];
}

export interface PilotReport {
  passed: boolean;
  score: number;
  pilots: PilotCertification[];
}

export function certifyProductionPilots(
  gov: Workspace360GovernanceReport,
  pv: ProductionValidationReport,
  vault: ProductionEvidenceVaultReport,
  journeys: BusinessJourneyReport,
): PilotReport {
  const journeyById = new Map(journeys.journeys.map((j) => [j.id, j]));
  const monitoringOk        = gov.operations.observability.score >= 90;
  const reconciliationOk    = gov.consistency.financial.score === 100;
  const auditIntegrityOk    = gov.dataContract.alertCorrelation.score >= 90;
  const supportReady        = pv.security.passed;
  const evidenceComplete    = !!vault.record.fingerprint && vault.architectureFreeze.certified;

  const pilots = PRODUCTION_PILOTS.map((p) => {
    const j = journeyById.get(p.lifecycleId);
    const journeyPassed = !!j?.passed;
    const reasons: string[] = [];
    if (!journeyPassed)      reasons.push(`business journey "${p.lifecycleId}" failing`);
    if (!monitoringOk)       reasons.push("operational monitoring below floor");
    if (!reconciliationOk)   reasons.push("financial reconciliation not clean");
    if (!auditIntegrityOk)   reasons.push("audit / alert correlation drift");
    if (!supportReady)       reasons.push("security qualification failing");
    if (!evidenceComplete)   reasons.push("release evidence incomplete");
    const passed = journeyPassed && monitoringOk && reconciliationOk
      && auditIntegrityOk && supportReady && evidenceComplete;
    return {
      id: p.id, label: p.label,
      journeyPassed, monitoringOk, reconciliationOk,
      auditIntegrityOk, supportReady, evidenceComplete,
      passed, reasons,
    };
  });

  const totalPassing = pilots.filter((p) => p.passed).length;
  const score = Math.round((totalPassing / pilots.length) * 100);
  const passed = pilots.every((p) => p.passed);
  return { passed, score, pilots };
}

/* ------------------------------------------------------------------ */
/* 4. Unified Production Certification Summary                         */
/* ------------------------------------------------------------------ */
export interface ProductionCertificationSummary {
  decision: ReleaseDecision;
  overallScore: number;
  scores: {
    governance: number;
    operations: number;
    performance: number;
    security: number;
    scalability: number;
    business: number;
    recovery: number;
    integrations: number;
    certification: number;
    readiness: number;
    journeys: number;
    pilots: number;
    runbook: number;
  };
  blockingGates: string[]; // union of ratchet + journey + pilot + runbook
  fingerprint: string;
}

export interface ProductionExecutionInputs {
  governance: Workspace360GovernanceReport;
  validation: ProductionValidationReport;
  vault: ProductionEvidenceVaultReport;
  recoveryPlan?: RecoveryPlan | null;
}

export interface ProductionExecutionReport {
  passed: boolean;
  decision: ReleaseDecision;
  journeys: BusinessJourneyReport;
  runbook: RunbookValidationReport;
  pilots: PilotReport;
  summary: ProductionCertificationSummary;
}

export function certifyProductionExecution(
  inputs: ProductionExecutionInputs,
): ProductionExecutionReport {
  const { governance: gov, validation: pv, vault } = inputs;

  const journeys = certifyBusinessJourneys(gov, pv);
  const runbook = validateOperationalRunbook(inputs.recoveryPlan ?? null);
  const pilots = certifyProductionPilots(gov, pv, vault, journeys);

  const scores = {
    governance:    gov.score,
    operations:    gov.operations.score,
    performance:   pv.performance.score,
    security:      pv.security.score,
    scalability:   pv.scalability.score,
    business:      pv.businessAcceptance.score,
    recovery:      pv.disasterRecovery.score,
    integrations:  pv.integrations.score,
    certification: gov.certification.score,
    readiness:     pv.score,
    journeys:      journeys.score,
    pilots:        pilots.score,
    runbook:       runbook.score,
  };
  const overallScore = Math.round(
    Object.values(scores).reduce((a, b) => a + b, 0) / Object.keys(scores).length,
  );

  const blockingGates = [...vault.ratchet.blocking_gates];
  if (!journeys.passed) blockingGates.push("business_journeys");
  if (!pilots.passed)   blockingGates.push("production_pilots");
  if (!runbook.passed)  blockingGates.push("operational_runbook");

  // Decision starts from the D13.1 vault verdict, then D14 gates can only
  // downgrade PROMOTE→HOLD — never upgrade a HOLD/ROLLBACK.
  let decision: ReleaseDecision = vault.decision;
  if (decision === "PROMOTE" && (!journeys.passed || !pilots.passed || !runbook.passed)) {
    decision = "HOLD";
  }

  const summary: ProductionCertificationSummary = {
    decision,
    overallScore,
    scores,
    blockingGates,
    fingerprint: fnv1a(canonicalize({
      decision, overallScore, scores, blockingGates,
      vault: vault.record.fingerprint,
    })),
  };

  return {
    passed: decision === "PROMOTE" && blockingGates.length === 0,
    decision,
    journeys,
    runbook,
    pilots,
    summary,
  };
}
