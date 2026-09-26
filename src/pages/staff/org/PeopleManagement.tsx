import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Plus, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { StaffPageHeader } from "@/components/staff/primitives";
import { AdminOnly } from "@/components/auth/AdminOnly";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  EmptyState, FormDialog, SelectField, StatusPill, TextField, ProvenanceTag,
} from "@/components/staff/org/OrgForms";
import * as org from "@/lib/staff/org/api";
import { EMPLOYMENT_STATUSES, EMPLOYMENT_TYPES, titleise } from "@/lib/staff/org/types";
import type { OrgPosition, OrgUnit, StaffMember } from "@/lib/staff/org/types";

/**
 * People Management — the staff register of record. Employees are created here
 * and appointed into an approved position within the organisation hierarchy.
 * Position appointment is what activates requirement matching downstream.
 */
export default function PeopleManagement() {
  const { roles } = useAuth();
  const isAdmin = roles.some((r) => ["admin", "super_admin"].includes(r));
  const qc = useQueryClient();
  const [search, setSearch] = useState("");

  const orgQ = useQuery({ queryKey: ["org", "entity"], queryFn: org.getOrganisation });
  const unitsQ = useQuery({ queryKey: ["org", "units"], queryFn: org.listUnits });
  const posQ = useQuery({ queryKey: ["org", "positions"], queryFn: org.listPositions });
  const staffQ = useQuery({ queryKey: ["org", "staff"], queryFn: org.listStaff });

  const units = unitsQ.data ?? [];
  const positions = posQ.data ?? [];
  const staff = staffQ.data ?? [];
  const invalidate = () => qc.invalidateQueries({ queryKey: ["org"] });

  const unitName = (id: string | null) => units.find((u) => u.id === id)?.name ?? "—";
  const posTitle = (id: string | null) => positions.find((p) => p.id === id)?.title ?? "Unassigned";

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return staff;
    return staff.filter((s) =>
      [s.full_name, s.staff_no, s.work_email ?? "", posTitle(s.position_id), unitName(s.unit_id)]
        .join(" ").toLowerCase().includes(q),
    );
  }, [staff, search, positions, units]);

  const headcountByPosition = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of staff) if (s.position_id) m.set(s.position_id, (m.get(s.position_id) ?? 0) + 1);
    return m;
  }, [staff]);

  return (
    <AdminOnly roles={["admin", "super_admin", "compliance_admin", "operations_admin", "finance_admin", "operations_manager"]}>
      <StaffPageHeader
        eyebrow="People management"
        title="Staff register"
        lede="Employees of record, appointed into approved positions. Appointment drives requirement matching, objectives and work assignment."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/staff/admin">Admin portal</Link>
            </Button>
            {isAdmin && orgQ.data ? (
            <StaffDialog
              orgId={orgQ.data.id}
              units={units}
              positions={positions}
              staff={staff}
              headcount={headcountByPosition}
              onSaved={invalidate}
            />
            ) : null}
          </div>
        }
      />

      <div className="mb-4 max-w-sm">
        <Input placeholder="Search name, staff no., position or unit…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {staffQ.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : staff.length === 0 ? (
        <EmptyState
          title="No employees recorded"
          hint={orgQ.data ? "Create the first staff member and appoint them into a position." : "Create the organisation profile and structure first."}
          action={<Button asChild variant="outline"><Link to="/staff/organisation">Open organisation management</Link></Button>}
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Staff no.</TableHead>
                  <TableHead>Position</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Manager</TableHead>
                  <TableHead>Employment</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <Link to={`/staff/org/people/${s.id}`} className="font-medium hover:underline">{s.full_name}</Link>
                      <div className="text-xs text-muted-foreground">{s.work_email ?? "No work email"}</div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{s.staff_no}</TableCell>
                    <TableCell className="text-sm">{posTitle(s.position_id)}</TableCell>
                    <TableCell className="text-sm">{unitName(s.unit_id)}</TableCell>
                    <TableCell className="text-sm">
                      {staff.find((m) => m.id === s.manager_staff_id)?.full_name ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm">{titleise(s.employment_type)}</TableCell>
                    <TableCell className="space-x-2">
                      <StatusPill value={s.employment_status} />
                      <ProvenanceTag provenance={s.provenance} />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {isAdmin && orgQ.data && (
                          <StaffDialog
                            orgId={orgQ.data.id}
                            units={units}
                            positions={positions}
                            staff={staff}
                            headcount={headcountByPosition}
                            existing={s}
                            onSaved={invalidate}
                          />
                        )}
                        <Button asChild size="sm" variant="ghost">
                          <Link to={`/staff/org/people/${s.id}`}>Open file</Link>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </AdminOnly>
  );
}

/* ------------------------------ create / edit ----------------------------- */

function StaffDialog({
  orgId, units, positions, staff, headcount, existing, onSaved,
}: {
  orgId: string;
  units: OrgUnit[];
  positions: OrgPosition[];
  staff: StaffMember[];
  headcount: Map<string, number>;
  existing?: StaffMember;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    full_name: existing?.full_name ?? "",
    staff_no: existing?.staff_no ?? "",
    work_email: existing?.work_email ?? "",
    phone: existing?.phone ?? "",
    unit_id: existing?.unit_id ?? "",
    position_id: existing?.position_id ?? "",
    manager_staff_id: existing?.manager_staff_id ?? "",
    employment_type: existing?.employment_type ?? "permanent",
    employment_status: existing?.employment_status ?? "onboarding",
    start_date: existing?.start_date ?? "",
    location: existing?.location ?? "",
  });
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const positionOptions = positions
    .filter((p) => p.status === "active" && (!form.unit_id || p.unit_id === form.unit_id))
    .map((p) => {
      const filled = headcount.get(p.id) ?? 0;
      const full = filled >= p.approved_headcount && existing?.position_id !== p.id;
      return {
        value: p.id,
        label: `${p.title} — ${filled}/${p.approved_headcount} filled${full ? " (over establishment)" : ""}`,
      };
    });

  const save = useMutation({
    mutationFn: async () => {
      if (!form.full_name.trim() || !form.staff_no.trim()) throw new Error("Full name and staff number are required.");
      return org.saveStaff({
        id: existing?.id,
        org_id: orgId,
        full_name: form.full_name.trim(),
        staff_no: form.staff_no.trim(),
        work_email: form.work_email || null,
        phone: form.phone || null,
        unit_id: form.unit_id || null,
        position_id: form.position_id || null,
        manager_staff_id: form.manager_staff_id || null,
        employment_type: form.employment_type,
        employment_status: form.employment_status,
        start_date: form.start_date || null,
        location: form.location || null,
      });
    },
    onSuccess: async (row: StaffMember) => {
      onSaved();
      toast.success(existing ? "Employee record updated" : "Employee created");
      if (row.position_id) {
        try {
          const { gaps } = await org.recomputeGaps(row.id);
          if (gaps.filter((g) => g.status !== "closed").length > 0) {
            toast.message("Requirement comparison run", {
              description: `${gaps.filter((g) => g.status !== "closed").length} open requirement gap(s) recorded on the employee file.`,
            });
          }
          onSaved();
        } catch {
          /* position may have no requirements yet — nothing to compare */
        }
      }
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      busy={save.isPending}
      trigger={
        existing ? (
          <Button size="sm" variant="outline">Edit</Button>
        ) : (
          <Button><UserPlus className="mr-2 h-4 w-4" />New employee</Button>
        )
      }
      title={existing ? `Edit ${existing.full_name}` : "Create employee"}
      description="The staff register is the human system of record. Payroll, finance and commercial truth stay in their own systems."
      submitLabel={existing ? "Save changes" : "Create employee"}
      onSubmit={async () => { await save.mutateAsync(); }}
    >
      <TextField label="Full name" required value={form.full_name} onChange={set("full_name")} />
      <TextField label="Staff number" required value={form.staff_no} onChange={set("staff_no")} placeholder="YM-0001" />
      <TextField label="Work email" type="email" value={form.work_email} onChange={set("work_email")} />
      <TextField label="Phone" value={form.phone} onChange={set("phone")} placeholder="+2547…" />
      <SelectField
        label="Organisation unit"
        value={form.unit_id}
        onChange={(v) => setForm((f) => ({ ...f, unit_id: v, position_id: "" }))}
        options={units.filter((u) => u.status === "active").map((u) => ({ value: u.id, label: `${u.name} (${titleise(u.unit_type)})` }))}
        hint="Selecting a unit filters the positions available for appointment."
      />
      <SelectField
        label="Position"
        value={form.position_id}
        onChange={set("position_id")}
        options={positionOptions}
        hint="Appointment activates the position's qualification and competency requirements."
      />
      <SelectField
        label="Reports to"
        value={form.manager_staff_id}
        onChange={set("manager_staff_id")}
        options={staff.filter((s) => s.id !== existing?.id).map((s) => ({ value: s.id, label: s.full_name }))}
      />
      <SelectField
        label="Employment type"
        value={form.employment_type}
        onChange={set("employment_type")}
        options={EMPLOYMENT_TYPES.map((t) => ({ value: t, label: titleise(t) }))}
      />
      <SelectField
        label="Employment status"
        value={form.employment_status}
        onChange={set("employment_status")}
        options={EMPLOYMENT_STATUSES.map((t) => ({ value: t, label: titleise(t) }))}
      />
      <TextField label="Start date" type="date" value={form.start_date} onChange={set("start_date")} />
      <TextField label="Location" value={form.location} onChange={set("location")} placeholder="Nairobi" />
    </FormDialog>
  );
}

export { StaffDialog };
export const NewStaffButtonIcon = Plus;
