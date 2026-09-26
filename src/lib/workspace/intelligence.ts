/**
 * MY WORKSPACE — WORKSPACE INTELLIGENCE FOUNDATION (Stage 2).
 *
 * ONE canonical work model, consumed by every workspace surface (Work Queue,
 * Calendar, Communication, notifications, AI brief). No surface may invent its
 * own task shape or its own prioritisation.
 *
 * The chain this module implements:
 *
 *   BUSINESS EVENT → ENTITY STATE → SIGNAL → WORK ITEM → PRIORITY
 *     → DEPENDENCY → NEXT ACTION → OWNER → OUTCOME → NEW EVENT
 *
 * Laws (enforced by tests):
 *  1. Every item originates from an authoritative record and keeps its id +
 *     deep link (`source`, `sourceRef`, `primaryAction.to`). Nothing is invented.
 *  2. Every item is explainable: `why` and `evidence[]` name the recorded facts
 *     that produced its lane and priority. No opaque scores.
 *  3. Every item is executable: exactly one `primaryAction` — the fastest way to
 *     resolve it. An item with no action is a defect, not a display row.
 *  4. Lane is derived, never authored: `now` (mine to act on), `waiting`
 *     (blocked on someone else), `upcoming` (dated, not yet actionable).
 *  5. Money/impact is only stated when the source record carries it.
 *
 * This module is PURE. Fetching lives in the lens/orchestration layers.
 */
import type { DecoratedWork } from "@/lib/orchestration/api";
import type { ScoredPersonalWork, PersonalCommitment } from "./personalOs";
import type { AvailableAction } from "./workEngine";
import type { LensSignal, MyContract, MyOpportunity, MyQuote } from "./lenses";

/* --------------------------------------------------------------- primitives */

/** Where the truth lives. Never a workspace-owned store. */
export type WorkSource =
  | "assigned_work"
  | "available_work"
  | "opportunity"
  | "quote"
  | "contract"
  | "approval"
  | "commitment";


export type WorkLane = "now" | "waiting" | "upcoming";

export type WorkTier = "critical" | "high" | "medium" | "low";

/** Why the business is deviating from expected flow. */
export type SignalKind =
  | "overdue"
  | "sla_risk"
  | "decision_required"
  | "stalled"
  | "awaiting_customer"
  | "awaiting_approval"
  | "no_next_action"
  | "expiring"
  | "unowned"
  | "scheduled"
  | "healthy";

export interface WorkEvidence {
  /** Human-readable recorded fact, e.g. "No movement for 9 days". */
  fact: string;
  /** The record/field it came from, e.g. "commercial_opportunities.updated_at". */
  from: string;
}

export interface WorkAction {
  label: string;
  /** Route into the authoritative system of record. */
  to: string;
}

/**
 * The canonical work item. Tasks, approvals, stalled opportunities, expiring
 * quotes, unsigned contracts, promises and meetings all become THIS shape.
 */
export interface WorkspaceItem {
  /** Stable per source record — safe as a React key and for dedupe. */
  key: string;
  source: WorkSource;
  /** Authoritative record id. */
  sourceRef: string;
  /** Executable work item id when one exists in the work spine. */
  workId: string | null;

  /** WHAT: the action, phrased as the employee's job. */
  title: string;
  /** WHO it concerns — account/customer label when recorded. */
  subject: string | null;
  /** WHY: the observed deviation, in one sentence. */
  why: string;
  /** IMPACT: only when the record carries value/consequence. */
  impact: string | null;
  /** WHAT HAPPENS IF IGNORED. */
  consequence: string | null;

  lane: WorkLane;
  tier: WorkTier;
  signal: SignalKind;
  /** Deterministic ordering weight within a lane. Never shown raw. */
  urgency: number;
  dueAt: string | null;
  /** Who progress depends on, when it is not the employee. */
  waitingOn: string | null;

  primaryAction: WorkAction;
  secondaryActions: WorkAction[];
  evidence: WorkEvidence[];
  /** Realistic execution cost in minutes. */
  minutes: number;
  accountId: string | null;
}

const TIER_WEIGHT: Record<WorkTier, number> = { critical: 40, high: 28, medium: 14, low: 6 };

const SIGNAL_WEIGHT: Record<SignalKind, number> = {
  overdue: 30,
  decision_required: 24,
  sla_risk: 20,
  expiring: 18,
  stalled: 16,
  no_next_action: 12,
  awaiting_customer: 8,
  awaiting_approval: 8,
  unowned: 6,
  scheduled: 4,
  healthy: 0,
};

const tierFromSeverity = (severity: LensSignal["severity"]): WorkTier =>
  severity === "info" ? "low" : severity;

const daysUntil = (iso: string | null, now: Date): number | null => {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - now.getTime();
  return Number.isFinite(ms) ? Math.ceil(ms / 86_400_000) : null;
};

/** Deterministic urgency: tier + signal + deadline proximity. Explainable. */
export function urgencyOf(tier: WorkTier, signal: SignalKind, dueAt: string | null, now: Date): number {
  let score = TIER_WEIGHT[tier] + SIGNAL_WEIGHT[signal];
  const days = daysUntil(dueAt, now);
  if (days != null) {
    if (days < 0) score += 24;
    else if (days === 0) score += 16;
    else if (days <= 2) score += 10;
    else if (days <= 7) score += 4;
  }
  return score;
}

/* ------------------------------------------------- normalisers (per source) */

/** Assigned, scored work from the authoritative work spine. */
export function fromAssignedWork(scored: ScoredPersonalWork, now: Date = new Date()): WorkspaceItem {
  const w: DecoratedWork = scored.work;
  const breached = w.sla.status === "breached";
  const decision = w.needs_approval && (w.approval_state === "requested" || w.approval_state === "pending");
  const externallyBlocked = w.lifecycle_state === "waiting";

  const signal: SignalKind = decision
    ? "decision_required"
    : breached
      ? "overdue"
      : externallyBlocked
        ? "awaiting_customer"
        : w.sla.status === "at_risk"
          ? "sla_risk"
          : w.required_action
            ? "scheduled"
            : "no_next_action";

  const tier: WorkTier = breached || decision ? "critical" : w.priority;

  return {
    key: `assigned:${w.id}`,
    source: "assigned_work",
    sourceRef: w.id,
    workId: w.id,
    title: w.required_action?.trim() || w.title,
    subject: w.entity_ref ?? null,
    why: breached
      ? "Passed its committed time."
      : decision
        ? "Blocked until you record a decision."
        : externallyBlocked
          ? "Waiting on a response outside your control."
          : scored.reasons[0] ?? "Assigned to you and open.",
    impact: scored.revenueBearing ? "Revenue-bearing work" : null,
    consequence: breached
      ? "The commitment is already late — every hour widens the breach."
      : decision
        ? "Downstream work stays blocked until this decision is recorded."
        : null,
    lane: externallyBlocked ? "waiting" : "now",
    tier,
    signal,
    urgency: urgencyOf(tier, signal, w.sla_due_at, now),
    dueAt: w.sla_due_at,
    waitingOn: externallyBlocked ? "Counterparty response" : null,
    primaryAction: { label: decision ? "Review decision" : "Open work", to: `/staff/workspace?work=${w.id}` },
    secondaryActions: [],
    evidence: [
      { fact: `Declared priority: ${w.priority}`, from: "staff_work_items.priority" },
      { fact: `SLA: ${w.sla.status}`, from: "staff_work_items.sla_due_at" },
      ...scored.contributions
        .filter((c) => c.points > 0)
        .map((c) => ({ fact: c.label, from: c.evidence })),
    ],
    minutes: scored.effortMinutes,
    accountId: w.entity_type === "account" ? w.entity_id : null,
  };
}

/** Real records that need an owner. Unowned, so lower than own commitments. */
export function fromAvailableAction(action: AvailableAction, now: Date = new Date()): WorkspaceItem {
  const tier: WorkTier = action.priority;
  return {
    key: `available:${action.kind}:${action.referenceId ?? action.accountId ?? action.title}`,
    source: "available_work",
    sourceRef: action.referenceId ?? action.accountId ?? action.title,
    workId: null,
    title: action.title,
    subject: action.accountName,
    why: action.reason || "Recorded as needing an owner.",
    impact: action.valueScore > 0 ? `Value score ${action.valueScore}` : null,
    consequence: "Nobody owns this yet, so it will keep ageing.",
    lane: "now",
    tier,
    signal: "unowned",
    urgency: urgencyOf(tier, "unowned", null, now),
    dueAt: null,
    waitingOn: null,
    primaryAction: {
      label: "Take it",
      to: action.opportunityId
        ? `/staff/sales?opportunity=${action.opportunityId}`
        : action.accountId
          ? `/staff/crm?account=${action.accountId}`
          : "/staff/workspace",
    },
    secondaryActions: [],
    evidence: [{ fact: action.reason, from: `staff_available_actions.${action.kind}` }],
    minutes: action.suggestedMinutes,
    accountId: action.accountId,
  };
}

/** Highest-severity non-healthy signal decides the item; healthy produces none. */
const leadSignal = (signals: LensSignal[]): LensSignal | null => {
  const order: LensSignal["severity"][] = ["critical", "high", "medium"];
  for (const sev of order) {
    const hit = signals.find((s) => s.severity === sev && s.kind !== "healthy");
    if (hit) return hit;
  }
  return null;
};

const LENS_SIGNAL: Record<LensSignal["kind"], SignalKind> = {
  stalled: "stalled",
  awaiting_customer: "awaiting_customer",
  awaiting_approval: "awaiting_approval",
  no_next_action: "no_next_action",
  expiring: "expiring",
  healthy: "healthy",
};

const laneFor = (signal: SignalKind): WorkLane =>
  signal === "awaiting_customer" || signal === "awaiting_approval" ? "waiting" : "now";

export function fromOpportunity(opp: MyOpportunity, now: Date = new Date()): WorkspaceItem | null {
  const lead = leadSignal(opp.signals);
  if (!lead) return null;
  const signal = LENS_SIGNAL[lead.kind];
  const tier = tierFromSeverity(lead.severity);
  return {
    key: `opportunity:${opp.id}`,
    source: "opportunity",
    sourceRef: opp.id,
    workId: null,
    title: signal === "stalled" ? `Re-engage ${opp.title}` : `Progress ${opp.title}`,
    subject: opp.customer,
    why: lead.label,
    impact: opp.value ? `${opp.value} opportunity` : null,
    consequence: signal === "stalled" ? "Stalled pipeline converts materially worse." : null,
    lane: laneFor(signal),
    tier,
    signal,
    urgency: urgencyOf(tier, signal, null, now),
    dueAt: null,
    waitingOn: signal === "awaiting_customer" ? opp.customer ?? "Customer" : null,
    primaryAction: { label: "Open opportunity", to: opp.sourcePath },
    secondaryActions: [],
    evidence: [
      { fact: lead.label, from: "commercial_opportunities.updated_at" },
      { fact: `Stage: ${opp.stage}`, from: "commercial_opportunities.stage" },
    ],
    minutes: 20,
    accountId: null,
  };
}

export function fromQuote(quote: MyQuote, now: Date = new Date()): WorkspaceItem | null {
  const lead = leadSignal(quote.signals);
  if (!lead) return null;
  const signal = LENS_SIGNAL[lead.kind];
  const tier = tierFromSeverity(lead.severity);
  const lane = signal === "expiring" ? "now" : laneFor(signal);
  return {
    key: `quote:${quote.id}`,
    source: "quote",
    sourceRef: quote.id,
    workId: null,
    title: signal === "expiring" ? `Renew or close quote ${quote.number ?? ""}`.trim() : `Move quote ${quote.number ?? ""} forward`.trim(),
    subject: null,
    why: lead.label,
    impact: quote.value,
    consequence: signal === "expiring" ? "The quote lapses and pricing must be rebuilt." : null,
    lane,
    tier,
    signal,
    urgency: urgencyOf(tier, signal, quote.validUntil, now),
    dueAt: quote.validUntil,
    waitingOn:
      signal === "awaiting_approval" ? "Internal approver" : signal === "awaiting_customer" ? "Customer" : null,
    primaryAction: { label: "Open quote", to: quote.sourcePath },
    secondaryActions: [],
    evidence: [
      { fact: lead.label, from: "commercial_quotations.status" },
      ...(quote.validUntil ? [{ fact: `Valid until ${quote.validUntil}`, from: "commercial_quotations.valid_until" }] : []),
    ],
    minutes: 15,
    accountId: null,
  };
}

export function fromContract(contract: MyContract, now: Date = new Date()): WorkspaceItem | null {
  const lead = leadSignal(contract.signals);
  if (!lead) return null;
  const signal = LENS_SIGNAL[lead.kind];
  const tier = tierFromSeverity(lead.severity);
  return {
    key: `contract:${contract.id}`,
    source: "contract",
    sourceRef: contract.id,
    workId: null,
    title:
      signal === "awaiting_customer"
        ? `Chase signature — ${contract.customer ?? "contract"}`
        : `Complete internal review — ${contract.customer ?? "contract"}`,
    subject: contract.customer,
    why: lead.label,
    impact: null,
    consequence: "Service cannot start until the contract is executed.",
    lane: laneFor(signal),
    tier,
    signal,
    urgency: urgencyOf(tier, signal, contract.effectiveDate, now),
    dueAt: contract.effectiveDate,
    waitingOn: signal === "awaiting_customer" ? contract.customer ?? "Customer" : "Internal review",
    primaryAction: { label: "Open contract", to: contract.sourcePath },
    secondaryActions: [],
    evidence: [{ fact: `Status: ${contract.status}`, from: "commercial_contract_instances.status" }],
    minutes: 15,
    accountId: null,
  };
}

/** A promise made to a customer. Overdue promises outrank almost everything. */
export function fromCommitment(c: PersonalCommitment, now: Date = new Date()): WorkspaceItem | null {
  if (c.status !== "open" && c.status !== "in_progress") return null;
  const days = daysUntil(c.due_at, now);
  const overdue = days != null && days < 0;
  const inbound = c.direction === "customer_to_yalla";
  const signal: SignalKind = overdue ? "overdue" : inbound ? "awaiting_customer" : "scheduled";
  const tier: WorkTier = overdue ? "critical" : "high";
  return {
    key: `commitment:${c.id}`,
    source: "commitment",
    sourceRef: c.id,
    workId: c.work_item_id,
    title: c.commitment,
    subject: c.account_name,
    why: overdue
      ? "A promise you made to the customer is past its date."
      : inbound
        ? "Waiting on the customer to come back to us."
        : "A promise you made to the customer is still open.",
    impact: c.expected_outcome,
    consequence: overdue ? "Broken promises are the fastest way to lose a corporate account." : null,
    lane: inbound && !overdue ? "waiting" : days != null && days > 0 ? "upcoming" : "now",
    tier,
    signal,
    urgency: urgencyOf(tier, signal, c.due_at, now),
    dueAt: c.due_at,
    waitingOn: inbound ? c.account_name ?? "Customer" : null,
    primaryAction: {
      label: c.work_item_id ? "Open work" : "Open account",
      to: c.work_item_id ? `/staff/workspace?work=${c.work_item_id}` : `/staff/crm?account=${c.account_id}`,
    },
    secondaryActions: [],
    evidence: [
      { fact: `Promise direction: ${inbound ? "customer to SAFARID" : "SAFARID to customer"}`, from: "crm_commitments.direction" },
      ...(c.due_at ? [{ fact: `Due ${c.due_at}`, from: "crm_commitments.due_at" }] : []),
    ],
    minutes: 15,
    accountId: c.account_id,
  };
}

/**
 * A commercial record held at the approval gate. Minimal shape so this module
 * stays pure and free of data-layer imports.
 */
export interface ApprovalSignalInput {
  id: string;
  entityType: "proposal" | "contract" | "service_order";
  entityLabel: string;
  title: string;
  subject: string | null;
  amountLabel: string | null;
  requestedAt: string;
  /** The signed-in person raised it. */
  mine: boolean;
  /** The signed-in person may record the decision. */
  canApprove: boolean;
}

export function fromApproval(a: ApprovalSignalInput, now: Date = new Date()): WorkspaceItem | null {
  if (!a.canApprove && !a.mine) return null;
  const waitedDays = Math.max(0, Math.floor((now.getTime() - new Date(a.requestedAt).getTime()) / 86_400_000));
  const signal: SignalKind = a.canApprove ? "decision_required" : "awaiting_approval";
  const tier: WorkTier = a.canApprove ? (waitedDays >= 2 ? "critical" : "high") : waitedDays >= 3 ? "high" : "medium";
  return {
    key: `approval:${a.id}`,
    source: "approval",
    sourceRef: a.id,
    workId: null,
    title: a.canApprove ? `Decide: ${a.title}` : `Awaiting approval: ${a.title}`,
    subject: a.subject,
    why: a.canApprove
      ? `${a.entityLabel} raised for your decision${waitedDays > 0 ? `, waiting ${waitedDays} day${waitedDays === 1 ? "" : "s"}` : ""}.`
      : `Your ${a.entityLabel.toLowerCase()} cannot move until a manager decides.`,
    impact: a.amountLabel,
    consequence: a.canApprove
      ? "Nothing downstream can start until the decision is recorded."
      : "The customer waits while the internal gate is open.",
    lane: a.canApprove ? "now" : "waiting",
    tier,
    signal,
    urgency: urgencyOf(tier, signal, null, now),
    dueAt: null,
    waitingOn: a.canApprove ? null : "Internal approver",
    primaryAction: {
      label: a.canApprove ? "Record the decision" : "Open approvals",
      to: `/staff/workspace/approvals?approval=${a.id}`,
    },
    secondaryActions: [],
    evidence: [
      { fact: `${a.entityLabel} raised for approval`, from: "commercial_approvals.entity_type" },
      { fact: `Raised ${a.requestedAt.slice(0, 10)}`, from: "commercial_approvals.created_at" },
    ],
    minutes: a.canApprove ? 10 : 5,
    accountId: null,
  };
}

/* --------------------------------------------------------------- assembly */

export interface IntelligenceInput {
  assigned?: ScoredPersonalWork[];
  available?: AvailableAction[];
  opportunities?: MyOpportunity[];
  quotes?: MyQuote[];
  contracts?: MyContract[];
  approvals?: ApprovalSignalInput[];
  commitments?: PersonalCommitment[];
  now?: Date;
}


/**
 * Builds the single ordered work set. Deduped by key, sorted by urgency then
 * by shortest execution time so equally urgent work is cleared fastest.
 */
export function buildWorkspaceItems(input: IntelligenceInput): WorkspaceItem[] {
  const now = input.now ?? new Date();
  const items: WorkspaceItem[] = [
    ...(input.assigned ?? []).map((s) => fromAssignedWork(s, now)),
    ...(input.commitments ?? []).map((c) => fromCommitment(c, now)),
    ...(input.opportunities ?? []).map((o) => fromOpportunity(o, now)),
    ...(input.quotes ?? []).map((q) => fromQuote(q, now)),
    ...(input.contracts ?? []).map((c) => fromContract(c, now)),
    ...(input.approvals ?? []).map((a) => fromApproval(a, now)),

    ...(input.available ?? []).map((a) => fromAvailableAction(a, now)),
  ].filter((i): i is WorkspaceItem => i !== null);

  const seen = new Set<string>();
  const unique = items.filter((i) => (seen.has(i.key) ? false : (seen.add(i.key), true)));

  return unique.sort((a, b) => b.urgency - a.urgency || a.minutes - b.minutes || a.key.localeCompare(b.key));
}

export interface LaneView {
  now: WorkspaceItem[];
  waiting: WorkspaceItem[];
  upcoming: WorkspaceItem[];
  all: WorkspaceItem[];
}

export function groupByLane(items: WorkspaceItem[]): LaneView {
  return {
    now: items.filter((i) => i.lane === "now"),
    waiting: items.filter((i) => i.lane === "waiting"),
    upcoming: items.filter((i) => i.lane === "upcoming"),
    all: items,
  };
}

export type WorkloadLevel = "clear" | "light" | "moderate" | "heavy";

export interface WorkloadSummary {
  level: WorkloadLevel;
  actionable: number;
  minutes: number;
  /** Grouped counts so 17 items read as five decisions, not seventeen rows. */
  groups: { label: string; count: number }[];
}

const GROUP_LABEL: Record<SignalKind, string> = {
  overdue: "Overdue",
  decision_required: "Decisions for you",
  sla_risk: "At risk of breach",
  expiring: "Expiring",
  stalled: "Stalled",
  no_next_action: "Missing a next action",
  awaiting_customer: "Awaiting the customer",
  awaiting_approval: "Awaiting approval",
  unowned: "Unowned work you could take",
  scheduled: "Planned",
  healthy: "No action",
};

/** Workload from real minutes of actionable work, not a count of rows. */
export function workloadSummary(items: WorkspaceItem[]): WorkloadSummary {
  const actionable = items.filter((i) => i.lane === "now");
  const minutes = actionable.reduce((sum, i) => sum + i.minutes, 0);
  const level: WorkloadLevel =
    actionable.length === 0 ? "clear" : minutes <= 120 ? "light" : minutes <= 300 ? "moderate" : "heavy";

  const counts = new Map<SignalKind, number>();
  for (const i of actionable) counts.set(i.signal, (counts.get(i.signal) ?? 0) + 1);

  return {
    level,
    actionable: actionable.length,
    minutes,
    groups: [...counts.entries()]
      .sort((a, b) => SIGNAL_WEIGHT[b[0]] - SIGNAL_WEIGHT[a[0]])
      .map(([kind, count]) => ({ label: GROUP_LABEL[kind], count })),
  };
}

/**
 * A dependency chain the employee did not have to discover manually: who each
 * blocked item is waiting on, and how much work sits behind that party.
 */
export interface DependencyGroup {
  waitingOn: string;
  items: WorkspaceItem[];
  oldestDueAt: string | null;
}

export function dependencyGraph(items: WorkspaceItem[]): DependencyGroup[] {
  const map = new Map<string, WorkspaceItem[]>();
  for (const i of items) {
    if (i.lane !== "waiting" || !i.waitingOn) continue;
    map.set(i.waitingOn, [...(map.get(i.waitingOn) ?? []), i]);
  }
  return [...map.entries()]
    .map(([waitingOn, group]) => ({
      waitingOn,
      items: group.sort((a, b) => b.urgency - a.urgency),
      oldestDueAt:
        group
          .map((g) => g.dueAt)
          .filter((d): d is string => !!d)
          .sort()[0] ?? null,
    }))
    .sort((a, b) => b.items.length - a.items.length);
}

/** The single highest-value thing to do next, with its explanation attached. */
export function nextBestItem(items: WorkspaceItem[]): WorkspaceItem | null {
  return items.find((i) => i.lane === "now") ?? null;
}
