/**
 * Phase 11 §11.6, §11.7, §11.8, §11.9, §11.33, §11.34 — Autonomy levels, agent
 * contracts, the machine-readable policy engine and the kill switch.
 *
 * No agent acts because it is confident. It acts because a policy grants that
 * class of action, at that value, to that agent, at an autonomy level that has
 * been authorised — and every consequential workflow can be paused, disabled,
 * rolled back and taken over by a human. Governance is enforced in code here, not
 * described in a document.
 */
import type { InterventionKind } from "./scenario";

export type AutonomyLevel = "A0" | "A1" | "A2" | "A3" | "A4";

export const AUTONOMY_LABEL: Record<AutonomyLevel, string> = {
  A0: "A0 — Observe (AI reports only)",
  A1: "A1 — Recommend (human executes)",
  A2: "A2 — Approve (authorised human approves)",
  A3: "A3 — Guardrailed execute (within predefined limits)",
  A4: "A4 — Autonomous routine execution (verified continuously)",
};

const ORDER: AutonomyLevel[] = ["A0", "A1", "A2", "A3", "A4"];

export function minAutonomy(a: AutonomyLevel, b: AutonomyLevel): AutonomyLevel {
  return ORDER.indexOf(a) <= ORDER.indexOf(b) ? a : b;
}

/* ------------------------------------------------------------------ policies */

export type PolicyDomain =
  | "pricing"
  | "matching"
  | "provider_eligibility"
  | "customer_eligibility"
  | "payments"
  | "refunds"
  | "cancellations"
  | "incentives"
  | "corporate_spending"
  | "risk"
  | "safety"
  | "ai_autonomy"
  | "market_entry"
  | "operations";

export interface PolicyRule {
  id: string;
  domain: PolicyDomain;
  statement: string;
  /** Highest autonomy any agent may reach in this domain. */
  maxAutonomy: AutonomyLevel;
  /** Value ceiling for autonomous execution, in cents. null = no autonomous value. */
  autonomousValueCeilingCents: number | null;
  approverRole: string | null;
  prohibited: string[];
}

export const POLICY_REGISTRY: readonly PolicyRule[] = [
  {
    id: "pol-pricing",
    domain: "pricing",
    statement: "Price recommendations may move within ±8% of the authorised base price; policy changes are human decisions.",
    maxAutonomy: "A2",
    autonomousValueCeilingCents: null,
    approverRole: "Head of Commercial",
    prohibited: ["change pricing policy", "exceed the authorised corridor", "price below contribution floor"],
  },
  {
    id: "pol-matching",
    domain: "matching",
    statement: "Matching weights may be tuned within the certified feasibility rules; eligibility rules may not be relaxed.",
    maxAutonomy: "A3",
    autonomousValueCeilingCents: 500_000,
    approverRole: "Marketplace Operations Lead",
    prohibited: ["relax compliance feasibility", "match a non-compliant provider"],
  },
  {
    id: "pol-incentives",
    domain: "incentives",
    statement: "Provider and customer incentives up to KES 25,000 per intervention may execute under guardrails; larger spend requires approval.",
    maxAutonomy: "A3",
    autonomousValueCeilingCents: 2_500_000,
    approverRole: "Head of Commercial",
    prohibited: ["unbounded incentive budgets", "incentives that produce negative contribution"],
  },
  {
    id: "pol-operations",
    domain: "operations",
    statement: "Routine rebalancing, notifications, task assignment and status updates are approved classes of low-risk action.",
    maxAutonomy: "A4",
    autonomousValueCeilingCents: 100_000,
    approverRole: "Marketplace Operations Lead",
    prohibited: ["alter financial records", "alter safety state"],
  },
  {
    id: "pol-payments",
    domain: "payments",
    statement: "AI may never create, alter or reverse financial truth; payment and settlement records are callback-verified only.",
    maxAutonomy: "A1",
    autonomousValueCeilingCents: null,
    approverRole: "Finance Controller",
    prohibited: ["write ledger entries", "credit a wallet", "release a settlement"],
  },
  {
    id: "pol-refunds",
    domain: "refunds",
    statement: "Refunds and credits require finance approval regardless of model confidence.",
    maxAutonomy: "A2",
    autonomousValueCeilingCents: null,
    approverRole: "Finance Controller",
    prohibited: ["auto-refund", "auto-waive an invoice"],
  },
  {
    id: "pol-provider-eligibility",
    domain: "provider_eligibility",
    statement: "Provider suspension or reinstatement is a human decision with a recorded reason and right of review.",
    maxAutonomy: "A2",
    autonomousValueCeilingCents: null,
    approverRole: "Head of Trust & Safety",
    prohibited: ["automatic suspension on model score alone"],
  },
  {
    id: "pol-safety",
    domain: "safety",
    statement: "Safety-critical decisions are never automated and are escalated immediately.",
    maxAutonomy: "A1",
    autonomousValueCeilingCents: null,
    approverRole: "Head of Trust & Safety",
    prohibited: ["automate safety-critical judgement", "close a safety case automatically"],
  },
  {
    id: "pol-corporate-spending",
    domain: "corporate_spending",
    statement: "Contractual commitments to corporate accounts require commercial authority.",
    maxAutonomy: "A2",
    autonomousValueCeilingCents: null,
    approverRole: "Head of Corporate",
    prohibited: ["commit contractual terms", "extend credit"],
  },
  {
    id: "pol-market-entry",
    domain: "market_entry",
    statement: "Market entry is recommended by Phase 9 and approved by the executive; never executed by an agent.",
    maxAutonomy: "A1",
    autonomousValueCeilingCents: null,
    approverRole: "Chief Executive",
    prohibited: ["launch a market", "commit market capital"],
  },
  {
    id: "pol-risk",
    domain: "risk",
    statement: "Risk scores trigger graduated verification, never automatic punishment.",
    maxAutonomy: "A2",
    autonomousValueCeilingCents: null,
    approverRole: "Head of Trust & Safety",
    prohibited: ["punitive action on an unexplained score"],
  },
  {
    id: "pol-ai-autonomy",
    domain: "ai_autonomy",
    statement: "Autonomy above A2 requires an approved agent contract, a measured evaluation and an operational kill switch.",
    maxAutonomy: "A4",
    autonomousValueCeilingCents: null,
    approverRole: "AI Governance Board",
    prohibited: ["raise autonomy without evaluation", "operate without a kill switch"],
  },
  {
    id: "pol-cancellations",
    domain: "cancellations",
    statement: "Cancellation handling may notify and re-match automatically; penalties require review.",
    maxAutonomy: "A3",
    autonomousValueCeilingCents: 200_000,
    approverRole: "Marketplace Operations Lead",
    prohibited: ["apply a penalty automatically"],
  },
  {
    id: "pol-customer-eligibility",
    domain: "customer_eligibility",
    statement: "Customer restriction requires a reviewed decision and a stated reason.",
    maxAutonomy: "A2",
    autonomousValueCeilingCents: null,
    approverRole: "Head of Customer Operations",
    prohibited: ["automatic account restriction"],
  },
];

export function policyFor(domain: string): PolicyRule | null {
  return POLICY_REGISTRY.find((p) => p.domain === domain) ?? null;
}

const KIND_DOMAIN: Record<InterventionKind, PolicyDomain> = {
  add_supply: "provider_eligibility",
  remove_supply: "operations",
  incentivise_supply: "incentives",
  reposition_supply: "operations",
  adjust_price: "pricing",
  adjust_matching: "matching",
  adjust_service_availability: "operations",
  prioritise_missions: "matching",
  reroute_logistics: "operations",
  shift_demand: "customer_eligibility",
  customer_incentive: "incentives",
  change_sales_capacity: "operations",
  do_nothing: "operations",
};

export function policyDomainForIntervention(kind: InterventionKind): PolicyDomain {
  return KIND_DOMAIN[kind];
}

/* ------------------------------------------------------------- agent contracts */

export interface AgentContract {
  key: string;
  name: string;
  purpose: string;
  inputs: string[];
  outputs: string[];
  /** Maximum autonomy the contract grants, before policy is applied. */
  authority: AutonomyLevel;
  dataPermissions: string[];
  actionsPermitted: string[];
  actionsProhibited: string[];
  /** Below this confidence the agent may only observe. */
  confidenceThreshold: number;
  /** Above this value in cents the agent must escalate. */
  escalationValueCents: number;
  humanApprovalRequired: boolean;
  auditRequirement: string;
  failureBehaviour: string;
}

export const AGENT_CONTRACTS: readonly AgentContract[] = [
  {
    key: "demand", name: "Demand Agent", purpose: "Predict what customers will request, by cell and window.",
    inputs: ["demand signals", "marketplace state", "external intelligence"], outputs: ["demand forecast", "drivers", "uncertainty"],
    authority: "A1", dataPermissions: ["trips", "commercial_transactions", "delivery_orders"],
    actionsPermitted: ["publish a forecast", "raise a shortage warning"], actionsProhibited: ["change pricing", "commit supply"],
    confidenceThreshold: 55, escalationValueCents: 1_000_000, humanApprovalRequired: false,
    auditRequirement: "Every published forecast is versioned with its inputs", failureBehaviour: "Withhold the forecast and report a sensing gap",
  },
  {
    key: "supply", name: "Supply Agent", purpose: "Predict what independent capacity becomes available.",
    inputs: ["supply signals", "provider quality", "committed supply"], outputs: ["supply forecast", "capacity risk"],
    authority: "A1", dataPermissions: ["drivers", "vehicles", "charter_inventory"],
    actionsPermitted: ["publish capacity forecast", "flag attrition risk"], actionsProhibited: ["suspend a provider", "commit provider capacity"],
    confidenceThreshold: 55, escalationValueCents: 1_000_000, humanApprovalRequired: false,
    auditRequirement: "Capacity claims cite the provider registry read", failureBehaviour: "Report capacity as not measurable",
  },
  {
    key: "matching", name: "Matching Agent", purpose: "Improve best-feasible matching within certified feasibility rules.",
    inputs: ["mission requirements", "provider capability", "compliance state"], outputs: ["ranked providers", "rejection reasons"],
    authority: "A3", dataPermissions: ["dispatch_events", "drivers"],
    actionsPermitted: ["tune weights within limits", "re-match after cancellation"], actionsProhibited: ["relax compliance feasibility"],
    confidenceThreshold: 65, escalationValueCents: 500_000, humanApprovalRequired: false,
    auditRequirement: "Every match decision records its score components", failureBehaviour: "Fall back to the certified deterministic ranking",
  },
  {
    key: "revenue", name: "Revenue Agent", purpose: "Optimise contribution, never gross bookings.",
    inputs: ["transaction spine", "pricing corridors", "leakage checks"], outputs: ["contribution opportunities", "leakage findings"],
    authority: "A1", dataPermissions: ["commercial_transactions"],
    actionsPermitted: ["propose recovery actions"], actionsProhibited: ["write financial records", "alter recognised revenue"],
    confidenceThreshold: 60, escalationValueCents: 500_000, humanApprovalRequired: true,
    auditRequirement: "Financial proposals are immutable once submitted", failureBehaviour: "Report unquantified and stop",
  },
  {
    key: "sales", name: "Sales Agent", purpose: "Prioritise commercial actions by expected incremental contribution.",
    inputs: ["leads", "opportunities", "account history"], outputs: ["ranked commercial actions"],
    authority: "A2", dataPermissions: ["marketing_leads", "corporate_accounts"],
    actionsPermitted: ["prepare outreach", "queue CRM reminders"], actionsProhibited: ["commit contractual terms", "offer discounts"],
    confidenceThreshold: 55, escalationValueCents: 1_000_000, humanApprovalRequired: true,
    auditRequirement: "Outreach content and approver recorded", failureBehaviour: "Leave the action in draft",
  },
  {
    key: "customer", name: "Customer Agent", purpose: "Optimise retention and legitimate expansion.",
    inputs: ["repeat behaviour", "cross-service behaviour", "complaints"], outputs: ["retention risks", "relevant recommendations"],
    authority: "A2", dataPermissions: ["commercial_transactions", "corporate_accounts"],
    actionsPermitted: ["recommend relevant services where evidence supports relevance"], actionsProhibited: ["irrelevant cross-selling", "restrict an account"],
    confidenceThreshold: 60, escalationValueCents: 250_000, humanApprovalRequired: false,
    auditRequirement: "Relevance evidence stored with each recommendation", failureBehaviour: "Make no recommendation",
  },
  {
    key: "provider", name: "Provider Agent", purpose: "Make good providers more productive without eroding autonomy.",
    inputs: ["provider quality", "activity", "compliance"], outputs: ["inactivity risk", "opportunity suggestions"],
    authority: "A2", dataPermissions: ["drivers", "commercial_transactions"],
    actionsPermitted: ["surface relevant opportunities", "flag compliance expiry"], actionsProhibited: ["suspend a provider", "compel acceptance"],
    confidenceThreshold: 60, escalationValueCents: 250_000, humanApprovalRequired: false,
    auditRequirement: "Provider-facing actions logged with contractual basis", failureBehaviour: "Escalate to partner operations",
  },
  {
    key: "operations", name: "Operations Agent", purpose: "Optimise fulfilment and close exceptions.",
    inputs: ["mission state", "SLA", "exceptions"], outputs: ["rebalancing actions", "exception triage"],
    authority: "A3", dataPermissions: ["dispatch_events", "availability_metrics"],
    actionsPermitted: ["approved operational rebalancing", "requeue a failed event", "reassign a routine task"], actionsProhibited: ["alter financial truth", "override a safety hold"],
    confidenceThreshold: 65, escalationValueCents: 100_000, humanApprovalRequired: false,
    auditRequirement: "Every executed action is verifiable and reversible", failureBehaviour: "Roll back and hand to a human operator",
  },
  {
    key: "logistics", name: "Logistics Agent", purpose: "Optimise shipment execution and routing.",
    inputs: ["delivery orders", "carrier capacity", "route conditions"], outputs: ["routing proposals", "capacity warnings"],
    authority: "A2", dataPermissions: ["delivery_orders", "delivery_dispatch_jobs"],
    actionsPermitted: ["propose rerouting", "flag capacity shortfall"], actionsProhibited: ["change contracted service levels"],
    confidenceThreshold: 60, escalationValueCents: 250_000, humanApprovalRequired: false,
    auditRequirement: "Routing changes recorded against the shipment", failureBehaviour: "Retain the original plan",
  },
  {
    key: "air", name: "Air Mobility Agent", purpose: "Optimise aircraft mission workflows within operator authority.",
    inputs: ["aircraft availability", "charter enquiries", "compliance"], outputs: ["feasible operator options"],
    authority: "A1", dataPermissions: ["charter_inventory", "charter_bookings"],
    actionsPermitted: ["prepare operator options"], actionsProhibited: ["confirm an aircraft", "override operator authority"],
    confidenceThreshold: 70, escalationValueCents: 100_000, humanApprovalRequired: true,
    auditRequirement: "Operator confirmations remain human and documented", failureBehaviour: "Escalate to air operations",
  },
  {
    key: "risk", name: "Risk Agent", purpose: "Detect fraud, abuse and anomaly with graduated response.",
    inputs: ["payment anomalies", "location anomalies", "cancellation patterns"], outputs: ["scored, explained risk findings"],
    authority: "A2", dataPermissions: ["commercial_transactions", "alerts_events"],
    actionsPermitted: ["request verification", "open a case"], actionsProhibited: ["punish on score alone", "suspend without review"],
    confidenceThreshold: 70, escalationValueCents: 100_000, humanApprovalRequired: true,
    auditRequirement: "Score, explanation and reviewer recorded", failureBehaviour: "Escalate to trust & safety",
  },
  {
    key: "finance", name: "Finance Agent", purpose: "Detect financial anomalies and reconciliation breaks.",
    inputs: ["ledger", "settlements", "invoices"], outputs: ["variance findings", "leakage evidence"],
    authority: "A1", dataPermissions: ["commercial_transactions", "corporate_invoices"],
    actionsPermitted: ["raise a reconciliation exception"], actionsProhibited: ["post a journal", "adjust a balance"],
    confidenceThreshold: 65, escalationValueCents: 100_000, humanApprovalRequired: true,
    auditRequirement: "Findings immutable and attributable", failureBehaviour: "Raise an alert and stop",
  },
  {
    key: "learning", name: "Learning Agent", purpose: "Measure whether interventions created incremental value.",
    inputs: ["predictions", "actions", "actual outcomes"], outputs: ["variance", "causal confidence", "lessons"],
    authority: "A1", dataPermissions: ["commercial_transactions", "staff_experiments"],
    actionsPermitted: ["publish measured outcomes", "retire an ineffective intervention class"], actionsProhibited: ["claim causation without a comparison"],
    confidenceThreshold: 50, escalationValueCents: 0, humanApprovalRequired: false,
    auditRequirement: "Every lesson cites its evidence and comparison method", failureBehaviour: "Report the outcome as unmeasured",
  },
  {
    key: "orchestrator", name: "SAFARID Orchestrator", purpose: "Coordinate the agents into one loop under human authority.",
    inputs: ["all agent outputs", "policy registry", "kill-switch state"], outputs: ["one ranked decision per condition"],
    authority: "A2", dataPermissions: ["agent outputs only"],
    actionsPermitted: ["sequence the loop", "route for approval", "halt the loop"], actionsProhibited: ["exceed any agent's authority", "bypass policy"],
    confidenceThreshold: 60, escalationValueCents: 250_000, humanApprovalRequired: true,
    auditRequirement: "Full decision lineage retained", failureBehaviour: "Halt the loop and notify the duty operator",
  },
];

export function agentContract(key: string): AgentContract | null {
  return AGENT_CONTRACTS.find((a) => a.key === key) ?? null;
}

/** A contract is invalid if it grants action without oversight or auditability. */
export function validateAgentContract(c: AgentContract): string[] {
  const defects: string[] = [];
  if (!c.purpose.trim()) defects.push("no declared purpose");
  if (c.inputs.length === 0) defects.push("no declared inputs");
  if (c.outputs.length === 0) defects.push("no declared outputs");
  if (c.actionsProhibited.length === 0) defects.push("no prohibited actions");
  if (c.dataPermissions.length === 0) defects.push("no data permissions");
  if (!c.auditRequirement.trim()) defects.push("no audit requirement");
  if (!c.failureBehaviour.trim()) defects.push("no failure behaviour");
  if (c.confidenceThreshold <= 0) defects.push("no confidence threshold");
  if ((c.authority === "A3" || c.authority === "A4") && c.escalationValueCents <= 0) {
    defects.push("executing agent has no escalation ceiling");
  }
  return defects;
}

/* --------------------------------------------------------------- kill switch */

export interface KillSwitch {
  scope: string;
  /** true = the workflow may run. */
  enabled: boolean;
  pausedBy: string | null;
  pausedAt: string | null;
  reason: string | null;
  /** Rollback path proven for this scope. */
  rollback: string;
  manualTakeover: string;
}

export const KILL_SWITCHES: readonly KillSwitch[] = [
  { scope: "adaptive_loop", enabled: true, pausedBy: null, pausedAt: null, reason: null, rollback: "Discard the pending decision; no state was written", manualTakeover: "Duty operator runs the loop step manually" },
  { scope: "incentive_execution", enabled: true, pausedBy: null, pausedAt: null, reason: null, rollback: "Revoke unclaimed incentives and notify providers", manualTakeover: "Commercial lead issues incentives manually" },
  { scope: "matching_tuning", enabled: true, pausedBy: null, pausedAt: null, reason: null, rollback: "Restore the certified deterministic weights", manualTakeover: "Operations runs certified matching" },
  { scope: "operational_rebalancing", enabled: true, pausedBy: null, pausedAt: null, reason: null, rollback: "Reverse the reposition instruction", manualTakeover: "Dispatch desk instructs providers directly" },
  { scope: "self_healing", enabled: true, pausedBy: null, pausedAt: null, reason: null, rollback: "Stop retries and preserve the failed event for inspection", manualTakeover: "Engineer replays the event manually" },
];

export function killSwitchFor(scope: string, switches: readonly KillSwitch[] = KILL_SWITCHES): KillSwitch | null {
  return switches.find((s) => s.scope === scope) ?? null;
}

/* ------------------------------------------------------------- authorisation */

export interface AuthorityDecision {
  agent: string;
  intervention: InterventionKind;
  policy: PolicyRule | null;
  /** Level the action may actually run at after contract, policy and value caps. */
  effectiveLevel: AutonomyLevel;
  allowed: boolean;
  requiresApproval: boolean;
  approverRole: string | null;
  reasons: string[];
  /** Kill switch that governs this class of action. */
  killSwitchScope: string;
}

const EXECUTION_SCOPE: Partial<Record<InterventionKind, string>> = {
  incentivise_supply: "incentive_execution",
  customer_incentive: "incentive_execution",
  adjust_matching: "matching_tuning",
  prioritise_missions: "matching_tuning",
  reposition_supply: "operational_rebalancing",
  reroute_logistics: "operational_rebalancing",
};

/**
 * The single authority gate. It is deliberately conservative: the effective
 * autonomy is the minimum of the agent contract, the governing policy, the value
 * ceiling and the kill-switch state.
 */
export function authoriseAction(input: {
  agentKey: string;
  intervention: InterventionKind;
  valueCents: number | null;
  confidence: number;
  switches?: readonly KillSwitch[];
}): AuthorityDecision {
  const reasons: string[] = [];
  const contract = agentContract(input.agentKey);
  const domain = policyDomainForIntervention(input.intervention);
  const policy = policyFor(domain);
  const scope = EXECUTION_SCOPE[input.intervention] ?? "adaptive_loop";

  if (!contract) {
    return {
      agent: input.agentKey, intervention: input.intervention, policy,
      effectiveLevel: "A0", allowed: false, requiresApproval: true, approverRole: policy?.approverRole ?? null,
      reasons: [`No approved agent contract for ${input.agentKey} — the action is refused`], killSwitchScope: scope,
    };
  }

  let level = minAutonomy(contract.authority, policy?.maxAutonomy ?? "A1");
  if (!policy) reasons.push(`No policy governs ${domain} — capped at recommend`);

  if (input.confidence < contract.confidenceThreshold) {
    level = "A0";
    reasons.push(`Confidence ${input.confidence}% is below the contract threshold of ${contract.confidenceThreshold}%`);
  }

  const value = input.valueCents ?? 0;
  if (input.valueCents === null) {
    level = minAutonomy(level, "A1");
    reasons.push("Value is not quantified — execution autonomy withheld");
  }
  const ceiling = policy?.autonomousValueCeilingCents ?? null;
  if ((level === "A3" || level === "A4") && (ceiling === null || value > ceiling)) {
    level = "A2";
    reasons.push(
      ceiling === null
        ? `${domain} grants no autonomous value ceiling — approval required`
        : `Value KES ${Math.round(value / 100).toLocaleString()} exceeds the autonomous ceiling of KES ${Math.round(ceiling / 100).toLocaleString()}`,
    );
  }
  if (value > contract.escalationValueCents && contract.escalationValueCents > 0) {
    level = minAutonomy(level, "A2");
    reasons.push(`Value exceeds the contract escalation ceiling for ${contract.name}`);
  }
  if (contract.humanApprovalRequired) {
    level = minAutonomy(level, "A2");
    reasons.push(`${contract.name} always requires a named human approver`);
  }

  const ks = killSwitchFor(scope, input.switches ?? KILL_SWITCHES);
  if (ks && !ks.enabled) {
    level = "A0";
    reasons.push(`Kill switch ${scope} is engaged${ks.reason ? `: ${ks.reason}` : ""} — execution is blocked`);
  }

  const requiresApproval = level === "A1" || level === "A2";
  if (reasons.length === 0) reasons.push(`Within ${contract.name} authority and ${domain} policy`);

  return {
    agent: input.agentKey,
    intervention: input.intervention,
    policy,
    effectiveLevel: level,
    allowed: level !== "A0",
    requiresApproval,
    approverRole: requiresApproval ? policy?.approverRole ?? "Duty operator" : null,
    reasons,
    killSwitchScope: scope,
  };
}

export interface GovernanceHealth {
  contracts: number;
  defectiveContracts: { agent: string; defects: string[] }[];
  policies: number;
  autonomyDistribution: Record<AutonomyLevel, number>;
  killSwitches: number;
  killSwitchesEngaged: number;
  /** Every executing contract has a rollback path and a kill switch. */
  executionGoverned: boolean;
}

export function assessGovernance(
  contracts: readonly AgentContract[] = AGENT_CONTRACTS,
  switches: readonly KillSwitch[] = KILL_SWITCHES,
): GovernanceHealth {
  const distribution: Record<AutonomyLevel, number> = { A0: 0, A1: 0, A2: 0, A3: 0, A4: 0 };
  for (const c of contracts) distribution[c.authority] += 1;
  const defective = contracts
    .map((c) => ({ agent: c.name, defects: validateAgentContract(c) }))
    .filter((d) => d.defects.length > 0);

  return {
    contracts: contracts.length,
    defectiveContracts: defective,
    policies: POLICY_REGISTRY.length,
    autonomyDistribution: distribution,
    killSwitches: switches.length,
    killSwitchesEngaged: switches.filter((s) => !s.enabled).length,
    executionGoverned:
      defective.length === 0 &&
      switches.every((s) => s.rollback.trim().length > 0 && s.manualTakeover.trim().length > 0),
  };
}
