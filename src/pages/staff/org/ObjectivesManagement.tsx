import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Target } from "lucide-react";
import { toast } from "sonner";

import { StaffPageHeader } from "@/components/staff/primitives";
import { AdminOnly } from "@/components/auth/AdminOnly";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AreaField, EmptyState, FormDialog, SelectField, StatusPill, TextField, dateText,
} from "@/components/staff/org/OrgForms";
import * as org from "@/lib/staff/org/api";
import {
  OBJECTIVE_LEVELS, OBJECTIVE_KPI_UNITS, OBJECTIVE_KPI_UNIT_LABEL, titleise,
} from "@/lib/staff/org/types";
import type { OrgObjective, OrgUnit, StaffMember } from "@/lib/staff/org/types";

/**
 * Objectives — departmental outcomes and their cascade to the employees who
 * actually carry the work. Cascade preserves the parent chain so a department
 * result can always be traced to the individual contributions beneath it.
 */
export default function ObjectivesManagement() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["org"] });

  const orgQ = useQuery({ queryKey: ["org", "entity"], queryFn: org.getOrganisation });
  const unitsQ = useQuery({ queryKey: ["org", "units"], queryFn: org.listUnits });
  const staffQ = useQuery({ queryKey: ["org", "staff"], queryFn: org.listStaff });
  const objQ = useQuery({ queryKey: ["org", "objectives", "all"], queryFn: () => org.listObjectives() });

  const units = unitsQ.data ?? [];
  const staff = staffQ.data ?? [];
  const objectives = objQ.data ?? [];

  const children = useMemo(() => {
    const m = new Map<string, OrgObjective[]>();
    for (const o of objectives) {
      if (!o.parent_objective_id) continue;
      m.set(o.parent_objective_id, [...(m.get(o.parent_objective_id) ?? []), o]);
    }
    return m;
  }, [objectives]);

  const parents = objectives.filter((o) => !o.parent_objective_id);

  return (
    <AdminOnly roles={["admin", "super_admin", "compliance_admin", "operations_admin", "finance_admin", "operations_manager"]}>
      <StaffPageHeader
        eyebrow="Objectives & outcomes"
        title="Departmental objectives and cascade"
        lede="Objectives are set at company, division, department or team level and cascaded to the employees accountable for the outcome."
        actions={
          orgQ.data ? (
            <ObjectiveDialog orgId={orgQ.data.id} units={units} staff={staff} onSaved={invalidate} />
          ) : undefined
        }
      />

      {objQ.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : parents.length === 0 ? (
        <EmptyState
          title="No objectives recorded"
          hint={orgQ.data ? "Create a department objective, then cascade it to the employees who will deliver it." : "Create the organisation profile first."}
        />
      ) : (
        <div className="space-y-4">
          {parents.map((o) => (
            <Card key={o.id}>
              <CardContent className="pt-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                      {titleise(o.level)} · {units.find((u) => u.id === o.unit_id)?.name ?? "Organisation-wide"}
                    </div>
                    <div className="text-base font-semibold">{o.title}</div>
                    {o.description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{o.description}</p>}
                    <div className="mt-2 text-sm">
                      <span className="text-muted-foreground">{o.kpi_label}: </span>
                      target {o.target} {o.kpi_unit}
                      {o.actual !== null && o.actual !== undefined ? ` · actual ${o.actual}` : " · actual not recorded"}
                      {o.deadline ? ` · due ${dateText(o.deadline)}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusPill value={o.status} />
                    <ActualDialog objective={o} onSaved={invalidate} />
                    <CascadeDialog objective={o} staff={staff} units={units} onSaved={invalidate} />
                  </div>
                </div>

                {(children.get(o.id) ?? []).length > 0 && (
                  <div className="mt-4 rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Cascaded to</TableHead>
                          <TableHead>Target</TableHead>
                          <TableHead>Actual</TableHead>
                          <TableHead>Variance</TableHead>
                          <TableHead>Deadline</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Record result</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(children.get(o.id) ?? []).map((c) => {
                          const variance = org.objectiveVariance(c);
                          return (
                            <TableRow key={c.id}>
                              <TableCell className="text-sm">
                                {staff.find((s) => s.id === c.staff_id)?.full_name ?? titleise(c.level)}
                              </TableCell>
                              <TableCell className="text-sm">{c.target} {c.kpi_unit}</TableCell>
                              <TableCell className="text-sm">{c.actual ?? "—"}</TableCell>
                              <TableCell className="text-sm">{variance === null ? "—" : variance > 0 ? `+${variance}` : variance}</TableCell>
                              <TableCell className="text-sm">{dateText(c.deadline)}</TableCell>
                              <TableCell><StatusPill value={c.status} /></TableCell>
                              <TableCell className="text-right"><ActualDialog objective={c} onSaved={invalidate} /></TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </AdminOnly>
  );
}

/* -------------------------------- dialogs -------------------------------- */

function ObjectiveDialog({
  orgId, units, staff, onSaved,
}: { orgId: string; units: OrgUnit[]; staff: StaffMember[]; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    title: "", description: "", level: "department", unit_id: "", owner_staff_id: "",
    kpi_label: "", kpi_unit: "count", currency: "KES", baseline: "", target: "", period_start: "", deadline: "",
  });
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: async () => {
      if (!form.title.trim() || !form.kpi_label.trim() || !form.target) {
        throw new Error("Title, KPI and target are required — an objective without a measure cannot be assessed.");
      }
      const target = Number(form.target);
      if (form.kpi_unit === "percent" && (target <= 0 || target > 100)) {
        throw new Error("A percentage target must be greater than 0 and no more than 100.");
      }
      if (form.kpi_unit === "count" && (target <= 0 || !Number.isInteger(target))) {
        throw new Error("A count target must be a whole number greater than zero.");
      }
      if (form.kpi_unit === "currency" && !form.currency.trim()) {
        throw new Error("A currency amount needs a currency code, for example KES.");
      }
      return org.saveObjective({
        org_id: orgId,
        level: form.level,
        unit_id: form.unit_id || null,
        owner_staff_id: form.owner_staff_id || null,
        title: form.title.trim(),
        description: form.description || null,
        kpi_label: form.kpi_label.trim(),
        kpi_unit: form.kpi_unit,
        currency: form.kpi_unit === "currency" ? form.currency.trim().toUpperCase() : null,
        baseline: form.baseline ? Number(form.baseline) : null,
        target,
        period_start: form.period_start || null,
        deadline: form.deadline || null,
        status: "active",
      });
    },
    onSuccess: () => { onSaved(); toast.success("Objective created"); setOpen(false); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      busy={save.isPending}
      trigger={<Button><Target className="mr-2 h-4 w-4" />New objective</Button>}
      title="Create objective"
      description="Every objective needs a KPI and a target. Actuals are recorded from authoritative results, never estimated."
      submitLabel="Create objective"
      onSubmit={async () => { await save.mutateAsync(); }}
    >
      <TextField label="Objective" required value={form.title} onChange={set("title")} />
      <SelectField label="Level" value={form.level} onChange={set("level")} options={OBJECTIVE_LEVELS.map((l) => ({ value: l, label: titleise(l) }))} />
      <SelectField
        label="Unit"
        value={form.unit_id}
        onChange={set("unit_id")}
        options={units.filter((u) => u.status === "active").map((u) => ({ value: u.id, label: `${u.name} (${titleise(u.unit_type)})` }))}
      />
      <SelectField label="Owner" value={form.owner_staff_id} onChange={set("owner_staff_id")} options={staff.map((s) => ({ value: s.id, label: s.full_name }))} />
      <TextField label="KPI" required value={form.kpi_label} onChange={set("kpi_label")} placeholder="Corporate accounts activated" />
      <SelectField
        label="KPI unit"
        value={form.kpi_unit}
        onChange={set("kpi_unit")}
        options={OBJECTIVE_KPI_UNITS.map((u) => ({ value: u, label: OBJECTIVE_KPI_UNIT_LABEL[u] }))}
        hint="Only these measures are accepted, so the target stays comparable across the organisation."
      />
      {form.kpi_unit === "currency" && (
        <TextField label="Currency" required value={form.currency} onChange={set("currency")} placeholder="KES" />
      )}

      <TextField label="Baseline" type="number" value={form.baseline} onChange={set("baseline")} />
      <TextField label="Target" type="number" required value={form.target} onChange={set("target")} />
      <TextField label="Period start" type="date" value={form.period_start} onChange={set("period_start")} />
      <TextField label="Deadline" type="date" value={form.deadline} onChange={set("deadline")} />
      <AreaField label="Description" value={form.description} onChange={set("description")} />
    </FormDialog>
  );
}

function CascadeDialog({
  objective, staff, units, onSaved,
}: { objective: OrgObjective; staff: StaffMember[]; units: OrgUnit[]; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [staffId, setStaffId] = useState("");
  const [target, setTarget] = useState("");
  const [deadline, setDeadline] = useState(objective.deadline ?? "");

  const eligible = objective.unit_id
    ? staff.filter((s) => s.unit_id === objective.unit_id && s.employment_status === "active")
    : staff.filter((s) => s.employment_status === "active");

  const save = useMutation({
    mutationFn: async () => {
      if (!staffId || !target) throw new Error("Choose an employee and their share of the target.");
      const member = staff.find((s) => s.id === staffId)!;
      return org.cascadeObjective(objective, {
        staffId,
        unitId: member.unit_id,
        target: Number(target),
        deadline: deadline || null,
      });
    },
    onSuccess: () => { onSaved(); toast.success("Objective cascaded to employee"); setOpen(false); setStaffId(""); setTarget(""); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      busy={save.isPending}
      trigger={<Button size="sm" variant="outline">Cascade</Button>}
      title={`Cascade “${objective.title}”`}
      description="The employee objective keeps the parent chain, so the department result stays traceable to individual contribution."
      submitLabel="Cascade"
      onSubmit={async () => { await save.mutateAsync(); }}
    >
      <SelectField
        label="Employee"
        value={staffId}
        onChange={setStaffId}
        options={eligible.map((s) => ({ value: s.id, label: `${s.full_name} (${s.staff_no})` }))}
        hint={objective.unit_id ? `Active employees in ${units.find((u) => u.id === objective.unit_id)?.name ?? "the unit"}.` : "Active employees."}
      />
      <TextField label="Employee target" type="number" required value={target} onChange={setTarget} hint={`Parent target ${objective.target} ${objective.kpi_unit}.`} />
      <TextField label="Deadline" type="date" value={deadline} onChange={setDeadline} />
    </FormDialog>
  );
}

function ActualDialog({ objective, onSaved }: { objective: OrgObjective; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [actual, setActual] = useState(objective.actual?.toString() ?? "");
  const [source, setSource] = useState("");

  const save = useMutation({
    mutationFn: async () => {
      if (actual === "" || !source.trim()) throw new Error("Record the result and the authoritative source it came from.");
      const value = Number(actual);
      return org.saveObjective({
        id: objective.id,
        actual: value,
        status: value >= Number(objective.target) ? "achieved" : "at_risk",
        evidence: { source: source.trim(), recorded_at: new Date().toISOString() },
      });
    },
    onSuccess: () => { onSaved(); toast.success("Result recorded against the objective"); setOpen(false); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      busy={save.isPending}
      trigger={<Button size="sm" variant="ghost">Record result</Button>}
      title={`Record result — ${objective.title}`}
      description="Results must cite the authoritative system they were read from; Staff 360 does not create commercial or financial truth."
      submitLabel="Save result"
      onSubmit={async () => { await save.mutateAsync(); }}
    >
      <TextField label="Actual" type="number" required value={actual} onChange={setActual} />
      <TextField label="Source of record" required value={source} onChange={setSource} placeholder="commercial_opportunities · corporate_invoices · journals" />
    </FormDialog>
  );
}
