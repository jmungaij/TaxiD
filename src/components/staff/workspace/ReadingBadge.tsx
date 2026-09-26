/**
 * STAGE 10 — one explained reading, rendered small.
 *
 * The badge always carries the recorded facts behind it (hover/focus), so no
 * score is ever shown without its explanation.
 */
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { BAND_LABEL, type Band, type Reading } from "@/lib/workspace/commercialIntelligence";
import { cn } from "@/lib/utils";

const TONE: Record<Band, string> = {
  strong: "border-status-success/40 bg-status-success/10 text-status-success",
  watch: "border-status-info/40 bg-status-info/10 text-status-info",
  at_risk: "border-destructive/40 bg-destructive/10 text-destructive",
  critical: "border-destructive/40 bg-destructive/10 text-destructive",
  unknown: "border-border bg-muted text-muted-foreground",
};

export function ReadingBadge({ label, reading }: { label: string; reading: Reading }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full"
          aria-label={`${label}: ${reading.headline}. Show why.`}
        >
          <Badge variant="outline" className={cn("text-[10px] font-medium", TONE[reading.band])}>
            {label}: {reading.headline}
            {reading.score != null ? ` · ${reading.score}` : ""}
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 text-sm">
        <p className="font-semibold">
          {label} — {BAND_LABEL[reading.band]}
        </p>
        <p className="mt-0.5 text-muted-foreground">{reading.headline}</p>
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
          {reading.reasons.map((r) => (
            <li key={r}>· {r}</li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

export default ReadingBadge;
