/**
 * Fulfilment ladder — the live state of a vacancy's pipeline, from application
 * through to an exactly-once staff record. Every figure is counted server-side
 * by rec_pipeline_state; nothing here is derived in the browser.
 */
import { Activity, BadgeCheck, Bell, ShieldCheck } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { FULFILMENT_LADDER, type PipelineState } from "@/lib/recruitment/fulfilment";

interface Props {
  state?: PipelineState;
  loading: boolean;
  activeStage?: string | null;
  onStageSelect?: (stage: string) => void;
}

export function FulfilmentLadder({ state, loading, activeStage, onStageSelect }: Props) {
  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Fulfilment ladder</CardTitle>
        </CardHeader>
        <CardContent><Skeleton className="h-24 w-full" /></CardContent>
      </Card>
    );
  }

  const stages = state?.stages ?? {};
  const checksBlocking =
    (state?.checks?.pending ?? 0) + (state?.checks?.in_progress ?? 0) + (state?.checks?.failed ?? 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4 text-primary" aria-hidden />
          Fulfilment ladder
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-9">
          {FULFILMENT_LADDER.map((step, index) => {
            const count = stages[step.key] ?? 0;
            const active = activeStage === step.key;
            return (
              <li key={step.key}>
                <button
                  type="button"
                  onClick={() => onStageSelect?.(step.key)}
                  title={step.note}
                  aria-current={active ? "step" : undefined}
                  className={cn(
                    "w-full rounded-lg border bg-card p-3 text-left transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active ? "border-primary bg-primary/5" : "hover:border-primary/40",
                  )}
                >
                  <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="block text-xl font-bold tabular-nums">{count}</span>
                  <span className="block text-[11px] uppercase tracking-wide text-muted-foreground">
                    {step.label}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>

        <div className="grid gap-3 sm:grid-cols-3">
          <Metric
            icon={<ShieldCheck className="h-3.5 w-3.5" aria-hidden />}
            label="Awaiting evaluation"
            value={state?.validation.awaiting_evaluation ?? 0}
            note={`${state?.validation.requires_review ?? 0} need human eligibility review`}
          />
          <Metric
            icon={<BadgeCheck className="h-3.5 w-3.5" aria-hidden />}
            label="Pre-employment checks open"
            value={checksBlocking}
            note={`${state?.checks?.passed ?? 0} cleared · ${state?.checks?.failed ?? 0} failed`}
          />
          <Metric
            icon={<Bell className="h-3.5 w-3.5" aria-hidden />}
            label="Candidate messages"
            value={state?.notifications.delivered ?? 0}
            note={`${state?.notifications.queued ?? 0} queued · ${state?.notifications.failed ?? 0} failed`}
          />
        </div>

        <p className="text-xs text-muted-foreground">
          Hires are created exactly once in the Staff Register: {state?.hires ?? 0} to date for this
          vacancy. Re-running onboarding completion never produces a duplicate staff member.
        </p>
      </CardContent>
    </Card>
  );
}

function Metric({
  icon, label, value, note,
}: { icon: React.ReactNode; label: string; value: number; note: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-lg font-bold tabular-nums">{value}</div>
      <p className="text-[11px] text-muted-foreground">{note}</p>
    </div>
  );
}
