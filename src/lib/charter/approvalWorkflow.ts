/**
 * Charter approval chain workflow.
 *
 * A charter mission is authorised by the corporate organisation, step by step:
 * procurement prepares it, the approving authority signs, an optional
 * counter-signatory confirms, then finance releases settlement. Each step
 * tracks its own status, assignee and decision trail, and every transition
 * fires an email notification to the next approver.
 */
import { supabase } from "@/integrations/supabase/client";
import type { ProcurementDetails } from "./corporateApproval";

export type ApprovalStepStatus = "pending" | "in_review" | "approved" | "rejected" | "skipped";

export interface ApprovalStep {
  id: string;
  title: string;
  role: string;
  assigneeName: string;
  assigneeEmail: string;
  status: ApprovalStepStatus;
  note: string;
  decidedAt: string | null;
  /** Only an approving officer or administrator may action this step. */
  requiresApprover: boolean;
}

export interface ApprovalWorkflow {
  reference: string;
  missionLabel: string;
  amountKes: number;
  createdAt: string;
  steps: ApprovalStep[];
}

const STORAGE_KEY = "yalla.charter.portal.approvals.v1";

export const STEP_STATUS_LABEL: Record<ApprovalStepStatus, string> = {
  pending: "Pending",
  in_review: "In review",
  approved: "Approved",
  rejected: "Rejected",
  skipped: "Not required",
};

export const STEP_STATUS_CLASS: Record<ApprovalStepStatus, string> = {
  pending: "bg-muted text-muted-foreground border-border",
  in_review: "bg-primary/15 text-primary border-primary/30",
  approved: "bg-primary/15 text-primary border-primary/30",
  rejected: "bg-destructive/15 text-destructive border-destructive/30",
  skipped: "bg-muted text-muted-foreground border-border",
};

const step = (
  id: string, title: string, role: string, assigneeName: string, assigneeEmail: string,
  requiresApprover: boolean, status: ApprovalStepStatus = "pending",
): ApprovalStep => ({ id, title, role, assigneeName, assigneeEmail, status, note: "", decidedAt: null, requiresApprover });

/** Builds the chain from the procurement spine — no field is retyped. */
export function buildWorkflow(
  p: ProcurementDetails,
  mission: { reference: string; label: string; amountKes: number },
): ApprovalWorkflow {
  const billingEmail = (p.billingContactEmail ?? "").trim();
  const steps: ApprovalStep[] = [
    step("prepare", "Procurement prepared", "Procurement officer", p.billingContactName?.trim() || "Procurement officer", billingEmail, false, "approved"),
    step("authorise", "Approving authority sign-off", p.approverTitle.trim() || "Authorised signatory", p.approverName.trim() || "Approving authority", billingEmail, true, "in_review"),
  ];
  if (p.secondApprover.trim()) {
    steps.push(step("countersign", "Counter-signatory confirmation", "Counter-signatory", p.secondApprover.trim(), billingEmail, true));
  }
  steps.push(
    step(
      "settlement",
      p.useCorporateWallet ? "Wallet settlement release" : "Invoice settlement release",
      "Finance",
      p.billingContactName?.trim() || "Accounts payable",
      billingEmail,
      true,
    ),
  );
  return {
    reference: mission.reference,
    missionLabel: mission.label,
    amountKes: mission.amountKes,
    createdAt: new Date().toISOString(),
    steps,
  };
}

export const currentStep = (w: ApprovalWorkflow): ApprovalStep | null =>
  w.steps.find((s) => s.status === "in_review" || s.status === "pending") ?? null;

export const workflowStatus = (w: ApprovalWorkflow): "approved" | "rejected" | "in_progress" => {
  if (w.steps.some((s) => s.status === "rejected")) return "rejected";
  return w.steps.every((s) => s.status === "approved" || s.status === "skipped") ? "approved" : "in_progress";
};

export const workflowProgress = (w: ApprovalWorkflow) => {
  const done = w.steps.filter((s) => s.status === "approved" || s.status === "skipped").length;
  return Math.round((done / Math.max(1, w.steps.length)) * 100);
};

/** Applies a decision and promotes the next step into review. */
export function decideStep(
  w: ApprovalWorkflow,
  stepId: string,
  decision: "approved" | "rejected",
  note: string,
): ApprovalWorkflow {
  const steps = w.steps.map((s) =>
    s.id === stepId ? { ...s, status: decision, note, decidedAt: new Date().toISOString() } : s,
  );
  if (decision === "approved") {
    const next = steps.find((s) => s.status === "pending");
    if (next) next.status = "in_review";
  }
  return { ...w, steps };
}

export function assignStep(w: ApprovalWorkflow, stepId: string, name: string, email: string): ApprovalWorkflow {
  return { ...w, steps: w.steps.map((s) => (s.id === stepId ? { ...s, assigneeName: name, assigneeEmail: email } : s)) };
}

export function loadWorkflow(): ApprovalWorkflow | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ApprovalWorkflow) : null;
  } catch {
    return null;
  }
}

export function saveWorkflow(w: ApprovalWorkflow | null) {
  try {
    if (!w) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(w));
  } catch {
    /* storage unavailable — the workflow still works for this session */
  }
}

/**
 * Emails the approver assigned to an approval step. Best effort: a failed
 * notification never blocks the authorisation itself.
 */
export async function notifyApprovalStep(
  w: ApprovalWorkflow,
  s: ApprovalStep,
  kind: "assigned" | "approved" | "rejected",
): Promise<{ ok: boolean; error?: string }> {
  if (!s.assigneeEmail) return { ok: false, error: "no_recipient" };
  try {
    const { error } = await supabase.functions.invoke("send-transactional-email", {
      body: {
        templateName: "contact-internal-notification",
        recipientEmail: s.assigneeEmail,
        idempotencyKey: `charter-approval-${w.reference}-${s.id}-${kind}`,
        templateData: {
          name: s.assigneeName,
          subject: `Charter approval ${kind}: ${w.missionLabel}`,
          message: [
            `Mission: ${w.missionLabel}`,
            `Reference: ${w.reference}`,
            `Step: ${s.title} (${s.role})`,
            `Status: ${STEP_STATUS_LABEL[s.status]}`,
            `Value: KSh ${Math.round(w.amountKes).toLocaleString("en-KE")}`,
            s.note ? `Note: ${s.note}` : "",
          ].filter(Boolean).join("\n"),
          type: "sales",
        },
      },
    });
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "notification_failed" };
  }
}
