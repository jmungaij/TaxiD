/**
 * Cross-corporate booking operations queue — pure aggregation.
 *
 * The `corporate-admin-console` edge function returns raw slices (employees,
 * accounts, approvals, trip bookings). This module folds them into one
 * operator-friendly queue with exception detection so the control tower screen
 * stays presentational and the logic stays unit-testable.
 */

export interface QueueRaw {
  employees: Array<{ corporate_id: string; user_id: string | null; full_name?: string | null; email?: string | null }>;
  accounts: Array<{ id: string; legal_name?: string | null; trading_name?: string | null; status?: string | null }>;
  approvals: Array<{
    id: string; corporate_id: string; status?: string | null; ride_type?: string | null;
    pickup_address?: string | null; dropoff_address?: string | null;
    estimated_fare_cents?: number | null; scheduled_for?: string | null;
    expires_at?: string | null; created_at?: string | null; decided_at?: string | null;
  }>;
  bookings: Array<{
    id: string; booking_number?: string | null; rider_user_id?: string | null; status?: string | null;
    intent?: string | null; pickup_address?: string | null; dropoff_address?: string | null;
    total_fare?: number | null; scheduled_for?: string | null; pickup_eta?: string | null;
    cancelled_at?: string | null; cancellation_reason?: string | null;
    created_at?: string | null; completed_at?: string | null;
  }>;
}

export type QueueKind = "trip" | "approval";

/** Operational phase used for grouping in the control tower. */
export type QueuePhase = "awaiting_approval" | "scheduled" | "in_progress" | "completed" | "failed";

export interface QueueRow {
  id: string;
  kind: QueueKind;
  reference: string;
  corporateId: string;
  corporateName: string;
  requester: string;
  status: string;
  phase: QueuePhase;
  pickup: string;
  dropoff: string;
  amountCents: number;
  scheduledFor: string | null;
  createdAt: string | null;
  /** Human exception reasons — empty when the booking is healthy. */
  exceptions: string[];
  ageMinutes: number;
}

const IN_PROGRESS = new Set(["accepted", "driver_assigned", "arriving", "in_progress", "ongoing", "started"]);
const FAILED = new Set(["cancelled", "canceled", "failed", "no_driver", "expired", "rejected", "payment_failed"]);

const minutesSince = (iso: string | null | undefined, now: number) =>
  iso ? Math.max(0, Math.round((now - Date.parse(iso)) / 60_000)) : 0;

function accountName(a: QueueRaw["accounts"][number]) {
  return a.trading_name || a.legal_name || "Corporate";
}

export function buildBookingQueue(raw: QueueRaw, now: Date = new Date()): QueueRow[] {
  const ts = now.getTime();
  const names = new Map(raw.accounts.map((a) => [a.id, accountName(a)]));
  const riderToCorp = new Map<string, { corporateId: string; name: string }>();
  for (const e of raw.employees) {
    if (!e.user_id) continue;
    riderToCorp.set(e.user_id, {
      corporateId: e.corporate_id,
      name: e.full_name || e.email || "Employee",
    });
  }

  const rows: QueueRow[] = [];

  for (const a of raw.approvals) {
    const status = (a.status ?? "pending").toLowerCase();
    const expired = a.expires_at ? Date.parse(a.expires_at) < ts : false;
    const age = minutesSince(a.created_at, ts);
    const exceptions: string[] = [];
    if (status === "pending" && expired) exceptions.push("Approval window expired");
    if (status === "pending" && age > 240) exceptions.push(`Approval overdue (${Math.round(age / 60)}h)`);
    rows.push({
      id: a.id,
      kind: "approval",
      reference: `APR-${a.id.slice(0, 8).toUpperCase()}`,
      corporateId: a.corporate_id,
      corporateName: names.get(a.corporate_id) ?? "Corporate",
      requester: a.ride_type ?? "—",
      status,
      phase: status === "pending" ? "awaiting_approval" : FAILED.has(status) ? "failed" : "scheduled",
      pickup: a.pickup_address ?? "—",
      dropoff: a.dropoff_address ?? "—",
      amountCents: a.estimated_fare_cents ?? 0,
      scheduledFor: a.scheduled_for ?? null,
      createdAt: a.created_at ?? null,
      exceptions,
      ageMinutes: age,
    });
  }

  for (const b of raw.bookings) {
    const link = b.rider_user_id ? riderToCorp.get(b.rider_user_id) : undefined;
    if (!link) continue; // not a corporate-employee trip
    const status = (b.status ?? "pending").toLowerCase();
    const age = minutesSince(b.created_at, ts);
    const phase: QueuePhase =
      FAILED.has(status) ? "failed"
      : status === "completed" ? "completed"
      : IN_PROGRESS.has(status) ? "in_progress"
      : "scheduled";
    const exceptions: string[] = [];
    if (phase === "failed") exceptions.push(b.cancellation_reason ? `Failed: ${b.cancellation_reason}` : "Booking failed");
    if (phase === "scheduled" && age > 30 && !b.scheduled_for) exceptions.push("Unassigned for over 30 min");
    if (b.pickup_eta && Date.parse(b.pickup_eta) < ts && phase !== "completed" && phase !== "failed") {
      exceptions.push("Pickup ETA breached");
    }
    rows.push({
      id: b.id,
      kind: "trip",
      reference: b.booking_number || `TRP-${b.id.slice(0, 8).toUpperCase()}`,
      corporateId: link.corporateId,
      corporateName: names.get(link.corporateId) ?? "Corporate",
      requester: link.name,
      status,
      phase,
      pickup: b.pickup_address ?? "—",
      dropoff: b.dropoff_address ?? "—",
      amountCents: Math.round(Number(b.total_fare ?? 0) * 100),
      scheduledFor: b.scheduled_for ?? null,
      createdAt: b.created_at ?? null,
      exceptions,
      ageMinutes: age,
    });
  }

  return rows.sort((x, y) => {
    if (x.exceptions.length !== y.exceptions.length) return y.exceptions.length - x.exceptions.length;
    return Date.parse(y.createdAt ?? "0") - Date.parse(x.createdAt ?? "0");
  });
}

export interface QueueTotals {
  total: number;
  awaitingApproval: number;
  inProgress: number;
  failed: number;
  exceptions: number;
  exposureCents: number;
}

export function queueTotals(rows: QueueRow[]): QueueTotals {
  return rows.reduce<QueueTotals>((acc, r) => {
    acc.total += 1;
    if (r.phase === "awaiting_approval") acc.awaitingApproval += 1;
    if (r.phase === "in_progress") acc.inProgress += 1;
    if (r.phase === "failed") acc.failed += 1;
    if (r.exceptions.length) acc.exceptions += 1;
    if (r.phase !== "completed" && r.phase !== "failed") acc.exposureCents += r.amountCents;
    return acc;
  }, { total: 0, awaitingApproval: 0, inProgress: 0, failed: 0, exceptions: 0, exposureCents: 0 });
}

export const QUEUE_FILTERS = [
  { key: "all", label: "All bookings" },
  { key: "exceptions", label: "Exceptions only" },
  { key: "awaiting_approval", label: "Awaiting approval" },
  { key: "in_progress", label: "In progress" },
  { key: "failed", label: "Failed / cancelled" },
] as const;

export type QueueFilterKey = (typeof QUEUE_FILTERS)[number]["key"];

export function filterQueue(rows: QueueRow[], filter: QueueFilterKey, query = ""): QueueRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter((r) => {
    if (filter === "exceptions" && r.exceptions.length === 0) return false;
    if (filter !== "all" && filter !== "exceptions" && r.phase !== filter) return false;
    if (!q) return true;
    return [r.reference, r.corporateName, r.requester, r.pickup, r.dropoff, r.status]
      .some((v) => String(v).toLowerCase().includes(q));
  });
}
