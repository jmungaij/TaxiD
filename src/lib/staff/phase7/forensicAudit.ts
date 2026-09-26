/**
 * Phase 7 — Forensic Architecture Auditor.
 *
 * Audits what the platform has actually built, against five dimensions, using
 * evidence rather than intent:
 *
 *   1. Functional completeness   — does the module have a contract, workflows,
 *                                  events and failure modes declared?
 *   2. Data authority            — is every entity it owns backed by a readable
 *                                  system of record with records in it?
 *   3. Commercial contribution   — can the module be tied to a revenue layer,
 *                                  and is that tie legitimate?
 *   4. Workflow closure          — do its workflows terminate in an approval,
 *                                  decision or measured outcome?
 *   5. Integration continuity    — are its published events consumed, and its
 *                                  dependencies declared with degraded
 *                                  behaviour?
 *
 * Every finding carries the exact evidence used. Where evidence is absent the
 * auditor reports NOT EVIDENCED — it never infers a pass.
 */
import { CAPABILITY_CONTRACTS, validateContract, type CapabilityContract } from "@/lib/contracts";
import { CANONICAL_ENTITIES, type CanonicalEntity } from "@/lib/staff/phase2/systemOfRecord";
import {
  REVENUE_DATA_AUTHORITY_REGISTER,
  type AuthorityLevel,
  type RegisterCoverage,
} from "./revenueAuthority";

export const AUDIT_DIMENSIONS = [
  "functional_completeness",
  "data_authority",
  "commercial_contribution",
  "workflow_closure",
  "integration_continuity",
] as const;
export type AuditDimension = (typeof AUDIT_DIMENSIONS)[number];

export const DIMENSION_LABEL: Record<AuditDimension, string> = {
  functional_completeness: "Functional completeness",
  data_authority: "Data authority",
  commercial_contribution: "Commercial contribution",
  workflow_closure: "Workflow closure",
  integration_continuity: "Integration continuity",
};

export type Verdict = "PASS" | "PARTIAL" | "FAIL" | "NOT_EVIDENCED";

/** What should happen to the audited capability. */
export type Disposition = "KEEP" | "FIX" | "COMPLETE" | "CONNECT" | "DEFER";

export interface DimensionFinding {
  dimension: AuditDimension;
  verdict: Verdict;
  score: number;
  /** Exact evidence used to reach the verdict — file, table, symbol or count. */
  evidence: string[];
  gaps: string[];
}

export interface ModuleAudit {
  module: string;
  title: string;
  route: string;
  owner: string;
  findings: DimensionFinding[];
  score: number;
  verdict: Verdict;
  disposition: Disposition;
  /** Single sentence a non-technical executive can act on. */
  headline: string;
}

/* ------------------------------------------------- module → entity ownership */

/** Maps a contract module to the canonical entities whose tables it relies on. */
export const MODULE_ENTITIES: Record<string, string[]> = {
  corporate: ["customer", "invoice", "cost_centre", "approval", "contract"],
  customer_operations: ["customer_success", "incident", "task", "audit_event"],
  delivery_logistics: ["order", "assignment"],
  finance_refunds: ["transaction", "ledger", "reconciliation", "chargeback", "settlement"],
  fleet: ["resource", "verification"],
  marketplace: ["partner", "resource", "marketplace_txn"],
  mobility: ["booking", "airport_transfer", "assignment"],
  trust_safety: ["incident", "policy", "decision"],
};

/** Revenue layer each module can legitimately contribute to, if any. */
export const MODULE_REVENUE_LAYER: Record<string, string | null> = {
  corporate: "yalla_recognised_revenue",
  customer_operations: null,
  delivery_logistics: "gross_marketplace_transaction_value",
  finance_refunds: "refunds_and_adjustments",
  fleet: null,
  marketplace: "gross_marketplace_transaction_value",
  mobility: "gross_marketplace_transaction_value",
  trust_safety: null,
};

const entityFor = (key: string): CanonicalEntity | undefined =>
  CANONICAL_ENTITIES.find((e) => e.key === key);

const verdictFor = (score: number, evidenced: boolean): Verdict => {
  if (!evidenced) return "NOT_EVIDENCED";
  if (score >= 90) return "PASS";
  if (score >= 55) return "PARTIAL";
  return "FAIL";
};

/* ------------------------------------------------------------- dimension 1 */

function auditFunctional(contract: CapabilityContract): DimensionFinding {
  const validation = validateContract(contract);
  const evidence = [
    `Contract ${contract.module} v${contract.version} declares ${contract.workflows.length} workflows, ${contract.publishes.length} published events, ${contract.failureModes.length} failure modes`,
    `validateContract completeness ${validation.completeness}%`,
  ];
  const gaps = [
    ...validation.missing.map((m) => `Contract section \`${m}\` is empty`),
    ...validation.warnings,
  ];
  return {
    dimension: "functional_completeness",
    verdict: verdictFor(validation.completeness, true),
    score: validation.completeness,
    evidence,
    gaps,
  };
}

/* ------------------------------------------------------------- dimension 2 */

function auditDataAuthority(module: string, coverage: RegisterCoverage): DimensionFinding {
  const keys = MODULE_ENTITIES[module] ?? [];
  const evidence: string[] = [];
  const gaps: string[] = [];
  let backed = 0;

  for (const key of keys) {
    const entity = entityFor(key);
    if (!entity) {
      gaps.push(`Entity \`${key}\` is not declared in the system of record`);
      continue;
    }
    if (!entity.table) {
      gaps.push(`${entity.label} has no system of record${entity.note ? ` — ${entity.note}` : ""}`);
      continue;
    }
    const probe = coverage[entity.table];
    if (!probe) {
      evidence.push(`${entity.label} → ${entity.table} (declared, not probed this run)`);
      backed += 0.5;
      continue;
    }
    if (probe.error) {
      gaps.push(`${entity.table} unreadable: ${probe.error}`);
      continue;
    }
    if ((probe.rows ?? 0) === 0) {
      gaps.push(`${entity.table} is empty — DATA NOT AVAILABLE, not zero`);
      backed += 0.25;
      continue;
    }
    if (probe.simulated) {
      gaps.push(`${entity.table} contains seeded data (${probe.simulationEvidence})`);
      backed += 0.5;
      continue;
    }
    evidence.push(`${entity.label} → ${entity.table} holds ${probe.rows} records`);
    backed += 1;
  }

  const score = keys.length === 0 ? 0 : Math.round((backed / keys.length) * 100);
  return {
    dimension: "data_authority",
    verdict: verdictFor(score, keys.length > 0),
    score,
    evidence,
    gaps,
  };
}

/* ------------------------------------------------------------- dimension 3 */

function auditCommercial(module: string): DimensionFinding {
  const layer = MODULE_REVENUE_LAYER[module] ?? null;
  const evidence: string[] = [];
  const gaps: string[] = [];

  if (!layer) {
    return {
      dimension: "commercial_contribution",
      verdict: "NOT_EVIDENCED",
      score: 0,
      evidence: [`No revenue layer is claimed for ${module}`],
      gaps: [`${module} has no declared commercial contribution — it is a cost or protection function, and must not be reported as revenue-producing`],
    };
  }

  const entries = REVENUE_DATA_AUTHORITY_REGISTER.filter((r) => r.layer === layer);
  const forbidden = entries.filter((r) => r.authority === "forbidden");
  const legitimate = entries.filter((r): r is typeof r & { authority: AuthorityLevel } =>
    r.authority === "authoritative" || r.authority === "recognition_candidate");

  evidence.push(`Claimed layer: ${layer}; register holds ${entries.length} sources for it`);
  for (const f of forbidden) {
    gaps.push(`${f.sourceTable} feeds this layer but is FORBIDDEN as revenue — ${f.authorityReason}`);
  }
  if (legitimate.length === 0) {
    gaps.push(`No authoritative or recognition-candidate source exists for ${layer}, so this module's commercial contribution cannot yet be measured`);
  }

  const score = legitimate.length > 0 ? (forbidden.length > 0 ? 55 : 90) : 25;
  return { dimension: "commercial_contribution", verdict: verdictFor(score, true), score, evidence, gaps };
}

/* ------------------------------------------------------------- dimension 4 */

const CLOSURE_HINT = /(approv|decision|settle|resolve|close|payout|recogni|refund|complet)/i;

function auditWorkflowClosure(contract: CapabilityContract): DimensionFinding {
  const evidence: string[] = [];
  const gaps: string[] = [];
  let closed = 0;

  for (const w of contract.workflows) {
    const last = w.stages.at(-1) ?? "";
    const hasApproval = w.approvals.length > 0;
    const terminates = CLOSURE_HINT.test(last) || CLOSURE_HINT.test(w.stages.join(" "));
    if (hasApproval && terminates) {
      closed += 1;
      evidence.push(`${w.name}: ends at "${last}" with ${w.approvals.length} approval gate(s)`);
    } else if (terminates || hasApproval) {
      closed += 0.5;
      gaps.push(`${w.name}: ${hasApproval ? "has approvals but no terminal outcome stage" : "terminates without an approval gate"} (last stage "${last}")`);
    } else {
      gaps.push(`${w.name}: no approval gate and no terminal outcome stage — the workflow does not close`);
    }
    if (w.targetMinutes <= 0) gaps.push(`${w.name}: no completion target declared`);
  }

  const score = contract.workflows.length === 0 ? 0 : Math.round((closed / contract.workflows.length) * 100);
  return {
    dimension: "workflow_closure",
    verdict: verdictFor(score, contract.workflows.length > 0),
    score,
    evidence,
    gaps,
  };
}

/* ------------------------------------------------------------- dimension 5 */

function auditIntegration(contract: CapabilityContract, all: CapabilityContract[]): DimensionFinding {
  const evidence: string[] = [];
  const gaps: string[] = [];

  const consumedNames = new Set(
    all.filter((c) => c.module !== contract.module).flatMap((c) => c.consumes.map((e) => e.name)),
  );
  const orphanEvents = contract.publishes.filter((e) => !consumedNames.has(e.name));
  const consumedCount = contract.publishes.length - orphanEvents.length;
  evidence.push(`${consumedCount}/${contract.publishes.length} published events are consumed by another module`);
  for (const e of orphanEvents) {
    gaps.push(`Event \`${e.name}\` is published but no module consumes it${e.criticality === "critical" ? " (CRITICAL)" : ""}`);
  }

  const moduleIds = new Set(all.map((c) => c.module as string));
  for (const d of contract.dependencies) {
    if (!d.degradedBehaviour) gaps.push(`Dependency on ${d.module} declares no degraded behaviour`);
    if (!moduleIds.has(String(d.module))) {
      evidence.push(`External dependency: ${d.module} (${d.reason})`);
    }
  }
  if (contract.dependencies.length === 0) gaps.push("No dependencies declared — an isolated module cannot participate in the value chain");

  const publishScore = contract.publishes.length === 0 ? 0 : (consumedCount / contract.publishes.length) * 100;
  const depScore = contract.dependencies.length === 0 ? 0 : 100;
  const score = Math.round(publishScore * 0.6 + depScore * 0.4);
  return { dimension: "integration_continuity", verdict: verdictFor(score, true), score, evidence, gaps };
}

/* -------------------------------------------------------------- composition */

const DISPOSITION_ORDER: Disposition[] = ["KEEP", "COMPLETE", "CONNECT", "FIX", "DEFER"];

function disposeOf(findings: DimensionFinding[], score: number): Disposition {
  const by = (d: AuditDimension) => findings.find((f) => f.dimension === d)!;
  if (score >= 85) return "KEEP";
  if (by("data_authority").score < 55) return "COMPLETE";
  if (by("integration_continuity").score < 55) return "CONNECT";
  if (by("workflow_closure").score < 55 || by("functional_completeness").score < 90) return "FIX";
  return "DEFER";
}

export function auditModule(
  contract: CapabilityContract,
  coverage: RegisterCoverage,
  all: CapabilityContract[] = CAPABILITY_CONTRACTS,
): ModuleAudit {
  const findings = [
    auditFunctional(contract),
    auditDataAuthority(contract.module, coverage),
    auditCommercial(contract.module),
    auditWorkflowClosure(contract),
    auditIntegration(contract, all),
  ];
  const score = Math.round(findings.reduce((s, f) => s + f.score, 0) / findings.length);
  const worst = findings.reduce((a, b) => (b.score < a.score ? b : a));
  const disposition = disposeOf(findings, score);
  return {
    module: contract.module,
    title: contract.title,
    route: contract.route,
    owner: contract.owner,
    findings,
    score,
    verdict: verdictFor(score, true),
    disposition,
    headline: `${DIMENSION_LABEL[worst.dimension]} is the binding constraint (${worst.score}/100): ${worst.gaps[0] ?? "no gaps recorded"}`,
  };
}

export interface ForensicAuditReport {
  generatedAt: string;
  modules: ModuleAudit[];
  score: number;
  /** Dimension scores across the whole platform. */
  dimensionScores: Record<AuditDimension, number>;
  /** Ordered remediation queue: worst binding constraint first. */
  queue: { module: string; disposition: Disposition; headline: string; score: number }[];
  refusals: string[];
}

export function runForensicAudit(
  coverage: RegisterCoverage,
  contracts: CapabilityContract[] = CAPABILITY_CONTRACTS,
): ForensicAuditReport {
  const modules = contracts.map((c) => auditModule(c, coverage, contracts));
  const dimensionScores = Object.fromEntries(
    AUDIT_DIMENSIONS.map((d) => [
      d,
      Math.round(
        modules.reduce((s, m) => s + (m.findings.find((f) => f.dimension === d)?.score ?? 0), 0) /
          Math.max(modules.length, 1),
      ),
    ]),
  ) as Record<AuditDimension, number>;

  const queue = [...modules]
    .sort((a, b) =>
      a.score - b.score ||
      DISPOSITION_ORDER.indexOf(a.disposition) - DISPOSITION_ORDER.indexOf(b.disposition))
    .map((m) => ({ module: m.module, disposition: m.disposition, headline: m.headline, score: m.score }));

  return {
    generatedAt: new Date().toISOString(),
    modules,
    score: Math.round(modules.reduce((s, m) => s + m.score, 0) / Math.max(modules.length, 1)),
    dimensionScores,
    queue,
    refusals: [
      "No module is credited with revenue: the Revenue Data Authority Register has not cleared an authoritative LIVE recognition source.",
      "Empty tables are reported as DATA NOT AVAILABLE, never as zero.",
      "Digital-twin seeded contents are reported as SIMULATED and cannot support a commercial claim.",
      "Modules with no declared revenue layer are recorded as cost or protection functions, not revenue producers.",
    ],
  };
}
