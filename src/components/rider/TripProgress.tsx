import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Detailed rider trip stages. Booking status gives the coarse stage; the
 * driver's live distance (from trip_tracking) refines it into "arriving"
 * and "approaching destination".
 */
export const STAGES = [
  { key: "booked", label: "Booked" },
  { key: "assigned", label: "Driver assigned" },
  { key: "en_route", label: "Driver on the way" },
  { key: "arriving", label: "Arriving" },
  { key: "arrived", label: "Driver arrived" },
  { key: "verified", label: "Pickup verified" },
  { key: "on_trip", label: "On trip" },
  { key: "approaching", label: "Approaching destination" },
  { key: "completed", label: "Completed" },
] as const;
export type StageKey = (typeof STAGES)[number]["key"];

const ARRIVING_M = 400;
const APPROACHING_M = 800;

export function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR, dLng = (b.lng - a.lng) * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function deriveStage(opts: {
  status: string;
  hasDriver: boolean;
  pinVerified: boolean;
  distanceToTargetM: number | null;
  hasLivePosition: boolean;
}): StageKey | "cancelled" {
  const { status, hasDriver, pinVerified, distanceToTargetM: d, hasLivePosition } = opts;
  if (status === "cancelled") return "cancelled";
  if (status === "completed") return "completed";
  if (status === "in_progress" || status === "started") return d != null && d < APPROACHING_M ? "approaching" : "on_trip";
  if (status === "arrived") return pinVerified ? "verified" : "arrived";
  if (!hasDriver) return "booked";
  if (!hasLivePosition) return "assigned";
  return d != null && d < ARRIVING_M ? "arriving" : "en_route";
}

export function stageLabel(stage: StageKey | "cancelled") {
  return stage === "cancelled" ? "Cancelled" : STAGES.find((s) => s.key === stage)!.label;
}

/** Back-compat label from the raw status only. */
export function statusLabel(status: string): string {
  return stageLabel(deriveStage({ status, hasDriver: !["pending", "searching", "scheduled"].includes(status), pinVerified: false, distanceToTargetM: null, hasLivePosition: false }));
}

export function TripProgress({ stage }: { stage: StageKey | "cancelled" }) {
  if (stage === "cancelled") return null;
  const idx = STAGES.findIndex((s) => s.key === stage);
  return (
    <ol className="flex items-start gap-0.5 overflow-x-auto" aria-label="Trip progress" data-testid="trip-progress">
      {STAGES.map((st, i) => {
        const done = i < idx || stage === "completed";
        const current = i === idx && stage !== "completed";
        return (
          <li key={st.key} className="flex-1 min-w-[56px] flex flex-col items-center text-center gap-1">
            <div className="flex items-center w-full">
              <div className={cn("h-0.5 flex-1", i === 0 ? "opacity-0" : i <= idx ? "bg-primary" : "bg-border")} />
              <span
                aria-current={current ? "step" : undefined}
                className={cn(
                  "h-5 w-5 shrink-0 rounded-full border-2 flex items-center justify-center text-[9px] font-semibold",
                  done && "bg-primary border-primary text-primary-foreground",
                  current && "border-primary text-primary animate-pulse",
                  !done && !current && "border-border text-muted-foreground",
                )}
              >
                {done ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              <div className={cn("h-0.5 flex-1", i === STAGES.length - 1 ? "opacity-0" : i < idx ? "bg-primary" : "bg-border")} />
            </div>
            <span className={cn("text-[10px] leading-tight", current ? "font-semibold text-foreground" : "text-muted-foreground")}>
              {st.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
