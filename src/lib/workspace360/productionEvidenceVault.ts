/**
 * Phase D13.1 — Enterprise Production Validation & Evidence Certification.
 *
 * Pure, deterministic composer. NO new engines, dashboards, tables, or
 * workflows — only an evidence layer over the existing D7–D13 stack.
 *
 * Delivers three artefacts:
 *
 *  1. ProductionEvidenceVaultRecord  — canonical immutable evidence package
 *     extending the D13.0 ReleaseEvidencePackage with decision-engine and
 *     recovery-plan summaries, workspace360 certification version, and a
 *     fingerprint computed over the canonical (sorted-key) JSON so replays
 *     are byte-identical.
 *
 *  2. ArchitectureFreezeCertificate  — final "no duplicates" attestation
 *     composed from existing certifiers (freeze audit, convergence,
 *     production qualification, governance).
 *
 *  3. ContinuousProductionRatchet    — deterministic list of gates that
 *     MUST hold for deployment; blocks CI whenever any gate fails.
 *
 * Everything is pure. Runtime signals (build metadata, decision-engine
 * report, recovery plan) are injected by callers; when absent, fields
 * degrade to "unknown"/empty rather than fabricating pass.
 */
import type { Workspace360GovernanceReport } from "./governance";
import type { ProductionValidationReport, ReleaseEvidencePackage, ReleaseDecision } from "./productionValidation";
import type { DecisionEngineReport, Recommendation } from "./decisionEngine";
import type { RecoveryPlan } from "./orchestration";

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
/* 1. Production Evidence Vault                                        */
/* ------------------------------------------------------------------ */
export interface DecisionEngineSummary {
  total: number;
  byPriority: { P0: number; P1: number; P2: number; P3: number };
  byStatus: { pending: number; in_progress: number; completed: number; blocked: number };
  completionRate: number;
  successRate: number;
}

export interface RecoveryPlanSummary {
  totalSteps: number;
  criticalPathSteps: number;
  parallelBatches: number;
  completedSteps: number;
  blockedSteps: number;
  estimatedTotalEffortMs: number;
}

export interface ProductionEvidenceVaultRecord {
  /* -- release identity (immutable inputs) -- */
  build_version: string;
  git_commit: string;
  migration_version: string;
  schema_contract_version: string;
  workspace360_certification_version: string;
  governance_version: string;
  release_approver: string;
  timestamp: string;

  /* -- deterministic verdict -- */
  executive_decision: ReleaseDecision;

  /* -- certification snapshots (pure aggregates from D7–D13) -- */
  readiness_snapshot: { score: number; passed: boolean };
  certification_results: ReleaseEvidencePackage["certification_results"];
  operational_qualification: { score: number; passed: boolean };
  business_readiness: { score: number; passed: boolean };

  /* -- D13.1 extensions -- */
  decision_engine_summary: DecisionEngineSummary;
  recovery_plan_summary: RecoveryPlanSummary;
  architecture_freeze: {
    certified: boolean;
    issues: number;
    fingerprint: string;
  };
  continuous_ratchet: {
    deployment_blocked: boolean;
    blocking_gates: string[];
  };

  /* -- immutability -- */
  fingerprint: string;
}

function summariseDecisionEngine(report?: DecisionEngineReport | null): DecisionEngineSummary {
  const recos: ReadonlyArray<Recommendation> = report?.recommendations ?? [];
  const byPriority = { P0: 0, P1: 0, P2: 0, P3: 0 };
  const byStatus = { pending: 0, in_progress: 0, completed: 0, blocked: 0 };
  for (const r of recos) {
    byPriority[r.priority] = (byPriority[r.priority] ?? 0) + 1;
    const s = r.execution?.status;
    if (s === "completed") byStatus.completed++;
    else if (s === "in_progress") byStatus.in_progress++;
    else if (s === "rejected" || s === "deferred" || s === "expired") byStatus.blocked++;
    else byStatus.pending++;
  }
  const total = recos.length;
  const completionRate = total ? Math.round(((byStatus.completed + byStatus.blocked) / total) * 100) : 0;
  const attempted = byStatus.completed + byStatus.blocked;
  const successRate = attempted ? Math.round((byStatus.completed / attempted) * 100) : 0;
  return { total, byPriority, byStatus, completionRate, successRate };
}

function summariseRecoveryPlan(plan?: RecoveryPlan | null): RecoveryPlanSummary {
  if (!plan) {
    return { totalSteps: 0, criticalPathSteps: 0, parallelBatches: 0, completedSteps: 0, blockedSteps: 0, estimatedTotalEffortMs: 0 };
  }
  const allRecos: Recommendation[] = plan.steps.flatMap((s) => s.parallel);
  const totalSteps = allRecos.length;
  const criticalPathSteps = plan.criticalPath.length;
  const parallelBatches = plan.steps.filter((s) => s.parallel.length > 1).length;
  const completedSteps = allRecos.filter((r) => r.execution?.status === "completed").length;
  const blockedSteps = allRecos.filter((r) => {
    const s = r.execution?.status;
    return s === "rejected" || s === "deferred" || s === "expired";
  }).length;
  return {
    totalSteps,
    criticalPathSteps,
    parallelBatches,
    completedSteps,
    blockedSteps,
    estimatedTotalEffortMs: plan.totalEstimatedMs,
  };
}

/* ------------------------------------------------------------------ */
/* 2. Architecture Freeze Certificate                                  */
/* ------------------------------------------------------------------ */
export interface ArchitectureFreezeCertificate {
  certified: boolean;
  categories: {
    services: { passed: boolean; issues: string[] };
    dashboards: { passed: boolean; issues: string[] };
    governance_calculations: { passed: boolean; issues: string[] };
    financial_engines: { passed: boolean; issues: string[] };
    workspace360_implementations: { passed: boolean; issues: string[] };
    operational_logic: { passed: boolean; issues: string[] };
  };
  totalIssues: number;
  fingerprint: string;
}

export function certifyArchitectureFreeze(
  gov: Workspace360GovernanceReport,
  pv: ProductionValidationReport,
): ArchitectureFreezeCertificate {
  // Duplicate services / dashboards / governance calculations are surfaced by
  // the existing freeze audit as canonical certifier / route duplicates.
  const freezeP0 = gov.freeze.p0.map((f) => f.message);
  const freezeP1 = gov.freeze.p1.map((f) => f.message);
  const servicesIssues = freezeP0.filter((m) => /route|adopted domain|workspace360 workspace|workspace360 directory/i.test(m));
  const dashboardIssues = freezeP0.filter((m) => /workspace360 workspace route|workspace360 directory route/i.test(m));
  const governanceIssues = [
    ...freezeP0.filter((m) => /governance certifier/i.test(m)),
    ...freezeP1.filter((m) => /non-canonical certifier/i.test(m)),
  ];

  // Duplicate financial logic already tracked by production qualification &
  // per-domain governance.
  const financialIssues = pv.productionQualification.crossDomainIntegrity.duplicatedFinancialTables
    .map((t) => `duplicate financial table: ${t}`);
  for (const d of gov.domains) {
    for (const dup of d.duplicatedFinancialTables) {
      financialIssues.push(`${d.domain} declares forked financial table: ${dup}`);
    }
  }

  // Workspace360 duplicates: convergence axis flags any adoption divergence.
  const wsIssues: string[] = [];
  for (const p of gov.convergence.p0) wsIssues.push(`convergence P0: ${p.message}`);
  for (const p of gov.freeze.p0.filter((f) => /adopted domain|workspace360 domain/i.test(f.message))) {
    wsIssues.push(p.message);
  }

  // Operational duplicates: two operations engines / two observability paths
  // would surface as either freeze P1 non-canonical certifier or as domains
  // with duplicated ops tables (best signal we have without new plumbing).
  const opsIssues = freezeP1.filter((m) => /non-canonical certifier/i.test(m));

  const categories: ArchitectureFreezeCertificate["categories"] = {
    services:                     { passed: servicesIssues.length === 0,   issues: servicesIssues },
    dashboards:                   { passed: dashboardIssues.length === 0,  issues: dashboardIssues },
    governance_calculations:      { passed: governanceIssues.length === 0, issues: governanceIssues },
    financial_engines:            { passed: financialIssues.length === 0,  issues: financialIssues },
    workspace360_implementations: { passed: wsIssues.length === 0,         issues: wsIssues },
    operational_logic:            { passed: opsIssues.length === 0,        issues: opsIssues },
  };
  const totalIssues =
    servicesIssues.length + dashboardIssues.length + governanceIssues.length +
    financialIssues.length + wsIssues.length + opsIssues.length;
  const certified = totalIssues === 0;
  const fingerprint = fnv1a(canonicalize({ categories, totalIssues }));
  return { certified, categories, totalIssues, fingerprint };
}

/* ------------------------------------------------------------------ */
/* 3. Continuous Production Ratchet                                    */
/* ------------------------------------------------------------------ */
export interface ContinuousProductionRatchet {
  deployment_blocked: boolean;
  blocking_gates: string[];
  gates: Array<{ id: string; passed: boolean; detail?: string }>;
}

const READINESS_FLOOR = 80;
const BUSINESS_READINESS_FLOOR = 80;

export function evaluateContinuousRatchet(
  gov: Workspace360GovernanceReport,
  pv: ProductionValidationReport,
  freeze: ArchitectureFreezeCertificate,
): ContinuousProductionRatchet {
  const gates: ContinuousProductionRatchet["gates"] = [
    { id: "governance",              passed: gov.passed },
    { id: "production_qualification", passed: pv.productionQualification.passed },
    { id: "operational",             passed: gov.operations.passed },
    { id: "business_readiness",      passed: pv.businessAcceptance.score >= BUSINESS_READINESS_FLOOR,
      detail: `${pv.businessAcceptance.score}/100` },
    { id: "workflow_certification",  passed: gov.workflows.passed,
      detail: `${gov.workflows.score}/100` },
    { id: "financial_certification", passed: gov.consistency.financial.score === 100,
      detail: `${gov.consistency.financial.score}/100` },
    { id: "data_contract",           passed: gov.dataContract.passed },
    { id: "recovery_certification",  passed: pv.disasterRecovery.passed || pv.disasterRecovery.score >= 90 },
    { id: "navigation_governance",   passed: gov.certification.passed },
    { id: "integrations",            passed: pv.integrations.passed },
    { id: "security",                passed: pv.security.passed },
    { id: "readiness_floor",         passed: pv.score >= READINESS_FLOOR,
      detail: `${pv.score}/${READINESS_FLOOR}` },
    { id: "architecture_freeze",     passed: freeze.certified,
      detail: freeze.totalIssues ? `${freeze.totalIssues} duplicate(s)` : undefined },
  ];
  const blocking_gates = gates.filter((g) => !g.passed).map((g) => g.id);
  return { deployment_blocked: blocking_gates.length > 0, blocking_gates, gates };
}

/* ------------------------------------------------------------------ */
/* 4. Composer — the Production Evidence Vault                         */
/* ------------------------------------------------------------------ */
export interface ProductionEvidenceVaultInputs {
  governance: Workspace360GovernanceReport;
  validation: ProductionValidationReport;
  decisionEngine?: DecisionEngineReport | null;
  recoveryPlan?: RecoveryPlan | null;
  release?: {
    buildVersion?: string;
    gitCommit?: string;
    migrationVersion?: string;
    schemaContractVersion?: string;
    workspace360CertificationVersion?: string;
    governanceVersion?: string;
    approver?: string;
    /** Deterministic clock for evidence-vault timestamp; defaults to epoch. */
    now?: string;
  };
}

export interface ProductionEvidenceVaultReport {
  passed: boolean;
  decision: ReleaseDecision;
  record: ProductionEvidenceVaultRecord;
  architectureFreeze: ArchitectureFreezeCertificate;
  ratchet: ContinuousProductionRatchet;
}

export function certifyProductionEvidenceVault(
  inputs: ProductionEvidenceVaultInputs,
): ProductionEvidenceVaultReport {
  const { governance: gov, validation: pv } = inputs;
  const architectureFreeze = certifyArchitectureFreeze(gov, pv);
  const ratchet = evaluateContinuousRatchet(gov, pv, architectureFreeze);
  const decisionEngineSummary = summariseDecisionEngine(inputs.decisionEngine ?? null);
  const recoveryPlanSummary = summariseRecoveryPlan(inputs.recoveryPlan ?? null);
  const rel = inputs.release ?? {};

  // A deployment cannot PROMOTE while the ratchet is blocking, even if the
  // D13.0 authority says otherwise — this is the D13.1 continuous ratchet.
  let executive_decision: ReleaseDecision = pv.decision;
  if (executive_decision === "PROMOTE" && ratchet.deployment_blocked) {
    executive_decision = "HOLD";
  }
  if (!architectureFreeze.certified && executive_decision === "PROMOTE") {
    executive_decision = "HOLD";
  }

  const core = {
    build_version:                       rel.buildVersion ?? "unknown",
    git_commit:                          rel.gitCommit ?? "unknown",
    migration_version:                   rel.migrationVersion ?? "unknown",
    schema_contract_version:             rel.schemaContractVersion ?? "unknown",
    workspace360_certification_version:  rel.workspace360CertificationVersion ?? "D13.1",
    governance_version:                  rel.governanceVersion ?? "unknown",
    release_approver:                    rel.approver ?? "system",
    timestamp:                           rel.now ?? "1970-01-01T00:00:00.000Z",
    executive_decision,
    readiness_snapshot:                  pv.evidencePackage.readiness_snapshot,
    certification_results:               pv.evidencePackage.certification_results,
    operational_qualification:           pv.evidencePackage.operational_qualification,
    business_readiness:                  pv.evidencePackage.business_readiness,
    decision_engine_summary:             decisionEngineSummary,
    recovery_plan_summary:               recoveryPlanSummary,
    architecture_freeze: {
      certified:   architectureFreeze.certified,
      issues:      architectureFreeze.totalIssues,
      fingerprint: architectureFreeze.fingerprint,
    },
    continuous_ratchet: {
      deployment_blocked: ratchet.deployment_blocked,
      blocking_gates:     ratchet.blocking_gates,
    },
  };
  const record: ProductionEvidenceVaultRecord = {
    ...core,
    fingerprint: fnv1a(canonicalize(core)),
  };

  return {
    passed: executive_decision === "PROMOTE" && !ratchet.deployment_blocked,
    decision: executive_decision,
    record,
    architectureFreeze,
    ratchet,
  };
}

/* ------------------------------------------------------------------ */
/* Phase B1.4 — Qualification Convergence seal                         */
/* ------------------------------------------------------------------ */

export interface QualificationArtifacts {
  schema: unknown;
  twin: unknown;
  triage: unknown;
  journeys: unknown;
  evp: unknown;
  releaseAuthority: unknown;
  freeze: unknown;
}

export interface SealedQualificationRun {
  version: "b1.4/v1";
  generatedAt: string;
  fingerprint: string;
  verdict: "PROMOTE" | "HOLD";
  artifacts: QualificationArtifacts;
}

/**
 * Composes every convergence artifact into a single canonical JSON object
 * and stamps it with an FNV-1a fingerprint that is byte-identical to the
 * EVP fingerprint algorithm. Pure — persistence is the caller's concern.
 */
export function sealQualificationRun(
  artifacts: QualificationArtifacts,
  verdict: "PROMOTE" | "HOLD",
  generatedAt: string = new Date().toISOString(),
): SealedQualificationRun {
  const base = { version: "b1.4/v1" as const, generatedAt, verdict, artifacts };
  const fingerprint = fnv1a(canonicalize(base));
  return { ...base, fingerprint };
}

