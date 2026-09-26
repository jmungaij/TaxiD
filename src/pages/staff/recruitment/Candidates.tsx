import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Sparkles, UserPlus } from "lucide-react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

import * as rec from "@/lib/recruitment/api";
import { CANDIDATE_SOURCES, titleise } from "@/lib/recruitment/types";
import type { RecCandidate } from "@/lib/recruitment/types";
import { matchCandidate } from "@/lib/recruitment/matching";
import { AppButton } from "@/components/nav/AppButton";

/**
 * Candidate register — the durable talent record. A candidate exists
 * independently of any single vacancy, so the same person can be matched to a
 * new role later without re-entering their history.
 */
export default function RecruitmentCandidates() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [applyFor, setApplyFor] = useState<RecCandidate | null>(null);

  const candidates = useQuery({ queryKey: ["rec", "candidates"], queryFn: rec.listCandidates });
  const vacancies = useQuery({ queryKey: ["rec", "vacancies"], queryFn: rec.listVacancies });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = candidates.data ?? [];
    return q
      ? all.filter((c) =>
          [c.full_name, c.email ?? "", c.headline ?? "", c.current_employer ?? ""].some((f) =>
            f.toLowerCase().includes(q)))
      : all;
  }, [candidates.data, search]);

  const create = useMutation({
    mutationFn: rec.createCandidate,
    onSuccess: () => {
      toast.success("Candidate added");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["rec", "candidates"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const apply = useMutation({
    mutationFn: rec.createApplication,
    onSuccess: () => {
      toast.success("Application created");
      setApplyFor(null);
      qc.invalidateQueries({ queryKey: ["rec", "applications"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-6 lg:p-8">
      <StaffPageHeader
        eyebrow="Recruitment 360"
        title="Candidates"
        lede="The durable talent record. Add a candidate once, then match them to any open vacancy."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-2" aria-hidden="true" />Add candidate</Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>Add candidate</DialogTitle>
                <DialogDescription>
                  Record consent when the candidate has agreed to their data being held for future roles.
                </DialogDescription>
              </DialogHeader>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  create.mutate({
                    full_name: String(f.get("full_name") ?? "").trim(),
                    email: String(f.get("email") ?? "").trim() || null,
                    phone: String(f.get("phone") ?? "").trim() || null,
                    location: String(f.get("location") ?? "").trim() || null,
                    headline: String(f.get("headline") ?? "").trim() || null,
                    current_employer: String(f.get("current_employer") ?? "").trim() || null,
                    current_title: String(f.get("current_title") ?? "").trim() || null,
                    years_experience: Number(f.get("years") ?? 0) || null,
                    source: String(f.get("source") ?? "careers_site"),
                    summary: String(f.get("summary") ?? "").trim() || null,
                    consent_given: f.get("consent") === "on",
                    consent_at: f.get("consent") === "on" ? new Date().toISOString() : null,
                  } as never);
                }}
                className="space-y-4"
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <FieldInput label="Full name" name="full_name" required />
                  <FieldInput label="Email" name="email" type="email" />
                  <FieldInput label="Phone" name="phone" />
                  <FieldInput label="Location" name="location" />
                  <FieldInput label="Current employer" name="current_employer" />
                  <FieldInput label="Current title" name="current_title" />
                  <FieldInput label="Years experience" name="years" type="number" />
                  <div className="space-y-1.5">
                    <Label htmlFor="source">Source</Label>
                    <Select name="source" defaultValue="careers_site">
                      <SelectTrigger id="source"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {CANDIDATE_SOURCES.map((s) => (
                          <SelectItem key={s} value={s}>{titleise(s)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <FieldInput label="Professional headline" name="headline" />
                <div className="space-y-1.5">
                  <Label htmlFor="summary">Summary</Label>
                  <Textarea id="summary" name="summary" rows={3} />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="consent" className="h-4 w-4 rounded border-input" />
                  Candidate consented to data retention
                </label>
                <DialogFooter>
                  <Button type="submit" disabled={create.isPending}>
                    {create.isPending ? "Saving…" : "Add candidate"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search name, email, employer"
        className="mb-4 max-w-sm"
        aria-label="Search candidates"
      />

      <Card>
        <CardContent className="p-0">
          {candidates.isLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
            </div>
          ) : candidates.error ? (
            <p className="p-6 text-sm text-destructive">
              Candidates could not be loaded: {(candidates.error as Error).message}
            </p>
          ) : rows.length === 0 ? (
            <div className="p-10 text-center">
              <p className="text-sm font-medium">No candidates yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                Add a candidate to build the talent register, or publish a vacancy to receive applications.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Candidate</TableHead>
                  <TableHead>Current role</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <p className="font-medium">{c.full_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {c.candidate_no}{c.email ? ` · ${c.email}` : ""}
                      </p>
                    </TableCell>
                    <TableCell className="text-sm">
                      {c.current_title ?? "—"}
                      {c.current_employer ? <span className="text-muted-foreground"> · {c.current_employer}</span> : null}
                    </TableCell>
                    <TableCell className="text-sm">{c.location ?? "—"}</TableCell>
                    <TableCell><Badge variant="outline">{titleise(c.source)}</Badge></TableCell>
                    <TableCell>
                      <Badge variant="outline">{titleise(c.engagement_status)}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => setApplyFor(c)}>
                        <UserPlus className="h-4 w-4 mr-1" aria-hidden="true" />Match to role
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!applyFor} onOpenChange={(o) => !o && setApplyFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Match to a vacancy</DialogTitle>
            <DialogDescription>
              The suggested fit is computed from the vacancy's declared requirements and shown before you commit.
            </DialogDescription>
          </DialogHeader>
          {applyFor && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const vacancyId = String(f.get("vacancy_id") ?? "");
                const vacancy = (vacancies.data ?? []).find((v) => v.id === vacancyId);
                const score = vacancy
                  ? matchCandidate({
                      candidate: applyFor,
                      candidateSkills: [],
                      candidateQualifications: [],
                      vacancy,
                    }).score
                  : undefined;
                apply.mutate({
                  candidate_id: applyFor.id,
                  vacancy_id: vacancyId,
                  source: "direct_sourcing",
                  ai_match_score: score,
                });
              }}
              className="space-y-4"
            >
              <div className="space-y-1.5">
                <Label htmlFor="vacancy_id">Vacancy</Label>
                <Select name="vacancy_id" required>
                  <SelectTrigger id="vacancy_id"><SelectValue placeholder="Select a vacancy" /></SelectTrigger>
                  <SelectContent>
                    {(vacancies.data ?? []).filter((v) => v.status === "open").map((v) => (
                      <SelectItem key={v.id} value={v.id}>{v.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                A suggested fit score is stored with the application and can be overridden at screening.
              </p>
              <DialogFooter>
                <AppButton analytics="recruitment_candidate_application_create" action="submit" type="submit" disabled={apply.isPending}>
                  {apply.isPending ? "Creating…" : "Create application"}
                </AppButton>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FieldInput({
  label, name, type = "text", required,
}: { label: string; name: string; type?: string; required?: boolean }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type={type} required={required} />
    </div>
  );
}
