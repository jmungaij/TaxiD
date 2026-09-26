import { supabase } from "@/integrations/supabase/client";

/**
 * PERSONAL WORK ENGINE (client bindings).
 *
 * Every function here calls an authoritative server routine. Work is created
 * for the signed-in employee only, outcomes are recorded atomically together
 * with the customer timeline, and "available actions" are real records that
 * need someone — never invented suggestions.
 */

export type WorkKind =
  | "sales_opportunity"
  | "customer_case"
  | "operations_task"
  | "document_review"
  | "reconciliation"
  | "admin_task"
  | "training";

export type WorkPriority = "critical" | "high" | "medium" | "low";

export type WorkTemplate = {
  key: string;
  label: string;
  helper: string;
  workKind: WorkKind;
  priority: WorkPriority;
  minutes: number;
  requiredAction: string;
};

/** Role-aware catalogue of the work an employee can raise for themselves. */
const SALES: WorkTemplate[] = [
  {
    key: "prospect_call",
    label: "Prospect call",
    helper: "Reach a new corporate decision maker",
    workKind: "sales_opportunity",
    priority: "high",
    minutes: 15,
    requiredAction: "Call the prospect and record the outcome",
  },
  {
    key: "follow_up",
    label: "Customer follow-up",
    helper: "Chase a quotation, contract or rate card",
    workKind: "sales_opportunity",
    priority: "high",
    minutes: 10,
    requiredAction: "Follow up and confirm the next commercial step",
  },
  {
    key: "proposal",
    label: "Prepare proposal / quotation",
    helper: "Build a priced offer from the rate card",
    workKind: "sales_opportunity",
    priority: "medium",
    minutes: 45,
    requiredAction: "Prepare and issue the priced proposal",
  },
  {
    key: "meeting",
    label: "Customer meeting",
    helper: "Scheduled discussion with an account",
    workKind: "customer_case",
    priority: "high",
    minutes: 60,
    requiredAction: "Hold the meeting and record what was agreed",
  },
];

const OPS: WorkTemplate[] = [
  {
    key: "ops_task",
    label: "Operations task",
    helper: "Dispatch, fleet or service execution work",
    workKind: "operations_task",
    priority: "medium",
    minutes: 20,
    requiredAction: "Complete the operational task and record the result",
  },
  {
    key: "customer_issue",
    label: "Customer issue",
    helper: "Resolve a live service problem",
    workKind: "customer_case",
    priority: "high",
    minutes: 20,
    requiredAction: "Resolve the issue and confirm with the customer",
  },
  {
    key: "document_review",
    label: "Document review",
    helper: "Verify a compliance or KYB document",
    workKind: "document_review",
    priority: "medium",
    minutes: 15,
    requiredAction: "Review the document and record the decision",
  },
];

const FINANCE: WorkTemplate[] = [
  {
    key: "reconciliation",
    label: "Reconciliation",
    helper: "Investigate a settlement or wallet variance",
    workKind: "reconciliation",
    priority: "high",
    minutes: 30,
    requiredAction: "Reconcile the variance and record the finding",
  },
  {
    key: "invoice_follow_up",
    label: "Invoice / collection follow-up",
    helper: "Chase an outstanding corporate invoice",
    workKind: "customer_case",
    priority: "high",
    minutes: 15,
    requiredAction: "Follow up on payment and record the commitment",
  },
];

const GENERAL: WorkTemplate[] = [
  {
    key: "admin_task",
    label: "Internal / admin task",
    helper: "Work you own that is not customer facing",
    workKind: "admin_task",
    priority: "low",
    minutes: 20,
    requiredAction: "Complete the task and record the result",
  },
  {
    key: "training",
    label: "Training / capability",
    helper: "Certification or onboarding activity",
    workKind: "training",
    priority: "low",
    minutes: 30,
    requiredAction: "Complete the training and record completion",
  },
];

/**
 * Templates are ordered by relevance to the employee's role family so the
 * first option is almost always the right one.
 */
export function workTemplatesFor(roleKey: string | null | undefined): WorkTemplate[] {
  const key = (roleKey ?? "").toLowerCase();
  if (/(sales|commercial|account|growth|partner)/.test(key)) return [...SALES, ...OPS, ...GENERAL];
  if (/(finance|revenue|treasury|tax|billing)/.test(key)) return [...FINANCE, ...OPS, ...GENERAL];
  if (/(ops|operation|dispatch|fleet|support|service|compliance)/.test(key))
    return [...OPS, ...SALES, ...GENERAL];
  return [...OPS, ...SALES, ...FINANCE, ...GENERAL];
}

export type CreateSelfWorkInput = {
  workKind: WorkKind;
  title: string;
  requiredAction?: string;
  priority?: WorkPriority;
  dueAt?: string | null;
  description?: string | null;
  accountId?: string | null;
  contactId?: string | null;
  opportunityId?: string | null;
  serviceLine?: string | null;
};

export async function createSelfWork(
  input: CreateSelfWorkInput,
): Promise<{ ok: true; workItemId: string } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("staff_work_create_self", {
    p_work_kind: input.workKind,
    p_title: input.title.trim(),
    p_required_action: input.requiredAction ?? null,
    p_priority: input.priority ?? "medium",
    p_due_at: input.dueAt ?? null,
    p_description: input.description ?? null,
    p_account_id: input.accountId ?? null,
    p_contact_id: input.contactId ?? null,
    p_opportunity_id: input.opportunityId ?? null,
    p_service_line: input.serviceLine ?? null,
    p_ops_queue: null,
  });
  if (error) return { ok: false, error: humanise(error.message) };
  return { ok: true, workItemId: data as unknown as string };
}

export type RecordOutcomeInput = {
  workItemId: string;
  outcome: string;
  notes?: string | null;
  interactionType?: string | null;
  sentiment?: string | null;
  contactId?: string | null;
  opportunityId?: string | null;
  nextActionTitle?: string | null;
  nextActionDue?: string | null;
  nextActionKind?: WorkKind | null;
  nextActionPriority?: WorkPriority;
};

export type RecordedOutcome = {
  ok: true;
  accountId: string | null;
  interactionId: string | null;
  nextWorkItemId: string | null;
};

export async function recordWorkOutcomeRpc(
  input: RecordOutcomeInput,
): Promise<RecordedOutcome | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("staff_work_record_outcome", {
    p_work_item_id: input.workItemId,
    p_outcome: input.outcome,
    p_notes: input.notes ?? null,
    p_interaction_type: input.interactionType ?? null,
    p_sentiment: input.sentiment ?? null,
    p_contact_id: input.contactId ?? null,
    p_opportunity_id: input.opportunityId ?? null,
    p_next_action_title: input.nextActionTitle ?? null,
    p_next_action_due: input.nextActionDue ?? null,
    p_next_action_kind: input.nextActionKind ?? null,
    p_next_action_priority: input.nextActionPriority ?? "medium",
  });
  if (error) return { ok: false, error: humanise(error.message) };
  const row = (data ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    accountId: (row.account_id as string) ?? null,
    interactionId: (row.interaction_id as string) ?? null,
    nextWorkItemId: (row.next_work_item_id as string) ?? null,
  };
}

export type AvailableAction = {
  kind: string;
  title: string;
  reason: string;
  accountId: string | null;
  accountName: string | null;
  opportunityId: string | null;
  referenceId: string | null;
  priority: WorkPriority;
  valueScore: number;
  suggestedMinutes: number;
};

/** Real records that need an owner — used instead of an empty "nothing to do". */
export async function fetchAvailableActions(limit = 8): Promise<AvailableAction[]> {
  const { data, error } = await supabase.rpc("staff_available_actions", { p_limit: limit });
  if (error) throw new Error(humanise(error.message));
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    kind: String(r.kind ?? "action"),
    title: String(r.title ?? "Untitled action"),
    reason: String(r.reason ?? ""),
    accountId: (r.account_id as string) ?? null,
    accountName: (r.account_name as string) ?? null,
    opportunityId: (r.opportunity_id as string) ?? null,
    referenceId: (r.reference_id as string) ?? null,
    priority: ((r.priority as WorkPriority) ?? "medium") as WorkPriority,
    valueScore: Number(r.value_score ?? 0),
    suggestedMinutes: Number(r.suggested_minutes ?? 15),
  }));
}

export type AccountOption = { id: string; name: string };

/** Account lookup for linking self-created work to a real customer. */
export async function searchAccounts(query: string): Promise<AccountOption[]> {
  const q = query.trim();
  let builder = supabase.from("crm_accounts").select("id,name").order("name").limit(8);
  if (q) builder = builder.ilike("name", `%${q}%`);
  const { data, error } = await builder;
  if (error) throw new Error(humanise(error.message));
  return ((data ?? []) as { id: string; name: string }[]).map((a) => ({ id: a.id, name: a.name }));
}

/** Map an available action onto the work it should create. */
export function actionToWork(action: AvailableAction): CreateSelfWorkInput {
  const kind: WorkKind =
    action.kind === "dormant_account" || action.kind === "stalled_opportunity"
      ? "sales_opportunity"
      : action.kind === "unowned_case"
        ? "customer_case"
        : "operations_task";
  return {
    workKind: kind,
    title: action.title,
    requiredAction: action.reason,
    priority: action.priority,
    accountId: action.accountId,
    opportunityId: action.opportunityId,
    description: `Raised from available capacity — ${action.reason}`,
  };
}

const MESSAGES: Record<string, string> = {
  not_authenticated: "Please sign in again.",
  no_staff_identity: "Your staff profile isn't linked yet, so work can't be assigned to you.",
  title_required: "Give the work a title.",
  outcome_required: "Choose what happened before saving.",
  work_item_not_found: "That work item no longer exists.",
  not_your_work_item: "Only the employee who owns this work can record its outcome.",
};

function humanise(message: string): string {
  for (const [code, text] of Object.entries(MESSAGES)) if (message.includes(code)) return text;
  return message;
}
