/**
 * Phase D11.2 — Recovery Plan panel.
 * Renders the deterministic execution plan derived from the existing
 * Decision Engine recommendations. No new engine, no AI.
 */
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ArrowRight, ChevronsRight, ListChecks, Timer, Zap } from "lucide-react";
import type { Recommendation } from "@/lib/workspace360/decisionEngine";
import { buildRecoveryPlan, formatEta } from "@/lib/workspace360/orchestration";

const EFFORT_TONE: Record<string, string> = {
  low: "bg-status-success/15 text-status-success border-status-success/40",
  medium: "bg-status-warning/15 text-status-warning border-status-warning/40",
  high: "bg-status-danger/15 text-status-danger border-status-danger/40",
};

export function RecoveryPlanPanel({
  recommendations,
  title = "Recommended Recovery Plan",
  maxSteps,
}: {
  recommendations: Recommendation[];
  title?: string;
  maxSteps?: number;
}) {
  const plan = buildRecoveryPlan(recommendations);
  const steps = maxSteps ? plan.steps.slice(0, maxSteps) : plan.steps;
  const progressPct = Math.round(plan.overallProgress * 100);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <ListChecks className="h-4 w-4 text-primary" /> {title}
          <Badge variant="outline">{plan.steps.length} steps</Badge>
          <span className="text-[11px] text-muted-foreground font-mono ml-auto flex items-center gap-3">
            <span className="inline-flex items-center gap-1"><Timer className="h-3 w-3" /> ETA {formatEta(plan.totalEstimatedMs)}</span>
            <span className="inline-flex items-center gap-1"><Zap className="h-3 w-3" /> recovery {plan.totalBusinessRecovery.toFixed(0)} pts</span>
            <span>progress {progressPct}%</span>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {plan.steps.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No open recommendations — no recovery plan required.
          </p>
        ) : (
          <>
            <Progress value={progressPct} className="h-1.5 mb-3" />
            <ol className="space-y-2">
              {steps.map((step) => (
                <li key={step.order} className="rounded-md border p-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge className="bg-primary/15 text-primary border-primary/40 text-[10px]">
                      Step {step.order}
                    </Badge>
                    {step.parallel.length > 1 && (
                      <Badge variant="outline" className="text-[10px]">parallel × {step.parallel.length}</Badge>
                    )}
                    <span className="text-[11px] text-muted-foreground font-mono ml-auto flex items-center gap-3">
                      <span className="inline-flex items-center gap-1"><Timer className="h-3 w-3" /> {formatEta(step.estimatedResolutionMs)}</span>
                      <span className="inline-flex items-center gap-1"><Zap className="h-3 w-3" /> +{step.expectedBusinessRecovery.toFixed(0)} pts</span>
                    </span>
                  </div>
                  <div className="mt-2 space-y-1.5">
                    {step.parallel.map((r) => {
                      const o = plan.orchestration[r.id];
                      return (
                        <Link
                          key={r.id}
                          to={r.href}
                          className="flex items-center gap-2 rounded p-2 -mx-1 hover:bg-accent transition-colors"
                        >
                          <Badge className={(EFFORT_TONE[o.effort] ?? EFFORT_TONE.medium) + " text-[10px]"}>
                            {o.effort}
                          </Badge>
                          <Badge variant="outline" className="text-[10px]">{r.priority}</Badge>
                          {o.criticalPath && (
                            <Badge className="bg-status-danger/15 text-status-danger border-status-danger/40 text-[10px]">
                              critical path
                            </Badge>
                          )}
                          {o.blocking && (
                            <Badge variant="outline" className="text-[10px]">blocking</Badge>
                          )}
                          {o.governance.completed && (
                            <Badge className="bg-status-success/15 text-status-success border-status-success/40 text-[10px]">verified</Badge>
                          )}
                          <span className="text-sm truncate min-w-0 flex-1">
                            {r.title}
                            <span className="block text-[10px] text-muted-foreground font-mono truncate">
                              {o.governance.businessCapability} · {o.governance.operationalOwner} · approver: {o.governance.approvalRole.replace(/_/g, " ")}
                            </span>
                          </span>
                          <span className="text-[10px] text-muted-foreground font-mono">
                            {formatEta(o.estimatedResolutionMs)} · {Math.round(o.progress * 100)}%
                          </span>
                          <ArrowRight className="h-3 w-3 opacity-50 shrink-0" />
                        </Link>
                      );
                    })}
                  </div>
                  {step.order < steps.length && (
                    <div className="flex justify-center text-muted-foreground mt-1">
                      <ChevronsRight className="h-3 w-3 rotate-90" />
                    </div>
                  )}
                </li>
              ))}
            </ol>
            <div className="mt-3 rounded-md bg-muted/40 p-2 text-xs flex items-center justify-between">
              <span className="font-medium">Expected Business Recovery</span>
              <span className="font-mono">+{plan.totalBusinessRecovery.toFixed(0)} governance pts across {plan.criticalPath.length} critical actions</span>
            </div>
            {!plan.passed && (
              <div className="mt-2 text-[11px] font-mono text-status-warning">
                orchestration warnings: {plan.failures.slice(0, 3).join("; ")}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
