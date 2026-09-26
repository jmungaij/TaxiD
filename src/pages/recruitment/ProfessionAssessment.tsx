/**
 * Candidate Profession assessment sitting — /recruitment/assessment?token=…
 *
 * The attempt token issued by recruitment is the candidate credential: the
 * page only ever calls the token-scoped RPCs (`rec_profession_attempt_load` /
 * `_save` / `_submit`). No score, band or gate is computed here — totals are
 * produced and stored by the server, and answer keys / rubrics are never sent
 * to the browser. Answers autosave, so a candidate can resume the same link
 * until it is submitted or expires.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { CheckCircle2, ClipboardList, Loader2, RefreshCw, ShieldCheck, XCircle } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { CONTACT } from "@/config/contact";
import {
  canSubmitAttempt,
  isAnswered,
  loadAttempt,
  outstandingQuestions,
  saveAttempt,
  submitAttempt,
  type ProfessionAttempt,
  type ProfessionQuestion,
} from "@/lib/recruitment/professionAssessment";

type SaveState = "idle" | "saving" | "saved" | "error";

export default function ProfessionAssessment() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";

  const [attempt, setAttempt] = useState<ProfessionAttempt | null>(null);
  const [loading, setLoading] = useState(Boolean(token));
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const dirty = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const a = await loadAttempt(token);
      setAttempt(a);
      if (a.status === "submitted" || a.status === "scored") setSubmitted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "We could not open this assessment.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const questions = useMemo(() => attempt?.questions ?? [], [attempt]);
  const answered = questions.filter(isAnswered).length;
  const missing = outstandingQuestions(questions);
  const gate = attempt ? canSubmitAttempt(attempt) : { allowed: false };

  const patch = (key: string, next: Partial<ProfessionQuestion>) => {
    dirty.current.add(key);
    setAttempt((prev) => prev && ({
      ...prev,
      questions: (prev.questions ?? []).map((q) => (q.question_key === key ? { ...q, ...next } : q)),
    }));
  };

  /** Persists only the questions touched since the last save. */
  const flush = useCallback(async () => {
    if (!token || dirty.current.size === 0 || submitted) return;
    const keys = Array.from(dirty.current);
    dirty.current.clear();
    const payload = (attempt?.questions ?? [])
      .filter((q) => keys.includes(q.question_key))
      .map((q) => ({
        question_key: q.question_key,
        response_text: q.response_text ?? null,
        selected_options: q.selected_options ?? null,
        work_sample_document_id: q.work_sample_document_id ?? null,
      }));
    if (payload.length === 0) return;
    setSaveState("saving");
    try {
      await saveAttempt(token, payload);
      setSaveState("saved");
    } catch {
      keys.forEach((k) => dirty.current.add(k));
      setSaveState("error");
    }
  }, [attempt, token, submitted]);

  // Debounced autosave — keeps the sitting resumable without a manual save.
  useEffect(() => {
    if (!started || submitted) return;
    const t = setTimeout(() => { void flush(); }, 1200);
    return () => clearTimeout(t);
  }, [attempt, started, submitted, flush]);

  const onSubmit = async () => {
    if (!token) return;
    setSubmitting(true);
    setError(null);
    try {
      await flush();
      const res = await submitAttempt(token);
      if (res.status === "submitted" || res.status === "scored" || res.already_submitted) {
        setSubmitted(true);
        await load();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submission failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const shell = (children: React.ReactNode) => (
    <main className="min-h-screen bg-background py-12">
      <Helmet>
        <title>Profession Assessment | SAFARID</title>
        <meta name="description" content="Complete your SAFARID profession assessment using the secure link issued by our recruitment team." />
        <meta name="robots" content="noindex" />
      </Helmet>
      <div className="container max-w-3xl space-y-6">{children}</div>
    </main>
  );

  if (!token) {
    return shell(
      <Card>
        <CardHeader><CardTitle>Assessment link required</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Open the assessment using the exact link emailed to you. Need help? Contact {CONTACT.hrEmail}.
        </CardContent>
      </Card>,
    );
  }

  if (loading) {
    return shell(<Card><CardContent className="p-8 space-y-3"><Skeleton className="h-6 w-1/2" /><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></CardContent></Card>);
  }

  if (error && !attempt) {
    return shell(
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><XCircle className="h-5 w-5 text-destructive" />We could not open this assessment</CardTitle></CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>{error}</p>
          <Button variant="outline" onClick={() => void load()}><RefreshCw className="mr-2 h-4 w-4" />Try again</Button>
        </CardContent>
      </Card>,
    );
  }

  if (!attempt?.found) {
    return shell(
      <Card>
        <CardHeader><CardTitle>Link not recognised</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          This assessment link is not recognised or has been replaced. Contact {CONTACT.hrEmail} and we will re-issue it.
        </CardContent>
      </Card>,
    );
  }

  if (attempt.status === "expired" || attempt.status === "void") {
    return shell(
      <Card>
        <CardHeader><CardTitle>This assessment link is closed</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          The link has expired or been withdrawn. Email {CONTACT.hrEmail} if you still need to sit the assessment.
        </CardContent>
      </Card>,
    );
  }

  if (submitted) {
    return shell(
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-primary" />Assessment submitted</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Your answers are locked and cannot be changed. Marking is completed by our recruitment
            team — your result is recorded against your application, not shown here.
          </p>
          {attempt.submitted_at && <p>Submitted {new Date(attempt.submitted_at).toLocaleString()}.</p>}
          <p>Questions? Contact {CONTACT.hrEmail}.</p>
        </CardContent>
      </Card>,
    );
  }

  if (!started) {
    return shell(
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ClipboardList className="h-5 w-5 text-primary" />Profession assessment</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <ul className="space-y-2 text-muted-foreground">
            <li>{questions.length} questions covering the competencies for this role.</li>
            <li>Your answers save automatically — you may close this page and resume with the same link.</li>
            <li>Once you submit, answers are final and cannot be edited.</li>
            {attempt.expires_at && <li>Complete by {new Date(attempt.expires_at).toLocaleString()}.</li>}
          </ul>
          <p className="flex items-center gap-2 text-muted-foreground">
            <ShieldCheck className="h-4 w-4" aria-hidden />
            Scoring is carried out on our servers by the recruitment panel.
          </p>
          <Button onClick={() => setStarted(true)} data-analytics="none">
            {answered > 0 ? "Resume assessment" : "Start assessment"}
          </Button>
        </CardContent>
      </Card>,
    );
  }

  return shell(
    <>
      <Card>
        <CardHeader className="space-y-3">
          <CardTitle>Profession assessment</CardTitle>
          <Progress value={questions.length ? (answered / questions.length) * 100 : 0} />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{answered} of {questions.length} answered</span>
            <span aria-live="polite">
              {saveState === "saving" && "Saving…"}
              {saveState === "saved" && "Answers saved"}
              {saveState === "error" && "Save failed — retrying on your next edit"}
            </span>
          </div>
        </CardHeader>
      </Card>

      {questions.map((q, i) => (
        <Card key={q.question_key} id={`q-${q.question_key}`}>
          <CardHeader className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">Q{i + 1}</Badge>
              <Badge variant="secondary">{q.competency_label}</Badge>
              {q.mandatory && <Badge variant="outline">Required</Badge>}
              {!isAnswered(q) && <Badge variant="outline">Not answered</Badge>}
            </div>
            <CardTitle className="text-base font-medium">{q.prompt}</CardTitle>
            {q.scenario && <p className="text-sm text-muted-foreground">{q.scenario}</p>}
          </CardHeader>
          <CardContent className="space-y-3">
            {q.options?.length ? (
              <fieldset className="space-y-2">
                <legend className="sr-only">{q.prompt}</legend>
                {q.options.map((o) => {
                  const selected = (q.selected_options ?? []).includes(o.key);
                  return (
                    <label key={o.key} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm">
                      <input
                        type="radio"
                        className="mt-1"
                        name={q.question_key}
                        checked={selected}
                        onChange={() => patch(q.question_key, { selected_options: [o.key] })}
                      />
                      <span>{o.label}</span>
                    </label>
                  );
                })}
              </fieldset>
            ) : (
              <div className="space-y-2">
                <Label htmlFor={`ans-${q.question_key}`}>Your answer</Label>
                <Textarea
                  id={`ans-${q.question_key}`}
                  rows={6}
                  value={q.response_text ?? ""}
                  onChange={(e) => patch(q.question_key, { response_text: e.target.value })}
                  placeholder={q.expected_evidence ?? "Describe what you would do, and why."}
                />
                {q.expected_evidence && (
                  <p className="text-xs text-muted-foreground">Include: {q.expected_evidence}</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardContent className="space-y-3 p-6">
          {missing.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {missing.length} required question(s) still need an answer before you can submit.
            </p>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex flex-wrap gap-3">
            <Button variant="outline" onClick={() => void flush()} disabled={saveState === "saving"} data-analytics="none">
              Save progress
            </Button>
            <Button onClick={() => void onSubmit()} disabled={!gate.allowed || submitting} data-analytics="none">
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Submit assessment
            </Button>
          </div>
          {!gate.allowed && gate.reason && (
            <p className="text-xs text-muted-foreground">{gate.reason}</p>
          )}
        </CardContent>
      </Card>
    </>,
  );
}
