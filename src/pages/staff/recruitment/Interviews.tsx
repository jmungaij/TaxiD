import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, ClipboardCheck, Users } from "lucide-react";
import { toast } from "sonner";

import { StaffPageHeader } from "@/components/staff/primitives";
import { InterviewScheduleDialog } from "@/components/staff/recruitment/InterviewScheduleDialog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

import * as rec from "@/lib/recruitment/api";
import { titleise } from "@/lib/recruitment/types";
import {
  SCORE_DEFAULT,
  SCORE_SCALE_LABEL,
  normalizeScore,
  scoreInputProps,
} from "@/lib/recruitment/scoreScale";

import type { RecInterview } from "@/lib/recruitment/types";

/** Statuses that still allow operational action. */
const LIVE = ["draft", "scheduled", "invited", "confirmed", "reschedule_requested", "rescheduled", "in_progress"];

/**
 * Interview operations: the scheduled conversation, the panel, the candidate's
 * confirmation, and the structured scorecard that turns it into a defensible
 * decision. Every state change is a server-side transition, so illegal moves are
 * rejected by the database rather than hidden by the interface.
 */
export default function RecruitmentInterviews() {
  const qc = useQueryClient();
  const [evaluating, setEvaluating] = useState<RecInterview | null>(null);
  const [rescheduling, setRescheduling] = useState<RecInterview | null>(null);
  const [closing, setClosing] = useState<{ interview: RecInterview; status: "cancelled" | "no_show" } | null>(null);
  const [closeReason, setCloseReason] = useState("");

  const interviews = useQuery({ queryKey: ["rec", "interviews"], queryFn: rec.listInterviews });
  const vacancies = useQuery({ queryKey: ["rec", "vacancies"], queryFn: rec.listVacancies });
  const panel = useQuery({ queryKey: ["rec", "panel"], queryFn: rec.listInterviewPanel });
  const staff = useQuery({ queryKey: ["rec", "panel-staff"], queryFn: rec.listPanelStaff });

  const titleFor = (id: string) => (vacancies.data ?? []).find((v) => v.id === id)?.title ?? "—";
  const staffName = (id: string) => (staff.data ?? []).find((s) => s.id === id)?.full_name ?? "Panellist";
  const panelFor = useMemo(
    () => (id: string) => (panel.data ?? []).filter((p) => p.interview_id === id),
    [panel.data],
  );

  const invalidate = () => qc.invalidateQueries({ queryKey: ["rec"] });

  const transition = useMutation({
    mutationFn: ({ id, status, reason }: { id: string; status: string; reason?: string }) =>
      rec.setInterviewStatus(id, status, reason),
    onSuccess: () => { toast.success("Interview updated"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const respond = useMutation({
    mutationFn: ({ id, response }: { id: string; response: "confirmed" | "reschedule_requested" | "declined" }) =>
      rec.recordCandidateResponse(id, response),
    onSuccess: () => { toast.success("Candidate response recorded"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const closeOut = useMutation({
    mutationFn: () => {
      if (!closing) throw new Error("Nothing selected.");
      if (!closeReason.trim()) throw new Error("A reason is required.");
      return rec.setInterviewStatus(closing.interview.id, closing.status, closeReason.trim());
    },
    onSuccess: () => {
      toast.success("Interview closed and audited");
      setClosing(null);
      setCloseReason("");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const evaluate = useMutation({
    mutationFn: rec.submitEvaluation,
    onSuccess: () => { toast.success("Scorecard submitted"); setEvaluating(null); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-6 lg:p-8">
      <StaffPageHeader
        eyebrow="Recruitment 360"
        title="Interviews and evaluations"
        lede="Scheduled conversations, panels, candidate confirmations and the structured scorecards that turn them into defensible decisions."
      />

      <Card>
        <CardContent className="p-0">
          {interviews.isLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
            </div>
          ) : interviews.error ? (
            <p className="p-6 text-sm text-destructive">
              Interviews could not be loaded: {(interviews.error as Error).message}
            </p>
          ) : (interviews.data ?? []).length === 0 ? (
            <div className="p-10 text-center">
              <CalendarClock className="h-6 w-6 mx-auto text-muted-foreground" aria-hidden="true" />
              <p className="mt-3 text-sm font-medium">No interviews scheduled</p>
              <p className="text-sm text-muted-foreground mt-1">
                Approve a shortlisted candidate in Shortlisting, then schedule the first conversation from there.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Panel</TableHead>
                  <TableHead>Candidate</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(interviews.data ?? []).map((i) => {
                  const members = panelFor(i.id);
                  const live = LIVE.includes(i.status);
                  return (
                    <TableRow key={i.id}>
                      <TableCell className="text-sm">
                        {i.scheduled_at ? new Date(i.scheduled_at).toLocaleString() : "Unscheduled"}
                        <p className="text-xs text-muted-foreground">
                          {i.duration_minutes} min · {i.timezone ?? "Africa/Nairobi"}
                          {i.reschedule_count ? ` · rescheduled ${i.reschedule_count}×` : ""}
                        </p>
                      </TableCell>
                      <TableCell className="text-sm">{titleFor(i.vacancy_id)}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{titleise(i.interview_stage)}</Badge>
                        <p className="mt-1 text-xs text-muted-foreground">{titleise(i.mode)}</p>
                      </TableCell>
                      <TableCell className="text-sm">
                        {members.length === 0 ? (
                          <span className="text-muted-foreground">No panel</span>
                        ) : (
                          <span className="flex items-center gap-1.5">
                            <Users className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                            {members.map((m) => staffName(m.staff_id)).join(", ")}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {i.candidate_response ? (
                          <Badge variant="outline">{titleise(i.candidate_response)}</Badge>
                        ) : live ? (
                          <div className="flex gap-1">
                            <Button size="sm" variant="ghost"
                              onClick={() => respond.mutate({ id: i.id, response: "confirmed" })}>
                              Confirmed
                            </Button>
                            <Button size="sm" variant="ghost"
                              onClick={() => respond.mutate({ id: i.id, response: "reschedule_requested" })}>
                              Wants new time
                            </Button>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell><Badge variant="outline">{titleise(i.status)}</Badge></TableCell>
                      <TableCell className="text-right space-x-1">
                        {["scheduled", "invited", "confirmed", "rescheduled"].includes(i.status) && (
                          <Button size="sm" variant="ghost"
                            onClick={() => transition.mutate({ id: i.id, status: "in_progress" })}>
                            Start
                          </Button>
                        )}
                        {i.status === "in_progress" && (
                          <Button size="sm" variant="ghost"
                            onClick={() => transition.mutate({ id: i.id, status: "completed" })}>
                            Mark held
                          </Button>
                        )}
                        {live && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => setRescheduling(i)}>
                              Reschedule
                            </Button>
                            <Button size="sm" variant="ghost"
                              onClick={() => setClosing({ interview: i, status: "no_show" })}>
                              No show
                            </Button>
                            <Button size="sm" variant="ghost" className="text-destructive"
                              onClick={() => setClosing({ interview: i, status: "cancelled" })}>
                              Cancel
                            </Button>
                          </>
                        )}
                        <Button size="sm" variant="outline" onClick={() => setEvaluating(i)}>
                          <ClipboardCheck className="h-4 w-4 mr-1" aria-hidden="true" />Scorecard
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

      <InterviewScheduleDialog
        open={!!rescheduling}
        onOpenChange={(o) => !o && setRescheduling(null)}
        interview={rescheduling}
        candidateLabel={rescheduling ? titleFor(rescheduling.vacancy_id) : undefined}
      />

      <Dialog open={!!closing} onOpenChange={(o) => { if (!o) { setClosing(null); setCloseReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{closing?.status === "no_show" ? "Record a no-show" : "Cancel interview"}</DialogTitle>
            <DialogDescription>
              A reason is mandatory — it is stored on the interview and in the audit trail.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="iv-close-reason">Reason</Label>
            <Textarea id="iv-close-reason" rows={3} value={closeReason}
              onChange={(e) => setCloseReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setClosing(null)}>Back</Button>
            <Button onClick={() => closeOut.mutate()} disabled={closeOut.isPending}>
              {closeOut.isPending ? "Saving…" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!evaluating} onOpenChange={(o) => !o && setEvaluating(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Interview scorecard</DialogTitle>
            <DialogDescription>
              Evidence-based feedback. Record what you observed, not only your conclusion.
            </DialogDescription>
          </DialogHeader>
          {evaluating && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                let score: number | undefined;
                try {
                  // Canonical 1–5 scale, shared with the Evaluations surface.
                  score = normalizeScore(f.get("score"));
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Invalid score");
                  return;
                }
                evaluate.mutate({
                  interview_id: evaluating.id,
                  application_id: evaluating.application_id,
                  overall_score: score,
                  recommendation: String(f.get("recommendation") ?? "advance"),
                  strengths: String(f.get("strengths") ?? "") || undefined,
                  concerns: String(f.get("concerns") ?? "") || undefined,
                  comments: String(f.get("evidence") ?? "") || undefined,
                });
              }}
              className="space-y-4"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="score">Overall score ({SCORE_SCALE_LABEL})</Label>
                  <Input id="score" name="score" {...scoreInputProps} defaultValue={SCORE_DEFAULT} />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="recommendation">Recommendation</Label>
                  <Select name="recommendation" defaultValue="advance">
                    <SelectTrigger id="recommendation"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="advance">Advance</SelectItem>
                      <SelectItem value="hold">Hold</SelectItem>
                      <SelectItem value="reject">Reject</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="strengths">Strengths</Label>
                <Textarea id="strengths" name="strengths" rows={2} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="concerns">Concerns</Label>
                <Textarea id="concerns" name="concerns" rows={2} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="evidence">Evidence observed</Label>
                <Textarea id="evidence" name="evidence" rows={3}
                  placeholder="Specific examples, answers and artefacts from the conversation." />
              </div>
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setEvaluating(null)}>Cancel</Button>
                <Button type="submit" disabled={evaluate.isPending}>
                  {evaluate.isPending ? "Submitting…" : "Submit scorecard"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
