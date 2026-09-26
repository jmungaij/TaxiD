/**
 * Phase D11.2 — Executive Action Orchestration.
 *
 * Pure, deterministic execution planner that layers orchestration
 * metadata onto the existing D10 Recommendation objects — no new
 * engine, no AI, no runtime workflow orchestrator.
 *
 * Inputs : Recommendation[] (already deduped/ranked by decisionEngine)
 * Outputs: RecoveryPlan with dependencies, critical path, parallel
 *          batches, effort, ETA, and expected business recovery.
 */
import type { Recommendation, RecoExecutionStatus } from "./decisionEngine";

export type RecoEffort = "low" | "medium" | "high";

/** Deterministic per-effort resolution baselines (ms). */
const EFFORT_MS: Record<RecoEffort, number> = {
  low: 2 * 60 * 60 * 1000,      // 2h
  medium: 8 * 60 * 60 * 1000,   // 8h
  high: 24 * 60 * 60 * 1000,    // 24h
};

/**
 * Deterministic effort classification by rootCause prefix.
 * Uses the reco's dedupKey suffix (which already encodes rootCause).
 */
function classifyEffort(reco: Recommendation): RecoEffort {
  const rc = reco.dedupKey.split("|").slice(2).join("|"); // rootCause
  if (rc.startsWith("governance:")) return "high";
  if (rc.startsWith("finance:consistency")) return "high";
  if (rc.startsWith("duplicate-finance:")) return "high";
  if (rc.startsWith("adopt:")) return "high";
  if (rc.startsWith("workflows:") || rc.startsWith("workflow:")) return "medium";
  if (rc.startsWith("kpi:")) return "medium";
  if (rc.startsWith("alert:")) return "low";
  if (rc.startsWith("ops:")) {
    // Scale ops effort by pending volume captured in targetDelta.
    const v = reco.expectedImpact.targetDelta;
    if (v >= 100) return "high";
    if (v >= 20) return "medium";
    return "low";
  }
  return "medium";
}

/**
 * Deterministic dependency layer index. Lower layer runs first.
 * Rules chosen to reflect canonical repair sequence:
 *   0 — restore governance readiness (blocks everything else)
 *   1 — reconcile canonical financial chain / retire duplicate finance
 *   2 — repair cross-domain workflows
 *   3 — operational signal cleanup (DLQ / breakers / recon)
 *   4 — executive alerts + KPI trends
 *   5 — Workspace360 adoption backlog
 */
function layerOf(reco: Recommendation): number {
  const rc = reco.dedupKey.split("|").slice(2).join("|");
  if (rc.startsWith("governance:readiness")) return 0;
  if (rc.startsWith("finance:consistency") || rc.startsWith("duplicate-finance:")) return 1;
  if (rc.startsWith("workflows:") || rc.startsWith("workflow:")) return 2;
  if (rc.startsWith("ops:")) return 3;
  if (rc.startsWith("alert:") || rc.startsWith("kpi:")) return 4;
  if (rc.startsWith("adopt:")) return 5;
  return 4;
}

function progressFrom(status: RecoExecutionStatus): number {
  switch (status) {
    case "completed": return 1;
    case "in_progress": return 0.5;
    case "deferred": return 0.1;
    case "expired":
    case "rejected":
    case "pending":
    default: return 0;
  }
}
/**
 * Phase D12.0 — derive deterministic governance envelope from the reco's
 * rootCause prefix. Same input yields same capability/owner/approval role.
 */
function deriveGovernance(reco: Recommendation): RecoGovernance {
  const rc = reco.dedupKey.split("|").slice(2).join("|");
  const domain = reco.dedupKey.split("|")[0] ?? "platform";
  let businessCapability = `platform.${domain}`;
  let operationalOwner = "Platform Ops";
  let approvalRole: RecoApprovalRole = "domain_owner";
  let verificationSource = "governance.report";

  if (rc.startsWith("governance:")) {
    businessCapability = "governance.readiness";
    operationalOwner = "Governance & Compliance";
    approvalRole = "executive";
    verificationSource = "workspace360.governance";
  } else if (rc.startsWith("finance:consistency") || rc.startsWith("duplicate-finance:")) {
    businessCapability = "finance.reconciliation";
    operationalOwner = "Finance Reliability";
    approvalRole = "finance_admin";
    verificationSource = "payment.reconciliation";
  } else if (rc.startsWith("workflows:") || rc.startsWith("workflow:")) {
    businessCapability = `workflow.${domain}`;
    operationalOwner = "Workspace Reliability";
    approvalRole = "domain_owner";
    verificationSource = "workspace360.workflows";
  } else if (rc.startsWith("ops:")) {
    businessCapability = "ops.signals";
    operationalOwner = "SRE / MOC";
    approvalRole = "auto";
    verificationSource = "ops.outbox";
  } else if (rc.startsWith("alert:")) {
    businessCapability = "alerting.routes";
    operationalOwner = "SRE / MOC";
    approvalRole = "auto";
    verificationSource = "alert.dispatch";
  } else if (rc.startsWith("kpi:")) {
    businessCapability = `kpi.${domain}`;
    operationalOwner = "Executive Ops";
    approvalRole = "executive";
    verificationSource = "executive.kpis";
  } else if (rc.startsWith("adopt:")) {
    businessCapability = "workspace360.adoption";
    operationalOwner = "Platform Architecture";
    approvalRole = "executive";
    verificationSource = "workspace360.certification";
  }

  const status = reco.execution.status;
  const hasObservation = reco.execution.observed != null;
  const verifiedFlag = status === "completed" && hasObservation;
  const completed = status === "completed" && hasObservation;
  return {
    businessCapability,
    operationalOwner,
    approvalRole,
    verificationSource,
    completed,
    verified: verifiedFlag,
  };
}


/**
 * Phase D12.0 — Executive Recovery Execution Governance.
 * Governance envelope layered onto each orchestration entry. Values are
 * derived deterministically from the recommendation's rootCause/domain —
 * no new tables, no runtime lookups.
 */
export type RecoApprovalRole =
  | "auto"                       // low-risk, self-executing
  | "domain_owner"               // domain lead sign-off
  | "finance_admin"              // finance lead sign-off
  | "security_admin"             // security lead sign-off
  | "executive";                 // exec approval required

export interface RecoGovernance {
  businessCapability: string;    // canonical capability id, e.g. "governance.readiness"
  operationalOwner: string;      // team/role responsible for executing
  approvalRole: RecoApprovalRole;
  verificationSource: string;    // which governance surface confirms completion
  completed: boolean;            // outcome verified === true
  verified: boolean;             // outcome verified truthy (pass/fail known)
}

export interface RecoOrchestration {
  id: string;
  effort: RecoEffort;
  estimatedResolutionMs: number;
  dependsOn: string[];           // reco ids that must precede
  layer: number;                 // dependency layer (0 = first)
  parallelizable: boolean;       // true if peers exist in same layer
  blocking: boolean;             // true if any later-layer reco depends on it
  criticalPath: boolean;         // on longest cumulative-time path
  progress: number;              // 0..1 from execution status
  expectedBusinessRecovery: number; // targetDelta (canonical KPI points)
  governance: RecoGovernance;
}

export interface RecoveryPlanStep {
  order: number;                 // 1-based
  layer: number;
  parallel: Recommendation[];    // recos in this step (can run in parallel)
  estimatedResolutionMs: number; // max within step
  expectedBusinessRecovery: number; // sum of open (non-completed) recovery
}

export interface RecoveryPlan {
  steps: RecoveryPlanStep[];
  orchestration: Record<string, RecoOrchestration>;
  criticalPath: string[];        // reco ids
  totalEstimatedMs: number;      // sum of step maxima
  totalBusinessRecovery: number; // sum across open recos
  overallProgress: number;       // 0..1
  passed: boolean;               // deterministic invariants held
  failures: string[];
}

/**
 * Deterministic recovery plan builder. Pure function — same input yields
 * identical steps, ordering, and critical-path selection.
 */
export function buildRecoveryPlan(recos: ReadonlyArray<Recommendation>): RecoveryPlan {
  const failures: string[] = [];
  const orch: Record<string, RecoOrchestration> = {};

  // Group by layer.
  const byLayer = new Map<number, Recommendation[]>();
  for (const r of recos) {
    const L = layerOf(r);
    if (!byLayer.has(L)) byLayer.set(L, []);
    byLayer.get(L)!.push(r);
  }
  const layers = Array.from(byLayer.keys()).sort((a, b) => a - b);

  // Precompute dependency = every reco in a strictly-earlier layer.
  const layerIds = new Map<number, string[]>();
  for (const L of layers) {
    const ids = byLayer.get(L)!
      .slice()
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .map((r) => r.id);
    layerIds.set(L, ids);
  }

  // Populate orchestration entries.
  for (const L of layers) {
    const peers = byLayer.get(L)!;
    const earlier = layers.filter((x) => x < L).flatMap((x) => layerIds.get(x)!);
    for (const r of peers) {
      const effort = classifyEffort(r);
      const eta = EFFORT_MS[effort];
      const parallelizable = peers.length > 1;
      orch[r.id] = {
        id: r.id,
        effort,
        estimatedResolutionMs: eta,
        dependsOn: earlier.slice(),
        layer: L,
        parallelizable,
        blocking: false, // set below
        criticalPath: false, // set below
        progress: progressFrom(r.execution.status),
        expectedBusinessRecovery: Math.max(0, r.expectedImpact.targetDelta),
        governance: deriveGovernance(r),
      };
    }
  }

  // Blocking: any reco in an earlier layer with successors in a later layer.
  for (const L of layers) {
    const hasLater = layers.some((x) => x > L);
    if (!hasLater) continue;
    for (const id of layerIds.get(L)!) orch[id].blocking = true;
  }

  // Build steps.
  const steps: RecoveryPlanStep[] = [];
  let order = 0;
  let totalEstimatedMs = 0;
  let totalBusinessRecovery = 0;
  let progressSum = 0;
  for (const L of layers) {
    order += 1;
    const ids = layerIds.get(L)!;
    const parallel = ids.map((id) => recos.find((r) => r.id === id)!);
    const stepMax = parallel.reduce((m, r) => Math.max(m, orch[r.id].estimatedResolutionMs), 0);
    const stepRecovery = parallel.reduce(
      (s, r) => s + (r.execution.status === "completed" ? 0 : orch[r.id].expectedBusinessRecovery),
      0,
    );
    totalEstimatedMs += stepMax;
    totalBusinessRecovery += stepRecovery;
    for (const r of parallel) progressSum += orch[r.id].progress;
    steps.push({
      order,
      layer: L,
      parallel,
      estimatedResolutionMs: stepMax,
      expectedBusinessRecovery: stepRecovery,
    });
  }

  // Critical path: pick the highest-ETA reco within each layer; deterministic
  // tie-break by (higher score, lower id).
  const criticalPath: string[] = [];
  for (const step of steps) {
    if (step.parallel.length === 0) continue;
    const winner = step.parallel.slice().sort((a, b) => {
      const ea = orch[a.id].estimatedResolutionMs;
      const eb = orch[b.id].estimatedResolutionMs;
      return eb - ea || b.score - a.score || a.id.localeCompare(b.id);
    })[0];
    orch[winner.id].criticalPath = true;
    criticalPath.push(winner.id);
  }

  // Invariants.
  for (const r of recos) {
    const o = orch[r.id];
    if (!o) { failures.push(`${r.id}: missing orchestration`); continue; }
    if (o.dependsOn.includes(r.id)) failures.push(`${r.id}: self-dependency`);
    for (const dep of o.dependsOn) {
      if (!orch[dep]) failures.push(`${r.id}: unknown dependency ${dep}`);
      else if (orch[dep].layer >= o.layer) failures.push(`${r.id}: dependency in same/later layer`);
    }
  }

  const overallProgress = recos.length === 0 ? 1 : progressSum / recos.length;

  return {
    steps,
    orchestration: orch,
    criticalPath,
    totalEstimatedMs,
    totalBusinessRecovery,
    overallProgress,
    passed: failures.length === 0,
    failures,
  };
}

/** Human-readable ETA. Deterministic; no locale-sensitive rounding. */
export function formatEta(ms: number): string {
  if (ms <= 0) return "0m";
  const h = Math.round(ms / (60 * 60 * 1000));
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  const rem = h % 24;
  return rem === 0 ? `${d}d` : `${d}d ${rem}h`;
}
