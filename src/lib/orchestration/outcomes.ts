/**
 * SAFARID orchestration — permitted canonical outcomes.
 *
 * A staff member never edits a canonical record directly. They choose one of a
 * FIXED set of outcomes for the entity the work refers to, and the server
 * (`ops_apply_writeback`) applies the same whitelist. This module mirrors the
 * SQL catalogue so the UI can only offer what the database will accept — parity
 * is asserted by `outcomes.test.ts`.
 */
export interface OutcomeSpec {
  outcome: string;
  label: string;
  /** Canonical status written back, when the outcome changes state. */
  status?: string;
  /** Requires a recorded authority decision before it can be applied. */
  requiresApproval: boolean;
  destructive?: boolean;
}

const RECORD_ONLY: OutcomeSpec = {
  outcome: "no_change",
  label: "Record decision only",
  requiresApproval: false,
};

export const WRITEBACK_CATALOG: Record<string, OutcomeSpec[]> = {
  trip: [
    { outcome: "trip_reinstated", label: "Return the trip to dispatch", status: "pending", requiresApproval: false },
    { outcome: "trip_cancelled", label: "Cancel the trip", status: "cancelled", requiresApproval: true, destructive: true },
    RECORD_ONLY,
  ],
  delivery: [
    { outcome: "delivery_reattempt", label: "Reattempt the delivery", status: "pending", requiresApproval: false },
    { outcome: "delivery_returned", label: "Return the consignment", status: "cancelled", requiresApproval: true, destructive: true },
    RECORD_ONLY,
  ],
  charter_booking: [
    { outcome: "charter_confirmed", label: "Confirm the charter", status: "confirmed", requiresApproval: false },
    { outcome: "charter_cancelled", label: "Cancel the charter", status: "cancelled", requiresApproval: true, destructive: true },
    RECORD_ONLY,
  ],
  document: [
    { outcome: "document_approved", label: "Approve the document", status: "approved", requiresApproval: false },
    { outcome: "document_rejected", label: "Reject the document", status: "rejected", requiresApproval: true, destructive: true },
    RECORD_ONLY,
  ],
};

export function outcomesFor(entityType?: string | null): OutcomeSpec[] {
  if (!entityType) return [RECORD_ONLY];
  return WRITEBACK_CATALOG[entityType] ?? [RECORD_ONLY];
}

export type ApprovalState = "not_required" | "pending" | "requested" | "approved" | "declined";

export const APPROVAL_LABEL: Record<ApprovalState, string> = {
  not_required: "No approval required",
  pending: "Approval pending",
  requested: "Awaiting decision",
  approved: "Approved",
  declined: "Declined",
};

/**
 * Client-side pre-check mirroring the server rule: an outcome that carries
 * authority — or work flagged as needing approval — cannot be applied until a
 * different authorised person has approved it.
 */
export function canApplyOutcome(args: {
  spec: OutcomeSpec;
  needsApproval: boolean;
  approvalState: ApprovalState;
  alreadyApplied: boolean;
  reason: string;
}): { allowed: boolean; reason?: string } {
  if (args.alreadyApplied) return { allowed: false, reason: "An outcome has already been written back." };
  if (!args.reason.trim()) return { allowed: false, reason: "Record a reason before writing the outcome back." };
  if ((args.spec.requiresApproval || args.needsApproval) && args.approvalState !== "approved") {
    return { allowed: false, reason: "This outcome requires a recorded approval first." };
  }
  return { allowed: true };
}

/** Maker-checker: the requester may never decide their own approval. */
export function canDecideApproval(args: {
  approvalState: ApprovalState;
  requestedBy: string | null;
  actorUserId: string | null;
}): { allowed: boolean; reason?: string } {
  if (!["requested", "pending"].includes(args.approvalState)) {
    return { allowed: false, reason: "No approval is awaiting a decision." };
  }
  if (args.requestedBy && args.requestedBy === args.actorUserId) {
    return { allowed: false, reason: "Approval must be decided by a different authorised person." };
  }
  return { allowed: true };
}
