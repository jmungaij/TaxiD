import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Sparkles, CheckCircle2, XCircle, CalendarPlus, FileText, Users } from "lucide-react";
import { toast } from "sonner";

import { StaffPageHeader } from "@/components/staff/primitives";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

import * as rec from "@/lib/recruitment/api";
import CandidateDocumentsPanel from "@/components/recruitment/CandidateDocumentsPanel";
import DocumentReadinessBadge from "@/components/recruitment/DocumentReadinessBadge";
import { screeningDocumentGate } from "@/lib/recruitment/documentControl";
import { sendInterviewInvitation } from "@/lib/recruitment/invitations";
import { matchCandidate, rankByScoreThenWait, type MatchResult } from "@/lib/recruitment/matching";
import { APPLICATION_STAGES, STAGE_LABEL, STAGE_TONE, daysSince, titleise } from "@/lib/recruitment/types";
import type { RecApplication } from "@/lib/recruitment/types";

/**
 * Applicant pipeline — a stage board for one vacancy with explainable matching.
 * The AI suggestion and the recruiter's decision are recorded separately, and
 * the decision is what moves the candidate.
 */
export default function RecruitmentPipeline() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const vacancyId = params.get("vacancy") ?? "";
  const [screening, setScreening] = useState<RecApplication | null>(null);
  const [scheduling, setScheduling] = useState<RecApplication | null>(null);
  const [docsFor, setDocsFor] = useState<RecApplication | null>(null);

  const vacancies = useQuery({ queryKey: ["rec", "vacancies"], queryFn: rec.listVacancies });
  const candidates = useQuery({ queryKey: ["rec", "candidates"], queryFn: rec.listCandidates });
  const applications = useQuery({
    queryKey: ["rec", "applications", vacancyId],
    queryFn: () => rec.listApplications(vacancyId || undefined),
  });

  const vacancy = (vacancies.data ?? []).find((v) => v.id === vacancyId) ?? null;
  const candidateById = useMemo(
    () => new Map((candidates.data ?? []).map((c) => [c.id, c])),
    [candidates.data],
  );

  const matchFor = (app: RecApplication): MatchResult | null => {
    const candidate = candidateById.get(app.candidate_id);
    if (!candidate || !vacancy) return null;
    return matchCandidate({
      candidate,
      candidateSkills: [],
      candidateQualifications: [],
      vacancy,
    });
  };

  const byStage = useMemo(() => {
    const rows = (applications.data ?? []).filter((a) => a.status === "active");
    const map = new Map<string, RecApplication[]>();
    for (const stage of APPLICATION_STAGES) {
      map.set(stage, rankByScoreThenWait(rows.filter((a) => a.stage === stage)));
    }
    return map;
  }, [applications.data]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["rec", "applications"] });
    qc.invalidateQueries({ queryKey: ["rec", "interviews"] });
  };

  /** Stages that require the document policy to be satisfied first. */
  const GATED_STAGES = ["shortlisted", "assessment", "interview", "evaluation", "offer"];

  const move = useMutation({
    mutationFn: async ({ id, stage, reason }: { id: string; stage: string; reason?: string }) => {
      if (GATED_STAGES.includes(stage)) {
        const gate = await screeningDocumentGate(id);
        if (!gate.allowed) {
          throw new Error(
            `Screening blocked — mandatory candidate documentation incomplete. Outstanding: ${
              gate.outstanding.length ? gate.outstanding.join(", ") : "document rejected or replacement requested"
            }`,
          );
        }
      }
      return rec.moveApplicationStage(id, stage, { reason });
    },
    onSuccess: () => { toast.success("Stage updated"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const screen = useMutation({
    mutationFn: rec.recordScreening,
    onSuccess: () => { toast.success("Screening decision recorded"); setScreening(null); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const schedule = useMutation({
    mutationFn: async (input: Parameters<typeof rec.scheduleInterview>[0]) => {
      const created = await rec.scheduleInterview(input);
      // Booking the slot and inviting the candidate are one action for a
      // recruiter, but the invitation is reported separately: a provider refusal
      // must never read as "invitation sent".
      try {
        const sent = await sendInterviewInvitation(created.interview_id);
        return { invited: true, note: `Calendar invitation sent to ${sent.to}.` };
      } catch (e) {
        return { invited: false, note: e instanceof Error ? e.message : "The invitation was not delivered." };
      }
    },
    onSuccess: (r) => {
      if (r.invited) toast.success(`Interview scheduled — ${r.note}`);
      else toast.warning(`Interview scheduled, but no invitation went out: ${r.note}`);
      setScheduling(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-6 lg:p-8">
      <StaffPageHeader
        eyebrow="Recruitment 360"
        title="Applicant pipeline"
        lede="One board per vacancy. Suggested ranking is explainable; every advance or rejection is your decision and is written to the trail."
        actions={
          <Select
            value={vacancyId}
            onValueChange={(v) => setParams(v ? { vacancy: v } : {})}
          >
            <SelectTrigger className="w-[280px]" aria-label="Select vacancy">
              <SelectValue placeholder="Select a vacancy" />
            </SelectTrigger>
            <SelectContent>
              {(vacancies.data ?? []).map((v) => (
                <SelectItem key={v.id} value={v.id}>{v.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      {!vacancyId ? (
        <Card>
          <CardContent className="p-10 text-center">
            <Users className="h-6 w-6 mx-auto text-muted-foreground" aria-hidden="true" />
            <p className="mt-3 text-sm font-medium">Choose a vacancy to open its pipeline</p>
            <p className="text-sm text-muted-foreground mt-1">
              The board shows applications by stage with the longest-waiting candidate first.
            </p>
          </CardContent>
        </Card>
      ) : applications.isLoading ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-64" />)}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {APPLICATION_STAGES.filter((s) => (byStage.get(s) ?? []).length > 0 || ["applied", "screening", "shortlisted", "interview"].includes(s)).map((stage) => {
            const rows = byStage.get(stage) ?? [];
            return (
              <Card key={stage}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center justify-between">
                    <span>{STAGE_LABEL[stage]}</span>
                    <Badge variant="outline" className={STAGE_TONE[stage]}>{rows.length}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {rows.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Empty.</p>
                  ) : (
                    rows.map((a) => {
                      const candidate = candidateById.get(a.candidate_id);
                      const m = matchFor(a);
                      return (
                        <div key={a.id} className="rounded-md border border-border p-3 space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate">{candidate?.full_name ?? a.application_no}</p>
                              <p className="text-xs text-muted-foreground truncate">
                                {candidate?.current_title ?? a.application_no} · {daysSince(a.stage_entered_at)}d in stage
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-1.5">
                              <DocumentReadinessBadge applicationId={a.id} />
                              {m && (
                                <Badge variant="outline" className="gap-1">
                                  <Sparkles className="h-3 w-3" aria-hidden="true" />{m.score}
                                </Badge>
                              )}
                            </div>
                          </div>
                          {m && (
                            <details className="text-xs text-muted-foreground">
                              <summary className="cursor-pointer">Why this score</summary>
                              <ul className="mt-1 space-y-0.5">
                                {m.factors.map((f) => (
                                  <li key={f.label}>
                                    <span className="font-medium text-foreground">{f.label}</span>: {f.earned}/{f.weight} — {f.evidence}
                                  </li>
                                ))}
                              </ul>
                            </details>
                          )}
                          <div className="flex flex-wrap gap-1.5">
                            <Button size="sm" variant="ghost" onClick={() => setDocsFor(a)}>
                              <FileText className="h-3.5 w-3.5 mr-1" aria-hidden="true" />Documents
                            </Button>
                            {stage === "applied" || stage === "screening" ? (
                              <Button size="sm" variant="outline" onClick={() => setScreening(a)}>Screen</Button>
                            ) : null}
                            {stage === "shortlisted" ? (
                              <Button size="sm" variant="outline" onClick={() => setScheduling(a)}>
                                <CalendarPlus className="h-3.5 w-3.5 mr-1" aria-hidden="true" />Interview
                              </Button>
                            ) : null}
                            {stage === "interview" || stage === "evaluation" ? (
                              <Button size="sm" variant="outline" onClick={() => move.mutate({ id: a.id, stage: "offer" })}>
                                <CheckCircle2 className="h-3.5 w-3.5 mr-1" aria-hidden="true" />To offer
                              </Button>
                            ) : null}
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive"
                              onClick={() => move.mutate({ id: a.id, stage: "rejected", reason: "Not progressed" })}
                            >
                              <XCircle className="h-3.5 w-3.5 mr-1" aria-hidden="true" />Reject
                            </Button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Candidate documents */}
      <Dialog open={!!docsFor} onOpenChange={(o) => !o && setDocsFor(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Candidate documents</DialogTitle>
            <DialogDescription>
              Private recruitment records. Views and downloads are logged against your account.
            </DialogDescription>
          </DialogHeader>
          {docsFor ? (
            <CandidateDocumentsPanel
              applicationId={docsFor.id}
              candidateName={candidateById.get(docsFor.candidate_id)?.full_name ?? docsFor.application_no}
              vacancyTitle={vacancy?.title ?? null}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Screening decision */}
      <Dialog open={!!screening} onOpenChange={(o) => !o && setScreening(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record screening decision</DialogTitle>
            <DialogDescription>
              The suggestion is advisory. Your decision is what moves the candidate and is stored against your name.
            </DialogDescription>
          </DialogHeader>
          {screening && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const m = matchFor(screening);
                screen.mutate({
                  application_id: screening.id,
                  human_decision: String(f.get("decision")) as "advance" | "reject" | "hold",
                  human_score: Number(f.get("score")) || undefined,
                  decision_notes: String(f.get("notes") ?? "") || undefined,
                  ai_score: m?.score,
                  ai_recommendation: m?.recommendation,
                  ai_rationale: m?.factors.map((x) => `${x.label}: ${x.evidence}`).join(" | "),
                  ai_evidence: m?.factors ?? [],
                });
              }}
              className="space-y-4"
            >
              <div className="space-y-1.5">
                <Label htmlFor="decision">Decision</Label>
                <Select name="decision" defaultValue="advance">
                  <SelectTrigger id="decision"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="advance">Advance to shortlist</SelectItem>
                    <SelectItem value="hold">Hold</SelectItem>
                    <SelectItem value="reject">Reject</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="score">Your score (0–100)</Label>
                <Input id="score" name="score" type="number" min={0} max={100} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="notes">Notes</Label>
                <Textarea id="notes" name="notes" rows={3} />
              </div>
              <DialogFooter>
                <Button type="submit" disabled={screen.isPending}>
                  {screen.isPending ? "Saving…" : "Save decision"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Interview scheduling */}
      <Dialog open={!!scheduling} onOpenChange={(o) => !o && setScheduling(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Schedule interview</DialogTitle>
            <DialogDescription>Scheduling moves the application into the interview stage.</DialogDescription>
          </DialogHeader>
          {scheduling && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                schedule.mutate({
                  application_id: scheduling.id,
                  vacancy_id: scheduling.vacancy_id,
                  interview_stage: String(f.get("interview_stage") ?? "first"),
                  mode: String(f.get("mode") ?? "virtual"),
                  scheduled_at: new Date(String(f.get("scheduled_at"))).toISOString(),
                  duration_minutes: Number(f.get("duration") ?? 45),
                  meeting_link: String(f.get("link") ?? "") || null,
                  instructions: String(f.get("instructions") ?? "") || null,
                } as never);
              }}
              className="space-y-4"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="interview_stage">Stage</Label>
                  <Select name="interview_stage" defaultValue="first">
                    <SelectTrigger id="interview_stage"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["screening_call", "first", "technical", "panel", "final"].map((s) => (
                        <SelectItem key={s} value={s}>{titleise(s)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="mode">Mode</Label>
                  <Select name="mode" defaultValue="virtual">
                    <SelectTrigger id="mode"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["virtual", "onsite", "phone"].map((s) => (
                        <SelectItem key={s} value={s}>{titleise(s)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="scheduled_at">Date and time</Label>
                  <Input id="scheduled_at" name="scheduled_at" type="datetime-local" required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="duration">Duration (minutes)</Label>
                  <Input id="duration" name="duration" type="number" defaultValue={45} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="link">Meeting link</Label>
                <Input id="link" name="link" placeholder="https://" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="instructions">Instructions for the candidate</Label>
                <Textarea id="instructions" name="instructions" rows={3} />
              </div>
              <DialogFooter>
                <Button type="submit" disabled={schedule.isPending}>
                  {schedule.isPending ? "Scheduling…" : "Schedule"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
