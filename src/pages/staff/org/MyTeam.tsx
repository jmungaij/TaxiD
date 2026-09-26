/**
 * MY TEAM — manager view of the reporting line.
 *
 * The list comes from `staff_my_team_overview()`, which resolves the caller's own
 * staff record and walks the reporting line downwards. A manager therefore sees
 * exactly the people who report to them, directly or through another manager,
 * and nobody else. Row-level security governs the underlying records.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AsyncState } from "@/components/dashboard/AsyncState";
import { Users, AlertTriangle } from "lucide-react";
import {
  fetchMyTeam,
  fetchTeamOpportunities,
  fetchTeamWorkLoad,
  type TeamMemberOverview,
} from "@/lib/staff/team";
import { buildInterventions, type InterventionCase } from "@/lib/staff/org/interveneNow";
import { fetchCapacityProfile } from "@/lib/workspace";
import { InterveneNowPanel } from "@/components/staff/org/InterveneNowPanel";

const dateLabel = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";

export default function MyTeam() {
  const [rows, setRows] = useState<TeamMemberOverview[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cases, setCases] = useState<InterventionCase[]>([]);
  const [visibleWorkItems, setVisibleWorkItems] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const team = await fetchMyTeam();
      setRows(team);
      // Intervention analysis reads the same records the manager already sees:
      // their line's open work, the live pipeline and the recorded capacity norm.
      const [work, opportunities, capacity] = await Promise.all([
        fetchTeamWorkLoad(team.map((m) => m.staffId)),
        fetchTeamOpportunities(),
        fetchCapacityProfile(),
      ]);
      setVisibleWorkItems(work.length);
      setCases(
        buildInterventions({
          team,
          work,
          opportunities,
          productiveMinutesPerDay: capacity?.productiveMinutes ?? null,
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your team");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const direct = rows?.filter((r) => r.depth === 1) ?? [];
  const indirect = rows?.filter((r) => r.depth > 1) ?? [];
  const overdue = rows?.reduce((n, r) => n + r.overdueWork, 0) ?? 0;
  const open = rows?.reduce((n, r) => n + r.openWork, 0) ?? 0;

  return (
    <div className="space-y-6">
      <header className="max-w-3xl">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
          Organisation & people
        </div>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight sm:text-3xl">
          <Users className="h-6 w-6" aria-hidden /> My team
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Everyone who reports to you, directly or through another manager, with their live workload.
          Open a person to see their full record and their work. Nothing here is estimated: counts
          come from the work items recorded against each person.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "Direct reports", value: direct.length },
          { label: "Open work items", value: open },
          { label: "Overdue", value: overdue },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="pt-6">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {s.label}
              </div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">{s.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <InterveneNowPanel cases={cases} visibleWorkItems={visibleWorkItems} />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="text-base">
            Reporting line{rows ? ` (${rows.length})` : ""}
          </CardTitle>
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            Refresh
          </Button>
        </CardHeader>
        <CardContent>
          <AsyncState
            loading={loading}
            error={error}
            isEmpty={!!rows && rows.length === 0}
            emptyMessage="No employee currently reports to you on the staff register."
            onRetry={() => void load()}
          >
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Reporting</TableHead>
                    <TableHead className="text-right">Open</TableHead>
                    <TableHead className="text-right">Overdue</TableHead>
                    <TableHead className="text-right">Completed</TableHead>
                    <TableHead>Last activity</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(rows ?? []).map((r) => (
                    <TableRow key={r.staffId}>
                      <TableCell>
                        <div className="font-medium">{r.fullName}</div>
                        <div className="text-xs text-muted-foreground">
                          {r.workEmail ?? "No work email recorded"}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {r.positionTitle ?? "—"}
                        {r.unitName && (
                          <div className="text-xs text-muted-foreground">{r.unitName}</div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={r.depth === 1 ? "default" : "secondary"}>
                          {r.depth === 1 ? "Direct" : `Indirect · level ${r.depth}`}
                        </Badge>
                        {!r.hasLogin && (
                          <div className="mt-1 text-xs text-muted-foreground">No login yet</div>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.openWork}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.overdueWork > 0 ? (
                          <span className="inline-flex items-center gap-1 font-semibold text-destructive">
                            <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> {r.overdueWork}
                          </span>
                        ) : (
                          0
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.completedWork}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {dateLabel(r.lastActivity)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" asChild>
                          <Link to={`/staff/org/people/${r.staffId}`}>Open</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {indirect.length > 0 && (
              <p className="mt-3 text-xs text-muted-foreground">
                {indirect.length} of these report through another manager in your line.
              </p>
            )}
          </AsyncState>
        </CardContent>
      </Card>
    </div>
  );
}
