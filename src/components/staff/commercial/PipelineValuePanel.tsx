/**
 * PIPELINE VALUE PANEL — one probability-adjusted view of the book.
 * Everything shown here comes from the database engine; when a deal has no
 * recorded value it is counted separately rather than guessed.
 */
import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TrendingUp, Layers, Users, AlertTriangle } from "lucide-react";
import {
  fetchPipelineValueDashboard,
  hours,
  kes,
  type PipelineValueDashboard,
} from "@/lib/commercial/pipelineValue";

export function PipelineValuePanel({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState<PipelineValueDashboard | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetchPipelineValueDashboard()
      .then((d) => alive && setState(d))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  if (loading) return <Skeleton className="h-64 w-full" />;
  if (!state?.ok) {
    return (
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          Pipeline value is unavailable{state?.error ? `: ${state.error}` : ""}.
        </AlertDescription>
      </Alert>
    );
  }

  const totals = state.totals;
  const stages = (state.by_stage ?? []).filter((s) => s.deals > 0);
  const maxWeighted = Math.max(1, ...stages.map((s) => s.weighted_kes));
  const accounts = (state.accounts ?? []).slice(0, compact ? 5 : 15);
  const owners = state.owners ?? [];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Weighted pipeline</CardDescription>
            <CardTitle className="text-2xl">{kes(totals?.weighted_kes)}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            From {kes(totals?.gross_kes)} across {totals?.open_deals ?? 0} open deals
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Revenue this month</CardDescription>
            <CardTitle className="text-2xl">{kes(totals?.revenue_month_kes)}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Recognised from activated contracts ({state.month})
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Deals without a value</CardDescription>
            <CardTitle className="text-2xl">{totals?.no_value_recorded ?? 0}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            These carry no weight until a value is recorded
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Open workload</CardDescription>
            <CardTitle className="text-2xl">
              {hours(owners.reduce((n, o) => n + (o.open_effort_minutes ?? 0), 0))}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {owners.reduce((n, o) => n + (o.open_work_items ?? 0), 0)} open actions
            {state.scope === "mine" ? " (your book)" : ""}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Layers className="h-4 w-4" /> Value by stage
          </CardTitle>
          <CardDescription>Stage probability is set in the pipeline register, not by hand.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {stages.length === 0 ? (
            <p className="text-sm text-muted-foreground">No open deals in the pipeline.</p>
          ) : (
            stages.map((s) => (
              <div key={s.stage_key} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <span className="font-medium">{s.stage_label}</span>
                    <Badge variant="outline">{s.probability_pct}%</Badge>
                    <span className="text-muted-foreground">{s.deals} deals</span>
                  </span>
                  <span className="tabular-nums">
                    {kes(s.weighted_kes)} <span className="text-muted-foreground">of {kes(s.gross_kes)}</span>
                  </span>
                </div>
                <Progress value={(s.weighted_kes / maxWeighted) * 100} className="h-2" />
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-4 w-4" /> Accounts by weighted value
          </CardTitle>
          <CardDescription>Priority order for tomorrow's plan.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead className="text-right">Weighted</TableHead>
                <TableHead className="text-right">Gross</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead>Next action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                    No accounts with open value.
                  </TableCell>
                </TableRow>
              ) : (
                accounts.map((a) => (
                  <TableRow key={`${a.account_id ?? a.account_name}`}>
                    <TableCell className="font-medium">{a.account_name}</TableCell>
                    <TableCell>
                      {a.best_stage ? (
                        <Badge variant="secondary">
                          {a.best_stage}
                          {a.best_probability_pct !== null ? ` · ${a.best_probability_pct}%` : ""}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{kes(a.weighted_kes)}</TableCell>
                    <TableCell className="text-right tabular-nums">{kes(a.gross_kes)}</TableCell>
                    <TableCell className="text-right tabular-nums">{kes(a.revenue_kes)}</TableCell>
                    <TableCell className="max-w-[22rem] text-sm text-muted-foreground">
                      {a.next_action ?? "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {!compact && owners.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4" /> Value and workload by owner
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Owner</TableHead>
                  <TableHead className="text-right">Deals</TableHead>
                  <TableHead className="text-right">Weighted</TableHead>
                  <TableHead className="text-right">Open actions</TableHead>
                  <TableHead className="text-right">Committed time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {owners.map((o) => (
                  <TableRow key={o.staff_id ?? o.staff_name ?? "unassigned"}>
                    <TableCell className="font-medium">{o.staff_name ?? "Unassigned"}</TableCell>
                    <TableCell className="text-right tabular-nums">{o.deals}</TableCell>
                    <TableCell className="text-right tabular-nums">{kes(o.weighted_kes)}</TableCell>
                    <TableCell className="text-right tabular-nums">{o.open_work_items}</TableCell>
                    <TableCell className="text-right tabular-nums">{hours(o.open_effort_minutes)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default PipelineValuePanel;
