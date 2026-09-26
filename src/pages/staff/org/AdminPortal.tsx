/**
 * ADMIN PORTAL — one place to administer who is who and what they may reach.
 *
 * Roles          — the platform roles each person in the staff register holds.
 *                  Grants go through the governed database functions, so a
 *                  non-super-admin's attempt is refused and recorded, never
 *                  silently dropped.
 * Departments    — the organisation units of record, shared with the
 *                  organisation and people pages.
 * Access levels  — the role × permission matrix that governs which business
 *                  domains a role may read and change.
 * Audit          — accepted changes and refused attempts, side by side.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Building2, Check, Plus, ShieldCheck, UserCog, X } from "lucide-react";
import { toast } from "sonner";

import { StaffPageHeader } from "@/components/staff/primitives";
import { AdminOnly } from "@/components/auth/AdminOnly";
import { useAuth } from "@/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AreaField, EmptyState, FormDialog, SelectField, StatusPill, TextField,
} from "@/components/staff/org/OrgForms";
import * as org from "@/lib/staff/org/api";
import { UNIT_TYPES, titleise } from "@/lib/staff/org/types";
import type { OrgUnit } from "@/lib/staff/org/types";
import {
  ADMINISTRABLE_ROLES, ROLE_GROUPS, ROLE_LABEL, STAFF_PORTAL_GRANTING_ROLES,
  groupPermissions, humanise, listPermissionCatalog, listPermissionChanges,
  listPortalPeople, listRolePermissions, permissionMatrix, setRolePermission,
  type PortalPerson,
} from "@/lib/staff/adminPortal";
import {
  assignUserRole, describeDenial, listRoleAudit, listRoleDenials, revokeUserRole,
} from "@/lib/platform/roleManagement";

const dateText = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" }) : "—";

/* ------------------------------------------------------------------ */
/* Roles                                                               */
/* ------------------------------------------------------------------ */

function RolesTab({ canWrite }: { canWrite: boolean }) {
  const qc = useQueryClient();
  const [search, setSearch] = React.useState("");
  const [editing, setEditing] = React.useState<PortalPerson | null>(null);

  const peopleQ = useQuery({ queryKey: ["adminPortal", "people"], queryFn: listPortalPeople });
  const unitsQ = useQuery({ queryKey: ["org", "units"], queryFn: org.listUnits });

  const people = peopleQ.data ?? [];
  const unitName = (id: string | null) => unitsQ.data?.find((u) => u.id === id)?.name ?? "—";

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return people;
    return people.filter((p) =>
      [p.fullName, p.workEmail ?? "", ...p.roles].join(" ").toLowerCase().includes(q),
    );
  }, [people, search]);

  const withLogin = people.filter((p) => p.userId).length;
  const withStaffAccess = people.filter((p) => p.roles.some((r) => STAFF_PORTAL_GRANTING_ROLES.includes(r))).length;

  const mutateRole = useMutation({
    mutationFn: async (v: { userId: string; role: string; grant: boolean }) =>
      v.grant ? assignUserRole(v.userId, v.role) : revokeUserRole(v.userId, v.role),
    onSuccess: (res) => {
      if (res.ok) {
        toast.success(res.operation === "assign" ? "Role granted" : "Role withdrawn");
        void qc.invalidateQueries({ queryKey: ["adminPortal"] });
        return;
      }
      toast.error(
        res.denied ? "Only a super administrator can change roles" : "The change was not saved",
        { description: res.reason },
      );
    },
    onError: (e: Error) => toast.error("The change was not saved", { description: e.message }),
  });

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardContent className="pt-5">
          <div className="text-xs text-muted-foreground">People in the register</div>
          <div className="mt-1 text-2xl font-semibold">{peopleQ.isLoading ? "—" : people.length}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-5">
          <div className="text-xs text-muted-foreground">With a login</div>
          <div className="mt-1 text-2xl font-semibold">{peopleQ.isLoading ? "—" : withLogin}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-5">
          <div className="text-xs text-muted-foreground">With staff portal access</div>
          <div className="mt-1 text-2xl font-semibold">{peopleQ.isLoading ? "—" : withStaffAccess}</div>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
          <CardTitle className="text-base">Who holds what</CardTitle>
          <div className="flex items-center gap-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email or role"
              className="w-56"
              aria-label="Search people"
            />
            <Button variant="outline" size="sm" asChild>
              <Link to="/staff/onboarding"><Plus className="mr-1.5 h-4 w-4" /> Add employee</Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {peopleQ.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : peopleQ.isError ? (
            <EmptyState
              title="The staff register could not be read for this account"
              hint={(peopleQ.error as Error).message}
            />
          ) : filtered.length === 0 ? (
            <EmptyState title="No one matches that search" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Access held</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((p) => (
                  <TableRow key={p.staffId ?? p.fullName}>
                    <TableCell>
                      <div className="font-medium">{p.fullName}</div>
                      <div className="text-xs text-muted-foreground">
                        {p.workEmail ?? "No work email recorded"}
                        {!p.userId && " · No login yet"}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{unitName(p.unitId)}</TableCell>
                    <TableCell>
                      {p.roles.length === 0 ? (
                        <span className="text-sm text-muted-foreground">None granted</span>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {p.roles.map((r) => (
                            <Badge key={r} variant="secondary" className="font-normal">
                              {ROLE_LABEL[r] ?? humanise(r)}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!canWrite || !p.userId}
                        onClick={() => setEditing(p)}
                      >
                        <UserCog className="mr-1.5 h-4 w-4" /> Manage
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {!canWrite && (
            <p className="mt-4 text-sm text-muted-foreground">
              You can see who holds what. Only a super administrator can grant or withdraw access.
            </p>
          )}
        </CardContent>
      </Card>

      {editing && (
        <FormDialog
          open
          trigger={null}
          title={`Access for ${editing.fullName}`}
          description="Each role is granted or withdrawn immediately and written to the audit trail."
          onOpenChange={(v) => !v && setEditing(null)}
          onSubmit={() => setEditing(null)}
          submitLabel="Done"
        >
          <div className="space-y-5">
            {ROLE_GROUPS.map((group) => (
              <div key={group} className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{group}</p>
                {ADMINISTRABLE_ROLES.filter((r) => r.group === group).map((r) => {
                  const held = editing.roles.includes(r.role);
                  return (
                    <div key={r.role} className="flex items-start justify-between gap-3 rounded-md border p-2.5">
                      <div>
                        <div className="text-sm font-medium">{r.label}</div>
                        <div className="text-xs text-muted-foreground">{r.note}</div>
                      </div>
                      <Button
                        size="sm"
                        variant={held ? "outline" : "default"}
                        disabled={mutateRole.isPending}
                        onClick={async () => {
                          if (!editing.userId) return;
                          await mutateRole.mutateAsync({ userId: editing.userId, role: r.role, grant: !held });
                          setEditing((cur) =>
                            cur
                              ? {
                                  ...cur,
                                  roles: held
                                    ? cur.roles.filter((x) => x !== r.role)
                                    : [...cur.roles, r.role].sort(),
                                }
                              : cur,
                          );
                        }}
                      >
                        {held ? <><X className="mr-1.5 h-3.5 w-3.5" /> Withdraw</> : <><Check className="mr-1.5 h-3.5 w-3.5" /> Grant</>}
                      </Button>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </FormDialog>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Departments                                                         */
/* ------------------------------------------------------------------ */

function DepartmentsTab({ canWrite }: { canWrite: boolean }) {
  const qc = useQueryClient();
  const [editing, setEditing] = React.useState<Partial<OrgUnit> | null>(null);

  const orgQ = useQuery({ queryKey: ["org", "entity"], queryFn: org.getOrganisation });
  const unitsQ = useQuery({ queryKey: ["org", "units"], queryFn: org.listUnits });
  const staffQ = useQuery({ queryKey: ["org", "staff"], queryFn: org.listStaff });

  const units = unitsQ.data ?? [];
  const staff = staffQ.data ?? [];
  const invalidate = () => qc.invalidateQueries({ queryKey: ["org"] });

  const save = useMutation({
    mutationFn: (u: Partial<OrgUnit>) => org.saveUnit({ ...u, org_id: u.org_id ?? orgQ.data?.id }),
    onSuccess: () => { toast.success("Department saved"); setEditing(null); invalidate(); },
    onError: (e: Error) => toast.error("Not saved", { description: e.message }),
  });

  const setStatus = useMutation({
    mutationFn: (v: { id: string; status: string }) => org.setUnitStatus(v.id, v.status),
    onSuccess: () => { toast.success("Status updated"); invalidate(); },
    onError: (e: Error) => toast.error("Not updated", { description: e.message }),
  });

  const headcount = (unitId: string) => staff.filter((s) => s.unit_id === unitId).length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
        <div>
          <CardTitle className="text-base">Departments and teams</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            The same structure the organisation and people pages use. Headcount is counted from the register.
          </p>
        </div>
        {canWrite && (
          <Button size="sm" onClick={() => setEditing({ unit_type: "department", status: "active" })}>
            <Plus className="mr-1.5 h-4 w-4" /> New department
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {unitsQ.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : units.length === 0 ? (
          <EmptyState title="No departments recorded yet" hint="Create the first one to appoint people into it." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Department</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Head</TableHead>
                <TableHead className="text-right">People</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-32" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {units.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <div className="font-medium">{u.name}</div>
                    <div className="text-xs text-muted-foreground">{u.code ?? "No code"}</div>
                  </TableCell>
                  <TableCell className="text-sm">{titleise(u.unit_type)}</TableCell>
                  <TableCell className="text-sm">
                    {staff.find((s) => s.id === u.head_staff_id)?.full_name ?? "Not appointed"}
                  </TableCell>
                  <TableCell className="text-right text-sm">{headcount(u.id)}</TableCell>
                  <TableCell><StatusPill value={u.status} /></TableCell>
                  <TableCell className="text-right">
                    {canWrite && (
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setEditing(u)}>Edit</Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setStatus.mutate({ id: u.id, status: u.status === "active" ? "inactive" : "active" })}
                        >
                          {u.status === "active" ? "Deactivate" : "Reactivate"}
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {editing && (
        <FormDialog
          open
          trigger={null}
          title={editing.id ? "Edit department" : "New department"}
          onOpenChange={(v) => !v && setEditing(null)}
          onSubmit={() => save.mutate(editing)}
          submitLabel={save.isPending ? "Saving…" : "Save"}
        >
          <TextField
            label="Name"
            value={editing.name ?? ""}
            onChange={(v) => setEditing({ ...editing, name: v })}
            required
          />
          <TextField
            label="Short code"
            value={editing.code ?? ""}
            onChange={(v) => setEditing({ ...editing, code: v })}
          />
          <SelectField
            label="Type"
            value={editing.unit_type ?? "department"}
            onChange={(v) => setEditing({ ...editing, unit_type: v })}
            options={UNIT_TYPES.map((t) => ({ value: t, label: titleise(t) }))}
          />
          <SelectField
            label="Reports into"
            value={editing.parent_unit_id ?? ""}
            onChange={(v) => setEditing({ ...editing, parent_unit_id: v || null })}
            options={[{ value: "", label: "Top level" }, ...units.filter((u) => u.id !== editing.id).map((u) => ({ value: u.id, label: u.name }))]}
          />
          <SelectField
            label="Head of department"
            value={editing.head_staff_id ?? ""}
            onChange={(v) => setEditing({ ...editing, head_staff_id: v || null })}
            options={[{ value: "", label: "Not appointed" }, ...staff.map((s) => ({ value: s.id, label: s.full_name }))]}
          />
          <AreaField
            label="Mandate"
            value={editing.mandate ?? ""}
            onChange={(v) => setEditing({ ...editing, mandate: v })}
          />
        </FormDialog>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Access levels                                                       */
/* ------------------------------------------------------------------ */

/** Roles that carry internal permissions — the matrix stays readable. */
const MATRIX_ROLES = STAFF_PORTAL_GRANTING_ROLES;

function AccessLevelsTab({ canWrite }: { canWrite: boolean }) {
  const qc = useQueryClient();
  const permsQ = useQuery({ queryKey: ["adminPortal", "permissions"], queryFn: listPermissionCatalog });
  const grantsQ = useQuery({ queryKey: ["adminPortal", "rolePermissions"], queryFn: listRolePermissions });

  const held = React.useMemo(() => permissionMatrix(grantsQ.data ?? []), [grantsQ.data]);
  const groups = React.useMemo(() => groupPermissions(permsQ.data ?? []), [permsQ.data]);

  const toggle = useMutation({
    mutationFn: (v: { role: string; key: string; allowed: boolean }) =>
      setRolePermission(v.role, v.key, v.allowed),
    onSuccess: (res) => {
      if (res.ok) {
        toast.success("Access level updated");
        void qc.invalidateQueries({ queryKey: ["adminPortal"] });
        return;
      }
      toast.error(
        res.denied ? "Only a super administrator can change access levels" : "The change was not saved",
        { description: res.reason },
      );
    },
  });

  if (permsQ.isLoading || grantsQ.isLoading) return <Skeleton className="h-64 w-full" />;
  if (permsQ.isError) {
    return <EmptyState title="Access levels could not be read for this account" hint={(permsQ.error as Error).message} />;
  }
  if (groups.length === 0) return <EmptyState title="No access levels are defined yet" />;

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-5 text-sm text-muted-foreground">
          Each tick lets a role reach one business domain. Removing a tick withdraws it everywhere at once — the
          database refuses anything a role no longer carries, so no page can show data it may not read.
          {!canWrite && " You are viewing this matrix; only a super administrator can change it."}
        </CardContent>
      </Card>

      {groups.map(([domain, defs]) => (
        <Card key={domain}>
          <CardHeader className="pb-2"><CardTitle className="text-base">{humanise(domain)}</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-56">What it allows</TableHead>
                  {MATRIX_ROLES.map((r) => (
                    <TableHead key={r} className="text-center text-[11px] leading-tight">
                      {ROLE_LABEL[r] ?? humanise(r)}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {defs.map((d) => (
                  <TableRow key={d.key}>
                    <TableCell>
                      <div className="text-sm font-medium">{humanise(d.action)}</div>
                      <div className="text-xs text-muted-foreground">{d.description ?? d.key}</div>
                    </TableCell>
                    {MATRIX_ROLES.map((r) => {
                      const on = held.has(`${r}::${d.key}`);
                      return (
                        <TableCell key={r} className="text-center">
                          <Checkbox
                            checked={on}
                            disabled={!canWrite || toggle.isPending}
                            aria-label={`${ROLE_LABEL[r] ?? r} — ${d.key}`}
                            onCheckedChange={(v) =>
                              toggle.mutate({ role: r, key: d.key, allowed: v === true })
                            }
                          />
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Audit                                                               */
/* ------------------------------------------------------------------ */

function AuditTab() {
  const auditQ = useQuery({ queryKey: ["adminPortal", "roleAudit"], queryFn: () => listRoleAudit(50) });
  const denialsQ = useQuery({ queryKey: ["adminPortal", "roleDenials"], queryFn: () => listRoleDenials(50) });
  const changesQ = useQuery({ queryKey: ["adminPortal", "permChanges"], queryFn: () => listPermissionChanges(50) });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Access changes accepted</CardTitle></CardHeader>
        <CardContent>
          {auditQ.isLoading ? <Skeleton className="h-24 w-full" /> : (auditQ.data ?? []).length === 0 ? (
            <EmptyState title="No role changes recorded yet" />
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>When</TableHead><TableHead>Who changed it</TableHead><TableHead>Change</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {(auditQ.data ?? []).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-sm">{dateText(r.created_at)}</TableCell>
                    <TableCell className="text-sm">{r.actor_email ?? r.actor_id ?? "—"}</TableCell>
                    <TableCell className="text-sm">
                      {r.action.replace("user_roles.", "")} · {String((r.metadata as Record<string, unknown>)?.role ?? "")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Attempts refused</CardTitle></CardHeader>
        <CardContent>
          {denialsQ.isLoading ? <Skeleton className="h-24 w-full" /> : (denialsQ.data ?? []).length === 0 ? (
            <EmptyState title="No refused attempts recorded" />
          ) : (
            <ul className="space-y-2 text-sm">
              {(denialsQ.data ?? []).map((d) => (
                <li key={d.id} className="rounded-md border border-destructive/30 bg-destructive/5 p-2.5">
                  <div>{describeDenial(d)}</div>
                  <div className="text-xs text-muted-foreground">{dateText(d.created_at)}</div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Access level changes</CardTitle></CardHeader>
        <CardContent>
          {changesQ.isLoading ? <Skeleton className="h-24 w-full" /> : (changesQ.data ?? []).length === 0 ? (
            <EmptyState title="No access level changes recorded" />
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>When</TableHead><TableHead>Change</TableHead><TableHead>Reason recorded</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {(changesQ.data ?? []).map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="text-sm">{dateText(c.created_at)}</TableCell>
                    <TableCell className="text-sm">{c.action} · {c.capability_key}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{c.reason ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export default function AdminPortal() {
  const { roles } = useAuth();
  const canWriteRoles = roles.includes("super_admin");

  return (
    <AdminOnly roles={["admin", "super_admin"]}>
      <StaffPageHeader
        eyebrow="Administration"
        title="Admin portal"
        lede="Roles, departments and access levels in one place, wired to the same organisation and people records used everywhere else."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/staff/org"><Building2 className="mr-1.5 h-4 w-4" /> Organisation</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to="/staff/org/people"><ShieldCheck className="mr-1.5 h-4 w-4" /> People</Link>
            </Button>
          </div>
        }
      />

      <Tabs defaultValue="roles">
        <TabsList>
          <TabsTrigger value="roles">Roles</TabsTrigger>
          <TabsTrigger value="departments">Departments</TabsTrigger>
          <TabsTrigger value="access">Access levels</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
        </TabsList>
        <TabsContent value="roles" className="mt-6"><RolesTab canWrite={canWriteRoles} /></TabsContent>
        <TabsContent value="departments" className="mt-6"><DepartmentsTab canWrite /></TabsContent>
        <TabsContent value="access" className="mt-6"><AccessLevelsTab canWrite={canWriteRoles} /></TabsContent>
        <TabsContent value="audit" className="mt-6"><AuditTab /></TabsContent>
      </Tabs>
    </AdminOnly>
  );
}
