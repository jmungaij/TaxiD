/**
 * Forensic audit trail for customer-side charter booking edits.
 *
 * Cabin/seat changes, aircraft gallery selections and ground package edits are
 * commercially material, so every change is written through the platform audit
 * writer (which stamps `actor_user_id` and monitors RLS rejections).
 */
import { writeAuditLog } from "@/lib/platform/auditWrite";

export type CharterBookingAuditAction =
  | "charter_cabin_layout_changed"
  | "charter_seat_selection_changed"
  | "charter_gallery_viewed"
  | "charter_ground_package_changed";

export interface CharterAuditContext {
  /** Booking id when the booking already exists, otherwise the draft slug. */
  entityId?: string | null;
  reference?: string | null;
  assetName?: string | null;
}

/** Records a before/after change on the booking flow. Never throws. */
export async function recordCharterBookingChange(
  action: CharterBookingAuditAction,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  ctx: CharterAuditContext = {},
) {
  try {
    await writeAuditLog("charter_booking", {
      action,
      entity_type: "charter_booking",
      entity_id: ctx.entityId ?? null,
      before_data: { ...before, reference: ctx.reference ?? null, asset_name: ctx.assetName ?? null },
      after_data: { ...after, reference: ctx.reference ?? null, asset_name: ctx.assetName ?? null },
    });
  } catch {
    /* audit failures are monitored inside writeAuditLog */
  }
}

/** Shallow diff helper so callers only persist the fields that actually moved. */
export function diffFields<T extends Record<string, unknown>>(before: T, after: T): string[] {
  return Object.keys({ ...before, ...after }).filter(
    (k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]),
  );
}
