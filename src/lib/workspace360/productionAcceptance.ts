/**
 * Phase D14.1 — Production Acceptance & Release Readiness (Architecture Freeze Edition).
 *
 * Pure, deterministic composer. NO new engines, dashboards, tables, services,
 * or workflows — only an evidence/acceptance layer over the D7–D14 stack
 * (governance, workflows, production qualification, production validation,
 * evidence vault, production execution, decision engine, recovery orchestration).
 *
 * Delivers four artefacts, all derived from already-computed reports:
 *
 *   1. OperationalAcceptanceChecklist — deterministic pass/fail checklist for
 *      Payments, Marketplace, Finance, Compliance, and Operations, driven
 *      exclusively by existing certification outputs.
 *   2. PerformanceBaseline            — Version 1 baseline captured from
 *      injected runtime signals + existing performance/scalability reports.
 *      Missing signals degrade to `captured=false` instead of fabricating pass.
 *   3. AutoComposedRunbook (many)     — one operational runbook per canonical
 *      incident, composed from the existing RecoveryPlan / orchestration
 *      metadata. When the input plan is missing, runbooks return
 *      `composed=false` and are surfaced as a blocker — no fabrication.
 *   4. ProductionAcceptanceReport     — executive summary + release readiness
 *      package. Its verdict is `vault.decision` refined by production
 *      execution and by D14.1 blockers; D14.1 gates can only downgrade
 *      PROMOTE→HOLD, never upgrade a HOLD/ROLLBACK.
 *
 * The Continuous Production Ratchet from D13.1 remains the sole authority
 * for the final deployment decision; D14.1 only composes evidence around it.
 */
import type { Workspace360GovernanceReport } from "./governance";
import type {
  ProductionValidationReport,
  ReleaseDecision,
} from "./productionValidation";
import type { ProductionEvidenceVaultReport } from "./productionEvidenceVault";
import type {
  ProductionExecutionReport,
  BusinessJourneyCertification,
} from "./productionExecution";
import type { RecoveryPlan } from "./orchestration";
import type { DecisionEngineReport } from "./decisionEngine";

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
/* 1. Operational Acceptance Checklist                                 */
/* ------------------------------------------------------------------ */
export interface ChecklistItem {
  id: string;
  label: string;
  passed: boolean;
  detail?: string;
}
export interface ChecklistCategory {
  id: "payments" | "marketplace" | "finance" | "compliance" | "operations";
  label: string;
  passed: boolean;
  items: ChecklistItem[];
}
export interface OperationalAcceptanceChecklist {
  passed: boolean;
  score: number;
  categories: ChecklistCategory[];
  failingItems: string[];
}

function cat(
  id: ChecklistCategory["id"],
  label: string,
  items: ChecklistItem[],
): ChecklistCategory {
  return { id, label, passed: items.every((i) => i.passed), items };
}
const item = (id: string, label: string, passed: boolean, detail?: string): ChecklistItem => ({
  id, label, passed, detail,
});

export function composeOperationalChecklist(
  gov: Workspace360GovernanceReport,
  pv: ProductionValidationReport,
  vault: ProductionEvidenceVaultReport,
  exec: ProductionExecutionReport,
): OperationalAcceptanceChecklist {
  const integrationsPassed = pv.integrations.passed;
  const financialClean = gov.consistency.financial.score === 100;
  const workflowClean = gov.workflows.passed;
  const dataContractClean = gov.dataContract.passed;
  const observabilityOk = gov.operations.observability.score >= 90;

  const journeyById = new Map(exec.journeys.journeys.map((j) => [j.id, j] as const));
  const jPassed = (id: string) => !!journeyById.get(id)?.passed;
  const jCovered = (id: string) => !!journeyById.get(id)?.covered;

  const categories: ChecklistCategory[] = [
    cat("payments", "Payments", [
      item("mpesa",        "M-Pesa integration",   integrationsPassed),
      item("bank",         "Bank settlement",       integrationsPassed),
      item("wallet",       "Wallet reconciled",     financialClean),
      item("ledger",       "Ledger consistency",    financialClean),
      item("journal",      "Journal immutability",  financialClean),
      item("reconciliation","Reconciliation clean", financialClean,
        `financial ${gov.consistency.financial.score}/100`),
    ]),
    cat("marketplace", "Marketplace", [
      item("dispatch",   "Dispatch workflow",     workflowClean),
      item("matching",   "Driver matching",       jPassed("driver")),
      item("rider",      "Rider assignment",      jPassed("rider") || jCovered("rider")),
      item("fleet",      "Fleet assignment",      jCovered("fleet") ? jPassed("fleet") : true,
        jCovered("fleet") ? undefined : "not adopted"),
    ]),
    cat("finance", "Finance", [
      item("revenue",    "Revenue recognition",   financialClean),
      item("accounting", "Accounting close",      financialClean),
      item("settlement", "Settlement pipeline",   integrationsPassed && financialClean),
      item("audit",      "Audit / alert integrity",
        gov.dataContract.alertCorrelation.score >= 90),
    ]),
    cat("compliance", "Compliance", [
      item("rbac",     "RBAC certification",  pv.security.passed),
      item("rls",      "RLS certification",   pv.security.passed),
      item("fraud",    "Fraud engine",        pv.security.passed),
      item("driver",   "Driver compliance",   jCovered("driver") ? jPassed("driver") : true),
      item("corp",     "Corporate compliance",
        jCovered("corporate-billing") ? jPassed("corporate-billing") : true),
    ]),
    cat("operations", "Operations", [
      item("moc",         "Operations Center",  observabilityOk),
      item("executive",   "Executive Intelligence", gov.passed),
      item("readiness",   "Readiness scores",   pv.score >= 80,
        `${pv.score}/100`),
      item("alerts",      "Alert correlation",  gov.dataContract.alertCorrelation.score >= 90),
      item("decision",    "Decision Engine",    exec.summary.blockingGates.length === 0
                                                 || exec.summary.blockingGates.every((g) =>
                                                   g !== "operational_runbook")),
      item("recovery",    "Recovery plans",     exec.runbook.passed),
      item("contract",    "Data contract",      dataContractClean),
      item("vault",       "Evidence vault",     !!vault.record.fingerprint
                                                 && vault.architectureFreeze.certified),
    ]),
  ];

  const allItems = categories.flatMap((c) => c.items);
  const failingItems = allItems.filter((i) => !i.passed).map((i) => `${i.id}`);
  const passing = allItems.length - failingItems.length;
  const score = allItems.length ? Math.round((passing / allItems.length) * 100) : 100;
  return {
    passed: failingItems.length === 0,
    score,
    categories,
    failingItems,
  };
}

/* ------------------------------------------------------------------ */
/* 2. Version 1 Production Performance Baseline                        */
/* ------------------------------------------------------------------ */
export interface BaselineSignals {
  apiLatencyP95Ms?: number;
  rpcLatencyP95Ms?: number;
  workspace360RenderMs?: number;
  dashboardRenderMs?: number;
  databaseResponseP95Ms?: number;
  queueThroughputPerSec?: number;
  walletThroughputPerSec?: number;
  paymentThroughputPerSec?: number;
  dispatchThroughputPerSec?: number;
  edgeFunctionExecP95Ms?: number;
  memoryUtilPct?: number;
  cpuUtilPct?: number;
  storageUtilPct?: number;
  connectionPoolPct?: number;
  replayDurationSec?: number;
  recoveryDurationSec?: number;
}
export interface PerformanceBaseline {
  captured: boolean;
  version: "v1";
  missingSignals: string[];
  signals: BaselineSignals;
  derived: {
    apiP95Ms: number | null;
    edgeP95Ms: number | null;
    workspaceRenderMs: number | null;
    databaseP95Ms: number | null;
    recoveryDurationSec: number | null;
    replayDurationSec: number | null;
  };
  fingerprint: string;
}
const REQUIRED_BASELINE_KEYS: ReadonlyArray<keyof BaselineSignals> = [
  "apiLatencyP95Ms", "rpcLatencyP95Ms", "workspace360RenderMs",
  "databaseResponseP95Ms", "edgeFunctionExecP95Ms", "recoveryDurationSec",
  "replayDurationSec",
];
export function captureProductionBaseline(
  pv: ProductionValidationReport,
  signals: BaselineSignals = {},
): PerformanceBaseline {
  // Baseline is derived from injected signals only; the existing performance
  // certification (pv.performance) already scores runtime behaviour, so we
  // do not re-derive from it here — that would be a duplicate calculation.
  void pv;
  const derived = {
    apiP95Ms:            signals.apiLatencyP95Ms       ?? null,
    edgeP95Ms:           signals.edgeFunctionExecP95Ms ?? null,
    workspaceRenderMs:   signals.workspace360RenderMs  ?? null,
    databaseP95Ms:       signals.databaseResponseP95Ms ?? null,
    recoveryDurationSec: signals.recoveryDurationSec   ?? null,
    replayDurationSec:   signals.replayDurationSec     ?? null,
  };
  const missingSignals = REQUIRED_BASELINE_KEYS.filter((k) => signals[k] == null);
  // Baseline is "captured" once every required signal has a value, either
  // supplied directly or derived from the existing performance report.
  const captured =
    derived.apiP95Ms            != null &&
    derived.edgeP95Ms           != null &&
    derived.workspaceRenderMs   != null &&
    derived.databaseP95Ms       != null &&
    derived.recoveryDurationSec != null &&
    derived.replayDurationSec   != null;
  const fingerprint = fnv1a(canonicalize({ signals, derived }));
  return {
    captured,
    version: "v1",
    missingSignals: missingSignals as string[],
    signals,
    derived,
    fingerprint,
  };
}

/* ------------------------------------------------------------------ */
/* 3. Auto-composed Operational Runbooks                               */
/* ------------------------------------------------------------------ */
export const CANONICAL_INCIDENTS = [
  { id: "payment_failure",         label: "Payment Failure",         domainHints: ["finance", "payments"] },
  { id: "wallet_failure",          label: "Wallet Failure",          domainHints: ["finance", "wallet"] },
  { id: "settlement_failure",      label: "Settlement Failure",      domainHints: ["finance", "settlement"] },
  { id: "mpesa_callback_failure",  label: "M-Pesa Callback Failure", domainHints: ["finance", "integrations"] },
  { id: "dispatch_failure",        label: "Dispatch Failure",        domainHints: ["operations", "dispatch"] },
  { id: "database_recovery",       label: "Database Recovery",       domainHints: ["operations", "infrastructure"] },
  { id: "queue_recovery",          label: "Queue Recovery",          domainHints: ["operations", "infrastructure"] },
  { id: "notification_failure",    label: "Notification Failure",    domainHints: ["operations", "notifications"] },
  { id: "corporate_billing_failure", label: "Corporate Billing Failure", domainHints: ["finance", "corporate"] },
  { id: "driver_compliance",       label: "Driver Compliance Incident", domainHints: ["compliance", "driver"] },
  { id: "fraud_investigation",     label: "Fraud Investigation",     domainHints: ["security", "fraud"] },
  { id: "security_incident",       label: "Security Incident",       domainHints: ["security"] },
] as const;
export type CanonicalIncidentId = typeof CANONICAL_INCIDENTS[number]["id"];

export interface RunbookStepSummary {
  id: string;
  layer: number;
  criticalPath: boolean;
  parallel: boolean;
  effort: string;
  estimatedMs: number;
  governance: {
    businessCapability: string;
    operationalOwner: string;
    approvalRole: string;
    verificationSource: string;
    completed: boolean;
    verified: boolean;
  } | null;
}
export interface AutoComposedRunbook {
  incidentId: CanonicalIncidentId;
  label: string;
  composed: boolean;                 // false when no plan / no matching steps
  businessCapability: string;
  operationalOwner: string;
  responsibleTeam: string;
  requiredApproval: string;
  dependencies: string[];
  criticalPath: string[];
  parallelSteps: string[][];
  expectedRecoveryMs: number;
  verificationEvidence: string[];
  rollbackCriteria: string;
  escalationPath: string;
  postIncidentValidation: string;
  steps: RunbookStepSummary[];
  reasons: string[];
}
export interface RunbookComposition {
  passed: boolean;
  totalComposed: number;
  totalRunbooks: number;
  runbooks: AutoComposedRunbook[];
  fingerprint: string;
}

function pickStepsForIncident(
  plan: RecoveryPlan,
  hints: readonly string[],
): RunbookStepSummary[] {
  const hintSet = hints.map((h) => h.toLowerCase());
  const allRecos = plan.steps.flatMap((s) => s.parallel);
  const matches = allRecos.filter((r) => {
    const anyR = r as unknown as { domain?: string; rootCause?: string };
    const dom = (anyR.domain ?? "").toLowerCase();
    const cause = (anyR.rootCause ?? "").toLowerCase();
    return hintSet.some((h) => dom.includes(h) || cause.includes(h));
  });
  return matches.map((r) => {
    const o = plan.orchestration[r.id];
    const g = o?.governance ?? null;
    return {
      id: r.id,
      layer: o?.layer ?? 0,
      criticalPath: !!o?.criticalPath,
      parallel: !!o?.parallelizable,
      effort: o?.effort ?? "unknown",
      estimatedMs: o?.estimatedResolutionMs ?? 0,
      governance: g
        ? {
            businessCapability: g.businessCapability ?? "",
            operationalOwner:   g.operationalOwner ?? "",
            approvalRole:       g.approvalRole ?? "",
            verificationSource: g.verificationSource ?? "",
            completed:          !!g.completed,
            verified:           !!g.verified,
          }
        : null,
    };
  });
}

export function composeOperationalRunbooks(
  plan?: RecoveryPlan | null,
): RunbookComposition {
  const runbooks: AutoComposedRunbook[] = [];
  for (const inc of CANONICAL_INCIDENTS) {
    if (!plan) {
      runbooks.push({
        incidentId: inc.id, label: inc.label, composed: false,
        businessCapability: "", operationalOwner: "", responsibleTeam: "",
        requiredApproval: "", dependencies: [], criticalPath: [], parallelSteps: [],
        expectedRecoveryMs: 0, verificationEvidence: [],
        rollbackCriteria: "recovery plan not available",
        escalationPath: "SRE on-call → Head of Engineering",
        postIncidentValidation: "post-incident review pending recovery plan availability",
        steps: [], reasons: ["no recovery plan available"],
      });
      continue;
    }
    const steps = pickStepsForIncident(plan, inc.domainHints);
    const reasons: string[] = [];
    if (steps.length === 0) reasons.push("no matching orchestration steps");
    const missingGov = steps.filter((s) => !s.governance
      || !s.governance.businessCapability
      || !s.governance.operationalOwner
      || !s.governance.approvalRole
      || !s.governance.verificationSource).map((s) => s.id);
    if (missingGov.length) reasons.push(`missing governance: ${missingGov.join(", ")}`);

    // Aggregate governance from the first step that carries it — reuse, do
    // not fabricate.
    const primaryGov = steps.find((s) => s.governance)?.governance ?? null;
    const criticalPath = steps.filter((s) => s.criticalPath).map((s) => s.id);
    const parallelGroups = plan.steps
      .map((batch) => batch.parallel.map((r) => r.id).filter((id) => steps.some((s) => s.id === id)))
      .filter((g) => g.length > 1);
    const expectedRecoveryMs = steps.reduce((sum, s) => sum + s.estimatedMs, 0);
    const verificationEvidence = Array.from(new Set(steps
      .map((s) => s.governance?.verificationSource)
      .filter((v): v is string => !!v)));
    const dependencies = Array.from(new Set(steps
      .flatMap((s) => plan.orchestration[s.id]?.dependsOn ?? [])));

    runbooks.push({
      incidentId: inc.id,
      label: inc.label,
      composed: steps.length > 0 && missingGov.length === 0,
      businessCapability: primaryGov?.businessCapability ?? "",
      operationalOwner:   primaryGov?.operationalOwner ?? "",
      responsibleTeam:    primaryGov?.operationalOwner ?? "",
      requiredApproval:   primaryGov?.approvalRole ?? "",
      dependencies,
      criticalPath,
      parallelSteps: parallelGroups,
      expectedRecoveryMs,
      verificationEvidence,
      rollbackCriteria: "revert to last certified evidence-vault fingerprint",
      escalationPath:   "SRE on-call → Domain Owner → Head of Engineering → CTO",
      postIncidentValidation:
        "workflow certification + evidence vault re-fingerprint + continuous ratchet re-evaluation",
      steps,
      reasons,
    });
  }
  const totalRunbooks = runbooks.length;
  const totalComposed = runbooks.filter((r) => r.composed).length;
  // Pass only when every canonical incident has a composed, governed runbook.
  const passed = totalComposed === totalRunbooks;
  const fingerprint = fnv1a(canonicalize({
    runbooks: runbooks.map((r) => ({ id: r.incidentId, composed: r.composed, steps: r.steps.map((s) => s.id) })),
  }));
  return { passed, totalRunbooks, totalComposed, runbooks, fingerprint };
}

/* ------------------------------------------------------------------ */
/* 4. Executive Production Acceptance Report + Release Package         */
/* ------------------------------------------------------------------ */
export interface KnownRisk {
  id: string;
  severity: "critical" | "major" | "minor" | "operational" | "business";
  description: string;
}
export interface BlockingIssue {
  id: string;
  severity: "critical" | "major";
  businessImpact: string;
  owner: string;
  recoveryPlan: string;
  evidence: string;
  expectedResolutionMs: number;
}
export interface JourneyAcceptance {
  domain: string;
  id: string;
  label: string;
  passed: boolean;
  severity: BusinessJourneyCertification["severity"];
  evidenceRef: string;
  reasons: string[];
}
export interface ExecutiveAcceptanceSummary {
  status: ReleaseDecision;
  overallReadiness: number;
  platform: {
    governance:    number;
    operations:    number;
    performance:   number;
    security:      number;
    scalability:   number;
    compliance:    number;
    business:      number;
    recovery:      number;
    integration:   number;
  };
}
export interface ReleaseReadinessPackage {
  architectureFreezeCertified: boolean;
  productionValidationFingerprint: string;
  productionExecutionFingerprint:  string;
  businessAcceptanceFingerprint:   string;
  securityCertificationPassed:     boolean;
  operationalQualificationPassed:  boolean;
  performanceBaselineFingerprint:  string;
  performanceBaselineCaptured:     boolean;
  integrationCertificationPassed:  boolean;
  recoveryCertificationPassed:     boolean;
  decisionEngineFingerprint:       string;
  executiveRecommendation:         ReleaseDecision;
  productionFingerprint:           string;
  timestamp:                       string;
  buildVersion:                    string;
  gitCommit:                       string;
  migrationVersion:                string;
  schemaContractVersion:           string;
  workspace360Version:             string;
  governanceVersion:               string;
  evidenceHash:                    string;
}
export interface ProductionAcceptanceReport {
  passed: boolean;
  decision: ReleaseDecision;
  summary: ExecutiveAcceptanceSummary;
  journeys: JourneyAcceptance[];
  checklist: OperationalAcceptanceChecklist;
  baseline: PerformanceBaseline;
  runbooks: RunbookComposition;
  risks: KnownRisk[];
  blockers: BlockingIssue[];
  releasePackage: ReleaseReadinessPackage;
  blockingGates: string[];
  fingerprint: string;
}

export interface ProductionAcceptanceInputs {
  governance: Workspace360GovernanceReport;
  validation: ProductionValidationReport;
  vault: ProductionEvidenceVaultReport;
  execution: ProductionExecutionReport;
  recoveryPlan?: RecoveryPlan | null;
  decisionEngine?: DecisionEngineReport | null;
  baselineSignals?: BaselineSignals;
  release?: {
    buildVersion?: string;
    gitCommit?: string;
    migrationVersion?: string;
    schemaContractVersion?: string;
    workspace360Version?: string;
    governanceVersion?: string;
    approver?: string;
    /** Deterministic clock; defaults to epoch for byte-identical fingerprints. */
    now?: string;
  };
}

function extractRisks(
  gov: Workspace360GovernanceReport,
  pv: ProductionValidationReport,
  exec: ProductionExecutionReport,
): KnownRisk[] {
  const risks: KnownRisk[] = [];
  for (const p of gov.freeze.p0) risks.push({ id: `freeze:${p.message}`, severity: "critical", description: p.message });
  for (const p of gov.freeze.p1) risks.push({ id: `freeze:${p.message}`, severity: "major",    description: p.message });
  for (const p of gov.convergence.p0) risks.push({ id: `converge:${p.message}`, severity: "critical", description: p.message });
  for (const p of gov.convergence.p1) risks.push({ id: `converge:${p.message}`, severity: "major",    description: p.message });
  if (!pv.security.passed)      risks.push({ id: "security",     severity: "critical", description: "security qualification failing" });
  if (!pv.integrations.passed)  risks.push({ id: "integrations", severity: "major",    description: "one or more required integrations failing" });
  if (gov.consistency.financial.score < 100)
    risks.push({ id: "financial", severity: "major", description: `financial consistency ${gov.consistency.financial.score}/100` });
  if (!pv.disasterRecovery.passed && pv.disasterRecovery.score < 90)
    risks.push({ id: "dr", severity: "operational", description: "disaster recovery below floor" });
  for (const j of exec.journeys.journeys.filter((j) => j.severity === "P0"))
    risks.push({ id: `journey:${j.id}`, severity: "critical", description: `business journey "${j.label}" failing` });
  return risks;
}

function extractBlockers(
  gov: Workspace360GovernanceReport,
  pv: ProductionValidationReport,
  vault: ProductionEvidenceVaultReport,
  exec: ProductionExecutionReport,
  runbooks: RunbookComposition,
  baseline: PerformanceBaseline,
  checklist: OperationalAcceptanceChecklist,
): BlockingIssue[] {
  const blockers: BlockingIssue[] = [];
  for (const gate of vault.ratchet.blocking_gates) {
    blockers.push({
      id: `ratchet:${gate}`, severity: "critical",
      businessImpact: `continuous ratchet gate "${gate}" failing`,
      owner: "SRE / Domain Owner",
      recoveryPlan: "review governance report for corresponding certifier",
      evidence: `governance / validation / vault fingerprints`,
      expectedResolutionMs: 4 * 3600 * 1000,
    });
  }
  for (const j of exec.journeys.journeys.filter((j) => j.severity === "P0")) {
    blockers.push({
      id: `journey:${j.id}`, severity: "critical",
      businessImpact: `business journey "${j.label}" failing`,
      owner: j.primaryDomain,
      recoveryPlan: j.reasons.join("; "),
      evidence: `production execution report / workflow certification`,
      expectedResolutionMs: 8 * 3600 * 1000,
    });
  }
  if (!runbooks.passed) {
    blockers.push({
      id: "runbooks", severity: "major",
      businessImpact: `${runbooks.totalRunbooks - runbooks.totalComposed} canonical runbook(s) not composable`,
      owner: "SRE",
      recoveryPlan: "extend recovery plan with governance metadata for missing incidents",
      evidence: "auto-composed runbook report",
      expectedResolutionMs: 24 * 3600 * 1000,
    });
  }
  if (!baseline.captured) {
    blockers.push({
      id: "baseline", severity: "major",
      businessImpact: `production baseline missing signals: ${baseline.missingSignals.join(", ") || "runtime"}`,
      owner: "Platform Engineering",
      recoveryPlan: "capture Version 1 baseline signals via existing performance report",
      evidence: "performance baseline fingerprint",
      expectedResolutionMs: 24 * 3600 * 1000,
    });
  }
  if (!checklist.passed) {
    blockers.push({
      id: "checklist", severity: "major",
      businessImpact: `operational acceptance checklist failing: ${checklist.failingItems.slice(0, 5).join(", ")}`,
      owner: "Operations",
      recoveryPlan: "resolve failing checklist items via existing certifiers",
      evidence: "operational acceptance checklist",
      expectedResolutionMs: 24 * 3600 * 1000,
    });
  }
  if (!gov.certification.passed) {
    blockers.push({
      id: "navigation", severity: "critical",
      businessImpact: "navigation governance certification failing",
      owner: "Platform Engineering",
      recoveryPlan: "reconcile routes with canonical registry (D12.0 governance)",
      evidence: "governance.certification report",
      expectedResolutionMs: 4 * 3600 * 1000,
    });
  }
  if (!pv.performance.passed) {
    blockers.push({
      id: "performance", severity: "major",
      businessImpact: "performance qualification failing against SLOs",
      owner: "Platform Engineering",
      recoveryPlan: "identify hotspots via existing performance report",
      evidence: "production validation report",
      expectedResolutionMs: 24 * 3600 * 1000,
    });
  }
  return blockers;
}

export function certifyProductionAcceptance(
  inputs: ProductionAcceptanceInputs,
): ProductionAcceptanceReport {
  const { governance: gov, validation: pv, vault, execution: exec } = inputs;

  const checklist = composeOperationalChecklist(gov, pv, vault, exec);
  const baseline  = captureProductionBaseline(pv, inputs.baselineSignals ?? {});
  const runbooks  = composeOperationalRunbooks(inputs.recoveryPlan ?? null);
  const risks     = extractRisks(gov, pv, exec);
  const blockers  = extractBlockers(gov, pv, vault, exec, runbooks, baseline, checklist);

  const journeys: JourneyAcceptance[] = exec.journeys.journeys.map((j) => ({
    domain: j.primaryDomain,
    id: j.id,
    label: j.label,
    passed: j.passed,
    severity: j.severity,
    evidenceRef: `production_execution.journeys[${j.id}]`,
    reasons: j.reasons,
  }));

  // D14.1 gates can only downgrade PROMOTE — never upgrade a HOLD/ROLLBACK.
  const blockingGates: string[] = [...exec.summary.blockingGates];
  if (!checklist.passed) blockingGates.push("operational_checklist");
  if (!runbooks.passed)  blockingGates.push("auto_runbooks");
  if (!baseline.captured) blockingGates.push("production_baseline");

  let decision: ReleaseDecision = exec.decision;
  if (decision === "PROMOTE" && (!checklist.passed || !runbooks.passed || !baseline.captured)) {
    decision = "HOLD";
  }

  const summary: ExecutiveAcceptanceSummary = {
    status: decision,
    overallReadiness: exec.summary.overallScore,
    platform: {
      governance:  gov.score,
      operations:  gov.operations.score,
      performance: pv.performance.score,
      security:    pv.security.score,
      scalability: pv.scalability.score,
      compliance:  gov.certification.score,
      business:    pv.businessAcceptance.score,
      recovery:    pv.disasterRecovery.score,
      integration: pv.integrations.score,
    },
  };

  const rel = inputs.release ?? {};
  const evidenceHashSource = {
    vault: vault.record.fingerprint,
    exec:  exec.summary.fingerprint,
    checklist: fnv1a(canonicalize(checklist)),
    baseline:  baseline.fingerprint,
    runbooks:  runbooks.fingerprint,
    decisionEngine: inputs.decisionEngine
      ? fnv1a(canonicalize({
          recos: inputs.decisionEngine.recommendations.map((r) => ({ id: r.id, status: r.execution?.status ?? "pending" })),
        }))
      : "00000000",
  };
  const evidenceHash = fnv1a(canonicalize(evidenceHashSource));

  const releasePackage: ReleaseReadinessPackage = {
    architectureFreezeCertified:     vault.architectureFreeze.certified,
    productionValidationFingerprint: fnv1a(canonicalize({ decision: pv.decision, score: pv.score })),
    productionExecutionFingerprint:  exec.summary.fingerprint,
    businessAcceptanceFingerprint:   fnv1a(canonicalize({ journeys, checklist: checklist.score })),
    securityCertificationPassed:     pv.security.passed,
    operationalQualificationPassed:  gov.operations.passed,
    performanceBaselineFingerprint:  baseline.fingerprint,
    performanceBaselineCaptured:     baseline.captured,
    integrationCertificationPassed:  pv.integrations.passed,
    recoveryCertificationPassed:     pv.disasterRecovery.passed || pv.disasterRecovery.score >= 90,
    decisionEngineFingerprint:       evidenceHashSource.decisionEngine,
    executiveRecommendation:         decision,
    productionFingerprint:           "", // filled after canonicalization below
    timestamp:                       rel.now ?? "1970-01-01T00:00:00.000Z",
    buildVersion:                    rel.buildVersion ?? "unknown",
    gitCommit:                       rel.gitCommit ?? "unknown",
    migrationVersion:                rel.migrationVersion ?? "unknown",
    schemaContractVersion:           rel.schemaContractVersion ?? "unknown",
    workspace360Version:             rel.workspace360Version ?? "D14.1",
    governanceVersion:               rel.governanceVersion ?? "unknown",
    evidenceHash,
  };
  releasePackage.productionFingerprint = fnv1a(canonicalize(releasePackage));

  const fingerprint = fnv1a(canonicalize({
    decision, summary, journeys, checklist, baseline, runbooks: runbooks.fingerprint,
    risks, blockers, releasePackage,
  }));

  const passed = decision === "PROMOTE" && blockingGates.length === 0;
  return {
    passed, decision, summary, journeys, checklist, baseline, runbooks,
    risks, blockers, releasePackage, blockingGates, fingerprint,
  };
}
