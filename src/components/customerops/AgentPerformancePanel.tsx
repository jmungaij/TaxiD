/**
 * Customer Operations — Agent Performance & SLA management dashboard.
 *
 * SLA compliance, first response, resolution, reopen rate, escalation time,
 * CSAT and utilisation — by agent, role and business line.
 */
import { useMemo, useState } from "react";
import { Gauge, Star, Timer, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import {
  GRADE_LABEL,
  agentScorecards,
  deskPerformance,
  performanceByLine,
  performanceByRole,
  type PerformanceCase,
  type PerformanceGrade,
  type PerformanceGroup,
} from "@/lib/customerops/agentPerformance";

const gradeTone: Record<PerformanceGrade, string> = {
  exemplary: "border-status-success/40 text-status-success",
  on_target: "border-primary/40 text-primary",
  watch: "border-status-warning/40 text-status-warning",
  off_target: "border-destructive/40 text-destructive",
};

const mins = (v: number | null) => (v == null ? "—" : v >= 60 ? `${Math.round(v / 60)}h` : `${v}m`);

function GroupTable({ rows, header }: { rows: PerformanceGroup[]; header: string }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{header}</TableHead>
          <TableHead className="text-right">Cases</TableHead>
          <TableHead className="text-right">Response SLA</TableHead>
          <TableHead className="text-right">Resolution SLA</TableHead>
          <TableHead className="text-right">First response</TableHead>
          <TableHead className="text-right">Resolution</TableHead>
          <TableHead className="text-right">Reopen</TableHead>
          <TableHead className="text-right">Escalation</TableHead>
          <TableHead className="text-right">CSAT</TableHead>
          <TableHead className="text-right">Utilisation</TableHead>
          <TableHead className="text-right">Grade</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={11} className="text-center text-sm text-muted-foreground">
              No cases in scope.
            </TableCell>
          </TableRow>
        ) : (
          rows.map((r) => (
            <TableRow key={r.key}>
              <TableCell className="font-medium">{r.label}</TableCell>
              <TableCell className="text-right">{r.cases}</TableCell>
              <TableCell className="text-right">{r.metrics.responseCompliance}%</TableCell>
              <TableCell className="text-right">{r.metrics.resolutionCompliance}%</TableCell>
              <TableCell className="text-right">{mins(r.metrics.firstResponseMinutes)}</TableCell>
              <TableCell className="text-right">{mins(r.metrics.resolutionMinutes)}</TableCell>
              <TableCell className="text-right">{r.metrics.reopenRate}%</TableCell>
              <TableCell className="text-right">{mins(r.metrics.escalationMinutes)}</TableCell>
              <TableCell className="text-right">{r.csat ?? "—"}</TableCell>
              <TableCell className="text-right">{r.utilisation}%</TableCell>
              <TableCell className="text-right">
                <Badge variant="outline" className={gradeTone[r.grade]}>
                  {GRADE_LABEL[r.grade]}
                </Badge>
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

export function AgentPerformancePanel({ cases }: { cases: PerformanceCase[] }) {
  const [capacity] = useState(12);
  const desk = useMemo(() => deskPerformance(cases, capacity), [cases, capacity]);
  const agents = useMemo(() => agentScorecards(cases, { capacityPerAgent: capacity }), [cases, capacity]);
  const roles = useMemo(() => performanceByRole(cases, capacity), [cases, capacity]);
  const lines = useMemo(() => performanceByLine(cases, capacity), [cases, capacity]);

  return (
    <SectionErrorBoundary sectionName="Agent Performance">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            title="Resolution SLA compliance"
            value={`${desk.metrics.resolutionCompliance}%`}
            icon={<Gauge className="h-5 w-5 text-primary" />}
            description={`Response SLA ${desk.metrics.responseCompliance}%`}
          />
          <StatCard
            title="First response / resolution"
            value={`${mins(desk.metrics.firstResponseMinutes)} · ${mins(desk.metrics.resolutionMinutes)}`}
            icon={<Timer className="h-5 w-5 text-primary" />}
            description={`P90 ${mins(desk.metrics.firstResponseP90)} · ${mins(desk.metrics.resolutionP90)}`}
          />
          <StatCard
            title="CSAT"
            value={desk.csat == null ? "—" : `${desk.csat}/5`}
            icon={<Star className="h-5 w-5 text-primary" />}
            description={`${desk.csatResponses} rated cases · reopen ${desk.metrics.reopenRate}%`}
          />
          <StatCard
            title="Desk utilisation"
            value={`${desk.utilisation}%`}
            icon={<Users className="h-5 w-5 text-primary" />}
            description={`${desk.agents} agents · ${desk.stretchedAgents} stretched · ${desk.offTargetAgents} off target`}
          />
        </div>

        <Tabs defaultValue="agents">
          <TabsList>
            <TabsTrigger value="agents">By agent</TabsTrigger>
            <TabsTrigger value="roles">By role</TabsTrigger>
            <TabsTrigger value="lines">By business line</TabsTrigger>
          </TabsList>

          <TabsContent value="agents">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Agent scorecards</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Blended score: resolution SLA 40% · response SLA 25% · CSAT 20% · reopen penalty 15%
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                {agents.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No cases assigned in scope.</p>
                ) : (
                  agents.map((a) => (
                    <div key={a.agentId} className="rounded-lg border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{a.agentName}</p>
                          <p className="text-xs text-muted-foreground">
                            {a.role} · {a.cases} cases · {a.open} open · {a.resolved} resolved
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className={gradeTone[a.grade]}>
                            {GRADE_LABEL[a.grade]}
                          </Badge>
                          <span className="text-sm font-semibold">{a.score}/100</span>
                        </div>
                      </div>
                      <Progress value={a.score} className="mt-2" />
                      <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-4 lg:grid-cols-7">
                        <div><dt className="text-muted-foreground">Response SLA</dt><dd>{a.metrics.responseCompliance}%</dd></div>
                        <div><dt className="text-muted-foreground">Resolution SLA</dt><dd>{a.metrics.resolutionCompliance}%</dd></div>
                        <div><dt className="text-muted-foreground">First response</dt><dd>{mins(a.metrics.firstResponseMinutes)}</dd></div>
                        <div><dt className="text-muted-foreground">Resolution</dt><dd>{mins(a.metrics.resolutionMinutes)}</dd></div>
                        <div><dt className="text-muted-foreground">Reopen rate</dt><dd>{a.metrics.reopenRate}%</dd></div>
                        <div><dt className="text-muted-foreground">Escalation time</dt><dd>{mins(a.metrics.escalationMinutes)}</dd></div>
                        <div><dt className="text-muted-foreground">Utilisation</dt><dd>{a.utilisation}%</dd></div>
                      </dl>
                      {a.lines.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {a.lines.slice(0, 5).map((l) => (
                            <Badge key={l.id} variant="secondary" className="text-[10px]">
                              {l.label} · {l.cases}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="roles">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">SLA management by role</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <GroupTable rows={roles} header="Role / team" />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="lines">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">SLA management by business line</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <GroupTable rows={lines} header="Business line" />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </SectionErrorBoundary>
  );
}
