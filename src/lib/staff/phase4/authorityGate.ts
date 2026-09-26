/**
 * Phase 4 — Authority Gate and AI Policy Engine.
 *
 * Every agent action passes this gate before anything happens. The gate is
 * deliberately narrower than "human in the loop": each action carries a
 * declared class (A0 inform … A5 prohibited), a risk level, a data-sensitivity
 * class, the approving authority, an audit requirement and a rollback path.
 *
 * The gate resolves an action to the *lowest* permission implied by:
 *   1. the policy's own classification (A5 always wins — prohibited is absolute)
 *   2. the agent's autonomy ceiling
 *   3. the event's ceiling, when the action was triggered by an event
 *   4. whether the signed-in identity actually holds the approving authority
 *   5. whether the required context was granted (incomplete context cannot execute)
 *
 * Anything that resolves above the permitted class is degraded to preparation
 * and routed to a human, never dropped silently.
 */
import { evaluateAuthority, type AuthorityAction, type AuthoritySubject } from "@/lib/staff/phase2/authority";
import { AGENTS, CLASS_ORDER, agentByKey, agentCeiling, type ActionClass } from "./agents";
import { eventByKey } from "./eventFabric";
import type { ContextEnvelope } from "./contextFabric";

export const DATA_SENSITIVITY = ["public", "internal", "commercial", "financial", "personal"] as const;
export type DataSensitivity = (typeof DATA_SENSITIVITY)[number];

export interface ActionPolicy {
  key: string;
  label: string;
  agent: string;
  /** Authority object and verb the action performs. */
  subject: AuthoritySubject;
  action: AuthorityAction;
  classification: ActionClass;
  risk: "low" | "medium" | "high";
  sensitivity: DataSensitivity;
  /** Human authority that must sign off when the class requires approval. */
  approver: string;
  audit: boolean;
  rollback: string | null;
  /** Tools the policy permits — anything else is out of policy. */
  tools: readonly string[];
  note?: string;
}

export const ACTION_POLICIES: readonly ActionPolicy[] = [
  { key: "brief.executive", label: "Produce an executive attention briefing", agent: "executive", subject: "policy", action: "view", classification: "A0", risk: "low", sensitivity: "internal", approver: "None — information only", audit: false, rollback: null, tools: ["read_kpis", "draft_briefing"] },
  { key: "revenue.flag_leakage", label: "Flag suspected revenue leakage", agent: "revenue", subject: "payment", action: "view", classification: "A1", risk: "medium", sensitivity: "financial", approver: "Finance admin reviews before any adjustment", audit: true, rollback: null, tools: ["read_invoices", "read_ledger"] },
  { key: "sales.prepare_followup", label: "Prepare (not send) opportunity follow-up", agent: "sales", subject: "customer", action: "view", classification: "A2", risk: "low", sensitivity: "commercial", approver: "Opportunity owner sends", audit: true, rollback: "Discard draft", tools: ["draft_email", "create_task", "prepare_briefing"], note: "Commercial communication is never dispatched by an agent." },
  { key: "sales.send_commercial_email", label: "Send a commercial communication to a customer", agent: "sales", subject: "customer", action: "edit", classification: "A3", risk: "high", sensitivity: "commercial", approver: "Opportunity owner", audit: true, rollback: "Retraction notice + logged correction", tools: ["draft_email"] },
  { key: "cs.prepare_recovery", label: "Prepare a service recovery plan", agent: "customer_success", subject: "customer", action: "view", classification: "A2", risk: "medium", sensitivity: "commercial", approver: "Customer success owner", audit: true, rollback: "Discard plan", tools: ["prepare_recovery_plan", "create_task"] },
  { key: "cs.grant_concession", label: "Grant a pricing concession", agent: "customer_success", subject: "contract", action: "approve", classification: "A5", risk: "high", sensitivity: "commercial", approver: "Authorised commercial approver only", audit: true, rollback: "Contract amendment reversal", tools: [], note: "Prohibited to agents in all cases: agents analyse and route, humans decide." },
  { key: "marketplace.prepare_supply_list", label: "Prepare a supply acquisition list", agent: "marketplace", subject: "partner", action: "view", classification: "A2", risk: "low", sensitivity: "internal", approver: "Marketplace manager", audit: true, rollback: "Discard list", tools: ["read_inventory", "prepare_supply_acquisition_list"] },
  { key: "marketplace.suspend_partner", label: "Suspend a marketplace partner", agent: "marketplace", subject: "partner", action: "approve", classification: "A5", risk: "high", sensitivity: "commercial", approver: "Head of Marketplace", audit: true, rollback: "Reinstatement", tools: [], note: "Livelihood-affecting: human decision only." },
  { key: "ops.notify_owner", label: "Notify the accountable owner of an exception", agent: "operations", subject: "booking", action: "view", classification: "A4", risk: "low", sensitivity: "internal", approver: "None — predefined low-risk notification", audit: true, rollback: "Retract notification", tools: ["notify_owner"] },
  { key: "ops.reassign_booking", label: "Reassign a booking to another resource", agent: "operations", subject: "booking", action: "edit", classification: "A3", risk: "medium", sensitivity: "commercial", approver: "Operations manager", audit: true, rollback: "Restore prior assignment", tools: ["prepare_intervention"] },
  { key: "logistics.prepare_recovery", label: "Prepare a delivery recovery action", agent: "logistics", subject: "booking", action: "view", classification: "A2", risk: "medium", sensitivity: "internal", approver: "Logistics controller", audit: true, rollback: "Discard action", tools: ["prepare_recovery", "notify_owner"] },
  { key: "charter.prepare_quote", label: "Prepare a charter quote and operator match", agent: "charter", subject: "booking", action: "view", classification: "A2", risk: "medium", sensitivity: "commercial", approver: "Charter desk owner", audit: true, rollback: "Discard quote", tools: ["read_quotes", "read_inventory", "prepare_quote"] },
  { key: "rentals.prepare_reservation", label: "Prepare a rental reservation and renewal notice", agent: "rentals", subject: "booking", action: "view", classification: "A2", risk: "low", sensitivity: "commercial", approver: "Rentals desk owner", audit: true, rollback: "Discard reservation", tools: ["read_inventory", "prepare_reservation", "create_task"] },
  { key: "finance.prepare_collection", label: "Prepare a collection action pack", agent: "finance", subject: "payment", action: "view", classification: "A2", risk: "medium", sensitivity: "financial", approver: "Finance admin", audit: true, rollback: "Discard pack", tools: ["read_invoices", "prepare_collection_action"] },
  { key: "finance.release_payment", label: "Release or adjust a payment", agent: "finance", subject: "payment", action: "approve", classification: "A5", risk: "high", sensitivity: "financial", approver: "Finance admin under dual control", audit: true, rollback: "Reversal entry via callback-verified RPC", tools: [], note: "Wallet credits are only ever created by the verified callback RPC; no agent may move money." },
  { key: "people.recommend_development", label: "Recommend capability development", agent: "people", subject: "employee", action: "view", classification: "A1", risk: "medium", sensitivity: "personal", approver: "People partner with the employee", audit: true, rollback: null, tools: ["prepare_development_plan"], note: "Development purpose only — not performance surveillance." },
  { key: "people.employment_decision", label: "Make an employment decision", agent: "people", subject: "employee", action: "approve", classification: "A5", risk: "high", sensitivity: "personal", approver: "Chief People Officer", audit: true, rollback: null, tools: [], note: "Never delegated to an agent." },
  { key: "knowledge.retrieve_policy", label: "Retrieve the governing policy or precedent", agent: "knowledge", subject: "policy", action: "view", classification: "A0", risk: "low", sensitivity: "internal", approver: "None — information only", audit: false, rollback: null, tools: ["read_policies", "read_decision_log"] },
  { key: "risk.escalate", label: "Escalate a breached risk threshold", agent: "risk", subject: "audit", action: "view", classification: "A3", risk: "high", sensitivity: "internal", approver: "Chief Risk Officer", audit: true, rollback: "Withdraw escalation with reason", tools: ["prepare_escalation"] },
  { key: "compliance.evidence_pack", label: "Assemble a compliance evidence pack", agent: "compliance", subject: "audit", action: "view", classification: "A2", risk: "medium", sensitivity: "internal", approver: "Head of Compliance", audit: true, rollback: "Revoke export", tools: ["prepare_evidence_pack"] },
  { key: "dq.prepare_remediation", label: "Prepare a data remediation script", agent: "data_quality", subject: "audit", action: "view", classification: "A2", risk: "medium", sensitivity: "internal", approver: "Head of Data", audit: true, rollback: "Discard script", tools: ["prepare_remediation"] },
  { key: "dq.mutate_records", label: "Execute a bulk record mutation", agent: "data_quality", subject: "audit", action: "administer", classification: "A5", risk: "high", sensitivity: "internal", approver: "Head of Data via reviewed migration", audit: true, rollback: "Migration rollback", tools: [], note: "Schema and bulk data changes go through migrations, never an agent." },
  { key: "techops.prepare_runbook", label: "Prepare an incident runbook", agent: "tech_ops", subject: "audit", action: "view", classification: "A2", risk: "low", sensitivity: "internal", approver: "Duty engineer", audit: true, rollback: "Discard runbook", tools: ["prepare_runbook"] },
  { key: "techops.notify_incident", label: "Raise an incident notification", agent: "tech_ops", subject: "audit", action: "view", classification: "A4", risk: "low", sensitivity: "internal", approver: "None — predefined low-risk notification", audit: true, rollback: "Retract notification", tools: ["read_incidents", "notify_owner"] },
];

export function policyByKey(key: string): ActionPolicy | undefined {
  return ACTION_POLICIES.find((p) => p.key === key);
}

export function policiesForAgent(agentKey: string): ActionPolicy[] {
  return ACTION_POLICIES.filter((p) => p.agent === agentKey);
}

const rank = (c: ActionClass): number => (c === "A5" ? 99 : CLASS_ORDER.indexOf(c));

export interface GateInput {
  policyKey: string;
  /** Roles held by the signed-in human operating or supervising the run. */
  roles: readonly string[];
  /** Event that triggered the action, when applicable. */
  eventKey?: string;
  /** Context envelope assembled for the run. */
  context?: ContextEnvelope;
}

export interface GateDecision {
  policy: string;
  /** Class the action actually resolves to after every constraint. */
  effective: ActionClass | "A5";
  requested: ActionClass;
  /** True when the agent may proceed without a human first. */
  autonomous: boolean;
  /** True when the action may proceed at all, with or without approval. */
  permitted: boolean;
  approvalRequired: boolean;
  approver: string | null;
  auditRequired: boolean;
  rollback: string | null;
  /** Every constraint applied, in the order applied. Always non-empty. */
  reasons: string[];
}

export function evaluateAgentAction(input: GateInput): GateDecision {
  const policy = policyByKey(input.policyKey);
  if (!policy) {
    return {
      policy: input.policyKey, requested: "A5", effective: "A5", autonomous: false, permitted: false,
      approvalRequired: false, approver: null, auditRequired: true, rollback: null,
      reasons: ["No policy exists for this action — anything not declared is prohibited"],
    };
  }
  const reasons: string[] = [];
  const base: GateDecision = {
    policy: policy.key, requested: policy.classification, effective: policy.classification,
    autonomous: false, permitted: false, approvalRequired: false,
    approver: policy.approver, auditRequired: policy.audit, rollback: policy.rollback, reasons,
  };

  if (policy.classification === "A5") {
    reasons.push(`Prohibited by policy: ${policy.note ?? "agents may not perform this action"}`);
    return { ...base, effective: "A5", permitted: false };
  }

  let effective: ActionClass = policy.classification;
  reasons.push(`Policy classifies this as ${policy.classification}`);

  const agent = agentByKey(policy.agent);
  if (!agent) {
    reasons.push("Agent is not registered in the network — refused");
    return { ...base, effective: "A5", permitted: false };
  }
  const ceiling = agentCeiling(agent);
  if (rank(effective) > rank(ceiling)) {
    effective = ceiling;
    reasons.push(`Degraded to ${ceiling} by the agent's autonomy level (${agent.autonomy})`);
  }

  if (input.eventKey) {
    const event = eventByKey(input.eventKey);
    if (!event) {
      reasons.push(`Trigger event ${input.eventKey} is not in the fabric — refused`);
      return { ...base, effective: "A5", permitted: false };
    }
    if (!event.source) {
      reasons.push(`Trigger event ${event.key} has no system of record — cannot fire`);
      return { ...base, effective: "A5", permitted: false };
    }
    if (rank(effective) > rank(event.ceiling)) {
      effective = event.ceiling;
      reasons.push(`Degraded to ${event.ceiling} by the trigger event's ceiling`);
    }
  }

  if (input.context && !input.context.complete && rank(effective) > rank("A1")) {
    effective = "A1";
    reasons.push(`Degraded to A1 — required context withheld (${input.context.withheld.join(", ")})`);
  }

  const authority = evaluateAuthority(input.roles, policy.subject, policy.action);
  const needsHuman = rank(effective) >= rank("A3");
  if (needsHuman) {
    if (authority.verdict === "deny") {
      reasons.push(`No authorised approver in session for ${policy.subject}:${policy.action} — held for ${policy.approver}`);
      return { ...base, effective: "A2", permitted: true, approvalRequired: true, autonomous: false, reasons };
    }
    reasons.push(
      authority.verdict === "conditional"
        ? `Approver present under condition: ${authority.condition ?? "policy condition"}`
        : "Authorised approver present in session",
    );
  }

  const autonomous = effective === "A4";
  if (autonomous) reasons.push("Predefined low-risk action — may execute and be audited after the fact");
  if (rank(effective) <= rank("A2")) reasons.push("No execution: the agent informs, recommends or prepares only");

  return {
    ...base,
    effective,
    permitted: true,
    autonomous,
    approvalRequired: rank(effective) === rank("A3"),
    reasons,
  };
}

/** Policy register audit: every policy must be usable and consistent. */
export function policyDefects(): { policy: string; defect: string }[] {
  const out: { policy: string; defect: string }[] = [];
  for (const p of ACTION_POLICIES) {
    const agent = agentByKey(p.agent);
    if (!agent) { out.push({ policy: p.key, defect: `unknown agent ${p.agent}` }); continue; }
    for (const t of p.tools) {
      if (!agent.tools.includes(t)) out.push({ policy: p.key, defect: `tool ${t} not granted to ${p.agent}` });
    }
    if (p.classification !== "A5" && p.tools.length === 0) {
      out.push({ policy: p.key, defect: "permitted action grants no tools" });
    }
    if (rank(p.classification) >= rank("A3") && !p.audit) {
      out.push({ policy: p.key, defect: "consequential action without an audit requirement" });
    }
    if (p.classification === "A3" && !p.rollback) {
      out.push({ policy: p.key, defect: "approved-execution action without a rollback path" });
    }
    if (p.classification === "A4" && p.risk !== "low") {
      out.push({ policy: p.key, defect: "autonomous execution declared for a non-low-risk action" });
    }
  }
  const covered = new Set(ACTION_POLICIES.map((p) => p.agent));
  for (const a of AGENTS) {
    if (!covered.has(a.key)) out.push({ policy: "—", defect: `agent ${a.key} has no declared action policy` });
  }
  return out;
}
