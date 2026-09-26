/**
 * Phase D7.8 — Enterprise Business Consistency Certification.
 *
 * Pure, network-free certifier that extends structural governance (D7.7)
 * with BUSINESS consistency guarantees. It answers: do every dashboard,
 * workspace, and workflow read the SAME canonical values for the same
 * entity? Or has a fork silently emerged?
 *
 * Four sub-certifications:
 *   1. KPI Reconciliation      — each canonical KPI has ONE canonical source
 *   2. Financial Consistency   — the finance chain uses only canonical tables
 *   3. Cross-Domain Entity     — same entity resolves to the same table everywhere
 *   4. Workflow Determinism    — declared workflows are ordered, unique, canonical
 *
 * The declarations below are the source of truth. Adding a KPI, entity,
 * or workflow immediately ratchets the CI gate and the Readiness card.
 *
 * No new tables. No new dashboards. No new edge functions.
 */
import {
  WORKSPACE360_HEALTH,
  WORKSPACE360_CANONICAL_SERVICES,
  type Workspace360HealthContract,
} from "./health";
import {
  WORKSPACE360_WORKFLOWS,
  CANONICAL_SHARED_SERVICES,
  certifyCrossDomainWorkflows,
  type Workspace360Workflow,
} from "./workflows";
import { WORKSPACE360_DOMAINS, type Workspace360Domain } from "./domains";

/* ----------------------------------------------------------------------- *
 * 1. Canonical KPI registry.
 *
 * Every executive/finance/operations dashboard that shows one of these
 * KPIs MUST read from the declared canonical source. If two dashboards
 * derive the same KPI from different sources, we get business drift and
 * this certifier flags it.
 * ----------------------------------------------------------------------- */
export interface CanonicalKpi {
  key: string;
  label: string;
  /** RPC or table that is the ONE source of truth for this KPI. */
  canonicalSource: string;
  sourceKind: "rpc" | "table";
}

export const CANONICAL_KPIS: readonly CanonicalKpi[] = [
  { key: "driver.wallet_balance",   label: "Driver wallet balance",   canonicalSource: "wallets",                          sourceKind: "table" },
  { key: "driver.metrics",          label: "Driver operational KPIs", canonicalSource: "driver_metrics",                   sourceKind: "rpc"   },
  { key: "driver.admin_metrics",    label: "Driver admin KPIs",       canonicalSource: "driver_admin_metrics",             sourceKind: "rpc"   },
  { key: "driver.timeline",         label: "Driver activity timeline",canonicalSource: "driver_timeline",                  sourceKind: "rpc"   },
  { key: "driver.op_consistency",   label: "Driver op-consistency",   canonicalSource: "certify_driver_operational_consistency", sourceKind: "rpc" },
  { key: "finance.journal_lines",   label: "Finance journal lines",   canonicalSource: "journal_lines",                    sourceKind: "table" },
  { key: "finance.ledger_accounts", label: "Ledger accounts",         canonicalSource: "ledger_accounts",                  sourceKind: "table" },
  { key: "finance.payment_attempts",label: "Payment attempts",        canonicalSource: "payment_attempts",                 sourceKind: "table" },
  { key: "readiness.platform_v2",   label: "Platform readiness v2",   canonicalSource: "compute_platform_readiness_v2",    sourceKind: "rpc"   },
] as const;

export interface KpiReconciliationReport {
  passed: boolean;
  score: number;
  total: number;
  reconciled: number;
  missing: Array<{ key: string; canonicalSource: string; reason: string }>;
  duplicates: Array<{ source: string; kpis: string[] }>;
}

export function certifyKpiReconciliation(
  contract: Workspace360HealthContract,
  kpis: readonly CanonicalKpi[] = CANONICAL_KPIS,
): KpiReconciliationReport {
  const tables = new Set(contract.tables ?? []);
  const rpcs = new Set(contract.rpcs ?? []);
  const missing: KpiReconciliationReport["missing"] = [];
  for (const k of kpis) {
    const present = k.sourceKind === "table" ? tables.has(k.canonicalSource) : rpcs.has(k.canonicalSource);
    if (!present) {
      missing.push({
        key: k.key,
        canonicalSource: k.canonicalSource,
        reason: `${k.sourceKind} '${k.canonicalSource}' not registered in schema-contract`,
      });
    }
  }
  // Two KPIs pointing at the same source = accidental collision (drift risk).
  const bySource = new Map<string, string[]>();
  for (const k of kpis) {
    const arr = bySource.get(k.canonicalSource) ?? [];
    arr.push(k.key);
    bySource.set(k.canonicalSource, arr);
  }
  const duplicates: KpiReconciliationReport["duplicates"] = [];
  for (const [source, keys] of bySource) {
    if (keys.length > 1) duplicates.push({ source, kpis: keys });
  }
  const reconciled = kpis.length - missing.length;
  const score = kpis.length === 0 ? 100 : Math.round((reconciled / kpis.length) * 100);
  return {
    passed: missing.length === 0 && duplicates.length === 0,
    score, total: kpis.length, reconciled, missing, duplicates,
  };
}

/* ----------------------------------------------------------------------- *
 * 2. Canonical financial chain.
 *
 * Every completed trip must flow through EXACTLY these tables in order.
 * Any adopted domain that introduces a private step breaks reconciliation
 * between wallet, ledger, journal, payment and settlement.
 * ----------------------------------------------------------------------- */
export const CANONICAL_FINANCIAL_CHAIN: readonly string[] = [
  "wallets",
  "wallet_transactions",
  "ledger_accounts",
  "journals",
  "journal_lines",
  "payment_attempts",
  "settlements",
] as const;

export interface FinancialConsistencyReport {
  passed: boolean;
  score: number;
  chain: string[];
  missing: string[];
}

export function certifyFinancialConsistency(
  contract: Workspace360HealthContract,
): FinancialConsistencyReport {
  const tables = new Set(contract.tables ?? []);
  const missing = CANONICAL_FINANCIAL_CHAIN.filter((t) => !tables.has(t));
  const score = Math.round(
    ((CANONICAL_FINANCIAL_CHAIN.length - missing.length) / CANONICAL_FINANCIAL_CHAIN.length) * 100,
  );
  return {
    passed: missing.length === 0,
    score, chain: [...CANONICAL_FINANCIAL_CHAIN], missing,
  };
}

/* ----------------------------------------------------------------------- *
 * 3. Cross-domain entity consistency.
 *
 * Same business entity → same canonical table across every adopted
 * workspace. If a domain declares its own fork (e.g. "courier_wallets"
 * as its wallet), the entity resolves to two different truths and this
 * certifier blocks.
 * ----------------------------------------------------------------------- */
export interface CanonicalEntity {
  entity: string;
  canonicalTable: string;
  /** Table-name regex patterns that would represent a fork. */
  forbiddenForks: RegExp[];
}

export const CANONICAL_ENTITIES: readonly CanonicalEntity[] = [
  { entity: "wallet",          canonicalTable: "wallets",              forbiddenForks: [/^(?!wallets$).*_wallets$/] },
  { entity: "wallet_txn",      canonicalTable: "wallet_transactions",  forbiddenForks: [/^(?!wallet_transactions$).*_wallet_transactions$/] },
  { entity: "journal_line",    canonicalTable: "journal_lines",        forbiddenForks: [/_journal_lines$/] },
  { entity: "ledger_account",  canonicalTable: "ledger_accounts",      forbiddenForks: [/_ledger_accounts$/] },
  { entity: "payment_attempt", canonicalTable: "payment_attempts",     forbiddenForks: [/_payment_attempts$/] },
  { entity: "trip",            canonicalTable: "trip_bookings",        forbiddenForks: [/_trip_bookings$/] },
] as const;

// Domain-owned canonical extensions that must not be flagged as forks even
// though they match a fork pattern (e.g. rider_wallets is a canonical FK
// extension of wallets, not a separate wallet engine).
const CANONICAL_EXTENSIONS: ReadonlySet<string> = new Set([
  "rider_wallets",
  "rider_wallet_transactions",
]);

export interface EntityConsistencyReport {
  passed: boolean;
  score: number;
  entities: Array<{
    entity: string;
    canonicalTable: string;
    forks: Array<{ domain: Workspace360Domain; table: string }>;
  }>;
}

export function certifyEntityConsistency(
  adoptedDomains: string[],
  entities: readonly CanonicalEntity[] = CANONICAL_ENTITIES,
): EntityConsistencyReport {
  const adopted = new Set(adoptedDomains);
  const results: EntityConsistencyReport["entities"] = entities.map((e) => {
    const forks: Array<{ domain: Workspace360Domain; table: string }> = [];
    for (const domain of WORKSPACE360_DOMAINS) {
      if (!adopted.has(domain)) continue;
      const spec = WORKSPACE360_HEALTH[domain];
      if (!spec) continue;
      for (const t of spec.tables) {
        if (t === e.canonicalTable) continue;
        if (CANONICAL_EXTENSIONS.has(t)) continue;
        if (e.forbiddenForks.some((rx) => rx.test(t))) {
          forks.push({ domain, table: t });
        }
      }
    }
    return { entity: e.entity, canonicalTable: e.canonicalTable, forks };
  });
  const bad = results.reduce((a, r) => a + r.forks.length, 0);
  const score = bad === 0 ? 100 : Math.max(0, 100 - bad * 10);
  return { passed: bad === 0, score, entities: results };
}

/* ----------------------------------------------------------------------- *
 * 4. Workflow determinism.
 *
 * A workflow must be:
 *   • uniquely id'd
 *   • strictly ordered (no re-orderable branches expressed as duplicate steps)
 *   • fully canonical under the D7.6 workflow certifier
 *   • use each (domain, table) at most once per workflow
 * ----------------------------------------------------------------------- */
export interface WorkflowDeterminismReport {
  passed: boolean;
  score: number;
  workflows: Array<{
    id: string;
    passed: boolean;
    /** Domains deferred by the documented adoption registry (reported, not failed). */
    deferred: boolean;
    reasons: string[];
  }>;
}

export function certifyWorkflowDeterminism(
  adoptedDomains: string[],
  workflows: Workspace360Workflow[] = WORKSPACE360_WORKFLOWS,
): WorkflowDeterminismReport {
  const canonicalReport = certifyCrossDomainWorkflows(adoptedDomains, workflows);
  const seenIds = new Set<string>();
  const results = workflows.map((wf) => {
    const reasons: string[] = [];
    if (seenIds.has(wf.id)) reasons.push(`duplicate workflow id '${wf.id}'`);
    seenIds.add(wf.id);
    const stepKey = new Set<string>();
    for (const s of wf.steps) {
      const k = `${s.domain}:${s.table}`;
      if (stepKey.has(k)) reasons.push(`repeated step ${k}`);
      stepKey.add(k);
    }
    const canonical = canonicalReport.workflows.find((w) => w.id === wf.id);
    const deferred = canonical?.deferred ?? false;
    if (canonical && !canonical.passed) {
      for (const s of canonical.steps.filter((x) => !x.canonical)) {
        reasons.push(s.reason ?? `non-canonical step ${s.step.table}`);
      }
    }
    // Structural defects (duplicate ids / repeated steps) always fail, even for
    // deferred workflows; adoption-only reasons are deferred, not failures.
    const structural = reasons.filter(
      (r) => !r.includes("not adopted onto Workspace360Shell"),
    );
    return {
      id: wf.id,
      passed: deferred ? structural.length === 0 : reasons.length === 0,
      deferred,
      reasons,
    };
  });
  const passing = results.filter((r) => r.passed).length;
  const score = results.length === 0 ? 100 : Math.round((passing / results.length) * 100);
  return { passed: results.every((r) => r.passed), score, workflows: results };
}


/* ----------------------------------------------------------------------- *
 * Aggregate report.
 * ----------------------------------------------------------------------- */
export interface BusinessConsistencyReport {
  passed: boolean;
  score: number;                              // blended 0-100
  kpi: KpiReconciliationReport;
  financial: FinancialConsistencyReport;
  entity: EntityConsistencyReport;
  workflow: WorkflowDeterminismReport;
  failures: string[];
}

export function certifyBusinessConsistency(
  contract: Workspace360HealthContract,
  adoptedDomains: string[],
): BusinessConsistencyReport {
  const kpi = certifyKpiReconciliation(contract);
  const financial = certifyFinancialConsistency(contract);
  const entity = certifyEntityConsistency(adoptedDomains);
  const workflow = certifyWorkflowDeterminism(adoptedDomains);

  const failures: string[] = [];
  for (const m of kpi.missing)     failures.push(`KPI '${m.key}': ${m.reason}`);
  for (const d of kpi.duplicates)  failures.push(`KPI duplicate source '${d.source}' → ${d.kpis.join(", ")}`);
  for (const t of financial.missing) failures.push(`Financial chain missing table '${t}'`);
  for (const e of entity.entities) {
    for (const f of e.forks) {
      failures.push(`Entity '${e.entity}' forked by ${f.domain}.${f.table} (canonical=${e.canonicalTable})`);
    }
  }
  for (const w of workflow.workflows.filter((x) => !x.passed)) {
    failures.push(`Workflow '${w.id}' non-deterministic: ${w.reasons.join("; ")}`);
  }

  const score = Math.round((kpi.score + financial.score + entity.score + workflow.score) / 4);
  const passed = kpi.passed && financial.passed && entity.passed && workflow.passed;
  return { passed, score, kpi, financial, entity, workflow, failures };
}

/** Convenience for governance callers: expose canonical services used. */
export const CANONICAL_SURFACE = {
  services: WORKSPACE360_CANONICAL_SERVICES,
  sharedTables: CANONICAL_SHARED_SERVICES,
} as const;
