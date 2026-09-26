/**
 * Yalla Security Control Plane — Asset Graph.
 *
 * A security finding is never just a finding about one object. Every callable
 * object in the platform belongs to a business chain, and changing its
 * authorisation boundary changes what that chain can do.
 *
 * This module is the authoritative, deterministic register of security-relevant
 * assets and their dependency edges. It contains no model output and no
 * heuristics: an edge exists only where the platform really calls through.
 *
 * An edge A → B (A dependsOn B) means A's behaviour depends on B: it calls it,
 * reads it, or is written by it. Blast radius walks the edges in reverse.
 *
 * Nothing here mutates anything. It answers two questions:
 *   1. What depends on this asset? (blast radius)
 *   2. Which regressions must pass before a change to it is accepted?
 */

export type AssetKind =
  | "db_function"
  | "db_table"
  | "db_view"
  | "rls_policy"
  | "edge_function"
  | "storage_bucket"
  | "config"
  | "surface";

/** Business domains the control plane can reason about. */
export type SecurityDomain =
  | "contracts"
  | "commercial"
  | "finance"
  | "recruitment"
  | "logistics"
  | "identity"
  | "communications"
  | "partners"
  | "intelligence"
  | "platform";

export interface SecurityAsset {
  id: string;
  kind: AssetKind;
  label: string;
  domain: SecurityDomain;
  /** 1 (peripheral) … 5 (the business stops without it). */
  criticality: 1 | 2 | 3 | 4 | 5;
  /** 1 (public reference data) … 5 (money, identity documents, credentials). */
  dataSensitivity: 1 | 2 | 3 | 4 | 5;
  /** Reachable by an unauthenticated caller (anon key, public route, webhook). */
  externallyAccessible: boolean;
  /** Runs with elevated rights (SECURITY DEFINER, service_role, admin-only). */
  privileged: boolean;
  /** Holds or filters per-tenant data, so a boundary error crosses tenants. */
  tenantScoped: boolean;
  /** True when a change here can alter a monetary value or its recognition. */
  financialPath: boolean;
  /** Assets this asset calls or reads. Edges are one-directional. */
  dependsOn: string[];
  /** Checks that must pass before a change to this asset is accepted. */
  regressionSuites: string[];
}

const A = (a: SecurityAsset) => a;

/**
 * The register. Extended as assets are certified — never trimmed to make a
 * blast radius look smaller.
 */
export const SECURITY_ASSETS: SecurityAsset[] = [
  A({
    id: "contract_status_set",
    kind: "db_function",
    label: "Contract status transition",
    domain: "contracts",
    criticality: 5,
    dataSensitivity: 4,
    externallyAccessible: false,
    privileged: true,
    tenantScoped: true,
    financialPath: true,
    dependsOn: ["crm_contracts", "commercial_lifecycle_audit"],
    regressionSuites: ["src/lib/security", "src/lib/commercial", "scripts/execute-grant-gate.ts"],
  }),
  A({
    id: "contract_acceptance_record",
    kind: "db_function",
    label: "Client contract acceptance",
    domain: "contracts",
    criticality: 5,
    dataSensitivity: 4,
    externallyAccessible: true,
    privileged: true,
    tenantScoped: true,
    financialPath: true,
    dependsOn: ["contract_status_set", "crm_documents", "contract_portal_invites"],
    regressionSuites: ["src/lib/security", "e2e/charles-decagon-journey.spec.ts"],
  }),
  A({
    id: "contract_portal_invites",
    kind: "db_table",
    label: "Client portal invitations",
    domain: "contracts",
    criticality: 4,
    dataSensitivity: 4,
    externallyAccessible: true,
    privileged: false,
    tenantScoped: true,
    financialPath: false,
    dependsOn: [],
    regressionSuites: ["src/lib/security"],
  }),
  A({
    id: "crm_contracts",
    kind: "db_table",
    label: "Contract register",
    domain: "contracts",
    criticality: 5,
    dataSensitivity: 4,
    externallyAccessible: false,
    privileged: false,
    tenantScoped: true,
    financialPath: true,
    dependsOn: [],
    regressionSuites: ["src/lib/commercial"],
  }),
  A({
    id: "contract_amendment_bill",
    kind: "db_function",
    label: "Amendment billing",
    domain: "commercial",
    criticality: 4,
    dataSensitivity: 4,
    externallyAccessible: false,
    privileged: true,
    tenantScoped: true,
    financialPath: true,
    dependsOn: ["contract_status_set"],
    regressionSuites: ["src/lib/commercial", "src/lib/security"],
  }),
  A({
    id: "crm_invoices",
    kind: "db_table",
    label: "Invoices",
    domain: "finance",
    criticality: 5,
    dataSensitivity: 5,
    externallyAccessible: false,
    privileged: false,
    tenantScoped: true,
    financialPath: true,
    // Invoice rows are produced by amendment billing, so a boundary change
    // there changes what appears here.
    dependsOn: ["contract_amendment_bill"],
    regressionSuites: ["src/lib/finance", "src/__tests__/reconGovernance.test.ts"],
  }),
  A({
    id: "commercial_transactions",
    kind: "db_table",
    label: "Revenue recognition register",
    domain: "finance",
    criticality: 5,
    dataSensitivity: 5,
    externallyAccessible: false,
    privileged: false,
    tenantScoped: true,
    financialPath: true,
    dependsOn: ["contract_status_set"],
    regressionSuites: ["src/lib/commercial", "src/lib/finance"],
  }),
  A({
    id: "crm_accounts",
    kind: "db_table",
    label: "Corporate accounts",
    domain: "commercial",
    criticality: 5,
    dataSensitivity: 4,
    externallyAccessible: false,
    privileged: false,
    tenantScoped: true,
    financialPath: false,
    dependsOn: [],
    regressionSuites: ["e2e/corporate-access.spec.ts"],
  }),
  A({
    id: "ops_event_outbox",
    kind: "db_table",
    label: "Operational event outbox (notifications)",
    domain: "communications",
    criticality: 4,
    dataSensitivity: 3,
    externallyAccessible: false,
    privileged: false,
    tenantScoped: true,
    financialPath: false,
    dependsOn: ["contract_status_set", "commercial_transactions"],
    regressionSuites: ["e2e/outbox-dlq-replay.spec.ts"],
  }),
  A({
    id: "ops_tasks",
    kind: "db_table",
    label: "Staff work queue",
    domain: "platform",
    criticality: 4,
    dataSensitivity: 3,
    externallyAccessible: false,
    privileged: false,
    tenantScoped: true,
    financialPath: false,
    dependsOn: ["contract_amendment_bill"],
    regressionSuites: ["src/lib/orchestration"],
  }),
  A({
    id: "commercial_lifecycle_audit",
    kind: "db_table",
    label: "Commercial audit trail",
    domain: "platform",
    criticality: 5,
    dataSensitivity: 4,
    externallyAccessible: false,
    privileged: false,
    tenantScoped: true,
    financialPath: false,
    dependsOn: [],
    regressionSuites: ["src/lib/security"],
  }),
  A({
    id: "ai_answer_ledger",
    kind: "db_table",
    label: "Ask Yalla answer ledger",
    domain: "intelligence",
    criticality: 3,
    dataSensitivity: 3,
    externallyAccessible: false,
    privileged: false,
    tenantScoped: true,
    financialPath: false,
    dependsOn: ["commercial_transactions", "crm_contracts", "ops_tasks"],
    regressionSuites: ["src/lib/intelligence"],
  }),
  A({
    id: "partner_api",
    kind: "edge_function",
    label: "Partner API surface",
    domain: "partners",
    criticality: 4,
    dataSensitivity: 4,
    externallyAccessible: true,
    privileged: true,
    tenantScoped: true,
    financialPath: true,
    dependsOn: ["crm_contracts", "commercial_transactions"],
    regressionSuites: ["src/lib/partners", "scripts/edge-cors-gate.ts"],
  }),
  A({
    id: "has_staff_permission",
    kind: "db_function",
    label: "Staff permission helper",
    domain: "identity",
    criticality: 5,
    dataSensitivity: 5,
    externallyAccessible: false,
    privileged: true,
    tenantScoped: false,
    financialPath: false,
    dependsOn: [],
    regressionSuites: ["scripts/rls-helper-gate.ts", "src/lib/security"],
  }),
  A({
    id: "has_role",
    kind: "db_function",
    label: "Role helper",
    domain: "identity",
    criticality: 5,
    dataSensitivity: 5,
    externallyAccessible: false,
    privileged: true,
    tenantScoped: false,
    financialPath: false,
    dependsOn: [],
    regressionSuites: ["scripts/rls-helper-gate.ts", "src/__tests__/roleHelperGrants.test.ts"],
  }),
  A({
    id: "rec_public_upload_reserve",
    kind: "db_function",
    label: "Recruitment public upload reservation",
    domain: "recruitment",
    criticality: 3,
    dataSensitivity: 4,
    externallyAccessible: true,
    privileged: true,
    tenantScoped: false,
    financialPath: false,
    dependsOn: ["rec_candidate_documents"],
    regressionSuites: ["src/lib/security", "scripts/execute-grant-gate.ts"],
  }),
  A({
    id: "rec_candidate_documents",
    kind: "db_table",
    label: "Candidate documents",
    domain: "recruitment",
    criticality: 3,
    dataSensitivity: 5,
    externallyAccessible: true,
    privileged: false,
    tenantScoped: false,
    financialPath: false,
    dependsOn: [],
    regressionSuites: ["src/lib/recruitment"],
  }),
  A({
    id: "rec_reference_data",
    kind: "db_table",
    label: "Recruitment public reference tables",
    domain: "recruitment",
    criticality: 1,
    dataSensitivity: 1,
    externallyAccessible: true,
    privileged: false,
    tenantScoped: false,
    financialPath: false,
    dependsOn: [],
    regressionSuites: ["src/lib/security"],
  }),
  A({
    id: "crm_documents",
    kind: "storage_bucket",
    label: "Client document storage",
    domain: "contracts",
    criticality: 4,
    dataSensitivity: 5,
    externallyAccessible: true,
    privileged: false,
    tenantScoped: true,
    financialPath: false,
    dependsOn: [],
    regressionSuites: ["src/lib/security"],
  }),
  A({
    id: "mpesa_callback",
    kind: "edge_function",
    label: "M-Pesa payment callback",
    domain: "finance",
    criticality: 5,
    dataSensitivity: 5,
    externallyAccessible: true,
    privileged: true,
    tenantScoped: true,
    financialPath: true,
    dependsOn: ["crm_invoices", "commercial_transactions"],
    regressionSuites: ["scripts/payment-ci-gate.ts", "scripts/payment-replay-determinism.ts"],
  }),
];

export const ASSETS_BY_ID: Record<string, SecurityAsset> = Object.fromEntries(
  SECURITY_ASSETS.map((a) => [a.id, a]),
);

export function getAsset(id: string): SecurityAsset | undefined {
  return ASSETS_BY_ID[id];
}

/** Direct callers of an asset (reverse dependency edges). */
export function directDependents(id: string): SecurityAsset[] {
  return SECURITY_ASSETS.filter((a) => a.dependsOn.includes(id));
}

export interface BlastNode {
  asset: SecurityAsset;
  /** 1 = direct caller, 2 = caller of a caller, … */
  depth: number;
  /** The chain from the changed asset to this node, for explanation. */
  path: string[];
}

export interface BlastRadius {
  originId: string;
  /** Absent origin means the graph does not know this asset yet. */
  known: boolean;
  nodes: BlastNode[];
  /** Business domains that a boundary change here can affect. */
  domains: SecurityDomain[];
  /** Assets that would break loudest if the boundary is wrong. */
  criticalPath: string[];
  /** True when the radius touches money at any depth. */
  touchesFinancialPath: boolean;
  /** True when the radius touches a caller reachable without authentication. */
  touchesExternalSurface: boolean;
  /** True when the radius crosses tenant-scoped data. */
  touchesTenantData: boolean;
  /** Union of the regressions every affected asset declares. */
  regressionSuites: string[];
  /** 0-100 composite spread measure used by the risk engine. */
  spreadScore: number;
}

/**
 * Breadth-first traversal of dependents. Cycles are visited once; depth is the
 * shortest path, so an asset that is both a direct and an indirect caller is
 * reported at its closest distance.
 */
export function computeBlastRadius(originId: string, maxDepth = 6): BlastRadius {
  const origin = getAsset(originId);
  const nodes: BlastNode[] = [];
  const seen = new Set<string>([originId]);
  let frontier: BlastNode[] = directDependents(originId).map((asset) => ({
    asset,
    depth: 1,
    path: [originId, asset.id],
  }));

  while (frontier.length > 0) {
    const next: BlastNode[] = [];
    for (const node of frontier) {
      if (seen.has(node.asset.id) || node.depth > maxDepth) continue;
      seen.add(node.asset.id);
      nodes.push(node);
      for (const dep of directDependents(node.asset.id)) {
        if (!seen.has(dep.id)) {
          next.push({ asset: dep, depth: node.depth + 1, path: [...node.path, dep.id] });
        }
      }
    }
    frontier = next;
  }

  const all = origin ? [origin, ...nodes.map((n) => n.asset)] : nodes.map((n) => n.asset);
  const domains = [...new Set(all.map((a) => a.domain))].sort();
  const regressionSuites = [...new Set(all.flatMap((a) => a.regressionSuites))].sort();
  const criticalPath = all
    .filter((a) => a.criticality >= 4)
    .map((a) => a.id)
    .sort();

  // Spread: how much of the graph, weighted by criticality, is downstream.
  const totalWeight = SECURITY_ASSETS.reduce((s, a) => s + a.criticality, 0);
  const affectedWeight = nodes.reduce((s, n) => s + n.asset.criticality, 0);
  const spreadScore = Math.round(100 * Math.min(1, affectedWeight / Math.max(1, totalWeight * 0.4)));

  return {
    originId,
    known: Boolean(origin),
    nodes: nodes.sort((a, b) => a.depth - b.depth || a.asset.id.localeCompare(b.asset.id)),
    domains,
    criticalPath,
    touchesFinancialPath: all.some((a) => a.financialPath),
    touchesExternalSurface: all.some((a) => a.externallyAccessible),
    touchesTenantData: all.some((a) => a.tenantScoped),
    regressionSuites,
    spreadScore,
  };
}
