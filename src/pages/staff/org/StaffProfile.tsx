import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, FileUp, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { StaffPageHeader } from "@/components/staff/primitives";
import { AdminOnly } from "@/components/auth/AdminOnly";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  AreaField, EmptyState, Field, FormDialog, SelectField, StatusPill, TextField, dateText,
} from "@/components/staff/org/OrgForms";
import * as org from "@/lib/staff/org/api";
import { useAuth } from "@/hooks/useAuth";
 
import { supabase } from "@/integrations/supabase/client";
import {
  DOCUMENT_TYPES, QUALIFICATION_KINDS, TRAINING_LIFECYCLE, titleise,
} from "@/lib/staff/org/types";
import type { StaffGap } from "@/lib/staff/org/types";

/**
 * Employee file — qualifications, documents, requirement gaps and the training
 * needs derived from them. Every gap shown here is evidenced against the
 * requirements of the position the employee is appointed into.
 */
export default function StaffProfile() {
  const { staffId = "" } = useParams();
  const { roles } = useAuth();
  const qc = useQueryClient();

  // Admins see every record; a line manager sees the people who report to them
  // (resolved server-side from the reporting line, never from client input).
  const isStaffAdmin = roles.some((r) =>
    ["admin", "super_admin", "compliance_admin", "operations_admin", "finance_admin", "operations_manager"].includes(r));
  const managesQ = useQuery({
    queryKey: ["org", "manages", staffId],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("manages_staff_record", { _staff_id: staffId });
      if (error) throw new Error(error.message);
      return !!data;
    },
    enabled: !!staffId && !isStaffAdmin,
  });
  const allowed = isStaffAdmin || managesQ.data === true;
  const invalidate = () => qc.invalidateQueries({ queryKey: ["org"] });

  const staffQ = useQuery({ queryKey: ["org", "staff", staffId], queryFn: () => org.getStaff(staffId), enabled: !!staffId });
  const unitsQ = useQuery({ queryKey: ["org", "units"], queryFn: org.listUnits });
  const posQ = useQuery({ queryKey: ["org", "positions"], queryFn: org.listPositions });
  const compQ = useQuery({ queryKey: ["org", "competencies"], queryFn: org.listCompetencies });
  const docsQ = useQuery({ queryKey: ["org", "documents", staffId], queryFn: () => org.listStaffDocuments(staffId), enabled: !!staffId });
  const qualQ = useQuery({ queryKey: ["org", "qualifications", staffId], queryFn: () => org.listQualifications(staffId), enabled: !!staffId });
  const staffCompQ = useQuery({ queryKey: ["org", "staffCompetencies", staffId], queryFn: () => org.listStaffCompetencies(staffId), enabled: !!staffId });
  const gapsQ = useQuery({ queryKey: ["org", "gaps", staffId], queryFn: () => org.listGaps(staffId), enabled: !!staffId });
  const trainQ = useQuery({ queryKey: ["org", "training", staffId], queryFn: () => org.listTrainingNeeds(staffId), enabled: !!staffId });
  const objQ = useQuery({ queryKey: ["org", "objectives", "staff", staffId], queryFn: () => org.listObjectives({ staffId }), enabled: !!staffId });

  const staff = staffQ.data ?? null;
  const position = posQ.data?.find((p) => p.id === staff?.position_id) ?? null;
  const reqQ = useQuery({
    queryKey: ["org", "requirements", position?.id],
    queryFn: () => org.listRequirements(position!.id),
    enabled: !!position,
  });

  const recompute = useMutation({
    mutationFn: () => org.recomputeGaps(staffId),
    onSuccess: ({ gaps, closed }) => {
      invalidate();
      const open = gaps.filter((g) => g.status !== "closed").length;
      toast.success(`Comparison complete — ${open} open gap(s), ${closed} closed`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const raiseTraining = useMutation({
    mutationFn: (gap: StaffGap) => org.createTrainingNeedFromGap(gap),
    onSuccess: () => { invalidate(); toast.success("Training need raised from the evidenced gap"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const openGaps = (gapsQ.data ?? []).filter((g) => g.status !== "closed");

  if (staffQ.isLoading) return <Skeleton className="h-72 w-full" />;
  if (!staff) {
    return (
      <EmptyState
        title="Employee not found"
        hint="The record may have been removed, or your access scope does not include it."
        action={<Button asChild variant="outline"><Link to="/staff/org/people">Back to staff register</Link></Button>}
      />
    );
  }

  if (!isStaffAdmin && managesQ.isLoading) return <Skeleton className="h-72 w-full" />;
  if (!allowed) {
    return (
      <AdminOnly roles={["admin", "super_admin", "compliance_admin", "operations_admin", "finance_admin", "operations_manager"]}>
        {null}
      </AdminOnly>
    );
  }

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-4">
        <Link to="/staff/org/people"><ArrowLeft className="mr-2 h-4 w-4" />Staff register</Link>
      </Button>

      <StaffPageHeader
        eyebrow={position ? position.title : "No position assigned"}
        title={staff.full_name}
        lede={`${staff.staff_no} · ${unitsQ.data?.find((u) => u.id === staff.unit_id)?.name ?? "No unit"} · ${titleise(staff.employment_type)}`}
        actions={
          <Button onClick={() => recompute.mutate()} disabled={recompute.isPending || !staff.position_id}>
            <RefreshCw className="mr-2 h-4 w-4" />
            {recompute.isPending ? "Comparing…" : "Compare against position requirements"}
          </Button>
        }
      />

      <Tabs defaultValue="gaps">
        <TabsList>
          <TabsTrigger value="gaps">Requirements & gaps {openGaps.length > 0 && <Badge variant="outline" className="ml-2">{openGaps.length}</Badge>}</TabsTrigger>
          <TabsTrigger value="qualifications">Qualifications</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="training">Training</TabsTrigger>
          <TabsTrigger value="objectives">Objectives</TabsTrigger>
        </TabsList>

        {/* ------------------------------ gaps ------------------------------ */}
        <TabsContent value="gaps" className="mt-6 space-y-4">
          {!position ? (
            <EmptyState
              title="No position assigned"
              hint="Appoint this employee into a position before comparing qualifications against requirements."
            />
          ) : (
            <>
              <Card>
                <CardHeader><CardTitle className="text-base">Position requirements — {position.title}</CardTitle></CardHeader>
                <CardContent className="p-0">
                  {(reqQ.data ?? []).length === 0 ? (
                    <p className="p-6 text-sm text-muted-foreground">
                      This position declares no requirements. No requirement, no gap — add requirements in Organisation management.
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Requirement</TableHead>
                          <TableHead>Kind</TableHead>
                          <TableHead>Required level</TableHead>
                          <TableHead>Mandatory</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(reqQ.data ?? []).map((r) => (
                          <TableRow key={r.id}>
                            <TableCell className="text-sm">{r.label}</TableCell>
                            <TableCell className="text-sm">{titleise(r.requirement_kind)}</TableCell>
                            <TableCell className="text-sm">{r.required_level ?? "—"}</TableCell>
                            <TableCell className="text-sm">{r.mandatory ? "Yes" : "No"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-base">Evidenced gaps</CardTitle></CardHeader>
                <CardContent className="p-0">
                  {(gapsQ.data ?? []).length === 0 ? (
                    <p className="p-6 text-sm text-muted-foreground">
                      No comparison recorded yet. Run the comparison to derive gaps from recorded qualifications and assessed competencies.
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Gap</TableHead>
                          <TableHead>Kind</TableHead>
                          <TableHead>Required / current</TableHead>
                          <TableHead>Severity</TableHead>
                          <TableHead>Evidence</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(gapsQ.data ?? []).map((g) => {
                          const ev = (g.evidence ?? {}) as Record<string, unknown>;
                          return (
                            <TableRow key={g.id}>
                              <TableCell className="text-sm font-medium">{g.label}</TableCell>
                              <TableCell className="text-sm">{titleise(g.gap_kind)}</TableCell>
                              <TableCell className="text-sm">{g.required_level ?? "—"} / {g.current_level ?? "none"}</TableCell>
                              <TableCell><StatusPill value={g.severity} /></TableCell>
                              <TableCell className="max-w-xs text-xs text-muted-foreground">
                                {titleise(String(ev.reason ?? ""))}
                                {ev.matched_record ? <div className="font-mono">{String(ev.matched_record)}</div> : null}
                              </TableCell>
                              <TableCell><StatusPill value={g.status} /></TableCell>
                              <TableCell className="text-right">
                                {g.status === "open" ? (
                                  <Button size="sm" variant="outline" disabled={raiseTraining.isPending} onClick={() => raiseTraining.mutate(g)}>
                                    Raise training need
                                  </Button>
                                ) : (
                                  <span className="text-xs text-muted-foreground">—</span>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-base">Assessed competencies</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <CompetencyForm
                    staffId={staff.id}
                    competencies={compQ.data ?? []}
                    onSaved={invalidate}
                  />
                  {(staffCompQ.data ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground">No assessed competencies recorded. Absence of a record is never treated as competence.</p>
                  ) : (
                    <ul className="space-y-1 text-sm">
                      {(staffCompQ.data ?? []).map((c) => (
                        <li key={c.id} className="flex justify-between rounded border px-3 py-2">
                          <span>{compQ.data?.find((x) => x.id === c.competency_id)?.name ?? c.competency_id}</span>
                          <span className="text-muted-foreground">Level {c.assessed_level}{c.assessed_at ? ` · ${dateText(c.assessed_at)}` : ""}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* -------------------------- qualifications -------------------------- */}
        <TabsContent value="qualifications" className="mt-6 space-y-4">
          <div className="flex justify-end">
            <QualificationDialog staffId={staff.id} documents={docsQ.data ?? []} onSaved={invalidate} />
          </div>
          {(qualQ.data ?? []).length === 0 ? (
            <EmptyState title="No qualifications recorded" hint="Add academic, professional, certification or licence records; each may be linked to an uploaded document." />
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Qualification</TableHead>
                      <TableHead>Kind</TableHead>
                      <TableHead>Institution</TableHead>
                      <TableHead>Awarded</TableHead>
                      <TableHead>Expires</TableHead>
                      <TableHead>Verification</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(qualQ.data ?? []).map((q) => (
                      <TableRow key={q.id}>
                        <TableCell className="text-sm font-medium">{q.title}</TableCell>
                        <TableCell className="text-sm">{titleise(q.qualification_kind)}</TableCell>
                        <TableCell className="text-sm">{q.institution ?? "—"}</TableCell>
                        <TableCell className="text-sm">{dateText(q.awarded_on)}</TableCell>
                        <TableCell className="text-sm">{dateText(q.expires_on)}</TableCell>
                        <TableCell><StatusPill value={q.verification_status} /></TableCell>
                        <TableCell className="text-right">
                          {q.verification_status !== "verified" && (
                            <VerifyQualification id={q.id} onSaved={invalidate} />
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

        {/* ----------------------------- documents ----------------------------- */}
        <TabsContent value="documents" className="mt-6 space-y-4">
          <div className="flex justify-end">
            <DocumentUpload staffId={staff.id} onSaved={invalidate} />
          </div>
          {(docsQ.data ?? []).length === 0 ? (
            <EmptyState title="No documents on file" hint="Uploads are stored in the private staff-documents store and only reachable through short-lived signed links." />
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Document</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Version</TableHead>
                      <TableHead>Expiry</TableHead>
                      <TableHead>Verification</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(docsQ.data ?? []).map((d) => (
                      <TableRow key={d.id}>
                        <TableCell className="text-sm font-medium">
                          {d.title}
                          <div className="text-xs text-muted-foreground">{d.file_name}</div>
                        </TableCell>
                        <TableCell className="text-sm">{titleise(d.doc_type)}</TableCell>
                        <TableCell className="text-sm">v{d.version}</TableCell>
                        <TableCell className="text-sm">{dateText(d.expiry_date)}</TableCell>
                        <TableCell><StatusPill value={d.verification_status} /></TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={async () => {
                              const url = await org.documentUrl(d.storage_path);
                              if (url) window.open(url, "_blank", "noopener");
                              else toast.error("Could not create a signed link for this document.");
                            }}
                          >
                            View
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ------------------------------ training ------------------------------ */}
        <TabsContent value="training" className="mt-6">
          {(trainQ.data ?? []).length === 0 ? (
            <EmptyState title="No training needs" hint="Training needs are raised from evidenced requirement gaps, not from opinion." />
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Need</TableHead>
                      <TableHead>Origin</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Assessment</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(trainQ.data ?? []).map((t) => (
                      <TableRow key={t.id}>
                        <TableCell className="text-sm font-medium">
                          {t.title}
                          {t.description && <div className="max-w-md text-xs text-muted-foreground">{t.description}</div>}
                        </TableCell>
                        <TableCell className="text-sm">{titleise(t.origin)}</TableCell>
                        <TableCell><StatusPill value={t.priority} /></TableCell>
                        <TableCell><StatusPill value={t.status} /></TableCell>
                        <TableCell className="text-sm">
                          {t.assessment_score === null || t.assessment_score === undefined
                            ? "Not assessed"
                            : `${t.assessment_score}% · ${t.assessment_passed ? "passed" : "failed"}`}
                        </TableCell>
                        <TableCell className="text-right">
                          <TrainingProgress need={t} onSaved={invalidate} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ----------------------------- objectives ----------------------------- */}
        <TabsContent value="objectives" className="mt-6">
          {(objQ.data ?? []).length === 0 ? (
            <EmptyState
              title="No objectives cascaded to this employee"
              hint="Cascade department objectives so the employee's work links to a measurable outcome."
              action={<Button asChild variant="outline"><Link to="/staff/org/objectives">Open objectives</Link></Button>}
            />
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Objective</TableHead>
                      <TableHead>KPI</TableHead>
                      <TableHead>Target</TableHead>
                      <TableHead>Actual</TableHead>
                      <TableHead>Deadline</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(objQ.data ?? []).map((o) => (
                      <TableRow key={o.id}>
                        <TableCell className="text-sm font-medium">{o.title}</TableCell>
                        <TableCell className="text-sm">{o.kpi_label}</TableCell>
                        <TableCell className="text-sm">{o.target} {o.kpi_unit}</TableCell>
                        <TableCell className="text-sm">{o.actual ?? "—"}</TableCell>
                        <TableCell className="text-sm">{dateText(o.deadline)}</TableCell>
                        <TableCell><StatusPill value={o.status} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}

/* ------------------------------- sub-forms -------------------------------- */

function CompetencyForm({
  staffId, competencies, onSaved,
}: { staffId: string; competencies: { id: string; name: string }[]; onSaved: () => void }) {
  const [competencyId, setCompetencyId] = useState("");
  const [level, setLevel] = useState("3");

  const save = useMutation({
    mutationFn: () =>
      org.saveStaffCompetency({
        staff_id: staffId,
        competency_id: competencyId,
        assessed_level: Number(level),
        assessed_at: new Date().toISOString(),
      }),
    onSuccess: () => { onSaved(); toast.success("Competency assessment recorded"); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (competencies.length === 0) {
    return <p className="text-sm text-muted-foreground">No competency catalogue defined yet.</p>;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-[2fr,1fr,auto] sm:items-end">
      <SelectField
        label="Competency"
        value={competencyId}
        onChange={setCompetencyId}
        options={competencies.map((c) => ({ value: c.id, label: c.name }))}
      />
      <Field label="Assessed level (1–5)">
        <Input type="number" min={1} max={5} value={level} onChange={(e) => setLevel(e.target.value)} />
      </Field>
      <Button disabled={!competencyId || save.isPending} onClick={() => save.mutate()}>Record</Button>
    </div>
  );
}

function QualificationDialog({
  staffId, documents, onSaved,
}: { staffId: string; documents: { id: string; title: string }[]; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    title: "", qualification_kind: "academic", institution: "", reference: "",
    awarded_on: "", expires_on: "", document_id: "",
  });
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: async () => {
      if (!form.title.trim()) throw new Error("Qualification title is required.");
      const row = await org.saveQualification({
        staff_id: staffId,
        title: form.title.trim(),
        qualification_kind: form.qualification_kind,
        institution: form.institution || null,
        reference: form.reference || null,
        awarded_on: form.awarded_on || null,
        expires_on: form.expires_on || null,
        document_id: form.document_id || null,
      });
      try { await org.recomputeGaps(staffId); } catch { /* no position or no requirements */ }
      return row;
    },
    onSuccess: () => { onSaved(); toast.success("Qualification recorded and requirements re-compared"); setOpen(false); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      busy={save.isPending}
      trigger={<Button variant="outline">Add qualification</Button>}
      title="Add qualification"
      description="Recorded qualifications are compared against the requirements of the assigned position."
      submitLabel="Save qualification"
      onSubmit={async () => { await save.mutateAsync(); }}
    >
      <TextField label="Title" required value={form.title} onChange={set("title")} placeholder="BSc Information Systems" />
      <SelectField
        label="Kind"
        value={form.qualification_kind}
        onChange={set("qualification_kind")}
        options={QUALIFICATION_KINDS.map((k) => ({ value: k, label: titleise(k) }))}
      />
      <TextField label="Institution" value={form.institution} onChange={set("institution")} />
      <TextField label="Reference / certificate no." value={form.reference} onChange={set("reference")} />
      <TextField label="Awarded on" type="date" value={form.awarded_on} onChange={set("awarded_on")} />
      <TextField label="Expires on" type="date" value={form.expires_on} onChange={set("expires_on")} />
      <SelectField
        label="Supporting document"
        value={form.document_id}
        onChange={set("document_id")}
        options={documents.map((d) => ({ value: d.id, label: d.title }))}
        hint="Upload the certificate under Documents first to link evidence."
      />
    </FormDialog>
  );
}

function DocumentUpload({ staffId, onSaved }: { staffId: string; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState({ title: "", docType: "academic_certificate", description: "", issue: "", expiry: "" });
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose a file to upload.");
      if (!form.title.trim()) throw new Error("Document title is required.");
      return org.uploadStaffDocument({
        staffId, file, docType: form.docType, title: form.title.trim(),
        description: form.description || undefined,
        issueDate: form.issue || null, expiryDate: form.expiry || null,
      });
    },
    onSuccess: () => { onSaved(); toast.success("Document uploaded to the private staff store"); setOpen(false); setFile(null); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      busy={save.isPending}
      trigger={<Button><FileUp className="mr-2 h-4 w-4" />Upload document</Button>}
      title="Upload employee document"
      description="Stored privately; access is scoped to the employee and authorised administrators."
      submitLabel="Upload"
      onSubmit={async () => { await save.mutateAsync(); }}
    >
      <TextField label="Title" required value={form.title} onChange={set("title")} />
      <SelectField
        label="Document type"
        value={form.docType}
        onChange={set("docType")}
        options={DOCUMENT_TYPES.map((d) => ({ value: d, label: titleise(d) }))}
      />
      <TextField label="Issue date" type="date" value={form.issue} onChange={set("issue")} />
      <TextField label="Expiry date" type="date" value={form.expiry} onChange={set("expiry")} hint="Expiring documents surface in compliance alerts." />
      <AreaField label="Description" value={form.description} onChange={set("description")} />
      <Field label="File *">
        <Input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </Field>
    </FormDialog>
  );
}

function VerifyQualification({ id, onSaved }: { id: string; onSaved: () => void }) {
  const save = useMutation({
    mutationFn: () => org.setQualificationVerification(id, "verified"),
    onSuccess: () => { onSaved(); toast.success("Qualification verified"); },
    onError: (e: Error) => toast.error(e.message),
  });
  return <Button size="sm" variant="outline" disabled={save.isPending} onClick={() => save.mutate()}>Verify</Button>;
}

function TrainingProgress({
  need, onSaved,
}: { need: { id: string; status: string }; onSaved: () => void }) {
  const idx = TRAINING_LIFECYCLE.indexOf(need.status as (typeof TRAINING_LIFECYCLE)[number]);
  const next = idx >= 0 && idx < TRAINING_LIFECYCLE.length - 1 ? TRAINING_LIFECYCLE[idx + 1] : null;
  const save = useMutation({
    mutationFn: () => org.saveTrainingNeed({ id: need.id, status: next! }),
    onSuccess: () => { onSaved(); toast.success(`Training moved to ${titleise(next!)}`); },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!next) return <span className="text-xs text-muted-foreground">Closed</span>;
  return <Button size="sm" variant="ghost" disabled={save.isPending} onClick={() => save.mutate()}>Mark {titleise(next)}</Button>;
}
