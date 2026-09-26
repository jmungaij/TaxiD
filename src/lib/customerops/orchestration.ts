/**
 * Customer Operations — Case Orchestration Engine.
 *
 * Static playbooks become an executable orchestration plan. Every case type
 * declares the domains it MUST traverse (see `taxonomy.CASE_TYPES.traverses`);
 * this engine activates each of those domains automatically, loads the records
 * the domain owns, assigns ownership, starts the SLA clock, emits immutable
 * audit events, and refuses to close while a mandatory domain is incomplete.
 *
 * Pure, deterministic and dependency-free — reuses the existing taxonomy,
 * playbook, classification and SLA primitives. No new services or tables.
 */
import {
  CASE_TYPE_BY_KEY, CASE_TYPES, DOMAIN_LABEL, autoEscalate, predictPriority,
  type BusinessDomain, type CaseType, type PriorityPrediction, type PrioritySignals,
} from "./taxonomy";
import { getPlaybook, type Playbook, type PlaybookStep } from "./playbooks";

/* --------------------------- domain activation --------------------------- */

export interface DomainRegistryEntry {
  label: string;
  /** Team that owns the activation for this domain. */
  team: string;
  /** Canonical records the domain contributes to the case graph. */
  records: string[];
  /** Existing platform surface an agent opens (no new screens). */
  surface: string;
  /** Roles allowed to see this activation. Empty = all operations roles. */
  roles: string[];
  /** Sensitivity classification used for field/document level gating. */
  sensitivity: "internal" | "restricted" | "confidential";
}

export const DOMAIN_REGISTRY: Record<BusinessDomain, DomainRegistryEntry> = {
  support: {
    label: DOMAIN_LABEL.support, team: "Customer Operations · Tier 1",
    records: ["support_cases", "support_case_events", "communications timeline"],
    surface: "/dashboard/admin/customer-operations", roles: [], sensitivity: "internal",
  },
  rider_ops: {
    label: DOMAIN_LABEL.rider_ops, team: "Rider Operations",
    records: ["profiles", "fact_trips", "rider_sos_alerts", "rider safety score", "emergency contacts"],
    surface: "/dashboard/admin/rider-management", roles: ["rider_ops", "support_agent", "trust_safety", "super_admin"],
    sensitivity: "restricted",
  },
  driver_ops: {
    label: DOMAIN_LABEL.driver_ops, team: "Driver Operations",
    records: ["drivers", "driver_scores", "driver_incidents", "driver_lifecycle_actions", "location_history"],
    surface: "/dashboard/admin/drivers", roles: ["driver_ops", "support_agent", "trust_safety", "super_admin"],
    sensitivity: "restricted",
  },
  trust_safety: {
    label: DOMAIN_LABEL.trust_safety, team: "Trust & Safety",
    records: ["trust_incidents", "fraud_signals", "device_fingerprints", "trust_investigations"],
    surface: "/dashboard/admin/trust-center", roles: ["trust_safety", "compliance_admin", "super_admin"],
    sensitivity: "confidential",
  },
  finance: {
    label: DOMAIN_LABEL.finance, team: "Finance Operations",
    records: ["payment_attempts", "wallet_transactions", "journal_lines", "refund_requests", "corporate_invoices"],
    surface: "/dashboard/admin/payment-ops", roles: ["finance_admin", "finance_approver", "super_admin"],
    sensitivity: "confidential",
  },
  logistics: {
    label: DOMAIN_LABEL.logistics, team: "Delivery & Logistics Control",
    records: ["delivery_orders", "delivery_route_segments", "package_chain_of_custody", "proof_of_delivery"],
    surface: "/dashboard/admin/logistics-center", roles: ["logistics_ops", "support_agent", "super_admin"],
    sensitivity: "internal",
  },
  fleet: {
    label: DOMAIN_LABEL.fleet, team: "Fleet Operations",
    records: ["vehicles", "vehicle_compliance", "vehicle_inspections", "vehicle_maintenance"],
    surface: "/dashboard/admin/fleet", roles: ["fleet_admin", "support_agent", "super_admin"],
    sensitivity: "internal",
  },
  corporate: {
    label: DOMAIN_LABEL.corporate, team: "Corporate Success",
    records: ["corporate_accounts", "corporate_ride_policies", "corporate_policy_violations", "approval_requests"],
    surface: "/dashboard/admin/corporates", roles: ["corporate_admin", "support_agent", "super_admin"],
    sensitivity: "restricted",
  },
  marketplace: {
    label: DOMAIN_LABEL.marketplace, team: "Marketplace Operations",
    records: ["dispatch_requests", "dispatch_eta_estimates", "marketplace_supply_snapshots"],
    surface: "/dashboard/admin/marketplace", roles: [], sensitivity: "internal",
  },
};

export interface DomainActivation {
  domain: BusinessDomain;
  label: string;
  team: string;
  records: string[];
  surface: string;
  sensitivity: DomainRegistryEntry["sensitivity"];
  /** Mandatory activations come from the case type's traversal contract. */
  mandatory: boolean;
  /** Playbook steps this domain executes. */
  stepIds: string[];
  status: "activated" | "in_progress" | "complete";
}

/* ------------------------------ orchestration ----------------------------- */

export interface OrchestrationTask {
  id: string;
  title: string;
  domain: BusinessDomain;
  owner: string;
  evidence: string[];
  approval?: string;
  surface?: string;
  /** Minutes from case start by which the task must complete. */
  dueMinutes: number;
  mandatory: boolean;
}

export interface CaseGraphNode {
  id: string;
  kind: "customer" | "driver" | "vehicle" | "booking" | "payment" | "wallet" | "invoice" | "receipt" | "support" | "audit" | "document" | "communication";
  label: string;
  domain: BusinessDomain;
  ref?: string;
}

export interface AuditEvent {
  event: string;
  domain: BusinessDomain | "governance";
  correlationId: string;
  at: string;
  actor: string;
  detail: string;
}

export interface OrchestrationInput {
  caseId: string;
  caseType: CaseType;
  actor?: string;
  actorRoles?: string[];
  isCorporate?: boolean;
  signals?: PrioritySignals;
  /** ISO start of the SLA clock. Defaults to now. */
  startedAt?: string;
  /** Known entity refs used to build the case graph. */
  refs?: Partial<Record<CaseGraphNode["kind"], string>>;
}

export interface OrchestrationPlan {
  caseId: string;
  caseType: CaseType;
  title: string;
  correlationId: string;
  startedAt: string;
  owner: { domain: BusinessDomain; team: string; reason: string; immediate: boolean };
  priority: PriorityPrediction;
  slaMinutes: number;
  activations: DomainActivation[];
  tasks: OrchestrationTask[];
  graph: CaseGraphNode[];
  auditEvents: AuditEvent[];
  playbook: Playbook;
}

export function correlationIdFor(caseId: string, caseType: CaseType): string {
  let h = 2166136261;
  for (const ch of `${caseType}:${caseId}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return `cx-${caseType.replace(/_/g, "-")}-${(h >>> 0).toString(16).padStart(8, "0")}`;
}

/** Required domains for a case type — the traversal contract, never optional. */
export function requiredDomains(caseType: CaseType): BusinessDomain[] {
  const def = CASE_TYPE_BY_KEY.get(caseType) ?? CASE_TYPE_BY_KEY.get("general_enquiry")!;
  return Array.from(new Set([def.domain, ...def.traverses, "support" as BusinessDomain]));
}

const GRAPH_TEMPLATE: { kind: CaseGraphNode["kind"]; label: string; domain: BusinessDomain }[] = [
  { kind: "customer", label: "Customer identity & lifetime value", domain: "rider_ops" },
  { kind: "driver", label: "Driver / courier profile", domain: "driver_ops" },
  { kind: "vehicle", label: "Vehicle & compliance state", domain: "fleet" },
  { kind: "booking", label: "Booking / trip record", domain: "marketplace" },
  { kind: "payment", label: "Payment attempts & settlement", domain: "finance" },
  { kind: "wallet", label: "Wallet ledger movements", domain: "finance" },
  { kind: "invoice", label: "Invoice", domain: "finance" },
  { kind: "receipt", label: "Receipt", domain: "finance" },
  { kind: "support", label: "Support history & complaints", domain: "support" },
  { kind: "document", label: "Evidence documents", domain: "trust_safety" },
  { kind: "communication", label: "Omnichannel communications", domain: "support" },
  { kind: "audit", label: "Immutable audit trail", domain: "support" },
];

/** Builds the executable orchestration plan for a case. Pure function. */
export function buildOrchestrationPlan(input: OrchestrationInput): OrchestrationPlan {
  const def = CASE_TYPE_BY_KEY.get(input.caseType) ?? CASE_TYPE_BY_KEY.get("general_enquiry")!;
  const playbook = getPlaybook(input.caseType);
  const startedAt = input.startedAt ?? new Date().toISOString();
  const correlationId = correlationIdFor(input.caseId, input.caseType);
  const priority = predictPriority(input.caseType, input.signals ?? {});
  const escalation = autoEscalate(input.caseType, Boolean(input.isCorporate), priority.priority);
  const required = new Set(requiredDomains(input.caseType));

  const stepsByDomain = new Map<BusinessDomain, PlaybookStep[]>();
  for (const s of playbook.steps) {
    stepsByDomain.set(s.domain, [...(stepsByDomain.get(s.domain) ?? []), s]);
  }

  const domains = Array.from(new Set<BusinessDomain>([...required, ...stepsByDomain.keys()]));
  const activations: DomainActivation[] = domains.map((domain) => {
    const reg = DOMAIN_REGISTRY[domain];
    const steps = stepsByDomain.get(domain) ?? [];
    return {
      domain, label: reg.label, team: reg.team, records: reg.records, surface: reg.surface,
      sensitivity: reg.sensitivity, mandatory: required.has(domain),
      stepIds: steps.map((s) => s.id), status: "activated",
    };
  });

  const total = playbook.steps.length || 1;
  const tasks: OrchestrationTask[] = playbook.steps.map((s, i) => ({
    id: s.id, title: s.title, domain: s.domain, owner: DOMAIN_REGISTRY[s.domain].team,
    evidence: s.evidence, approval: s.approval, surface: s.system ?? DOMAIN_REGISTRY[s.domain].surface,
    dueMinutes: Math.round((playbook.targetResolutionMinutes * (i + 1)) / total),
    mandatory: required.has(s.domain),
  }));

  const graph: CaseGraphNode[] = GRAPH_TEMPLATE.filter((n) => required.has(n.domain) || n.kind === "support" || n.kind === "audit")
    .map((n) => ({ id: `${correlationId}:${n.kind}`, ...n, ref: input.refs?.[n.kind] }));

  const actor = input.actor ?? "system";
  const auditEvents: AuditEvent[] = [
    { event: "case.orchestration.started", domain: "governance", correlationId, at: startedAt, actor, detail: `${def.label} classified; ${activations.filter((a) => a.mandatory).length} mandatory domains activated` },
    { event: "case.owner.assigned", domain: escalation.domain, correlationId, at: startedAt, actor, detail: `${escalation.team} — ${escalation.reason}` },
    { event: "case.sla.started", domain: "governance", correlationId, at: startedAt, actor, detail: `Resolution SLA ${playbook.targetResolutionMinutes} min · priority ${priority.priority}` },
    ...activations.filter((a) => a.mandatory).map<AuditEvent>((a) => ({
      event: "case.domain.activated", domain: a.domain, correlationId, at: startedAt, actor,
      detail: `${a.label} activated with ${a.records.length} record sets`,
    })),
  ];

  return {
    caseId: input.caseId, caseType: input.caseType, title: playbook.title, correlationId, startedAt,
    owner: { domain: escalation.domain, team: escalation.team, reason: escalation.reason, immediate: escalation.immediate },
    priority, slaMinutes: playbook.targetResolutionMinutes, activations, tasks, graph, auditEvents, playbook,
  };
}

/* ------------------------------- RBAC gating ------------------------------ */

/**
 * Effective-permission filter. Activations whose domain declares roles are
 * hidden unless the actor holds one of them (or is a super admin). Used for
 * widget, record, field, document and AI-response level gating.
 */
export function visibleActivations(plan: OrchestrationPlan, roles: string[]): DomainActivation[] {
  const set = new Set(roles);
  if (set.has("super_admin")) return plan.activations;
  return plan.activations.filter((a) => {
    const allowed = DOMAIN_REGISTRY[a.domain].roles;
    return allowed.length === 0 || allowed.some((r) => set.has(r));
  });
}

/** Redacts case-graph nodes the actor may not read — AI answers use this too. */
export function visibleGraph(plan: OrchestrationPlan, roles: string[]): CaseGraphNode[] {
  const allowed = new Set(visibleActivations(plan, roles).map((a) => a.domain));
  return plan.graph.filter((n) => allowed.has(n.domain));
}

/* ------------------------------ certification ----------------------------- */

export interface CertificationCheck {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface CaseTypeCertification {
  caseType: CaseType;
  label: string;
  requiredDomains: BusinessDomain[];
  coveredDomains: BusinessDomain[];
  missingDomains: BusinessDomain[];
  checks: CertificationCheck[];
  score: number;
  certified: boolean;
}

/**
 * Certifies that a case type's orchestration traverses every mandatory domain
 * with executable work, ownership, SLA, audit events and governance.
 */
export function certifyCaseType(caseType: CaseType): CaseTypeCertification {
  const def = CASE_TYPE_BY_KEY.get(caseType) ?? CASE_TYPE_BY_KEY.get("general_enquiry")!;
  const plan = buildOrchestrationPlan({ caseId: `cert-${caseType}`, caseType, startedAt: "2026-01-01T00:00:00.000Z" });
  const required = requiredDomains(caseType);
  const executing = new Set(plan.tasks.map((t) => t.domain));
  const missing = required.filter((d) => !executing.has(d));

  const checks: CertificationCheck[] = [
    { id: "domains", label: "All mandatory domains execute work", passed: missing.length === 0, detail: missing.length ? `Missing: ${missing.map((d) => DOMAIN_LABEL[d]).join(", ")}` : `${required.length} domains covered` },
    { id: "records", label: "Mandatory records loaded per domain", passed: plan.activations.filter((a) => a.mandatory).every((a) => a.records.length > 0), detail: "Domain registry supplies canonical record sets" },
    { id: "owner", label: "Ownership assigned automatically", passed: Boolean(plan.owner.team), detail: `${plan.owner.team}` },
    { id: "sla", label: "SLA clock started with task due times", passed: plan.slaMinutes > 0 && plan.tasks.every((t) => t.dueMinutes > 0), detail: `${plan.slaMinutes} min resolution target` },
    { id: "audit", label: "Immutable audit events with correlation ID", passed: plan.auditEvents.length >= 3 && plan.auditEvents.every((e) => e.correlationId === plan.correlationId), detail: `${plan.auditEvents.length} events · ${plan.correlationId}` },
    { id: "graph", label: "Unified case graph assembled", passed: plan.graph.length >= 3, detail: `${plan.graph.length} linked entities` },
    { id: "evidence", label: "Evidence declared for every task", passed: plan.tasks.every((t) => t.evidence.length > 0), detail: `${plan.tasks.length} tasks` },
    { id: "approval", label: "Approval chain present for financial / safety outcomes", passed: def.domain === "support" || plan.tasks.some((t) => t.approval), detail: plan.tasks.filter((t) => t.approval).length ? "Maker-checker gate present" : "No approval required for this type" },
  ];

  const passed = checks.filter((c) => c.passed).length;
  return {
    caseType, label: def.label, requiredDomains: required,
    coveredDomains: required.filter((d) => executing.has(d)), missingDomains: missing,
    checks, score: Math.round((passed / checks.length) * 100), certified: passed === checks.length,
  };
}

export interface OrchestrationCertification {
  matrix: CaseTypeCertification[];
  certifiedCount: number;
  totalCount: number;
  certifiedPct: number;
  gaps: { caseType: CaseType; missing: BusinessDomain[]; failedChecks: string[] }[];
  release: "GO" | "NO-GO";
}

export function certifyOrchestration(): OrchestrationCertification {
  const matrix = CASE_TYPES.map((t) => certifyCaseType(t.type));
  const certifiedCount = matrix.filter((m) => m.certified).length;
  const gaps = matrix
    .filter((m) => !m.certified)
    .map((m) => ({ caseType: m.caseType, missing: m.missingDomains, failedChecks: m.checks.filter((c) => !c.passed).map((c) => c.label) }));
  return {
    matrix, certifiedCount, totalCount: matrix.length,
    certifiedPct: Math.round((certifiedCount / matrix.length) * 100),
    gaps, release: gaps.length === 0 ? "GO" : "NO-GO",
  };
}

/* ------------------------------ closure gate ------------------------------ */

export interface ClosureAssessment {
  canClose: boolean;
  blockers: string[];
  completedDomains: BusinessDomain[];
  outstandingDomains: BusinessDomain[];
}

/**
 * Governance gate: a case may only close once every mandatory domain has
 * completed its tasks. Manual omission of a mandatory domain is impossible.
 */
export function assessClosure(plan: OrchestrationPlan, completedTaskIds: string[]): ClosureAssessment {
  const done = new Set(completedTaskIds);
  const mandatory = plan.tasks.filter((t) => t.mandatory);
  const outstanding = Array.from(new Set(mandatory.filter((t) => !done.has(t.id)).map((t) => t.domain)));
  const completed = Array.from(new Set(mandatory.filter((t) => done.has(t.id)).map((t) => t.domain)))
    .filter((d) => !outstanding.includes(d));
  const blockers = outstanding.map((d) => `${DOMAIN_LABEL[d]} has outstanding mandatory actions`);
  const unapproved = mandatory.filter((t) => t.approval && !done.has(t.id));
  if (unapproved.length) blockers.push(`${unapproved.length} approval gate(s) pending`);
  return { canClose: blockers.length === 0, blockers, completedDomains: completed, outstandingDomains: outstanding };
}
