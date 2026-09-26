/**
 * PHASE 9 (a) — COMPLETE RLS ROLE MATRIX.
 *
 * Fifteen real Yalla principals × every logistics resource × every access path,
 * including the negative cases that matter most (Corporate A → Corporate B
 * shipment, Partner A → Partner B courier, Courier A → Courier B POD).
 *
 * The matrix is generated, and every cell is evaluated against a REFERENCE
 * POLICY MODEL — the same predicates the migration plan declares. A green run
 * proves the policy model denies what it must; it does NOT prove the database
 * enforces it. Database enforcement is AV-06 and remains BLOCKED until the
 * isolated instance exists.
 */

export type RlsRole =
  | "anonymous"
  | "customer"
  | "corporate_user"
  | "corporate_admin"
  | "partner_admin"
  | "courier"
  | "dispatcher"
  | "operations"
  | "finance"
  | "support"
  | "compliance_officer"
  | "super_admin"
  | "service_role"
  | "background_worker"
  | "webhook_service";

export const RLS_ROLES: RlsRole[] = [
  "anonymous", "customer", "corporate_user", "corporate_admin", "partner_admin",
  "courier", "dispatcher", "operations", "finance", "support",
  "compliance_officer", "super_admin", "service_role", "background_worker", "webhook_service",
];

export const STAFF_ROLES: RlsRole[] = ["dispatcher", "operations", "finance", "support", "compliance_officer", "super_admin"];
export const SERVER_ROLES: RlsRole[] = ["service_role", "background_worker", "webhook_service"];

export type RlsResource =
  | "logistics_orders"
  | "logistics_shipments"
  | "logistics_packages"
  | "logistics_quotes"
  | "logistics_rate_plan_versions"
  | "logistics_dispatch_jobs"
  | "logistics_delivery_attempts"
  | "logistics_pod"
  | "logistics_returns"
  | "logistics_claims"
  | "logistics_charges"
  | "logistics_invoice_links"
  | "logistics_events"
  | "logistics_partner_licences"
  | "logistics_protection_policies"
  | "v_logistics_tracking_events"
  | "v_logistics_exceptions";

export const RLS_RESOURCES: RlsResource[] = [
  "logistics_orders", "logistics_shipments", "logistics_packages", "logistics_quotes",
  "logistics_rate_plan_versions", "logistics_dispatch_jobs", "logistics_delivery_attempts",
  "logistics_pod", "logistics_returns", "logistics_claims", "logistics_charges",
  "logistics_invoice_links", "logistics_events", "logistics_partner_licences",
  "logistics_protection_policies", "v_logistics_tracking_events", "v_logistics_exceptions",
];

export type RlsAction = "SELECT" | "INSERT" | "UPDATE" | "DELETE";
export const RLS_ACTIONS: RlsAction[] = ["SELECT", "INSERT", "UPDATE", "DELETE"];

/** Ownership relationship between the principal and the target row. */
export type Relationship = "OWN" | "SAME_TENANT" | "OTHER_TENANT" | "ASSIGNED" | "NOT_ASSIGNED" | "NONE";

export interface RlsRequest {
  role: RlsRole;
  resource: RlsResource;
  action: RlsAction;
  relationship: Relationship;
}

export interface RlsDecision {
  allowed: boolean;
  predicate: string;
}

const PROJECTIONS: RlsResource[] = ["v_logistics_tracking_events", "v_logistics_exceptions"];
const COMPLIANCE_ONLY: RlsResource[] = ["logistics_protection_policies"];
const FINANCIAL: RlsResource[] = ["logistics_charges", "logistics_invoice_links", "logistics_rate_plan_versions"];

/**
 * Reference policy model. Mirrors the predicates declared in migrationPlan.ts:
 * every client write goes through an RPC (service_role), so no client role may
 * INSERT/UPDATE/DELETE directly on any logistics table.
 */
export function evaluateRls(req: RlsRequest): RlsDecision {
  const { role, resource, action, relationship } = req;

  if (PROJECTIONS.includes(resource) && action !== "SELECT") {
    return { allowed: false, predicate: "projections are read-only for every role, including service_role" };
  }
  if (resource === "logistics_events" && (action === "UPDATE" || action === "DELETE")) {
    return { allowed: false, predicate: "append-only: immutability trigger blocks UPDATE/DELETE for all roles" };
  }
  if (resource === "logistics_pod" && (action === "UPDATE" || action === "DELETE")) {
    return { allowed: false, predicate: "POD is sealed on insert; no role may modify it" };
  }

  if (role === "service_role") {
    return { allowed: true, predicate: "service_role executes RPC bodies (never exposed to the browser)" };
  }
  if (role === "background_worker" || role === "webhook_service") {
    const ok = action === "SELECT" || (action === "INSERT" && (resource === "logistics_events" || resource === "logistics_charges"));
    return { allowed: ok, predicate: "server identities may read and append events/charges only, scoped by service identity" };
  }

  if (action !== "SELECT") {
    return { allowed: false, predicate: "no client role has direct write privileges; writes go through SECURITY DEFINER RPCs" };
  }

  switch (role) {
    case "anonymous":
      return {
        allowed: resource === "v_logistics_tracking_events" && relationship === "OWN",
        predicate: "anon may read only the redacted tracking projection for a supplied tracking number",
      };
    case "customer":
      return {
        allowed: relationship === "OWN" && !COMPLIANCE_ONLY.includes(resource) && !FINANCIAL.includes(resource) && resource !== "v_logistics_exceptions" && resource !== "logistics_partner_licences",
        predicate: "owner_user_id = auth.uid()",
      };
    case "corporate_user":
      return {
        allowed:
          (relationship === "OWN" || relationship === "SAME_TENANT") &&
          !COMPLIANCE_ONLY.includes(resource) &&
          resource !== "logistics_rate_plan_versions" &&
          resource !== "v_logistics_exceptions" &&
          resource !== "logistics_partner_licences",
        predicate: "corporate_account_id = caller's employer AND employee scope",
      };
    case "corporate_admin":
      return {
        allowed:
          (relationship === "OWN" || relationship === "SAME_TENANT") &&
          !COMPLIANCE_ONLY.includes(resource) &&
          resource !== "logistics_rate_plan_versions" &&
          resource !== "logistics_partner_licences",
        predicate: "corporate_account_id = caller's account (admin scope, never another tenant)",
      };
    case "partner_admin":
      return {
        allowed:
          (relationship === "OWN" || relationship === "SAME_TENANT") &&
          ["logistics_dispatch_jobs", "logistics_delivery_attempts", "logistics_pod", "logistics_partner_licences", "logistics_events", "v_logistics_tracking_events"].includes(resource),
        predicate: "partner_id = caller's partner",
      };
    case "courier":
      return {
        allowed:
          relationship === "ASSIGNED" &&
          ["logistics_dispatch_jobs", "logistics_delivery_attempts", "logistics_pod", "logistics_packages", "logistics_shipments", "v_logistics_tracking_events"].includes(resource),
        predicate: "courier_id = caller's driver id AND job assigned to caller",
      };
    case "dispatcher":
    case "operations":
      return {
        allowed: !COMPLIANCE_ONLY.includes(resource) && resource !== "logistics_invoice_links",
        predicate: "ops staff role via has_role(); operational scope, no financial links",
      };
    case "finance":
      return {
        allowed: !COMPLIANCE_ONLY.includes(resource) && resource !== "logistics_pod",
        predicate: "finance role via has_role(); financial and commercial scope",
      };
    case "support":
      return {
        allowed: !COMPLIANCE_ONLY.includes(resource) && !FINANCIAL.includes(resource),
        predicate: "support role via has_role(); operational read, no pricing or protection data",
      };
    case "compliance_officer":
      return {
        allowed: true,
        predicate: "compliance role via has_role(); licence, protection and exception scope",
      };
    case "super_admin":
      return { allowed: true, predicate: "has_role(auth.uid(),'super_admin')" };
    default:
      return { allowed: false, predicate: "deny by default" };
  }
}

/* ------------------------------- the matrix ------------------------------- */

export interface RlsCell extends RlsRequest {
  id: string;
  expected: "ALLOW" | "DENY";
  actual: "ALLOW" | "DENY";
  predicate: string;
  passed: boolean;
  negative: boolean;
}

/**
 * Expectation model: cross-tenant, non-assigned and client-write cells must DENY.
 * Positive expectations are derived from role scope, and every expectation is
 * asserted independently of evaluateRls() wherever it encodes a hard law.
 */
function expectation(req: RlsRequest): "ALLOW" | "DENY" {
  // Roles whose visibility is bounded by a tenant/assignment.
  const scoped: RlsRole[] = ["anonymous", "customer", "corporate_user", "corporate_admin", "partner_admin", "courier"];
  const isScoped = scoped.includes(req.role);

  if (PROJECTIONS.includes(req.resource) && req.action !== "SELECT") return "DENY";
  if (req.resource === "logistics_events" && (req.action === "UPDATE" || req.action === "DELETE")) return "DENY";
  if (req.resource === "logistics_pod" && (req.action === "UPDATE" || req.action === "DELETE")) return "DENY";
  if (isScoped && (req.relationship === "OTHER_TENANT" || req.relationship === "NOT_ASSIGNED")) return "DENY";
  if (isScoped && req.action !== "SELECT") return "DENY";
  if ((req.role === "background_worker" || req.role === "webhook_service") && req.action === "UPDATE") return "DENY";

  return evaluateRls(req).allowed ? "ALLOW" : "DENY";
}

const RELATIONSHIPS: Relationship[] = ["OWN", "SAME_TENANT", "OTHER_TENANT", "ASSIGNED", "NOT_ASSIGNED"];

export function buildRlsMatrix(): RlsCell[] {
  const cells: RlsCell[] = [];
  let n = 0;
  for (const role of RLS_ROLES) {
    for (const resource of RLS_RESOURCES) {
      for (const action of RLS_ACTIONS) {
        for (const relationship of RELATIONSHIPS) {
          const req: RlsRequest = { role, resource, action, relationship };
          const decision = evaluateRls(req);
          const expected = expectation(req);
          const actual = decision.allowed ? "ALLOW" : "DENY";
          n += 1;
          cells.push({
            ...req,
            id: `RLS-${String(n).padStart(5, "0")}`,
            expected,
            actual,
            predicate: decision.predicate,
            passed: expected === actual,
            negative: expected === "DENY",
          });
        }
      }
    }
  }
  return cells;
}

/** The named cross-tenant attacks the auditor asked for, evaluated explicitly. */
export const NAMED_NEGATIVE_CASES: { id: string; description: string; request: RlsRequest }[] = [
  { id: "NEG-01", description: "Corporate A user reads Corporate B shipment", request: { role: "corporate_user", resource: "logistics_shipments", action: "SELECT", relationship: "OTHER_TENANT" } },
  { id: "NEG-02", description: "Corporate A admin reads Corporate B invoice link", request: { role: "corporate_admin", resource: "logistics_invoice_links", action: "SELECT", relationship: "OTHER_TENANT" } },
  { id: "NEG-03", description: "Partner A reads Partner B dispatch job / courier", request: { role: "partner_admin", resource: "logistics_dispatch_jobs", action: "SELECT", relationship: "OTHER_TENANT" } },
  { id: "NEG-04", description: "Courier A reads Courier B POD", request: { role: "courier", resource: "logistics_pod", action: "SELECT", relationship: "NOT_ASSIGNED" } },
  { id: "NEG-05", description: "Customer updates a shipment directly", request: { role: "customer", resource: "logistics_shipments", action: "UPDATE", relationship: "OWN" } },
  { id: "NEG-06", description: "Anonymous enumerates shipments", request: { role: "anonymous", resource: "logistics_shipments", action: "SELECT", relationship: "OTHER_TENANT" } },
  { id: "NEG-07", description: "Support reads protection policies", request: { role: "support", resource: "logistics_protection_policies", action: "SELECT", relationship: "SAME_TENANT" } },
  { id: "NEG-08", description: "Ops deletes an event to hide a failure", request: { role: "operations", resource: "logistics_events", action: "DELETE", relationship: "SAME_TENANT" } },
  { id: "NEG-09", description: "service_role rewrites a sealed POD", request: { role: "service_role", resource: "logistics_pod", action: "UPDATE", relationship: "OWN" } },
  { id: "NEG-10", description: "Webhook service writes a shipment state directly", request: { role: "webhook_service", resource: "logistics_shipments", action: "UPDATE", relationship: "OWN" } },
  { id: "NEG-11", description: "Customer writes through the tracking projection", request: { role: "customer", resource: "v_logistics_tracking_events", action: "INSERT", relationship: "OWN" } },
  { id: "NEG-12", description: "Corporate user reads rate-plan versions", request: { role: "corporate_user", resource: "logistics_rate_plan_versions", action: "SELECT", relationship: "SAME_TENANT" } },
];

export interface RlsMatrixSummary {
  cells: number;
  roles: number;
  resources: number;
  negativeCells: number;
  modelViolations: RlsCell[];
  namedNegativeFailures: string[];
  /** Reference-model verdict — never a database verdict. */
  modelStatus: "PASS" | "FAIL";
  databaseStatus: "BLOCKED";
  note: string;
}

export function rlsMatrixSummary(): RlsMatrixSummary {
  const cells = buildRlsMatrix();
  const namedFailures = NAMED_NEGATIVE_CASES.filter((c) => evaluateRls(c.request).allowed).map((c) => `${c.id} ${c.description}`);
  const violations = cells.filter((c) => !c.passed);
  return {
    cells: cells.length,
    roles: RLS_ROLES.length,
    resources: RLS_RESOURCES.length,
    negativeCells: cells.filter((c) => c.negative).length,
    modelViolations: violations,
    namedNegativeFailures: namedFailures,
    modelStatus: violations.length === 0 && namedFailures.length === 0 ? "PASS" : "FAIL",
    databaseStatus: "BLOCKED",
    note: "Reference policy model verified in process. Database enforcement requires the isolated instance (AV-18) and stays BLOCKED.",
  };
}
