/**
 * Phase D13.0 — Enterprise Production Validation & Go-Live Certification.
 *
 * Pure, deterministic composer. NO new engines, NO new dashboards, NO
 * new tables. Answers a single go-live question:
 *
 *   Given the evidence produced by the existing D7–D12 stack (governance,
 *   workspace360, operations, data-contract, freeze, convergence, decision
 *   engine, production-qualification) plus optional live-integration
 *   telemetry, is the platform PROMOTE / HOLD / ROLLBACK?
 *
 * Every sub-certifier consumes existing reports. Optional runtime signals
 * (integration success rates, latency, scalability tiers) can be injected
 * from ops runbooks; when absent, the certifier degrades deterministically
 * to "insufficient evidence" for that pillar rather than fabricating pass.
 */
import type { Workspace360GovernanceReport } from "./governance";
import type { Recommendation } from "./decisionEngine";
import { certifyProductionQualification, type ProductionQualificationReport } from "./productionQualification";

/* ------------------------------------------------------------------ */
/* 1. Live Integration Qualification                                   */
/* ------------------------------------------------------------------ */
export const REQUIRED_INTEGRATIONS = [
  "mpesa_stk_push",
  "mpesa_callback",
  "mpesa_reversal",
  "bank_settlement",
  "kra_etims",
  "email",
  "sms",
  "push_notifications",
  "maps_routing",
  "storage",
] as const;
export type IntegrationId = typeof REQUIRED_INTEGRATIONS[number];

export interface IntegrationTelemetry {
  successRate: number;   // 0-1
  p95LatencyMs: number;
  retryRate: number;     // 0-1
  timeoutRate: number;   // 0-1
  sampleSize: number;
}

/** Deterministic per-integration thresholds. */
export const INTEGRATION_THRESHOLDS: Record<IntegrationId, {
  minSuccess: number; maxP95Ms: number; maxTimeout: number; minSample: number;
}> = {
  mpesa_stk_push:     { minSuccess: 0.98, maxP95Ms: 3500, maxTimeout: 0.01, minSample: 50 },
  mpesa_callback:     { minSuccess: 0.99, maxP95Ms: 1500, maxTimeout: 0.005, minSample: 50 },
  mpesa_reversal:     { minSuccess: 0.95, maxP95Ms: 5000, maxTimeout: 0.02, minSample: 10 },
  bank_settlement:    { minSuccess: 0.99, maxP95Ms: 5000, maxTimeout: 0.01, minSample: 10 },
  kra_etims:          { minSuccess: 0.97, maxP95Ms: 4000, maxTimeout: 0.02, minSample: 20 },
  email:              { minSuccess: 0.98, maxP95Ms: 2000, maxTimeout: 0.01, minSample: 30 },
  sms:                { minSuccess: 0.97, maxP95Ms: 3000, maxTimeout: 0.02, minSample: 30 },
  push_notifications: { minSuccess: 0.96, maxP95Ms: 2000, maxTimeout: 0.02, minSample: 30 },
  maps_routing:       { minSuccess: 0.99, maxP95Ms: 800,  maxTimeout: 0.01, minSample: 50 },
  storage:            { minSuccess: 0.99, maxP95Ms: 1000, maxTimeout: 0.005, minSample: 30 },
};

export interface IntegrationCertification {
  id: IntegrationId;
  hasEvidence: boolean;
  passed: boolean;
  reasons: string[];
  telemetry: IntegrationTelemetry | null;
}

export interface IntegrationQualificationReport {
  passed: boolean;
  score: number;
  certified: number;
  missingEvidence: IntegrationId[];
  failing: IntegrationId[];
  integrations: IntegrationCertification[];
}

function certifyIntegrations(
  input?: Partial<Record<IntegrationId, IntegrationTelemetry>>,
): IntegrationQualificationReport {
  const integrations: IntegrationCertification[] = REQUIRED_INTEGRATIONS.map((id) => {
    const t = input?.[id];
    if (!t) {
      return { id, hasEvidence: false, passed: false, reasons: ["no telemetry evidence"], telemetry: null };
    }
    const th = INTEGRATION_THRESHOLDS[id];
    const reasons: string[] = [];
    if (t.sampleSize < th.minSample) reasons.push(`sample<${th.minSample}`);
    if (t.successRate < th.minSuccess) reasons.push(`success<${th.minSuccess}`);
    if (t.p95LatencyMs > th.maxP95Ms) reasons.push(`p95>${th.maxP95Ms}ms`);
    if (t.timeoutRate > th.maxTimeout) reasons.push(`timeout>${th.maxTimeout}`);
    return { id, hasEvidence: true, passed: reasons.length === 0, reasons, telemetry: t };
  });
  const certified = integrations.filter((i) => i.passed).length;
  const missingEvidence = integrations.filter((i) => !i.hasEvidence).map((i) => i.id);
  const failing = integrations.filter((i) => i.hasEvidence && !i.passed).map((i) => i.id);
  const score = Math.round((certified / REQUIRED_INTEGRATIONS.length) * 100);
  return {
    passed: certified === REQUIRED_INTEGRATIONS.length,
    score, certified, missingEvidence, failing, integrations,
  };
}

/* ------------------------------------------------------------------ */
/* 2. Enterprise Performance Qualification                             */
/* ------------------------------------------------------------------ */
export interface PerformanceMetrics {
  api?:            { p95Ms: number; errorRate: number; throughputRps: number; timeoutRate: number };
  database?:       { slowQueries: number; lockContention: number; indexUtil: number; replicationLagMs: number };
  edgeFunctions?:  { invocationSuccess: number; coldStartMs: number; execP95Ms: number };
  workspace360?:   { pageLoadMs: number; tabSwitchMs: number; rpcP95Ms: number };
}
export const PERF_THRESHOLDS = {
  api:           { maxP95Ms: 800,  maxErrorRate: 0.01, minThroughput: 100, maxTimeoutRate: 0.005 },
  database:      { maxSlowQueries: 5, maxLockContention: 0.05, minIndexUtil: 0.9, maxReplicationLagMs: 2000 },
  edgeFunctions: { minSuccess: 0.99, maxColdMs: 1500, maxExecP95Ms: 2500 },
  workspace360:  { maxPageLoadMs: 2500, maxTabSwitchMs: 400, maxRpcP95Ms: 1500 },
} as const;

export interface PerformanceCertification {
  passed: boolean;
  score: number;
  pillars: Array<{ pillar: string; passed: boolean; reasons: string[]; hasEvidence: boolean }>;
  missingEvidence: string[];
}
function certifyPerformance(m?: PerformanceMetrics, ops?: { operationsScore: number }): PerformanceCertification {
  const pillars: PerformanceCertification["pillars"] = [];
  const push = (pillar: string, evidence: boolean, reasons: string[]) =>
    pillars.push({ pillar, hasEvidence: evidence, reasons, passed: evidence && reasons.length === 0 });

  if (m?.api) {
    const r: string[] = [];
    const t = PERF_THRESHOLDS.api;
    if (m.api.p95Ms > t.maxP95Ms) r.push(`api p95>${t.maxP95Ms}`);
    if (m.api.errorRate > t.maxErrorRate) r.push(`api err>${t.maxErrorRate}`);
    if (m.api.throughputRps < t.minThroughput) r.push(`api rps<${t.minThroughput}`);
    if (m.api.timeoutRate > t.maxTimeoutRate) r.push(`api timeout>${t.maxTimeoutRate}`);
    push("api", true, r);
  } else push("api", false, ["no evidence"]);

  if (m?.database) {
    const r: string[] = [];
    const t = PERF_THRESHOLDS.database;
    if (m.database.slowQueries > t.maxSlowQueries) r.push(`slow>${t.maxSlowQueries}`);
    if (m.database.lockContention > t.maxLockContention) r.push(`locks>${t.maxLockContention}`);
    if (m.database.indexUtil < t.minIndexUtil) r.push(`idx<${t.minIndexUtil}`);
    if (m.database.replicationLagMs > t.maxReplicationLagMs) r.push(`repl>${t.maxReplicationLagMs}ms`);
    push("database", true, r);
  } else push("database", false, ["no evidence"]);

  if (m?.edgeFunctions) {
    const r: string[] = [];
    const t = PERF_THRESHOLDS.edgeFunctions;
    if (m.edgeFunctions.invocationSuccess < t.minSuccess) r.push(`success<${t.minSuccess}`);
    if (m.edgeFunctions.coldStartMs > t.maxColdMs) r.push(`cold>${t.maxColdMs}`);
    if (m.edgeFunctions.execP95Ms > t.maxExecP95Ms) r.push(`exec>${t.maxExecP95Ms}`);
    push("edge_functions", true, r);
  } else push("edge_functions", false, ["no evidence"]);

  if (m?.workspace360) {
    const r: string[] = [];
    const t = PERF_THRESHOLDS.workspace360;
    if (m.workspace360.pageLoadMs > t.maxPageLoadMs) r.push(`load>${t.maxPageLoadMs}`);
    if (m.workspace360.tabSwitchMs > t.maxTabSwitchMs) r.push(`tab>${t.maxTabSwitchMs}`);
    if (m.workspace360.rpcP95Ms > t.maxRpcP95Ms) r.push(`rpc>${t.maxRpcP95Ms}`);
    push("workspace360", true, r);
  } else push("workspace360", false, ["no evidence"]);

  const missingEvidence = pillars.filter((p) => !p.hasEvidence).map((p) => p.pillar);
  const withEvidence = pillars.filter((p) => p.hasEvidence);
  const passingRate = withEvidence.length
    ? withEvidence.filter((p) => p.passed).length / withEvidence.length
    : 0;
  // Operational qualification score serves as fallback when telemetry is absent.
  const opsFallback = ops?.operationsScore ?? 0;
  const evidenceScore = Math.round(passingRate * 100);
  const score = withEvidence.length ? evidenceScore : Math.min(opsFallback, 70);
  return {
    passed: missingEvidence.length === 0 && pillars.every((p) => p.passed),
    score, pillars, missingEvidence,
  };
}

/* ------------------------------------------------------------------ */
/* 3. Enterprise Scalability Certification                             */
/* ------------------------------------------------------------------ */
export const SCALABILITY_TIERS = [1_000, 5_000, 10_000, 25_000, 50_000, 100_000] as const;
export type ScalabilityTier = typeof SCALABILITY_TIERS[number];
export interface ScalabilityTierResult {
  concurrentUsers: ScalabilityTier;
  hasEvidence: boolean;
  passed: boolean;
  metrics?: {
    p95LatencyMs: number;
    queueDepth: number;
    paymentTps: number;
    dispatchTps: number;
    dbCpuPct: number;
  };
  reasons: string[];
}
export const SCALABILITY_THRESHOLDS = {
  maxP95Ms: 1500, maxQueueDepth: 500, minPaymentTps: 20, minDispatchTps: 10, maxDbCpuPct: 80,
} as const;
export interface ScalabilityReport {
  passed: boolean;
  score: number;
  highestCertifiedTier: ScalabilityTier | 0;
  tiers: ScalabilityTierResult[];
  missingEvidence: ScalabilityTier[];
}
function certifyScalability(
  results?: Partial<Record<ScalabilityTier, ScalabilityTierResult["metrics"]>>,
): ScalabilityReport {
  const tiers: ScalabilityTierResult[] = SCALABILITY_TIERS.map((tier) => {
    const m = results?.[tier];
    if (!m) return { concurrentUsers: tier, hasEvidence: false, passed: false, reasons: ["no load test"] };
    const r: string[] = [];
    if (m.p95LatencyMs > SCALABILITY_THRESHOLDS.maxP95Ms) r.push("p95");
    if (m.queueDepth > SCALABILITY_THRESHOLDS.maxQueueDepth) r.push("queue");
    if (m.paymentTps < SCALABILITY_THRESHOLDS.minPaymentTps) r.push("pay_tps");
    if (m.dispatchTps < SCALABILITY_THRESHOLDS.minDispatchTps) r.push("disp_tps");
    if (m.dbCpuPct > SCALABILITY_THRESHOLDS.maxDbCpuPct) r.push("db_cpu");
    return { concurrentUsers: tier, hasEvidence: true, passed: r.length === 0, reasons: r, metrics: m };
  });
  const highestCertifiedTier: ScalabilityTier | 0 = tiers
    .filter((t) => t.passed)
    .reduce<ScalabilityTier | 0>((acc, t) => (t.concurrentUsers > acc ? t.concurrentUsers : acc), 0);
  const missingEvidence = tiers.filter((t) => !t.hasEvidence).map((t) => t.concurrentUsers);
  const idx = SCALABILITY_TIERS.indexOf(highestCertifiedTier as ScalabilityTier);
  const score = highestCertifiedTier === 0 ? 0 : Math.round(((idx + 1) / SCALABILITY_TIERS.length) * 100);
  // Production floor: certified through 10,000 concurrent users.
  const passed = highestCertifiedTier >= 10_000;
  return { passed, score, highestCertifiedTier, tiers, missingEvidence };
}

/* ------------------------------------------------------------------ */
/* 4. Disaster Recovery Certification                                  */
/* ------------------------------------------------------------------ */
export const DR_SCENARIOS = [
  "database_restore", "replay", "outbox_recovery", "event_replay",
  "payment_replay", "queue_recovery", "cache_rebuild",
] as const;
export type DrScenario = typeof DR_SCENARIOS[number];
export interface DrDrillResult {
  scenario: DrScenario;
  hasEvidence: boolean;
  passed: boolean;
  recoveryTimeSec?: number;
  dataIntegrityOk?: boolean;
  replayIntegrityOk?: boolean;
  reasons: string[];
}
export const DR_THRESHOLDS: Record<DrScenario, { maxSec: number }> = {
  database_restore: { maxSec: 3600 },
  replay:           { maxSec: 900 },
  outbox_recovery:  { maxSec: 600 },
  event_replay:     { maxSec: 900 },
  payment_replay:   { maxSec: 900 },
  queue_recovery:   { maxSec: 300 },
  cache_rebuild:    { maxSec: 300 },
};
export interface DisasterRecoveryReport {
  passed: boolean;
  score: number;
  drills: DrDrillResult[];
  missingEvidence: DrScenario[];
}
function certifyDisasterRecovery(
  drills?: Partial<Record<DrScenario, Omit<DrDrillResult, "scenario" | "hasEvidence" | "passed" | "reasons">>>,
  opsReplayScore?: number,
): DisasterRecoveryReport {
  const results: DrDrillResult[] = DR_SCENARIOS.map((scenario) => {
    const d = drills?.[scenario];
    if (!d) return { scenario, hasEvidence: false, passed: false, reasons: ["no drill executed"] };
    const r: string[] = [];
    const th = DR_THRESHOLDS[scenario];
    if (d.recoveryTimeSec == null || d.recoveryTimeSec > th.maxSec) r.push(`rto>${th.maxSec}s`);
    if (d.dataIntegrityOk !== true) r.push("data-integrity");
    if (d.replayIntegrityOk !== true) r.push("replay-integrity");
    return { scenario, hasEvidence: true, passed: r.length === 0, ...d, reasons: r };
  });
  const missing = results.filter((r) => !r.hasEvidence).map((r) => r.scenario);
  const evidenced = results.filter((r) => r.hasEvidence);
  const evidenceScore = evidenced.length
    ? Math.round((evidenced.filter((r) => r.passed).length / evidenced.length) * 100)
    : 0;
  // If no drills provided, fall back to ops replay certification score capped at 70.
  const score = evidenced.length ? evidenceScore : Math.min(opsReplayScore ?? 0, 70);
  return { passed: missing.length === 0 && results.every((r) => r.passed), score, drills: results, missingEvidence: missing };
}

/* ------------------------------------------------------------------ */
/* 5. Enterprise Security Qualification                                */
/* ------------------------------------------------------------------ */
export const SECURITY_PILLARS = [
  "rbac", "rls", "jwt", "api_authorization",
  "privileged_operations", "audit_logging", "secrets", "service_permissions",
] as const;
export type SecurityPillar = typeof SECURITY_PILLARS[number];

export interface SecurityEvidence {
  /** Optional per-pillar evidence toggle (governance-derived). */
  verified: Partial<Record<SecurityPillar, boolean>>;
  openFindings?: { critical?: number; high?: number; medium?: number };
}
export interface SecurityQualificationReport {
  passed: boolean;
  score: number;
  verified: SecurityPillar[];
  unverified: SecurityPillar[];
  openCritical: number;
  openHigh: number;
}
function certifySecurity(
  gov: Workspace360GovernanceReport,
  evidence?: SecurityEvidence,
): SecurityQualificationReport {
  // Governance already enforces RBAC/RLS/audit/consistency; assume verified when
  // consistency + freeze + data-contract all pass, unless explicitly overridden.
  const govBackedVerified: Record<SecurityPillar, boolean> = {
    rbac:                  gov.certification.passed,
    rls:                   gov.freeze.passed && gov.dataContract.passed,
    jwt:                   gov.operations.passed,
    api_authorization:     gov.operations.passed,
    privileged_operations: gov.consistency.passed,
    audit_logging:         gov.operations.passed && gov.dataContract.passed,
    secrets:               gov.freeze.passed,
    service_permissions:   gov.canonical.passed,
  };
  const merged: Record<SecurityPillar, boolean> = { ...govBackedVerified };
  if (evidence?.verified) {
    for (const p of SECURITY_PILLARS) {
      if (evidence.verified[p] === false) merged[p] = false;
      else if (evidence.verified[p] === true) merged[p] = true;
    }
  }
  const verified = SECURITY_PILLARS.filter((p) => merged[p]);
  const unverified = SECURITY_PILLARS.filter((p) => !merged[p]);
  const openCritical = evidence?.openFindings?.critical ?? 0;
  const openHigh = evidence?.openFindings?.high ?? 0;
  const rawScore = Math.round((verified.length / SECURITY_PILLARS.length) * 100);
  const penalty = openCritical * 25 + openHigh * 10;
  const score = Math.max(0, rawScore - penalty);
  const passed = unverified.length === 0 && openCritical === 0 && openHigh === 0;
  return { passed, score, verified, unverified, openCritical, openHigh };
}

/* ------------------------------------------------------------------ */
/* 6. Business Acceptance Qualification (derived from D12.1)           */
/* ------------------------------------------------------------------ */
export interface BusinessAcceptanceReport {
  passed: boolean;
  score: number;
  journeys: Array<{ id: string; label: string; passed: boolean; severity: "ok" | "P1" | "P0"; reason?: string }>;
}
function certifyBusinessAcceptance(pq: ProductionQualificationReport): BusinessAcceptanceReport {
  const journeys = pq.lifecycles.map((l) => ({
    id: l.id, label: l.label, passed: l.passed, severity: l.severity,
    reason: l.reason,
  }));
  const adopted = journeys.filter((j) => pq.lifecycles.find((l) => l.id === j.id)?.adopted);
  const passingAdopted = adopted.filter((j) => j.passed).length;
  const score = adopted.length ? Math.round((passingAdopted / adopted.length) * 100) : 0;
  return { passed: journeys.every((j) => j.passed), score, journeys };
}

/* ------------------------------------------------------------------ */
/* 7. Production Release Authority (deterministic decision)            */
/* ------------------------------------------------------------------ */
export type ReleaseDecision = "PROMOTE" | "HOLD" | "ROLLBACK";
export interface ReleaseAuthorityReport {
  decision: ReleaseDecision;
  score: number;
  reasons: string[];
  pillarScores: {
    governance: number; production: number; integrations: number;
    performance: number; scalability: number; recovery: number;
    security: number; business: number;
  };
  pillarPassed: Record<string, boolean>;
}

/* ------------------------------------------------------------------ */
/* 8. Release Evidence Package                                         */
/* ------------------------------------------------------------------ */
export interface ReleaseEvidencePackage {
  build_version: string;
  git_commit: string;
  migration_version: string;
  schema_contract_version: string;
  governance_version: string;
  readiness_snapshot: { score: number; passed: boolean };
  certification_results: {
    governance: number; production: number; integrations: number;
    performance: number; scalability: number; recovery: number;
    security: number; business: number;
  };
  operational_qualification: { score: number; passed: boolean };
  business_readiness: { score: number; passed: boolean };
  executive_decision: ReleaseDecision;
  timestamp: string;
  release_approver: string;
  /** Deterministic fingerprint (FNV-1a over canonical JSON). */
  fingerprint: string;
}

/* ------------------------------------------------------------------ */
/* Composer                                                            */
/* ------------------------------------------------------------------ */
export interface ProductionValidationInputs {
  governance: Workspace360GovernanceReport;
  recommendations?: ReadonlyArray<Recommendation>;
  readinessScore?: number | null;
  integrationTelemetry?: Partial<Record<IntegrationId, IntegrationTelemetry>>;
  performance?: PerformanceMetrics;
  scalability?: Partial<Record<ScalabilityTier, ScalabilityTierResult["metrics"]>>;
  disasterRecovery?: Partial<Record<DrScenario, Omit<DrDrillResult, "scenario" | "hasEvidence" | "passed" | "reasons">>>;
  security?: SecurityEvidence;
  release?: {
    buildVersion?: string;
    gitCommit?: string;
    migrationVersion?: string;
    schemaContractVersion?: string;
    governanceVersion?: string;
    approver?: string;
    /** Deterministic clock for evidence-package timestamp; defaults to epoch. */
    now?: string;
  };
}

export interface ProductionValidationReport {
  passed: boolean;
  decision: ReleaseDecision;
  score: number;
  productionQualification: ProductionQualificationReport;
  integrations: IntegrationQualificationReport;
  performance: PerformanceCertification;
  scalability: ScalabilityReport;
  disasterRecovery: DisasterRecoveryReport;
  security: SecurityQualificationReport;
  businessAcceptance: BusinessAcceptanceReport;
  releaseAuthority: ReleaseAuthorityReport;
  evidencePackage: ReleaseEvidencePackage;
  failures: string[];
}

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function decideRelease(pillars: ReleaseAuthorityReport["pillarScores"], gov: Workspace360GovernanceReport, security: SecurityQualificationReport, pq: ProductionQualificationReport): ReleaseAuthorityReport {
  const reasons: string[] = [];
  const pillarPassed = {
    governance: gov.passed,
    production: pq.passed,
    integrations: pillars.integrations === 100,
    performance: pillars.performance >= 90,
    scalability: pillars.scalability >= 50, // ≥ 10k concurrent users tier
    recovery: pillars.recovery >= 90,
    security: security.passed,
    business: pillars.business === 100,
  };
  const hardFail = !pillarPassed.governance || !pillarPassed.production
    || security.openCritical > 0 || !pillarPassed.security;
  const softFail = !pillarPassed.integrations || !pillarPassed.performance
    || !pillarPassed.scalability || !pillarPassed.recovery || !pillarPassed.business;

  if (!pillarPassed.governance) reasons.push("governance not passing");
  if (!pillarPassed.production) reasons.push("production qualification failing");
  if (security.openCritical > 0) reasons.push(`${security.openCritical} open critical security finding(s)`);
  if (!pillarPassed.security) reasons.push("security qualification failing");
  if (!pillarPassed.integrations) reasons.push("integration qualification failing");
  if (!pillarPassed.performance) reasons.push("performance qualification failing");
  if (!pillarPassed.scalability) reasons.push("scalability floor (10k) not certified");
  if (!pillarPassed.recovery) reasons.push("disaster recovery not certified");
  if (!pillarPassed.business) reasons.push("business acceptance failing");

  let decision: ReleaseDecision;
  if (security.openCritical > 0 && pq.crossDomainIntegrity.duplicatedFinancialTables.length > 0) decision = "ROLLBACK";
  else if (hardFail) decision = "ROLLBACK";
  else if (softFail) decision = "HOLD";
  else decision = "PROMOTE";

  const score = Math.round(
    (pillars.governance + pillars.production + pillars.integrations +
      pillars.performance + pillars.scalability + pillars.recovery +
      pillars.security + pillars.business) / 8,
  );
  return { decision, score, reasons, pillarScores: pillars, pillarPassed };
}

export function certifyProductionValidation(inputs: ProductionValidationInputs): ProductionValidationReport {
  const { governance: gov } = inputs;

  const productionQualification = certifyProductionQualification({
    governance: gov,
    readinessScore: inputs.readinessScore,
    recommendations: inputs.recommendations,
  });
  const integrations = certifyIntegrations(inputs.integrationTelemetry);
  const performance = certifyPerformance(inputs.performance, { operationsScore: gov.operations.score });
  const scalability = certifyScalability(inputs.scalability);
  const disasterRecovery = certifyDisasterRecovery(inputs.disasterRecovery, gov.operations.recovery.score);
  const security = certifySecurity(gov, inputs.security);
  const businessAcceptance = certifyBusinessAcceptance(productionQualification);

  const pillarScores = {
    governance: gov.score,
    production: productionQualification.score,
    integrations: integrations.score,
    performance: performance.score,
    scalability: scalability.score,
    recovery: disasterRecovery.score,
    security: security.score,
    business: businessAcceptance.score,
  };
  const releaseAuthority = decideRelease(pillarScores, gov, security, productionQualification);

  const rel = inputs.release ?? {};
  const timestamp = rel.now ?? "1970-01-01T00:00:00.000Z";
  const evidenceCore = {
    build_version: rel.buildVersion ?? "unknown",
    git_commit: rel.gitCommit ?? "unknown",
    migration_version: rel.migrationVersion ?? "unknown",
    schema_contract_version: rel.schemaContractVersion ?? "unknown",
    governance_version: rel.governanceVersion ?? "unknown",
    readiness_snapshot: { score: inputs.readinessScore ?? gov.score, passed: gov.passed },
    certification_results: pillarScores,
    operational_qualification: { score: gov.operations.score, passed: gov.operations.passed },
    business_readiness: { score: businessAcceptance.score, passed: businessAcceptance.passed },
    executive_decision: releaseAuthority.decision,
    timestamp,
    release_approver: rel.approver ?? "system",
  };
  const evidencePackage: ReleaseEvidencePackage = {
    ...evidenceCore,
    fingerprint: fnv1a(JSON.stringify(evidenceCore)),
  };

  const failures: string[] = [...releaseAuthority.reasons];
  const passed = releaseAuthority.decision === "PROMOTE";

  return {
    passed,
    decision: releaseAuthority.decision,
    score: releaseAuthority.score,
    productionQualification,
    integrations,
    performance,
    scalability,
    disasterRecovery,
    security,
    businessAcceptance,
    releaseAuthority,
    evidencePackage,
    failures,
  };
}
