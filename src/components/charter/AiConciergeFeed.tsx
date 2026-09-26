/**
 * Proactive AI concierge feed for the executive mobility workspace.
 *
 * Unlike a chat prompt, this panel advises continuously from the mission state
 * — capacity, timing, surcharge exposure, accessibility and procurement gaps.
 */
import { Clock, Sparkles, ShieldAlert, Wand2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ConciergeAdvisory } from "@/lib/charter/missionReadiness";

const TONE_ICON = {
  recommendation: Wand2,
  timing: Clock,
  risk: ShieldAlert,
  comfort: Sparkles,
} as const;

const TONE_STYLE: Record<ConciergeAdvisory["tone"], string> = {
  recommendation: "border-primary/30 bg-primary/5",
  timing: "border-border bg-muted/40",
  risk: "border-destructive/30 bg-destructive/5",
  comfort: "border-border bg-muted/30",
};

export function AiConciergeFeed({ advisories }: { advisories: ConciergeAdvisory[] }) {
  if (!advisories.length) return null;
  return (
    <Card className="border-primary/20 bg-card/70 backdrop-blur">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
          AI mission concierge
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Continuous advisories from your mission configuration — no prompting required.
        </p>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2" aria-live="polite">
          {advisories.map((a) => {
            const Icon = TONE_ICON[a.tone];
            return (
              <li
                key={a.id}
                className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${TONE_STYLE[a.tone]}`}
              >
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span>{a.message}</span>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
