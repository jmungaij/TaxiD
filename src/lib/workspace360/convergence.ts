/**
 * Phase D9.0 — Enterprise Business Domain Convergence.
 *
 * ONE pure-function certifier that ratchets every business domain onto the
 * same canonical enterprise architecture. It does NOT introduce new modules,
 * dashboards, tables, RPCs, or engines — it aggregates the existing
 * certifiers (health, canonical, workflows, dataContract, freezeAudit)
 * into one convergence surface consumed by CI + the Readiness card.
 *
 * The five convergence axes (see `Objective` in the D9.0 prompt):
 *   1. Domain adoption          — every registered Workspace360 domain runs on Workspace360Shell.
 *   2. Canonical services       — every adopted domain reads canonical wallet/ledger/journal/payment.
 *   3. Financial engine         — no domain forks its own ledger/journal/payment tables.
 *   4. Workflow convergence     — every adopted domain is exercised by ≥1 canonical workflow.
 *   5. Performance baseline     — the eight platform latency slots are recorded (no live probes).
 *
 * Fail state is P0. Warnings (missing baselines, unadopted domains) are P1.
 * No I/O. No new tables. No new dashboards.
 */
import {
  WORKSPACE360_DOMAINS,
  WORKSPACE360_DEFERRED_ADOPTIONS,
  type Workspace360Domain,
} from "./domains";
import {
  WORKSPACE360_HEALTH,
  WORKSPACE360_CANONICAL_SERVICES,
} from "./health";
import { WORKSPACE360_WORKFLOWS, certifyCrossDomainWorkflows } from "./workflows";

/* ------------------------------------------------------------------------- *
 * Types
 * ------------------------------------------------------------------------- */

export type ConvergenceSeverity = "P0" | "P1";

export type ConvergenceCategory =
  | "domain_adoption"
  | "canonical_services"
  | "financial_engine"
  | "workflow_convergence"
  | "performance_baseline"
  | "duplication";

export interface ConvergenceFinding {
  category: ConvergenceCategory;
  severity: ConvergenceSeverity;
  domain?: Workspace360Domain;
  message: string;
  detail?: Record<string, unknown>;
}

/** Canonical platform latency slots the D9.0 prompt requires baselines for. */
export const PERFORMANCE_BASELINE_SLOTS = [
  "page_load_ms",
  "rpc_latency_ms",
  "edge_function_latency_ms",
  "db_query_ms",
  "timeline_render_ms",
  "workspace_switch_ms",
  "executive_refresh_ms",
  "ops_center_refresh_ms",
] as const;

export type PerformanceBaselineSlot = (typeof PERFORMANCE_BASELINE_SLOTS)[number];

/**
 * Financial primitives every adopted domain MUST reference through the
 * canonical shared services registry. Domain-owned side tables
 * (e.g. `rider_wallets`, `corporate_invoices`) satisfy the requirement
 * because they are declared as canonical extensions in WORKSPACE360_HEALTH.
 */
const CANONICAL_FINANCIAL_PRIMITIVES: ReadonlyArray<string> = [
  "wallets",
  "wallet_transactions",
  "ledger_accounts",
  "journal_lines",
  "payment_attempts",
];

/** Tables patterns that indicate a private financial fork. Mirrors governance.ts. */
const FORBIDDEN_FINANCIAL_FORKS: ReadonlyArray<RegExp> = [
  /_ledger_accounts$/,
  /_journal_lines$/,
  /_journals$/,
  /_payment_attempts$/,
  /_mpesa_transactions$/,
];

export interface DomainConvergenceReport {
  domain: Workspace360Domain;
  adopted: boolean;
  usesCanonicalFinance: boolean;
  canonicalPrimitivesUsed: string[];
  duplicatedFinancialTables: string[];
  workflowsTouching: number;
  workflowsPassing: number;
  passed: boolean;
  findings: ConvergenceFinding[];
}

export interface ConvergenceInput {
  /** Adopted domains from schema-contract.workspace360.adopted_domains. */
  adoptedDomains?: readonly string[];
  /** Optional recorded latency baselines (ms). Absent values raise P1. */
  performanceBaseline?: Partial<Record<PerformanceBaselineSlot, number>>;
}

export interface ConvergenceReport {
  passed: boolean;                          // false when any P0 present
  score: number;                            // 0-100 mean of axis scores
  axisScores: {
    domainAdoption: number;
    canonicalServices: number;
    financialEngine: number;
    workflowConvergence: number;
    performanceBaseline: number;
    duplication: number;
  };
  domains: DomainConvergenceReport[];
  performanceBaseline: {
    recorded: PerformanceBaselineSlot[];
    missing: PerformanceBaselineSlot[];
  };
  p0: ConvergenceFinding[];
  p1: ConvergenceFinding[];
  failures: string[];                       // human-readable P0 summary
}

/* ------------------------------------------------------------------------- *
 * Certifier
 * ------------------------------------------------------------------------- */

export function certifyDomainConvergence(input: ConvergenceInput = {}): ConvergenceReport {
  const adoptedSet = new Set(input.adoptedDomains ?? []);
  const canonicalSet = new Set<string>(WORKSPACE360_CANONICAL_SERVICES);
  const workflows = certifyCrossDomainWorkflows(
    Array.from(adoptedSet),
    WORKSPACE360_WORKFLOWS,
  );

  const findings: ConvergenceFinding[] = [];
  const domains: DomainConvergenceReport[] = WORKSPACE360_DOMAINS.map((domain) => {
    const adopted = adoptedSet.has(domain);
    const spec = WORKSPACE360_HEALTH[domain];
    const declared = spec?.tables ?? [];
    const canonicalPrimitivesUsed = declared.filter((t) => canonicalSet.has(t));
    const duplicated = declared.filter((t) =>
      FORBIDDEN_FINANCIAL_FORKS.some((rx) => rx.test(t)),
    );

    const touching = workflows.workflows.filter((w) =>
      w.steps.some((s) => s.step.domain === domain),
    );
    const passing = touching.filter((w) => w.passed);

    const domainFindings: ConvergenceFinding[] = [];

    // Axis 1 — domain adoption. A documented, evidence-backed deferral is
    // reported as P1 (visible, never silently dropped) instead of P0.
    if (!adopted) {
      const deferral = WORKSPACE360_DEFERRED_ADOPTIONS[domain];
      domainFindings.push({
        category: "domain_adoption",
        severity: deferral ? "P1" : "P0",
        domain,
        message: deferral
          ? `domain "${domain}" adoption is deferred: ${deferral.reason}`
          : `domain "${domain}" is registered but not adopted onto Workspace360Shell`,
        detail: deferral ? { evidence: deferral.evidence } : undefined,
      });
    }


    // Axis 2 & 3 — canonical services + financial engine (only meaningful once adopted)
    if (adopted) {
      const missingPrimitives = CANONICAL_FINANCIAL_PRIMITIVES.filter(
        (p) => !declared.includes(p) && !declared.some((t) => t.endsWith(p.replace(/^s$/, ""))),
      );
      // Consider the domain compliant if it declares at least one canonical primitive
      // (wallets or ledger_accounts or journal_lines etc.) — matches governance.ts.
      if (canonicalPrimitivesUsed.length === 0) {
        domainFindings.push({
          category: "canonical_services",
          severity: "P0",
          domain,
          message: `adopted domain "${domain}" does not reference any canonical shared service`,
          detail: { canonicalServices: WORKSPACE360_CANONICAL_SERVICES },
        });
      } else if (missingPrimitives.length > 0 && missingPrimitives.length === CANONICAL_FINANCIAL_PRIMITIVES.length) {
        domainFindings.push({
          category: "financial_engine",
          severity: "P1",
          domain,
          message: `domain "${domain}" declares zero canonical financial primitives`,
          detail: { missingPrimitives },
        });
      }

      if (duplicated.length > 0) {
        domainFindings.push({
          category: "duplication",
          severity: "P0",
          domain,
          message: `domain "${domain}" declares private financial tables: ${duplicated.join(", ")}`,
          detail: { duplicated },
        });
      }

      // Axis 4 — workflow convergence
      if (touching.length === 0) {
        domainFindings.push({
          category: "workflow_convergence",
          severity: "P1",
          domain,
          message: `no canonical workflow exercises adopted domain "${domain}"`,
        });
      } else if (passing.length < touching.length) {
        domainFindings.push({
          category: "workflow_convergence",
          severity: "P0",
          domain,
          message: `${touching.length - passing.length}/${touching.length} workflows touching "${domain}" are diverging`,
        });
      }
    }

    findings.push(...domainFindings);

    return {
      domain,
      adopted,
      usesCanonicalFinance: canonicalPrimitivesUsed.length > 0,
      canonicalPrimitivesUsed,
      duplicatedFinancialTables: duplicated,
      workflowsTouching: touching.length,
      workflowsPassing: passing.length,
      passed: domainFindings.every((f) => f.severity !== "P0"),
      findings: domainFindings,
    };
  });

  // Axis 5 — performance baseline (declarations only, no live probes)
  const baseline = input.performanceBaseline ?? {};
  const recorded: PerformanceBaselineSlot[] = [];
  const missing: PerformanceBaselineSlot[] = [];
  for (const slot of PERFORMANCE_BASELINE_SLOTS) {
    const v = baseline[slot];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) recorded.push(slot);
    else missing.push(slot);
  }
  for (const slot of missing) {
    findings.push({
      category: "performance_baseline",
      severity: "P1",
      message: `performance baseline "${slot}" is not recorded`,
    });
  }

  // Axis scores
  // Deferred domains are excluded from the adoption denominator (their deferral
  // is reported as a P1 finding above, so the gap stays visible).
  const registeredCount = WORKSPACE360_DOMAINS.filter(
    (d) => !WORKSPACE360_DEFERRED_ADOPTIONS[d],
  ).length;
  const adoptedCount = domains.filter((d) => d.adopted).length;
  const adoptedDomains = domains.filter((d) => d.adopted);

  const domainAdoption = pct(Math.min(adoptedCount, registeredCount), registeredCount);

  const canonicalServices = adoptedCount === 0
    ? 0
    : pct(adoptedDomains.filter((d) => d.usesCanonicalFinance).length, adoptedCount);
  const duplication = adoptedCount === 0
    ? 100
    : pct(adoptedDomains.filter((d) => d.duplicatedFinancialTables.length === 0).length, adoptedCount);
  const financialEngine = Math.min(canonicalServices, duplication);
  const workflowConvergence = workflows.score;
  const performanceBaseline = pct(recorded.length, PERFORMANCE_BASELINE_SLOTS.length);

  const axisScores = {
    domainAdoption,
    canonicalServices,
    financialEngine,
    workflowConvergence,
    performanceBaseline,
    duplication,
  };

  const p0 = findings.filter((f) => f.severity === "P0");
  const p1 = findings.filter((f) => f.severity === "P1");

  const score = Math.round(
    (domainAdoption +
      canonicalServices +
      financialEngine +
      workflowConvergence +
      performanceBaseline +
      duplication) /
      6,
  );

  return {
    passed: p0.length === 0,
    score,
    axisScores,
    domains,
    performanceBaseline: { recorded, missing },
    p0,
    p1,
    failures: p0.map((f) => f.message),
  };
}

function pct(num: number, den: number): number {
  if (den <= 0) return 0;
  return Math.round((num / den) * 100);
}
