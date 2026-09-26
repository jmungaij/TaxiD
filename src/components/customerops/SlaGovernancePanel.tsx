/**
 * Customer Operations — SLA governance panel.
 *
 * Surfaces the SLA engine: response/resolution performance, compliance by
 * department, corporate account and service tier, agent utilisation and the
 * live breach radar.
 */
import { useMemo } from "react";
import { Timer, TrendingUp, AlertTriangle, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import StatCard from "@/components/common/StatCard";
import { SectionErrorBoundary } from "@/components/dashboard/SectionErrorBoundary";
import type { AnalyticsCase } from "@/lib/customerops/intelligence";
import {
  agentUtilization,
  breachRadar,
  slaMetrics,
  slaSegments,
  type SegmentKind,
} from "@/lib/customerops/slaEngine";

const duration = (minutes: number | null): string => {
  if (minutes == null) return "—";
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h < 24) return m ? `${h}h ${m}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
};

const SEGMENT_TITLE: Record<SegmentKind, string> = {
  tier: "Compliance by service tier",
  department: "Compliance by department",
  corporate: "Compliance by corporate account",
};

export function SlaGovernancePanel({ cases }: { cases: AnalyticsCase[] }) {
  const metrics = useMemo(() => slaMetrics(cases), [cases]);
  const segments = useMemo(() => slaSegments(cases), [cases]);
  const utilisation = useMemo(() => agentUtilization(cases), [cases]);
  const radar = useMemo(() => breachRadar(cases), [cases]);

  const bySegment = (kind: SegmentKind) => segments.filter((s) => s.kind === kind);

  return (
    <SectionErrorBoundary sectionName="SLA Governance">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            title="First response"
            value={duration(metrics.firstResponseMinutes)}
            icon={<Timer className="h-5 w-5 text-primary" />}
            description={`P90 ${duration(metrics.firstResponseP90)}`}
          />
          <StatCard
            title="Resolution time"
            value={duration(metrics.resolutionMinutes)}
            icon={<TrendingUp className="h-5 w-5 text-primary" />}
            description={`P90 ${duration(metrics.resolutionP90)}`}
          />
          <StatCard
            title="Resolution compliance"
            value={`${metrics.resolutionCompliance}%`}
            icon={<TrendingUp className="h-5 w-5 text-primary" />}
            description={`Response compliance ${metrics.responseCompliance}%`}
          />
          <StatCard
            title="Reopen rate"
            value={`${metrics.reopenRate}%`}
            icon={<AlertTriangle className="h-5 w-5 text-primary" />}
            description={`First-contact resolution ${metrics.firstContactResolution}%`}
          />
          <StatCard
            title="Escalated share"
            value={`${metrics.escalatedShare}%`}
            icon={<AlertTriangle className="h-5 w-5 text-primary" />}
            description={`Time to escalation ${duration(metrics.escalationMinutes)}`}
          />
          <StatCard
            title="Open cases"
            value={metrics.open}
            icon={<Users className="h-5 w-5 text-primary" />}
            description={`${metrics.cases} in the loaded window`}
          />
          <StatCard
            title="Breach radar"
            value={radar.filter((r) => r.level === "breached").length}
            icon={<AlertTriangle className="h-5 w-5 text-primary" />}
            description={`${radar.filter((r) => r.level === "critical").length} critical · ${radar.filter((r) => r.level === "at_risk").length} at risk`}
          />
          <StatCard
            title="Agents on queue"
            value={utilisation.filter((u) => u.agent !== "unassigned").length}
            icon={<Users className="h-5 w-5 text-primary" />}
            description={`${utilisation.filter((u) => u.state === "overloaded").length} overloaded`}
          />
        </div>

        {(["tier", "department", "corporate"] as SegmentKind[]).map((kind) => {
          const rows = bySegment(kind);
          if (rows.length === 0) return null;
          return (
            <Card key={kind}>
              <CardHeader>
                <CardTitle className="text-base">{SEGMENT_TITLE[kind]}</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Segment</TableHead>
                      <TableHead className="text-right">Cases</TableHead>
                      <TableHead className="text-right">Open</TableHead>
                      <TableHead className="text-right">First response</TableHead>
                      <TableHead className="text-right">Resolution</TableHead>
                      <TableHead className="text-right">Compliance</TableHead>
                      <TableHead className="text-right">Target</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((s) => (
                      <TableRow key={`${s.kind}-${s.key}`}>
                        <TableCell className="font-medium">{s.label}</TableCell>
                        <TableCell className="text-right">{s.metrics.cases}</TableCell>
                        <TableCell className="text-right">{s.metrics.open}</TableCell>
                        <TableCell className="text-right">{duration(s.metrics.firstResponseMinutes)}</TableCell>
                        <TableCell className="text-right">{duration(s.metrics.resolutionMinutes)}</TableCell>
                        <TableCell className="text-right">{s.metrics.resolutionCompliance}%</TableCell>
                        <TableCell className="text-right">{s.target}%</TableCell>
                        <TableCell>
                          <Badge variant={s.meetsTarget ? "secondary" : "destructive"}>
                            {s.meetsTarget ? "On target" : "Below target"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          );
        })}

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Agent utilisation</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {utilisation.length === 0 ? (
                <p className="text-sm text-muted-foreground">No open cases assigned.</p>
              ) : (
                utilisation.map((u) => (
                  <div key={u.agent} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="truncate font-medium">
                        {u.agent === "unassigned" ? "Unassigned queue" : u.agent.slice(0, 8)}
                      </span>
                      <span className="flex items-center gap-2 text-muted-foreground">
                        {u.open}/{u.capacity}
                        <Badge
                          variant={
                            u.state === "overloaded"
                              ? "destructive"
                              : u.state === "stretched"
                                ? "default"
                                : "outline"
                          }
                        >
                          {u.state}
                        </Badge>
                      </span>
                    </div>
                    <Progress value={Math.min(100, u.utilisation)} />
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Live breach radar</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {radar.length === 0 ? (
                <p className="text-sm text-muted-foreground">Every open case is comfortably inside SLA.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Case</TableHead>
                      <TableHead>Tier</TableHead>
                      <TableHead className="text-right">Time left</TableHead>
                      <TableHead>Level</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {radar.slice(0, 20).map((r) => (
                      <TableRow key={r.caseId}>
                        <TableCell>
                          <span className="block text-sm font-medium">{r.caseNumber}</span>
                          <span className="block max-w-[240px] truncate text-xs text-muted-foreground">
                            {r.subject}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{r.tier}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {r.minutesRemaining == null
                            ? "—"
                            : r.minutesRemaining < 0
                              ? `-${duration(Math.abs(r.minutesRemaining))}`
                              : duration(r.minutesRemaining)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={r.level === "breached" ? "destructive" : r.level === "critical" ? "default" : "secondary"}>
                            {r.level.replace("_", " ")}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </SectionErrorBoundary>
  );
}

export default SlaGovernancePanel;
