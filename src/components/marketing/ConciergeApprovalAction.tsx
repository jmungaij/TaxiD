/**
 * Concierge approval action — submits the approval request the concierge
 * drafted (with its supporting policy/contract clauses) into the approval
 * workflow queue.
 */
import * as React from "react";
import { CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  buildApprovalDraft, submitApprovalDraft, type ApprovalDraft,
} from "@/lib/corporate/conciergeApprovals";
import type { ConciergeReply } from "@/lib/marketing/mobilityConcierge";

export interface ConciergeApprovalActionProps {
  prompt: string;
  reply: ConciergeReply;
  corporateId: string;
  requesterLabel?: string;
}

export function ConciergeApprovalAction({
  prompt, reply, corporateId, requesterLabel,
}: ConciergeApprovalActionProps) {
  const draft: ApprovalDraft = React.useMemo(
    () => buildApprovalDraft({ prompt, reply, corporateId, requesterLabel }),
    [prompt, reply, corporateId, requesterLabel],
  );
  const [busy, setBusy] = React.useState(false);
  const [submitted, setSubmitted] = React.useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    const res = await submitApprovalDraft(draft, corporateId);
    setBusy(false);
    if (res.ok) {
      setSubmitted(res.reference);
      toast.success(`Approval ${res.reference} submitted to ${draft.chain[0] ?? "the approver"}`);
    } else {
      toast.error(
        res.error === "no_active_approval_workflow"
          ? "No active approval workflow is configured for this account."
          : res.error ?? "Could not submit the approval request",
      );
    }
  };

  return (
    <div className="mt-2 space-y-2 rounded-md border border-border/60 bg-muted/40 p-3">
      <p className="flex items-center gap-1.5 text-xs font-medium">
        <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Approval chain: {draft.chain.join(" → ")}
      </p>
      {draft.clauses.length > 0 && (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {draft.clauses.map((c) => (
            <li key={c.id}>
              <Badge variant="outline" className="mr-1.5">{c.title}</Badge>
              {c.clause}
            </li>
          ))}
        </ul>
      )}
      {submitted ? (
        <p className="flex items-center gap-1.5 text-xs text-primary">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Submitted as {submitted}
        </p>
      ) : (
        <Button size="sm" onClick={() => void submit()} disabled={busy}>
          {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          Submit approval request
        </Button>
      )}
    </div>
  );
}

export default ConciergeApprovalAction;
