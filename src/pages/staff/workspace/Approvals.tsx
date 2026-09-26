/**
 * STAGE 11 — APPROVALS.
 *
 * Proposals, contracts and service orders that are held at the internal gate.
 * A manager records the decision here; the database moves the underlying
 * record and the work queue picks the change up on the next read. Nobody who
 * is not an approver ever sees a decision control.
 */
import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, Loader2, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useWorkspaceIntelligence } from "@/hooks/useWorkspaceIntelligence";
import { WorkspaceEmptyState } from "@/components/staff/workspace/WorkspaceEmptyState";
import {
  APPROVAL_ENTITY_LABEL,
  approvalReading,
  decideApproval,
  type ApprovalRecord,
} from "@/lib/workspace/approvals";
import { cn } from "@/lib/utils";

const money = (cents: number | null, currency: string) =>
  cents == null ? null : `${currency} ${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const ENTITY_PATH: Record<ApprovalRecord["entity_type"], string> = {
  proposal: "/staff/workspace/book?tab=proposals",
  contract: "/staff/workspace/book?tab=contracts",
  service_order: "/staff/workspace/book?tab=orders",
};

function ApprovalCard({
  approval,
  canApprove,
  highlighted,
  onDecided,
}: {
  approval: ApprovalRecord;
  canApprove: boolean;
  highlighted: boolean;
  onDecided: () => void;
}) {
  const { toast } = useToast();
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState<"approved" | "declined" | null>(null);
  const reading = approvalReading(approval);
  const amount = money(approval.amount_cents, approval.currency);

  const decide = async (decision: "approved" | "declined") => {
    setBusy(decision);
    try {
      await decideApproval(approval.id, decision, note.trim() || null);
      toast({
        title: decision === "approved" ? "Approved" : "Declined",
        description: approval.title,
      });
      onDecided();
    } catch (e) {
      toast({
        title: "The decision was not recorded",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card
      className={cn(
        "border-l-4",
        reading.tone === "risk" ? "border-l-destructive" : reading.tone === "watch" ? "border-l-primary" : "border-l-border",
        highlighted && "ring-2 ring-ring",
      )}
    >
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="text-[10px]">
            {APPROVAL_ENTITY_LABEL[approval.entity_type]}
          </Badge>
          <Badge variant={reading.tone === "risk" ? "destructive" : "secondary"} className="text-[10px]">
            {reading.label}
          </Badge>
          {amount && <span className="text-sm font-semibold tabular-nums">{amount}</span>}
        </div>

        <div>
          <p className="text-sm font-medium">{approval.title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Raised {approval.created_at.slice(0, 10)}
            {approval.entity_ref ? ` · ${approval.entity_ref}` : ""}
          </p>
          {approval.justification && <p className="mt-1.5 text-sm">{approval.justification}</p>}
          {approval.decision_note && (
            <p className="mt-1.5 text-sm text-muted-foreground">Decision note: {approval.decision_note}</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm" variant="outline">
            <Link to={ENTITY_PATH[approval.entity_type]}>Open the record</Link>
          </Button>
        </div>

        {canApprove && approval.status === "pending" && (
          <div className="space-y-2 rounded-md border bg-muted/30 p-3">
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Why you are approving or declining (recorded with the decision)"
              rows={2}
              className="text-sm"
            />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void decide("approved")} disabled={busy !== null}>
                {busy === "approved" ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <CheckCircle2 className="mr-1 h-3.5 w-3.5" aria-hidden />
                )}
                Approve
              </Button>
              <Button size="sm" variant="destructive" onClick={() => void decide("declined")} disabled={busy !== null}>
                {busy === "declined" ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <XCircle className="mr-1 h-3.5 w-3.5" aria-hidden />
                )}
                Decline
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function WorkspaceApprovals() {
  const intel = useWorkspaceIntelligence();
  const [params] = useSearchParams();
  const focused = params.get("approval");

  const pending = intel.approvals.filter((a) => a.status === "pending");
  const decided = intel.approvals.filter((a) => a.status !== "pending");

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Approvals</h1>
          <p className="text-sm text-muted-foreground">
            {intel.canApprove
              ? `${pending.length} record${pending.length === 1 ? "" : "s"} waiting on your decision.`
              : `${pending.length} of your record${pending.length === 1 ? " is" : "s are"} waiting on a manager.`}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={intel.reload} disabled={intel.loading}>
          {intel.loading ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden />
          )}
          Refresh
        </Button>
      </header>

      {intel.canApprove && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex items-start gap-2 py-3 text-sm">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
            <p className="text-muted-foreground">
              You are an approver. Approving a proposal releases it to the customer, approving a contract makes it
              active, and approving a service order releases it for delivery.
            </p>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending">Waiting ({pending.length})</TabsTrigger>
          <TabsTrigger value="decided">Decided ({decided.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="mt-4 space-y-3">
          {pending.length === 0 ? (
            <WorkspaceEmptyState
              title="Nothing is waiting for approval"
              message="Send a proposal, contract or service order for approval from your commercial book."
              actions={[{ label: "Open my commercial book", to: "/staff/workspace/book" }]}
            />
          ) : (
            pending.map((a) => (
              <ApprovalCard
                key={a.id}
                approval={a}
                canApprove={intel.canApprove}
                highlighted={a.id === focused}
                onDecided={intel.reload}
              />
            ))
          )}
        </TabsContent>

        <TabsContent value="decided" className="mt-4 space-y-3">
          {decided.length === 0 ? (
            <WorkspaceEmptyState title="No decision recorded yet" message="Decisions appear here with their note." />
          ) : (
            decided.map((a) => (
              <ApprovalCard
                key={a.id}
                approval={a}
                canApprove={false}
                highlighted={a.id === focused}
                onDecided={intel.reload}
              />
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
