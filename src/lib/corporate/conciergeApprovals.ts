/**
 * Concierge → approval workflow bridge.
 *
 * Turns a deterministic `ConciergeReply` into a real approval request:
 *  - the pure part builds a draft (amount, justification, supporting policy /
 *    contract clauses retrieved from the corporate knowledge base and the
 *    workflow chain computed by the workflow engine);
 *  - the submit part persists it into `approval_requests` so it appears in the
 *    corporate pending-approvals queues.
 */
import { supabase } from "@/integrations/supabase/client";
import { untypedDb } from "@/integrations/supabase/untyped";
import { auditFromDraft } from "@/lib/corporate/conciergeApprovalAudit";
import { searchKnowledge, type KnowledgeArticle } from "@/lib/knowledge/corporateKnowledgeBase";
import { startWorkflow, type WorkflowInstance } from "@/lib/platform/workflowEngine";
import type { ConciergeReply } from "@/lib/marketing/mobilityConcierge";

export interface ApprovalClause {
  id: string;
  title: string;
  category: KnowledgeArticle["category"];
  clause: string;
}

export interface ApprovalDraft {
  reference: string;
  amountKes: number;
  passengers: number | null;
  days: number;
  justification: string;
  clauses: ApprovalClause[];
  workflow: WorkflowInstance;
  chain: string[];
}

const AMOUNT_RE = /(?:ksh|kes)\s*([\d,]+(?:\.\d+)?)|([\d,]{4,})/i;

/** Best-effort amount extraction from the prompt or the concierge answer. */
export function extractAmountKes(prompt: string, reply: ConciergeReply): number {
  const haystack = [prompt, ...reply.lines].join(" ");
  const m = AMOUNT_RE.exec(haystack);
  const raw = m?.[1] ?? m?.[2];
  const parsed = raw ? Number(raw.replace(/,/g, "")) : 0;
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

/** Retrieves supporting policy/contract clauses for the request. */
export function supportingClauses(prompt: string, limit = 3): ApprovalClause[] {
  return searchKnowledge(prompt, limit).map((hit) => ({
    id: hit.article.id,
    title: hit.article.title,
    category: hit.article.category,
    clause: hit.article.body.find((l) => l.trim().length > 0) ?? hit.article.summary,
  }));
}

export function buildApprovalDraft(input: {
  prompt: string;
  reply: ConciergeReply;
  corporateId?: string | null;
  requesterLabel?: string;
  id?: string;
  at?: string;
}): ApprovalDraft {
  const { prompt, reply } = input;
  const amountKes = extractAmountKes(prompt, reply);
  const passengers = reply.slots.passengers ?? null;
  const days = reply.slots.days ?? 1;
  const clauses = supportingClauses(prompt);
  const id = input.id ?? `capr-${Date.now().toString(36)}`;
  const reference = `CONCIERGE-${id.slice(-8).toUpperCase()}`;

  const workflow = startWorkflow({
    id,
    definitionKey: "employee_booking",
    subjectRef: reference,
    corporateId: input.corporateId ?? null,
    at: input.at,
    context: {
      amountKes,
      passengers,
      days,
      source: "mobility_concierge",
      intent: reply.intent,
      prompt,
      vehicle: reply.vehicleKey ?? null,
      clauses: clauses.map((c) => c.id),
    },
  });

  const justification = [
    `Requested via mobility concierge by ${input.requesterLabel ?? "corporate user"}.`,
    `Request: ${prompt}`,
    passengers ? `Passengers: ${passengers}` : null,
    `Duration: ${days} day(s)`,
    amountKes ? `Estimated value: KES ${amountKes.toLocaleString("en-KE")}` : "Estimated value: pending pricing",
    clauses.length ? `Supporting clauses: ${clauses.map((c) => c.title).join("; ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    reference,
    amountKes,
    passengers,
    days,
    justification,
    clauses,
    workflow,
    chain: workflow.steps.filter((s) => s.status !== "skipped").map((s) => s.label),
  };
}

export interface SubmitResult {
  ok: boolean;
  requestId?: string;
  reference: string;
  error?: string;
}

/**
 * Persists the draft as a pending approval request. Requires an authenticated
 * corporate session — RLS decides whether the caller may write.
 */
export async function submitApprovalDraft(
  draft: ApprovalDraft,
  corporateId: string,
): Promise<SubmitResult> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth?.user?.id;
    if (!userId) return { ok: false, reference: draft.reference, error: "not_authenticated" };

    // Immutable audit: what the concierge drafted, before anything is written.
    await auditFromDraft("drafted", draft, { corporateId, toStatus: "DRAFT" });

    const { data: wf, error: wfErr } = await untypedDb
      .from("approval_workflows")
      .select("id")
      .eq("corporate_id", corporateId)
      .eq("active", true)
      .limit(1);
    if (wfErr) {
      await auditFromDraft("submit_failed", draft, {
        corporateId, payload: { error: wfErr.message },
      });
      return { ok: false, reference: draft.reference, error: wfErr.message };
    }
    const workflowId = (wf ?? [])[0]?.id as string | undefined;
    if (!workflowId) {
      await auditFromDraft("submit_failed", draft, {
        corporateId, payload: { error: "no_active_approval_workflow" },
      });
      return { ok: false, reference: draft.reference, error: "no_active_approval_workflow" };
    }

    const { data, error } = await untypedDb
      .from("approval_requests")
      .insert({
        corporate_id: corporateId,
        workflow_id: workflowId,
        requested_by: userId,
        amount_cents: Math.round(draft.amountKes * 100),
        status: "PENDING",
        reference: draft.reference,
        justification: draft.justification,
        metadata: {
          source: "mobility_concierge",
          clauses: draft.clauses,
          chain: draft.chain,
          workflow_context: draft.workflow.context,
        },
      })
      .select("id")
      .single();
    if (error) {
      await auditFromDraft("submit_failed", draft, {
        corporateId, payload: { error: error.message },
      });
      return { ok: false, reference: draft.reference, error: error.message };
    }
    const requestId = (data as { id: string }).id;
    await auditFromDraft("submitted", draft, {
      corporateId, requestId, fromStatus: "DRAFT", toStatus: "PENDING",
    });
    return { ok: true, reference: draft.reference, requestId };
  } catch (e) {
    return { ok: false, reference: draft.reference, error: e instanceof Error ? e.message : "submit_failed" };
  }
}
