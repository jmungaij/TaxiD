/**
 * Phase D14.2 — Production Readiness Closure & Go-Live Qualification.
 *
 * Pure, deterministic composer. NO new engines, dashboards, tables, services,
 * registries, or monitoring frameworks. Extends the D7–D14.1 stack by
 * enumerating the ten closure workstreams as evidence-backed gates and
 * emitting a single convergent release decision.
 *
 * The decision hierarchy is immutable:
 *   governance → validation → execution → acceptance → vault → closure
 * D14.2 may only downgrade an upstream PROMOTE. It can never upgrade a
 * HOLD/ROLLBACK — evidence gates the release, never the reverse.
 */
import type { Workspace360GovernanceReport } from "./governance";
import type {
  ProductionValidationReport,
  ReleaseDecision,
} from "./productionValidation";
import type { ProductionEvidenceVaultReport } from "./productionEvidenceVault";
import type { ProductionExecutionReport } from "./productionExecution";
import type { ProductionAcceptanceReport } from "./productionAcceptance";
import { WORKSPACE360_DOMAINS } from "./domains";

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalize((value as Record<string, unknown>)[k])}`)
    .join(",")}}`;
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
/* Closure workstream registry (deterministic, config-only)            */
/* ------------------------------------------------------------------ */
export const CLOSURE_WORKSTREAMS = [
  "blockers",
  "payment_chain",
  "integrations",
  "workspace360_adoption",
  "business_journeys",
  "production_baseline",
  "navigation_governance",
  "operational_runbooks",
  "decision_convergence",
  "cicd_ratchet",
] as const;
export type ClosureWorkstreamId = (typeof CLOSURE_WORKSTREAMS)[number];

export interface ClosureGate {
  id: ClosureWorkstreamId;
  label: string;
  passed: boolean;
  score: number;              // 0..100
  evidenceRef: string;        // canonical evidence pointer (existing artefact)
  reasons: string[];          // deterministic failure reasons (empty when passing)
  blocking: boolean;          // whether this gate blocks PROMOTE
}

export interface ProductionClosureReport {
  passed: boolean;
  decision: ReleaseDecision;
  score: number;
  gates: ClosureGate[];
  blockingGates: ClosureWorkstreamId[];
  convergence: {
    governance:  ReleaseDecision | "n/a";
    validation:  ReleaseDecision;
    execution:   ReleaseDecision;
    acceptance:  ReleaseDecision;
    vault:       ReleaseDecision;
    convergent:  boolean;
    /** True when all upstream decisions agree with the closure decision. */
    canonical:   ReleaseDecision;
  };
  fingerprint: string;
}

export interface ProductionClosureInputs {
  governance: Workspace360GovernanceReport;
  validation: ProductionValidationReport;
  vault:      ProductionEvidenceVaultReport;
  execution:  ProductionExecutionReport;
  acceptance: ProductionAcceptanceReport;
}

/* ------------------------------------------------------------------ */
/* Gate builders — every one reads only pre-existing report fields.    */
/* ------------------------------------------------------------------ */
function gateBlockers(inp: ProductionClosureInputs): ClosureGate {
  // Workstream 1 — resolve production blockers surfaced by governance +
  // acceptance. We consider only P0/critical items as production blockers.
  const critical = inp.acceptance.blockers.filter((b) => b.severity === "critical");
  const passed = critical.length === 0;
  return {
    id: "blockers",
    label: "Production blockers cleared",
    passed,
    score: passed ? 100 : Math.max(0, 100 - critical.length * 25),
    evidenceRef: "productionAcceptance.blockers",
    reasons: critical.map((b) => `${b.id}: ${b.businessImpact}`),
    blocking: true,
  };
}

function gatePaymentChain(inp: ProductionClosureInputs): ClosureGate {
  // Workstream 2 — payment lifecycle certification. We reuse the existing
  // chain evidence: journey pass-rate + settlement workflow + freeze gates.
  const wfPayment = inp.governance.workflows.workflows.find(
    (w) => w.id === "rider-trip-settlement",
  );
  const wfPassed = !!wfPayment && wfPayment.passed;
  const finPassed = inp.governance.consistency.financial.score >= 90;
  const journey = inp.execution.journeys.journeys.find((j) => j.id.includes("rider"));
  const journeyPassed = !!journey && journey.passed;
  const passed = wfPassed && finPassed && journeyPassed;
  const reasons: string[] = [];
  if (!wfPayment)   reasons.push("rider-trip-settlement workflow missing");
  else if (!wfPassed) reasons.push("payment settlement workflow failing");
  if (!finPassed)   reasons.push(`financial consistency ${inp.governance.consistency.financial.score}/100`);
  if (!journeyPassed) reasons.push("rider payment journey not passing");
  return {
    id: "payment_chain",
    label: "End-to-end payment chain",
    passed,
    score: passed ? 100 : 40,
    evidenceRef: "governance.workflows + execution.journeys[rider]",
    reasons,
    blocking: true,
  };
}

function gateIntegrations(inp: ProductionClosureInputs): ClosureGate {
  const passed = inp.validation.integrations.passed;
  return {
    id: "integrations",
    label: "Production integration qualification",
    passed,
    score: inp.validation.integrations.score,
    evidenceRef: "productionValidation.integrations",
    reasons: passed ? [] : [`integrations score ${inp.validation.integrations.score}/100`],
    blocking: true,
  };
}

function gateWorkspace360Adoption(inp: ProductionClosureInputs): ClosureGate {
  const adopted = new Set(inp.governance.domains.filter((d) => d.adopted).map((d) => d.domain));
  const missing = WORKSPACE360_DOMAINS.filter((d) => !adopted.has(d));
  const passed = missing.length === 0;
  return {
    id: "workspace360_adoption",
    label: "Workspace360 full adoption",
    passed,
    score: Math.round(((WORKSPACE360_DOMAINS.length - missing.length) / WORKSPACE360_DOMAINS.length) * 100),
    evidenceRef: "governance.domains[adopted]",
    reasons: missing.length ? [`unadopted: ${missing.join(", ")}`] : [],
    blocking: false, // informational: canonical journey coverage gates PROMOTE via business_journeys
  };
}




function gateBusinessJourneys(inp: ProductionClosureInputs): ClosureGate {
  const total = inp.execution.journeys.journeys.length;
  const passing = inp.execution.journeys.totalPassing;
  const passed = total > 0 && passing === total;
  return {
    id: "business_journeys",
    label: "Canonical business journeys executed",
    passed,
    score: total > 0 ? Math.round((passing / total) * 100) : 0,
    evidenceRef: "productionExecution.journeys",
    reasons: passed ? [] : [`${passing}/${total} journeys passing`],
    blocking: true,
  };
}

function gateProductionBaseline(inp: ProductionClosureInputs): ClosureGate {
  const captured = inp.acceptance.baseline.captured;
  return {
    id: "production_baseline",
    label: "Version 1 production baseline captured",
    passed: captured,
    score: captured ? 100 : 0,
    evidenceRef: `productionAcceptance.baseline[${inp.acceptance.baseline.fingerprint}]`,
    reasons: captured
      ? []
      : [`missing signals: ${inp.acceptance.baseline.missingSignals.join(", ") || "runtime"}`],
    blocking: true,
  };
}

function gateNavigationGovernance(inp: ProductionClosureInputs): ClosureGate {
  const passed = inp.governance.certification.passed;
  return {
    id: "navigation_governance",
    label: "Navigation governance certification",
    passed,
    score: inp.governance.certification.score,
    evidenceRef: "governance.certification",
    reasons: passed ? [] : ["navigation certification failing"],
    blocking: false, // governance already blocks upstream; kept informational here
  };
}

function gateOperationalRunbooks(inp: ProductionClosureInputs): ClosureGate {
  const rb = inp.acceptance.runbooks;
  const passed = rb.passed;
  const score = rb.totalRunbooks > 0 ? Math.round((rb.totalComposed / rb.totalRunbooks) * 100) : 0;
  return {
    id: "operational_runbooks",
    label: "Canonical operational runbooks",
    passed,
    score,
    evidenceRef: `productionAcceptance.runbooks[${rb.fingerprint}]`,
    reasons: passed ? [] : [`${rb.totalComposed}/${rb.totalRunbooks} runbooks composed`],
    blocking: true,
  };
}

function gateDecisionConvergence(
  inp: ProductionClosureInputs,
  convergent: boolean,
  canonical: ReleaseDecision,
): ClosureGate {
  return {
    id: "decision_convergence",
    label: "Deterministic decision convergence",
    passed: convergent,
    score: convergent ? 100 : 0,
    evidenceRef: "validation.decision + vault.decision + execution.decision + acceptance.decision",
    reasons: convergent
      ? []
      : [
          `validation=${inp.validation.decision}`,
          `vault=${inp.vault.decision}`,
          `execution=${inp.execution.decision}`,
          `acceptance=${inp.acceptance.decision}`,
          `canonical=${canonical}`,
        ],
    blocking: true,
  };
}

function gateCicdRatchet(inp: ProductionClosureInputs): ClosureGate {
  const blocked = inp.vault.ratchet.deployment_blocked;
  return {
    id: "cicd_ratchet",
    label: "CI/CD production ratchet",
    passed: !blocked,
    score: blocked ? 0 : 100,
    evidenceRef: "vault.ratchet",
    reasons: blocked
      ? [`blocking gates: ${inp.vault.ratchet.blocking_gates.slice(0, 6).join(", ") || "—"}`]
      : [],
    blocking: true,
  };
}

/* ------------------------------------------------------------------ */
/* Convergence: the strictest upstream decision wins.                  */
/* ------------------------------------------------------------------ */
const RANK: Record<ReleaseDecision, number> = { PROMOTE: 0, HOLD: 1, ROLLBACK: 2 };
function strictest(...decisions: ReleaseDecision[]): ReleaseDecision {
  return decisions.reduce<ReleaseDecision>(
    (acc, d) => (RANK[d] > RANK[acc] ? d : acc),
    "PROMOTE",
  );
}

export function certifyProductionClosure(
  inputs: ProductionClosureInputs,
): ProductionClosureReport {
  const canonical = strictest(
    inputs.validation.decision,
    inputs.vault.decision,
    inputs.execution.decision,
    inputs.acceptance.decision,
  );
  const convergent =
    inputs.validation.decision === canonical &&
    inputs.vault.decision === canonical &&
    inputs.execution.decision === canonical &&
    inputs.acceptance.decision === canonical;

  const gates: ClosureGate[] = [
    gateBlockers(inputs),
    gatePaymentChain(inputs),
    gateIntegrations(inputs),
    gateWorkspace360Adoption(inputs),
    gateBusinessJourneys(inputs),
    gateProductionBaseline(inputs),
    gateNavigationGovernance(inputs),
    gateOperationalRunbooks(inputs),
    gateDecisionConvergence(inputs, convergent, canonical),
    gateCicdRatchet(inputs),
  ];

  const blockingGates = gates.filter((g) => g.blocking && !g.passed).map((g) => g.id);
  const closureLocal: ReleaseDecision = blockingGates.length === 0 ? "PROMOTE" : "HOLD";

  // Immutable hierarchy — D14.2 may only downgrade. Never upgrade upstream.
  const decision = strictest(canonical, closureLocal);

  const score = Math.round(gates.reduce((s, g) => s + g.score, 0) / gates.length);
  const passed = decision === "PROMOTE" && blockingGates.length === 0;

  const fingerprint = fnv1a(canonicalize({
    decision,
    canonical,
    convergent,
    gates: gates.map((g) => ({ id: g.id, passed: g.passed, score: g.score })),
  }));

  return {
    passed,
    decision,
    score,
    gates,
    blockingGates,
    convergence: {
      governance:  "n/a",
      validation:  inputs.validation.decision,
      execution:   inputs.execution.decision,
      acceptance:  inputs.acceptance.decision,
      vault:       inputs.vault.decision,
      convergent,
      canonical,
    },
    fingerprint,
  };
}
