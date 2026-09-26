import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Gauge, FlaskConical, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

import { StaffPageHeader } from "@/components/staff/primitives";
import { AdminOnly } from "@/components/auth/AdminOnly";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, StatusPill, ProvenanceTag, dateText } from "@/components/staff/org/OrgForms";
import * as perf from "@/lib/staff/org/performance";
import type { ObjectivePerformance, Scorecard } from "@/lib/staff/org/performance";

/**
 * Performance scorecards — the connected proof that organisation, positions,
 * objectives, targets, actuals and scoring behave as one system.
 *
 * Every figure on this page comes from `v_objective_performance`, the single
 * authoritative calculation. An objective without a recorded actual reads as
 * NOT RECORDED and is excluded from the score rather than counted as zero.
 */
export default function PerformanceScorecard() {
  const qc = useQueryClient();
  const [detail, setDetail] = useState<ObjectivePerformance | null>(null);

  const rowsQ = useQuery({
    queryKey: ["org", "performance"],
    queryFn: () => perf.listObjectivePerformance(),
  });
  const rows = rowsQ.data ?? [];

  const cards = useMemo(() => perf.scorecardsByOwner(rows), [rows]);
  const depts = useMemo(() => perf.departmentRollups(rows), [rows]);
  const findings = useMemo(() => perf.integrityFindings(rows), [rows]);

  const seed = useMutation({
    mutationFn: perf.runPerformanceSeed,
    onSuccess: (r) => {
      toast.success(`Seed applied — ${r.objectives ?? 0} objectives, ${r.staff ?? 0} staff, ${r.actuals ?? 0} actuals`);
      qc.invalidateQueries({ queryKey: ["org"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rollback = useMutation({
    mutationFn: perf.rollbackPerformanceSeed,
    onSuccess: (r) => {
      toast.success(`Seed removed — ${r.objectives_removed ?? 0} objectives, ${r.staff_removed ?? 0} staff`);
      qc.invalidateQueries({ queryKey: ["org"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AdminOnly roles={["admin", "super_admin", "compliance_admin", "operations_admin", "finance_admin", "operations_manager"]}>
      <StaffPageHeader
        eyebrow="Performance measurement"
        title="Objective scorecards and weighted performance"
        lede="Targets, verified actuals, achievement, weighted score and rating — calculated once in the system of record. Objectives without a recorded actual read as NOT RECORDED, never as zero."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => seed.mutate()} disabled={seed.isPending}>
              <FlaskConical className="mr-2 size-4" /> Run seeded experiment
            </Button>
            <Button variant="ghost" size="sm" onClick={() => rollback.mutate()} disabled={rollback.isPending}>
              Remove seeded data
            </Button>
          </div>
        }
      />

      {rowsQ.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No measurable objectives yet"
          hint="Create weighted objectives with a target, a KPI unit and a declared data source, then record verified actuals."
        />
      ) : (
        <div className="space-y-6">
          {/* department rollup */}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {depts.map((d) => (
              <Card key={d.unitId ?? "unassigned"}>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Gauge className="size-4 text-primary" /> {d.unitName}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-2xl font-semibold tabular-nums">
                      {d.score === null ? perf.NOT_RECORDED : `${d.score}%`}
                    </span>
                    {d.rating ? <StatusPill value={d.rating} /> : null}
                  </div>
                  <dl className="grid grid-cols-2 gap-1 text-xs text-muted-foreground">
                    <dt>People</dt><dd className="text-right tabular-nums">{d.people}</dd>
                    <dt>Objectives</dt><dd className="text-right tabular-nums">{d.objectives}</dd>
                    <dt>Measured</dt><dd className="text-right tabular-nums">{d.measured}</dd>
                    <dt>Not recorded</dt><dd className="text-right tabular-nums">{d.unmeasured}</dd>
                    <dt>At risk / off track</dt><dd className="text-right tabular-nums">{d.atRisk}</dd>
                    <dt>Overdue</dt><dd className="text-right tabular-nums">{d.overdue}</dd>
                  </dl>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* integrity findings */}
          {findings.length > 0 ? (
            <Card className="border-destructive/40">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <AlertTriangle className="size-4 text-destructive" /> Integrity findings ({findings.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                  {findings.slice(0, 12).map((f) => <li key={f}>{f}</li>)}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          {/* employee scorecards */}
          {cards.map((card) => (
            <ScorecardBlock key={card.staffId ?? card.name} card={card} onOpen={setDetail} />
          ))}
        </div>
      )}

      <ObjectiveDetail objective={detail} onClose={() => setDetail(null)} />
    </AdminOnly>
  );
}

function ScorecardBlock({ card, onOpen }: { card: Scorecard; onOpen: (o: ObjectivePerformance) => void }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">{card.name}</CardTitle>
            <p className="text-xs text-muted-foreground">
              {card.position ?? "No position assigned"}{card.unitName ? ` · ${card.unitName}` : ""}
            </p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-semibold tabular-nums">
              {card.weightedScore === null ? perf.NOT_RECORDED : `${card.weightedScore}%`}
            </p>
            <div className="flex items-center justify-end gap-2">
              {card.rating ? <StatusPill value={card.rating} /> : null}
              <Badge variant={card.weightValid ? "outline" : "destructive"} className="text-[10px]">
                Weight {card.weightTotal}%
              </Badge>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {card.caveats.length > 0 ? (
          <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            {card.caveats.map((c) => <li key={c}>{c}</li>)}
          </ul>
        ) : null}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Objective</TableHead>
                <TableHead className="text-right">Weight</TableHead>
                <TableHead className="text-right">Target</TableHead>
                <TableHead className="text-right">Actual</TableHead>
                <TableHead className="text-right">Achievement</TableHead>
                <TableHead className="text-right">Variance</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Source</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {card.objectives.map((o) => (
                <TableRow key={o.id} className="cursor-pointer" onClick={() => onOpen(o)}>
                  <TableCell className="max-w-[22rem]">
                    <span className="font-medium">{o.title}</span>
                    {o.is_critical ? <Badge variant="outline" className="ml-2 text-[10px]">Critical</Badge> : null}
                    <span className="block text-xs text-muted-foreground">{o.kpi_label ?? "—"}</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {o.weight_pct === null ? "—" : `${o.weight_pct}%`}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {perf.formatKpiValue(o.target, o.kpi_unit, o.currency)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {perf.formatKpiValue(o.actual, o.kpi_unit, o.currency)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{perf.formatAchievement(o.achievement_pct)}</TableCell>
                  <TableCell className="text-right tabular-nums">{perf.formatVariance(o.variance_pp)}</TableCell>
                  <TableCell><StatusPill value={o.computed_status} /></TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {perf.SOURCE_LABEL[o.source_type]}
                    <ProvenanceTag provenance={o.provenance} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function ObjectiveDetail({ objective, onClose }: { objective: ObjectivePerformance | null; onClose: () => void }) {
  const actualsQ = useQuery({
    queryKey: ["org", "performance", "actuals", objective?.id],
    queryFn: () => perf.listKpiActuals(objective!.id),
    enabled: !!objective,
  });

  if (!objective) return null;
  const o = objective;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{o.title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          {o.description ? <p className="text-muted-foreground">{o.description}</p> : null}
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2">
            <dt className="text-muted-foreground">KPI</dt><dd>{o.kpi_label ?? "—"}</dd>
            <dt className="text-muted-foreground">Formula</dt><dd>{o.formula ?? "—"}</dd>
            <dt className="text-muted-foreground">Data source</dt><dd>{o.data_source ?? "—"}</dd>
            <dt className="text-muted-foreground">Source type</dt><dd>{perf.SOURCE_LABEL[o.source_type]}</dd>
            <dt className="text-muted-foreground">Measurement</dt><dd>{o.measurement_frequency ?? "—"}</dd>
            <dt className="text-muted-foreground">Period</dt>
            <dd>{dateText(o.period_start)} → {dateText(o.deadline)}</dd>
            <dt className="text-muted-foreground">Baseline</dt>
            <dd>{perf.formatKpiValue(o.baseline, o.kpi_unit, o.currency)}</dd>
            <dt className="text-muted-foreground">Target</dt>
            <dd>{perf.formatKpiValue(o.target, o.kpi_unit, o.currency)}</dd>
            <dt className="text-muted-foreground">Actual</dt>
            <dd>{perf.formatKpiValue(o.actual, o.kpi_unit, o.currency)}</dd>
            <dt className="text-muted-foreground">Expected progress</dt>
            <dd>{perf.formatAchievement(o.expected_pct)}</dd>
            <dt className="text-muted-foreground">Achievement</dt>
            <dd>{perf.formatAchievement(o.achievement_pct)}</dd>
            <dt className="text-muted-foreground">Weighted contribution</dt>
            <dd>{o.weighted_score === null ? perf.NOT_RECORDED : `${o.weighted_score}%`}</dd>
            <dt className="text-muted-foreground">Status</dt><dd><StatusPill value={o.computed_status} /></dd>
            <dt className="text-muted-foreground">Rating</dt>
            <dd>{o.rating ? perf.RATING_LABEL[o.rating] : perf.NOT_RECORDED}</dd>
          </dl>

          <div>
            <p className="mb-2 font-medium">Recorded actuals</p>
            {actualsQ.isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : (actualsQ.data ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No verified actual has been recorded for this objective — achievement is reported as {perf.NOT_RECORDED}.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Recorded</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead>Source</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(actualsQ.data ?? []).map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>{dateText(a.created_at)}</TableCell>
                      <TableCell>{dateText(a.period_start)} → {dateText(a.period_end)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {perf.formatKpiValue(a.value, a.unit, o.currency)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {a.source_ref ?? a.source_type}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
