/**
 * DF-10 adversarial test matrices — cross-tenant isolation, SECURITY DEFINER
 * RPC authority, forbidden transitions, concurrency and idempotency.
 *
 * These matrices are the *specification of the attack*, with an explicit
 * execution status. A scenario is only PASS when it was actually executed
 * against a database. Code existence, typecheck and unit tests never produce a
 * PASS here — they produce SPECIFIED.
 */
import { NEW_RPCS } from "./migrationPlan";
import { STATE_MACHINES, MachineKey, Actor } from "./stateMachines";

export type ExecutionStatus = "PASS" | "FAIL" | "SPECIFIED" | "BLOCKED";

export const EXECUTION_BLOCKER =
  "No isolated (staging) database exists. Executing these probes against production would require writing operational rows, which the DF-10 gate forbids.";

/* --------------------------- cross-tenant matrix --------------------------- */

export type Principal =
  | "anon"
  | "customer_a"
  | "customer_b"
  | "corporate_a_admin"
  | "corporate_b_admin"
  | "courier_a"
  | "courier_b"
  | "partner_a_user"
  | "partner_b_user"
  | "ops"
  | "dispatcher"
  | "finance"
  | "support"
  | "admin"
  | "service_role";

export const PRINCIPALS: Principal[] = [
  "anon", "customer_a", "customer_b", "corporate_a_admin", "corporate_b_admin",
  "courier_a", "courier_b", "partner_a_user", "partner_b_user",
  "ops", "dispatcher", "finance", "support", "admin", "service_role",
];

export interface TenantScenario {
  id: string;
  principal: Principal;
  target: string;
  path: "DB_DIRECT" | "RLS_SELECT" | "RPC" | "REST_API";
  expectation: "ALLOW" | "DENY";
  status: ExecutionStatus;
  note: string;
}

const t = (
  id: string,
  principal: Principal,
  target: string,
  path: TenantScenario["path"],
  expectation: TenantScenario["expectation"],
  note: string,
): TenantScenario => ({ id, principal, target, path, expectation, status: "SPECIFIED", note });

export const CROSS_TENANT_MATRIX: TenantScenario[] = [
  t("XT-01", "customer_a", "own shipment A", "RLS_SELECT", "ALLOW", "owner_user_id = auth.uid()"),
  t("XT-02", "customer_a", "customer B shipment", "RLS_SELECT", "DENY", "no predicate branch matches"),
  t("XT-03", "customer_a", "customer B shipment via logistics_transition RPC", "RPC", "DENY", "RPC re-checks ownership inside the definer body"),
  t("XT-04", "customer_b", "customer A POD", "RLS_SELECT", "DENY", "POD visible only through the owning attempt→stop→shipment chain"),
  t("XT-05", "customer_a", "own POD", "RLS_SELECT", "ALLOW", "chain resolves to owner"),
  t("XT-06", "corporate_a_admin", "corporate A shipments", "RLS_SELECT", "ALLOW", "corporate membership predicate"),
  t("XT-07", "corporate_a_admin", "corporate B shipments", "RLS_SELECT", "DENY", "membership is per corporate_account_id"),
  t("XT-08", "corporate_a_admin", "corporate B invoice line", "REST_API", "DENY", "existing corporate RLS + new shipment link"),
  t("XT-09", "partner_a_user", "partner A dispatch jobs", "RLS_SELECT", "ALLOW", "partner membership predicate"),
  t("XT-10", "partner_a_user", "partner B dispatch jobs", "RLS_SELECT", "DENY", "partner_id scoping"),
  t("XT-11", "partner_a_user", "accept partner B job via RPC", "RPC", "DENY", "logistics_accept_dispatch_job validates partner membership"),
  t("XT-12", "courier_a", "jobs assigned to courier A", "RLS_SELECT", "ALLOW", "courier_id = caller driver id"),
  t("XT-13", "courier_a", "unassigned/other courier jobs", "RLS_SELECT", "DENY", "no open-pool read; offers are pushed"),
  t("XT-14", "courier_a", "accept courier B's offered job", "RPC", "DENY", "offer ownership check"),
  t("XT-15", "courier_a", "submit POD for a job not assigned to them", "RPC", "DENY", "logistics_submit_pod validates assignment"),
  t("XT-16", "customer_a", "create POD directly", "DB_DIRECT", "DENY", "no INSERT grant on logistics_pod for client roles"),
  t("XT-17", "customer_a", "UPDATE shipment status directly", "DB_DIRECT", "DENY", "no UPDATE grant; transition RPC only"),
  t("XT-18", "customer_a", "open claim on another customer's shipment", "RPC", "DENY", "tenant validation in claim RPC"),
  t("XT-19", "customer_a", "change payment state", "DB_DIRECT", "DENY", "payment writes are service_role/provider-callback only"),
  t("XT-20", "customer_a", "modify compliance/licence record", "DB_DIRECT", "DENY", "compliance writes restricted to compliance role via RPC"),
  t("XT-21", "anon", "any logistics operational table", "RLS_SELECT", "DENY", "only v_logistics_public_catalogue is anon-readable"),
  t("XT-22", "anon", "v_logistics_public_catalogue", "RLS_SELECT", "ALLOW", "commitment-filtered projection"),
  t("XT-23", "support", "shipment read (any tenant)", "RLS_SELECT", "ALLOW", "support role read-only, audited"),
  t("XT-24", "support", "shipment transition", "RPC", "DENY", "support is not an actor in any machine"),
  t("XT-25", "finance", "payment/settlement read", "RLS_SELECT", "ALLOW", "finance scope"),
  t("XT-26", "finance", "dispatch transition", "RPC", "DENY", "not a dispatch actor"),
  t("XT-27", "dispatcher", "reassign job in own operating region", "RPC", "ALLOW", "dispatcher actor"),
  t("XT-28", "admin", "delete a logistics event", "DB_DIRECT", "DENY", "append-only trigger applies to every role except migration owner"),
  t("XT-29", "service_role", "append event", "RPC", "ALLOW", "logistics_append_event is service_role only"),
  t("XT-30", "customer_a", "call logistics_append_event", "RPC", "DENY", "not granted to authenticated"),
];

/* ----------------------- SECURITY DEFINER RPC audit ----------------------- */

export interface RpcAuditRow {
  rpc: string;
  callerRoles: string[];
  requiredPermission: string;
  inputValidation: string[];
  tenantValidation: string;
  stateValidation: string;
  sideEffects: string[];
  tablesTouched: string[];
  searchPathPinned: boolean;
  idempotent: boolean;
  /** Adversarial probes defined for this RPC. */
  probes: string[];
  status: ExecutionStatus;
}

export const RPC_AUDIT: RpcAuditRow[] = [
  {
    rpc: "logistics_book_shipment",
    callerRoles: ["authenticated"],
    requiredPermission: "owner of the order, or member of the corporate account on the order",
    inputValidation: ["quote_id uuid exists and not expired", "idempotency_key non-empty", "offering code bookable", "restricted-goods declaration present"],
    tenantValidation: "order.owner_user_id = auth.uid() OR corporate membership; corporate_account_id may not be supplied by the client",
    stateValidation: "shipment must be QUOTED; evaluateTransition(QUOTED→BOOKED) with actor derived server-side",
    sideEffects: ["insert shipment", "insert packages", "append BOOKING_CONFIRMED event"],
    tablesTouched: ["logistics_shipments", "logistics_packages", "logistics_events"],
    searchPathPinned: true,
    idempotent: true,
    probes: ["call with another tenant's quote_id", "replay same idempotency_key", "supply corporate_account_id of another org", "book a non-bookable offering", "book an expired quote"],
    status: "SPECIFIED",
  },
  {
    rpc: "logistics_create_dispatch_job",
    callerRoles: ["authenticated (ops/dispatcher role required)"],
    requiredPermission: "has_any_role(ops, dispatcher)",
    inputValidation: ["shipment_id exists", "stop set non-empty", "idempotency_key"],
    tenantValidation: "staff scope only; shipment tenant recorded, not chosen by caller",
    stateValidation: "shipment READY_FOR_DISPATCH; eligibility gate must return ELIGIBLE",
    sideEffects: ["insert dispatch job", "append DISPATCH_CREATED event"],
    tablesTouched: ["logistics_dispatch_jobs", "logistics_events"],
    searchPathPinned: true,
    idempotent: true,
    probes: ["call as customer", "call as partner user", "create job for shipment in DRAFT", "create job for partner with expired licence"],
    status: "SPECIFIED",
  },
  {
    rpc: "logistics_accept_dispatch_job",
    callerRoles: ["authenticated (courier/partner)"],
    requiredPermission: "courier assigned to the offer, or partner member of the offered partner",
    inputValidation: ["job_id", "offer token/version", "idempotency_key"],
    tenantValidation: "job.courier_id resolves to caller's driver row OR job.partner_id in caller's partner memberships",
    stateValidation: "job must be OFFERED and the offer unexpired; single-winner acceptance under row lock",
    sideEffects: ["set ACCEPTED", "append DISPATCH_ACCEPTED event", "expire sibling offers"],
    tablesTouched: ["logistics_dispatch_jobs", "logistics_events"],
    searchPathPinned: true,
    idempotent: true,
    probes: ["two couriers accept simultaneously", "accept after expiry", "accept another courier's offer", "accept twice with same key", "accept twice with different keys"],
    status: "SPECIFIED",
  },
  {
    rpc: "logistics_transition",
    callerRoles: ["authenticated"],
    requiredPermission: "actor derived from caller's roles must appear in the transition's actors",
    inputValidation: ["machine key", "aggregate_id", "expected_current_state (optimistic concurrency)", "reason_code when required", "idempotency_key"],
    tenantValidation: "aggregate must be visible to caller under the same predicate as its RLS SELECT policy",
    stateValidation: "transition must exist in STATE_MACHINES; guards evaluated server-side; stale expected_current_state rejected",
    sideEffects: ["update aggregate status", "append transition event", "run declared effects"],
    tablesTouched: ["all logistics aggregates", "logistics_events"],
    searchPathPinned: true,
    idempotent: true,
    probes: ["customer attempts IN_EXECUTION→DELIVERED", "courier transitions foreign job", "transition with stale expected state", "unknown transition pair", "missing reason_code on failure", "concurrent duplicate transition"],
    status: "SPECIFIED",
  },
  {
    rpc: "logistics_submit_pod",
    callerRoles: ["authenticated (courier)"],
    requiredPermission: "courier assigned to the delivery attempt",
    inputValidation: ["attempt_id", "evidence hash", "captured_at", "idempotency_key"],
    tenantValidation: "attempt → dispatch job → courier_id must equal caller",
    stateValidation: "attempt must be ATTEMPTED; POD may be sealed once",
    sideEffects: ["insert immutable POD row", "append POD_CREATED event"],
    tablesTouched: ["logistics_pod", "logistics_delivery_attempts", "logistics_events"],
    searchPathPinned: true,
    idempotent: true,
    probes: ["submit POD for foreign attempt", "submit second POD for same attempt", "submit POD for a FAILED attempt", "replay POD upload", "forge evidence hash mismatch"],
    status: "SPECIFIED",
  },
  {
    rpc: "logistics_append_event",
    callerRoles: ["service_role"],
    requiredPermission: "service_role only — never granted to authenticated or anon",
    inputValidation: ["full event envelope (12 required fields)", "correlation_id format", "unique idempotency_key"],
    tenantValidation: "aggregate existence check; actor recorded, never trusted as authority",
    stateValidation: "n/a (append-only writer)",
    sideEffects: ["insert event row only"],
    tablesTouched: ["logistics_events"],
    searchPathPinned: true,
    idempotent: true,
    probes: ["call as authenticated", "call as anon", "duplicate idempotency_key", "attempt UPDATE/DELETE on events", "malformed correlation_id"],
    status: "SPECIFIED",
  },
  {
    rpc: "logistics_evaluate_dispatch_eligibility",
    callerRoles: ["authenticated (ops/dispatcher)"],
    requiredPermission: "has_any_role(ops, dispatcher)",
    inputValidation: ["partner_id", "courier_id", "vehicle_id", "offering code"],
    tenantValidation: "read-only evaluation; returns no third-party PII, only pass/fail reasons",
    stateValidation: "n/a",
    sideEffects: ["none (pure read)"],
    tablesTouched: ["partners", "drivers", "vehicles", "logistics_partner_licences", "logistics_protection_policies"],
    searchPathPinned: true,
    idempotent: true,
    probes: ["call as customer to enumerate couriers", "call with demo/seed partner", "call with expired licence to confirm INELIGIBLE"],
    status: "SPECIFIED",
  },
  {
    rpc: "logistics_quote_issue",
    callerRoles: ["authenticated"],
    requiredPermission: "customer, corporate member, or commercial staff",
    inputValidation: ["offering bookable/estimable", "pricing inputs complete", "rate-plan version in force", "idempotency_key"],
    tenantValidation: "owner_user_id and corporate_account_id derived from the session, never from params",
    stateValidation: "quote created DRAFT→ISSUED only; expiry mandatory",
    sideEffects: ["insert quote with frozen snapshot", "append QUOTE_CREATED event"],
    tablesTouched: ["logistics_quotes", "logistics_rate_plan_versions", "logistics_events"],
    searchPathPinned: true,
    idempotent: true,
    probes: ["issue a quote for another tenant", "force a superseded rate-plan version", "omit expiry", "replay key"],
    status: "SPECIFIED",
  },
  {
    rpc: "logistics_accept_quote",
    callerRoles: ["authenticated"],
    requiredPermission: "quote owner or corporate admin of the quote's account",
    inputValidation: ["quote ISSUED", "not expired", "snapshot hash present", "idempotency_key"],
    tenantValidation: "acceptance authority checked against the quote's tenant",
    stateValidation: "ISSUED→ACCEPTED only; snapshot frozen by trigger",
    sideEffects: ["set accepted_at/accepted_by", "append QUOTE_ACCEPTED event"],
    tablesTouched: ["logistics_quotes", "logistics_events"],
    searchPathPinned: true,
    idempotent: true,
    probes: ["accept another tenant's quote", "accept an expired quote", "edit the rate plan then re-read the agreed amount", "double acceptance"],
    status: "SPECIFIED",
  },
  {
    rpc: "logistics_open_return",
    callerRoles: ["authenticated"],
    requiredPermission: "shipment owner, corporate admin, support or ops",
    inputValidation: ["shipment exists", "reason_code from catalogue", "idempotency_key"],
    tenantValidation: "shipment tenant must match the caller unless staff",
    stateValidation: "return is a sibling aggregate; shipment status is never overwritten",
    sideEffects: ["insert return", "append RETURN_REQUESTED event"],
    tablesTouched: ["logistics_returns", "logistics_events"],
    searchPathPinned: true,
    idempotent: true,
    probes: ["open a return on another tenant's shipment", "duplicate return", "narrative-only reason"],
    status: "SPECIFIED",
  },
  {
    rpc: "logistics_open_claim",
    callerRoles: ["authenticated"],
    requiredPermission: "claimant, corporate admin, support or compliance",
    inputValidation: ["claim candidate exists", "eligibility review recorded", "protection policy in force", "idempotency_key"],
    tenantValidation: "claimant scope enforced; compliance may act cross-tenant",
    stateValidation: "CLAIM_CANDIDATE→CLAIM_OPENED requires review; never automatic",
    sideEffects: ["insert claim", "append CLAIM_OPENED event"],
    tablesTouched: ["logistics_claims", "logistics_protection_policies", "logistics_events"],
    searchPathPinned: true,
    idempotent: true,
    probes: ["open a claim without eligibility review", "claim with no protection policy", "customer approves own claim", "duplicate claim"],
    status: "SPECIFIED",
  },
  {
    rpc: "logistics_evaluate_billing",
    callerRoles: ["authenticated (finance/ops)"],
    requiredPermission: "has_any_role(finance, ops)",
    inputValidation: ["shipment delivered/partially delivered", "contract resolved", "rate-plan version pinned"],
    tenantValidation: "charges written against the shipment's tenant only",
    stateValidation: "delivery outcome is an input, never a billing conclusion",
    sideEffects: ["insert charges", "insert invoice link", "append CHARGE_RAISED event"],
    tablesTouched: ["logistics_charges", "logistics_invoice_links", "logistics_events"],
    searchPathPinned: true,
    idempotent: true,
    probes: ["bill a pending shipment", "bill twice with the same key", "force billable_units above delivered outcomes", "bill a failed package without contract authority"],
    status: "SPECIFIED",
  },
];


export function rpcAuditCoverage(): { covered: string[]; uncovered: string[] } {
  const audited = new Set(RPC_AUDIT.map((r) => r.rpc));
  return {
    covered: NEW_RPCS.filter((r) => audited.has(r.name)).map((r) => r.name),
    uncovered: NEW_RPCS.filter((r) => !audited.has(r.name)).map((r) => r.name),
  };
}

/* --------------------- forbidden transition enumeration --------------------- */

export interface ForbiddenTransition {
  machine: MachineKey;
  from: string;
  to: string;
  reason: "NO_SUCH_TRANSITION" | "ACTOR_NOT_PERMITTED";
  actor?: Actor;
}

/** Every state pair that is NOT a declared transition must be rejected. */
export function enumerateForbiddenTransitions(): ForbiddenTransition[] {
  const out: ForbiddenTransition[] = [];
  for (const m of Object.values(STATE_MACHINES)) {
    const legal = new Set(m.transitions.map((tr) => `${tr.from}→${tr.to}`));
    for (const from of m.states) {
      for (const to of m.states) {
        if (from === to) continue;
        if (!legal.has(`${from}→${to}`)) {
          out.push({ machine: m.key, from, to, reason: "NO_SUCH_TRANSITION" });
        }
      }
    }
  }
  return out;
}

/** Actor-scoped negative cases that must be rejected even on a legal edge. */
export const FORBIDDEN_ACTOR_TRANSITIONS: ForbiddenTransition[] = [
  { machine: "SHIPMENT", from: "IN_EXECUTION", to: "DELIVERED", reason: "ACTOR_NOT_PERMITTED", actor: "customer" },
  { machine: "SHIPMENT", from: "IN_EXECUTION", to: "DELIVERED", reason: "ACTOR_NOT_PERMITTED", actor: "courier" },
  { machine: "DISPATCH_JOB", from: "OFFERED", to: "ACCEPTED", reason: "ACTOR_NOT_PERMITTED", actor: "customer" },
  { machine: "DELIVERY_ATTEMPT", from: "ATTEMPTED", to: "SUCCESSFUL", reason: "ACTOR_NOT_PERMITTED", actor: "customer" },
  { machine: "PAYMENT", from: "PAYMENT_PENDING", to: "CAPTURED", reason: "ACTOR_NOT_PERMITTED", actor: "customer" },
  { machine: "CLAIM", from: "OPEN", to: "APPROVED", reason: "ACTOR_NOT_PERMITTED", actor: "customer" },
];

/* ------------------------------- concurrency ------------------------------- */

export interface ConcurrencyScenario {
  id: string;
  scenario: string;
  contenders: number;
  requiredEffect: string;
  control: string;
  priority: "P0" | "P1";
  status: ExecutionStatus;
}

export const CONCURRENCY_MATRIX: ConcurrencyScenario[] = [
  { id: "CC-01", scenario: "Two couriers accept the same offered dispatch job simultaneously", contenders: 2, requiredEffect: "exactly one ACCEPTED; loser receives 409 offer_taken", control: "SELECT … FOR UPDATE on the job row + status guard inside the same transaction", priority: "P0", status: "SPECIFIED" },
  { id: "CC-02", scenario: "Dispatcher assignment races courier self-acceptance", contenders: 2, requiredEffect: "one authoritative assignment, no orphan job", control: "row lock + expected_current_state check", priority: "P0", status: "SPECIFIED" },
  { id: "CC-03", scenario: "M-Pesa callback and client-side retry arrive together", contenders: 2, requiredEffect: "one payment state change, one ledger entry", control: "unique idempotency_key on payment_attempts + advisory lock per order", priority: "P0", status: "SPECIFIED" },
  { id: "CC-04", scenario: "Provider webhook replayed 5×", contenders: 5, requiredEffect: "one capture, one settlement event", control: "unique (provider, provider_ref) + append-only event key", priority: "P0", status: "SPECIFIED" },
  { id: "CC-05", scenario: "Duplicate POD submission from a flaky mobile connection", contenders: 3, requiredEffect: "one sealed POD; replays return the original", control: "unique(attempt_id) on logistics_pod + idempotent RPC replay", priority: "P0", status: "SPECIFIED" },
  { id: "CC-06", scenario: "Two concurrent identical transitions on the same aggregate", contenders: 2, requiredEffect: "one state change, one event", control: "optimistic expected_current_state + unique event idempotency_key", priority: "P0", status: "SPECIFIED" },
  { id: "CC-07", scenario: "Parallel booking submissions of the same quote", contenders: 8, requiredEffect: "one shipment", control: "charter-style idempotency reservation (proven pattern in charter-idempotency)", priority: "P0", status: "SPECIFIED" },
  { id: "CC-08", scenario: "Simultaneous return request and claim opening", contenders: 2, requiredEffect: "both recorded as sibling aggregates without corrupting shipment status", control: "no shared mutable status column", priority: "P1", status: "SPECIFIED" },
];

/* ------------------------------- idempotency ------------------------------- */

export interface IdempotencyScenario {
  id: string;
  command: string;
  duplicateKind: "SAME_KEY_SAME_PAYLOAD" | "SAME_KEY_DIFFERENT_PAYLOAD" | "NO_KEY";
  requiredOutcome: string;
  status: ExecutionStatus;
}

export const IDEMPOTENCY_MATRIX: IdempotencyScenario[] = [
  { id: "ID-01", command: "booking request", duplicateKind: "SAME_KEY_SAME_PAYLOAD", requiredOutcome: "replay original confirmation, one shipment", status: "SPECIFIED" },
  { id: "ID-02", command: "booking request", duplicateKind: "SAME_KEY_DIFFERENT_PAYLOAD", requiredOutcome: "409 idempotency_conflict, no second shipment", status: "SPECIFIED" },
  { id: "ID-03", command: "payment callback", duplicateKind: "SAME_KEY_SAME_PAYLOAD", requiredOutcome: "one capture, one ledger entry", status: "SPECIFIED" },
  { id: "ID-04", command: "dispatch job creation", duplicateKind: "SAME_KEY_SAME_PAYLOAD", requiredOutcome: "one job", status: "SPECIFIED" },
  { id: "ID-05", command: "dispatch acceptance", duplicateKind: "SAME_KEY_SAME_PAYLOAD", requiredOutcome: "idempotent ACCEPTED, single event", status: "SPECIFIED" },
  { id: "ID-06", command: "POD upload", duplicateKind: "SAME_KEY_SAME_PAYLOAD", requiredOutcome: "original POD returned, no second seal", status: "SPECIFIED" },
  { id: "ID-07", command: "return request", duplicateKind: "SAME_KEY_SAME_PAYLOAD", requiredOutcome: "one return aggregate", status: "SPECIFIED" },
  { id: "ID-08", command: "claim request", duplicateKind: "SAME_KEY_SAME_PAYLOAD", requiredOutcome: "one claim", status: "SPECIFIED" },
  { id: "ID-09", command: "any command RPC", duplicateKind: "NO_KEY", requiredOutcome: "rejected with idempotency_key_required", status: "SPECIFIED" },
];

/* ------------------------------ backup/restore ------------------------------ */

export interface RestoreStep {
  step: string;
  status: ExecutionStatus;
  evidence: string;
}

export const RESTORE_VALIDATION: RestoreStep[] = [
  { step: "backup exists", status: "SPECIFIED", evidence: "Managed platform backups are configured; existence alone is explicitly NOT a restore pass." },
  { step: "restore into isolated instance succeeds", status: "BLOCKED", evidence: EXECUTION_BLOCKER },
  { step: "application connects to restored instance", status: "BLOCKED", evidence: EXECUTION_BLOCKER },
  { step: "schema intact (table/column/constraint diff = 0)", status: "BLOCKED", evidence: EXECUTION_BLOCKER },
  { step: "row counts match per critical table", status: "BLOCKED", evidence: EXECUTION_BLOCKER },
  { step: "RLS policies intact and enforced", status: "BLOCKED", evidence: EXECUTION_BLOCKER },
  { step: "RPCs operate with pinned search_path", status: "BLOCKED", evidence: EXECUTION_BLOCKER },
  { step: "event stream intact and still append-only", status: "BLOCKED", evidence: EXECUTION_BLOCKER },
];

export function restoreVerified(): boolean {
  return RESTORE_VALIDATION.every((s) => s.status === "PASS");
}

/* --------------------------------- summary --------------------------------- */

export interface AdversarialSummary {
  crossTenant: { total: number; executed: number; denyExpected: number };
  rpcAudit: { rpcs: number; probes: number; uncovered: string[] };
  forbiddenTransitions: number;
  forbiddenActorCases: number;
  concurrency: { total: number; executed: number; p0: number };
  idempotency: { total: number; executed: number };
  restoreVerified: boolean;
  anyExecuted: boolean;
}

export function adversarialSummary(): AdversarialSummary {
  const executed = (s: { status: ExecutionStatus }) => s.status === "PASS";
  const coverage = rpcAuditCoverage();
  return {
    crossTenant: {
      total: CROSS_TENANT_MATRIX.length,
      executed: CROSS_TENANT_MATRIX.filter(executed).length,
      denyExpected: CROSS_TENANT_MATRIX.filter((s) => s.expectation === "DENY").length,
    },
    rpcAudit: {
      rpcs: RPC_AUDIT.length,
      probes: RPC_AUDIT.reduce((a, r) => a + r.probes.length, 0),
      uncovered: coverage.uncovered,
    },
    forbiddenTransitions: enumerateForbiddenTransitions().length,
    forbiddenActorCases: FORBIDDEN_ACTOR_TRANSITIONS.length,
    concurrency: {
      total: CONCURRENCY_MATRIX.length,
      executed: CONCURRENCY_MATRIX.filter(executed).length,
      p0: CONCURRENCY_MATRIX.filter((s) => s.priority === "P0").length,
    },
    idempotency: {
      total: IDEMPOTENCY_MATRIX.length,
      executed: IDEMPOTENCY_MATRIX.filter(executed).length,
    },
    restoreVerified: restoreVerified(),
    anyExecuted:
      CROSS_TENANT_MATRIX.some(executed) ||
      CONCURRENCY_MATRIX.some(executed) ||
      IDEMPOTENCY_MATRIX.some(executed),
  };
}
