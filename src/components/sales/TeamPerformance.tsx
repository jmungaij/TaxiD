/**
 * MY TEAM — the manager's view of the sales team.
 *
 * Team quota, revenue won, attainment and pipeline for the chosen period, the
 * people who need attention first, and a drill-down into any one salesperson's
 * own figures. Every number is computed by the database
 * (`commercial_target_dashboard`), which also checks the person really reports to
 * the manager asking before it returns anything about them.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { AlertTriangle, ArrowLeft, ChevronRight, Lock, Users } from "lucide-react";
import {
  KES,
  KESshort,
  PERIOD_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
  fetchTargetDashboard,
  rankRoster,
  rowStatus,
  type TargetPeriod,
  type TargetRosterRow,
} from "@/lib/staff/salesTarget";

const PERIODS: TargetPeriod[] = ["month", "quarter", "year"];

function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border bg-card/60 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums">{value}</p>
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

function PeriodTabs({
  period,
  onChange,
}: {
  period: TargetPeriod;
  onChange: (p: TargetPeriod) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1 rounded-lg border p-1">
      {PERIODS.map((p) => (
        <Button
          key={p}
          size="sm"
          variant={period === p ? "secondary" : "ghost"}
          className="h-7 px-2.5 text-xs"
          onClick={() => onChange(p)}
        >
          {PERIOD_LABEL[p]}
        </Button>
      ))}
    </div>
  );
}

/* ------------------------------------------------- one salesperson, in detail */

function PersonView({
  staffId,
  period,
  onBack,
}: {
  staffId: string;
  period: TargetPeriod;
  onBack: () => void;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["sales-target-dashboard", "person", staffId, period],
    queryFn: () => fetchTargetDashboard("person", period, undefined, staffId),
    retry: false,
  });

  if (isLoading) return <Skeleton className="h-72 w-full rounded-2xl" />;
  if (error || !data)
    return (
      <Card>
        <CardContent className="space-y-3 pt-6 text-sm text-muted-foreground">
          <p>
            {error instanceof Error && /REPORTING_LINE/.test(error.message)
              ? "This person does not report to you, so their figures are not shown."
              : "Their figures could not be read."}
          </p>
          <Button variant="outline" size="sm" onClick={onBack}>
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Back to the team
          </Button>
        </CardContent>
      </Card>
    );

  const attainment = data.attainment_pct;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Button variant="ghost" size="sm" className="-ml-2 mb-1" onClick={onBack}>
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Back to the team
          </Button>
          <h3 className="text-lg font-semibold">{data.person_name ?? "This salesperson"}</h3>
          <p className="text-sm text-muted-foreground">{data.status_reason}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data.frozen && (
            <Badge variant="outline" className="gap-1">
              <Lock className="h-3 w-3" aria-hidden /> Closed period
            </Badge>
          )}
          <Badge variant="outline" className={STATUS_TONE[data.status]}>
            {STATUS_LABEL[data.status]}
          </Badge>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Figure label="Quota" value={data.target_kes ? KES(data.target_kes) : "No quota"} note={data.target_basis} />
        <Figure
          label="Revenue won"
          value={data.quality.decided_count === 0 && data.revenue_won_kes === 0 ? "No decided business yet" : KES(data.revenue_won_kes)}
        />
        <Figure
          label="Attainment"
          value={attainment === null ? "—" : `${attainment}%`}
          note={data.target_kes ? `${KES(data.remaining_kes)} still to win` : "No quota set"}
        />
        <Figure
          label="Open pipeline"
          value={data.pipeline.open_count === 0 ? "Nothing open" : KES(data.pipeline.open_pipeline_kes)}
          note={
            data.pipeline.coverage_x === null
              ? undefined
              : `${data.pipeline.coverage_x}x cover of what is left`
          }
        />
      </div>

      {attainment !== null && <Progress value={Math.min(attainment, 100)} className="h-2" />}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Figure
          label="Win rate"
          value={data.quality.win_rate_pct === null ? "—" : `${data.quality.win_rate_pct}%`}
          note={`${data.quality.won_count} won of ${data.quality.decided_count} decided`}
        />
        <Figure
          label="Average deal"
          value={data.quality.avg_deal_value_kes === null ? "—" : KES(data.quality.avg_deal_value_kes)}
        />
        <Figure
          label="Lead to close"
          value={data.quality.lead_to_close_days === null ? "—" : `${data.quality.lead_to_close_days} days`}
        />
        <Figure
          label="On the clock"
          value={`${data.sla.open}`}
          note={
            data.sla.breached > 0
              ? `${data.sla.breached} past the agreed time`
              : "Nothing past the agreed time"
          }
        />
      </div>

      {data.roster[0]?.intervention_reasons?.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Needs attention</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {data.roster[0].intervention_reasons.map((r, i) => (
              <p key={i} className="text-muted-foreground">
                · {r}
              </p>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------- team summary */

export default function TeamPerformance() {
  const [period, setPeriod] = React.useState<TargetPeriod>("month");
  const [person, setPerson] = React.useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["sales-target-dashboard", "team", period],
    queryFn: () => fetchTargetDashboard("team", period),
    refetchInterval: 60_000,
    retry: false,
  });

  if (person)
    return (
      <div className="space-y-4">
        <PeriodTabs period={period} onChange={setPeriod} />
        <PersonView staffId={person} period={period} onBack={() => setPerson(null)} />
      </div>
    );

  if (isLoading) return <Skeleton className="h-72 w-full rounded-2xl" />;
  if (error || !data)
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">
          Team figures could not be read.
        </CardContent>
      </Card>
    );

  if (!data.can_view_team)
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4 text-primary" aria-hidden /> My team
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Nobody currently reports to you, so there is no team view to show.
        </CardContent>
      </Card>
    );

  const roster = rankRoster(data.roster);
  const atRisk = roster.filter((r) => r.needs_intervention);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-lg font-semibold">
            <Users className="h-4 w-4 text-primary" aria-hidden /> My team
          </h3>
          <p className="text-sm text-muted-foreground">
            {data.people} {data.people === 1 ? "person" : "people"} · {data.status_reason}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data.frozen && (
            <Badge variant="outline" className="gap-1">
              <Lock className="h-3 w-3" aria-hidden /> Closed period — figures fixed
            </Badge>
          )}
          <Badge variant="outline" className={STATUS_TONE[data.status]}>
            {STATUS_LABEL[data.status]}
          </Badge>
          <PeriodTabs period={period} onChange={setPeriod} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Figure
          label="Team quota"
          value={data.target_kes ? KES(data.target_kes) : "No quota"}
          note={data.target_basis}
        />
        <Figure
          label="Revenue won"
          value={
            data.quality.decided_count === 0 && data.revenue_won_kes === 0
              ? "No decided business yet"
              : KES(data.revenue_won_kes)
          }
          note={
            data.revenue_delta_pct === null
              ? undefined
              : `${data.revenue_delta_pct}% against the period before`
          }
        />
        <Figure
          label="Attainment"
          value={data.attainment_pct === null ? "—" : `${data.attainment_pct}%`}
          note={data.target_kes ? `${KES(data.remaining_kes)} still to win` : undefined}
        />
        <Figure
          label="Open pipeline"
          value={data.pipeline.open_count === 0 ? "Nothing open" : KES(data.pipeline.open_pipeline_kes)}
          note={
            data.pipeline.coverage_x === null
              ? undefined
              : `${data.pipeline.coverage_x}x cover · ${data.pipeline.weighted_coverage_x ?? "—"}x weighted`
          }
        />
      </div>

      {data.attainment_pct !== null && (
        <Progress value={Math.min(data.attainment_pct, 100)} className="h-2" />
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4 text-primary" aria-hidden /> Who needs attention
          </CardTitle>
          <CardDescription>
            Behind pace, thin pipeline cover, a missed response time or overdue follow-ups.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {atRisk.length === 0 && (
            <p className="text-muted-foreground">
              Nobody on the team is flagged for this period.
            </p>
          )}
          {atRisk.map((r) => (
            <button
              key={r.staff_id}
              onClick={() => setPerson(r.staff_id)}
              className="flex w-full flex-wrap items-center justify-between gap-2 rounded-md border p-2.5 text-left transition-shadow hover:shadow-elegant focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="font-medium">{r.name ?? "Unnamed"}</span>
              <span className="flex flex-wrap items-center gap-1.5">
                {r.intervention_reasons.map((x, i) => (
                  <Badge key={i} variant="outline" className="font-normal">
                    {x}
                  </Badge>
                ))}
                <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
              </span>
            </button>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Everyone, best attainment first</CardTitle>
          <CardDescription>Open a name to see that person's own dashboard.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0 sm:p-0">
          <table className="w-full text-sm">
            <caption className="sr-only">Team attainment</caption>
            <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              <tr>
                <th className="p-2.5 font-semibold">Salesperson</th>
                <th className="p-2.5 text-right font-semibold">Quota</th>
                <th className="p-2.5 text-right font-semibold">Won</th>
                <th className="p-2.5 text-right font-semibold">Attainment</th>
                <th className="p-2.5 text-right font-semibold">Pipeline</th>
                <th className="p-2.5 font-semibold">Standing</th>
                <th className="p-2.5" />
              </tr>
            </thead>
            <tbody>
              {roster.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-3 text-muted-foreground">
                    No salespeople are in your reporting line yet.
                  </td>
                </tr>
              )}
              {roster.map((r: TargetRosterRow) => {
                const st = rowStatus(r, data.pacing);
                return (
                  <tr
                    key={r.staff_id}
                    className={cn("border-t", r.is_me && "bg-muted/20")}
                  >
                    <td className="p-2.5">
                      {r.name ?? "Unnamed"}
                      {r.is_me && (
                        <Badge variant="outline" className="ml-2 font-normal">
                          You
                        </Badge>
                      )}
                      {r.position && (
                        <span className="block text-xs text-muted-foreground">{r.position}</span>
                      )}
                    </td>
                    <td className="p-2.5 text-right tabular-nums">
                      {r.target_kes ? KESshort(r.target_kes) : "—"}
                    </td>
                    <td className="p-2.5 text-right tabular-nums">
                      {r.decided_count === 0 && r.revenue_won_kes === 0 ? "—" : KESshort(r.revenue_won_kes)}
                    </td>
                    <td className="p-2.5 text-right tabular-nums">
                      {r.attainment_pct === null ? "—" : `${r.attainment_pct}%`}
                    </td>
                    <td className="p-2.5 text-right tabular-nums">
                      {r.open_pipeline_kes ? KESshort(r.open_pipeline_kes) : "—"}
                    </td>
                    <td className="p-2.5">
                      <Badge variant="outline" className={STATUS_TONE[st]}>
                        {STATUS_LABEL[st]}
                      </Badge>
                    </td>
                    <td className="p-2.5 text-right">
                      <Button size="sm" variant="ghost" onClick={() => setPerson(r.staff_id)}>
                        Open <ChevronRight className="ml-1 h-3.5 w-3.5" aria-hidden />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
