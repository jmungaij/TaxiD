import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { toast } from "@/hooks/use-toast";
import { CheckCircle2, XCircle } from "lucide-react";

interface Question {
  id: string;
  kind: string;
  prompt: string;
  image_url: string | null;
  points: number;
}
interface Answer { id: string; question_id: string; label: string; sort_order: number; }

export function ExamRunner({
  assessmentId, title, passMark, onClose,
}: {
  assessmentId: string;
  title: string;
  passMark: number;
  onClose: (passed: boolean) => void;
}) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, Answer[]>>({});
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [idx, setIdx] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ score: number; passed: boolean } | null>(null);

  useEffect(() => {
    (async () => {
      /**
       * The question bank is NOT directly readable by test-takers — a driver
       * could otherwise query training_answers.is_correct mid-exam. The paper
       * comes from a server-side function that returns prompts and options
       * only; correctness never leaves the database. Grading stays in
       * training_submit_assessment.
       */
      const { data, error } = await supabase.rpc("training_exam_paper", {
        _assessment_id: assessmentId,
      });
      if (error) {
        toast({
          title: "Could not load exam",
          description: error.message,
          variant: "destructive",
        });
        return;
      }
      const paper = (data ?? []) as unknown as Array<Question & { answers: Answer[] }>;
      setQuestions(paper.map(({ answers: _omit, ...q }) => q));
      const grouped: Record<string, Answer[]> = {};
      for (const q of paper) grouped[q.id] = q.answers ?? [];
      setAnswers(grouped);
    })();
  }, [assessmentId]);

  async function submit() {
    setSubmitting(true);
    const { data, error } = await supabase.rpc("training_submit_assessment", {
      _assessment_id: assessmentId,
      _answers: selected,
    });
    setSubmitting(false);
    if (error) {
      toast({ title: "Submission failed", description: error.message, variant: "destructive" });
      return;
    }
    const r = data as any;
    setResult({ score: r.score, passed: r.passed });
    if (r.passed) toast({ title: "Passed!", description: `Score ${r.score}% — certificate issued.` });
    else toast({ title: "Didn't pass", description: `Score ${r.score}% — try again.`, variant: "destructive" });
  }

  const q = questions[idx];
  const total = questions.length;
  const pct = total ? Math.round(((idx + 1) / total) * 100) : 0;

  return (
    <Dialog open onOpenChange={() => onClose(result?.passed ?? false)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <p className="text-xs text-muted-foreground">Pass mark {passMark}% · {total} questions</p>
        </DialogHeader>

        {result ? (
          <div className="py-8 text-center space-y-4">
            {result.passed
              ? <CheckCircle2 className="h-16 w-16 mx-auto text-status-success" />
              : <XCircle className="h-16 w-16 mx-auto text-status-danger" />}
            <div className="text-3xl font-bold">{result.score}%</div>
            <p className="text-sm text-muted-foreground">
              {result.passed
                ? "Your certificate has been issued."
                : `You need ${passMark}% to pass. Review the lessons and try again.`}
            </p>
            <Button onClick={() => onClose(result.passed)}>Close</Button>
          </div>
        ) : !q ? (
          <p className="py-12 text-center text-muted-foreground">Loading questions…</p>
        ) : (
          <>
            <Progress value={pct} className="h-1" />
            <div className="space-y-4 py-2">
              <div className="text-xs text-muted-foreground">Question {idx + 1} of {total}</div>
              <div className="font-medium">{q.prompt}</div>
              {q.image_url && <img src={q.image_url} alt="" className="rounded border max-h-60" />}
              <RadioGroup
                value={selected[q.id] ?? ""}
                onValueChange={(v) => setSelected(s => ({ ...s, [q.id]: v }))}
              >
                {(answers[q.id] ?? []).map(a => (
                  <div key={a.id} className="flex items-center space-x-2 rounded border p-3">
                    <RadioGroupItem value={a.id} id={a.id} />
                    <Label htmlFor={a.id} className="cursor-pointer flex-1">{a.label}</Label>
                  </div>
                ))}
              </RadioGroup>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="ghost" onClick={() => setIdx(i => Math.max(0, i - 1))} disabled={idx === 0}>
                Previous
              </Button>
              {idx < total - 1 ? (
                <Button onClick={() => setIdx(i => i + 1)} disabled={!selected[q.id]}>Next</Button>
              ) : (
                <Button onClick={submit} disabled={submitting || Object.keys(selected).length < total}>
                  {submitting ? "Submitting…" : "Submit exam"}
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
