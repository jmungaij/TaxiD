/**
 * Decision intelligence panel — resolved business observations, each wired to a
 * canonical investigation destination. Never renders placeholder insights.
 */
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, Sparkles, TrendingDown, TrendingUp, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CommandInsight, CommandTone } from "./types";

const TONE_ICON: Record<CommandTone, typeof Sparkles> = {
  neutral: Sparkles,
  positive: TrendingUp,
  warning: AlertTriangle,
  critical: TrendingDown,
  info: Star,
};

const TONE_RING: Record<CommandTone, string> = {
  neutral: "text-muted-foreground",
  positive: "text-status-success",
  warning: "text-status-warning",
  critical: "text-destructive",
  info: "text-primary",
};

export function DecisionIntelligence({
  title = "Decision intelligence",
  insights,
  emptyMessage = "No signals crossed a decision threshold in this period.",
}: {
  title?: string;
  insights: CommandInsight[];
  emptyMessage?: string;
}) {
  return (
    <section aria-label={title} className="glass-panel rounded-xl border">
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <Sparkles className="h-4 w-4 text-primary" aria-hidden />
        <h2 className="text-sm font-semibold uppercase tracking-wider">{title}</h2>
      </header>
      {insights.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">{emptyMessage}</p>
      ) : (
        <ul className="divide-y">
          {insights.map((i) => {
            const Icon = TONE_ICON[i.tone];
            return (
              <li key={i.id} className="flex items-start gap-3 px-4 py-3">
                <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", TONE_RING[i.tone])} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{i.headline}</p>
                  {i.detail && <p className="mt-0.5 text-xs text-muted-foreground">{i.detail}</p>}
                </div>
                <Link
                  to={i.to}
                  className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-primary hover:underline"
                >
                  {i.actionLabel} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
