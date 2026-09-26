/**
 * HR / SME question governance console — /staff/recruitment/questions
 *
 * Drives the existing question lifecycle (draft → SME review → SME approved →
 * published, with reject and retire) through `rec_question_review_action`.
 * Every transition, and the four-eyes rule (author ≠ approver ≠ publisher), is
 * enforced in the database; this console only offers the actions the current
 * state permits and records the reviewer's note.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, FileQuestion, Send, ShieldCheck, Undo2, XCircle } from "lucide-react";

import { StaffPageHeader } from "@/components/staff/primitives";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { difficultyLabel } from "@/lib/recruitment/assessmentBlueprint";
import {
  availableActions,
  questionStatusLabel,
  reviewQuestion,
  type QuestionPublicationStatus,
  type QuestionReviewAction,
} from "@/lib/recruitment/professionAssessment";

interface QuestionRow {
  id: string;
  question_no: string | null;
  question_key: string;
  version: number;
  competency_code: string;
  competency_label: string;
  difficulty: string;
  prompt: string;
  scenario: string | null;
  expected_evidence: string | null;
  question_type: string;
  max_marks: number;
  role_family: string;
  origin: string;
  answer_key: unknown;
  rubric: { anchors?: unknown[] } | null;
  publication_status: QuestionPublicationStatus;
  rejection_reason: string | null;
  created_at: string;
  published_at: string | null;
  sme_approved_at: string | null;
}

const ACTION_LABEL: Record<QuestionReviewAction, string> = {
  submit: "Send for subject-matter review",
  sme_approve: "Approve (subject-matter)",
  publish: "Publish to the question bank",
  reject: "Return for rework",
  retire: "Retire",
};

const ACTION_ICON: Record<QuestionReviewAction, typeof Send> = {
  submit: Send,
  sme_approve: CheckCircle2,
  publish: ShieldCheck,
  reject: XCircle,
  retire: Undo2,
};

const FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "All" },
  { value: "draft", label: "Drafts" },
  { value: "sme_review", label: "Awaiting review" },
  { value: "sme_approved", label: "Approved" },
  { value: "published", label: "Published" },
  { value: "rejected", label: "Returned" },
  { value: "retired", label: "Retired" },
];

const tone = (s: QuestionPublicationStatus) =>
  s === "published" ? "default" : s === "rejected" || s === "retired" ? "destructive" : "secondary";

async function listQuestions(): Promise<QuestionRow[]> {
  const { data, error } = await supabase
    .from("rec_question_bank")
    .select("id,question_no,question_key,version,competency_code,competency_label,difficulty,prompt,scenario,expected_evidence,question_type,max_marks,role_family,origin,answer_key,rubric,publication_status,rejection_reason,created_at,published_at,sme_approved_at")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as QuestionRow[];
}

export default function RecruitmentQuestionGovernance() {
  const qc = useQueryClient();
  const questions = useQuery({ queryKey: ["rec", "question-bank"], queryFn: listQuestions });
  const [filter, setFilter] = useState("all");
  const [pending, setPending] = useState<{ row: QuestionRow; action: QuestionReviewAction } | null>(null);
  const [note, setNote] = useState("");

  const rows = useMemo(() => {
    const all = questions.data ?? [];
    return filter === "all" ? all : all.filter((q) => q.publication_status === filter);
  }, [questions.data, filter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    (questions.data ?? []).forEach((q) => { c[q.publication_status] = (c[q.publication_status] ?? 0) + 1; });
    return c;
  }, [questions.data]);

  const act = useMutation({
    mutationFn: async () => {
      if (!pending) return;
      await reviewQuestion(pending.row.id, pending.action, note.trim() || undefined);
    },
    onSuccess: () => {
      toast.success("Question lifecycle updated");
      setPending(null);
      setNote("");
      qc.invalidateQueries({ queryKey: ["rec", "question-bank"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <StaffPageHeader
        eyebrow="Recruitment 360"
        title="Assessment question governance"
        lede="Questions may be drafted by staff or AI, but only a subject-matter approver — and then a separate publisher — can release them into candidate assessments."
      />

      <Tabs value={filter} onValueChange={setFilter}>
        <TabsList className="flex-wrap">
          {FILTERS.map((f) => (
            <TabsTrigger key={f.value} value={f.value}>
              {f.label}
              {f.value !== "all" && counts[f.value] ? ` (${counts[f.value]})` : ""}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {questions.isLoading ? (
        <Card><CardContent className="space-y-3 p-6"><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /></CardContent></Card>
      ) : questions.error ? (
        <Card>
          <CardContent className="p-6 text-sm text-destructive" role="alert">
            {(questions.error as Error).message}
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-10 text-center text-muted-foreground">
            <FileQuestion className="h-6 w-6" aria-hidden />
            <p className="font-medium text-foreground">No questions in this state</p>
            <p className="text-sm">Draft questions appear here for subject-matter review before publication.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {rows.map((q) => (
            <Card key={q.id}>
              <CardHeader className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={tone(q.publication_status)}>{questionStatusLabel(q.publication_status)}</Badge>
                  {q.question_no && <Badge variant="outline">{q.question_no}</Badge>}
                  <Badge variant="outline">{q.competency_label}</Badge>
                  <Badge variant="outline">{q.question_type}</Badge>
                  <Badge variant="outline">{difficultyLabel(q.difficulty)}</Badge>
                  <Badge variant="outline">{q.role_family}</Badge>
                  <Badge variant="outline">{q.max_marks} marks</Badge>
                  <Badge variant="outline">v{q.version}</Badge>
                  <Badge variant={q.answer_key ? "default" : "secondary"}>
                    {q.answer_key ? "auto-marked (answer key)" : "rubric-marked"}
                  </Badge>
                  {q.origin !== "human" && <Badge variant="secondary">{q.origin} draft</Badge>}
                </div>
                <CardTitle className="text-base font-medium">{q.prompt}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {q.scenario && <p className="text-sm text-muted-foreground">{q.scenario}</p>}
                {q.expected_evidence && (
                  <p className="text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">Expected evidence: </span>{q.expected_evidence}
                  </p>
                )}
                {Array.isArray(q.rubric?.anchors) && q.rubric.anchors.length > 0 && (
                  <details className="rounded-md border border-border/60 p-2 text-sm">
                    <summary className="cursor-pointer font-medium">
                      Scoring rubric ({q.rubric.anchors.length} anchor{q.rubric.anchors.length === 1 ? "" : "s"})
                    </summary>
                    <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs text-muted-foreground">
                      {JSON.stringify(q.rubric.anchors, null, 2)}
                    </pre>
                  </details>
                )}
                {q.rejection_reason && (
                  <p className="text-sm text-destructive">Returned: {q.rejection_reason}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  {q.question_key} · created {new Date(q.created_at).toLocaleDateString()}
                  {q.sme_approved_at && ` · approved ${new Date(q.sme_approved_at).toLocaleDateString()}`}
                  {q.published_at && ` · published ${new Date(q.published_at).toLocaleDateString()}`}
                </p>
                <div className="flex flex-wrap gap-2">
                  {availableActions(q.publication_status).map((a) => {
                    const Icon = ACTION_ICON[a];
                    return (
                      <Button
                        key={a}
                        size="sm"
                        variant={a === "reject" || a === "retire" ? "outline" : "default"}
                        onClick={() => { setPending({ row: q, action: a }); setNote(""); }}
                        data-analytics="none"
                      >
                        <Icon className="mr-2 h-4 w-4" aria-hidden />
                        {ACTION_LABEL[a]}
                      </Button>
                    );
                  })}
                  {availableActions(q.publication_status).length === 0 && (
                    <p className="text-xs text-muted-foreground">No further action available.</p>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pending ? ACTION_LABEL[pending.action] : ""}</DialogTitle>
            <DialogDescription>
              The database records who performed this transition and refuses it when the same person
              already authored or approved the question.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="review-note">
              Reviewer note {pending?.action === "reject" ? "(required)" : "(optional)"}
            </Label>
            <Textarea id="review-note" rows={4} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)} data-analytics="none">Cancel</Button>
            <Button
              onClick={() => act.mutate()}
              disabled={act.isPending || (pending?.action === "reject" && !note.trim())}
              data-analytics="none"
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
