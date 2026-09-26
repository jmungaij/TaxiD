import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Building2, Plus, Trash2, Users } from "lucide-react";
import { toast } from "sonner";

import { StaffPageHeader } from "@/components/staff/primitives";
import { AdminOnly } from "@/components/auth/AdminOnly";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AreaField, EmptyState, FormDialog, ProvenanceTag, SelectField, StatusPill, TextField, money,
} from "@/components/staff/org/OrgForms";
import * as org from "@/lib/staff/org/api";
import { REQUIREMENT_KINDS, UNIT_TYPES, titleise } from "@/lib/staff/org/types";
import type { OrgEntity, OrgPosition, OrgUnit, PositionRequirement } from "@/lib/staff/org/types";

/**
 * Organisation Management — the authoritative internal structure of Yalla
 * Mobility: organisation profile, division/department/team hierarchy, and the
 * positions (with requirements) that people are appointed into.
 */
export default function OrgManagement() {
  const { roles } = useAuth();
  const isAdmin = roles.some((r) => ["admin", "super_admin"].includes(r));
  const qc = useQueryClient();

  const orgQ = useQuery({ queryKey: ["org", "entity"], queryFn: org.getOrganisation });
  const unitsQ = useQuery({ queryKey: ["org", "units"], queryFn: org.listUnits });
  const posQ = useQuery({ queryKey: ["org", "positions"], queryFn: org.listPositions });
  const staffQ = useQuery({ queryKey: ["org", "staff"], queryFn: org.listStaff });
  const compQ = useQuery({ queryKey: ["org", "competencies"], queryFn: org.listCompetencies });
  const reqQ = useQuery({ queryKey: ["org", "requirements"], queryFn: () => org.listRequirements() });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["org"] });
  };

  const units = unitsQ.data ?? [];
  const positions = posQ.data ?? [];
  const staff = staffQ.data ?? [];
  const tree = useMemo(() => org.buildUnitTree(units), [units]);
  const unitName = (id: string | null) => units.find((u) => u.id === id)?.name ?? "—";
  const staffName = (id: string | null) => staff.find((s) => s.id === id)?.full_name ?? "—";

  return (
    <AdminOnly roles={["admin", "super_admin", "compliance_admin", "operations_admin", "finance_admin"]}>
      <StaffPageHeader
        eyebrow="Organisation management"
        title="Yalla Mobility organisation"
        lede="One structure of record: the legal entity, its divisions, departments and teams, and every approved position people are appointed into."
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to="/staff/admin">Admin portal</Link>
          </Button>
        }
      />

      <Tabs defaultValue="structure">
        <TabsList>
          <TabsTrigger value="profile">Organisation profile</TabsTrigger>
          <TabsTrigger value="structure">Structure</TabsTrigger>
          <TabsTrigger value="positions">Positions</TabsTrigger>
        </TabsList>

        {/* ------------------------------ profile ------------------------------ */}
        <TabsContent value="profile" className="mt-6">
          {orgQ.isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <OrganisationProfile org={orgQ.data ?? null} canEdit={isAdmin} onSaved={invalidate} />
          )}
        </TabsContent>

        {/* ----------------------------- structure ----------------------------- */}
        <TabsContent value="structure" className="mt-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {units.length} unit{units.length === 1 ? "" : "s"} · divisions, departments and teams can be added,
              renamed, reorganised or deactivated without a code change.
            </p>
            {isAdmin && orgQ.data && (
              <UnitDialog orgId={orgQ.data.id} units={units} staff={staff} onSaved={invalidate} />
            )}
          </div>

          {units.length === 0 ? (
            <EmptyState
              title="No organisation units yet"
              hint={orgQ.data ? "Create the first division or department to start the hierarchy." : "Create the organisation profile first."}
            />
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Unit</TableHead>
                      <TableHead>Code</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Head</TableHead>
                      <TableHead>Cost centre</TableHead>
                      <TableHead>Budget</TableHead>
                      <TableHead>Positions</TableHead>
                      <TableHead>People</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tree.map(({ unit, depth }) => (
                      <TableRow key={unit.id}>
                        <TableCell style={{ paddingLeft: 16 + depth * 20 }}>
                          <Link to={`/staff/organisation/units/${unit.id}`} className="font-medium hover:underline">
                            {unit.name}
                          </Link>
                          {unit.mandate && (
                            <div className="max-w-md truncate text-xs text-muted-foreground">{unit.mandate}</div>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{unit.code}</TableCell>
                        <TableCell className="text-xs">{titleise(unit.unit_type)}</TableCell>
                        <TableCell className="text-xs">{staffName(unit.head_staff_id)}</TableCell>
                        <TableCell className="font-mono text-xs">{unit.cost_centre ?? "—"}</TableCell>
                        <TableCell className="text-xs">{money(unit.budget_cents, unit.currency)}</TableCell>
                        <TableCell className="text-xs">{positions.filter((p) => p.unit_id === unit.id).length}</TableCell>
                        <TableCell className="text-xs">{staff.filter((s) => s.unit_id === unit.id).length}</TableCell>
                        <TableCell><StatusPill value={unit.status} /></TableCell>
                        <TableCell className="text-right">
                          {isAdmin && orgQ.data && (
                            <div className="flex justify-end gap-2">
                              <UnitDialog
                                orgId={orgQ.data.id}
                                units={units}
                                staff={staff}
                                existing={unit}
                                onSaved={invalidate}
                              />
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={async () => {
                                  await org.setUnitStatus(unit.id, unit.status === "active" ? "inactive" : "active");
                                  toast.success(unit.status === "active" ? "Unit deactivated" : "Unit activated");
                                  invalidate();
                                }}
                              >
                                {unit.status === "active" ? "Deactivate" : "Activate"}
                              </Button>
                              {unit.status !== "archived" && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={async () => {
                                    await org.setUnitStatus(unit.id, "archived");
                                    toast.success("Unit archived");
                                    invalidate();
                                  }}
                                >
                                  Archive
                                </Button>
                              )}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ----------------------------- positions ----------------------------- */}
        <TabsContent value="positions" className="mt-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Positions carry the purpose, authority, KPIs and required capability. People are appointed into
              positions, so requirements can be compared against the person.
            </p>
            {isAdmin && units.length > 0 && (
              <PositionDialog units={units} positions={positions} onSaved={invalidate} />
            )}
          </div>

          {positions.length === 0 ? (
            <EmptyState title="No positions defined" hint="Define positions before creating staff records." />
          ) : (
            <div className="space-y-4">
              {positions.map((p) => (
                <PositionCard
                  key={p.id}
                  position={p}
                  unitName={unitName(p.unit_id)}
                  reportsTo={positions.find((x) => x.id === p.reports_to_position_id)?.title ?? null}
                  requirements={(reqQ.data ?? []).filter((r) => r.position_id === p.id)}
                  competencies={compQ.data ?? []}
                  headcount={staff.filter((s) => s.position_id === p.id).length}
                  canEdit={isAdmin}
                  units={units}
                  positions={positions}
                  onChanged={invalidate}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </AdminOnly>
  );
}

/* ------------------------------ organisation ------------------------------ */

function OrganisationProfile({
  org: entity, canEdit, onSaved,
}: { org: OrgEntity | null; canEdit: boolean; onSaved: () => void }) {
  const [form, setForm] = useState({
    legal_name: entity?.legal_name ?? "Yalla Mobility Limited",
    trading_name: entity?.trading_name ?? "Yalla Mobility",
    registration_number: entity?.registration_number ?? "",
    tax_pin: entity?.tax_pin ?? "",
    country: entity?.country ?? "KE",
    registered_address: entity?.registered_address ?? "",
    operating_address: entity?.operating_address ?? "",
    contact_email: entity?.contact_email ?? "",
    contact_phone: entity?.contact_phone ?? "",
    website: entity?.website ?? "https://yalla.africa",
    operating_markets: (entity?.operating_markets ?? ["Nairobi"]).join(", "),
    status: entity?.status ?? "active",
  });

  const save = useMutation({
    mutationFn: () =>
      org.saveOrganisation({
        ...(entity ? { id: entity.id } : {}),
        ...form,
        operating_markets: form.operating_markets.split(",").map((s) => s.trim()).filter(Boolean),
      } as never),
    onSuccess: () => {
      toast.success(entity ? "Organisation profile updated" : "Organisation created");
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Building2 className="h-4 w-4 text-primary" />
          {entity ? entity.legal_name : "Create the Yalla Mobility organisation"}
        </CardTitle>
        <div className="flex items-center gap-2">
          <ProvenanceTag provenance={entity?.provenance} />
          <StatusPill value={entity?.status} />
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <TextField label="Legal name" required value={form.legal_name} onChange={(v) => setForm({ ...form, legal_name: v })} />
        <TextField label="Trading name" value={form.trading_name} onChange={(v) => setForm({ ...form, trading_name: v })} />
        <TextField label="Registration number" value={form.registration_number} onChange={(v) => setForm({ ...form, registration_number: v })} />
        <TextField label="KRA PIN" value={form.tax_pin} onChange={(v) => setForm({ ...form, tax_pin: v })} />
        <TextField label="Registered address" value={form.registered_address} onChange={(v) => setForm({ ...form, registered_address: v })} />
        <TextField label="Operating address" value={form.operating_address} onChange={(v) => setForm({ ...form, operating_address: v })} />
        <TextField label="Contact email" type="email" value={form.contact_email} onChange={(v) => setForm({ ...form, contact_email: v })} />
        <TextField label="Contact phone" value={form.contact_phone} onChange={(v) => setForm({ ...form, contact_phone: v })} />
        <TextField label="Website" value={form.website} onChange={(v) => setForm({ ...form, website: v })} />
        <TextField
          label="Operating markets"
          value={form.operating_markets}
          onChange={(v) => setForm({ ...form, operating_markets: v })}
          hint="Comma separated, e.g. Nairobi, Mombasa, Kisumu"
        />
        <SelectField
          label="Status"
          value={form.status}
          onChange={(v) => setForm({ ...form, status: v as typeof form.status })}
          options={["active", "inactive", "archived"].map((v) => ({ value: v, label: titleise(v) }))}
        />
        <div className="sm:col-span-2 flex justify-end">
          <Button disabled={!canEdit || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : entity ? "Save organisation" : "Create organisation"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* --------------------------------- units --------------------------------- */

function UnitDialog({
  orgId, units, staff, existing, onSaved,
}: {
  orgId: string;
  units: OrgUnit[];
  staff: { id: string; full_name: string }[];
  existing?: OrgUnit;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: existing?.name ?? "",
    code: existing?.code ?? "",
    unit_type: existing?.unit_type ?? "department",
    parent_unit_id: existing?.parent_unit_id ?? "",
    mandate: existing?.mandate ?? "",
    purpose: existing?.purpose ?? "",
    cost_centre: existing?.cost_centre ?? "",
    head_staff_id: existing?.head_staff_id ?? "",
    budget: existing?.budget_cents ? String(existing.budget_cents / 100) : "",
    approval_authority: existing?.approval_authority_cents ? String(existing.approval_authority_cents / 100) : "",
  });
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!form.name.trim() || !form.code.trim()) {
      toast.error("Name and code are required");
      return;
    }
    setBusy(true);
    try {
      await org.saveUnit({
        ...(existing ? { id: existing.id } : {}),
        org_id: orgId,
        name: form.name.trim(),
        code: form.code.trim().toUpperCase(),
        unit_type: form.unit_type as OrgUnit["unit_type"],
        parent_unit_id: form.parent_unit_id || null,
        mandate: form.mandate || null,
        purpose: form.purpose || null,
        cost_centre: form.cost_centre || null,
        head_staff_id: form.head_staff_id || null,
        budget_cents: form.budget ? Math.round(Number(form.budget) * 100) : null,
        approval_authority_cents: form.approval_authority ? Math.round(Number(form.approval_authority) * 100) : null,
      });
      toast.success(existing ? "Unit updated" : "Unit created");
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormDialog
      trigger={
        existing ? (
          <Button size="sm" variant="outline">Edit</Button>
        ) : (
          <Button size="sm"><Plus className="mr-1.5 h-4 w-4" />New unit</Button>
        )
      }
      title={existing ? `Edit ${existing.name}` : "Create organisation unit"}
      description="Divisions contain departments; departments contain teams."
      onSubmit={submit}
      busy={busy}
    >
      <TextField label="Name" required value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
      <TextField label="Code" required value={form.code} onChange={(v) => setForm({ ...form, code: v })} hint="Short unique code, e.g. SALES" />
      <SelectField
        label="Type"
        value={form.unit_type}
        onChange={(v) => setForm({ ...form, unit_type: v })}
        options={UNIT_TYPES.map((v) => ({ value: v, label: titleise(v) }))}
      />
      <SelectField
        label="Parent unit"
        value={form.parent_unit_id}
        onChange={(v) => setForm({ ...form, parent_unit_id: v })}
        options={[{ value: "", label: "None (top level)" }, ...units.filter((u) => u.id !== existing?.id).map((u) => ({ value: u.id, label: `${u.name} (${titleise(u.unit_type)})` }))]}
      />
      <SelectField
        label="Department head"
        value={form.head_staff_id}
        onChange={(v) => setForm({ ...form, head_staff_id: v })}
        options={[{ value: "", label: "Unassigned" }, ...staff.map((s) => ({ value: s.id, label: s.full_name }))]}
      />
      <TextField label="Cost centre" value={form.cost_centre} onChange={(v) => setForm({ ...form, cost_centre: v })} />
      <TextField label="Budget (KES)" type="number" value={form.budget} onChange={(v) => setForm({ ...form, budget: v })} />
      <TextField label="Approval authority (KES)" type="number" value={form.approval_authority} onChange={(v) => setForm({ ...form, approval_authority: v })} />
      <div className="sm:col-span-2 grid gap-4">
        <AreaField label="Mandate" value={form.mandate} onChange={(v) => setForm({ ...form, mandate: v })} />
        <AreaField label="Purpose" value={form.purpose} onChange={(v) => setForm({ ...form, purpose: v })} rows={2} />
      </div>
    </FormDialog>
  );
}

/* ------------------------------- positions ------------------------------- */

function PositionDialog({
  units, positions, existing, onSaved,
}: { units: OrgUnit[]; positions: OrgPosition[]; existing?: OrgPosition; onSaved: () => void }) {
  const [form, setForm] = useState({
    title: existing?.title ?? "",
    code: existing?.code ?? "",
    unit_id: existing?.unit_id ?? "",
    reports_to_position_id: existing?.reports_to_position_id ?? "",
    job_purpose: existing?.job_purpose ?? "",
    responsibilities: (existing?.responsibilities ?? []).join("\n"),
    authority: (existing?.authority ?? []).join("\n"),
    kpis: (existing?.kpis as { label: string }[] | null ?? []).map((k) => k.label).join("\n"),
    grade: existing?.grade ?? "",
    approval_limit: existing?.approval_limit_cents ? String(existing.approval_limit_cents / 100) : "",
    approved_headcount: String(existing?.approved_headcount ?? 1),
  });
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!form.title.trim() || !form.code.trim() || !form.unit_id) {
      toast.error("Title, code and unit are required");
      return;
    }
    setBusy(true);
    try {
      await org.savePosition({
        ...(existing ? { id: existing.id } : {}),
        title: form.title.trim(),
        code: form.code.trim().toUpperCase(),
        unit_id: form.unit_id,
        reports_to_position_id: form.reports_to_position_id || null,
        job_purpose: form.job_purpose || null,
        responsibilities: form.responsibilities.split("\n").map((s) => s.trim()).filter(Boolean),
        authority: form.authority.split("\n").map((s) => s.trim()).filter(Boolean),
        kpis: form.kpis.split("\n").map((s) => s.trim()).filter(Boolean).map((label) => ({ label })) as never,
        grade: form.grade || null,
        approval_limit_cents: form.approval_limit ? Math.round(Number(form.approval_limit) * 100) : null,
        approved_headcount: Number(form.approved_headcount) || 1,
      });
      toast.success(existing ? "Position updated" : "Position created");
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormDialog
      trigger={existing ? <Button size="sm" variant="outline">Edit position</Button> : <Button size="sm"><Plus className="mr-1.5 h-4 w-4" />New position</Button>}
      title={existing ? `Edit ${existing.title}` : "Create position"}
      onSubmit={submit}
      busy={busy}
    >
      <TextField label="Position title" required value={form.title} onChange={(v) => setForm({ ...form, title: v })} />
      <TextField label="Position code" required value={form.code} onChange={(v) => setForm({ ...form, code: v })} />
      <SelectField
        label="Department / unit"
        value={form.unit_id}
        onChange={(v) => setForm({ ...form, unit_id: v })}
        options={units.map((u) => ({ value: u.id, label: u.name }))}
      />
      <SelectField
        label="Reports to"
        value={form.reports_to_position_id}
        onChange={(v) => setForm({ ...form, reports_to_position_id: v })}
        options={[{ value: "", label: "None" }, ...positions.filter((p) => p.id !== existing?.id).map((p) => ({ value: p.id, label: p.title }))]}
      />
      <TextField label="Grade / level" value={form.grade} onChange={(v) => setForm({ ...form, grade: v })} />
      <TextField label="Approval limit (KES)" type="number" value={form.approval_limit} onChange={(v) => setForm({ ...form, approval_limit: v })} />
      <TextField label="Approved headcount" type="number" value={form.approved_headcount} onChange={(v) => setForm({ ...form, approved_headcount: v })} />
      <div className="sm:col-span-2 grid gap-4">
        <AreaField label="Job purpose" value={form.job_purpose} onChange={(v) => setForm({ ...form, job_purpose: v })} rows={2} />
        <AreaField label="Responsibilities (one per line)" value={form.responsibilities} onChange={(v) => setForm({ ...form, responsibilities: v })} />
        <AreaField label="Authority (one per line)" value={form.authority} onChange={(v) => setForm({ ...form, authority: v })} rows={2} />
        <AreaField label="KPIs (one per line)" value={form.kpis} onChange={(v) => setForm({ ...form, kpis: v })} rows={2} />
      </div>
    </FormDialog>
  );
}

function PositionCard({
  position, unitName, reportsTo, requirements, competencies, headcount, canEdit, units, positions, onChanged,
}: {
  position: OrgPosition;
  unitName: string;
  reportsTo: string | null;
  requirements: PositionRequirement[];
  competencies: { id: string; name: string }[];
  headcount: number;
  canEdit: boolean;
  units: OrgUnit[];
  positions: OrgPosition[];
  onChanged: () => void;
}) {
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle className="text-base">{position.title}</CardTitle>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono">{position.code}</span>
            <span>· {unitName}</span>
            {reportsTo && <span>· reports to {reportsTo}</span>}
            {position.grade && <span>· grade {position.grade}</span>}
            <span className="inline-flex items-center gap-1">
              <Users className="h-3 w-3" /> {headcount}/{position.approved_headcount} filled
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill value={position.status} />
          {canEdit && <PositionDialog units={units} positions={positions} existing={position} onSaved={onChanged} />}
        </div>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3 text-sm">
          {position.job_purpose && <p className="text-muted-foreground">{position.job_purpose}</p>}
          {position.responsibilities.length > 0 && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Responsibilities</div>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
                {position.responsibilities.map((r) => <li key={r}>{r}</li>)}
              </ul>
            </div>
          )}
          {position.authority.length > 0 && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Authority</div>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
                {position.authority.map((r) => <li key={r}>{r}</li>)}
              </ul>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Required capability ({requirements.length})
            </div>
            {canEdit && <RequirementDialog positionId={position.id} competencies={competencies} onSaved={onChanged} />}
          </div>
          {requirements.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No requirements yet — gaps cannot be generated for this position until requirements exist.
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {requirements.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <div>
                    <div className="font-medium">{r.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {titleise(r.requirement_kind)}
                      {r.required_level ? ` · level ${r.required_level}` : ""}
                      {r.mandatory ? " · mandatory" : " · desirable"}
                    </div>
                  </div>
                  {canEdit && (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Remove ${r.label}`}
                      onClick={async () => {
                        await org.deleteRequirement(r.id);
                        toast.success("Requirement removed");
                        onChanged();
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function RequirementDialog({
  positionId, competencies, onSaved,
}: { positionId: string; competencies: { id: string; name: string }[]; onSaved: () => void }) {
  const [form, setForm] = useState({ kind: "competency", competency_id: "", label: "", level: "3", mandatory: "true" });
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const label = form.kind === "competency"
      ? competencies.find((c) => c.id === form.competency_id)?.name ?? form.label
      : form.label;
    if (!label.trim()) {
      toast.error("Choose a competency or enter a requirement");
      return;
    }
    setBusy(true);
    try {
      await org.saveRequirement({
        position_id: positionId,
        requirement_kind: form.kind as never,
        competency_id: form.kind === "competency" ? form.competency_id || null : null,
        label: label.trim(),
        required_level: form.kind === "competency" ? Number(form.level) : null,
        mandatory: form.mandatory === "true",
      });
      toast.success("Requirement added");
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormDialog
      trigger={<Button size="sm" variant="outline"><Plus className="mr-1 h-3.5 w-3.5" />Requirement</Button>}
      title="Add position requirement"
      description="Requirements are the only basis for a qualification or competency gap."
      onSubmit={submit}
      busy={busy}
    >
      <SelectField
        label="Requirement kind"
        value={form.kind}
        onChange={(v) => setForm({ ...form, kind: v })}
        options={REQUIREMENT_KINDS.map((v) => ({ value: v, label: titleise(v) }))}
      />
      {form.kind === "competency" ? (
        <>
          <SelectField
            label="Competency"
            value={form.competency_id}
            onChange={(v) => setForm({ ...form, competency_id: v })}
            options={competencies.map((c) => ({ value: c.id, label: c.name }))}
          />
          <TextField label="Required level" type="number" value={form.level} onChange={(v) => setForm({ ...form, level: v })} />
        </>
      ) : (
        <TextField label="Requirement" required value={form.label} onChange={(v) => setForm({ ...form, label: v })} hint="e.g. Bachelor's degree in Business" />
      )}
      <SelectField
        label="Mandatory?"
        value={form.mandatory}
        onChange={(v) => setForm({ ...form, mandatory: v })}
        options={[{ value: "true", label: "Mandatory" }, { value: "false", label: "Desirable" }]}
      />
    </FormDialog>
  );
}
