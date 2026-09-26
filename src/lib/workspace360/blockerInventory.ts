/**
 * Lean P1 — Production Blocker Inventory & Prioritizer.
 *
 * Pure, deterministic composer over the existing D7–D14 governance stack.
 * No new engines, dashboards, tables, services, or registries. Every entry
 * is derived from an existing failing gate; a passing platform yields an
 * empty inventory.
 *
 * Consumed by:
 *   • BlockerInventoryPanel — executive surface
 *   • ReadinessV2Card       — one-row status summary
 *   • decisionEngine        — re-exports `rankBlockers` so RecoveryPlan
 *                             can pick up ranking metadata without new state
 *
 * Ranking (deterministic — pure function of inputs):
 *   priority = releaseImpact      * 0.45
 *            + dependencyDepth    * 0.20
 *            + evidenceMissingWt  * 0.15
 *            + expectedReadinessGain * 0.15
 *            − effortWeight       * 0.05
 */
import type { Workspace360GovernanceReport } from "./governance";
import type { ProductionValidationReport, ReleaseDecision } from "./productionValidation";
import type { ProductionEvidenceVaultReport } from "./productionEvidenceVault";
import type { ProductionExecutionReport } from "./productionExecution";
import type { ProductionAcceptanceReport } from "./productionAcceptance";
import type { ProductionClosureReport, ClosureWorkstreamId } from "./productionClosure";
import type { RecoveryPlan } from "./orchestration";
import {
  correlateBlockers,
  evaluateCorrelationRatchet,
  type BlockerCorrelation,
  type CorrelatedBlocker,
  type CorrelationRatchetResult,
} from "./rootCauseCorrelation";

/* ------------------------------------------------------------------ */
/* Canonical JSON + FNV-1a fingerprint                                 */
/* ------------------------------------------------------------------ */
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
/* Blocker record                                                      */
/* ------------------------------------------------------------------ */
export type BlockerCategory =
  | "closure"
  | "acceptance"
  | "execution"
  | "validation"
  | "governance"
  | "vault";

export type BlockerEffort = "low" | "medium" | "high";
export type BlockerSeverity = "critical" | "major" | "minor";

export interface Blocker {
  id: string;
  category: BlockerCategory;
  source: string;
  title: string;
  currentEvidence: string;
  missingEvidence: string;
  rootCause: string;
  requiredFix: string;
  owner: string;
  verification: string;
  severity: BlockerSeverity;
  releaseImpact: number;             // 0..100 (higher = larger downgrade)
  dependencyDepth: number;           // 0..5 (0 = leaf, 5 = deep root)
  evidenceMissingWeight: number;     // 0..100
  expectedReadinessGain: number;     // 0..100 (score points on remediation)
  effort: BlockerEffort;
  effortWeight: number;              // 0..100
  autoFixable: boolean;
  autoFixHref?: string;              // deep-link to remediation surface
  priorityScore: number;             // ranked score
  fingerprint: string;
  /** P2-T4 — Root cause correlation. Optional for legacy consumers; every
   * blocker produced by composeBlockerInventory has this field populated. */
  correlation?: BlockerCorrelation;
}

export interface BlockerInventory {
  blockers: CorrelatedBlocker[];
  total: number;
  autoFixableCount: number;
  expectedTotalGain: number;
  topBlocker: CorrelatedBlocker | null;
  decision: ReleaseDecision;
  fingerprint: string;
  /** P2-T4 — Correlation ratchet result. Empty inventory ⇒ passed. */
  correlationRatchet: CorrelationRatchetResult;
}

/* ------------------------------------------------------------------ */
/* Deterministic weight tables                                         */
/* ------------------------------------------------------------------ */
const CLOSURE_WEIGHTS: Record<ClosureWorkstreamId, {
  releaseImpact: number; depth: number; gain: number;
  evMissing: number; effort: BlockerEffort;
  owner: string; verification: string;
  autoFixable: boolean; autoFixHref?: string;
  requiredFix: string;
}> = {
  payment_chain: {
    releaseImpact: 95, depth: 1, gain: 18, evMissing: 90, effort: "high",
    owner: "Payments Platform", verification: "payment_certification_next_action + rider-trip-settlement workflow",
    autoFixable: true, autoFixHref: "/dashboard/admin/payments",
    requiredFix: "Repair first-failing stage returned by payment_certification_next_action; rerun payment-certification-run",
  },
  integrations: {
    releaseImpact: 85, depth: 2, gain: 12, evMissing: 95, effort: "medium",
    owner: "Platform Engineering", verification: "productionValidation.integrations telemetry",
    autoFixable: true, autoFixHref: "/dashboard/admin/executive-intelligence",
    requiredFix: "Invoke mpesa-reconcile-recent, send-transactional-email, etims-health, and maps probes; persist telemetry",
  },
  business_journeys: {
    releaseImpact: 80, depth: 2, gain: 10, evMissing: 80, effort: "medium",
    owner: "Domain Owners", verification: "productionExecution.journeys totalPassing",
    autoFixable: true, autoFixHref: "/dashboard/admin/digital-twin",
    requiredFix: "Execute each canonical lifecycle via digital twin to emit evidence for productionExecution",
  },
  workspace360_adoption: {
    releaseImpact: 55, depth: 3, gain: 6, evMissing: 60, effort: "medium",
    owner: "Domain Owners", verification: "governance.domains[adopted]",
    autoFixable: true, autoFixHref: "/dashboard/admin",
    requiredFix: "Mount Workspace360Shell for the domain and register it in schema-contract.v1.json > workspace360.adopted_domains",
  },
  production_baseline: {
    releaseImpact: 70, depth: 2, gain: 8, evMissing: 100, effort: "low",
    owner: "SRE", verification: "productionAcceptance.baseline (V1)",
    autoFixable: true, autoFixHref: "/dashboard/admin/executive-intelligence",
    requiredFix: "Capture V1 performance baseline via existing performance report and persist to Evidence Vault",
  },
  operational_runbooks: {
    releaseImpact: 45, depth: 3, gain: 5, evMissing: 40, effort: "medium",
    owner: "SRE", verification: "productionAcceptance.runbooks composition",
    autoFixable: false,
    requiredFix: "Extend RecoveryPlan orchestration metadata (owner, verification source) for missing incidents",
  },
  navigation_governance: {
    releaseImpact: 40, depth: 4, gain: 4, evMissing: 30, effort: "low",
    owner: "Platform Engineering", verification: "governance.certification",
    autoFixable: false,
    requiredFix: "Reconcile mounted routes with canonical ROUTES registry",
  },
  decision_convergence: {
    releaseImpact: 65, depth: 1, gain: 0, evMissing: 20, effort: "low",
    owner: "SRE", verification: "convergence of upstream decisions",
    autoFixable: false,
    requiredFix: "Resolve upstream divergent decisions; convergence is derived, not fixable directly",
  },
  cicd_ratchet: {
    releaseImpact: 100, depth: 0, gain: 0, evMissing: 10, effort: "medium",
    owner: "SRE", verification: "vault.ratchet.blocking_gates",
    autoFixable: false,
    requiredFix: "Resolve every ratchet blocking gate; ratchet is derived from other gates",
  },
  blockers: {
    releaseImpact: 90, depth: 1, gain: 15, evMissing: 70, effort: "high",
    owner: "Release Manager", verification: "productionAcceptance.blockers",
    autoFixable: false,
    requiredFix: "Address each critical acceptance blocker via its listed recovery plan",
  },
};

const EFFORT_WEIGHT: Record<BlockerEffort, number> = { low: 10, medium: 40, high: 80 };

/* ------------------------------------------------------------------ */
/* Ranking                                                             */
/* ------------------------------------------------------------------ */
export function rankBlockers(blockers: Blocker[]): Blocker[] {
  return [...blockers].sort((a, b) => {
    if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
    // deterministic tiebreak
    return a.id.localeCompare(b.id);
  });
}

function computePriorityScore(b: Omit<Blocker, "priorityScore" | "fingerprint">): number {
  return Math.round(
    b.releaseImpact * 0.45
    + b.dependencyDepth * 20 * 0.20
    + b.evidenceMissingWeight * 0.15
    + b.expectedReadinessGain * 0.15
    - b.effortWeight * 0.05,
  );
}

/* ------------------------------------------------------------------ */
/* Inventory composer                                                  */
/* ------------------------------------------------------------------ */
export interface BlockerInventoryInputs {
  governance: Workspace360GovernanceReport;
  validation: ProductionValidationReport;
  vault: ProductionEvidenceVaultReport;
  execution: ProductionExecutionReport;
  acceptance: ProductionAcceptanceReport;
  closure: ProductionClosureReport;
  /** P2-T4 — optional D12 recovery plan. When supplied, correlation attaches
   * the matching recommendation id, operational owner, and approval role. */
  recoveryPlan?: RecoveryPlan | null;
}

function finalize(b: Omit<Blocker, "priorityScore" | "fingerprint">): Blocker {
  const priorityScore = computePriorityScore(b);
  const fingerprint = fnv1a(canonicalize({ ...b, priorityScore }));
  return { ...b, priorityScore, fingerprint };
}

export function composeBlockerInventory(inputs: BlockerInventoryInputs): BlockerInventory {
  const raw: Array<Omit<Blocker, "priorityScore" | "fingerprint">> = [];

  // 1) Every failing closure gate becomes a canonical blocker.
  for (const gate of inputs.closure.gates) {
    if (gate.passed) continue;
    const w = CLOSURE_WEIGHTS[gate.id];
    const missingGap = Math.max(0, 100 - gate.score);
    raw.push({
      id: `closure:${gate.id}`,
      category: "closure",
      source: `productionClosure.gates[${gate.id}]`,
      title: gate.label,
      currentEvidence: gate.evidenceRef,
      missingEvidence: gate.reasons.join("; ") || "no supporting evidence",
      rootCause: gate.reasons[0] ?? "gate failing",
      requiredFix: w.requiredFix,
      owner: w.owner,
      verification: w.verification,
      severity: gate.blocking ? "critical" : "major",
      releaseImpact: Math.round(w.releaseImpact * (missingGap / 100 || 0.25)),
      dependencyDepth: w.depth,
      evidenceMissingWeight: w.evMissing,
      expectedReadinessGain: w.gain,
      effort: w.effort,
      effortWeight: EFFORT_WEIGHT[w.effort],
      autoFixable: w.autoFixable,
      autoFixHref: w.autoFixHref,
    });
  }

  // 2) Every critical acceptance blocker not already surfaced as a closure gate.
  const seenAcceptanceKeys = new Set(raw.map((r) => r.id));
  for (const bi of inputs.acceptance.blockers) {
    const id = `acceptance:${bi.id}`;
    if (seenAcceptanceKeys.has(id)) continue;
    const effort: BlockerEffort =
      bi.expectedResolutionMs <= 4 * 3600 * 1000 ? "low"
      : bi.expectedResolutionMs <= 12 * 3600 * 1000 ? "medium"
      : "high";
    raw.push({
      id,
      category: "acceptance",
      source: "productionAcceptance.blockers",
      title: bi.businessImpact,
      currentEvidence: bi.evidence,
      missingEvidence: bi.recoveryPlan,
      rootCause: bi.businessImpact,
      requiredFix: bi.recoveryPlan,
      owner: bi.owner,
      verification: bi.evidence,
      severity: bi.severity === "critical" ? "critical" : "major",
      releaseImpact: bi.severity === "critical" ? 80 : 50,
      dependencyDepth: 2,
      evidenceMissingWeight: 60,
      expectedReadinessGain: 6,
      effort,
      effortWeight: EFFORT_WEIGHT[effort],
      autoFixable: false,
    });
  }

  const ranked = rankBlockers(raw.map(finalize));

  // P2-T4 — enrich every blocker with deterministic correlation evidence.
  const correlated = correlateBlockers({
    blockers: ranked,
    validation: inputs.validation,
    vault: inputs.vault,
    execution: inputs.execution,
    acceptance: inputs.acceptance,
    closure: inputs.closure,
    recoveryPlan: inputs.recoveryPlan ?? null,
  });
  const correlationRatchet = evaluateCorrelationRatchet(correlated);

  const autoFixableCount = correlated.filter((b) => b.autoFixable).length;
  const expectedTotalGain = correlated.reduce((s, b) => s + b.expectedReadinessGain, 0);

  // Decision echoes closure — the inventory never independently upgrades a HOLD.
  const decision: ReleaseDecision = correlated.length === 0
    ? inputs.closure.decision
    : inputs.closure.decision === "PROMOTE" ? "HOLD" : inputs.closure.decision;

  const fingerprint = fnv1a(canonicalize({
    total: correlated.length,
    decision,
    top: correlated.slice(0, 5).map((b) => ({ id: b.id, score: b.priorityScore, corr: b.correlation.firstFailingDependency })),
  }));

  return {
    blockers: correlated,
    total: correlated.length,
    autoFixableCount,
    expectedTotalGain,
    topBlocker: correlated[0] ?? null,
    decision,
    fingerprint,
    correlationRatchet,
  };
}
