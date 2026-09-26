/**
 * Publication readiness console — the ten-domain view HR uses BEFORE reaching
 * Publish, with the exact reason, the blocking dependency, the responsible role
 * and the remediation action for each domain.
 *
 * The console offers provisioning and certification, never an override: every
 * state comes from `rec_publication_readiness` and certification outcomes come
 * from an executed run, not from a button.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CircleDashed, Loader2, MinusCircle, PlayCircle, ShieldCheck, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import {
  fetchPublicationReadiness,
  preparePublicationContract,
  STATE_LABEL,
  STATE_TONE,
  type CertificationResult,
  type DomainState,
  type PrepareAction,
  type ReadinessDomain,
} from "@/lib/recruitment/publicationReadiness";


const StateIcon = ({ state }: { state: DomainState }) => {
  const cls = `h-5 w-5 mt-0.5 ${STATE_TONE[state]}`;
  if (state === "PASS") return <CheckCircle2 className={cls} aria-hidden="true" />;
  if (state === "FAIL") return <XCircle className={cls} aria-hidden="true" />;
  if (state === "PENDING") return <CircleDashed className={cls} aria-hidden="true" />;
  return <MinusCircle className={cls} aria-hidden="true" />;
};

export default function PublicationReadinessConsole({ vacancyId: initial = "" }: { vacancyId?: string }) {
  const [vacancyId, setVacancyId] = useState(initial);
  const [applied, setApplied] = useState(initial);
  const [cert, setCert] = useState<CertificationResult | null>(null);
  const [actions, setActions] = useState<PrepareAction[]>([]);
  const [percent, setPercent] = useState<number | null>(null);

  const qc = useQueryClient();

  // A deep link (?vacancy=…) must focus that vacancy's readiness report.
  useEffect(() => {
    if (initial && initial !== applied) {
      setVacancyId(initial);
      setApplied(initial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);


  const readiness = useQuery({
    queryKey: ["staff", "publication-readiness", applied],
    queryFn: () => fetchPublicationReadiness(applied),
    enabled: applied.length > 20,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["staff", "publication-readiness", applied] });
    qc.invalidateQueries({ queryKey: ["staff", "publication-gate", applied] });
    qc.invalidateQueries({ queryKey: ["staff", "publication-gate-runs", applied] });
  };

  // ONE deterministic preparation. HR is not asked to reconstruct the dependency
  // graph: the orchestrator resolves the requirement contract, blueprint,
  // assessment contract and build handshake, then certifies for real.
  const prepare = useMutation({
    mutationFn: () => preparePublicationContract(applied),
    onSuccess: (r) => {
      const certStep = r.steps.find((s) => s.step === "certification");
      const outcome = (certStep?.result as { outcome?: string } | undefined)?.outcome;
      if (outcome) setCert(certStep!.result as unknown as CertificationResult);
      setActions(r.actions_required);
      setPercent(r.readiness_percent);
      toast({
        title: r.ok ? "Publication contract prepared" : `${r.readiness_percent}% ready — action required`,
        description: r.ok
          ? "Every derivable dependency is provisioned and certification passed."
          : r.actions_required.map((a) => a.label).join(" "),
        variant: r.ok ? undefined : "destructive",
      });
      invalidate();
    },
    onError: (e: Error) => toast({ title: "Preparation refused", description: e.message, variant: "destructive" }),
  });

  const prepareButton = (
    <Button
      data-analytics="readiness-prepare"
      onClick={() => prepare.mutate()}
      disabled={prepare.isPending || applied.length < 20}
    >
      {prepare.isPending ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
      ) : (
        <PlayCircle className="mr-2 h-4 w-4" aria-hidden="true" />
      )}
      Prepare publication contract
    </Button>
  );

  // Domains whose remediation is a human authority decision, not a provisioning step.
  const remediation = (d: ReadinessDomain) => {
    if (d.state === "PASS") return null;
    if (d.key === "document_contract" && d.action === "Approve requirement version") {
      return (
        <Button size="sm" variant="outline" asChild data-analytics="readiness-approve-requirements">
          <Link to="/staff/recruitment/requirements">Approve requirement version</Link>
        </Button>
      );
    }
    if (d.key === "competencies" || d.key === "assessment") {
      return (
        <Button size="sm" variant="outline" asChild data-analytics="readiness-assessment">
          <Link to="/staff/recruitment/assessments">{d.action}</Link>
        </Button>
      );
    }
    return null;
  };


  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
          Publication readiness
        </CardTitle>
        <CardDescription>
          Ten domains, each with its own state, dependency, owner and remediation. Publish is the last step, never the
          place where missing configuration is discovered.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setCert(null);
            setApplied(vacancyId.trim());
          }}
        >
          <div className="flex-1 min-w-[260px]">
            <Label htmlFor="readiness-vacancy">Vacancy ID</Label>
            <Input
              id="readiness-vacancy"
              value={vacancyId}
              onChange={(e) => setVacancyId(e.target.value)}
              placeholder="Paste the vacancy identifier"
            />
          </div>
          <Button type="submit" variant="outline" data-analytics="readiness-check" disabled={vacancyId.trim().length < 20}>
            Assess readiness
          </Button>
          {prepareButton}
        </form>

        {(percent !== null || actions.length > 0) && (
          <div className="rounded-lg border border-border p-4">
            <p className="text-sm font-semibold">
              {percent !== null ? `${percent}% ready` : "Preparation result"}
              {actions.length > 0
                ? ` — ${actions.length} ${actions.length === 1 ? "action" : "actions"} require a person`
                : " — every derivable dependency is in place"}
            </p>
            {actions.length > 0 && (
              <ul className="mt-2 space-y-2">
                {actions.map((a) => (
                  <li key={a.key} className="text-sm">
                    <span className="text-destructive font-medium">{a.key}</span> — {a.label}
                    <span className="text-muted-foreground"> (owner: {a.owner})</span>
                    {a.route ? (
                      <Button size="sm" variant="link" asChild className="h-auto px-2 py-0">
                        <Link to={a.route}>Open</Link>
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}


        {readiness.isFetching && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Evaluating readiness…
          </p>
        )}
        {readiness.error && <p className="text-sm text-destructive">{(readiness.error as Error).message}</p>}

        {readiness.data && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant={readiness.data.verdict === "READY" ? "default" : "destructive"}>
                {readiness.data.verdict === "READY" ? "READY TO PUBLISH" : "PUBLICATION BLOCKED"}
              </Badge>
              <span className="text-sm text-muted-foreground">
                {readiness.data.vacancy_no} · {readiness.data.title} · content v{readiness.data.content_version ?? "?"} ·{" "}
                {readiness.data.publication_status}
              </span>
            </div>

            <ol className="grid gap-3">
              {readiness.data.domains.map((d, i) => (
                <li key={d.key} className="rounded-lg border border-border p-4">
                  <div className="flex items-start gap-3">
                    <StateIcon state={d.state} />
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">
                          {i + 1}. {d.label}
                        </p>
                        <span className={`text-xs font-semibold ${STATE_TONE[d.state]}`}>{STATE_LABEL[d.state]}</span>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{d.reason}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Owner: {d.owner}
                        {d.dependency ? ` · Depends on: ${d.dependency}` : ""}
                      </p>
                    </div>
                    <div className="shrink-0">{remediation(d)}</div>
                  </div>
                </li>
              ))}
            </ol>
          </>
        )}

        {cert && (
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Last certification run — {cert.cases_passed}/{cert.cases_total} cases
            </h3>
            <ul className="space-y-1">
              {cert.cases.map((c) => (
                <li key={c.case} className="flex items-start gap-2 text-sm">
                  {c.passed ? (
                    <CheckCircle2 className="h-4 w-4 mt-0.5 text-primary" aria-hidden="true" />
                  ) : (
                    <XCircle className="h-4 w-4 mt-0.5 text-destructive" aria-hidden="true" />
                  )}
                  <span>
                    <span className="font-medium">
                      {c.case} — {c.name}
                    </span>
                    : {c.detail}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
