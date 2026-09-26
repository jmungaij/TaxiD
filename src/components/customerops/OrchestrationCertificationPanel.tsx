import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, GitBranch, Lock, ShieldCheck, Workflow } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  buildOrchestrationPlan, certifyOrchestration, visibleActivations, visibleGraph,
} from "@/lib/customerops/orchestration";
import type { CaseType } from "@/lib/customerops/taxonomy";

interface Props {
  roles: string[];
  /** Optional live case to plan against; falls back to the certification sample. */
  caseRef?: { id: string; caseType: CaseType } | null;
}

/**
 * Case Orchestration & Certification — shows the domain-traversal certification
 * matrix and the executable orchestration plan for the selected case type.
 */
export function OrchestrationCertificationPanel({ roles, caseRef }: Props) {
  const certification = useMemo(() => certifyOrchestration(), []);
  const [selected, setSelected] = useState<CaseType>(caseRef?.caseType ?? "refund_dispute");

  const plan = useMemo(
    () => buildOrchestrationPlan({
      caseId: caseRef?.caseType === selected ? caseRef.id : `preview-${selected}`,
      caseType: selected,
      startedAt: "2026-01-01T00:00:00.000Z",
      actorRoles: roles,
    }),
    [selected, caseRef, roles],
  );

  const visible = visibleActivations(plan, roles);
  const hidden = plan.activations.length - visible.length;
  const graph = visibleGraph(plan, roles);
  const cert = certification.matrix.find((m) => m.caseType === selected)!;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Case-type domain traversal certification
          </CardTitle>
          <Badge variant={certification.release === "GO" ? "default" : "destructive"}>
            {certification.certifiedPct}% certified · {certification.release}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <Progress value={certification.certifiedPct} aria-label="Certification coverage" />
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {certification.matrix.map((m) => (
              <button
                key={m.caseType}
                type="button"
                onClick={() => setSelected(m.caseType)}
                aria-pressed={selected === m.caseType}
                className={`rounded-lg border p-3 text-left transition-colors ${
                  selected === m.caseType ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{m.label}</span>
                  {m.certified ? (
                    <CheckCircle2 className="h-4 w-4 text-primary" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-destructive" />
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {m.coveredDomains.length}/{m.requiredDomains.length} domains · {m.score}% checks
                </p>
              </button>
            ))}
          </div>
          {certification.gaps.length > 0 && (
            <p className="text-xs text-destructive">
              {certification.gaps.length} case type(s) not certified — closure is blocked until traversal gaps are resolved.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Workflow className="h-4 w-4 text-primary" />
              Orchestration plan · {plan.title}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <p className="text-xs text-muted-foreground">Auto-assigned owner</p>
                <p className="font-medium">{plan.owner.team}</p>
                <p className="text-xs text-muted-foreground">{plan.owner.reason}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Predicted priority · SLA</p>
                <p className="font-medium capitalize">
                  {plan.priority.priority} ({plan.priority.score}) · {plan.slaMinutes} min
                </p>
                <p className="font-mono text-xs text-muted-foreground">{plan.correlationId}</p>
              </div>
            </div>
            <Separator />
            <div className="space-y-2">
              {plan.tasks.map((t) => (
                <div key={t.id} className="rounded-md border p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm">{t.title}</span>
                    <Badge variant={t.mandatory ? "default" : "secondary"} className="shrink-0">
                      {t.mandatory ? "mandatory" : "optional"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t.owner} · due +{t.dueMinutes} min{t.approval ? ` · approval: ${t.approval}` : ""}
                  </p>
                  {t.surface && (
                    <Button variant="link" size="sm" className="h-auto p-0 text-xs" asChild>
                      <a href={t.surface}>Open {t.surface}</a>
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Lock className="h-4 w-4 text-primary" />
                Activated domains (permission filtered)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {visible.map((a) => (
                <div key={a.domain} className="rounded-md border p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{a.label}</span>
                    <Badge variant="outline">{a.sensitivity}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{a.team} · {a.records.length} record sets</p>
                  <p className="text-xs text-muted-foreground">{a.records.join(" · ")}</p>
                </div>
              ))}
              {hidden > 0 && (
                <p className="text-xs text-muted-foreground">
                  {hidden} domain activation(s) hidden — your roles do not grant access.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <GitBranch className="h-4 w-4 text-primary" />
                Unified case graph & certification checks
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex flex-wrap gap-1">
                {graph.map((n) => (
                  <Badge key={n.id} variant="secondary" className="text-xs">{n.label}</Badge>
                ))}
              </div>
              <Separator />
              <ul className="space-y-1">
                {cert.checks.map((c) => (
                  <li key={c.id} className="flex items-start gap-2 text-xs">
                    {c.passed ? (
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                    ) : (
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                    )}
                    <span>
                      <span className="font-medium">{c.label}</span> — <span className="text-muted-foreground">{c.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default OrchestrationCertificationPanel;
