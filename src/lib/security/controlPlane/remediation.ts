/**
 * SAFARID Security Control Plane — Remediation Orchestrator.
 *
 * Dependency-aware, not linear. A remediation plan is only valid when it names:
 *   - the strategy and the exact change surface (code / DB / config),
 *   - who is authorised to apply it,
 *   - what could break, derived from the blast radius rather than guessed,
 *   - the verification that proves the fix,
 *   - the adjacent regressions that prove nothing else broke,
 *   - the residual risk that remains afterwards.
 *
 * The orchestrator never executes anything. It produces the plan; execution
 * stays with the existing deterministic engines and their approval paths.
 */
import type { BlastRadius } from "./assetGraph";
import { getAsset } from "./assetGraph";
import type { RiskAssessment, SecurityFinding } from "./riskEngine";

export type RemediationStrategy =
  | "revoke_grant"
  | "tighten_rls_policy"
  | "enable_rls"
  | "add_server_guard"
  | "add_rate_limit"
  | "config_change"
  | "accept_documented"
  | "investigate_first";

export type ChangeSurface = "database" | "edge_function" | "application_code" | "configuration";

export interface RemediationStep {
  order: number;
  action: string;
  surface: ChangeSurface;
  reversible: boolean;
}

export interface BreakageRisk {
  assetId: string;
  label: string;
  detail: string;
  depth: number;
}

export interface RemediationPlan {
  findingId: string;
  assetId: string;
  band: RiskAssessment["band"];
  strategy: RemediationStrategy;
  surfaces: ChangeSurface[];
  /** Roles permitted to apply this class of change. */
  authorisedRoles: string[];
  /** True when a second pair of eyes is required before the change lands. */
  fourEyesRequired: boolean;
  steps: RemediationStep[];
  breakageRisks: BreakageRisk[];
  verification: string[];
  regressionSuites: string[];
  residualRisk: string;
  /** Set when the plan cannot be produced with the evidence available. */
  blockedReason?: string;
}

const STRATEGY_BY_CLASS: Record<SecurityFinding["findingClass"], RemediationStrategy> = {
  excessive_privilege: "revoke_grant",
  missing_rls: "enable_rls",
  permissive_policy: "tighten_rls_policy",
  anon_write_surface: "add_rate_limit",
  unauthenticated_endpoint: "add_server_guard",
  public_reference_exposure: "accept_documented",
  definer_reliance: "add_server_guard",
  config_weakness: "config_change",
  unverified_control: "investigate_first",
};

const SURFACE_BY_STRATEGY: Record<RemediationStrategy, ChangeSurface[]> = {
  revoke_grant: ["database"],
  tighten_rls_policy: ["database"],
  enable_rls: ["database"],
  add_server_guard: ["edge_function", "application_code"],
  add_rate_limit: ["database"],
  config_change: ["configuration"],
  accept_documented: [],
  investigate_first: [],
};

export function planRemediation(
  finding: SecurityFinding,
  assessment: RiskAssessment,
): RemediationPlan {
  const asset = getAsset(finding.assetId);
  const blast: BlastRadius = assessment.blast;
  const strategy = STRATEGY_BY_CLASS[finding.findingClass];
  const surfaces = SURFACE_BY_STRATEGY[strategy];

  const breakageRisks: BreakageRisk[] = blast.nodes.map((node) => ({
    assetId: node.asset.id,
    label: node.asset.label,
    depth: node.depth,
    detail:
      node.asset.financialPath
        ? "Calls through this boundary on a monetary path — a wrong revoke stops billing or revenue recognition."
        : node.asset.externallyAccessible
          ? "Reachable without authentication — a wrong tighten locks out legitimate external callers."
          : "Internal caller — a wrong change surfaces as a permission error in staff workflows.",
  }));

  const steps: RemediationStep[] = [];
  const push = (action: string, surface: ChangeSurface, reversible = true) =>
    steps.push({ order: steps.length + 1, action, surface, reversible });

  if (strategy === "investigate_first") {
    push("Establish the missing evidence before changing any boundary.", "application_code");
  } else if (strategy === "accept_documented") {
    push("Record the exposure and its justification in the control baseline; change nothing.", "configuration");
  } else {
    push(`Enumerate live callers of ${finding.assetId} before the change.`, "database");
    if (strategy === "revoke_grant") {
      push("REVOKE the excess grant, then re-GRANT only the roles the policies allow.", "database");
    }
    if (strategy === "enable_rls") {
      push("ENABLE ROW LEVEL SECURITY, then add the scoped policies and matching GRANTs.", "database");
    }
    if (strategy === "tighten_rls_policy") {
      push("Replace the always-true predicate with an ownership or role predicate.", "database");
    }
    if (strategy === "add_rate_limit") {
      push("Add an atomic reservation counter with per-scope and global ceilings.", "database");
    }
    if (strategy === "add_server_guard") {
      push("Reject unauthorised callers before any body parsing or privileged client use.", "edge_function", false);
    }
    if (strategy === "config_change") {
      push("Apply the configuration change and record the previous value.", "configuration");
    }
    push("Re-run the live authorisation probes for the changed asset.", "database");
  }

  const verification: string[] = strategy === "accept_documented"
    ? ["Baseline entry exists with owner, justification and review date."]
    : [
        "Live privilege set for the asset matches the intended role list.",
        "A signed-out probe against the asset is refused.",
        blast.touchesFinancialPath
          ? "A monetary read through the chain still returns the same figure as before the change."
          : "An authorised caller still completes its normal path.",
      ];

  const regressionSuites = [...new Set([
    ...blast.regressionSuites,
    "scripts/execute-grant-gate.ts",
    "scripts/rls-helper-gate.ts",
  ])].sort();

  const authorisedRoles = surfaces.includes("database")
    ? ["super_admin", "security_admin"]
    : surfaces.length === 0
      ? ["security_admin"]
      : ["super_admin", "security_admin", "platform_engineer"];

  const fourEyesRequired =
    assessment.band === "P0" ||
    blast.touchesFinancialPath ||
    Boolean(asset?.privileged && asset.criticality >= 4);

  const residualRisk = [
    strategy === "accept_documented"
      ? "Exposure remains by decision; it is low-sensitivity reference data."
      : "Boundary is corrected at the changed asset.",
    blast.nodes.length
      ? `${blast.nodes.length} dependent asset(s) remain unproven until their regressions run.`
      : "No dependent assets to re-prove.",
    assessment.unknownAsset
      ? "The asset is not in the security graph, so the radius is a lower bound, not a complete one."
      : "",
  ].filter(Boolean).join(" ");

  return {
    findingId: finding.id,
    assetId: finding.assetId,
    band: assessment.band,
    strategy,
    surfaces,
    authorisedRoles,
    fourEyesRequired,
    steps,
    breakageRisks,
    verification,
    regressionSuites,
    residualRisk,
    blockedReason: strategy === "investigate_first"
      ? "The control is unverified; a remediation cannot be planned before the evidence exists."
      : undefined,
  };
}

/** Ordered plans for a ranked set of findings — highest risk first. */
export function orchestrateRemediation(
  findings: SecurityFinding[],
  assessments: RiskAssessment[],
): RemediationPlan[] {
  const byId = new Map(findings.map((f) => [f.id, f]));
  return assessments
    .map((a) => {
      const f = byId.get(a.findingId);
      return f ? planRemediation(f, a) : undefined;
    })
    .filter((p): p is RemediationPlan => Boolean(p));
}
