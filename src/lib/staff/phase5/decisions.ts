/**
 * Phase 5 — Decision Queue and the A3 human authorisation flow.
 *
 * An A3 action (a consequential act with real-world effect) may never execute
 * on an agent's own authority. It is raised as a decision record, routed to the
 * declared approver, and every step is appended to an immutable audit trail:
 * raised → context assembled → gate evaluated → authorised or rejected →
 * executed → measured. The trail is a database table with an append-only
 * trigger, so the record of who authorised what cannot be rewritten later.
 *
 * The store degrades honestly: if the tables are unreadable for this identity,
 * the queue reports the reason rather than presenting an empty queue as calm.
 */
import { untypedDb } from "@/integrations/supabase/untyped";
import { evaluateAgentAction, policyByKey } from "@/lib/staff/phase4/authorityGate";
import { assembleContext } from "@/lib/staff/phase4/contextFabric";
import { coordinationByKey } from "@/lib/staff/phase4/orchestrator";
import type { Prioritised } from "./priority";

export const DECISION_STEPS = [
  "raised",
  "context_assembled",
  "gate_evaluated",
  "authorised",
  "rejected",
  "withdrawn",
  "executed",
  "measured",
] as const;
export type DecisionStep = (typeof DECISION_STEPS)[number];

export type DecisionStatus =
  | "pending" | "approved" | "rejected" | "withdrawn" | "expired" | "executed" | "measured";

export interface DecisionRecord {
  id: string;
  coordination_key: string;
  policy_key: string;
  event_key: string;
  title: string;
  requested_class: string;
  effective_class: string;
  approver: string;
  sla_class: string;
  deadline_at: string | null;
  status: DecisionStatus;
  priority_score: number;
  confidence: number | null;
  recommendation: string | null;
  selected_option: string | null;
  evidence: Record<string, unknown>;
  options: unknown[];
  expected_impact: Record<string, unknown>;
  requested_by: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_rationale: string | null;
  created_at: string;
}

export interface AuditEntry {
  id: string;
  decision_id: string;
  step: string;
  actor: string | null;
  actor_roles: string[];
  detail: Record<string, unknown>;
  created_at: string;
}

export interface StoreResult<T> {
  data: T | null;
  error: string | null;
}

 
const db = () => untypedDb;

async function appendAudit(
  decisionId: string,
  step: DecisionStep,
  roles: readonly string[],
  detail: Record<string, unknown>,
  actor: string | null,
): Promise<string | null> {
  const { error } = await db().from("staff_decision_audit").insert({
    decision_id: decisionId,
    step,
    actor,
    actor_roles: [...roles],
    detail,
  });
  return error ? error.message : null;
}

/**
 * Raise a prioritised situation as a decision requiring human authorisation.
 * The gate is evaluated first: the record stores the class the action actually
 * resolves to, not the class the agent asked for.
 */
export async function raiseDecision(
  item: Prioritised,
  roles: readonly string[],
  userId: string | null,
): Promise<StoreResult<DecisionRecord>> {
  const coordination = coordinationByKey(item.correlation.situation.coordination);
  if (!coordination) return { data: null, error: "No coordination case governs this situation" };
  const policy = policyByKey(coordination.policyKey);
  if (!policy) return { data: null, error: "No action policy governs this coordination" };
  if (!userId) return { data: null, error: "Not signed in — a decision must have an accountable requester" };

  const context = assembleContext(coordination.owner, roles);
  const gate = evaluateAgentAction({
    policyKey: coordination.policyKey,
    roles,
    eventKey: coordination.triggerEvent,
    context,
  });

  const payload = {
    coordination_key: coordination.key,
    policy_key: policy.key,
    event_key: coordination.triggerEvent,
    title: `${item.label} — ${coordination.label}`,
    requested_class: gate.requested,
    effective_class: gate.effective,
    approver: gate.approver ?? policy.approver,
    sla_class: item.sla,
    deadline_at: item.deadlineAt,
    status: "pending" as const,
    priority_score: item.score,
    confidence: item.confidence,
    recommendation: coordination.humanDecision,
    evidence: {
      situation: item.correlation.situation.key,
      grade: item.correlation.grade,
      chain: item.correlation.situation.chain,
      signals: item.correlation.evidence.map((s) => ({ event: s.eventKey, table: s.table, observed: s.observed })),
      blind: item.correlation.blind,
    },
    options: coordination.options.map((o) => ({ label: o.label, consequence: o.consequence, quantifiedBy: o.quantifiedBy, epistemic: o.epistemic })),
    expected_impact: {
      consequence: item.correlation.situation.consequence,
      quantifiedBy: item.correlation.situation.quantifiedBy,
      priorityRationale: item.rationale,
    },
    requested_by: userId,
  };

  const { data, error } = await db().from("staff_decisions").insert(payload).select("*").single();
  if (error) return { data: null, error: error.message };

  await appendAudit(data.id, "raised", roles, { trigger: coordination.triggerEvent, priority: item.score, sla: item.sla }, userId);
  await appendAudit(data.id, "context_assembled", roles, { granted: context.granted, withheld: context.withheld }, userId);
  await appendAudit(data.id, "gate_evaluated", roles, {
    requested: gate.requested, effective: gate.effective, approvalRequired: gate.approvalRequired,
    approver: gate.approver, reasons: gate.reasons, rollback: gate.rollback,
  }, userId);

  return { data: data as DecisionRecord, error: null };
}

/** Human authorisation. Requires a rationale — an approval without reasons is not an audit trail. */
export async function decideDecision(
  decisionId: string,
  outcome: "approved" | "rejected" | "withdrawn",
  rationale: string,
  selectedOption: string | null,
  roles: readonly string[],
  userId: string | null,
): Promise<StoreResult<DecisionRecord>> {
  if (!rationale.trim()) return { data: null, error: "A rationale is required for every decision" };
  if (!userId) return { data: null, error: "Not signed in — a decision must have an accountable approver" };

  const { data, error } = await db().from("staff_decisions").update({
    status: outcome,
    decided_by: userId,
    decided_at: new Date().toISOString(),
    decision_rationale: rationale.trim(),
    selected_option: selectedOption,
  }).eq("id", decisionId).select("*").single();
  if (error) return { data: null, error: error.message };

  const step: DecisionStep = outcome === "approved" ? "authorised" : outcome === "rejected" ? "rejected" : "withdrawn";
  const auditError = await appendAudit(decisionId, step, roles, { rationale: rationale.trim(), selectedOption }, userId);
  if (auditError) return { data: data as DecisionRecord, error: `Decision recorded but audit append failed: ${auditError}` };
  return { data: data as DecisionRecord, error: null };
}

/** Mark an approved decision as orchestrated into execution. */
export async function markExecuted(
  decisionId: string,
  detail: Record<string, unknown>,
  roles: readonly string[],
  userId: string | null,
): Promise<StoreResult<true>> {
  const { error } = await db().from("staff_decisions").update({ status: "executed" }).eq("id", decisionId);
  if (error) return { data: null, error: error.message };
  const auditError = await appendAudit(decisionId, "executed", roles, detail, userId);
  return { data: true, error: auditError };
}

export async function listDecisions(limit = 40): Promise<StoreResult<DecisionRecord[]>> {
  const { data, error } = await db().from("staff_decisions")
    .select("*").order("priority_score", { ascending: false }).limit(limit);
  if (error) return { data: null, error: error.message };
  return { data: (data ?? []) as DecisionRecord[], error: null };
}

export async function listAudit(decisionId: string): Promise<StoreResult<AuditEntry[]>> {
  const { data, error } = await db().from("staff_decision_audit")
    .select("*").eq("decision_id", decisionId).order("created_at", { ascending: true });
  if (error) return { data: null, error: error.message };
  return { data: (data ?? []) as AuditEntry[], error: null };
}
 

/** Decisions whose SLA elapsed while still pending — these escalate by policy. */
export function overdueDecisions(records: readonly DecisionRecord[], now = Date.now()): DecisionRecord[] {
  return records.filter((d) => d.status === "pending" && d.deadline_at !== null && new Date(d.deadline_at).getTime() < now);
}
