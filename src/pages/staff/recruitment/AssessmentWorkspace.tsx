import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Lock, ShieldAlert, Sparkles } from "lucide-react";

import { StaffPageHeader } from "@/components/staff/primitives";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

import * as engine from "@/lib/recruitment/assessment";
import {
  BAND_LABEL, CONFIDENCE_OPTIONS, RECOMMENDATION_OPTIONS, VERIFICATION_OPTIONS,
  canSubmit, gateResults, runningTotals, validateScore,
  type EvidenceConfidence, type ScoreBand, type VerificationStatus,
} from "@/lib/recruitment/assessmentScoring";

/**
 * Interviewer workspace: the standardised question set for the vacancy, the
 * candidate's answer, the evidence behind it, the verification outcome and the
 * score — each saved through the server. Totals, bands and critical gates shown
 * here are the same rules the database applies on submission; the interviewer
 * cannot edit a total, and a submitted assessment becomes immutable.
 */
export default function AssessmentWorkspace() {
  const { interviewId = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [assessmentId, setAssessmentId] = useState<string | null>(null);
  const [recommendation, setRecommendation] = useState<string>("");
  const [strengths, setStrengths] = useState("");
  const [concerns, setConcerns] = useState("");
  const [risks, setRisks] = useState("");

  const open = useQuery({
    queryKey: ["rec", "assessment-open", interviewId],
    queryFn: () => engine.openAssessment(interviewId),
    enabled: Boolean(interviewId),
    retry: false,
  });

  useEffect(() => {
    if (open.data) setAssessmentId(open.data);
  }, [open.data]);

  const assessment = useQuery({
    queryKey: ["rec", "assessment", assessmentId],
    queryFn: () => engine.getAssessment(assessmentId as string),
    enabled: Boolean(assessmentId),
  });

  const answers = useQuery({
    queryKey: ["rec", "assessment-answers", assessmentId],
    queryFn: () => engine.listAnswers(assessmentId as string),
    enabled: Boolean(assessmentId),
  });

  const rows = answers.data ?? [];
  const locked = (assessment.data?.status ?? "draft") !== "draft";
  const totals = useMemo(() => runningTotals(rows), [rows]);
  const gates = useMemo(() => gateResults(rows), [rows]);
  const submitCheck = canSubmit(rows, recommendation || null);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["rec", "assessment-answers", assessmentId] });
    void qc.invalidateQueries({ queryKey: ["rec", "assessment", assessmentId] });
  };

  const save = useMutation({
    mutationFn: engine.saveAnswer,
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const submit = useMutation({
    mutationFn: () => engine.submitAssessment({
      assessment_id: assessmentId as string,
      recommendation,
      strengths: strengths.trim() || undefined,
      concerns: concerns.trim() || undefined,
      risks: risks.trim() || undefined,
    }),
    onSuccess: (r) => {
      toast.success(`Assessment submitted and locked — ${r.total_score}/${r.max_score}`);
      invalidate();
      void qc.invalidateQueries({ queryKey: ["rec"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (open.isLoading) {
    return <div className="p-8 space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>;
  }

  if (open.error) {
    return (
      <div className="p-6 lg:p-8">
        <StaffPageHeader eyebrow="Recruitment 360" title="Structured assessment"
          lede="This assessment could not be opened." />
        <Card>
          <CardContent className="p-6" role="alert">
            <p className="flex items-start gap-2 text-sm text-destructive">
              <ShieldAlert className="h-4 w-4 mt-0.5" aria-hidden="true" />
              {(open.error as Error).message}
            </p>
            <Button className="mt-4" variant="outline" onClick={() => navigate("/staff/recruitment/interviews")}>
              Back to interview operations
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <StaffPageHeader
        eyebrow="Recruitment 360 · evidence-based assessment"
        title="Structured interview assessment"
        lede="Every score is anchored to observed, job-related evidence. Scores, bands and critical gates are calculated by the server, and the assessment locks on submission."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          {answers.isLoading ? (
            <Skeleton className="h-64" />
          ) : rows.length === 0 ? (
            <Card><CardContent className="p-8 text-sm text-muted-foreground">
              This assessment template has no questions configured.
            </CardContent></Card>
          ) : (
            <Accordion type="multiple" defaultValue={[rows[0]?.id]} className="space-y-3">
              {rows.map((a, idx) => (
                <AccordionItem key={a.id} value={a.id} className="rounded-lg border bg-card px-4">
                  <AccordionTrigger className="text-left">
                    <span className="flex flex-1 items-center gap-3 pr-3">
                      <span className="text-xs font-mono text-muted-foreground">
                        {String.fromCharCode(65 + idx)}
                      </span>
                      <span className="flex-1 text-sm font-medium">{a.competency_label}</span>
                      <Badge variant="outline">
                        {a.score ?? "—"} / {a.max_marks}
                      </Badge>
                      {a.critical_min != null && (
                        <Badge variant={(a.score ?? 0) >= a.critical_min ? "secondary" : "destructive"}>
                          gate ≥ {a.critical_min}
                        </Badge>
                      )}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-4 pb-5">
                    {a.question_snapshot?.scenario && (
                      <p className="rounded-md bg-muted/50 p-3 text-sm">{a.question_snapshot.scenario}</p>
                    )}
                    <p className="text-sm font-medium">{a.question_snapshot?.prompt}</p>

                    {(a.question_snapshot?.probes ?? []).length > 0 && (
                      <div className="text-xs text-muted-foreground">
                        <p className="font-semibold uppercase tracking-wide">Probes</p>
                        <ul className="mt-1 list-disc pl-4 space-y-0.5">
                          {(a.question_snapshot.probes ?? []).map((p) => <li key={p}>{p}</li>)}
                        </ul>
                      </div>
                    )}

                    <div className="grid gap-4 sm:grid-cols-2 text-xs text-muted-foreground">
                      <div>
                        <p className="font-semibold uppercase tracking-wide">What good looks like</p>
                        <ul className="mt-1 list-disc pl-4 space-y-0.5">
                          {(a.question_snapshot?.good_indicators ?? []).map((g) => <li key={g}>{g}</li>)}
                        </ul>
                      </div>
                      <div>
                        <p className="font-semibold uppercase tracking-wide">What weak looks like</p>
                        <ul className="mt-1 list-disc pl-4 space-y-0.5">
                          {(a.question_snapshot?.weak_indicators ?? []).map((w) => <li key={w}>{w}</li>)}
                        </ul>
                      </div>
                    </div>

                    {(a.question_snapshot?.scoring_anchors ?? []).length > 0 && (
                      <div className="text-xs">
                        <p className="font-semibold uppercase tracking-wide text-muted-foreground">Scoring anchors</p>
                        <ul className="mt-1 space-y-0.5">
                          {(a.question_snapshot.scoring_anchors ?? []).map((s) => (
                            <li key={s.range}><span className="font-mono">{s.range}</span> — {s.meaning}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <AnswerEditor answer={a} locked={locked} onSave={(patch) => save.mutate({ answer_id: a.id, ...patch })} />
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </div>

        <div className="space-y-4 lg:sticky lg:top-6 self-start">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Score summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-3xl font-semibold tabular-nums">
                {totals.total}<span className="text-base text-muted-foreground"> / {totals.max}</span>
              </p>
              <Progress value={totals.max ? (totals.total / totals.max) * 100 : 0} aria-label="Assessment progress" />
              <p className="text-sm text-muted-foreground">
                {totals.percentage ?? 0}% · {BAND_LABEL[totals.band as ScoreBand]}
              </p>
              <p className="text-xs text-muted-foreground">
                {totals.scored} of {totals.questions} questions scored
                {totals.outstanding > 0 && ` · ${totals.outstanding} still need evidence and a score`}
              </p>
              {assessment.data?.status !== "draft" && (
                <p className="flex items-center gap-2 text-xs font-medium">
                  <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                  Submitted and locked{assessment.data?.amended_at ? " (amended)" : ""}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm">Critical gates</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {gates.length === 0 ? (
                <p className="text-xs text-muted-foreground">This template defines no critical gates.</p>
              ) : gates.map((g) => (
                <p key={g.competency} className="flex items-center justify-between text-xs">
                  <span>{g.label}</span>
                  <Badge variant={g.passed ? "secondary" : "destructive"}>
                    {g.score ?? "—"} / min {g.minimum}
                  </Badge>
                </p>
              ))}
              {gates.length > 0 && !gates.every((g) => g.passed) && (
                <p className="text-xs text-destructive" role="status">
                  A failed gate removes priority hiring consideration regardless of the total.
                </p>
              )}
            </CardContent>
          </Card>

          {!locked && (
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-sm">Submit and lock</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="reco">Recommendation</Label>
                  <Select value={recommendation} onValueChange={setRecommendation}>
                    <SelectTrigger id="reco"><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      {RECOMMENDATION_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="strengths">Strongest evidence</Label>
                  <Textarea id="strengths" rows={2} value={strengths} onChange={(e) => setStrengths(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="concerns">Concerns</Label>
                  <Textarea id="concerns" rows={2} value={concerns} onChange={(e) => setConcerns(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="risks">Risks to validate further</Label>
                  <Textarea id="risks" rows={2} value={risks} onChange={(e) => setRisks(e.target.value)} />
                </div>
                {!submitCheck.allowed && (
                  <p className="text-xs text-muted-foreground" role="status">{submitCheck.reason}</p>
                )}
                <Button className="w-full" disabled={!submitCheck.allowed || submit.isPending}
                  onClick={() => submit.mutate()}>
                  <CheckCircle2 className="mr-2 h-4 w-4" aria-hidden="true" />
                  Submit assessment and lock scores
                </Button>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm">Assessment provenance</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-xs text-muted-foreground">
              <p className="flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                Template {assessment.data?.template_key} v{assessment.data?.template_version}
              </p>
              <p>Assessor: {assessment.data?.assessor_name ?? "You"}</p>
              <p>Questions are version-pinned; historical assessments keep their original rubric.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

/** One question's answer, evidence, verification and score. */
function AnswerEditor({
  answer, locked, onSave,
}: {
  answer: engine.RecAssessmentAnswer;
  locked: boolean;
  onSave: (patch: {
    answer_text?: string; evidence_text?: string; score?: number;
    verification_status?: VerificationStatus; evidence_confidence?: EvidenceConfidence; rationale?: string;
  }) => void;
}) {
  const [answerText, setAnswerText] = useState(answer.answer_text ?? "");
  const [evidence, setEvidence] = useState(answer.evidence_text ?? "");
  const [rationale, setRationale] = useState(answer.rationale ?? "");
  const [score, setScore] = useState(answer.score == null ? "" : String(answer.score));
  const [verification, setVerification] = useState<VerificationStatus>(answer.verification_status);
  const [confidence, setConfidence] = useState<EvidenceConfidence>(answer.evidence_confidence);

  const commit = () => {
    const parsed = Number(score);
    if (score !== "") {
      const check = validateScore(parsed, answer.max_marks);
      if (check.ok === false) { toast.error(check.message); return; }
    }
    onSave({
      answer_text: answerText.trim() || undefined,
      evidence_text: evidence.trim() || undefined,
      rationale: rationale.trim() || undefined,
      score: score === "" ? undefined : parsed,
      verification_status: verification,
      evidence_confidence: confidence,
    });
    toast.success(`${answer.competency_label} recorded`);
  };

  if (locked) {
    return (
      <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-2">
        <p><span className="font-medium">Answer:</span> {answer.answer_text ?? "—"}</p>
        <p><span className="font-medium">Evidence:</span> {answer.evidence_text ?? "—"}</p>
        <p className="text-xs text-muted-foreground">
          {answer.verification_status.replace(/_/g, " ")} · {answer.evidence_confidence} confidence ·
          score {answer.score ?? "—"}/{answer.max_marks}
        </p>
        <p className="text-xs text-muted-foreground">
          Locked. A correction requires a recorded amendment by a hiring authority.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor={`answer-${answer.id}`}>Candidate answer</Label>
        <Textarea id={`answer-${answer.id}`} rows={3} value={answerText}
          onChange={(e) => setAnswerText(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`evidence-${answer.id}`}>Evidence observed (required)</Label>
        <Textarea id={`evidence-${answer.id}`} rows={2} value={evidence}
          onChange={(e) => setEvidence(e.target.value)}
          placeholder={answer.question_snapshot?.expected_evidence ?? undefined} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor={`score-${answer.id}`}>Score (max {answer.max_marks})</Label>
          <Input id={`score-${answer.id}`} type="number" min={0} max={answer.max_marks} step="0.5"
            value={score} onChange={(e) => setScore(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`verif-${answer.id}`}>Verification</Label>
          <Select value={verification} onValueChange={(v) => setVerification(v as VerificationStatus)}>
            <SelectTrigger id={`verif-${answer.id}`}><SelectValue /></SelectTrigger>
            <SelectContent>
              {VERIFICATION_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`conf-${answer.id}`}>Evidence confidence</Label>
          <Select value={confidence} onValueChange={(v) => setConfidence(v as EvidenceConfidence)}>
            <SelectTrigger id={`conf-${answer.id}`}><SelectValue /></SelectTrigger>
            <SelectContent>
              {CONFIDENCE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`rationale-${answer.id}`}>Scoring rationale</Label>
        <Textarea id={`rationale-${answer.id}`} rows={2} value={rationale}
          onChange={(e) => setRationale(e.target.value)} />
      </div>
      <Button size="sm" variant="outline" onClick={commit}>
        Save {answer.competency_label} evidence and score
      </Button>
    </div>
  );
}
