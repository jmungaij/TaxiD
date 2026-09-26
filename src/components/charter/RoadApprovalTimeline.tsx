/**
 * Road charter travel approval timeline.
 *
 * Replaces the aviation flight-status timeline for bus, van and coach
 * bookings: requested → booked → payment → verification → approval, derived
 * from the persisted booking status and payment status.
 */
import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ROAD_TRAVEL_STAGES,
  ROAD_TRAVEL_STAGE_HINTS,
  ROAD_TRAVEL_STAGE_LABELS,
  roadPaymentLabel,
  roadStageIndex,
  roadTravelStage,
} from "@/lib/charter/roadPayment";

interface Props {
  status?: string | null;
  paymentStatus?: string | null;
}

export function RoadApprovalTimeline({ status, paymentStatus }: Props) {
  const stage = roadTravelStage({ status, payment_status: paymentStatus });
  const activeIndex = roadStageIndex(stage);

  return (
    <ol className="space-y-3" aria-label="Travel approval status timeline">
      {ROAD_TRAVEL_STAGES.map((s, i) => {
        const done = i < activeIndex;
        const isCurrent = i === activeIndex;
        return (
          <li key={s} className="flex gap-3">
            <div className="flex flex-col items-center">
              {done ? (
                <CheckCircle2 className="h-5 w-5 text-status-success" />
              ) : isCurrent ? (
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              ) : (
                <Circle className="h-5 w-5 text-muted-foreground/40" />
              )}
              {i < ROAD_TRAVEL_STAGES.length - 1 && (
                <span
                  className={cn(
                    "mt-1 h-6 w-px",
                    i < activeIndex ? "bg-primary/60" : "bg-border",
                  )}
                />
              )}
            </div>
            <div className="pb-1">
              <p
                className={cn(
                  "text-sm font-medium",
                  isCurrent ? "text-foreground" : done ? "text-foreground/80" : "text-muted-foreground",
                )}
              >
                {ROAD_TRAVEL_STAGE_LABELS[s]}
                {isCurrent && s === "payment" && (
                  <span className="ml-2 text-xs font-normal text-destructive">
                    {roadPaymentLabel(paymentStatus)}
                  </span>
                )}
              </p>
              <p className="text-xs text-muted-foreground">{ROAD_TRAVEL_STAGE_HINTS[s]}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export default RoadApprovalTimeline;
