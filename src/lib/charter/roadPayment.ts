/**
 * Road charter (bus, van, coach) payment-state machine and travel approval
 * stages.
 *
 * Road bookings do not have a flight status. They move through a five-stage
 * travel approval ladder — requested → booked → payment → verification →
 * approval — while `payment_status` on the booking record tracks the money
 * side of the journey. Both are persisted on `charter_bookings`
 * (`payment_status`, `status`) so any surface can rebuild the same view.
 */

/** Canonical persisted payment states for a road charter booking. */
export const ROAD_PAYMENT_STATUSES = [
  "pending",
  "approved",
  "awaiting_corporate_wallet",
  "awaiting_mpesa_stk",
  "awaiting_bank_transfer",
  "paid",
  "failed",
] as const;

export type RoadPaymentStatus = (typeof ROAD_PAYMENT_STATUSES)[number];

export const ROAD_PAYMENT_LABELS: Record<string, string> = {
  pending: "Unpaid — awaiting corporate organisation approval",
  authorized: "Unpaid — awaiting corporate organisation approval",
  approved: "Authorised by the corporate organisation — awaiting payment",
  awaiting_corporate_wallet: "Waiting corporate wallet settlement",
  awaiting_mpesa_stk: "Awaiting M-Pesa STK confirmation",
  processing: "Awaiting M-Pesa STK confirmation",
  awaiting_bank_transfer: "Waiting bank transfer",
  paid: "Paid",
  settled: "Paid",
  failed: "Payment failed",
};

export const roadPaymentLabel = (s?: string | null) =>
  (s && ROAD_PAYMENT_LABELS[s]) || s || "Unpaid";

/** Unpaid states are rendered in red across every road charter surface. */
export function isRoadUnpaid(s?: string | null): boolean {
  return !["paid", "settled"].includes(String(s ?? "pending"));
}

/** Terminal-ish states that no longer need an admin nudge. */
export function isRoadAwaitingPayment(s?: string | null): boolean {
  return [
    "approved",
    "awaiting_corporate_wallet",
    "awaiting_mpesa_stk",
    "processing",
    "awaiting_bank_transfer",
  ].includes(String(s ?? ""));
}

export type RoadPaymentMethod = "corporate_wallet" | "mpesa" | "bank_transfer";

/** The state a booking enters once the passenger picks a payment route. */
export function statusForMethod(method: RoadPaymentMethod): RoadPaymentStatus {
  switch (method) {
    case "corporate_wallet":
      return "awaiting_corporate_wallet";
    case "mpesa":
      return "awaiting_mpesa_stk";
    case "bank_transfer":
      return "awaiting_bank_transfer";
  }
}

export const ROAD_PAYMENT_METHOD_LABELS: Record<RoadPaymentMethod, string> = {
  corporate_wallet: "Corporate wallet",
  mpesa: "M-Pesa STK push",
  bank_transfer: "Bank transfer",
};

// ---------------------------------------------------------------------------
// Travel approval stages (replaces flight status for road assets)
// ---------------------------------------------------------------------------

export const ROAD_TRAVEL_STAGES = [
  "requested",
  "booked",
  "payment",
  "verification",
  "approval",
] as const;

export type RoadTravelStage = (typeof ROAD_TRAVEL_STAGES)[number];

export const ROAD_TRAVEL_STAGE_LABELS: Record<RoadTravelStage, string> = {
  requested: "Requested",
  booked: "Booked",
  payment: "Payment",
  verification: "Verification",
  approval: "Approval",
};

export const ROAD_TRAVEL_STAGE_HINTS: Record<RoadTravelStage, string> = {
  requested: "Quote requested with your route, date and passenger count.",
  booked: "Vehicle reserved and the itinerary issued for your sign-off.",
  payment: "Payment route selected — wallet, M-Pesa STK or bank transfer.",
  verification: "Funds verified against the invoice and control number.",
  approval: "Travel approved — driver, co-driver and vehicle released.",
};

/**
 * Derives the current travel approval stage from the persisted booking state.
 * Deterministic so the customer, admin queue and PDF all agree.
 */
export function roadTravelStage(booking: {
  status?: string | null;
  payment_status?: string | null;
}): RoadTravelStage {
  const pay = String(booking.payment_status ?? "pending");
  const status = String(booking.status ?? "");
  if (status === "cancelled") return "requested";
  if (["paid", "settled"].includes(pay)) {
    return status === "confirmed" || status === "completed" ? "approval" : "verification";
  }
  if (isRoadAwaitingPayment(pay)) return "payment";
  if (status === "confirmed" || status === "booked") return "booked";
  return "requested";
}

export function roadStageIndex(stage: RoadTravelStage): number {
  return Math.max(0, ROAD_TRAVEL_STAGES.indexOf(stage));
}
