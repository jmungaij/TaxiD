export const ACTIVE_TRIP_STATUSES = ["pending", "searching", "scheduled", "dispatched", "accepted", "driver_arrived", "arrived", "picked_up", "in_progress"] as const;

const LABELS: Record<string, string> = {
  pending: "Request received", searching: "Finding your driver", scheduled: "Scheduled",
  dispatched: "Driver notified", accepted: "Driver assigned", driver_arrived: "Driver has arrived",
  arrived: "Driver has arrived", picked_up: "On the way", in_progress: "Trip in progress",
  no_show: "No-show", completed: "Completed", cancelled: "Cancelled",
};

export function tripStatusLabel(status: string) {
  return LABELS[status] ?? status.replace(/_/g, " ");
}

export function isActiveTrip(status: string) {
  return ACTIVE_TRIP_STATUSES.some((value) => value === status);
}