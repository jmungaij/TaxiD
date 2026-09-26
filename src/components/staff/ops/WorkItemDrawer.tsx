import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/hooks/use-toast";
import { PriorityBadge, QueueBadge, SlaBadge, StateBadge, EntityRef } from "./opsPrimitives";
import {
  applyWorkOutcome, decideWorkApproval, fetchWorkAudit, fetchWorkPropagation, requestWorkApproval,
  transitionWork, type DecoratedWork, type OpsAuditEntry, type OpsPropagationRow,
} from "@/lib/orchestration/api";
import { canTransition, WORK_STATE_LABEL, WORK_TRANSITIONS, type WorkState } from "@/lib/orchestration/workLifecycle";
import {
  APPROVAL_LABEL, canApplyOutcome, canDecideApproval, outcomesFor, type OutcomeSpec,
} from "@/lib/orchestration/outcomes";
import { useAuth } from "@/hooks/useAuth";

/**
 * Work item drawer — every operational screen leads here, and here a person can
 * actually DO something: assign, start, wait, escalate, resolve, close, request
 * and decide authority, and write the outcome back onto the canonical record —
 * each with a recorded reason, an immutable audit entry and downstream
 * propagation to the customer, provider and staff owner.
 */
export default function WorkItemDrawer({
  work,
  open,
  onOpenChange,
  onChanged,
  myStaffId,
}: {
  work: DecoratedWork | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onChanged: () => void;
  myStaffId?: string | null;
}) {
  const { user } = useAuth();
  const [reason, setReason] = useState("");
  const [audit, setAudit] = useState<OpsAuditEntry[]>([]);
  const [propagation, setPropagation] = useState<OpsPropagationRow[]>([]);
  const [busy, setBusy] = useState<WorkState | "authority" | null>(null);

  const refresh = (id: string) => {
    fetchWorkAudit(id).then(setAudit).catch(() => setAudit([]));
    fetchWorkPropagation(id).then(setPropagation).catch(() => setPropagation([]));
  };

  useEffect(() => {
    setReason("");
    if (!work) { setAudit([]); setPropagation([]); return; }
    refresh(work.id);
  }, [work?.id]);

  if (!work) return null;
  const next = WORK_TRANSITIONS[work.lifecycle_state];

  const requestApproval = async () => {
    if (!reason.trim()) {
      toast({ title: "Justification required", description: "Explain why authority is needed.", variant: "destructive" });
      return;
    }
    setBusy("authority");
    const res = await requestWorkApproval(work.id, reason.trim());
    setBusy(null);
    if (!res.ok) { toast({ title: "Request rejected", description: res.error, variant: "destructive" }); return; }
    toast({ title: "Approval requested", description: "A second authorised person must decide." });
    setReason("");
    onChanged();
    refresh(work.id);
  };

  const decide = async (decision: "approved" | "declined") => {
    const check = canDecideApproval({
      approvalState: work.approval_state ?? "not_required",
      requestedBy: work.approval_requested_by,
      actorUserId: user?.id ?? null,
    });
    if (!check.allowed) { toast({ title: "Not allowed", description: check.reason, variant: "destructive" }); return; }
    if (!reason.trim()) {
      toast({ title: "Reason required", description: "An authority decision must carry a reason.", variant: "destructive" });
      return;
    }
    setBusy("authority");
    const res = await decideWorkApproval(work.id, decision, reason.trim());
    setBusy(null);
    if (!res.ok) { toast({ title: "Decision rejected", description: res.error, variant: "destructive" }); return; }
    toast({ title: `Approval ${decision}`, description: "Recorded in the operational audit trail." });
    setReason("");
    onChanged();
    refresh(work.id);
  };

  const applyOutcome = async (spec: OutcomeSpec) => {
    const check = canApplyOutcome({
      spec,
      needsApproval: work.needs_approval,
      approvalState: work.approval_state ?? "not_required",
      alreadyApplied: !!work.writeback_applied_at,
      reason,
    });
    if (!check.allowed) { toast({ title: "Not allowed", description: check.reason, variant: "destructive" }); return; }
    setBusy("authority");
    const res = await applyWorkOutcome(work.id, spec.outcome, reason.trim());
    setBusy(null);
    if (!res.ok) { toast({ title: "Write-back rejected", description: res.error, variant: "destructive" }); return; }
    toast({ title: "Outcome applied", description: "The originating record was updated and the parties notified." });
    setReason("");
    onChanged();
    refresh(work.id);
  };


  const act = async (to: WorkState) => {
    const claim = to === "assigned" || to === "in_progress";
    const check = canTransition(work.lifecycle_state, to, {
      reason,
      assignee: claim ? (work.staff_id ?? myStaffId ?? null) : undefined,
    });
    if (!check.allowed) { toast({ title: "Not allowed", description: check.reason, variant: "destructive" }); return; }

    setBusy(to);
    const res = await transitionWork({
      workItemId: work.id,
      toState: to,
      reason: reason.trim() || undefined,
      assigneeStaffId: claim ? (work.staff_id ?? myStaffId ?? null) : null,
      resolution: to === "resolved" || to === "closed" ? reason.trim() : undefined,
    });
    setBusy(null);
    if (!res.ok) { toast({ title: "Action rejected", description: res.error, variant: "destructive" }); return; }
    toast({ title: `Work moved to ${WORK_STATE_LABEL[to]}`, description: "Recorded in the operational audit trail." });
    setReason("");
    onChanged();
    fetchWorkAudit(work.id).then(setAudit).catch(() => undefined);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="pr-8 text-left text-base">{work.title}</SheetTitle>
        </SheetHeader>

        <div className="mt-4 flex flex-wrap gap-2">
          <QueueBadge queue={work.ops_queue} />
          <StateBadge state={work.lifecycle_state} />
          <PriorityBadge priority={work.priority} />
          <SlaBadge sla={work.sla} />
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Linked record</dt>
            <dd><EntityRef type={work.entity_type} id={work.entity_id} entityRef={work.entity_ref} /></dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Service line</dt>
            <dd>{work.service_line?.replace(/_/g, " ") ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">SLA target</dt>
            <dd>{work.sla_minutes ?? "—"} min</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Escalation level</dt>
            <dd>{work.escalation_level}</dd>
          </div>
        </dl>

        {work.required_action && (
          <div className="mt-5 rounded-lg border bg-muted/40 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Required action</div>
            <p className="mt-1 text-sm">{work.required_action}</p>
          </div>
        )}

        <Separator className="my-5" />

        <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground" htmlFor="ops-reason">
          Reason / decision note
        </label>
        <Textarea
          id="ops-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Required when escalating, pausing, resolving or closing work."
          className="mt-2"
          rows={3}
        />

        <div className="mt-3 flex flex-wrap gap-2">
          {next.length === 0 && <p className="text-sm text-muted-foreground">Closed work cannot be reopened.</p>}
          {next.map((to) => (
            <Button
              key={to}
              size="sm"
              variant={to === "escalated" ? "destructive" : to === "resolved" || to === "closed" ? "default" : "outline"}
              disabled={busy !== null || !user}
              onClick={() => act(to)}
            >
              {busy === to ? "Working…" : WORK_STATE_LABEL[to]}
            </Button>
          ))}
        </div>

        <Separator className="my-5" />

        <h3 className="text-sm font-semibold">Authority &amp; canonical outcome</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {APPROVAL_LABEL[work.approval_state ?? "not_required"]}
          {work.approval_decided_at && ` · decided ${new Date(work.approval_decided_at).toLocaleString()}`}
          {work.writeback_applied_at &&
            ` · outcome ${work.writeback_outcome?.replace(/_/g, " ")} applied ${new Date(work.writeback_applied_at).toLocaleString()}`}
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          {(work.needs_approval || work.approval_state === "requested") &&
            work.approval_state !== "approved" && work.approval_state !== "declined" && (
              <>
                {work.approval_state !== "requested" && (
                  <Button size="sm" variant="outline" disabled={busy !== null} onClick={requestApproval}>
                    Request approval
                  </Button>
                )}
                {work.approval_state === "requested" && (
                  <>
                    <Button size="sm" disabled={busy !== null} onClick={() => decide("approved")}>Approve</Button>
                    <Button size="sm" variant="destructive" disabled={busy !== null} onClick={() => decide("declined")}>
                      Decline
                    </Button>
                  </>
                )}
              </>
            )}
        </div>

        {!work.writeback_applied_at && (
          <div className="mt-3 flex flex-wrap gap-2">
            {outcomesFor(work.entity_type).map((spec) => (
              <Button
                key={spec.outcome}
                size="sm"
                variant={spec.destructive ? "destructive" : "outline"}
                disabled={busy !== null}
                onClick={() => applyOutcome(spec)}
              >
                {spec.label}
                {(spec.requiresApproval || work.needs_approval) && work.approval_state !== "approved" ? " (needs approval)" : ""}
              </Button>
            ))}
          </div>
        )}

        {propagation.length > 0 && (
          <ul className="mt-4 space-y-1 text-xs text-muted-foreground">
            {propagation.map((p) => (
              <li key={p.id}>
                Notified {p.audience} · {p.subject}
              </li>
            ))}
          </ul>
        )}

        <Separator className="my-5" />


        <h3 className="text-sm font-semibold">Operational history</h3>
        <ol className="mt-3 space-y-3">
          {audit.length === 0 && <li className="text-sm text-muted-foreground">No recorded actions yet.</li>}
          {audit.map((a) => (
            <li key={a.id} className="border-l-2 border-primary/30 pl-3">
              <div className="text-xs text-muted-foreground">
                {new Date(a.created_at).toLocaleString()} · {a.actor_name ?? a.actor_role ?? "system"}
              </div>
              <div className="text-sm">
                {a.action.replace(/_/g, " ")}
                {a.state_after && ` → ${a.state_after.replace(/_/g, " ")}`}
              </div>
              {a.reason && <div className="text-xs text-muted-foreground">{a.reason}</div>}
            </li>
          ))}
        </ol>
      </SheetContent>
    </Sheet>
  );
}
