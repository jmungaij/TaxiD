/**
 * SALES TARGET COMMAND BAND — the commercial north star on My Dashboard.
 *
 * Monthly target, revenue won, attainment, remaining, projected month-end and
 * pace, then pipeline coverage and the actions that close the gap. Every figure
 * comes from the database (`commercial_target_dashboard`); nothing is estimated
 * here and no amount is written into this file. A figure with nothing behind it
 * reads as "—" with the reason, never as a zero that looks like a result.
 */
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import {
  AlarmClock,
  ArrowDownRight,
  ArrowUpRight,
  CalendarClock,
  ChevronRight,
  Gauge,
  Layers,
  Target,
  TrendingUp,
} from "lucide-react";
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
  type TargetScope,
} from "@/lib/staff/salesTarget";

const PERIODS: TargetPeriod[] = ["today", "week", "month", "quarter", "year"];

/** Where each figure is investigated. Every KPI is an entry point, not a card. */
const SALES_PORTAL = "/staff/sales";
const BOOK = "/staff/workspace/book";

function Stat({
  label,
  value,
  note,
  to,
  strong,
  tone,
}: {
  label: string;
  value: string;
  note?: string;
  to?: string;
  strong?: boolean;
  tone?: string;
}) {
  const body = (
    <>
      <p className="flex items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
        {to && (
          <ChevronRight
            className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100"
            aria-hidden
          />
        )}
      </p>
      <p
        className={cn(
          "mt-1.5 font-semibold tabular-nums",
          strong ? "text-3xl" : "text-2xl",
          tone,
        )}
      >
        {value}
      </p>
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
    </>
  );
  const shell = "group rounded-xl border bg-card/60 p-4 text-left transition-shadow";
  return to ? (
    <Link to={to} className={cn(shell, "hover:shadow-elegant focus-visible:ring-2 focus-visible:ring-ring")}>
      {body}
    </Link>
  ) : (
    <div className={shell}>{body}</div>
  );
}

export default function SalesTargetHero() {
  const [scope, setScope] = React.useState<TargetScope>("mine");
  const [period, setPeriod] = React.useState<TargetPeriod>("month");
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["sales-target-dashboard", scope, period],
    queryFn: () => fetchTargetDashboard(scope, period),
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
    retry: false,
  });

  // The target position follows the records: any commercial change recomputes it.
  React.useEffect(() => {
    const invalidate = () =>
      void qc.invalidateQueries({ queryKey: ["sales-target-dashboard"] });
    const channel = supabase
      .channel("sales-target-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "sales_leads" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "sales_targets" }, invalidate)
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc]);

  if (isLoading) return <Skeleton className="h-64 w-full rounded-2xl" />;
  if (error || !data) return null; // no commercial identity — nothing to claim

  const { pacing, pipeline, quality, actions } = data;
  const attainment = data.attainment_pct;
  const exceeded = data.surplus_kes > 0;
  const statusTone = STATUS_TONE[data.status];
  const delta = data.revenue_delta_pct;

  const roster = rankRoster(data.roster ?? []);
  const showRoster = data.scope === "team" && roster.length > 1;

  return (
    <section className="glass-panel rounded-2xl p-5" aria-label="Sales target performance">
      {/* ---------- context + controls ---------- */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Target className="h-4 w-4 text-primary" aria-hidden />
            {data.scope === "team" ? "Team sales target" : "My sales target"}
            <Badge variant="outline" className={cn("ml-1", statusTone)}>
              {STATUS_LABEL[data.status]}
            </Badge>
          </h2>
          <p className="text-xs text-muted-foreground">
            {PERIOD_LABEL[data.period]} ·{" "}
            {pacing.business_days_only
              ? `working day ${pacing.selling_days_elapsed} of ${pacing.selling_days_total}`
              : `day ${pacing.days_elapsed} of ${pacing.days_total}`}
            {data.scope === "team" ? ` · ${data.people} people in your line` : ""} · production
            records only
          </p>
          <p className="mt-1 max-w-xl text-xs text-muted-foreground">{data.status_reason}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border p-0.5">
            {PERIODS.map((p) => (
              <Button
                key={p}
                size="sm"
                variant={period === p ? "secondary" : "ghost"}
                onClick={() => setPeriod(p)}
              >
                {PERIOD_LABEL[p].replace("This ", "")}
              </Button>
            ))}
          </div>
          {data.can_view_team && (
            <div className="inline-flex rounded-lg border p-0.5">
              <Button
                size="sm"
                variant={scope === "mine" ? "secondary" : "ghost"}
                onClick={() => setScope("mine")}
              >
                Mine
              </Button>
              <Button
                size="sm"
                variant={scope === "team" ? "secondary" : "ghost"}
                onClick={() => setScope("team")}
              >
                My team
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* ---------- the north star ---------- */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Stat
          label={data.scope === "team" ? "Team target" : "Monthly target"}
          value={data.target_kes ? KES(data.target_kes) : "—"}
          note={data.target_kes ? data.target_basis : "No target set for this period"}
          strong
        />
        <Stat
          label="Revenue won"
          value={KES(data.revenue_won_kes)}
          note={
            delta === null
              ? "No comparable previous period"
              : `${delta > 0 ? "+" : ""}${delta}% vs previous period`
          }
          to={SALES_PORTAL}
          strong
        />
        <Stat
          label="Attainment"
          value={attainment === null ? "—" : `${attainment}%`}
          note={attainment === null ? "No target to measure against" : `of ${KESshort(data.target_kes)}`}
          to={SALES_PORTAL}
          strong
          tone={statusTone.split(" ").filter((c) => c.startsWith("text-")).join(" ")}
        />
        <Stat
          label={exceeded ? "Surplus" : "Remaining"}
          value={exceeded ? KES(data.surplus_kes) : KES(data.remaining_kes)}
          note={
            exceeded
              ? "Above target"
              : pacing.business_days_only && pacing.selling_days_remaining > 0
                ? `${KESshort(pacing.required_selling_day_pace_kes)} a working day for ${pacing.selling_days_remaining} days`
                : pacing.days_remaining > 0
                  ? `${KESshort(pacing.required_daily_pace_kes)} a day for ${pacing.days_remaining} days`
                  : "Period closed"
          }
          to={BOOK}
          strong
        />
        <Stat
          label="Projected month-end"
          value={KES(pacing.projected_revenue_kes)}
          note={
            pacing.projected_attainment_pct === null
              ? "No target to project against"
              : `${pacing.projected_attainment_pct}% projected attainment`
          }
          strong
        />
      </div>

      {/* ---------- pace ---------- */}
      {data.target_kes > 0 && (
        <div className="mt-4 rounded-xl border bg-card/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <Gauge className="h-4 w-4 text-primary" aria-hidden /> Pace
              <span className="text-muted-foreground">
                {pacing.pace_pct === null
                  ? "— period has not started"
                  : `${pacing.pace_pct}% of the pace needed so far`}
              </span>
            </p>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CalendarClock className="h-3.5 w-3.5" aria-hidden />
              Expected by today {KES(pacing.expected_to_date_kes)} · {pacing.days_remaining} days left
            </p>
          </div>
          <Progress
            value={Math.min(100, Math.max(0, attainment ?? 0))}
            className="mt-3 h-2"
            aria-label="Attainment against target"
          />
          <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground">
            <span>{KES(0)}</span>
            <span>
              {(attainment ?? 0) >= 100 ? "Target achieved" : `${KESshort(data.remaining_kes)} to go`}
            </span>
            <span>{KESshort(data.target_kes)}</span>
          </div>
        </div>
      )}

      {/* ---------- pipeline coverage + quality ---------- */}
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Open pipeline"
          value={pipeline.open_pipeline_kes ? KES(pipeline.open_pipeline_kes) : "—"}
          note={`${pipeline.open_count} open ${pipeline.open_count === 1 ? "record" : "records"}`}
          to={SALES_PORTAL}
        />
        <Stat
          label="Coverage of remaining"
          value={pipeline.coverage_x === null ? "—" : `${pipeline.coverage_x}×`}
          note={
            pipeline.coverage_x === null
              ? "Nothing remaining to cover"
              : `Weighted ${pipeline.weighted_coverage_x ?? "—"}× · ${KESshort(pipeline.weighted_pipeline_kes)} weighted`
          }
          to={SALES_PORTAL}
        />
        <Stat
          label="Win rate"
          value={quality.win_rate_pct === null ? "—" : `${quality.win_rate_pct}%`}
          note={
            quality.win_rate_pct === null
              ? "No decided business in this period"
              : `${quality.won_count} of ${quality.decided_count} decided`
          }
          to={SALES_PORTAL}
        />
        <Stat
          label="Average deal · lead to close"
          value={quality.avg_deal_value_kes === null ? "—" : KESshort(quality.avg_deal_value_kes)}
          note={
            quality.lead_to_close_days === null
              ? "No closed business in this period"
              : `${quality.lead_to_close_days} days lead to close`
          }
          to={BOOK}
        />
      </div>

      {/* ---------- what to do next ---------- */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Next actions
        </span>
        <Badge variant="outline" className="gap-1">
          <TrendingUp className="h-3 w-3" aria-hidden /> Gap {KESshort(actions.target_gap_kes)}
        </Badge>
        <Badge variant="outline">{actions.closing_soon_count} closing soon</Badge>
        <Badge variant="outline">{actions.awaiting_customer_count} awaiting customer</Badge>
        <Badge
          variant="outline"
          className={cn(actions.overdue_followups_count > 0 && "border-destructive/50 text-destructive")}
        >
          {actions.overdue_followups_count} overdue follow-ups
        </Badge>
        <Badge variant="outline" className="gap-1">
          <Layers className="h-3 w-3" aria-hidden /> Forecast {KESshort(pipeline.forecast_revenue_kes)}
        </Badge>
        <Badge
          variant="outline"
          className={cn(
            "gap-1",
            data.sla.breached > 0
              ? "border-destructive/50 text-destructive"
              : data.sla.approaching > 0 &&
                  "border-[hsl(var(--status-warning)/0.5)] text-[hsl(var(--status-warning))]",
          )}
        >
          <AlarmClock className="h-3 w-3" aria-hidden />
          {data.sla.open === 0
            ? "Nothing on the clock"
            : `${data.sla.open} on the clock · ${data.sla.breached} overdue`}
        </Badge>
        <Button asChild size="sm" variant="outline" className="ml-auto">
          <Link to={SALES_PORTAL}>Open Sales Portal</Link>
        </Button>
      </div>

      {/* ---------- team ranking ---------- */}
      {showRoster && (
        <div className="mt-4 overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <caption className="sr-only">Team performance ranked by target attainment</caption>
            <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              <tr>
                <th className="p-2.5 font-semibold">Specialist</th>
                <th className="p-2.5 text-right font-semibold">Target</th>
                <th className="p-2.5 text-right font-semibold">Revenue</th>
                <th className="p-2.5 text-right font-semibold">Attainment</th>
                <th className="p-2.5 text-right font-semibold">Pipeline</th>
                <th className="p-2.5 text-right font-semibold">Coverage</th>
                <th className="p-2.5 font-semibold">Status</th>
                <th className="p-2.5 font-semibold">Needs attention</th>
              </tr>
            </thead>
            <tbody>
              {roster.map((r) => {
                const st = rowStatus(r, pacing);
                return (
                  <tr key={r.staff_id} className="border-t">
                    <td className="p-2.5">
                      <span className="font-medium">{r.name ?? "Unnamed"}</span>
                      {r.is_me && <Badge variant="outline" className="ml-2">You</Badge>}
                      {r.position && (
                        <span className="block text-xs text-muted-foreground">{r.position}</span>
                      )}
                    </td>
                    <td className="p-2.5 text-right tabular-nums">{KESshort(r.target_kes)}</td>
                    <td className="p-2.5 text-right tabular-nums">{KESshort(r.revenue_won_kes)}</td>
                    <td className="p-2.5 text-right tabular-nums">
                      {r.attainment_pct === null ? "—" : `${r.attainment_pct}%`}
                      {r.attainment_pct !== null &&
                        (r.attainment_pct >= 100 ? (
                          <ArrowUpRight className="ml-1 inline h-3.5 w-3.5 text-[hsl(var(--status-success))]" aria-hidden />
                        ) : (
                          <ArrowDownRight className="ml-1 inline h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                        ))}
                    </td>
                    <td className="p-2.5 text-right tabular-nums">{KESshort(r.open_pipeline_kes)}</td>
                    <td className="p-2.5 text-right tabular-nums">
                      {r.coverage_x === null ? "—" : `${r.coverage_x}×`}
                    </td>
                    <td className="p-2.5">
                      <Badge variant="outline" className={STATUS_TONE[st]}>
                        {STATUS_LABEL[st]}
                      </Badge>
                    </td>
                    <td className="p-2.5 text-xs">
                      {r.needs_intervention ? (
                        <ul className="space-y-0.5">
                          {(r.intervention_reasons ?? []).map((reason) => (
                            <li key={reason} className="text-muted-foreground">
                              {reason}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-muted-foreground">Nothing outstanding</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
