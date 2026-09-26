/**
 * RFQ / quotation approval workflow.
 *
 * One canonical status machine shared by the Corporate Charter Business
 * Operations Centre and the quote surfaces. Transitions are explicit so an
 * audit entry can always name the exact `from → to` move, and so the UI can
 * disable actions that are not legal for the current state or the actor's
 * commercial authority.
 */

export const RFQ_STATUSES = [
  "draft",
  "submitted",
  "under_review",
  "approved",
  "rejected",
  "won",
  "cancelled",
] as const;

export type RfqStatus = (typeof RFQ_STATUSES)[number];

export const RFQ_STATUS_LABEL: Record<RfqStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  under_review: "Under review",
  approved: "Approved",
  rejected: "Rejected",
  won: "Won",
  cancelled: "Cancelled",
};

/** Terminal states carry no further transitions. */
export const RFQ_TERMINAL: RfqStatus[] = ["won", "cancelled", "rejected"];

export interface RfqTransition {
  to: RfqStatus;
  label: string;
  /** Requires commercial (admin) authority rather than operator scope. */
  commercial: boolean;
  /** Destructive / negative outcome — rendered as a quiet action. */
  negative?: boolean;
}

const TRANSITIONS: Record<RfqStatus, RfqTransition[]> = {
  draft: [{ to: "submitted", label: "Submit for review", commercial: false }],
  submitted: [
    { to: "under_review", label: "Start review", commercial: false },
    { to: "cancelled", label: "Cancel", commercial: true, negative: true },
  ],
  under_review: [
    { to: "approved", label: "Approve", commercial: true },
    { to: "rejected", label: "Reject", commercial: true, negative: true },
  ],
  approved: [
    { to: "won", label: "Mark won", commercial: true },
    { to: "cancelled", label: "Cancel", commercial: true, negative: true },
  ],
  rejected: [],
  won: [],
  cancelled: [],
};

/** Normalise any stored/legacy status token to the canonical machine. */
export function normalizeRfqStatus(input: unknown): RfqStatus {
  const key = String(input ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if ((RFQ_STATUSES as readonly string[]).includes(key)) return key as RfqStatus;
  if (key === "pending" || key === "new" || key === "requested") return "submitted";
  if (key === "review" || key === "reviewing") return "under_review";
  if (key === "accepted" || key === "authorised" || key === "authorized") return "approved";
  if (key === "declined" || key === "denied") return "rejected";
  if (key === "paid" || key === "converted") return "won";
  if (key === "void" || key === "expired") return "cancelled";
  return "draft";
}

/** Legal transitions from a status, filtered by the actor's authority. */
export function rfqTransitions(status: RfqStatus, canManageCommercial: boolean): RfqTransition[] {
  return TRANSITIONS[status].filter((t) => (t.commercial ? canManageCommercial : true));
}

/** All legal transitions regardless of authority (used for status hints/tests). */
export function allRfqTransitions(status: RfqStatus): RfqTransition[] {
  return TRANSITIONS[status];
}

export function canTransition(from: RfqStatus, to: RfqStatus): boolean {
  return TRANSITIONS[from].some((t) => t.to === to);
}

export const isRfqOpen = (status: RfqStatus) => !RFQ_TERMINAL.includes(status);

/** Badge tone token for a status (semantic classes only). */
export function rfqStatusTone(status: RfqStatus): string {
  switch (status) {
    case "approved":
    case "won":
      return "border-primary/30 bg-primary/10 text-primary";
    case "rejected":
    case "cancelled":
      return "border-destructive/30 bg-destructive/10 text-destructive";
    case "under_review":
      return "border-primary/30 bg-primary/10 text-primary-foreground";
    default:
      return "";
  }
}

/** Canonical audit action name for a transition. */
export const rfqAuditAction = (from: RfqStatus, to: RfqStatus) => `rfq_${from}_to_${to}`;
