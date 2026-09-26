/**
 * Consolidated HR application review — /staff/recruitment/applications/:applicationId
 *
 * One record per candidate: education evidence and gate history, industrial
 * attachment, document control state, and every profession assessment attempt
 * with its competency breakdown. Scoring is submitted through
 * `rec_profession_attempt_score`, which refuses to finalise while any answer is
 * unscored — the page never computes or displays a score it invented.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import {
  AlertTriangle, ArrowLeft, BadgeCheck, GraduationCap, History, Paperclip, ScrollText, Send, XCircle,
} from "lucide-react";

import { StaffPageHeader } from "@/components/staff/primitives";
import MandatoryRequirementsPanel from "@/components/staff/recruitment/MandatoryRequirementsPanel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  applicationReviewRecord, competencyAttainment, competencyGateFailed, attemptNextAction,
  difficultyLabel, type AttemptReview,
} from "@/lib/recruitment/assessmentBlueprint";
import { bandLabel, issueAttempt, scoreAttempt } from "@/lib/recruitment/professionAssessment";
import {
  reviewDocument, verificationLabel, verificationTone, type ReviewAction,
} from "@/lib/recruitment/documentControl";

const VERIFICATION_TONE: Record<string, string> = {
  success: "bg-success/10 text-success border-success/30",
  warning: "bg-warning/10 text-warning-foreground border-warning/30",
  destructive: "bg-destructive/10 text-destructive border-destructive/30",
  neutral: "bg-muted text-muted-foreground border-border",
};

/**
 * Reviewer disposition for one persisted document.
 *
 * Verification is an authority act, never a display state: the candidate can
 * only reach `uploaded`, and only an authorised reviewer produces `verified`
 * through `rec_document_review`, which records the decision in the document
 * event trail. Rejection and replacement always carry a reason.
 */
function DocumentVerificationActions({
  documentId, status, onDone,
}: { documentId: string; status: string | null; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<ReviewAction>("reject");
  const [reason, setReason] = useState("");

  const decide = useMutation({
    mutationFn: (input: { action: ReviewAction; reason?: string }) =>
      reviewDocument(documentId, input.action, input.reason ?? null),
    onSuccess: (r) => {
      toast.success(`Document ${r.verification_status.replace(/_/g, " ")}`);
      setOpen(false);
      setReason("");
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const settled = status === "verified" || status === "waived";

  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      <Button
        size="sm"
        variant="outline"
        disabled={settled || decide.isPending}
        onClick={() => decide.mutate({ action: "verify" })}
        data-analytics="none"
      >
        <BadgeCheck className="mr-1.5 h-3.5 w-3.5" aria-hidden />
        {status === "verified" ? "Verified" : "Verify"}
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={decide.isPending}
        onClick={() => { setAction("reject"); setOpen(true); }}
        data-analytics="none"
      >
        <XCircle className="mr-1.5 h-3.5 w-3.5" aria-hidden />Reject
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record a verification decision</DialogTitle>
            <DialogDescription>
              A reason is mandatory and is stored with the decision in the document audit trail.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={action === "reject" ? "default" : "outline"}
                onClick={() => setAction("reject")}
                data-analytics="none"
              >Reject</Button>
              <Button
                size="sm"
                variant={action === "request_replacement" ? "default" : "outline"}
                onClick={() => setAction("request_replacement")}
                data-analytics="none"
              >Request replacement</Button>
            </div>
            <div>
              <Label htmlFor={`reason-${documentId}`}>Reason</Label>
              <Textarea
                id={`reason-${documentId}`}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Illegible scan, wrong academic year, document does not correspond to candidate…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} data-analytics="none">Cancel</Button>
            <Button
              disabled={!reason.trim() || decide.isPending}
              onClick={() => decide.mutate({ action, reason: reason.trim() })}
              data-analytics="none"
            >Record decision</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type ScoreDraft = Record<string, { score: string; rationale: string }>;

function AttemptPanel({ attempt, onScored }: { attempt: AttemptReview; onScored: () => void }) {
  const [draft, setDraft] = useState<ScoreDraft>({});

  const payload = useMemo(() => Object.entries(draft)
    .filter(([, v]) => v.score !== "" && !Number.isNaN(Number(v.score)))
    .map(([question_key, v]) => ({ question_key, score: Number(v.score), rationale: v.rationale })), [draft]);

  const missingRationale = payload.some((p) => !p.rationale.trim());

  const save = useMutation({
    mutationFn: (finalise: boolean) => scoreAttempt(attempt.attempt_id, payload, finalise),
    onSuccess: (r) => {
      toast.success(r.status === "scored"
        ? `Finalised — ${r.total_score}/${r.max_score}${r.band ? ` (${bandLabel(r.band)})` : ""}`
        : `Saved ${payload.length} score(s) — ${r.unscored} still unscored`);
      setDraft({});
      onScored();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={attempt.status === "scored" ? "default" : "secondary"}>{attempt.status}</Badge>
        <span className="font-medium">{attempt.template_key} v{attempt.template_version}</span>
        <Badge variant="outline">attempt {attempt.attempt_no}</Badge>
        {attempt.total_score !== null && (
          <Badge variant="outline">{attempt.total_score}/{attempt.max_score} · {attempt.percentage ?? "—"}%</Badge>
        )}
        <Badge variant="outline">{bandLabel(attempt.band)}</Badge>
        {attempt.gates_passed === false && <Badge variant="destructive">critical gate failed</Badge>}
      </div>
      <p className="text-xs text-muted-foreground">{attemptNextAction(attempt)}</p>

      <div>
        <h4 className="mb-2 text-sm font-semibold">Competency breakdown</h4>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Competency</TableHead><TableHead>Questions</TableHead>
              <TableHead>Score</TableHead><TableHead>Attainment</TableHead><TableHead>Minimum</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {attempt.competency_breakdown.map((l) => (
              <TableRow key={l.competency_code}>
                <TableCell className="font-medium">{l.competency_label}</TableCell>
                <TableCell>{l.questions}{l.unscored > 0 ? ` (${l.unscored} unscored)` : ""}</TableCell>
                <TableCell>{l.score === null ? "Not scored" : `${l.score}/${l.max_marks}`}</TableCell>
                <TableCell>{competencyAttainment(l) === null ? "—" : `${competencyAttainment(l)}%`}</TableCell>
                <TableCell className={competencyGateFailed(l) ? "text-destructive" : undefined}>
                  {l.critical_min ?? "—"}{competencyGateFailed(l) ? " · below minimum" : ""}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Separator />

      <div className="space-y-4">
        <h4 className="text-sm font-semibold">Responses</h4>
        {attempt.responses.map((r) => (
          <div key={r.response_id} className="space-y-2 rounded-md border border-border/60 p-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{r.question_no ?? r.question_key}</span>
              <Badge variant="outline">{r.competency_label}</Badge>
              <Badge variant="outline">{difficultyLabel(r.difficulty)}</Badge>
              <Badge variant="outline">{r.max_marks} marks</Badge>
              <Badge variant="outline">{r.scoring_mode}</Badge>
              {r.critical_min !== null && <Badge variant="outline">min {r.critical_min}</Badge>}
            </div>
            <p className="text-sm font-medium">{r.prompt}</p>
            {r.expected_evidence && (
              <p className="text-xs text-muted-foreground">Expected evidence: {r.expected_evidence}</p>
            )}
            <p className="whitespace-pre-wrap rounded bg-muted/40 p-2 text-sm">
              {r.response_text?.trim()
                || (r.selected_options?.length ? r.selected_options.join(", ") : null)
                || (r.work_sample_document_id ? "Work sample uploaded (see Documents)" : "No response recorded")}
            </p>
            {r.score !== null ? (
              <p className="text-sm">
                Scored {r.score}/{r.max_marks}
                {r.rationale ? ` — ${r.rationale}` : ""}
              </p>
            ) : attempt.status === "submitted" && r.scoring_mode === "rubric" ? (
              <div className="grid gap-2 md:grid-cols-[8rem_1fr]">
                <div className="space-y-1">
                  <Label htmlFor={`s-${r.response_id}`} className="text-xs">Score (max {r.max_marks})</Label>
                  <Input id={`s-${r.response_id}`} type="number" min={0} max={r.max_marks}
                    value={draft[r.question_key]?.score ?? ""}
                    onChange={(e) => setDraft({
                      ...draft,
                      [r.question_key]: { score: e.target.value, rationale: draft[r.question_key]?.rationale ?? "" },
                    })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`r-${r.response_id}`} className="text-xs">Rationale (required)</Label>
                  <Textarea id={`r-${r.response_id}`} rows={2}
                    value={draft[r.question_key]?.rationale ?? ""}
                    onChange={(e) => setDraft({
                      ...draft,
                      [r.question_key]: { score: draft[r.question_key]?.score ?? "", rationale: e.target.value },
                    })} />
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                {r.auto_score !== null ? `Auto-marked ${r.auto_score}/${r.max_marks}` : "Awaiting candidate submission"}
              </p>
            )}
          </div>
        ))}
      </div>

      {attempt.status === "submitted" && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" data-analytics="none"
            disabled={payload.length === 0 || missingRationale || save.isPending}
            onClick={() => save.mutate(false)}>Save scores</Button>
          <Button size="sm" data-analytics="none"
            disabled={missingRationale || save.isPending}
            onClick={() => save.mutate(true)}>Finalise score</Button>
          {missingRationale && <p className="text-xs text-destructive">Every score needs a rationale.</p>}
        </div>
      )}
    </div>
  );
}

export default function RecruitmentApplicationReview() {
  const { applicationId = "" } = useParams();
  const qc = useQueryClient();
  const record = useQuery({
    queryKey: ["rec", "application-review", applicationId],
    queryFn: () => applicationReviewRecord(applicationId),
    enabled: !!applicationId,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["rec", "application-review", applicationId] });

  const issue = useMutation({
    mutationFn: () => issueAttempt(applicationId),
    onSuccess: (r) => {
      void navigator.clipboard?.writeText(`${window.location.origin}/recruitment/assessment?token=${r.attempt_token}`)
        .catch(() => undefined);
      toast.success(`Assessment issued (attempt ${r.attempt_no}) — candidate link copied`);
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (record.isLoading) {
    return <div className="space-y-4 p-6 lg:p-8"><Skeleton className="h-24 w-full" /><Skeleton className="h-64 w-full" /></div>;
  }
  if (record.error) {
    return <div className="p-6 text-sm text-destructive" role="alert">{(record.error as Error).message}</div>;
  }
  const rec = record.data;
  if (!rec) {
    return (
      <div className="p-6 lg:p-8">
        <Card><CardContent className="p-8 text-center text-muted-foreground">
          Application not found, or you do not have permission to review it.
        </CardContent></Card>
      </div>
    );
  }

  const attachmentEntries = Object.entries(rec.attachment ?? {});
  const educationDocs = rec.documents.filter((d) =>
    (d.doc_key ?? "").match(/kcpe|kcse|transcript|degree|diploma/i));
  const otherDocs = rec.documents.filter((d) => !educationDocs.includes(d));

  return (
    <div className="space-y-6 p-6 lg:p-8">
      <StaffPageHeader
        eyebrow="Recruitment 360"
        title={`${rec.candidate.full_name} — ${rec.vacancy.title}`}
        lede={`${rec.application_no} · applied ${new Date(rec.applied_at).toLocaleDateString()} · stage ${rec.stage}`}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" asChild data-analytics="none">
              <Link to="/staff/recruitment/assessments"><ArrowLeft className="mr-2 h-4 w-4" aria-hidden />Blueprints</Link>
            </Button>
            <Button onClick={() => issue.mutate()} disabled={issue.isPending} data-analytics="none">
              <Send className="mr-2 h-4 w-4" aria-hidden />Issue assessment
            </Button>
          </div>
        }
      />

      {(rec.review_flagged || rec.knockout_flagged) && (
        <Card className="border-destructive/40">
          <CardContent className="flex items-start gap-2 p-4 text-sm text-destructive" role="alert">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              {rec.knockout_flagged && "Knockout answer recorded. "}
              {rec.review_flagged && (rec.review_flag_reason || "Flagged for recruiter review.")}
            </span>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="education">
        <TabsList className="flex-wrap">
          <TabsTrigger value="education">Education</TabsTrigger>
          <TabsTrigger value="requirements">Mandatory requirements</TabsTrigger>
          <TabsTrigger value="attachment">Industrial attachment</TabsTrigger>
          <TabsTrigger value="assessment">Assessment ({rec.assessments.length})</TabsTrigger>
          <TabsTrigger value="documents">Documents ({rec.documents.length})</TabsTrigger>
          <TabsTrigger value="answers">Application answers</TabsTrigger>
        </TabsList>

        <TabsContent value="requirements" className="pt-4">
          {applicationId ? <MandatoryRequirementsPanel applicationId={applicationId} /> : null}
        </TabsContent>

        <TabsContent value="education" className="space-y-4 pt-4">

          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2">
              <GraduationCap className="h-4 w-4" aria-hidden />Education record
            </CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">Status: {rec.education.status ?? "not recorded"}</Badge>
                <Badge variant="outline">Qualification: {rec.education.qualification_level ?? "not recorded"}</Badge>
                <Badge variant="outline">Years completed: {rec.education.completed_years ?? "—"}</Badge>
                {rec.education.consolidated_transcript && <Badge variant="outline">consolidated transcript</Badge>}
              </div>
              {rec.education.qualifications.length > 0 ? (
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Qualification</TableHead><TableHead>Institution</TableHead>
                    <TableHead>Year</TableHead><TableHead>Verified</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {rec.education.qualifications.map((q, i) => (
                      <TableRow key={`${q.qualification}-${i}`}>
                        <TableCell>{q.qualification}</TableCell>
                        <TableCell>{q.institution ?? "—"}</TableCell>
                        <TableCell>{q.award_year ?? "—"}</TableCell>
                        <TableCell>{q.verified ? "Yes" : "Not yet"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : <p className="text-muted-foreground">No qualification rows recorded.</p>}

              <div>
                <h4 className="mb-1 font-semibold">Academic evidence</h4>
                {educationDocs.length === 0 ? <p className="text-muted-foreground">No academic documents uploaded.</p> : (
                  <ul className="space-y-1">
                    {educationDocs.map((d) => (
                      <li key={d.document_id} className="flex flex-wrap items-center gap-2">
                        <span>{d.file_name}</span>
                        <Badge variant="outline">{d.doc_key ?? d.doc_type}</Badge>
                        {d.academic_year && <Badge variant="outline">year {d.academic_year}</Badge>}
                        <Badge variant={d.verification_status === "verified" ? "default" : "secondary"}>
                          {d.verification_status ?? "unverified"}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <h4 className="mb-1 font-semibold">Education gate history</h4>
                {rec.education.gate_events.length === 0 ? (
                  <p className="text-muted-foreground">No gate decisions recorded for this vacancy.</p>
                ) : (
                  <ul className="space-y-1 text-xs">
                    {rec.education.gate_events.map((e, i) => (
                      <li key={i}>
                        {new Date(e.created_at).toLocaleString()} · {e.allowed ? "allowed" : "blocked"}
                        {e.code ? ` · ${e.code}` : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="attachment" className="pt-4">
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2">
              <Paperclip className="h-4 w-4" aria-hidden />Industrial attachment
            </CardTitle></CardHeader>
            <CardContent className="text-sm">
              {attachmentEntries.length === 0 ? (
                <p className="text-muted-foreground">No industrial attachment answers recorded on this application.</p>
              ) : (
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Field</TableHead><TableHead>Answer</TableHead><TableHead>Knockout</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {attachmentEntries.map(([key, v]) => (
                      <TableRow key={key}>
                        <TableCell className="font-medium">{key}</TableCell>
                        <TableCell className="whitespace-pre-wrap">{v.answer ?? "—"}</TableCell>
                        <TableCell>{v.knockout_failed ? "Failed" : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="assessment" className="space-y-4 pt-4">
          {rec.active_paper ? (
            <p className="text-sm text-muted-foreground">
              Active paper for this vacancy: {rec.active_paper.template_key} v{rec.active_paper.version}
              {" "}({rec.active_paper.total_marks} marks).
            </p>
          ) : (
            <p className="text-sm text-destructive" role="alert">
              No active assessment paper for this vacancy — compose and activate one in the
              {" "}<Link className="underline" to="/staff/recruitment/assessments">blueprint console</Link>.
            </p>
          )}
          {rec.assessments.length === 0 ? (
            <Card><CardContent className="p-6 text-sm text-muted-foreground">
              No assessment has been issued to this candidate yet.
            </CardContent></Card>
          ) : rec.assessments.map((a) => (
            <AttemptPanel key={a.attempt_id} attempt={a} onScored={refresh} />
          ))}
        </TabsContent>

        <TabsContent value="documents" className="pt-4">
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base flex items-center gap-2">
                <ScrollText className="h-4 w-4" aria-hidden />Document control
              </CardTitle>
              <Button variant="outline" size="sm" asChild data-analytics="none">
                <Link to="/staff/recruitment/requirements">
                  <History className="mr-1.5 h-3.5 w-3.5" aria-hidden />Requirement versions
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Uploaded is not verified. A candidate can only reach <em>uploaded</em>; verification
                is recorded here by an authorised reviewer and stored in the document audit trail.
              </p>
              {rec.documents.length === 0 ? (
                <p className="text-sm text-muted-foreground">No documents uploaded.</p>
              ) : (
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>File</TableHead><TableHead>Key</TableHead><TableHead>Version</TableHead>
                    <TableHead>Upload</TableHead><TableHead>Verification</TableHead><TableHead>Uploaded</TableHead>
                    <TableHead className="text-right">Reviewer decision</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {[...educationDocs, ...otherDocs].map((d) => (
                      <TableRow key={d.document_id}>
                        <TableCell>{d.file_name}</TableCell>
                        <TableCell className="text-xs">{d.doc_key ?? d.doc_type}</TableCell>
                        <TableCell>v{d.version_no}</TableCell>
                        <TableCell>{d.upload_status ?? "—"}</TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={VERIFICATION_TONE[verificationTone(
                              (d.verification_status ?? "uploaded") as never,
                            )]}
                          >
                            {verificationLabel((d.verification_status ?? "uploaded") as never)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">{new Date(d.created_at).toLocaleDateString()}</TableCell>
                        <TableCell>
                          <DocumentVerificationActions
                            documentId={d.document_id}
                            status={d.verification_status ?? "uploaded"}
                            onDone={refresh}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="answers" className="pt-4">
          <Card>
            <CardContent className="p-4">
              {rec.answers.length === 0 ? (
                <p className="text-sm text-muted-foreground">No blueprint answers recorded.</p>
              ) : (
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Question</TableHead><TableHead>Answer</TableHead>
                    <TableHead>Class</TableHead><TableHead>Knockout</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {rec.answers.map((a, i) => (
                      <TableRow key={`${a.question_key}-${i}`}>
                        <TableCell className="max-w-[20rem] text-sm">{a.prompt ?? a.question_key}</TableCell>
                        <TableCell className="whitespace-pre-wrap text-sm">{a.answer ?? "—"}</TableCell>
                        <TableCell className="text-xs">{a.classification ?? "—"}</TableCell>
                        <TableCell>{a.knockout_failed ? "Failed" : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
