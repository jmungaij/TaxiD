/**
 * Phase D7.7 — Workspace360 Production Governance.
 *
 * Single, pure-function aggregator that unifies every Workspace360
 * enterprise gate into ONE report. This is the certification surface
 * every future 360 module (Courier, Package, Logistics, Rental) must
 * clear before it can be deployed.
 *
 * It combines:
 *   • D7.2 registry certification (certifyWorkspace360)
 *   • D7.3 per-domain health + dependency certification
 *   • D7.5 canonical shared-service audit
 *   • D7.6 cross-domain workflow certification
 *   • D7.7 duplicated-financial-logic detection
 *
 * No network. No new tables. Consumed by CI + the Readiness card.
 */
import {
  certifyWorkspace360Health,
  certifyWorkspace360CanonicalServices,
  WORKSPACE360_HEALTH,
  WORKSPACE360_CANONICAL_SERVICES,
  type Workspace360HealthContract,
  type Workspace360HealthReport,
  type Workspace360CanonicalReport,
} from "./health";
import {
  certifyWorkspace360,
  type Workspace360Contract,
  type Workspace360Certification,
  type RouteLike,
} from "./certification";
import {
  certifyCrossDomainWorkflows,
  type CrossDomainWorkflowReport,
} from "./workflows";
import { WORKSPACE360_DOMAINS, type Workspace360Domain } from "./domains";
import {
  certifyBusinessConsistency,
  type BusinessConsistencyReport,
} from "./consistency";
import {
  certifyOperationalQualification,
  type OperationalQualificationReport,
} from "./operations";
import {
  certifyDataContract,
  type DataContractCertificationReport,
} from "./dataContract";
import {
  certifyFreezeAudit,
  type FreezeAuditReport,
} from "./freezeAudit";
import {
  certifyDomainConvergence,
  type ConvergenceReport,
} from "./convergence";
import {
  certifyBusinessCapabilityRegistry,
  type BusinessCapabilityRegistryCertification,
} from "./capabilities";
import {
  certifyBusinessForecastFromGovernance,
  type BusinessForecastCertification,
} from "./businessForecast";

/**
 * Table-name patterns that indicate a domain has forked its own financial
 * logic instead of reusing the canonical wallet / ledger / journal / payment
 * services. Domain-owned FK tables (e.g. `rider_wallets`, `corporate_invoices`)
 * are allowed — they are canonical extensions. What we forbid is a domain
 * declaring its OWN ledger/journal/payment tables.
 */
const FORBIDDEN_FINANCIAL_FORKS: ReadonlyArray<RegExp> = [
  /_ledger_accounts$/,
  /_journal_lines$/,
  /_journals$/,
  /_payment_attempts$/,
  /_mpesa_transactions$/,
];

export interface Workspace360DomainGovernance {
  domain: Workspace360Domain;
  adopted: boolean;
  certificationPassed: boolean;
  healthScore: number;
  workflowScore: number;              // % of workflows passing that touch this domain
  canonicalServiceCount: number;      // shared canonical tables used by this domain
  usesCanonicalFinance: boolean;      // canonicalServiceCount > 0
  duplicatedFinancialTables: string[];
  missingDependencies: {
    tables: string[];
    rpcs: string[];
    edgeFunctions: string[];
  };
  failures: string[];
}

export interface Workspace360GovernanceReport {
  passed: boolean;
  score: number;                      // 0-100 blended governance score
  certification: Workspace360Certification;
  health: Workspace360HealthReport;
  canonical: Workspace360CanonicalReport;
  workflows: CrossDomainWorkflowReport;
  consistency: BusinessConsistencyReport; // D7.8 — business consistency
  operations: OperationalQualificationReport; // D7.9 — operational qualification
  dataContract: DataContractCertificationReport; // D8.3 — data contract & operational integrity
  freeze: FreezeAuditReport;          // Freeze audit — pre-D9 ratchet
  convergence: ConvergenceReport;     // D9.0 — enterprise business domain convergence
  capabilityRegistry: BusinessCapabilityRegistryCertification; // D11.0 — business capability registry
  forecast: BusinessForecastCertification; // D11.1 — business forecast & early warning certification
  domains: Workspace360DomainGovernance[];
  failures: string[];                 // top-level, non-domain-specific
}

function detectDuplicatedFinancial(tables: string[]): string[] {
  return tables.filter((t) => FORBIDDEN_FINANCIAL_FORKS.some((rx) => rx.test(t)));
}

export function certifyWorkspace360Governance(
  contract: Workspace360Contract & Workspace360HealthContract,
  routes: ReadonlyArray<RouteLike>,
): Workspace360GovernanceReport {
  const adopted = contract.adopted_domains ?? [];
  const certification = certifyWorkspace360(contract, routes);
  const health = certifyWorkspace360Health(adopted, contract);
  const canonical = certifyWorkspace360CanonicalServices(adopted);
  const workflows = certifyCrossDomainWorkflows(adopted);
  const consistency = certifyBusinessConsistency(contract, adopted);
  const operations = certifyOperationalQualification(contract);
  const dataContract = certifyDataContract(contract);
  const freeze = certifyFreezeAudit({ contract: contract as never });
  const convergence = certifyDomainConvergence({ adoptedDomains: adopted });
  const capabilityRegistry = certifyBusinessCapabilityRegistry();
  const forecast = certifyBusinessForecastFromGovernance();




  const canonicalSet = new Set<string>(WORKSPACE360_CANONICAL_SERVICES);
  const adoptedSet = new Set(adopted);

  const domains: Workspace360DomainGovernance[] = WORKSPACE360_DOMAINS.map((domain) => {
    const spec = WORKSPACE360_HEALTH[domain];
    const isAdopted = adoptedSet.has(domain);
    const h = health.domains.find((d) => d.domain === domain)!;
    const cert = certification.domains.find((d) => d.domain === domain);
    const failures: string[] = cert?.failures ? [...cert.failures] : [];

    const declared = spec?.tables ?? [];
    const canonicalUsed = declared.filter((t) => canonicalSet.has(t));
    const duplicated = detectDuplicatedFinancial(declared);
    if (isAdopted && duplicated.length > 0) {
      failures.push(`duplicated financial logic: ${duplicated.join(", ")}`);
    }
    if (isAdopted && canonicalUsed.length === 0) {
      failures.push("does not reference canonical wallet/ledger/journal services");
    }

    // Workflow score for this domain: fraction of workflows touching it that pass.
    const touching = workflows.workflows.filter((w) =>
      w.steps.some((s) => s.step.domain === domain));
    const passingTouching = touching.filter((w) => w.passed).length;
    const workflowScore = touching.length === 0
      ? 100
      : Math.round((passingTouching / touching.length) * 100);

    return {
      domain,
      adopted: isAdopted,
      certificationPassed: (cert?.passed ?? true),
      healthScore: h.overallScore,
      workflowScore,
      canonicalServiceCount: canonicalUsed.length,
      usesCanonicalFinance: canonicalUsed.length > 0,
      duplicatedFinancialTables: duplicated,
      missingDependencies: {
        tables: h.missingTables,
        rpcs: h.missingRpcs,
        edgeFunctions: h.missingEdgeFunctions,
      },
      failures,
    };
  });

  const topFailures: string[] = [];
  topFailures.push(...certification.globalFailures);
  if (!workflows.passed) topFailures.push(`cross-domain workflows failing (${workflows.score}/100)`);
  if (!canonical.passed) {
    for (const d of canonical.divergentDomains) {
      topFailures.push(`domain '${d.domain}' does not use canonical shared services`);
    }
  }

  if (!consistency.passed) {
    for (const f of consistency.failures) topFailures.push(`consistency: ${f}`);
  }
  if (!operations.passed) {
    for (const f of operations.failures) topFailures.push(`operations: ${f}`);
  }
  if (!dataContract.passed) {
    for (const f of dataContract.failures) topFailures.push(`data-contract: ${f}`);
  }
  if (!freeze.passed) {
    for (const f of freeze.p0) topFailures.push(`freeze: ${f.message}`);
  }
  if (!convergence.passed) {
    for (const f of convergence.p0) topFailures.push(`convergence: ${f.message}`);
  }

  const adoptedDomainReports = domains.filter((d) => d.adopted);
  const passed =
    certification.passed &&
    health.passed &&
    canonical.passed &&
    workflows.passed &&
    consistency.passed &&
    operations.passed &&
    dataContract.passed &&
    freeze.passed &&
    convergence.passed &&
    adoptedDomainReports.every((d) =>
      d.certificationPassed &&
      d.healthScore === 100 &&
      d.workflowScore === 100 &&
      d.usesCanonicalFinance &&
      d.duplicatedFinancialTables.length === 0);

  // Blended score = mean(certification, health, workflow, consistency, ops, data-contract, freeze, convergence) − dup penalty.
  const rawScore = Math.round(
    (certification.score + health.platformScore + workflows.score +
      consistency.score + operations.score + dataContract.score +
      freeze.score + convergence.score) / 8,
  );
  const dupPenalty = adoptedDomainReports.reduce(
    (acc, d) => acc + d.duplicatedFinancialTables.length * 10,
    0,
  );
  const score = Math.max(0, Math.min(100, rawScore - dupPenalty));

  return {
    passed,
    score,
    certification,
    health,
    canonical,
    workflows,
    consistency,
    operations,
    dataContract,
    freeze,
    convergence,
    capabilityRegistry,
    forecast,
    domains,
    failures: topFailures,
  };
}

