import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Plus, Megaphone, PauseCircle, Pencil, GraduationCap, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { StaffPageHeader } from "@/components/staff/primitives";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import * as rec from "@/lib/recruitment/api";
import type { RecVacancy } from "@/lib/recruitment/types";
import {
  EMPLOYMENT_TYPES, PRIORITIES, WORK_ARRANGEMENTS, money, titleise, vacancySlaState,
} from "@/lib/recruitment/types";

const SLA_TONE: Record<string, string> = {
  on_track: "bg-success/10 text-success border-success/30",
  at_risk: "bg-warning/10 text-warning-foreground border-warning/30",
  breached: "bg-destructive/10 text-destructive border-destructive/30",
  closed: "bg-muted text-muted-foreground border-border",
};

const csv = (value: string) => value.split(",").map((s) => s.trim()).filter(Boolean);

export default function RecruitmentVacancies() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState("open");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<RecVacancy | null>(null);

  const vacancies = useQuery({ queryKey: ["rec", "vacancies"], queryFn: rec.listVacancies });
  const applications = useQuery({ queryKey: ["rec", "applications"], queryFn: () => rec.listApplications() });
  const positions = useQuery({ queryKey: ["rec", "position-options"], queryFn: rec.listPositionOptions });

  const countFor = (vacancyId: string) =>
    (applications.data ?? []).filter((a) => a.vacancy_id === vacancyId && a.status === "active").length;

  const rows = useMemo(() => {
    const all = vacancies.data ?? [];
    const byFilter =
      filter === "all"
        ? all
        : filter === "published"
          ? all.filter((v) => v.publication_status === "published")
          : filter === "draft"
            ? all.filter((v) => v.publication_status !== "published")
            : all.filter((v) => v.status === filter);
    const q = search.trim().toLowerCase();
    return q
      ? byFilter.filter((v) =>
          [v.title, v.vacancy_no, v.location ?? ""].some((f) => f.toLowerCase().includes(q)))
      : byFilter;
  }, [vacancies.data, filter, search]);

  const create = useMutation({
    mutationFn: rec.createVacancy,
    onSuccess: () => {
      toast.success("Vacancy created");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["rec", "vacancies"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const publish = useMutation({
    mutationFn: ({ id, next }: { id: string; next: boolean }) => rec.publishVacancy(id, next),
    onSuccess: (result, v) => {
      if (!v.next) toast.success("Vacancy paused — it is no longer on the public Careers page.");
      else if (result.careers_visible) toast.success("Vacancy published and live on the public Careers page.");
      else toast.warning("Published, but the public Careers projection has not confirmed it yet.");
      qc.invalidateQueries({ queryKey: ["rec", "vacancies"] });
    },
    // Publication is fail-closed. When a gate refuses, send HR to the readiness
    // report for that vacancy, where each blocker has its own remediation.
    onError: (e: Error, v) => {
      if (v.next) {
        toast.error("Publication refused — readiness gates not met", {
          description: e.message,
          action: {
            label: "Open readiness report",
            onClick: () => {
              window.location.assign(`/staff/recruitment/publication-health?vacancy=${v.id}`);
            },
          },
          duration: 12_000,
        });
        return;
      }
      toast.error(e.message);
    },

  });

  const approve = useMutation({
    mutationFn: (id: string) => rec.approveVacancy(id, "Approved from the Recruitment 360 vacancies board."),
    onSuccess: () => {
      toast.success("Vacancy approved — it can now be published.");
      qc.invalidateQueries({ queryKey: ["rec", "vacancies"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });


  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<RecVacancy> }) => rec.updateVacancy(id, patch),
    onSuccess: () => {
      toast.success("Vacancy updated");
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["rec", "vacancies"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });


  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const salaryMin = Number(f.get("salary_min"));
    const salaryMax = Number(f.get("salary_max"));
    create.mutate({
      title: String(f.get("title") ?? "").trim(),
      location: String(f.get("location") ?? "").trim() || null,
      position_id: String(f.get("position_id") ?? "") || null,
      employment_type: String(f.get("employment_type") ?? "permanent"),
      work_arrangement: String(f.get("work_arrangement") ?? "onsite"),
      priority: String(f.get("priority") ?? "normal") as never,
      headcount: Math.max(1, Number(f.get("headcount") ?? 1)),
      sla_days: Math.max(1, Number(f.get("sla_days") ?? 30)),
      target_hire_date: String(f.get("target_hire_date") ?? "") || null,
      salary_min_cents: salaryMin ? salaryMin * 100 : null,
      salary_max_cents: salaryMax ? salaryMax * 100 : null,
      min_years_experience: Number(f.get("min_years") ?? 0) || null,
      required_skills: csv(String(f.get("required_skills") ?? "")),
      preferred_skills: csv(String(f.get("preferred_skills") ?? "")),
      qualifications: csv(String(f.get("qualifications") ?? "")),
      responsibilities: csv(String(f.get("responsibilities") ?? "")),
    } as never);
  };


  return (
    <div className="p-6 lg:p-8">
      <StaffPageHeader
        eyebrow="Recruitment 360"
        title="Vacancies"
        lede="Approved hiring demand, its publication state, and how each role is tracking against its time-to-fill target."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild>
              <Link to="/staff/recruitment/internships/new">
                <GraduationCap className="h-4 w-4 mr-2" aria-hidden="true" />New internship programme
              </Link>
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button variant="outline"><Plus className="h-4 w-4 mr-2" aria-hidden="true" />New vacancy</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>New vacancy</DialogTitle>
                <DialogDescription>
                  Required skills, qualifications and minimum experience drive candidate matching, so keep them precise.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={submit} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Job title" name="title" required />
                  <Field label="Location" name="location" placeholder="Nairobi" />
                  <PositionField positions={positions.data ?? []} />
                  <SelectField label="Employment type" name="employment_type" options={EMPLOYMENT_TYPES} />
                  <SelectField label="Work arrangement" name="work_arrangement" options={WORK_ARRANGEMENTS} />
                  <SelectField label="Priority" name="priority" options={PRIORITIES} defaultValue="normal" />
                  <Field label="Headcount" name="headcount" type="number" defaultValue="1" />
                  <Field label="Time-to-fill target (days)" name="sla_days" type="number" defaultValue="30" />
                  <Field label="Target hire date" name="target_hire_date" type="date" />
                  <Field label="Salary min (KES)" name="salary_min" type="number" />
                  <Field label="Salary max (KES)" name="salary_max" type="number" />
                  <Field label="Minimum years experience" name="min_years" type="number" />
                </div>
                <AreaField label="Required skills (comma separated)" name="required_skills" />
                <AreaField label="Preferred skills (comma separated)" name="preferred_skills" />
                <AreaField label="Qualifications (comma separated)" name="qualifications" />
                <AreaField label="Key responsibilities (comma separated)" name="responsibilities" />
                <DialogFooter>
                  <Button type="submit" disabled={create.isPending}>
                    {create.isPending ? "Creating…" : "Create vacancy"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
            </Dialog>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs value={filter} onValueChange={setFilter}>
          <TabsList>
            <TabsTrigger value="open">Open</TabsTrigger>
            <TabsTrigger value="draft">Drafts</TabsTrigger>
            <TabsTrigger value="published">Published</TabsTrigger>
            <TabsTrigger value="filled">Filled</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search title, reference or location"
          className="max-w-xs"
          aria-label="Search vacancies"
        />
      </div>

      <Card>
        <CardContent className="p-0">
          {vacancies.isLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
            </div>
          ) : vacancies.error ? (
            <p className="p-6 text-sm text-destructive">
              Vacancies could not be loaded: {(vacancies.error as Error).message}
            </p>
          ) : rows.length === 0 ? (
            <div className="p-10 text-center">
              <p className="text-sm font-medium">No vacancies here yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                Create a vacancy to start a pipeline, or widen the filter above.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Role</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Salary band</TableHead>
                  <TableHead className="text-right">Active</TableHead>
                  <TableHead>Time to fill</TableHead>
                  <TableHead>Publication</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((v) => {
                  const sla = vacancySlaState(v);
                  const published = v.publication_status === "published";
                  return (
                    <TableRow key={v.id}>
                      <TableCell>
                        <Link to={`/staff/recruitment/pipeline?vacancy=${v.id}`} className="font-medium hover:underline">
                          {v.title}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {v.vacancy_no} · {titleise(v.employment_type)} · {titleise(v.work_arrangement)}
                        </p>
                      </TableCell>
                      <TableCell className="text-sm">{v.location ?? "—"}</TableCell>
                      <TableCell className="text-sm">
                        {v.salary_min_cents || v.salary_max_cents
                          ? `${money(v.salary_min_cents, v.currency)} – ${money(v.salary_max_cents, v.currency)}`
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{countFor(v.id)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={SLA_TONE[sla.state]}>
                          {sla.daysOpen}d / {v.sla_days}d
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{titleise(v.publication_status)}</Badge>
                        {published && v.status === "open" && v.approval_status === "approved" && v.public_slug ? (
                          <a
                            href={`/careers/${v.public_slug}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block text-xs text-primary hover:underline mt-1"
                          >
                            Live on Careers
                          </a>
                        ) : null}
                        {published && v.approval_status !== "approved" ? (
                          <p className="mt-1 text-xs text-destructive">
                            Not on Careers — approval is {titleise(v.approval_status)}
                          </p>
                        ) : null}
                        {!published && v.approval_status !== "approved" ? (
                          <p className="mt-1 text-xs text-warning-foreground">Awaiting approval</p>
                        ) : null}
                        {!published && !v.position_id && !v.position_exception_reason?.trim() ? (
                          <p className="mt-1 text-xs text-warning-foreground">No linked org position</p>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(v)}>
                          <Pencil className="h-4 w-4 mr-1" aria-hidden="true" />Edit
                        </Button>
                        {v.approval_status !== "approved" ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={approve.isPending}
                            onClick={() => approve.mutate(v.id)}
                          >
                            <ShieldCheck className="h-4 w-4 mr-1" aria-hidden="true" />Approve
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={publish.isPending || (!published && v.approval_status !== "approved")}
                          onClick={() => publish.mutate({ id: v.id, next: !published })}
                        >
                          {published
                            ? <><PauseCircle className="h-4 w-4 mr-1" aria-hidden="true" />Pause</>
                            : <><Megaphone className="h-4 w-4 mr-1" aria-hidden="true" />Publish</>}
                        </Button>

                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <EditVacancyDialog
        vacancy={editing}
        pending={update.isPending}
        positions={positions.data ?? []}
        onClose={() => setEditing(null)}
        onSave={(patch) => editing && update.mutate({ id: editing.id, patch })}
      />
    </div>
  );
}

function EditVacancyDialog({
  vacancy, pending, positions, onClose, onSave,
}: {
  vacancy: RecVacancy | null;
  pending: boolean;
  positions: rec.RecPositionOption[];
  onClose: () => void;
  onSave: (patch: Partial<RecVacancy>) => void;
}) {
  if (!vacancy) return null;
  const isPublished = vacancy.publication_status === "published";

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const salaryMin = Number(f.get("salary_min"));
    const salaryMax = Number(f.get("salary_max"));
    onSave({
      title: String(f.get("title") ?? "").trim(),
      location: String(f.get("location") ?? "").trim() || null,
      position_id: String(f.get("position_id") ?? "") || null,
      position_exception_reason: String(f.get("position_exception_reason") ?? "").trim() || null,
      employment_type: String(f.get("employment_type") ?? vacancy.employment_type),
      work_arrangement: String(f.get("work_arrangement") ?? vacancy.work_arrangement),
      priority: String(f.get("priority") ?? vacancy.priority),
      headcount: Math.max(1, Number(f.get("headcount") ?? vacancy.headcount)),
      sla_days: Math.max(1, Number(f.get("sla_days") ?? vacancy.sla_days)),
      salary_min_cents: salaryMin ? Math.round(salaryMin * 100) : null,
      salary_max_cents: salaryMax ? Math.round(salaryMax * 100) : null,
    } as Partial<RecVacancy>);
  };

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit {vacancy.title}</DialogTitle>
          <DialogDescription>
            {vacancy.vacancy_no} · {titleise(vacancy.publication_status)}.{" "}
            {isPublished
              ? "This role is live on Careers — pause the publication before changing its commercial terms."
              : "Draft roles can be edited freely before publication."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <fieldset disabled={isPublished || pending} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Job title" name="title" required defaultValue={vacancy.title} />
              <Field label="Location" name="location" defaultValue={vacancy.location ?? ""} />
              <PositionField positions={positions} defaultValue={vacancy.position_id} />
              <SelectField
                label="Employment type"
                name="employment_type"
                options={EMPLOYMENT_TYPES}
                defaultValue={vacancy.employment_type}
              />
              <SelectField
                label="Work arrangement"
                name="work_arrangement"
                options={WORK_ARRANGEMENTS}
                defaultValue={vacancy.work_arrangement}
              />
              <SelectField label="Priority" name="priority" options={PRIORITIES} defaultValue={vacancy.priority} />
              <Field label="Headcount" name="headcount" type="number" defaultValue={String(vacancy.headcount)} />
              <Field label="Time-to-fill target (days)" name="sla_days" type="number" defaultValue={String(vacancy.sla_days)} />
              <Field
                label="Salary min (KES)"
                name="salary_min"
                type="number"
                defaultValue={vacancy.salary_min_cents ? String(vacancy.salary_min_cents / 100) : ""}
              />
              <Field
                label="Salary max (KES)"
                name="salary_max"
                type="number"
                defaultValue={vacancy.salary_max_cents ? String(vacancy.salary_max_cents / 100) : ""}
              />
            </div>
            <AreaField
              label="Position exception reason (only if no org position applies)"
              name="position_exception_reason"
              defaultValue={vacancy.position_exception_reason ?? ""}
              placeholder="e.g. New role pending org design approval — approved by COO on 2026-08-10"
            />
          </fieldset>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Close</Button>
            <Button type="submit" disabled={isPublished || pending}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label, name, type = "text", required, defaultValue, placeholder,
}: { label: string; name: string; type?: string; required?: boolean; defaultValue?: string; placeholder?: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type={type} required={required} defaultValue={defaultValue} placeholder={placeholder} />
    </div>
  );
}

function AreaField({
  label, name, defaultValue, placeholder,
}: { label: string; name: string; defaultValue?: string; placeholder?: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Textarea id={name} name={name} rows={2} defaultValue={defaultValue} placeholder={placeholder} />
    </div>
  );
}

function PositionField({
  positions, defaultValue,
}: { positions: rec.RecPositionOption[]; defaultValue?: string | null }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="position_id">Org position</Label>
      <select
        id="position_id"
        name="position_id"
        defaultValue={defaultValue ?? ""}
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <option value="">— none —</option>
        {positions.map((p) => (
          <option key={p.id} value={p.id}>{p.title} · {p.code}</option>
        ))}
      </select>
      <p className="text-xs text-muted-foreground">
        A vacancy needs a linked approved position, or a recorded exception reason, before it can be published.
      </p>
    </div>
  );
}

function SelectField({
  label, name, options, defaultValue,
}: { label: string; name: string; options: readonly string[]; defaultValue?: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Select name={name} defaultValue={defaultValue ?? options[0]}>
        <SelectTrigger id={name}><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map((o) => <SelectItem key={o} value={o}>{titleise(o)}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}
