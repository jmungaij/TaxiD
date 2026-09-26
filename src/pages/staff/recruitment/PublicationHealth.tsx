import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ExternalLink, Gauge, RefreshCw, ShieldCheck } from "lucide-react";

import { StaffPageHeader } from "@/components/staff/primitives";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  buildHealthAlerts,
  fetchPublicationHealth,
  ISSUE_LABEL,
  LATENCY_P95_BUDGET_MS,
} from "@/lib/recruitment/publicHealth";
import FailureReconciliationPanel from "@/components/staff/recruitment/FailureReconciliationPanel";
import PublicationGatePanel from "@/components/staff/recruitment/PublicationGatePanel";
import PublicationReadinessConsole from "@/components/staff/recruitment/PublicationReadinessConsole";

const Metric = ({ label, value, hint }: { label: string; value: string | number; hint?: string }) => (
  <Card>
    <CardContent className="p-5">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </CardContent>
  </Card>
);

export default function PublicationHealth() {
  // Deep link from the vacancies board: ?vacancy=<id> focuses the readiness report.
  const [params] = useSearchParams();
  const focusVacancy = params.get("vacancy") ?? "";

  const health = useQuery({
    queryKey: ["rec", "publicationHealth"],
    queryFn: fetchPublicationHealth,
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: 60_000,
  });

  const alerts = useMemo(() => buildHealthAlerts(health.data), [health.data]);
  const critical = alerts.filter((a) => a.severity === "critical");

  return (
    <div className="space-y-6">
      <StaffPageHeader
        title="Vacancy publication health"
        lede="Continuous reconciliation between Recruitment 360 and what the public Careers site actually serves, with public API latency and failure telemetry."
        actions={
          <Button variant="outline" size="sm" onClick={() => health.refetch()} disabled={health.isFetching}>
            <RefreshCw className={`mr-2 h-4 w-4 ${health.isFetching ? "animate-spin" : ""}`} /> Re-check now
          </Button>
        }
      />

      {health.isLoading ? (
        <div className="grid gap-4 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : health.isError ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Publication health is restricted to recruitment staff and administrators.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <Metric
              label="Live on Careers"
              value={health.data?.public_count ?? 0}
              hint={`of ${health.data?.total_vacancies ?? 0} total vacancies`}
            />
            <Metric
              label="Mismatches"
              value={health.data?.mismatch_count ?? 0}
              hint={`${health.data?.critical_count ?? 0} critical`}
            />
            <Metric
              label="Public API p95"
              value={`${health.data?.latency.p95_ms ?? 0} ms`}
              hint={`budget ${LATENCY_P95_BUDGET_MS} ms · ${health.data?.latency.requests ?? 0} requests / ${health.data?.latency.window_hours ?? 24}h`}
            />
            <Metric
              label="Platform failures"
              value={health.data?.latency.errors ?? 0}
              hint={`technical + security only · avg ${health.data?.latency.avg_ms ?? 0} ms · max ${health.data?.latency.max_ms ?? 0} ms`}
            />
            <Metric
              label="Validation refusals"
              value={health.data?.latency.validation_refusals ?? 0}
              hint="requirements not met at submission — endpoint healthy"
            />
            <Metric
              label="Upload p95"
              value={`${health.data?.uploads?.p95_ms ?? 0} ms`}
              hint={`${health.data?.uploads?.requests ?? 0} candidate document uploads — separate budget from page reads`}
            />
            <Metric
              label="Remediation queue"
              value={health.data?.remediation?.open ?? 0}
              hint={`${health.data?.remediation?.system_remediation ?? 0} caused by the platform · ${health.data?.remediation?.candidate_action ?? 0} awaiting the candidate`}
            />
          </div>


          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">
                {critical.length ? (
                  <span className="flex items-center gap-2 text-destructive">
                    <AlertTriangle className="h-4 w-4" /> {critical.length} critical publication alert
                    {critical.length === 1 ? "" : "s"}
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4" /> Publication integrity
                  </span>
                )}
              </CardTitle>
              <Badge variant="outline">
                Checked {health.data ? new Date(health.data.checked_at).toLocaleTimeString() : "—"}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              {alerts.length === 0 ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4" /> Recruitment 360 and the public Careers site agree on every
                  vacancy. No latency or failure breaches recorded.
                </p>
              ) : (
                alerts.map((a, i) => (
                  <div key={i} className="rounded-lg border p-3">
                    <div className="flex items-center gap-2">
                      <Badge variant={a.severity === "critical" ? "destructive" : "secondary"}>{a.severity}</Badge>
                      <p className="text-sm font-medium">{a.title}</p>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{a.detail}</p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {(health.data?.mismatches.length ?? 0) > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Mismatched vacancies</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {health.data?.mismatches.map((m) => (
                  <div key={m.vacancy_id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
                    <div>
                      <p className="text-sm font-medium">
                        {m.vacancy_no} · {m.title}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {ISSUE_LABEL[m.issue] ?? m.issue} · approval {m.approval_status} · publication{" "}
                        {m.publication_status} · status {m.status}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={m.severity === "critical" ? "destructive" : "secondary"}>{m.severity}</Badge>
                      <Button asChild variant="outline" size="sm">
                        <Link to="/staff/recruitment/vacancies">Open in Vacancies</Link>
                      </Button>
                      {m.public_slug && m.visible_publicly ? (
                        <Button asChild variant="ghost" size="sm">
                          <a href={`/careers/${m.public_slug}`} target="_blank" rel="noreferrer">
                            <ExternalLink className="mr-1 h-3.5 w-3.5" /> Public
                          </a>
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Gauge className="h-4 w-4" /> Recent public API failures
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {(health.data?.recent_failures.length ?? 0) === 0 ? (
                  <p className="text-sm text-muted-foreground">No public careers API failures in the last 7 days.</p>
                ) : (
                  health.data?.recent_failures.map((f, i) => (
                    <div key={i} className="rounded-lg border p-3 text-xs">
                      <p className="flex flex-wrap items-center gap-2 font-medium">
                        <span>
                          {f.operation}
                          {f.slug ? ` · ${f.slug}` : ""} · {f.duration_ms} ms
                        </span>
                        <Badge
                          variant={
                            f.failure_class === "TECHNICAL_FAILURE" || f.failure_class === "SECURITY_FAILURE"
                              ? "destructive"
                              : "secondary"
                          }
                        >
                          {(f.failure_class ?? "UNCLASSIFIED").replace(/_/g, " ").toLowerCase()}
                        </Badge>
                      </p>
                      <p className="text-muted-foreground">{f.error_message ?? "no message"}</p>
                      <p className="text-muted-foreground">{new Date(f.created_at).toLocaleString()}</p>
                    </div>

                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Application intake (24h)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>Accepted: {health.data?.applications.accepted ?? 0}</p>
                <p>Duplicate: {health.data?.applications.duplicate ?? 0}</p>
                <p>Rejected: {health.data?.applications.rejected ?? 0}</p>
                {(health.data?.applications.top_rejections.length ?? 0) > 0 ? (
                  <div className="pt-2">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Top rejection reasons</p>
                    <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                      {health.data?.applications.top_rejections.map((r, i) => (
                        <li key={i}>
                          {r.reason ?? "unknown"} — {r.count}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </div>

          <PublicationReadinessConsole vacancyId={focusVacancy} />
          <PublicationGatePanel />


          <FailureReconciliationPanel hours={24} />
        </>

      )}
    </div>
  );
}
