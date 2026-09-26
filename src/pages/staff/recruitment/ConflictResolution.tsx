/**
 * Recruitment 360 — Panel Conflict Resolution.
 *
 * Dedicated screen for reconciling competing evaluation forms (e.g. Asunta
 * Nyambura's advance vs reject). Shows the conflicting forms side by side with
 * the score spread, the AI HR-practitioner recommendation, and the governed
 * final human decision (append-only via rec_adjudication_decide).
 */
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, ArrowRight, BrainCircuit, Gavel, Scale, ShieldAlert, ShieldCheck, User,
} from "lucide-react";
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

import * as recon from "@/lib/recruitment/importReconciliation";
import { cn } from "@/lib/utils";

const TONE: Record<string, string> = {
  success: "bg-success/10 text-success border-success/30",
  warning: "bg-warning/10 text-warning-foreground border-warning/30",
  danger: "bg-destructive/10 text-destructive border-destructive/30",
  info: "bg-primary/10 text-primary border-primary/30",
  neutral: "bg-muted text-muted-foreground border-border",
};

const RECO_TONE: Record<string, string> = {
  strong_advance: TONE.success,
  advance: TONE.success,
  hold: TONE.warning,
  reject: TONE.danger,
  strong_reject: TONE.danger,
};

const humanise = (v: string) => v.replace(/_/g, " ").replace(/\b[a-z]/g, (c) => c.toUpperCase());
const fmtDate = (v: string | null) =>
  v ? new Date(v).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" }) : "—";

export default function ConflictResolution() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();

  const adjudication = useQuery({
    queryKey: ["rec", "adjudication", id],
    queryFn: () => recon.getAdjudication(id!),
    enabled: !!id,
  });
  const evaluations = useQuery({
    queryKey: ["rec", "conflict-evaluations", id],
    queryFn: () => recon.loadConflictEvaluations(id!),
    enabled: !!id,
  });

  const [decision, setDecision] = useState("uphold_advance");
  const [decider, setDecider] = useState("");
  const [rationale, setRationale] = useState("");

  const invalidate = () => qc.invalidateQueries({ queryKey: ["rec"] });

  const ai = useMutation({
    mutationFn: () => recon.requestAiAdjudication(id!),
    onSuccess: (data) => {
      toast.success(`AI recommendation: ${humanise(data.recommendation)} (${Math.round(data.confidence * 100)}% confidence)`);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const decide = useMutation({
    mutationFn: () => recon.decideAdjudication(id!, decision, rationale, decider || undefined),
    onSuccess: () => {
      toast.success("Final decision recorded — conflict closed");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const a = adjudication.data;
  const evals = evaluations.data ?? [];
  const scores = evals.map((e) => e.overall_score).filter((n): n is number => n != null);
  const spread = scores.length > 1 ? Math.max(...scores) - Math.min(...scores) : 0;
  const decided = a?.status === "decided";

  return (
    <div className="p-6 lg:p-8">
      <StaffPageHeader
        title="Panel Conflict Resolution"
        lede="Reconcile competing evaluation forms with full evidence, an AI HR-practitioner second opinion, and a governed final decision."
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to="/staff/recruitment/import/reconciliation">
              <ArrowLeft className="mr-2 h-4 w-4" aria-hidden />
              Back to reconciliation
            </Link>
          </Button>
        }
      />

      {(adjudication.isLoading || evaluations.isLoading) && <Skeleton className="mt-6 h-96 w-full" />}

      {a && (
        <div className="mt-6 space-y-6">
          {/* conflict summary */}
          <Card className={cn(!decided && "border-warning/40")}>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Scale className="h-5 w-5 text-primary" aria-hidden />
                    {a.candidate_name ?? "Candidate"} — {humanise(a.subject)}
                  </CardTitle>
                  <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{a.conflict_summary}</p>
                </div>
                <div className="flex items-center gap-2">
                  {scores.length > 1 && (
                    <Badge variant="outline" className={spread >= 4 ? TONE.danger : spread >= 2 ? TONE.warning : TONE.neutral}>
                      Score spread {spread.toFixed(1)}
                    </Badge>
                  )}
                  <Badge
                    variant="outline"
                    className={decided ? TONE.success : a.status === "ai_recommended" ? TONE.info : TONE.warning}
                  >
                    {humanise(a.status)}
                  </Badge>
                </div>
              </div>
            </CardHeader>
          </Card>

          {/* side-by-side evaluation forms */}
          <div className="grid gap-4 lg:grid-cols-2">
            {evals.map((e, i) => (
              <Card key={e.id} className="flex flex-col">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        Evaluation form {String.fromCharCode(65 + i)}
                      </div>
                      <CardTitle className="mt-1 flex items-center gap-2 text-base">
                        <User className="h-4 w-4 text-muted-foreground" aria-hidden />
                        {e.evaluator_name ?? "Panelist"}
                      </CardTitle>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {e.interview_stage ? humanise(e.interview_stage) : "Interview"}
                        {e.interview_at ? ` · ${fmtDate(e.interview_at)}` : ""}
                        {e.interview_location ? ` · ${e.interview_location}` : ""}
                      </p>
                    </div>
                    <div className="text-right">
                      <div className="text-3xl font-bold tabular-nums">{e.overall_score?.toFixed(1) ?? "—"}</div>
                      {e.recommendation && (
                        <Badge variant="outline" className={RECO_TONE[e.recommendation] ?? TONE.neutral}>
                          {humanise(e.recommendation)}
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 space-y-3 text-sm">
                  {e.criteria_scores.length > 0 && (
                    <div className="space-y-1.5">
                      {e.criteria_scores.map((c, ci) => (
                        <div key={ci} className="flex items-center justify-between gap-3 text-xs">
                          <span className="text-muted-foreground">{c.criterion ?? `Criterion ${ci + 1}`}</span>
                          <span className="font-medium tabular-nums">{c.score ?? "—"}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {e.strengths && <FieldBlock label="Strengths" value={e.strengths} tone="text-success" />}
                  {e.concerns && <FieldBlock label="Concerns" value={e.concerns} tone="text-destructive" />}
                  {e.evidence && <FieldBlock label="Evidence cited" value={e.evidence} />}
                  {e.comments && <FieldBlock label="Comments" value={e.comments} />}
                  <p className="text-[11px] text-muted-foreground">Submitted {fmtDate(e.submitted_at)}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {evals.length === 0 && !evaluations.isLoading && (
            <Card><CardContent className="p-6 text-sm text-muted-foreground">No evaluation forms are linked to this conflict.</CardContent></Card>
          )}

          {/* AI second opinion */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <BrainCircuit className="h-4 w-4 text-primary" aria-hidden />
                AI HR-practitioner second opinion
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {a.ai_recommendation ? (
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className={TONE.info}>{humanise(a.ai_recommendation)}</Badge>
                    {a.ai_confidence != null && (
                      <span className="text-xs text-muted-foreground">{Math.round(a.ai_confidence * 100)}% confidence</span>
                    )}
                    {a.ai_model && <span className="text-[11px] text-muted-foreground">· {a.ai_model}</span>}
                    {a.ai_generated_at && <span className="text-[11px] text-muted-foreground">· {fmtDate(a.ai_generated_at)}</span>}
                  </div>
                  <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">{a.ai_rationale}</p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No AI recommendation yet. The AI reads both evaluation forms, the candidate's verified history and the
                  role requirements, then reasons like a senior HR practitioner — including bias detection.
                </p>
              )}
              {!decided && (
                <Button variant="outline" size="sm" disabled={ai.isPending} onClick={() => ai.mutate()}>
                  <BrainCircuit className="mr-2 h-4 w-4" aria-hidden />
                  {ai.isPending ? "Analysing both forms…" : a.ai_recommendation ? "Regenerate recommendation" : "Run AI adjudication"}
                </Button>
              )}
            </CardContent>
          </Card>

          {/* final human decision */}
          {decided ? (
            <Card className="border-success/40">
              <CardContent className="p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-success" aria-hidden />
                  <span className="text-sm font-semibold">Final decision: {humanise(a.hr_decision ?? "")}</span>
                  <span className="text-xs text-muted-foreground">{a.decided_by_label ?? "HR"} · {fmtDate(a.decided_at)}</span>
                </div>
                {a.hr_rationale && <p className="mt-2 text-sm text-muted-foreground">{a.hr_rationale}</p>}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Gavel className="h-4 w-4 text-primary" aria-hidden />
                  Final human decision
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs text-muted-foreground">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
                  The decision is recorded append-only with your identity and closes the conflict. The candidate's
                  pipeline outcome is never changed by AI alone.
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="cr-decision">Decision</Label>
                    <Select value={decision} onValueChange={setDecision}>
                      <SelectTrigger id="cr-decision"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {recon.HR_DECISIONS.map((d) => (
                          <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="cr-decider">Decided by</Label>
                    <Input id="cr-decider" value={decider} onChange={(e) => setDecider(e.target.value)} placeholder="e.g. Head of Talent" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cr-rationale">Rationale</Label>
                  <Textarea
                    id="cr-rationale"
                    value={rationale}
                    onChange={(e) => setRationale(e.target.value)}
                    rows={4}
                    placeholder="Why this resolution is fair to the candidate and defensible on audit…"
                  />
                </div>
                <div className="flex items-center gap-2">
                  {a.ai_recommendation && decision !== a.ai_recommendation && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <ArrowRight className="h-3 w-3" aria-hidden />
                      Deviating from the AI recommendation — the rationale should address it.
                    </span>
                  )}
                </div>
                <Button disabled={!rationale.trim() || decide.isPending} onClick={() => decide.mutate()}>
                  <Gavel className="mr-2 h-4 w-4" aria-hidden />
                  {decide.isPending ? "Recording…" : "Record final decision"}
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function FieldBlock({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div className={cn("text-[11px] uppercase tracking-wide", tone ?? "text-muted-foreground")}>{label}</div>
      <p className="mt-0.5 text-sm text-muted-foreground">{value}</p>
    </div>
  );
}
