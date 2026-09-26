/**
 * OPERATOR WITHDRAWAL APPROVAL WORKFLOW.
 *
 * A withdrawal is never "approved in the desk" by one click. It travels a real
 * control path, exactly as enterprise mobility, charter and logistics operators
 * run their disbursements:
 *
 *   submitted → automated pre-release screening → one or two named approvals
 *   (four-eyes, by value band) → release for payment by a separate person →
 *   sent over M-Pesa B2C → paid only on Safaricom's own confirmation.
 *
 * Every step is decided in the database (`provider_payout_screen`,
 * `provider_payout_approve`, `provider_payout_reject`, `provider_payout_release`)
 * and recorded on an append-only trail. The browser only asks.
 */
import { supabase } from "@/integrations/supabase/client";
import { explainSettlementRefusal, type PayoutState } from "@/lib/provider/settlement";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type CheckResult = "PASS" | "WARN" | "FAIL";

export interface PayoutCheck {
  check_key: string;
  label: string;
  result: CheckResult;
  detail: Record<string, unknown>;
}

export interface PayoutApproval {
  level: number;
  actor_user_id: string;
  note: string | null;
  decided_at: string;
}

export interface PayoutEvent {
  event_type: string;
  state_from: string | null;
  state_to: string | null;
  note: string | null;
  actor_user_id: string | null;
  created_at: string;
}

export interface WorkflowRequest {
  id: string;
  reference: string;
  provider_user_id: string;
  msisdn: string;
  gross_cents: number | null;
  fee_cents: number | null;
  amount_cents: number;
  currency: string;
  state: PayoutState;
  tier_label: string | null;
  required_approvals: number;
  approvals_count: number;
  requires_dual_release: boolean;
  screening_state: "PENDING" | "PASS" | "FLAGGED";
  hold_reason: string | null;
  submitted_at: string;
  sla_due_at: string | null;
  released_at: string | null;
  released_by: string | null;
  paid_at: string | null;
  provider_transaction_id: string | null;
  failure_reason: string | null;
  viewer_has_approved: boolean;
  approvals: PayoutApproval[];
  checks: PayoutCheck[];
  events: PayoutEvent[];
}

export interface PayoutTier {
  label: string;
  min_cents: number;
  max_cents: number | null;
  required_approvals: number;
  requires_dual_release: boolean;
  sla_hours: number;
}

export interface PayoutWorkflowConsole {
  can_decide: boolean;
  tiers: PayoutTier[];
  summary: {
    on_hold: number;
    awaiting_approval: number;
    awaiting_release: number;
    in_flight: number;
    sla_breached: number;
  };
  requests: WorkflowRequest[];
}

const WORKFLOW_REFUSAL: Record<string, string> = {
  SCREENING_REQUIRED: "Run the pre-release checks before approving this withdrawal.",
  PAYOUT_ON_HOLD: "This withdrawal is on hold — clear the failed checks first.",
  SECOND_APPROVER_REQUIRED: "A different approver has to give the next approval.",
  SELF_APPROVAL_FORBIDDEN: "You cannot approve your own withdrawal.",
  SEPARATE_RELEASER_REQUIRED: "At this value, someone other than the approvers must release the money.",
  REJECTION_REASON_REQUIRED: "Give a reason before rejecting a withdrawal.",
  PAYOUT_NOT_RELEASED: "Release the withdrawal for payment before sending it.",
  PAYOUT_ALREADY_RELEASED: "This withdrawal has already been released for payment.",
};

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) {
    const raw = error.message ?? "";
    const key = Object.keys(WORKFLOW_REFUSAL).find((k) => raw.includes(k));
    throw new Error(key ? WORKFLOW_REFUSAL[key] : explainSettlementRefusal(raw));
  }
  return data as T;
}

export const loadPayoutWorkflow = () =>
  rpc<PayoutWorkflowConsole>("provider_payout_workflow_console");

/** Re-run the automated pre-release checks (also used to clear a hold). */
export const screenPayout = (requestId: string) =>
  rpc<{ ok: boolean; failures: number; warnings: number; state: PayoutState }>(
    "provider_payout_screen",
    { _request_id: requestId },
  );

/** Record one named approval. The same person can never approve twice. */
export const approvePayout = (requestId: string, note?: string) =>
  rpc<{ ok: boolean; state: PayoutState; level: number; approvals_outstanding: number }>(
    "provider_payout_approve",
    { _request_id: requestId, _note: note?.trim() || null },
  );

/** Reject with a reason; the full amount returns to the operator's balance. */
export const rejectPayout = (requestId: string, note: string) =>
  rpc<{ ok: boolean; state: PayoutState }>("provider_payout_reject", {
    _request_id: requestId,
    _note: note,
  });

/** Release an approved withdrawal for payment (separation of duties). */
export const releasePayout = (requestId: string, note?: string) =>
  rpc<{ ok: boolean; released: boolean }>("provider_payout_release", {
    _request_id: requestId,
    _note: note?.trim() || null,
  });

/* --------------------------- pure reading helpers -------------------------- */

export type WorkflowStage =
  | "SUBMITTED"
  | "SCREENED"
  | "APPROVED"
  | "RELEASED"
  | "SENT"
  | "PAID";

export const WORKFLOW_STAGES: { key: WorkflowStage; label: string }[] = [
  { key: "SUBMITTED", label: "Submitted" },
  { key: "SCREENED", label: "Checked" },
  { key: "APPROVED", label: "Approved" },
  { key: "RELEASED", label: "Released" },
  { key: "SENT", label: "Sent" },
  { key: "PAID", label: "Paid" },
];

/** How far along the control path this withdrawal is. */
export function stageIndex(r: WorkflowRequest): number {
  if (r.state === "PAID") return 5;
  if (r.state === "PROCESSING") return 4;
  if (r.released_at) return 3;
  if (r.state === "APPROVED") return 2;
  if (r.screening_state !== "PENDING") return 1;
  return 0;
}

/** The single action this withdrawal is waiting on, in plain words. */
export function nextAction(r: WorkflowRequest): string {
  switch (r.state) {
    case "PENDING_SCREENING":
      return "Run the pre-release checks";
    case "ON_HOLD":
      return r.hold_reason ?? "Clear the failed checks";
    case "PENDING_APPROVAL":
      return `${r.required_approvals - r.approvals_count} more approval${
        r.required_approvals - r.approvals_count === 1 ? "" : "s"
      } needed`;
    case "APPROVED":
      return r.released_at ? "Send to M-Pesa" : "Release for payment";
    case "PROCESSING":
      return "Awaiting Safaricom confirmation";
    case "PAID":
      return "Complete";
    case "FAILED":
      return r.failure_reason ?? "Failed — amount returned to the operator";
    default:
      return "Closed";
  }
}

export const isOpen = (r: WorkflowRequest) =>
  ["PENDING_SCREENING", "ON_HOLD", "PENDING_APPROVAL", "APPROVED", "PROCESSING"].includes(r.state);

/** Response-time state against the band's target. */
export function slaReading(
  r: WorkflowRequest,
  now: Date = new Date(),
): { tone: "healthy" | "watch" | "risk"; label: string } {
  if (!r.sla_due_at || !isOpen(r)) return { tone: "healthy", label: "—" };
  const ms = new Date(r.sla_due_at).getTime() - now.getTime();
  const hours = Math.round(Math.abs(ms) / 3_600_000);
  if (ms < 0) return { tone: "risk", label: `Overdue by ${hours}h` };
  if (ms < 2 * 3_600_000) return { tone: "watch", label: `Due in ${hours}h` };
  return { tone: "healthy", label: `Due in ${hours}h` };
}

export const failedChecks = (r: WorkflowRequest) => r.checks.filter((c) => c.result === "FAIL");
export const warnChecks = (r: WorkflowRequest) => r.checks.filter((c) => c.result === "WARN");
