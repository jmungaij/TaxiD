/**
 * Charter RBAC — single source of truth shared by the aviation-center UI and
 * mirrored by the charter-api edge function (server-side enforcement).
 *
 * Operators run the fleet: inventory, availability, empty-leg offers and
 * flight status events. Admins additionally govern commercial state —
 * quote/booking status and the pricing/evidence audit trail.
 */
export const CHARTER_ADMIN_ROLES = ["admin", "super_admin", "operations_manager"] as const;
export const CHARTER_OPERATOR_ONLY_ROLES = ["charter_operator", "fleet_manager"] as const;

export const CHARTER_OPERATOR_ROLES = [
  ...CHARTER_OPERATOR_ONLY_ROLES,
  ...CHARTER_ADMIN_ROLES,
] as const;

export interface CharterAccess {
  isOperator: boolean;
  isAdmin: boolean;
  /** Inventory, availability windows and empty-leg offers. */
  canManageInventory: boolean;
  /** Flight status events (requested → confirmed → departed → arrived). */
  canManageFlightStatus: boolean;
  /** Quote + booking commercial status transitions. */
  canManageCommercial: boolean;
  /** Pricing/evidence audit trail and its CSV export. */
  canViewPricingAudit: boolean;
}

export function charterAccess(roles: readonly string[] | undefined): CharterAccess {
  const list = roles ?? [];
  const isAdmin = list.some((r) => (CHARTER_ADMIN_ROLES as readonly string[]).includes(r));
  const isOperator = isAdmin || list.some((r) => (CHARTER_OPERATOR_ONLY_ROLES as readonly string[]).includes(r));
  return {
    isOperator,
    isAdmin,
    canManageInventory: isOperator,
    canManageFlightStatus: isOperator,
    canManageCommercial: isAdmin,
    canViewPricingAudit: isAdmin,
  };
}

/** Operational reason codes attached to a manual flight status event. */
export const FLIGHT_REASON_CODES = [
  { code: "on_schedule", label: "On schedule" },
  { code: "customer_request", label: "Customer request" },
  { code: "weather", label: "Weather" },
  { code: "technical", label: "Technical / maintenance" },
  { code: "crew", label: "Crew availability" },
  { code: "atc_slot", label: "ATC / slot delay" },
  { code: "ground_handling", label: "Ground handling" },
  { code: "payment_hold", label: "Payment hold" },
  { code: "operator_cancellation", label: "Operator cancellation" },
] as const;

export type FlightReasonCode = (typeof FLIGHT_REASON_CODES)[number]["code"];

export const reasonLabel = (code?: string | null) =>
  FLIGHT_REASON_CODES.find((r) => r.code === code)?.label ?? code ?? "";
