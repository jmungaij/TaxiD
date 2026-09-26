/**
 * Charter flight status state machine.
 *
 * Single source of truth for allowed flight status transitions, mirrored by
 * the charter-api edge function (server-side enforcement). The canonical happy
 * path is requested → scheduled (confirmed) → departed → arrived, with
 * optional operational sub-states and a cancellation escape hatch.
 */
export const FLIGHT_TRANSITIONS: Record<string, readonly string[]> = {
  requested: ["scheduled", "cancelled"],
  scheduled: ["crew_assigned", "boarding", "departed", "cancelled"],
  crew_assigned: ["boarding", "departed", "cancelled"],
  boarding: ["departed", "cancelled"],
  departed: ["en_route", "landed", "cancelled"],
  en_route: ["landed", "cancelled"],
  landed: ["arrived"],
  arrived: ["completed"],
  completed: [],
  cancelled: [],
};

export const FLIGHT_STATUS_LABELS: Record<string, string> = {
  requested: "Requested",
  scheduled: "Confirmed",
  crew_assigned: "Crew assigned",
  boarding: "Boarding",
  departed: "Departed",
  en_route: "En route",
  landed: "Landed",
  arrived: "Arrived",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const statusLabel = (s?: string | null) =>
  (s && FLIGHT_STATUS_LABELS[s]) || s || "—";

export function allowedNext(current: string): readonly string[] {
  return FLIGHT_TRANSITIONS[current] ?? [];
}

export function canTransition(current: string, next: string): boolean {
  if (current === next) return false;
  return allowedNext(current).includes(next);
}

/** User-friendly explanation used by the UI and mirrored by the API. */
export function transitionError(current: string, next: string): string | null {
  if (canTransition(current, next)) return null;
  if (current === next) {
    return `This flight is already ${statusLabel(current)}.`;
  }
  const next_ = allowedNext(current);
  if (!next_.length) {
    return `${statusLabel(current)} is a final state — no further status updates are allowed.`;
  }
  return `Cannot move a ${statusLabel(current)} flight to ${statusLabel(next)}. Allowed next: ${next_
    .map(statusLabel)
    .join(", ")}.`;
}
