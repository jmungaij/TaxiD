import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CheckCircle2, FileText, PauseCircle, XCircle, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { StaffPageHeader } from "@/components/staff/primitives";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

import * as rec from "@/lib/recruitment/api";
import CandidateDocumentsPanel from "@/components/recruitment/CandidateDocumentsPanel";
import { screeningDocumentGate } from "@/lib/recruitment/documentControl";
import { STAGE_LABEL, STAGE_TONE, daysSince, titleise, type RecApplication } from "@/lib/recruitment/types";

type Decision = "advance" | "hold" | "reject";

/**
 * Screening — the first governed decision on an application.
 *
 * A decision writes a screening record, moves the application stage, and writes
 * the audit event through one code path, so the trail and the pipeline can never
 * disagree.
 */
export default function RecruitmentScreening() {
  const qc = useQueryClient();
  const applications = useQuery({ queryKey: ["rec", "applications"], queryFn: () => rec.listApplications() });
  const candidates = useQuery({ queryKey: ["rec", "candidates"], queryFn: rec.listCandidates });
  const vacancies = useQuery({ queryKey: ["rec", "vacancies"], queryFn: rec.listVacancies });
  const screenings = useQuery({ queryKey: ["rec", "screenings"], queryFn: () => rec.listScreenings() });

  const [target, setTarget] = useState<{ app: RecApplication; decision: Decision } | null>(null);
  const [notes, setNotes] = useState("");
  const [score, setScore] = useState("");
  const [docsFor, setDocsFor] = useState<RecApplication | null>(null);

  const candidateName = (id: string) =>
    (candidates.data ?? []).find((c) => c.id === id)?.full_name ?? "Candidate";
  const vacancyTitle = (id: string) =>
    (vacancies.data ?? []).find((v) => v.id === id)?.title ?? "Vacancy";

  const queue = useMemo(
    () =>
      (applications.data ?? [])
        .filter((a) => a.status === "active" && ["applied", "screening"].includes(a.stage))
        .sort(
          (a, b) =>
            (b.ai_match_score ?? 0) - (a.ai_match_score ?? 0) ||
            daysSince(b.stage_entered_at) - daysSince(a.stage_entered_at),
        ),
    [applications.data],
  );

  const decide = useMutation({
    mutationFn: async () => {
      if (!target) return;
      // Document policy gate: a candidate may not advance on incomplete or
      // rejected mandatory documentation. Awaiting human verification is not a
      // blocker; missing or rejected documents are.
      if (target.decision === "advance") {
        const gate = await screeningDocumentGate(target.app.id);
        if (!gate.allowed) {
          throw new Error(
            `Screening blocked — mandatory candidate documentation incomplete. Outstanding: ${
              gate.outstanding.length ? gate.outstanding.join(", ") : "document rejected or replacement requested"
            }`,
          );
        }
      }
      const parsed = Number(score);
      await rec.recordScreening({
        application_id: target.app.id,
        human_decision: target.decision,
        human_score: Number.isFinite(parsed) && score !== "" ? parsed : undefined,
        decision_notes: notes.trim() || undefined,
        ai_score: target.app.ai_match_score ?? undefined,
      });
    },
    onSuccess: () => {
      toast.success("Screening decision recorded and audited.");
      setTarget(null);
      setNotes("");
      setScore("");
      qc.invalidateQueries({ queryKey: ["rec"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const loading = applications.isLoading || candidates.isLoading || vacancies.isLoading;

  return (
    <div className="p-6 lg:p-8">
      <StaffPageHeader
        eyebrow="Recruitment 360"
        title="Screening"
        lede="Every application awaiting its first decision, ranked by match strength and waiting time. Each decision is recorded with a reason."
        actions={
          <Button variant="outline" asChild>
            <Link to="/staff/recruitment/shortlist">Go to shortlisting</Link>
          </Button>
        }
      />

      {loading ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
      ) : queue.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <ShieldCheck className="mx-auto h-8 w-8 text-success" aria-hidden="true" />
            <p className="mt-3 text-sm font-medium">No applications are waiting to be screened.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Publish a vacancy or import candidates and new applications will queue here.
            </p>
            <Button className="mt-4" variant="outline" asChild>
              <Link to="/staff/recruitment/vacancies">Open vacancies</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Screening queue ({queue.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {queue.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      {candidateName(a.candidate_id)} · {vacancyTitle(a.vacancy_id)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {a.application_no} · {titleise(a.source)} · {daysSince(a.stage_entered_at)} day(s) in stage
                      {a.ai_match_score != null ? ` · match ${Math.round(a.ai_match_score)}%` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={STAGE_TONE[a.stage]}>
                      {STAGE_LABEL[a.stage] ?? a.stage}
                    </Badge>
                    <Button size="sm" variant="outline" onClick={() => setDocsFor(a)}>
                      <FileText className="mr-1 h-4 w-4" aria-hidden="true" /> Documents
                    </Button>
                    <Button size="sm" onClick={() => setTarget({ app: a, decision: "advance" })}>
                      <CheckCircle2 className="mr-1 h-4 w-4" aria-hidden="true" /> Advance
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setTarget({ app: a, decision: "hold" })}>
                      <PauseCircle className="mr-1 h-4 w-4" aria-hidden="true" /> Hold
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setTarget({ app: a, decision: "reject" })}>
                      <XCircle className="mr-1 h-4 w-4 text-destructive" aria-hidden="true" /> Reject
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card className="mt-6">
        <CardHeader><CardTitle className="text-base">Recent screening decisions</CardTitle></CardHeader>
        <CardContent>
          {(screenings.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No screening decisions have been recorded yet.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {(screenings.data ?? []).slice(0, 12).map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="truncate">
                    {titleise(s.human_decision)} · {s.decision_notes ?? "no note"}
                  </span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {new Date(s.human_decision_at ?? s.created_at).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!docsFor} onOpenChange={(o) => !o && setDocsFor(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Candidate documents</DialogTitle>
            <DialogDescription>
              Submitted documents are private recruitment records. Views and downloads are logged.
            </DialogDescription>
          </DialogHeader>
          {docsFor ? (
            <CandidateDocumentsPanel
              applicationId={docsFor.id}
              candidateName={candidateName(docsFor.candidate_id)}
              vacancyTitle={vacancyTitle(docsFor.vacancy_id)}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {target?.decision === "advance" ? "Advance to shortlist" : target?.decision === "hold" ? "Hold this application" : "Reject this application"}
            </DialogTitle>
            <DialogDescription>
              The decision, its reason and the stage change are written together to the recruitment audit trail.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="screen-score">Assessor score (optional, 0–100)</Label>
              <Input
                id="screen-score"
                inputMode="numeric"
                value={score}
                onChange={(e) => setScore(e.target.value)}
                placeholder="e.g. 72"
              />
            </div>
            <div>
              <Label htmlFor="screen-notes">Reason</Label>
              <Textarea
                id="screen-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="What in the application drove this decision?"
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTarget(null)}>Cancel</Button>
            <Button onClick={() => decide.mutate()} disabled={decide.isPending}>
              {decide.isPending ? "Recording…" : "Record decision"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
