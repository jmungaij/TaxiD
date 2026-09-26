import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardCheck, Gavel, Lock, ShieldCheck, XCircle } from "lucide-react";
import { toast } from "sonner";

import { StaffPageHeader } from "@/components/staff/primitives";
import PaperAssessmentPanel from "@/components/recruitment/PaperAssessmentPanel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

import * as rec from "@/lib/recruitment/api";
import { titleise, type RecApplication, type RecInterview } from "@/lib/recruitment/types";
import {
  SCORE_SCALE_LABEL,
  averageScore,
  normalizeScore,
  scoreInputProps,
} from "@/lib/recruitment/scoreScale";


/**
 * Assessment → panel review → final selection.
 *
 * Assessments are submitted against a completed interview. The panel review
 * aggregates every submitted assessment and LOCKS that evidence before any
 * decision is recorded, and the final selection is only reachable once the
 * panel has recommended advancing. All three steps are server-governed.
 */
export default function RecruitmentEvaluations() {
  const qc = useQueryClient();
  const interviews = useQuery({ queryKey: ["rec", "interviews"], queryFn: rec.listInterviews });
  const applications = useQuery({ queryKey: ["rec", "applications"], queryFn: () => rec.listApplications() });
  const candidates = useQuery({ queryKey: ["rec", "candidates"], queryFn: rec.listCandidates });
  const evaluations = useQuery({ queryKey: ["rec", "evaluations"], queryFn: () => rec.listEvaluations() });
  const reasons = useQuery({ queryKey: ["rec", "rejection-reasons"], queryFn: rec.listRejectionReasons });

  const [scorecard, setScorecard] = useState<RecInterview | null>(null);
  const [form, setForm] = useState({ score: "", recommendation: "advance", strengths: "", concerns: "", comments: "" });

  const [reviewing, setReviewing] = useState<RecApplication | null>(null);
  const [panelForm, setPanelForm] = useState({ decision: "advance", notes: "", reason_code: "" });
  const [selecting, setSelecting] = useState<{ app: RecApplication; decision: "selected" | "not_selected" } | null>(null);
  const [selectForm, setSelectForm] = useState({ notes: "", reason_code: "" });

  const candidateName = (id: string) =>
    (candidates.data ?? []).find((c) => c.id === id)?.full_name ?? "Candidate";
  const appById = (id: string) => (applications.data ?? []).find((a) => a.id === id);

  const completed = useMemo(
    () => (interviews.data ?? []).filter((i) => i.status === "completed"),
    [interviews.data],
  );
  const atEvaluation = useMemo(
    () => (applications.data ?? []).filter((a) => a.status === "active" && a.stage === "evaluation"),
    [applications.data],
  );

  const summary = useQuery({
    queryKey: ["rec", "panel-summary", reviewing?.id],
    queryFn: () => rec.panelReviewSummary(reviewing!.id),
    enabled: !!reviewing,
  });

  useEffect(() => {
    if (summary.data?.review?.status === "locked") {
      setPanelForm((f) => ({ ...f, decision: f.decision || "advance" }));
    }
  }, [summary.data?.review?.status]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["rec"] });

  const submit = useMutation({
    mutationFn: async () => {
      if (!scorecard) throw new Error("No interview selected.");
      // Canonical scorecard scale is 1–5 (shared with the Interviews surface) so
      // panel averages stay coherent across both entry points.
      const score = normalizeScore(form.score);
      await rec.submitEvaluation({
        interview_id: scorecard.id,
        application_id: scorecard.application_id,
        overall_score: score,

        recommendation: form.recommendation,
        strengths: form.strengths.trim() || undefined,
        concerns: form.concerns.trim() || undefined,
        comments: form.comments.trim() || undefined,
      });
    },

    onSuccess: () => {
      toast.success("Assessment recorded. The application is at Evaluation, ready for panel review.");
      setScorecard(null);
      setForm({ score: "", recommendation: "advance", strengths: "", concerns: "", comments: "" });
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const openPanel = useMutation({
    mutationFn: (applicationId: string) => rec.openPanelReview(applicationId),
    onSuccess: () => {
      toast.success("Assessment evidence locked. The panel can now decide.");
      summary.refetch();
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const decidePanel = useMutation({
    mutationFn: () => {
      const reviewId = summary.data?.review?.id;
      if (!reviewId) throw new Error("Open the panel review first.");
      return rec.decidePanelReview({
        review_id: reviewId,
        decision: panelForm.decision as "advance" | "hold" | "reject",
        notes: panelForm.notes.trim() || undefined,
        reason_code: panelForm.reason_code || null,
      });
    },
    onSuccess: () => {
      toast.success("Panel decision recorded against the locked evidence.");
      setPanelForm({ decision: "advance", notes: "", reason_code: "" });
      summary.refetch();
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const finalise = useMutation({
    mutationFn: () => {
      if (!selecting) throw new Error("No candidate selected.");
      return rec.recordFinalSelection({
        application_id: selecting.app.id,
        decision: selecting.decision,
        reason_code: selecting.decision === "not_selected" ? selectForm.reason_code || null : null,
        notes: selectForm.notes.trim() || undefined,
      });
    },
    onSuccess: () => {
      toast.success("Final selection decision recorded and audited.");
      setSelecting(null);
      setSelectForm({ notes: "", reason_code: "" });
      summary.refetch();
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const loading = interviews.isLoading || applications.isLoading;
  const review = summary.data?.review ?? null;

  return (
    <div className="p-6 lg:p-8">
      <StaffPageHeader
        eyebrow="Recruitment 360"
        title="Assessment & panel review"
        lede="Structured assessments, a panel review over locked evidence, and the authorised final selection decision."
      />

      {loading ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <ClipboardCheck className="h-4 w-4" aria-hidden="true" /> Assessments outstanding ({completed.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {completed.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No completed interviews are waiting for an assessment. Mark an interview complete on the Interviews page.
                </p>
              ) : (
                completed.map((i) => {
                  const app = appById(i.application_id);
                  const submitted = (evaluations.data ?? []).some((e) => e.interview_id === i.id);
                  return (
                    <div key={i.id} className="flex items-center justify-between gap-2 rounded-md border p-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {app ? candidateName(app.candidate_id) : "Candidate"} · {titleise(i.interview_stage)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {i.scheduled_at ? new Date(i.scheduled_at).toLocaleString() : "unscheduled"}
                          {submitted ? " · assessment on file" : ""}
                        </p>
                      </div>
                      <Button size="sm" variant={submitted ? "outline" : "default"} onClick={() => setScorecard(i)}>
                        {submitted ? "Add assessment" : "Submit assessment"}
                      </Button>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Gavel className="h-4 w-4" aria-hidden="true" /> Awaiting panel review ({atEvaluation.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {atEvaluation.length === 0 ? (
                <p className="text-sm text-muted-foreground">No candidates are sitting at evaluation stage.</p>
              ) : (
                atEvaluation.map((a) => {
                  const evals = (evaluations.data ?? []).filter((e) => e.application_id === a.id);
                  const avg = averageScore(evals.map((e) => e.overall_score));

                  return (
                    <div key={a.id} className="flex items-center justify-between gap-2 rounded-md border p-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{candidateName(a.candidate_id)}</p>
                        <p className="text-xs text-muted-foreground">
                          {evals.length} assessment(s){avg != null ? ` · panel average ${avg}` : ""}
                        </p>
                      </div>
                      <Button size="sm" onClick={() => setReviewing(a)}>Open panel review</Button>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <PaperAssessmentPanel candidateName={candidateName} />


      {/* ----------------------------- assessment ---------------------------- */}
      <Dialog open={!!scorecard} onOpenChange={(o) => !o && setScorecard(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Interview assessment</DialogTitle>
            <DialogDescription>
              Evidence-based feedback. Submitting completes the interview and moves the application to evaluation.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="eval-score">Overall score ({SCORE_SCALE_LABEL})</Label>
                <Input id="eval-score" {...scoreInputProps} value={form.score}
                  onChange={(e) => setForm({ ...form, score: e.target.value })} />


              </div>
              <div>
                <Label htmlFor="eval-rec">Recommendation</Label>
                <select
                  id="eval-rec"
                  className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={form.recommendation}
                  onChange={(e) => setForm({ ...form, recommendation: e.target.value })}
                >
                  <option value="advance">Advance</option>
                  <option value="hold">Hold</option>
                  <option value="reject">Reject</option>
                </select>
              </div>
            </div>
            <div>
              <Label htmlFor="eval-strengths">Strengths</Label>
              <Textarea id="eval-strengths" rows={2} value={form.strengths}
                onChange={(e) => setForm({ ...form, strengths: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="eval-concerns">Concerns</Label>
              <Textarea id="eval-concerns" rows={2} value={form.concerns}
                onChange={(e) => setForm({ ...form, concerns: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="eval-evidence">Evidence observed</Label>
              <Textarea id="eval-evidence" rows={2} value={form.comments}
                onChange={(e) => setForm({ ...form, comments: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setScorecard(null)}>Cancel</Button>
            <Button onClick={() => submit.mutate()} disabled={submit.isPending}>
              {submit.isPending ? "Submitting…" : "Submit assessment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------------------------- panel review --------------------------- */}
      <Dialog open={!!reviewing} onOpenChange={(o) => !o && setReviewing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Panel review — {reviewing ? candidateName(reviewing.candidate_id) : ""}</DialogTitle>
            <DialogDescription>
              Aggregated assessments. Locking the evidence freezes what the panel decided on; the record cannot be
              altered afterwards.
            </DialogDescription>
          </DialogHeader>

          {summary.isLoading ? (
            <Skeleton className="h-32" />
          ) : summary.error ? (
            <p className="text-sm text-destructive">{(summary.error as Error).message}</p>
          ) : summary.data ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{summary.data.evaluation_count} assessment(s)</Badge>
                {summary.data.average_score != null && (
                  <Badge variant="outline">Average {summary.data.average_score}</Badge>
                )}
                {Object.entries(summary.data.recommendation_mix ?? {}).map(([k, v]) => (
                  <Badge key={k} variant="secondary">{titleise(k)} × {v}</Badge>
                ))}
                {review && (
                  <Badge variant={review.status === "decided" ? "default" : "outline"} className="ml-auto">
                    <Lock className="mr-1 h-3 w-3" aria-hidden="true" />
                    {review.status === "decided"
                      ? `Panel: ${titleise(review.panel_decision)}`
                      : "Evidence locked"}
                  </Badge>
                )}
              </div>

              <ul className="divide-y divide-border rounded-md border">
                {(summary.data.evaluations ?? []).map((e) => (
                  <li key={e.evaluation_id} className="p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">{titleise(e.interview_stage)}</p>
                      <div className="flex items-center gap-2">
                        {e.overall_score != null && <Badge variant="outline">{e.overall_score}</Badge>}
                        <Badge variant="secondary">{titleise(e.recommendation)}</Badge>
                      </div>
                    </div>
                    {e.strengths && <p className="mt-1 text-xs text-muted-foreground">Strengths: {e.strengths}</p>}
                    {e.concerns && <p className="text-xs text-muted-foreground">Concerns: {e.concerns}</p>}
                  </li>
                ))}
                {(summary.data.evaluations ?? []).length === 0 && (
                  <li className="p-3 text-sm text-muted-foreground">No submitted assessments yet.</li>
                )}
              </ul>

              {!review || review.status !== "decided" ? (
                <div className="space-y-3 rounded-md border p-3">
                  {!review ? (
                    <Button
                      onClick={() => reviewing && openPanel.mutate(reviewing.id)}
                      disabled={openPanel.isPending || summary.data.evaluation_count === 0}
                    >
                      <Lock className="mr-1 h-4 w-4" aria-hidden="true" />
                      {openPanel.isPending ? "Locking…" : "Lock evidence & open panel review"}
                    </Button>
                  ) : (
                    <>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <Label htmlFor="panel-decision">Panel decision</Label>
                          <select
                            id="panel-decision"
                            className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                            value={panelForm.decision}
                            onChange={(e) => setPanelForm({ ...panelForm, decision: e.target.value })}
                          >
                            <option value="advance">Advance to final selection</option>
                            <option value="hold">Hold</option>
                            <option value="reject">Reject</option>
                          </select>
                        </div>
                        {panelForm.decision === "reject" && (
                          <div>
                            <Label htmlFor="panel-reason">Reason code</Label>
                            <select
                              id="panel-reason"
                              className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                              value={panelForm.reason_code}
                              onChange={(e) => setPanelForm({ ...panelForm, reason_code: e.target.value })}
                            >
                              <option value="">Select a reason…</option>
                              {(reasons.data ?? []).map((r) => (
                                <option key={r.code} value={r.code}>{r.label}</option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                      <div>
                        <Label htmlFor="panel-notes">Panel notes</Label>
                        <Textarea id="panel-notes" rows={3} value={panelForm.notes}
                          onChange={(e) => setPanelForm({ ...panelForm, notes: e.target.value })}
                          placeholder="Summarise the panel's rationale against the evidence." />
                      </div>
                      <Button onClick={() => decidePanel.mutate()} disabled={decidePanel.isPending}>
                        {decidePanel.isPending ? "Recording…" : "Record panel decision"}
                      </Button>
                    </>
                  )}
                </div>
              ) : (
                <div className="space-y-3 rounded-md border p-3">
                  <p className="text-sm">
                    Panel decision: <strong>{titleise(review.panel_decision)}</strong>
                    {review.decision_notes ? ` — ${review.decision_notes}` : ""}
                  </p>
                  {review.panel_decision === "advance" && (
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => reviewing && setSelecting({ app: reviewing, decision: "selected" })}>
                        <ShieldCheck className="mr-1 h-4 w-4" aria-hidden="true" /> Select candidate
                      </Button>
                      <Button size="sm" variant="ghost"
                        onClick={() => reviewing && setSelecting({ app: reviewing, decision: "not_selected" })}>
                        <XCircle className="mr-1 h-4 w-4 text-destructive" aria-hidden="true" /> Not selected
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setReviewing(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --------------------------- final selection ------------------------- */}
      <Dialog open={!!selecting} onOpenChange={(o) => !o && setSelecting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selecting?.decision === "selected" ? "Confirm selection" : "Record non-selection"}
            </DialogTitle>
            <DialogDescription>
              The decision is recorded immutably against the locked panel evidence.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {selecting?.decision === "not_selected" && (
              <div>
                <Label htmlFor="final-reason">Reason code</Label>
                <select
                  id="final-reason"
                  className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={selectForm.reason_code}
                  onChange={(e) => setSelectForm({ ...selectForm, reason_code: e.target.value })}
                >
                  <option value="">Select a reason…</option>
                  {(reasons.data ?? []).map((r) => (
                    <option key={r.code} value={r.code}>{r.label}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <Label htmlFor="final-notes">Decision notes</Label>
              <Textarea id="final-notes" rows={3} value={selectForm.notes}
                onChange={(e) => setSelectForm({ ...selectForm, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSelecting(null)}>Cancel</Button>
            <Button onClick={() => finalise.mutate()} disabled={finalise.isPending}>
              {finalise.isPending ? "Recording…" : "Record decision"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
