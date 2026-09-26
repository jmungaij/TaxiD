import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { ExternalLink, GitBranch, UserPlus, CheckCircle2, ListPlus } from "lucide-react";
import { toast } from "sonner";
import {
  permittedActions, type SearchEntityId, type SearchHit,
} from "@/lib/staff/universalSearch";
import { traceHref } from "@/lib/staff/workflowTrace";
import {
  createFollowUpTask, recordDecision, DECISION_BOUNDARY_NOTE,
} from "@/lib/staff/searchActions";
import type { WorkflowStageId } from "@/lib/staff/marketplaceWorkflow";

/**
 * Permission-aware actions for a single search result. Only actions the
 * employee's scopes allow are rendered — nothing is shown disabled to imply
 * authority that does not exist.
 */
export function ResultActions({
  entity,
  hit,
  stage,
  roles,
}: {
  entity: SearchEntityId;
  hit: SearchHit;
  stage: WorkflowStageId;
  roles: readonly string[];
}) {
  const actions = permittedActions(entity, roles);
  const [dialog, setDialog] = useState<null | "follow_up" | "approve">(null);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [due, setDue] = useState("");
  const [reason, setReason] = useState("");
  const [decision, setDecision] = useState<"approved" | "rejected">("approved");
  const [busy, setBusy] = useState(false);

  const close = () => {
    setDialog(null);
    setTitle("");
    setNotes("");
    setDue("");
    setReason("");
  };

  const assignToMe = async () => {
    setBusy(true);
    const res = await createFollowUpTask({
      entity,
      entityId: hit.id,
      entityLabel: hit.title,
      stage,
      title: `Own and progress: ${hit.title}`,
      assignToSelf: true,
    });
    setBusy(false);
    if (!res.ok) toast.error("Not assigned", { description: res.reason });
    else toast.success("Assigned to you", { description: "It is now in the staff follow-up register." });
  };

  const submitFollowUp = async () => {
    setBusy(true);
    const res = await createFollowUpTask({
      entity, entityId: hit.id, entityLabel: hit.title, stage, title, notes, dueDate: due || undefined,
    });
    setBusy(false);
    if (!res.ok) {
      toast.error("Follow-up not created", { description: res.reason });
      return;
    }
    toast.success("Follow-up created", { description: `Linked to ${hit.title}` });
    close();
  };

  const submitDecision = async () => {
    setBusy(true);
    const res = await recordDecision({
      entity, entityId: hit.id, entityLabel: hit.title, stage, decision, reason,
    });
    setBusy(false);
    if (!res.ok) {
      toast.error("Decision not recorded", { description: res.reason });
      return;
    }
    toast.success(`Decision recorded: ${decision}`, { description: DECISION_BOUNDARY_NOTE });
    close();
  };

  if (actions.length === 0) {
    return <span className="text-[11px] text-muted-foreground">No actions in your scope</span>;
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-1">
        {actions.includes("open") && hit.href && (
          <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs">
            <Link to={hit.href}>
              <ExternalLink className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Open
            </Link>
          </Button>
        )}
        {actions.includes("trace") && (
          <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs">
            <Link to={traceHref(entity, hit)} aria-label={`Trace ${hit.title} through the marketplace chain`}>
              <GitBranch className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Trace
            </Link>
          </Button>
        )}
        {actions.includes("assign") && (
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={busy} onClick={assignToMe}>
            <UserPlus className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Assign to me
          </Button>
        )}
        {actions.includes("approve") && (
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setDialog("approve")}>
            <CheckCircle2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Decide
          </Button>
        )}
        {actions.includes("follow_up") && (
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setDialog("follow_up")}>
            <ListPlus className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Follow up
          </Button>
        )}
      </div>

      <Dialog open={dialog === "follow_up"} onOpenChange={(o) => !o && close()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create a follow-up</DialogTitle>
            <DialogDescription>Linked to {hit.title}. It appears in the staff follow-up register with an audit entry.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="fu-title">What needs to happen</Label>
              <Input id="fu-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Confirm renewal date with the account owner" />
            </div>
            <div>
              <Label htmlFor="fu-notes">Context (optional)</Label>
              <Textarea id="fu-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="fu-due">Due date (optional)</Label>
              <Input id="fu-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button onClick={submitFollowUp} disabled={busy}>{busy ? "Creating…" : "Create follow-up"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "approve"} onOpenChange={(o) => !o && close()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Record a decision</DialogTitle>
            <DialogDescription>{DECISION_BOUNDARY_NOTE}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-2">
              {(["approved", "rejected"] as const).map((d) => (
                <Button
                  key={d}
                  size="sm"
                  variant={decision === d ? "default" : "outline"}
                  onClick={() => setDecision(d)}
                  aria-pressed={decision === d}
                >
                  {d === "approved" ? "Approve" : "Reject"}
                </Button>
              ))}
            </div>
            <div>
              <Label htmlFor="dec-reason">Reason (required, audited)</Label>
              <Textarea id="dec-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button onClick={submitDecision} disabled={busy}>{busy ? "Recording…" : "Record decision"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default ResultActions;
