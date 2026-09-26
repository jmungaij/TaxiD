import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { StaffPageHeader } from "@/components/staff/primitives";
import { AdminOnly } from "@/components/auth/AdminOnly";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AreaField, EmptyState, FormDialog, SelectField, StatusPill, money,
} from "@/components/staff/org/OrgForms";
import * as org from "@/lib/staff/org/api";
import { titleise } from "@/lib/staff/org/types";
import type { CorrectiveAction } from "@/lib/staff/org/types";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { downloadCsv, toCsv } from "@/lib/csv";
import {
  currentPeriod, formatMeasure, salesBaseline,
  type DrillKey, type DrillSet, type Measure, type SalesBaseline as Baseline,
} from "@/lib/staff/org/baseline";

/**
 * Sales productivity baseline for the current period. Nothing is modelled:
 * cycle time, SLA compliance, rework and objective attribution are all derived
 * from authoritative records, and any measure without a record reads
 * DATA NOT AVAILABLE rather than zero.
 */
export default function SalesBaseline() {
  const qc = useQueryClient();
  const period = useMemo(() => currentPeriod(), []);
  const [staffId, setStaffId] = useState("");
  // Which KPI the operator is drilling into, if any.
  const [drillKey, setDrillKey] = useState<DrillKey | null>(null);

  const staffQ = useQuery({ queryKey: ["org", "staff"], queryFn: org.listStaff });
  const workQ = useQuery({ queryKey: ["org", "work", "all"], queryFn: () => org.listWorkItems({ kind: "sales_opportunity" }) });
  const reviewsQ = useQuery({ queryKey: ["org", "reviews", "all"], queryFn: () => org.listWorkReviews({ limit: 400 }) });
  const correctiveQ = useQuery({ queryKey: ["org", "corrective", "all"], queryFn: () => org.listCorrectiveActions() });
  const objQ = useQuery({ queryKey: ["org", "objectives", "all"], queryFn: () => org.listObjectives() });

  const loading = workQ.isLoading || reviewsQ.isLoading || correctiveQ.isLoading || objQ.isLoading;

  const staffName = useMemo(() => new Map((staffQ.data ?? []).map((s) => [s.id, s.full_name])), [staffQ.data]);

  const baseline = useMemo(
    () => salesBaseline({
      period,
      workItems: (workQ.data ?? []).filter((w) => !staffId || w.staff_id === staffId),
      reviews: reviewsQ.data ?? [],
      corrective: (correctiveQ.data ?? []).filter((c) => !staffId || c.staff_id === staffId),
      objectives: (objQ.data ?? []).filter((o) => !staffId || o.staff_id === staffId || o.staff_id === null),
    }),
    [period, workQ.data, reviewsQ.data, correctiveQ.data, objQ.data, staffId],
  );

  const openCorrective = (correctiveQ.data ?? []).filter(
    (c) => (!staffId || c.staff_id === staffId) && (c.status === "open" || c.status === "in_progress"),
  );

  return (
    <AdminOnly roles={["admin", "super_admin", "compliance_admin", "operations_admin", "finance_admin", "operations_manager"]}>
      <StaffPageHeader
        eyebrow={`Baseline · ${period.label}`}
        title="Sales productivity baseline"
        lede="Measured from the Sales OS pipeline and the work record. This is the baseline improvement is judged against — no target is asserted until a period has been measured."
        actions={
          <div className="w-64">
            <SelectField
              label="Employee"
              value={staffId}
              onChange={setStaffId}
              options={(staffQ.data ?? []).map((s) => ({ value: s.id, label: s.full_name }))}
              placeholder="Whole sales function"
            />
          </div>
        }
      />

      {loading ? (
        <Skeleton className="h-72 w-full" />
      ) : (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {baseline.measures.map((m) => (
              <MeasureCard key={m.key} measure={m} onDrill={() => setDrillKey(m.key)} count={baseline.drill[m.key].rows.length} />
            ))}
          </div>

          <DrillDialog
            drill={drillKey ? baseline.drill[drillKey] : null}
            baseline={baseline}
            staffName={staffName}
            onClose={() => setDrillKey(null)}
          />

          <Tabs defaultValue="attribution">
            <TabsList>
              <TabsTrigger value="attribution">Objective attribution</TabsTrigger>
              <TabsTrigger value="sla">SLA & cycle detail</TabsTrigger>
              <TabsTrigger value="corrective">Corrective actions{openCorrective.length > 0 ? ` · ${openCorrective.length}` : ""}</TabsTrigger>
            </TabsList>

            <TabsContent value="attribution" className="mt-6">
              {baseline.attribution.length === 0 ? (
                <EmptyState
                  title="No objective has attributable sales work yet"
                  hint="Link work to a cascaded objective when assigning it, and record the objective result from an authoritative source."
                />
              ) : (
                <Card>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Objective</TableHead>
                          <TableHead>Level</TableHead>
                          <TableHead>Linked work</TableHead>
                          <TableHead>Completed</TableHead>
                          <TableHead>Approved on review</TableHead>
                          <TableHead>Reworked</TableHead>
                          <TableHead>Result vs target</TableHead>
                          <TableHead>Evidence</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {baseline.attribution.map((a) => (
                          <TableRow key={a.objective.id}>
                            <TableCell className="text-sm font-medium">
                              {a.objective.title}
                              <div className="text-xs text-muted-foreground">{a.objective.kpi_label}</div>
                            </TableCell>
                            <TableCell className="text-sm">{titleise(a.objective.level)}</TableCell>
                            <TableCell className="text-sm">{a.linkedWork}</TableCell>
                            <TableCell className="text-sm">{a.completedWork}</TableCell>
                            <TableCell className="text-sm">{a.approvedWork}</TableCell>
                            <TableCell className="text-sm">{a.reworkedWork}</TableCell>
                            <TableCell className="text-sm">
                              {a.actual === null
                                ? <span className="text-xs text-muted-foreground">Result not recorded</span>
                                : <>{a.actual} / {a.target} <span className={a.variance !== null && a.variance >= 0 ? "text-success" : "text-destructive"}>({a.variance !== null && a.variance >= 0 ? "+" : ""}{a.variance})</span></>}
                            </TableCell>
                            <TableCell>
                              <StatusPill value={a.evidenced ? "verified" : "pending"} />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="sla" className="mt-6 grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader><CardTitle className="text-base">SLA compliance</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <Line label="Items with an SLA committed" value={String(baseline.sla.committed)} />
                  <Line label="Met" value={String(baseline.sla.met)} />
                  <Line label="Breached" value={String(baseline.sla.breached)} />
                  <Line label="Compliance" value={baseline.sla.compliancePct === null ? "DATA NOT AVAILABLE" : `${baseline.sla.compliancePct}%`} />
                  <p className="pt-2 text-xs text-muted-foreground">
                    Source: <span className="font-mono">staff_work_items.sla_due_at</span> against the recorded completion time.
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-base">Cycle time</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <Line label="Completed items measured" value={String(baseline.cycle.sample)} />
                  <Line label="Median" value={baseline.cycle.median === null ? "DATA NOT AVAILABLE" : `${baseline.cycle.median} d`} />
                  <Line label="90th percentile" value={baseline.cycle.p90 === null ? "DATA NOT AVAILABLE" : `${baseline.cycle.p90} d`} />
                  <p className="pt-2 text-xs text-muted-foreground">
                    Measured from assignment to completion. Reopened work restarts nothing — the original assignment time is kept.
                  </p>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="corrective" className="mt-6">
              <CorrectiveTable
                rows={(correctiveQ.data ?? []).filter((c) => !staffId || c.staff_id === staffId)}
                staffName={staffName}
                onSaved={() => qc.invalidateQueries({ queryKey: ["org"] })}
              />
            </TabsContent>
          </Tabs>
        </>
      )}
    </AdminOnly>
  );
}

function MeasureCard({ measure, onDrill, count }: { measure: Measure; onDrill: () => void; count: number }) {
  const unavailable = measure.value === null;
  const drillable = count > 0;
  return (
    <Card
      className={drillable ? "cursor-pointer transition-colors hover:border-primary/50" : undefined}
      onClick={drillable ? onDrill : undefined}
      role={drillable ? "button" : undefined}
      tabIndex={drillable ? 0 : undefined}
      onKeyDown={drillable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onDrill(); } } : undefined}
      aria-label={drillable ? `${measure.label} — open the ${count} underlying work item(s)` : undefined}
    >
      <CardContent className="pt-5">
        <div className="text-xs text-muted-foreground">{measure.label}</div>
        <div className={`mt-2 font-semibold ${unavailable ? "text-xs text-muted-foreground" : "text-2xl"}`}>
          {formatMeasure(measure)}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{measure.note}</p>
        {drillable && (
          <p className="mt-2 text-xs font-medium text-primary">View {count} underlying item{count === 1 ? "" : "s"} →</p>
        )}
        <p className="mt-2 break-all font-mono text-[10px] leading-tight text-muted-foreground">{measure.source}</p>
      </CardContent>
    </Card>
  );
}

/**
 * KPI drilldown — the exact MY WORK items behind a measure, with the objective
 * each item is attributed to and the documented review / corrective history.
 */
function DrillDialog({
  drill, baseline, staffName, onClose,
}: { drill: DrillSet | null; baseline: Baseline; staffName: Map<string, string>; onClose: () => void }) {
  const objectiveOf = useMemo(() => {
    const map = new Map<string, { title: string; kpi: string; actual: number | null; target: number }>();
    for (const a of baseline.attribution) {
      map.set(a.objective.id, { title: a.objective.title, kpi: a.objective.kpi_label, actual: a.actual, target: a.target });
    }
    return map;
  }, [baseline.attribution]);

  const exportRows = () =>
    (drill?.rows ?? []).map((r) => ({
      work_item_id: r.item.id,
      title: r.item.title,
      employee: r.item.staff_id ? (staffName.get(r.item.staff_id) ?? r.item.staff_id) : "",
      status: r.item.status,
      assigned_at: r.item.assigned_at ?? "",
      completed_at: r.item.completed_at ?? "",
      sla_due_at: r.item.sla_due_at ?? "",
      quality_flag: r.item.quality_flag ?? "",
      objective: r.item.objective_id ? (objectiveOf.get(r.item.objective_id)?.title ?? r.item.objective_id) : "",
      contribution: r.contribution ?? "",
      reason: r.reason,
      reviews: r.reviews.map((v) => v.decision).join(" | "),
      corrective_causes: r.corrective.map((c) => c.cause_category).join(" | "),
      source_of_record: r.item.source_table ?? drill?.source ?? "",
    }));

  return (
    <Dialog open={!!drill} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>{drill?.label} — underlying work</DialogTitle>
          <DialogDescription>
            {drill?.rows.length ?? 0} record(s) from <span className="font-mono">{drill?.source}</span> for {baseline.period.label}.
            Objective attribution is shown as recorded, never inferred.
          </DialogDescription>
        </DialogHeader>

        <div className="flex justify-end">
          <Button
            size="sm"
            variant="outline"
            data-analytics="staff.org.sales_baseline.export_csv"
            onClick={() => {
              const rows = exportRows();
              if (rows.length === 0) { toast.error("Nothing to export"); return; }
              downloadCsv(`sales-baseline-${drill?.key}-${baseline.period.start}.csv`, toCsv(rows));
              toast.success("Drilldown exported");
            }}
          >
            Export CSV
          </Button>
        </div>

        <div className="max-h-[60vh] overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Work item</TableHead>
                <TableHead>Employee</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Contribution</TableHead>
                <TableHead>Objective attribution</TableHead>
                <TableHead>Documented history</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(drill?.rows ?? []).map((r) => {
                const obj = r.item.objective_id ? objectiveOf.get(r.item.objective_id) : undefined;
                return (
                  <TableRow key={r.item.id}>
                    <TableCell className="text-sm">
                      <div className="font-medium">{r.item.title}</div>
                      <div className="text-xs text-muted-foreground">{r.reason}</div>
                      <div className="font-mono text-[10px] text-muted-foreground">{r.item.source_table ?? drill?.source}</div>
                    </TableCell>
                    <TableCell className="text-sm">{r.item.staff_id ? (staffName.get(r.item.staff_id) ?? "—") : "—"}</TableCell>
                    <TableCell><StatusPill value={r.item.status} /></TableCell>
                    <TableCell className="text-sm">{r.contribution === null ? "—" : r.contribution}</TableCell>
                    <TableCell className="text-sm">
                      {obj ? (
                        <>
                          <div className="font-medium">{obj.title}</div>
                          <div className="text-xs text-muted-foreground">
                            {obj.kpi} · {obj.actual === null ? "result not recorded" : `${obj.actual} / ${obj.target}`}
                          </div>
                        </>
                      ) : <span className="text-xs text-muted-foreground">Not attributed to an objective</span>}
                    </TableCell>
                    <TableCell className="space-y-1">
                      {r.reviews.map((v) => <Badge key={v.id} variant="outline" className="mr-1 text-[10px]">{titleise(v.decision)}</Badge>)}
                      {r.corrective.map((c) => <Badge key={c.id} variant="secondary" className="mr-1 text-[10px]">{titleise(c.cause_category)}</Badge>)}
                      {r.reviews.length === 0 && r.corrective.length === 0 && <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const Line = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-center justify-between border-b py-1 last:border-0">
    <span className="text-muted-foreground">{label}</span>
    <span className="font-medium">{value}</span>
  </div>
);

/** Corrective-action register with resolution recording. */
export function CorrectiveTable({
  rows, staffName, onSaved,
}: { rows: CorrectiveAction[]; staffName: Map<string, string>; onSaved: () => void }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No corrective actions reported"
        hint="Employees raise these from their work queue when work is reworked or blocked; the cause, evidence and impact are recorded against the objective the work serves."
      />
    );
  }
  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Reported</TableHead>
              <TableHead>Employee</TableHead>
              <TableHead>Trigger</TableHead>
              <TableHead>Cause</TableHead>
              <TableHead>Evidence</TableHead>
              <TableHead>Impact</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                  {new Date(c.created_at).toLocaleDateString("en-KE")}
                </TableCell>
                <TableCell className="text-sm">{c.staff_id ? (staffName.get(c.staff_id) ?? "—") : "—"}</TableCell>
                <TableCell><StatusPill value={c.trigger_kind} /></TableCell>
                <TableCell className="max-w-xs text-sm">
                  <div className="font-medium">{titleise(c.cause_category)}</div>
                  <div className="text-xs text-muted-foreground">{c.cause_description}</div>
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {c.evidence_source_table ?? "—"}
                  {c.evidence_note && <div className="font-sans text-muted-foreground">{c.evidence_note}</div>}
                </TableCell>
                <TableCell className="text-sm">
                  {c.impact_days === null ? "—" : `${c.impact_days} d`}
                  {c.impact_value_cents !== null && <div className="text-xs text-muted-foreground">{money(c.impact_value_cents)}</div>}
                </TableCell>
                <TableCell><StatusPill value={c.status} /></TableCell>
                <TableCell className="text-right">
                  {c.status === "open" || c.status === "in_progress"
                    ? <ResolveDialog action={c} onSaved={onSaved} />
                    : <span className="text-xs text-muted-foreground">{c.resolution ? "Documented" : "—"}</span>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function ResolveDialog({ action, onSaved }: { action: CorrectiveAction; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"in_progress" | "resolved" | "ineffective" | "closed">("resolved");
  const [resolution, setResolution] = useState("");

  const save = useMutation({
    mutationFn: () => org.resolveCorrectiveAction(action.id, status, resolution),
    onSuccess: () => { onSaved(); toast.success("Corrective action updated"); setOpen(false); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      busy={save.isPending}
      trigger={<Button size="sm" variant="outline">Resolve</Button>}
      title="Resolve corrective action"
      description={`${titleise(action.cause_category)} — ${action.cause_description}`}
      submitLabel="Record resolution"
      onSubmit={async () => { await save.mutateAsync(); }}
    >
      <SelectField
        label="Outcome"
        value={status}
        onChange={(v) => setStatus(v as typeof status)}
        options={[
          { value: "in_progress", label: "In progress" },
          { value: "resolved", label: "Resolved — cause removed" },
          { value: "ineffective", label: "Ineffective — cause persists" },
          { value: "closed", label: "Closed without further action" },
        ]}
      />
      <AreaField
        label="What was changed"
        value={resolution}
        onChange={setResolution}
        placeholder="Pricing approval limit raised for the corporate desk, removing the two-day wait on quotes under KES 500,000."
      />
    </FormDialog>
  );
}
