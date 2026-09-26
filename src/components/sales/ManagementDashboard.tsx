/**
 * MANAGEMENT DASHBOARD — the desk as leadership reads it.
 *
 * Team revenue against the combined target, pipeline, deals won and one line per
 * specialist, all computed in the database from the lead, contract and revenue
 * records. The evening freeze times are shown so a figure can always be traced
 * to the moment it was recorded.
 */
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  fetchManagementDashboard,
  KES,
  shortDate,
  shortDateTime,
  GRAIN_LABEL,
  type ManagementPeriod,
} from "@/lib/sales/kpi";

function PeriodCard({ label, p }: { label: string; p: ManagementPeriod }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </p>
        <p className="mt-1 text-xl font-semibold tracking-tight">{KES(p.revenue_kes)}</p>
        {p.target_kes === null ? (
          <p className="mt-1 text-xs text-muted-foreground">NO TARGET ON THE REGISTER</p>
        ) : (
          <>
            <Progress value={Math.min(p.attainment_pct ?? 0, 100)} className="mt-2 h-1.5" />
            <p className="mt-1 text-xs text-muted-foreground">
              {p.attainment_pct}% of {KES(p.target_kes)} · from {shortDate(p.period_start)}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function ManagementDashboard() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["sales-management-dashboard"],
    queryFn: fetchManagementDashboard,
  });

  if (isLoading) return <Skeleton className="h-72 w-full" />;
  if (error)
    return (
      <Card className="border-destructive/40">
        <CardContent className="pt-6 text-sm">
          <p className="font-medium">The desk could not be read.</p>
          <p className="text-muted-foreground">{(error as Error).message}</p>
        </CardContent>
      </Card>
    );
  if (!data)
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">
          THIS VIEW IS FOR DESK LEADERSHIP. Your account does not hold that permission.
        </CardContent>
      </Card>
    );

  const m = data.month;

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <PeriodCard label="This month" p={m} />
        <PeriodCard label="This quarter" p={data.quarter} />
        <PeriodCard label="This year" p={data.year} />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Team position</CardTitle>
          <CardDescription>
            Revenue counted when it is {data.revenue_basis === "CLOSED_WON" ? "won" : "recognised"} ·
            as at {shortDate(data.as_of)}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: "Deals won", value: String(m.won_count ?? 0) },
            { label: "Deals lost", value: String(m.lost_count ?? 0) },
            {
              label: "Win rate",
              value:
                m.win_rate_pct === null || m.win_rate_pct === undefined
                  ? "NOTHING DECIDED YET"
                  : `${m.win_rate_pct}%`,
            },
            { label: "Open leads", value: String(m.open_count ?? 0) },
            { label: "Pipeline value", value: KES(m.open_pipeline_kes ?? 0) },
            { label: "Likely value", value: KES(m.weighted_pipeline_kes ?? 0) },
          ].map((k) => (
            <div key={k.label} className="rounded-md border p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {k.label}
              </p>
              <p className="mt-1 text-lg font-semibold tracking-tight">{k.value}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Each specialist</CardTitle>
          <CardDescription>
            {data.people.length === 0
              ? "NO SPECIALIST ON THE REGISTER"
              : "One line per person this month, with the quarter and year behind it."}
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Specialist</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Target</TableHead>
                <TableHead className="text-right">Won / lost</TableHead>
                <TableHead className="text-right">Open</TableHead>
                <TableHead className="text-right">Pipeline</TableHead>
                <TableHead className="text-right">Quarter</TableHead>
                <TableHead className="text-right">Year</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.people.map((p) => (
                <TableRow key={p.staff_member_id}>
                  <TableCell>
                    <div className="font-medium">{p.staff_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {p.position_code ?? "No position recorded"}
                      {p.stale_count > 0 ? ` · ${p.stale_count} untouched a week` : ""}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-medium">{KES(p.revenue_kes)}</TableCell>
                  <TableCell className="text-right">
                    {p.target_kes === null ? (
                      <span className="text-xs text-muted-foreground">NO TARGET</span>
                    ) : (
                      <>
                        {KES(p.target_kes)}
                        <div className="text-xs text-muted-foreground">{p.attainment_pct}%</div>
                      </>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {p.won_count} / {p.lost_count}
                    <div className="text-xs text-muted-foreground">
                      {p.win_rate_pct === null ? "nothing decided" : `${p.win_rate_pct}% win rate`}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">{p.open_count}</TableCell>
                  <TableCell className="text-right">
                    {KES(p.open_pipeline_kes)}
                    <div className="text-xs text-muted-foreground">
                      {KES(p.weighted_pipeline_kes)} likely
                    </div>
                  </TableCell>
                  <TableCell className="text-right">{KES(p.quarter_revenue_kes)}</TableCell>
                  <TableCell className="text-right">{KES(p.year_revenue_kes)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent closes</CardTitle>
          <CardDescription>
            Figures freeze at 7 PM Kenya time each day; the week closes on Saturday, the month at
            month end, rolling into the quarter and year.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.closes.length === 0 && (
            <p className="text-sm text-muted-foreground">
              NO CLOSE RECORDED YET. The first freeze runs at 7 PM Kenya time.
            </p>
          )}
          {data.closes.map((c) => (
            <div
              key={`${c.grain}-${c.period_start}-${c.closed_at}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
            >
              <span className="font-medium">
                {GRAIN_LABEL[c.grain]} · {shortDate(c.period_start)}
                {c.period_end !== c.period_start ? ` – ${shortDate(c.period_end)}` : ""}
              </span>
              <span className="text-muted-foreground">
                {KES(c.revenue_kes)} · {c.people} specialist{c.people === 1 ? "" : "s"}
              </span>
              <Badge variant="outline">{shortDateTime(c.closed_at)}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
