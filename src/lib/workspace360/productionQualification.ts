/**
 * Phase D12.1 — Production Qualification & Operational Readiness Ratchet.
 *
 * Pure, deterministic aggregator that answers a single question:
 *   "Is the platform operationally qualified for production, based on the
 *    evidence produced by the existing D7–D12 certification stack?"
 *
 * This module does NOT compute new business signals. It composes existing
 * governance / workspace360 / operations / data-contract / freeze /
 * convergence / decision-engine reports and layers three deterministic
 * production gates on top:
 *
 *   1. End-to-end business workflow lifecycle coverage
 *   2. Cross-domain operational integrity (canonical shared services)
 *   3. Recovery evidence certification (no completion without evidence)
 *   4. Governance freeze validation (zero-duplicate architecture)
 *
 * No new tables. No new dashboards. No new engines.
 */
import type { Workspace360GovernanceReport } from "./governance";
import type { Recommendation } from "./decisionEngine";
import { WORKSPACE360_DOMAINS, type Workspace360Domain } from "./domains";

/* ------------------------------------------------------------------ */
/* Lifecycle catalogue — every critical business workflow the platform  */
/* must certify end-to-end. Adding a lifecycle here immediately ratchets */
/* the production gate.                                                  */
/* ------------------------------------------------------------------ */
export interface LifecycleSpec {
  id: string;
  label: string;
  primaryDomain: Workspace360Domain;
  /** Workflow ids from WORKSPACE360_WORKFLOWS that certify this lifecycle. */
  workflowIds: string[];
}

export const PRODUCTION_LIFECYCLES: ReadonlyArray<LifecycleSpec> = [
  { id: "driver",            label: "Driver registration → trip → wallet → ledger → settlement", primaryDomain: "driver",    workflowIds: ["rider-trip-settlement", "fleet-vehicle-earnings"] },
  { id: "rider",             label: "Rider lifecycle",                                            primaryDomain: "rider",     workflowIds: ["rider-trip-settlement"] },
  { id: "corporate-billing", label: "Corporate billing lifecycle",                                primaryDomain: "corporate", workflowIds: ["corporate-approval-invoice"] },
  { id: "fleet",             label: "Fleet lifecycle",                                            primaryDomain: "fleet",     workflowIds: ["fleet-vehicle-earnings"] },
  { id: "courier",           label: "Courier lifecycle",                                          primaryDomain: "courier",   workflowIds: [] },
  { id: "package",           label: "Package lifecycle",                                          primaryDomain: "package",   workflowIds: [] },
  { id: "logistics",         label: "Logistics lifecycle",                                        primaryDomain: "logistics", workflowIds: [] },
  { id: "rental",            label: "Rental lifecycle",                                           primaryDomain: "rental",    workflowIds: [] },
];

export interface LifecycleQualification {
  id: string;
  label: string;
  primaryDomain: Workspace360Domain;
  adopted: boolean;
  covered: boolean;              // has at least one declared workflow
  workflowPass: number;
  workflowTotal: number;
  passed: boolean;               // adopted → all referenced workflows pass; unadopted → covered=false is a P1 gap
  severity: "ok" | "P1" | "P0";
  reason?: string;
}

export interface CrossDomainIntegrity {
  passed: boolean;
  score: number;
  divergentDomains: string[];    // adopted domains not using canonical shared services
  duplicatedFinancialTables: string[]; // forbidden forks detected across adopted domains
}

export interface RecoveryEvidenceCertification {
  passed: boolean;
  totalCompleted: number;
  verified: number;
  unverified: number;
  violations: string[];          // reco ids that were marked completed without evidence
}

export interface FreezeCertificate {
  passed: boolean;
  freezeScore: number;
  p0: number;
  p1: number;
  duplicateFinancialTables: number;
  duplicatedDomains: number;
}

export interface ProductionSummary {
  overallReadiness: number;      // 0-100
  blockingIssues: string[];
  certificationPassRate: number; // % of pillars passing
  workflowPassRate: number;
  operationalHealth: number;
  financialHealth: number;
  governanceHealth: number;
  businessReadiness: number;
  executiveReadiness: number;
}

export interface ProductionQualificationReport {
  passed: boolean;
  score: number;                 // 0-100 blended qualification score
  lifecycles: LifecycleQualification[];
  crossDomainIntegrity: CrossDomainIntegrity;
  recoveryEvidence: RecoveryEvidenceCertification;
  freeze: FreezeCertificate;
  summary: ProductionSummary;
  failures: string[];
}

export interface ProductionQualificationInputs {
  governance: Workspace360GovernanceReport;
  /** Optional canonical readiness score (from compute_platform_readiness_v2). */
  readinessScore?: number | null;
  /** Optional decision-engine recommendations for recovery-evidence audit. */
  recommendations?: ReadonlyArray<Recommendation>;
}

function certifyLifecycles(gov: Workspace360GovernanceReport): LifecycleQualification[] {
  const adopted = new Set(gov.domains.filter((d) => d.adopted).map((d) => d.domain));
  const wfById = new Map(gov.workflows.workflows.map((w) => [w.id, w]));
  return PRODUCTION_LIFECYCLES.map((L) => {
    const isAdopted = adopted.has(L.primaryDomain);
    const covered = L.workflowIds.length > 0;
    const referenced = L.workflowIds.map((id) => wfById.get(id)).filter((w): w is NonNullable<typeof w> => !!w);
    const workflowPass = referenced.filter((w) => w.passed).length;
    const workflowTotal = referenced.length;

    if (!isAdopted) {
      return {
        id: L.id, label: L.label, primaryDomain: L.primaryDomain,
        adopted: false, covered, workflowPass, workflowTotal,
        passed: true, severity: "P1", reason: "Domain not yet adopted onto Workspace360Shell",
      };
    }
    if (!covered) {
      return {
        id: L.id, label: L.label, primaryDomain: L.primaryDomain,
        adopted: true, covered: false, workflowPass: 0, workflowTotal: 0,
        passed: false, severity: "P0", reason: "Adopted lifecycle has no certified workflow",
      };
    }
    const allPass = workflowTotal > 0 && workflowPass === workflowTotal;
    return {
      id: L.id, label: L.label, primaryDomain: L.primaryDomain,
      adopted: true, covered: true, workflowPass, workflowTotal,
      passed: allPass, severity: allPass ? "ok" : "P0",
      reason: allPass ? undefined : `${workflowTotal - workflowPass} referenced workflow(s) failing`,
    };
  });
}

function certifyCrossDomainIntegrity(gov: Workspace360GovernanceReport): CrossDomainIntegrity {
  const divergent = gov.canonical.divergentDomains.map((d) => d.domain);
  const dup = gov.domains
    .filter((d) => d.adopted)
    .flatMap((d) => d.duplicatedFinancialTables.map((t) => `${d.domain}:${t}`));
  const passed = gov.canonical.passed && dup.length === 0;
  const penalty = divergent.length * 10 + dup.length * 15;
  const score = Math.max(0, 100 - penalty);
  return { passed, score, divergentDomains: divergent, duplicatedFinancialTables: dup };
}

function certifyRecoveryEvidence(recos?: ReadonlyArray<Recommendation>): RecoveryEvidenceCertification {
  if (!recos || recos.length === 0) {
    return { passed: true, totalCompleted: 0, verified: 0, unverified: 0, violations: [] };
  }
  const completed = recos.filter((r) => r.execution.status === "completed");
  const violations: string[] = [];
  let verified = 0;
  for (const r of completed) {
    const hasObservation = r.execution.observed != null && r.execution.observed !== undefined;
    if (hasObservation) verified += 1;
    else violations.push(r.id);
  }
  return {
    passed: violations.length === 0,
    totalCompleted: completed.length,
    verified,
    unverified: violations.length,
    violations,
  };
}

function certifyFreeze(gov: Workspace360GovernanceReport): FreezeCertificate {
  const dupTables = gov.domains.filter((d) => d.adopted).reduce(
    (acc, d) => acc + d.duplicatedFinancialTables.length, 0,
  );
  const duplicatedDomains = gov.domains.filter((d) => d.adopted && d.duplicatedFinancialTables.length > 0).length;
  const p0 = gov.freeze.p0.length;
  const p1 = gov.freeze.p1.length;
  const passed = gov.freeze.passed && dupTables === 0;
  return {
    passed, freezeScore: gov.freeze.score, p0, p1,
    duplicateFinancialTables: dupTables, duplicatedDomains,
  };
}

function computeSummary(
  gov: Workspace360GovernanceReport,
  lifecycles: LifecycleQualification[],
  cross: CrossDomainIntegrity,
  recovery: RecoveryEvidenceCertification,
  freeze: FreezeCertificate,
  readinessScore: number | null | undefined,
  recos: ReadonlyArray<Recommendation> | undefined,
): ProductionSummary {
  const pillars: Array<{ key: string; passed: boolean }> = [
    { key: "certification",   passed: gov.certification.passed },
    { key: "workspace360",    passed: gov.health.passed && gov.canonical.passed },
    { key: "workflows",       passed: gov.workflows.passed },
    { key: "consistency",     passed: gov.consistency.passed },
    { key: "operations",      passed: gov.operations.passed },
    { key: "dataContract",    passed: gov.dataContract.passed },
    { key: "freeze",          passed: freeze.passed },
    { key: "convergence",     passed: gov.convergence.passed },
    { key: "capabilities",    passed: gov.capabilityRegistry.passed },
    { key: "forecast",        passed: gov.forecast.passed },
    { key: "lifecycles",      passed: lifecycles.every((l) => l.passed) },
    { key: "crossDomain",     passed: cross.passed },
    { key: "recoveryEvidence", passed: recovery.passed },
  ];
  const certificationPassRate = Math.round(
    (pillars.filter((p) => p.passed).length / pillars.length) * 100,
  );

  const blocking: string[] = [];
  blocking.push(...gov.failures);
  for (const l of lifecycles) if (!l.passed) blocking.push(`lifecycle:${l.id} — ${l.reason ?? "failing"}`);
  if (!cross.passed) blocking.push(`cross-domain integrity — divergent=${cross.divergentDomains.length} dup=${cross.duplicatedFinancialTables.length}`);
  for (const v of recovery.violations) blocking.push(`recovery-evidence:${v} completed without evidence`);
  if (!freeze.passed) blocking.push(`freeze — dup-tables=${freeze.duplicateFinancialTables} P0=${freeze.p0}`);

  const rec = readinessScore ?? gov.score;
  const overallReadiness = Math.max(0, Math.min(100, Math.min(rec, gov.score)));

  const executiveReadiness = !recos || recos.length === 0
    ? (recovery.passed ? 100 : 0)
    : Math.round(((recos.length - recovery.unverified) / recos.length) * 100);

  return {
    overallReadiness,
    blockingIssues: blocking,
    certificationPassRate,
    workflowPassRate: gov.workflows.score,
    operationalHealth: gov.operations.score,
    financialHealth: gov.consistency.financial.score,
    governanceHealth: gov.score,
    businessReadiness: gov.capabilityRegistry.score,
    executiveReadiness,
  };
}

/**
 * Deterministic Production Qualification certifier. Pure function.
 */
export function certifyProductionQualification(
  inputs: ProductionQualificationInputs,
): ProductionQualificationReport {
  const { governance: gov, readinessScore, recommendations } = inputs;

  // Guard: unknown domain in lifecycle catalogue would be a coding error.
  for (const L of PRODUCTION_LIFECYCLES) {
    if (!WORKSPACE360_DOMAINS.includes(L.primaryDomain)) {
      throw new Error(`Production lifecycle references unknown domain: ${L.primaryDomain}`);
    }
  }

  const lifecycles = certifyLifecycles(gov);
  const crossDomainIntegrity = certifyCrossDomainIntegrity(gov);
  const recoveryEvidence = certifyRecoveryEvidence(recommendations);
  const freeze = certifyFreeze(gov);
  const summary = computeSummary(gov, lifecycles, crossDomainIntegrity, recoveryEvidence, freeze, readinessScore, recommendations);

  const failures: string[] = [...summary.blockingIssues];
  const passed =
    lifecycles.every((l) => l.passed) &&
    crossDomainIntegrity.passed &&
    recoveryEvidence.passed &&
    freeze.passed;

  const lifecyclePassRate = Math.round(
    (lifecycles.filter((l) => l.passed).length / lifecycles.length) * 100,
  );
  const score = Math.max(0, Math.min(100, Math.round(
    (lifecyclePassRate + crossDomainIntegrity.score + freeze.freezeScore +
      (recoveryEvidence.passed ? 100 : 0)) / 4,
  )));

  return {
    passed,
    score,
    lifecycles,
    crossDomainIntegrity,
    recoveryEvidence,
    freeze,
    summary,
    failures,
  };
}
