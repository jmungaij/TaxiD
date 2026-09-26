/**
 * Phase P2-T4 — Root Cause Correlation & Evidence Closure.
 *
 * Pure, deterministic composer. NO new dashboards, engines, services, edge
 * functions, tables, or governance layers. Enriches the existing
 * BlockerInventory with the correlation evidence already produced by the
 * D7–P2-T2 stack:
 *
 *   • first failing dependency          (evidence chain root)
 *   • business capability domain        (existing governance taxonomy)
 *   • business journey                  (workflow_registry id)
 *   • blocking certification gate       (closure workstream id)
 *   • deterministic evidence chain      (identifiers only — no duplication)
 *   • recovery recommendation           (D12 RecoveryPlan reuse)
 *   • release-authority explanation     (why PROMOTE failed first)
 *
 * The Release Authority scoring logic is unchanged. This module *explains*
 * decisions; it never mutates them.
 */
import type { Blocker } from "./blockerInventory";
import type { ProductionValidationReport } from "./productionValidation";
import type { ProductionEvidenceVaultReport } from "./productionEvidenceVault";
import type { ProductionExecutionReport } from "./productionExecution";
import type { ProductionAcceptanceReport } from "./productionAcceptance";
import type { ProductionClosureReport, ClosureWorkstreamId } from "./productionClosure";
import type { RecoveryPlan, RecoOrchestration } from "./orchestration";

/* ------------------------------------------------------------------ */
/* Domain taxonomy (reuses existing governance categories)             */
/* ------------------------------------------------------------------ */
export type BusinessCapabilityDomain =
  | "payments"
  | "marketplace"
  | "finance"
  | "compliance"
  | "security"
  | "operations"
  | "workspace360"
  | "infrastructure";

export interface EvidenceChainLink {
  /** Artefact kind — always maps to an existing platform surface. */
  kind:
    | "business_journey"
    | "workflow"
    | "edge_function"
    | "integration"
    | "certification"
    | "vault"
    | "recovery_plan"
    | "recommendation"
    | "release_authority";
  /** Canonical identifier as it appears in the source artefact. */
  ref: string;
  /** Human label — never new evidence, just an accessible name. */
  label: string;
}

export interface RecoveryReference {
  recommendationId: string | null;
  plan: string;
  operationalOwner: string;
  approvalRole: string;
  verificationSource: string;
  /** Expected evidence artefact that must exist for the blocker to clear. */
  expectedEvidence: string;
}

export interface BlockerCorrelation {
  domain: BusinessCapabilityDomain;
  businessCapability: string;
  businessJourney: string | null;
  blockingGate: ClosureWorkstreamId | "acceptance";
  firstFailingDependency: string;
  evidenceChain: EvidenceChainLink[];
  recovery: RecoveryReference;
  /** Deterministic — same inputs, same value. */
  complete: boolean;
}

/* ------------------------------------------------------------------ */
/* Static taxonomy (deterministic, config-only)                        */
/* ------------------------------------------------------------------ */
const CLOSURE_TAXONOMY: Record<
  ClosureWorkstreamId,
  {
    domain: BusinessCapabilityDomain;
    capability: string;
    journey: string | null;
    firstDep: string;
    chainKinds: EvidenceChainLink["kind"][];
    expectedEvidence: string;
  }
> = {
  payment_chain: {
    domain: "payments",
    capability: "payments.certification",
    journey: "rider-trip-settlement",
    firstDep: "payment_certification_next_action",
    chainKinds: ["business_journey", "workflow", "edge_function", "integration", "certification", "release_authority"],
    expectedEvidence: "payment-certification-run success with PASS verdict",
  },
  integrations: {
    domain: "operations",
    capability: "operations.integrations",
    journey: null,
    firstDep: "integration_qualification.telemetry",
    chainKinds: ["integration", "edge_function", "certification", "release_authority"],
    expectedEvidence: "productionValidation.integrations.pillarPassed === true",
  },
  business_journeys: {
    domain: "marketplace",
    capability: "marketplace.journeys",
    journey: "rider-trip-settlement",
    firstDep: "productionExecution.journeys",
    chainKinds: ["business_journey", "workflow", "certification", "release_authority"],
    expectedEvidence: "productionExecution.journeys.totalPassing === total",
  },
  workspace360_adoption: {
    domain: "workspace360",
    capability: "workspace360.adoption",
    journey: null,
    firstDep: "governance.domains.adopted",
    chainKinds: ["certification", "release_authority"],
    expectedEvidence: "schema-contract.v1.json > workspace360.adopted_domains includes domain",
  },
  production_baseline: {
    domain: "operations",
    capability: "operations.baseline",
    journey: null,
    firstDep: "productionAcceptance.baseline",
    chainKinds: ["certification", "vault", "release_authority"],
    expectedEvidence: "V1 performance baseline persisted in Evidence Vault",
  },
  operational_runbooks: {
    domain: "operations",
    capability: "operations.runbooks",
    journey: null,
    firstDep: "productionAcceptance.runbooks",
    chainKinds: ["recovery_plan", "recommendation", "certification"],
    expectedEvidence: "RecoveryPlan governance metadata (owner, verification) present for every incident",
  },
  navigation_governance: {
    domain: "infrastructure",
    capability: "infrastructure.navigation",
    journey: null,
    firstDep: "governance.navigation",
    chainKinds: ["certification", "release_authority"],
    expectedEvidence: "ROUTES registry synchronized with mounted routes",
  },
  decision_convergence: {
    domain: "operations",
    capability: "operations.convergence",
    journey: null,
    firstDep: "decision.convergence",
    chainKinds: ["certification", "release_authority"],
    expectedEvidence: "governance/validation/execution/acceptance/vault decisions convergent",
  },
  cicd_ratchet: {
    domain: "infrastructure",
    capability: "infrastructure.ratchet",
    journey: null,
    firstDep: "vault.ratchet.blocking_gates",
    chainKinds: ["vault", "certification", "release_authority"],
    expectedEvidence: "vault.ratchet.blocking_gates === []",
  },
  blockers: {
    domain: "operations",
    capability: "operations.acceptance",
    journey: null,
    firstDep: "productionAcceptance.blockers",
    chainKinds: ["recovery_plan", "recommendation", "certification"],
    expectedEvidence: "productionAcceptance.blockers === []",
  },
};

const ACCEPTANCE_HINT_DOMAIN: Record<string, BusinessCapabilityDomain> = {
  payment: "payments",
  ledger: "finance",
  finance: "finance",
  wallet: "finance",
  compliance: "compliance",
  kyb: "compliance",
  security: "security",
  fraud: "security",
  dispatch: "marketplace",
  trip: "marketplace",
  rider: "marketplace",
  driver: "marketplace",
  corporate: "marketplace",
  fleet: "marketplace",
  observability: "operations",
  recovery: "operations",
  runbook: "operations",
  workspace360: "workspace360",
  navigation: "infrastructure",
  ratchet: "infrastructure",
};

function classifyAcceptance(text: string): BusinessCapabilityDomain {
  const s = text.toLowerCase();
  for (const [hint, dom] of Object.entries(ACCEPTANCE_HINT_DOMAIN)) {
    if (s.includes(hint)) return dom;
  }
  return "operations";
}

/* ------------------------------------------------------------------ */
/* Recovery plan lookup                                                */
/* ------------------------------------------------------------------ */
function findRecoveryFor(
  plan: RecoveryPlan | null | undefined,
  capability: string,
  domain: BusinessCapabilityDomain,
): RecoOrchestration | null {
  if (!plan) return null;
  const entries = Object.values(plan.orchestration);
  // exact capability match wins
  const exact = entries.find((o) => o.governance.businessCapability === capability);
  if (exact) return exact;
  // capability prefix match
  const prefix = entries.find((o) => o.governance.businessCapability.startsWith(`${domain}.`));
  if (prefix) return prefix;
  return null;
}

/* ------------------------------------------------------------------ */
/* Evidence chain construction                                         */
/* ------------------------------------------------------------------ */
function buildEvidenceChain(
  kinds: EvidenceChainLink["kind"][],
  ctx: {
    blocker: Blocker;
    journey: string | null;
    firstDep: string;
    recovery: RecoOrchestration | null;
    validation: ProductionValidationReport;
    vault: ProductionEvidenceVaultReport;
  },
): EvidenceChainLink[] {
  const chain: EvidenceChainLink[] = [];
  const seen = new Set<string>();
  const push = (kind: EvidenceChainLink["kind"], ref: string, label: string) => {
    const key = `${kind}:${ref}`;
    if (seen.has(key)) return;
    seen.add(key);
    chain.push({ kind, ref, label });
  };

  for (const k of kinds) {
    switch (k) {
      case "business_journey":
        if (ctx.journey) push("business_journey", ctx.journey, `Journey ${ctx.journey}`);
        break;
      case "workflow":
        if (ctx.journey) push("workflow", `workflow_registry:${ctx.journey}`, "workflow_registry");
        break;
      case "edge_function":
        push("edge_function", "evp-run", "EVP orchestrator");
        break;
      case "integration":
        push("integration", "productionValidation.integrations", "Integration qualification");
        break;
      case "certification":
        push("certification", ctx.blocker.source, "Failing gate source");
        break;
      case "vault":
        push("vault", `vault:${ctx.vault.record.fingerprint}`, "Evidence Vault");
        break;
      case "recovery_plan":
        if (ctx.recovery) push("recovery_plan", `plan:${ctx.recovery.id}`, "D12 Recovery Plan");
        break;
      case "recommendation":
        if (ctx.recovery) push("recommendation", ctx.recovery.id, "Recommendation");
        break;
      case "release_authority":
        push("release_authority", `RA:${ctx.validation.releaseAuthority.decision}`, "Release Authority");
        break;
    }
  }
  // Always anchor the chain to the first failing dependency and to release authority.
  if (!chain.some((l) => l.ref === ctx.firstDep)) {
    chain.unshift({ kind: "certification", ref: ctx.firstDep, label: "First failing dependency" });
  }
  return chain;
}

/* ------------------------------------------------------------------ */
/* Public API — correlate a blocker set                                */
/* ------------------------------------------------------------------ */
export interface CorrelationInputs {
  blockers: ReadonlyArray<Blocker>;
  validation: ProductionValidationReport;
  vault: ProductionEvidenceVaultReport;
  execution: ProductionExecutionReport;
  acceptance: ProductionAcceptanceReport;
  closure: ProductionClosureReport;
  recoveryPlan?: RecoveryPlan | null;
}

export interface CorrelatedBlocker extends Blocker {
  correlation: BlockerCorrelation;
}

export function correlateBlockers(inputs: CorrelationInputs): CorrelatedBlocker[] {
  const out: CorrelatedBlocker[] = [];
  for (const b of inputs.blockers) {
    out.push({ ...b, correlation: correlateOne(b, inputs) });
  }
  return out;
}

function correlateOne(b: Blocker, inputs: CorrelationInputs): BlockerCorrelation {
  const isClosure = b.id.startsWith("closure:");
  const closureKey = isClosure ? (b.id.slice("closure:".length) as ClosureWorkstreamId) : null;

  const tax = closureKey ? CLOSURE_TAXONOMY[closureKey] : null;
  const domain: BusinessCapabilityDomain = tax
    ? tax.domain
    : classifyAcceptance(`${b.title} ${b.rootCause} ${b.owner}`);
  const capability = tax ? tax.capability : `${domain}.acceptance`;
  const journey = tax ? tax.journey : null;
  const firstDep = tax ? tax.firstDep : (b.currentEvidence || b.source);
  const blockingGate: BlockerCorrelation["blockingGate"] =
    closureKey ?? "acceptance";

  const recovery = findRecoveryFor(inputs.recoveryPlan, capability, domain);

  const chain = buildEvidenceChain(
    tax?.chainKinds ?? ["recovery_plan", "recommendation", "certification", "release_authority"],
    {
      blocker: b,
      journey,
      firstDep,
      recovery,
      validation: inputs.validation,
      vault: inputs.vault,
    },
  );

  const expectedEvidence = tax
    ? tax.expectedEvidence
    : `${capability}: verification of "${b.missingEvidence}"`;

  const recoveryRef: RecoveryReference = {
    recommendationId: recovery?.id ?? null,
    plan: b.requiredFix,
    operationalOwner: recovery?.governance.operationalOwner ?? b.owner,
    approvalRole: recovery?.governance.approvalRole ?? "domain_owner",
    verificationSource: recovery?.governance.verificationSource ?? b.verification,
    expectedEvidence,
  };

  const complete =
    chain.length > 0 &&
    !!capability &&
    !!firstDep &&
    !!recoveryRef.operationalOwner &&
    !!recoveryRef.approvalRole &&
    !!recoveryRef.verificationSource &&
    !!recoveryRef.expectedEvidence;

  return {
    domain,
    businessCapability: capability,
    businessJourney: journey,
    blockingGate,
    firstFailingDependency: firstDep,
    evidenceChain: chain,
    recovery: recoveryRef,
    complete,
  };
}

/* ------------------------------------------------------------------ */
/* Release Authority explanation                                       */
/* ------------------------------------------------------------------ */
export interface ReleaseAuthorityExplanation {
  decision: ProductionValidationReport["releaseAuthority"]["decision"];
  /** Ordered failed pillars — first is the pillar that fails first. */
  failedPillars: string[];
  firstFailingPillar: string | null;
  firstFailingBlocker: CorrelatedBlocker | null;
  /** Evidence chain rooted at the first failing blocker. */
  dependencyChain: EvidenceChainLink[];
  /** Expected score improvement if the first failing blocker is resolved. */
  expectedImprovement: number;
  /** Deterministic human-readable explanation lines (never mutate scoring). */
  reasons: string[];
}

export function explainReleaseAuthority(
  validation: ProductionValidationReport,
  correlated: ReadonlyArray<CorrelatedBlocker>,
): ReleaseAuthorityExplanation {
  const ra = validation.releaseAuthority;
  const failedPillars = Object.entries(ra.pillarPassed)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);

  const firstFailingBlocker = correlated[0] ?? null;
  const firstFailingPillar = failedPillars[0] ?? null;

  const dependencyChain = firstFailingBlocker?.correlation.evidenceChain ?? [];
  const expectedImprovement = firstFailingBlocker?.expectedReadinessGain ?? 0;

  const reasons: string[] = [];
  if (ra.decision !== "PROMOTE") {
    reasons.push(`Decision ${ra.decision}: ${ra.reasons.join("; ") || "no PROMOTE evidence"}`);
    if (firstFailingPillar) reasons.push(`First failing pillar: ${firstFailingPillar}`);
    if (firstFailingBlocker) {
      reasons.push(
        `First failing dependency: ${firstFailingBlocker.correlation.firstFailingDependency}`,
      );
      reasons.push(
        `Recommended fix: ${firstFailingBlocker.correlation.recovery.plan} (owner: ${firstFailingBlocker.correlation.recovery.operationalOwner}, approval: ${firstFailingBlocker.correlation.recovery.approvalRole})`,
      );
      reasons.push(
        `Expected improvement on resolution: +${expectedImprovement} readiness points`,
      );
    }
  } else {
    reasons.push("Release Authority PROMOTE — no correlation required.");
  }

  return {
    decision: ra.decision,
    failedPillars,
    firstFailingPillar,
    firstFailingBlocker,
    dependencyChain,
    expectedImprovement,
    reasons,
  };
}

/* ------------------------------------------------------------------ */
/* Ratchet — deterministic completeness check for CI                   */
/* ------------------------------------------------------------------ */
export interface CorrelationRatchetResult {
  passed: boolean;
  totalBlockers: number;
  incompleteBlockers: number;
  brokenChains: number;
  untraceableRootCauses: number;
  missingRecoveryReferences: number;
  failures: string[];
}

export function evaluateCorrelationRatchet(
  correlated: ReadonlyArray<CorrelatedBlocker>,
): CorrelationRatchetResult {
  const failures: string[] = [];
  let incomplete = 0;
  let brokenChains = 0;
  let untraceable = 0;
  let missingRecovery = 0;
  for (const b of correlated) {
    if (!b.correlation.complete) {
      incomplete++;
      failures.push(`${b.id}: correlation incomplete`);
    }
    if (b.correlation.evidenceChain.length === 0) {
      brokenChains++;
      failures.push(`${b.id}: evidence chain empty`);
    }
    if (!b.correlation.firstFailingDependency) {
      untraceable++;
      failures.push(`${b.id}: no first-failing dependency`);
    }
    const r = b.correlation.recovery;
    if (!r.operationalOwner || !r.approvalRole || !r.verificationSource || !r.expectedEvidence) {
      missingRecovery++;
      failures.push(`${b.id}: recovery reference missing fields`);
    }
  }
  return {
    passed: failures.length === 0,
    totalBlockers: correlated.length,
    incompleteBlockers: incomplete,
    brokenChains,
    untraceableRootCauses: untraceable,
    missingRecoveryReferences: missingRecovery,
    failures,
  };
}
