import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/** Rider-friendly trip stages, in order. */
const STAGES = [
  { key: "requested", label: "Requested", statuses: ["pending", "searching", "scheduled"] },
  { key: "assigned", label: "Driver on the way", statuses: ["assigned", "accepted", "driver_assigned", "en_route"] },
  { key: "arrived", label: "Driver arrived", statuses: ["arrived", "driver_arrived"] },
  { key: "started", label: "On trip", statuses: ["started", "in_progress", "on_trip"] },
  { key: "completed", label: "Completed", statuses: ["completed"] },
] as const;

export function statusLabel(status: string): string {
  if (status === "cancelled") return "Cancelled";
  const s = STAGES.find((st) => (st.statuses as readonly string[]).includes(status));
  return s?.label ?? status.replace(/_/g, " ");
}

export function TripProgress({ status }: { status: string }) {
  if (status === "cancelled") return null;
  const idx = Math.max(0, STAGES.findIndex((st) => (st.statuses as readonly string[]).includes(status)));
  return (
    <ol className="flex items-start gap-1" aria-label="Trip progress" data-testid="trip-progress">
      {STAGES.map((st, i) => {
        const done = i < idx || status === "completed";
        const current = i === idx && status !== "completed";
        return (
          <li key={st.key} className="flex-1 flex flex-col items-center text-center gap-1">
            <div className="flex items-center w-full">
              <div className={cn("h-0.5 flex-1", i === 0 ? "opacity-0" : i <= idx ? "bg-primary" : "bg-border")} />
              <span
                aria-current={current ? "step" : undefined}
                className={cn(
                  "h-6 w-6 shrink-0 rounded-full border-2 flex items-center justify-center text-[10px] font-semibold",
                  done && "bg-primary border-primary text-primary-foreground",
                  current && "border-primary text-primary animate-pulse",
                  !done && !current && "border-border text-muted-foreground",
                )}
              >
                {done ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              <div className={cn("h-0.5 flex-1", i === STAGES.length - 1 ? "opacity-0" : i < idx ? "bg-primary" : "bg-border")} />
            </div>
            <span className={cn("text-[11px] leading-tight", current ? "font-semibold text-foreground" : "text-muted-foreground")}>
              {st.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
