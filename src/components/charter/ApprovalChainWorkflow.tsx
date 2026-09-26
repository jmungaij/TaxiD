/**
 * Approval chain workflow panel for the Charter Business Portal.
 *
 * Shows each authorisation step with its status, assignee and decision trail.
 * Only holders of the `approve_step` capability (approving officers and charter
 * administrators) can action a step; procurement officers can assign approvers
 * and submit the chain for authorisation.
 */
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, Loader2, Mail, ShieldCheck, XCircle } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  assignStep, decideStep, notifyApprovalStep, STEP_STATUS_CLASS, STEP_STATUS_LABEL,
  workflowProgress, workflowStatus, type ApprovalWorkflow,
} from "@/lib/charter/approvalWorkflow";

interface Props {
  workflow: ApprovalWorkflow | null;
  onChange: (w: ApprovalWorkflow) => void;
  canApprove: boolean;
  canAssign: boolean;
  onCreate?: () => void;
}

const money = (n: number) => `KSh ${Math.round(n || 0).toLocaleString("en-KE")}`;

export function ApprovalChainWorkflow({ workflow, onChange, canApprove, canAssign, onCreate }: Props) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  if (!workflow) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">Approval chain workflow</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            No authorisation chain is open. Complete the procurement spine, then submit the mission for
            organisational authorisation.
          </p>
          {onCreate && (
            <Button onClick={onCreate} disabled={!canAssign}>Submit for authorisation</Button>
          )}
          {!canAssign && (
            <p className="text-xs text-muted-foreground">
              Your role can view the chain but not open one — ask a procurement officer to submit it.
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  const status = workflowStatus(workflow);

  const decide = async (stepId: string, decision: "approved" | "rejected") => {
    setBusy(stepId);
    const updated = decideStep(workflow, stepId, decision, notes[stepId] ?? "");
    onChange(updated);
    const actioned = updated.steps.find((s) => s.id === stepId);
    if (actioned) {
      const res = await notifyApprovalStep(updated, actioned, decision);
      toast({
        title: decision === "approved" ? "Step approved" : "Step rejected",
        description: res.ok
          ? `${actioned.assigneeEmail} notified by email.`
          : "Decision recorded. Email notification could not be delivered.",
        variant: decision === "rejected" ? "destructive" : undefined,
      });
    }
    setBusy(null);
  };

  return (
    <Card>
      <CardHeader className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
            Approval chain workflow
          </CardTitle>
          <Badge
            variant="outline"
            className={
              status === "approved"
                ? "border-primary/30 bg-primary/15 text-primary"
                : status === "rejected"
                  ? "border-destructive/30 bg-destructive/15 text-destructive"
                  : "border-primary/30 bg-primary/15 text-primary"
            }
          >
            {status === "approved" ? "Fully authorised" : status === "rejected" ? "Rejected" : "In progress"}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {workflow.missionLabel} · {money(workflow.amountKes)} · ref {workflow.reference}
        </p>
        <Progress value={workflowProgress(workflow)} aria-label="Approval progress" />
      </CardHeader>

      <CardContent className="space-y-3">
        {workflow.steps.map((s, i) => {
          const actionable = canApprove && s.requiresApprover && s.status === "in_review";
          return (
            <div key={s.id} className="rounded-xl border border-border bg-card/60 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">
                    <span className="mr-2 text-xs text-muted-foreground">Step {i + 1}</span>
                    {s.title}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {s.assigneeName || "Unassigned"} · {s.role}
                    {s.decidedAt ? ` · ${new Date(s.decidedAt).toLocaleString("en-KE")}` : ""}
                  </p>
                  {s.note && <p className="mt-1 text-xs text-muted-foreground">Note: {s.note}</p>}
                </div>
                <Badge variant="outline" className={STEP_STATUS_CLASS[s.status]}>{STEP_STATUS_LABEL[s.status]}</Badge>
              </div>

              {canAssign && s.status !== "approved" && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor={`assignee-${s.id}`} className="text-xs">Approver name</Label>
                    <Input
                      id={`assignee-${s.id}`} className="mt-1"
                      value={s.assigneeName}
                      onChange={(e) => onChange(assignStep(workflow, s.id, e.target.value, s.assigneeEmail))}
                    />
                  </div>
                  <div>
                    <Label htmlFor={`assignee-email-${s.id}`} className="text-xs">Notification email</Label>
                    <Input
                      id={`assignee-email-${s.id}`} type="email" className="mt-1"
                      value={s.assigneeEmail}
                      onChange={(e) => onChange(assignStep(workflow, s.id, s.assigneeName, e.target.value))}
                    />
                  </div>
                </div>
              )}

              {actionable && (
                <div className="mt-3 space-y-2">
                  <Label htmlFor={`note-${s.id}`} className="text-xs">Decision note (optional)</Label>
                  <Textarea
                    id={`note-${s.id}`} rows={2}
                    value={notes[s.id] ?? ""}
                    onChange={(e) => setNotes((prev) => ({ ...prev, [s.id]: e.target.value }))}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => decide(s.id, "approved")} disabled={busy === s.id}>
                      {busy === s.id
                        ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        : <CheckCircle2 className="mr-2 h-3.5 w-3.5" aria-hidden="true" />}
                      Approve step
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => decide(s.id, "rejected")} disabled={busy === s.id}>
                      <XCircle className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> Reject
                    </Button>
                  </div>
                </div>
              )}

              {!canApprove && s.status === "in_review" && (
                <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                  <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                  Awaiting {s.assigneeName || "the approving officer"} — they have been notified by email.
                </p>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

export default ApprovalChainWorkflow;
