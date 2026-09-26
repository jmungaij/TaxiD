/**
 * Charter flight lifecycle timeline. Renders the canonical stages
 * (requested → confirmed → departed → arrived) plus any recorded events.
 */
import { CheckCircle2, Circle, PlaneTakeoff } from "lucide-react";
import { cn } from "@/lib/utils";
import { CHARTER_FLIGHT_STAGES, CHARTER_STAGE_LABELS, type CharterFlightStage } from "@/lib/charter/api";
import { reasonLabel } from "@/lib/charter/access";

export interface FlightEvent {
  at: string;
  status: string;
  note?: string | null;
  reason_code?: string | null;
  actor?: string | null;
}


interface Props {
  currentStatus: string;
  events?: FlightEvent[];
}

export function FlightTimeline({ currentStatus, events = [] }: Props) {
  const normalized = (currentStatus === "confirmed" ? "scheduled" : currentStatus) as CharterFlightStage;
  const activeIndex = Math.max(0, CHARTER_FLIGHT_STAGES.indexOf(normalized));
  const lastFor = (stage: string) =>
    [...events].reverse().find((e) => e.status === stage || (stage === "scheduled" && e.status === "confirmed"));

  return (
    <ol className="space-y-3" aria-label="Flight status timeline">
      {CHARTER_FLIGHT_STAGES.map((stage, i) => {
        const done = i <= activeIndex;
        const isCurrent = i === activeIndex;
        const ev = lastFor(stage);
        return (
          <li key={stage} className="flex gap-3">
            <div className="flex flex-col items-center">
              {done ? (
                isCurrent ? (
                  <PlaneTakeoff className="h-5 w-5 text-primary" />
                ) : (
                  <CheckCircle2 className="h-5 w-5 text-status-success" />
                )
              ) : (
                <Circle className="h-5 w-5 text-muted-foreground/50" />
              )}
              {i < CHARTER_FLIGHT_STAGES.length - 1 && (
                <span className={cn("mt-1 w-px flex-1", done ? "bg-primary/50" : "bg-border")} />
              )}
            </div>
            <div className="pb-3">
              <p className={cn("text-sm font-medium", done ? "text-foreground" : "text-muted-foreground")}>
                {CHARTER_STAGE_LABELS[stage]}
                {isCurrent && <span className="ml-2 text-xs text-primary">live</span>}
              </p>
              <p className="text-xs text-muted-foreground">
                {ev
                  ? [
                      new Date(ev.at).toLocaleString(),
                      ev.reason_code ? reasonLabel(ev.reason_code) : "",
                      ev.note ?? "",
                    ].filter(Boolean).join(" · ")
                  : "Pending"}
              </p>

            </div>
          </li>
        );
      })}
    </ol>
  );
}
