/**
 * Assessment blueprints & papers — /staff/recruitment/assessments
 *
 * The single place where a vacancy's assessment is defined and released:
 *  1. map the vacancy to canonical competencies (weight, minimum, mandatory),
 *  2. read the coverage report — which competencies have published questions,
 *  3. compose a draft paper drawn only from that map's published questions,
 *  4. activate it (four-eyes; retires the previous version; freezes the items),
 *  5. issue it to a candidate's application and hand off to HR review.
 *
 * Nothing here computes a score or invents coverage: every figure comes from the
 * database RPCs, and activation blockers are surfaced verbatim.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, FileStack, Layers, Send, ShieldCheck } from "lucide-react";

import { StaffPageHeader } from "@/components/staff/primitives";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import {
  DIFFICULTIES, activatePaper, canActivatePaper, composePaper, coverageFor, difficultyLabel,
  listCompetencies, listPapers, listVacancyCompetencies, paperDetail, setVacancyCompetencies,
  weightedShare, type Difficulty, type VacancyCompetency,
} from "@/lib/recruitment/assessmentBlueprint";
import { issueAttempt } from "@/lib/recruitment/professionAssessment";

interface VacancyRow { id: string; vacancy_no: string; title: string; publication_status: string; status: string }
interface ApplicationRow { id: string; application_no: string; stage: string; candidate: { full_name: string } | null }

async function listVacancies(): Promise<VacancyRow[]> {
  const { data, error } = await supabase
    .from("rec_vacancies")
    .select("id,vacancy_no,title,publication_status,status")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as VacancyRow[];
}

async function listApplications(vacancyId: string): Promise<ApplicationRow[]> {
  const { data, error } = await supabase
    .from("rec_applications")
    .select("id,application_no,stage,candidate:rec_candidates(full_name)")
    .eq("vacancy_id", vacancyId)
    .order("applied_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ApplicationRow[];
}

export default function RecruitmentAssessmentBlueprints() {
  const qc = useQueryClient();
  const [vacancyId, setVacancyId] = useState<string>("");
  const [perCompetency, setPerCompetency] = useState<string>("");
  const [difficulties, setDifficulties] = useState<Difficulty[]>([]);
  const [openPaper, setOpenPaper] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, VacancyCompetency> | null>(null);

  const vacancies = useQuery({ queryKey: ["rec", "vacancies", "assess"], queryFn: listVacancies });
  const competencies = useQuery({ queryKey: ["rec", "competencies"], queryFn: listCompetencies });
  const mapped = useQuery({
    queryKey: ["rec", "vacancy-competencies", vacancyId],
    queryFn: () => listVacancyCompetencies(vacancyId),
    enabled: !!vacancyId,
  });
  const coverage = useQuery({
    queryKey: ["rec", "coverage", vacancyId],
    queryFn: () => coverageFor(vacancyId),
    enabled: !!vacancyId,
  });
  const papers = useQuery({
    queryKey: ["rec", "papers", vacancyId],
    queryFn: () => listPapers(vacancyId || undefined),
    enabled: !!vacancyId,
  });
  const applications = useQuery({
    queryKey: ["rec", "applications", vacancyId],
    queryFn: () => listApplications(vacancyId),
    enabled: !!vacancyId,
  });
  const detail = useQuery({
    queryKey: ["rec", "paper-detail", openPaper],
    queryFn: () => paperDetail(openPaper as string),
    enabled: !!openPaper,
  });

  /** The competency map being edited — server state until the user touches it. */
  const rows = useMemo(() => {
    if (draft) return draft;
    const base: Record<string, VacancyCompetency> = {};
    (mapped.data ?? []).forEach((m) => { base[m.competency_code] = m; });
    return base;
  }, [draft, mapped.data]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["rec", "vacancy-competencies", vacancyId] });
    qc.invalidateQueries({ queryKey: ["rec", "coverage", vacancyId] });
    qc.invalidateQueries({ queryKey: ["rec", "papers", vacancyId] });
  };

  const saveMap = useMutation({
    mutationFn: () => setVacancyCompetencies(vacancyId, Object.values(rows)),
    onSuccess: () => { toast.success("Competency map saved"); setDraft(null); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const compose = useMutation({
    mutationFn: () => composePaper(vacancyId, {
      perCompetency: perCompetency ? Number(perCompetency) : null,
      difficulties: difficulties.length ? difficulties : null,
    }),
    onSuccess: (r) => {
      toast.success(`Draft paper v${r.version} composed — ${r.question_count} question(s), ${r.total_marks} marks`);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const activate = useMutation({
    mutationFn: (id: string) => activatePaper(id),
    onSuccess: () => { toast.success("Paper activated — previous version retired"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const issue = useMutation({
    mutationFn: (applicationId: string) => issueAttempt(applicationId),
    onSuccess: (r) => {
      const url = `${window.location.origin}/recruitment/assessment?token=${r.attempt_token}`;
      void navigator.clipboard?.writeText(url).catch(() => undefined);
      toast.success(`Assessment issued (attempt ${r.attempt_no}) — candidate link copied`);
      qc.invalidateQueries({ queryKey: ["rec", "papers", vacancyId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const shares = weightedShare(coverage.data?.competencies ?? []);
  const gaps = coverage.data?.gaps ?? [];

  return (
    <div className="space-y-6 p-6 lg:p-8">
      <StaffPageHeader
        eyebrow="Recruitment 360"
        title="Assessment blueprints & papers"
        lede="A vacancy is assessed only through its competency map. Papers are composed from published questions, version-snapshotted on activation, and frozen once released."
      />

      <Card>
        <CardHeader><CardTitle className="text-base">1 · Choose the vacancy</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Label htmlFor="vacancy">Vacancy</Label>
          <Select value={vacancyId} onValueChange={(v) => { setVacancyId(v); setDraft(null); setOpenPaper(null); }}>
            <SelectTrigger id="vacancy" className="max-w-xl"><SelectValue placeholder="Select a vacancy" /></SelectTrigger>
            <SelectContent>
              {(vacancies.data ?? []).map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.vacancy_no} · {v.title} {v.publication_status === "published" ? "· published" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {vacancyId && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Layers className="h-4 w-4" aria-hidden />2 · Competency map
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {competencies.isLoading ? <Skeleton className="h-24 w-full" /> : (
                <div className="grid gap-3 md:grid-cols-2">
                  {(competencies.data ?? []).map((c) => {
                    const on = !!rows[c.code];
                    return (
                      <div key={c.code} className="rounded-lg border border-border p-3 space-y-2">
                        <div className="flex items-start gap-3">
                          <Checkbox
                            id={`c-${c.code}`}
                            checked={on}
                            onCheckedChange={(v) => {
                              const next = { ...rows };
                              if (v) next[c.code] = { competency_code: c.code, weight: 1, min_marks: null, mandatory: true, sort_order: Object.keys(next).length };
                              else delete next[c.code];
                              setDraft(next);
                            }}
                          />
                          <div className="space-y-0.5">
                            <Label htmlFor={`c-${c.code}`} className="font-medium">{c.label}</Label>
                            <p className="text-xs text-muted-foreground">{c.code} · {c.role_family}</p>
                          </div>
                        </div>
                        {on && (
                          <div className="grid grid-cols-3 gap-2">
                            <div className="space-y-1">
                              <Label htmlFor={`w-${c.code}`} className="text-xs">Weight</Label>
                              <Input id={`w-${c.code}`} type="number" min={0} step="0.5" value={rows[c.code].weight}
                                onChange={(e) => setDraft({ ...rows, [c.code]: { ...rows[c.code], weight: Number(e.target.value) } })} />
                            </div>
                            <div className="space-y-1">
                              <Label htmlFor={`m-${c.code}`} className="text-xs">Min marks</Label>
                              <Input id={`m-${c.code}`} type="number" min={0} value={rows[c.code].min_marks ?? ""}
                                onChange={(e) => setDraft({ ...rows, [c.code]: { ...rows[c.code], min_marks: e.target.value === "" ? null : Number(e.target.value) } })} />
                            </div>
                            <div className="flex items-end gap-2 pb-2">
                              <Checkbox id={`q-${c.code}`} checked={rows[c.code].mandatory}
                                onCheckedChange={(v) => setDraft({ ...rows, [c.code]: { ...rows[c.code], mandatory: !!v } })} />
                              <Label htmlFor={`q-${c.code}`} className="text-xs">Mandatory</Label>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              <Button onClick={() => saveMap.mutate()} disabled={saveMap.isPending} data-analytics="none">
                Save competency map
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">3 · Coverage from published questions</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {coverage.isLoading ? <Skeleton className="h-24 w-full" /> : (coverage.data?.competencies ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No competencies mapped yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Competency</TableHead><TableHead>Weight</TableHead>
                      <TableHead>Share</TableHead><TableHead>Published questions</TableHead>
                      <TableHead>Available marks</TableHead><TableHead>Minimum</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(coverage.data?.competencies ?? []).map((l) => (
                      <TableRow key={l.competency_code}>
                        <TableCell>
                          <span className="font-medium">{l.competency_label}</span>
                          {l.mandatory && <Badge variant="outline" className="ml-2">mandatory</Badge>}
                        </TableCell>
                        <TableCell>{l.weight}</TableCell>
                        <TableCell>{shares.find((s) => s.competency_code === l.competency_code)?.share ?? 0}%</TableCell>
                        <TableCell>
                          {l.published_questions === 0
                            ? <span className="text-destructive">none</span>
                            : l.published_questions}
                        </TableCell>
                        <TableCell>{l.available_marks}</TableCell>
                        <TableCell>{l.min_marks ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {gaps.length > 0 && (
                <p className="flex items-start gap-2 text-sm text-destructive" role="alert">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  Coverage gap — no published question for: {gaps.join(", ")}. Publish questions in the
                  {" "}<Link className="underline" to="/staff/recruitment/questions">question governance console</Link>{" "}
                  before a paper can be activated.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">4 · Compose a draft paper</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="per">Questions per competency (blank = all published)</Label>
                  <Input id="per" type="number" min={1} value={perCompetency}
                    onChange={(e) => setPerCompetency(e.target.value)} className="max-w-[16rem]" />
                </div>
                <div className="space-y-2">
                  <Label>Difficulty mix (blank = any)</Label>
                  <div className="flex flex-wrap gap-3">
                    {DIFFICULTIES.map((d) => (
                      <label key={d} className="flex items-center gap-2 text-sm">
                        <Checkbox checked={difficulties.includes(d)}
                          onCheckedChange={(v) => setDifficulties(v ? [...difficulties, d] : difficulties.filter((x) => x !== d))} />
                        {difficultyLabel(d)}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <Button onClick={() => compose.mutate()} disabled={compose.isPending} data-analytics="none">
                <FileStack className="mr-2 h-4 w-4" aria-hidden />Compose draft version
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">5 · Paper versions</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {papers.isLoading ? <Skeleton className="h-24 w-full" /> : (papers.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No paper composed for this vacancy yet.</p>
              ) : (papers.data ?? []).map((p) => {
                const guard = canActivatePaper(p);
                return (
                  <div key={p.template_id} className="rounded-lg border border-border p-4 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={p.status === "active" ? "default" : p.status === "retired" ? "destructive" : "secondary"}>{p.status}</Badge>
                      <span className="font-medium">{p.template_key} v{p.version}</span>
                      <Badge variant="outline">{p.question_count} questions</Badge>
                      <Badge variant="outline">{p.total_marks} marks</Badge>
                      <Badge variant="outline">{p.attempts} attempts</Badge>
                      {p.blueprint_version && <Badge variant="outline">blueprint v{p.blueprint_version}</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">{p.title}</p>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" data-analytics="none"
                        onClick={() => setOpenPaper(openPaper === p.template_id ? null : p.template_id)}>
                        {openPaper === p.template_id ? "Hide questions" : "View questions"}
                      </Button>
                      {p.status === "draft" && (
                        <Button size="sm" data-analytics="none"
                          disabled={!guard.allowed || activate.isPending}
                          onClick={() => activate.mutate(p.template_id)}>
                          <ShieldCheck className="mr-2 h-4 w-4" aria-hidden />Activate this version
                        </Button>
                      )}
                      {p.status === "active" && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <CheckCircle2 className="h-4 w-4" aria-hidden />Authoritative paper for this vacancy
                        </span>
                      )}
                    </div>
                    {p.status === "draft" && !guard.allowed && (
                      <p className="text-xs text-destructive" role="alert">{guard.reason}</p>
                    )}
                    {openPaper === p.template_id && (
                      <>
                        <Separator />
                        {detail.isLoading ? <Skeleton className="h-20 w-full" /> : (
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>#</TableHead><TableHead>Question</TableHead>
                                <TableHead>Competency</TableHead><TableHead>Difficulty</TableHead>
                                <TableHead>Marks</TableHead><TableHead>Min</TableHead><TableHead>Key</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {(detail.data?.items ?? []).map((i) => (
                                <TableRow key={i.item_id}>
                                  <TableCell className="whitespace-nowrap text-xs">{i.question_no ?? i.question_key} v{i.question_version}</TableCell>
                                  <TableCell className="max-w-[24rem] text-sm">{i.prompt}</TableCell>
                                  <TableCell className="text-sm">{i.competency_label}</TableCell>
                                  <TableCell className="text-sm">{difficultyLabel(i.difficulty)}</TableCell>
                                  <TableCell>{i.max_marks}</TableCell>
                                  <TableCell>{i.critical_min ?? "—"}</TableCell>
                                  <TableCell>{i.has_answer_key ? "auto" : "rubric"}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">6 · Issue to candidates</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {applications.isLoading ? <Skeleton className="h-20 w-full" /> : (applications.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No applications on this vacancy yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Application</TableHead><TableHead>Candidate</TableHead>
                      <TableHead>Stage</TableHead><TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(applications.data ?? []).map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="text-xs">{a.application_no}</TableCell>
                        <TableCell>{a.candidate?.full_name ?? "—"}</TableCell>
                        <TableCell>{a.stage}</TableCell>
                        <TableCell className="space-x-2 text-right">
                          <Button size="sm" variant="outline" asChild data-analytics="none">
                            <Link to={`/staff/recruitment/applications/${a.id}`}>Open record</Link>
                          </Button>
                          <Button size="sm" data-analytics="none"
                            disabled={issue.isPending}
                            onClick={() => issue.mutate(a.id)}>
                            <Send className="mr-2 h-4 w-4" aria-hidden />Issue assessment
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
