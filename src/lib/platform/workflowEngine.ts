/**
 * Configurable enterprise workflow engine.
 *
 * One engine drives every multi-step approval on the platform — employee
 * bookings, quotations, corporate onboarding, refunds, invoices, wallet
 * funding, procurement, incidents, claims, maintenance — because the steps are
 * data, not code. Definitions declare roles, SLA hours, escalation and optional
 * conditions; instances track decisions and expose SLA breach state for the
 * admin console.
 *
 * Pure and deterministic.
 */

export type WorkflowStepStatus = "pending" | "in_review" | "approved" | "rejected" | "skipped";
export type WorkflowStatus = "in_progress" | "approved" | "rejected";

export interface WorkflowStepDef {
  id: string;
  label: string;
  /** Roles permitted to decide this step. */
  roles: string[];
  /** Hours allowed before the step breaches its SLA. */
  slaHours: number;
  /** Role notified when the SLA breaches. */
  escalateTo?: string;
  /** Skipped when the condition evaluates false against the instance context. */
  condition?: (ctx: Record<string, unknown>) => boolean;
  /** Optional note the approver must supply when rejecting. */
  requireNoteOnReject?: boolean;
}

export interface WorkflowDefinition {
  key: string;
  label: string
  domain: "mobility" | "commercial" | "finance" | "fleet" | "risk" | "onboarding";
  description: string;
  steps: WorkflowStepDef[];
}

const step = (
  id: string, label: string, roles: string[], slaHours: number,
  extra: Partial<WorkflowStepDef> = {},
): WorkflowStepDef => ({ id, label, roles, slaHours, ...extra });

/** Threshold helper: only run a step when the value exceeds a limit. */
export const overThreshold = (field: string, limit: number) =>
  (ctx: Record<string, unknown>) => Number(ctx[field] ?? 0) > limit;

export const WORKFLOW_DEFINITIONS: WorkflowDefinition[] = [
  {
    key: "employee_booking",
    label: "Employee booking authorisation",
    domain: "mobility",
    description: "Line-manager to dispatch chain for corporate employee trips.",
    steps: [
      step("dept_manager", "Department manager", ["corporate_manager", "corporate_admin"], 4),
      step("finance", "Finance review", ["corporate_finance", "finance_admin"], 8, { condition: overThreshold("amountKes", 50_000) }),
      step("procurement", "Procurement", ["corporate_procurement"], 12, { condition: overThreshold("amountKes", 250_000) }),
      step("travel_manager", "Travel manager", ["corporate_travel_manager", "corporate_admin"], 6),
      step("fleet_allocation", "Fleet allocation", ["operations_admin", "fleet_manager"], 4),
      step("dispatch", "Dispatch release", ["operations_admin"], 2, { escalateTo: "super_admin" }),
    ],
  },
  {
    key: "quotation_approval",
    label: "Quotation approval",
    domain: "commercial",
    description: "Commercial authority chain for charter and corporate quotations.",
    steps: [
      step("pricing", "Pricing review", ["sales_manager", "operations_admin"], 8),
      step("commercial", "Commercial approval", ["sales_director", "admin"], 12, { condition: overThreshold("amountKes", 500_000) }),
      step("finance", "Finance sign-off", ["finance_admin"], 12),
      step("issue", "Issue to client", ["sales_manager"], 4),
    ],
  },
  {
    key: "corporate_onboarding",
    label: "Corporate onboarding",
    domain: "onboarding",
    description: "KYB, credit and contract activation for a new corporate account.",
    steps: [
      step("kyb", "KYB document verification", ["compliance_admin", "admin"], 24),
      step("credit", "Credit limit approval", ["finance_admin"], 24),
      step("contract", "Contract execution", ["admin", "super_admin"], 48, { requireNoteOnReject: true }),
      step("activation", "Account activation", ["operations_admin"], 8),
    ],
  },
  {
    key: "refund_approval",
    label: "Refund approval",
    domain: "finance",
    description: "Maker-checker chain for customer refunds.",
    steps: [
      step("ops_review", "Operations review", ["operations_admin"], 8),
      step("finance", "Finance approval", ["finance_admin"], 12),
      step("treasury", "Treasury release", ["finance_admin", "super_admin"], 12, { condition: overThreshold("amountKes", 100_000) }),
    ],
  },
  {
    key: "invoice_approval",
    label: "Invoice approval",
    domain: "finance",
    description: "Billing accuracy and dispatch of corporate invoices.",
    steps: [
      step("billing", "Billing review", ["finance_admin"], 12),
      step("account_manager", "Account manager confirmation", ["sales_manager"], 12),
      step("dispatch", "Send to customer", ["finance_admin"], 8),
    ],
  },
  {
    key: "wallet_funding",
    label: "Corporate wallet funding",
    domain: "finance",
    description: "Verification of pre-funded wallet top-ups and proofs of payment.",
    steps: [
      step("proof", "Proof verification", ["finance_admin"], 6),
      step("credit", "Wallet credit release", ["finance_admin", "super_admin"], 6, { escalateTo: "super_admin" }),
    ],
  },
  {
    key: "fleet_onboarding",
    label: "Fleet onboarding",
    domain: "fleet",
    description: "Vehicle, compliance and driver readiness before first dispatch.",
    steps: [
      step("documents", "Vehicle documents", ["compliance_admin"], 24),
      step("inspection", "Inspection", ["fleet_manager"], 24),
      step("insurance", "Insurance verification", ["compliance_admin"], 24),
      step("activation", "Fleet activation", ["operations_admin"], 8),
    ],
  },
  {
    key: "maintenance_approval",
    label: "Maintenance approval",
    domain: "fleet",
    description: "Cost authorisation for vehicle maintenance and repairs.",
    steps: [
      step("fleet", "Fleet manager", ["fleet_manager"], 8),
      step("finance", "Finance approval", ["finance_admin"], 12, { condition: overThreshold("amountKes", 75_000) }),
    ],
  },
  {
    key: "incident_investigation",
    label: "Incident investigation",
    domain: "risk",
    description: "Trust & safety investigation and closure of an incident.",
    steps: [
      step("triage", "Safety triage", ["trust_safety_admin", "operations_admin"], 2, { escalateTo: "super_admin" }),
      step("investigation", "Investigation", ["trust_safety_admin"], 48),
      step("closure", "Closure sign-off", ["admin", "super_admin"], 24, { requireNoteOnReject: true }),
    ],
  },
  {
    key: "insurance_claim",
    label: "Insurance claim",
    domain: "risk",
    description: "Claim documentation, insurer submission and settlement.",
    steps: [
      step("documents", "Claim documentation", ["fleet_manager"], 24),
      step("insurer", "Insurer submission", ["compliance_admin"], 48),
      step("settlement", "Settlement reconciliation", ["finance_admin"], 72),
    ],
  },
  {
    key: "supplier_registration",
    label: "Supplier registration",
    domain: "onboarding",
    description: "Vetting and contracting of transport partners and suppliers.",
    steps: [
      step("vetting", "Due diligence", ["compliance_admin"], 48),
      step("commercial", "Commercial terms", ["sales_manager"], 24),
      step("approval", "Procurement approval", ["admin"], 24),
    ],
  },
  {
    key: "vehicle_procurement",
    label: "Vehicle procurement",
    domain: "fleet",
    description: "Capital approval chain for new fleet acquisition.",
    steps: [
      step("business_case", "Business case", ["fleet_manager"], 48),
      step("finance", "Finance approval", ["finance_admin"], 48),
      step("board", "Executive approval", ["super_admin"], 72, { condition: overThreshold("amountKes", 5_000_000) }),
    ],
  },
];

const DEFS = new Map(WORKFLOW_DEFINITIONS.map((d) => [d.key, d]));
export const workflowDefinition = (key: string): WorkflowDefinition | null => DEFS.get(key) ?? null;

export interface WorkflowStepState {
  id: string;
  label: string;
  roles: string[];
  slaHours: number;
  escalateTo: string | null;
  status: WorkflowStepStatus;
  enteredAt: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  note: string | null;
}

export interface WorkflowInstance {
  id: string;
  definitionKey: string;
  label: string;
  subjectRef: string;
  corporateId: string | null;
  context: Record<string, unknown>;
  status: WorkflowStatus;
  createdAt: string;
  steps: WorkflowStepState[];
}

export function startWorkflow(input: {
  id: string;
  definitionKey: string;
  subjectRef: string;
  corporateId?: string | null;
  context?: Record<string, unknown>;
  at?: string;
}): WorkflowInstance {
  const def = workflowDefinition(input.definitionKey);
  if (!def) throw new Error(`unknown_workflow:${input.definitionKey}`);
  const at = input.at ?? new Date().toISOString();
  const ctx = input.context ?? {};
  const steps: WorkflowStepState[] = def.steps.map((s) => ({
    id: s.id,
    label: s.label,
    roles: s.roles,
    slaHours: s.slaHours,
    escalateTo: s.escalateTo ?? null,
    status: s.condition && !s.condition(ctx) ? "skipped" : "pending",
    enteredAt: null,
    decidedAt: null,
    decidedBy: null,
    note: null,
  }));
  const first = steps.find((s) => s.status === "pending");
  if (first) { first.status = "in_review"; first.enteredAt = at; }
  return {
    id: input.id,
    definitionKey: def.key,
    label: def.label,
    subjectRef: input.subjectRef,
    corporateId: input.corporateId ?? null,
    context: ctx,
    status: first ? "in_progress" : "approved",
    createdAt: at,
    steps,
  };
}

export const activeStep = (w: WorkflowInstance): WorkflowStepState | null =>
  w.steps.find((s) => s.status === "in_review") ?? null;

export const canDecide = (s: WorkflowStepState, roles: string[]): boolean =>
  roles.includes("super_admin") || s.roles.some((r) => roles.includes(r));

export interface DecisionResult {
  ok: boolean;
  error?: "not_active" | "forbidden" | "note_required" | "already_closed";
  workflow: WorkflowInstance;
}

export function decideWorkflowStep(
  w: WorkflowInstance,
  input: { stepId: string; decision: "approved" | "rejected"; actorRoles: string[]; actor: string; note?: string; at?: string },
): DecisionResult {
  if (w.status !== "in_progress") return { ok: false, error: "already_closed", workflow: w };
  const active = activeStep(w);
  if (!active || active.id !== input.stepId) return { ok: false, error: "not_active", workflow: w };
  if (!canDecide(active, input.actorRoles)) return { ok: false, error: "forbidden", workflow: w };
  const def = workflowDefinition(w.definitionKey);
  const stepDef = def?.steps.find((s) => s.id === input.stepId);
  if (input.decision === "rejected" && stepDef?.requireNoteOnReject && !input.note?.trim()) {
    return { ok: false, error: "note_required", workflow: w };
  }
  const at = input.at ?? new Date().toISOString();
  const steps = w.steps.map((s) =>
    s.id === input.stepId
      ? { ...s, status: input.decision, decidedAt: at, decidedBy: input.actor, note: input.note?.trim() || null }
      : s,
  );
  let status: WorkflowStatus = "in_progress";
  if (input.decision === "rejected") {
    status = "rejected";
  } else {
    const next = steps.find((s) => s.status === "pending");
    if (next) { next.status = "in_review"; next.enteredAt = at; }
    else status = "approved";
  }
  return { ok: true, workflow: { ...w, steps, status } };
}

export interface SlaState {
  workflowId: string;
  label: string;
  subjectRef: string;
  stepId: string | null;
  stepLabel: string | null;
  owners: string[];
  hoursElapsed: number;
  slaHours: number;
  /** Fraction of the SLA consumed, 0..n. */
  consumedPct: number;
  breached: boolean;
  atRisk: boolean;
  escalateTo: string | null;
}

const HOUR = 3_600_000;

export function slaState(w: WorkflowInstance, now = Date.now()): SlaState {
  const s = activeStep(w);
  const elapsed = s?.enteredAt ? Math.max(0, (now - new Date(s.enteredAt).getTime()) / HOUR) : 0;
  const sla = s?.slaHours ?? 0;
  const consumed = sla ? (elapsed / sla) * 100 : 0;
  return {
    workflowId: w.id,
    label: w.label,
    subjectRef: w.subjectRef,
    stepId: s?.id ?? null,
    stepLabel: s?.label ?? null,
    owners: s?.roles ?? [],
    hoursElapsed: Math.round(elapsed * 10) / 10,
    slaHours: sla,
    consumedPct: Math.round(consumed),
    breached: w.status === "in_progress" && !!s && elapsed > sla,
    atRisk: w.status === "in_progress" && !!s && consumed >= 75 && elapsed <= sla,
    escalateTo: s?.escalateTo ?? null,
  };
}

export interface WorkflowSlaSummary {
  total: number;
  inProgress: number;
  approved: number;
  rejected: number;
  breached: number;
  atRisk: number;
  /** Share of in-progress workflows inside SLA, 0..100. */
  compliancePct: number;
  avgHoursOnActiveStep: number;
  byDefinition: Array<{ key: string; label: string; total: number; breached: number; compliancePct: number }>;
}

export function summariseWorkflows(items: WorkflowInstance[], now = Date.now()): WorkflowSlaSummary {
  const states = items.map((w) => slaState(w, now));
  const inProgress = items.filter((w) => w.status === "in_progress");
  const breached = states.filter((s) => s.breached).length;
  const keys = [...new Set(items.map((w) => w.definitionKey))];
  return {
    total: items.length,
    inProgress: inProgress.length,
    approved: items.filter((w) => w.status === "approved").length,
    rejected: items.filter((w) => w.status === "rejected").length,
    breached,
    atRisk: states.filter((s) => s.atRisk).length,
    compliancePct: inProgress.length
      ? Math.round(((inProgress.length - breached) / inProgress.length) * 1000) / 10
      : 100,
    avgHoursOnActiveStep: inProgress.length
      ? Math.round((states.filter((s) => s.stepId).reduce((sum, s) => sum + s.hoursElapsed, 0) / inProgress.length) * 10) / 10
      : 0,
    byDefinition: keys.map((key) => {
      const rows = items.filter((w) => w.definitionKey === key);
      const b = rows.map((w) => slaState(w, now)).filter((s) => s.breached).length;
      const open = rows.filter((w) => w.status === "in_progress").length;
      return {
        key,
        label: workflowDefinition(key)?.label ?? key,
        total: rows.length,
        breached: b,
        compliancePct: open ? Math.round(((open - b) / open) * 1000) / 10 : 100,
      };
    }),
  };
}
