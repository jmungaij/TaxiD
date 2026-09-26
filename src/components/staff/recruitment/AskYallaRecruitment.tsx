import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Sparkles, ArrowRight, Check, X, Pencil } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import * as rec from "@/lib/recruitment/api";
import { recommendNextBestActions, type AskYallaInputs, type NextBestAction } from "@/lib/recruitment/askYalla";

/**
 * Ask Yalla for Recruitment 360.
 *
 * Recommendations are computed from the recruiter's own RLS-scoped pipeline —
 * no model output, no automatic execution. Acting on one logs an AI request and
 * the human decision that accompanies it, so the trail explains every change.
 */
export function AskYallaRecruitment(props: AskYallaInputs & { limit?: number }) {
  const qc = useQueryClient();
  const [review, setReview] = useState<{ action: NextBestAction; decision: "rejected" | "modified" } | null>(null);
  const [reason, setReason] = useState("");

  const actions = useMemo(
    () => recommendNextBestActions(props).slice(0, props.limit ?? 4),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.vacancies, props.applications, props.interviews, props.offers, props.attention, props.talentPoolIdle, props.limit],
  );

  const decide = useMutation({
    mutationFn: async (input: { action: NextBestAction; decision: "accepted" | "rejected" | "modified"; reason?: string }) => {
      const logged = await rec.recordAiRecommendation({
        subject_type: input.action.subjectType,
        subject_id: input.action.subjectId,
        kind: input.action.kind,
        recommendation: input.action.title,
        rationale: input.action.rationale,
        evidence: input.action.evidence,
        confidence: input.action.confidence,
      });
      await rec.reviewAiRecommendation(logged, input.decision, input.reason);
      return input;
    },
    onSuccess: ({ decision }) => {
      toast.success(
        decision === "accepted"
          ? "Recommendation accepted and logged — open the module to do the work."
          : "Decision recorded against the AI request.",
      );
      setReview(null);
      setReason("");
      qc.invalidateQueries({ queryKey: ["rec"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="border-primary/25 bg-primary/[0.03]">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" /> Ask Yalla — next best actions
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Computed from your pipeline records. Every suggestion is logged as an AI request and needs your decision.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {actions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing is waiting on a recruitment decision right now — your pipeline has no unblocked backlog.
          </p>
        ) : (
          actions.map((a) => (
            <div key={a.id} className="rounded-md border bg-background p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="text-sm font-semibold">{a.title}</p>
                <Badge variant="outline" className="text-[10px]">
                  {Math.round(a.confidence * 100)}% signal strength
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{a.rationale}</p>
              <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                {a.evidence.map((e, i) => (
                  <li key={i}>· {e}</li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => decide.mutate({ action: a, decision: "accepted" })}
                  disabled={decide.isPending}
                >
                  <Check className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Accept
                </Button>
                <Button size="sm" variant="outline" onClick={() => { setReview({ action: a, decision: "modified" }); setReason(""); }}>
                  <Pencil className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Modify
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setReview({ action: a, decision: "rejected" }); setReason(""); }}>
                  <X className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Reject
                </Button>
                <Button asChild size="sm" variant="ghost" className="ml-auto text-primary">
                  <Link to={a.to}>
                    Open module <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                </Button>
              </div>
            </div>
          ))
        )}
      </CardContent>

      <Dialog open={!!review} onOpenChange={(o) => !o && setReview(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{review?.decision === "rejected" ? "Reject recommendation" : "Modify recommendation"}</DialogTitle>
            <DialogDescription>
              A reason is required so the audit trail explains why the suggestion was not followed as offered.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="ai-reason">Reason</Label>
            <Textarea id="ai-reason" rows={4} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReview(null)}>Cancel</Button>
            <Button
              onClick={() => review && decide.mutate({ action: review.action, decision: review.decision, reason })}
              disabled={decide.isPending || !reason.trim()}
            >
              Record decision
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
