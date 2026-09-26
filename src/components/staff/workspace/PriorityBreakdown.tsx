import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Scale } from "lucide-react";
import type { ScoredPersonalWork } from "@/lib/workspace";

/**
 * Priority breakdown — the deterministic "why" behind each recommendation.
 *
 * Every row is a recorded field on the canonical work item or a linked customer
 * promise. No weighting is hidden and no signal is modelled: the points shown
 * here sum exactly to the score the planner used.
 */
export function PriorityBreakdownPanel({
  scored,
  onOpen,
  limit = 5,
}: {
  scored: ScoredPersonalWork[];
  onOpen: (workId: string) => void;
  limit?: number;
}) {
  const items = scored.slice(0, limit);
  return (
    <Card data-testid="priority-breakdown">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Scale className="h-4 w-4 text-primary" /> Why this order
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Each point below comes from a recorded field. The points sum to the score used to build your
          day — nothing is inferred.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {items.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No open work is assigned to you, so there is nothing to rank.
          </p>
        )}
        {items.map((s, i) => (
          <div key={s.work.id} className="rounded-md border p-3" data-testid="priority-breakdown-item">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  #{i + 1} · score {s.score} · ~{s.effortMinutes} min
                </div>
                <div className="truncate font-medium">{s.work.title}</div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => onOpen(s.work.id)}>
                Open
              </Button>
            </div>
            <ul className="mt-3 space-y-1.5">
              {s.contributions.map((c) => (
                <li key={`${c.factor}-${c.label}`} className="flex items-start justify-between gap-3 text-xs">
                  <span className="min-w-0">
                    <span className="font-medium text-foreground">{c.label}</span>
                    <span className="block truncate text-muted-foreground">{c.evidence}</span>
                  </span>
                  <Badge variant={c.points > 0 ? "secondary" : "outline"} className="shrink-0">
                    {c.points > 0 ? `+${c.points}` : "0"}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default PriorityBreakdownPanel;
