/**
 * One authoritative time model for order planning.
 *
 * The database stores `pickup_window_start` / `pickup_window_end` as absolute
 * instants (`timestamptz`). The planner works in Nairobi wall-clock slots and
 * converts explicitly in both directions — the calendar never invents a local
 * timestamp, and dragging an order changes the persisted *instant*, not just a
 * visual position. Africa/Nairobi is UTC+03:00 year-round (no DST), so the
 * conversion is exact and testable.
 */
export const OPS_TIMEZONE = "Africa/Nairobi";
export const OPS_UTC_OFFSET_MINUTES = 180;

const pad = (n: number) => String(n).padStart(2, "0");

export interface OpsSlot {
  /** Nairobi calendar day, `YYYY-MM-DD`. */
  dateKey: string;
  /** Nairobi wall-clock hour, 0–23. */
  hour: number;
  minute: number;
}

/** Absolute instant → Nairobi wall-clock slot. */
export function toOpsSlot(iso: string): OpsSlot {
  const shifted = new Date(new Date(iso).getTime() + OPS_UTC_OFFSET_MINUTES * 60_000);
  return {
    dateKey: `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`,
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

/** Nairobi wall-clock slot → absolute UTC instant (ISO string). */
export function slotToInstant(slot: OpsSlot): string {
  const [y, m, d] = slot.dateKey.split("-").map(Number);
  const utcMs = Date.UTC(y, m - 1, d, slot.hour, slot.minute) - OPS_UTC_OFFSET_MINUTES * 60_000;
  return new Date(utcMs).toISOString();
}

export function addMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

/** Nairobi day key for "today". */
export function opsToday(now: Date = new Date()): string {
  return toOpsSlot(now.toISOString()).dateKey;
}

export function shiftDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

/** Display an instant in operations time — always explicit about the zone. */
export function formatOpsTime(iso: string | null | undefined): string {
  if (!iso) return "Unscheduled";
  const s = toOpsSlot(iso);
  return `${s.dateKey} ${pad(s.hour)}:${pad(s.minute)} EAT`;
}

export function formatOpsClock(iso: string | null | undefined): string {
  if (!iso) return "—";
  const s = toOpsSlot(iso);
  return `${pad(s.hour)}:${pad(s.minute)}`;
}

export function isOnOpsDay(iso: string | null | undefined, dateKey: string): boolean {
  if (!iso) return false;
  return toOpsSlot(iso).dateKey === dateKey;
}
