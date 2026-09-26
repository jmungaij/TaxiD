import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Briefcase, Info, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { StaffPageHeader } from "@/components/staff/primitives";
import { AdminOnly } from "@/components/auth/AdminOnly";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AreaField, EmptyState, FormDialog, SelectField, StatusPill, TextField, money,
} from "@/components/staff/org/OrgForms";
import { NotificationBell } from "@/components/staff/org/NotificationBell";
import * as org from "@/lib/staff/org/api";
import { CAUSE_CATEGORIES, CORRECTIVE_TRIGGERS, titleise } from "@/lib/staff/org/types";
import type { OrgObjective, StaffMember, StaffWorkItem } from "@/lib/staff/org/types";
import { BUCKET_LABEL, buildQueue, capacitySignal, type ScoredWork, type WorkBucket } from "@/lib/staff/org/priority";

const BUCKETS: WorkBucket[] = ["now", "next", "at_risk", "approval", "waiting", "completed"];

/**
 * MY WORK — one queue per employee, assembled from authoritative records.
 * Sales work points at `commercial_opportunities`; Staff 360 orchestrates the
 * action and records the outcome, but the opportunity itself stays the truth.
 */
export default function WorkQueue() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["org"] });

  const staffQ = useQuery({ queryKey: ["org", "staff"], queryFn: org.listStaff });
  const meQ = useQuery({ queryKey: ["org", "me"], queryFn: org.getMyStaffRecord });
  const [selected, setSelected] = useState<string>("");

  const staff = staffQ.data ?? [];
  const staffId = selected || meQ.data?.id || staff[0]?.id || "";
  const member = staff.find((s) => s.id === staffId) ?? null;

  const workQ = useQuery({ queryKey: ["org", "work", staffId], queryFn: () => org.listWorkItems({ staffId }), enabled: !!staffId });
  const objQ = useQuery({ queryKey: ["org", "objectives", "staff", staffId], queryFn: () => org.listObjectives({ staffId }), enabled: !!staffId });
  const oppQ = useQuery({ queryKey: ["org", "opportunities"], queryFn: org.listOpportunities });

  const items = workQ.data ?? [];
  const queue = useMemo(() => buildQueue(items), [items]);
  const capacity = useMemo(() => capacitySignal(items), [items]);
  const productivity = useMemo(() => org.productivityFrom(items, objQ.data ?? []), [items, objQ.data]);

  const oppById = useMemo(() => new Map((oppQ.data ?? []).map((o) => [o.id, o])), [oppQ.data]);
  const assignedOppIds = useMemo(
    () => new Set(items.filter((i) => i.source_table === "commercial_opportunities").map((i) => i.source_id)),
    [items],
  );
  const unassignedOpps = (oppQ.data ?? []).filter((o) => !assignedOppIds.has(o.id) && !["won", "lost"].includes(o.stage));

  if (staffQ.isLoading) return <Skeleton className="h-72 w-full" />;
  if (staff.length === 0) {
    return (
      <EmptyState
        title="No employees recorded"
        hint="Create employees and appoint them into positions before work can be assigned."
        action={<Button asChild variant="outline"><Link to="/staff/org/people">Open staff register</Link></Button>}
      />
    );
  }

  return (
    <AdminOnly roles={["admin", "super_admin", "compliance_admin", "operations_admin", "finance_admin", "operations_manager", "pricing_manager", "fleet_manager"]}>
      <StaffPageHeader
        eyebrow="Work orchestration"
        title="My work"
        lede="Prioritised from recorded facts — declared priority, SLA, due date, quality flags and objective linkage. No activity monitoring is used."
        actions={
          <div className="flex items-end gap-3">
            <div className="w-64">
              <SelectField
                label="Employee"
                value={staffId}
                onChange={setSelected}
                options={staff.map((s) => ({ value: s.id, label: s.full_name }))}
              />
            </div>
            {/* Live review status for this employee — request, approval, return. */}
            {staffId && <NotificationBell staffId={staffId} onChanged={invalidate} />}
          </div>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Open work" value={String(capacity.openItems)} note={capacity.note} state={capacity.state} />
        <Stat label="At risk" value={String(capacity.atRisk)} note="SLA within 24 h or next action overdue" />
        <Stat label="Completed" value={String(productivity.completed)} note={productivity.avgCycleDays === null ? "Cycle time not measurable yet" : `Average cycle ${productivity.avgCycleDays} d`} />
        <Stat
          label="Objectives achieved"
          value={productivity.objectivesTotal === 0 ? "—" : `${productivity.objectivesAchieved}/${productivity.objectivesTotal}`}
          note={productivity.objectivesTotal === 0 ? "No objectives cascaded to this employee" : "Cascaded objectives with recorded results"}
        />
      </div>

      <Tabs defaultValue="queue">
        <TabsList>
          <TabsTrigger value="queue">Queue</TabsTrigger>
          <TabsTrigger value="sales">Sales pipeline {unassignedOpps.length > 0 && <Badge variant="outline" className="ml-2">{unassignedOpps.length}</Badge>}</TabsTrigger>
        </TabsList>

        <TabsContent value="queue" className="mt-6 space-y-6">
          {items.length === 0 ? (
            <EmptyState
              title="No work assigned"
              hint="Assign an authoritative opportunity from the Sales pipeline tab, or create work from the department surfaces."
            />
          ) : (
            BUCKETS.filter((b) => queue[b].length > 0).map((b) => (
              <Card key={b}>
                <CardHeader><CardTitle className="text-base">{BUCKET_LABEL[b]} · {queue[b].length}</CardTitle></CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Work</TableHead>
                        <TableHead>Source of record</TableHead>
                        <TableHead>Next action</TableHead>
                        <TableHead>Due</TableHead>
                        <TableHead>Priority score</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {queue[b].map((s) => (
                        <WorkRow
                          key={s.item.id}
                          scored={s}
                          opportunity={s.item.source_table === "commercial_opportunities" ? oppById.get(s.item.source_id ?? "") ?? null : null}
                          staff={staff}
                          onSaved={invalidate}
                        />
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="sales" className="mt-6">
          <p className="mb-4 text-sm text-muted-foreground">
            Read from <span className="font-mono">commercial_opportunities</span> — the authoritative Sales OS pipeline.
            Assigning creates a work item that references the opportunity; it never copies it.
          </p>
          {oppQ.isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : unassignedOpps.length === 0 ? (
            <EmptyState title="No unassigned open opportunities" hint="Every open opportunity in the pipeline is already in someone's queue, or the pipeline is empty." />
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Opportunity</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Stage</TableHead>
                      <TableHead>Expected value</TableHead>
                      <TableHead>Probability</TableHead>
                      <TableHead className="text-right">Assign</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {unassignedOpps.map((o) => (
                      <TableRow key={o.id}>
                        <TableCell className="text-sm font-medium">
                          {o.title}
                          <div className="font-mono text-xs text-muted-foreground">{o.opportunity_ref}</div>
                        </TableCell>
                        <TableCell className="text-sm">{o.customer_label ?? titleise(o.customer_kind)}</TableCell>
                        <TableCell><StatusPill value={o.stage} /></TableCell>
                        <TableCell className="text-sm">{money(o.expected_value_cents, o.currency)}</TableCell>
                        <TableCell className="text-sm">{o.probability_pct === null ? "—" : `${o.probability_pct}%`}</TableCell>
                        <TableCell className="text-right">
                          {member && <AssignDialog opportunity={o} member={member} objectives={objQ.data ?? []} onSaved={invalidate} />}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </AdminOnly>
  );
}

/* --------------------------------- pieces -------------------------------- */

function Stat({ label, value, note, state }: { label: string; value: string; note: string; state?: string }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{label}</span>
          {state && state !== "unknown" && <StatusPill value={state === "balanced" ? "active" : state === "overloaded" ? "at_risk" : "open"} className="uppercase" />}
        </div>
        <div className="mt-2 text-2xl font-semibold">{value}</div>
        <p className="mt-1 text-xs text-muted-foreground">{note}</p>
      </CardContent>
    </Card>
  );
}

function WorkRow({
  scored, opportunity, staff, onSaved,
}: { scored: ScoredWork; opportunity: org.SalesOpportunity | null; staff: StaffMember[]; onSaved: () => void }) {
  const { item, score, reasons } = scored;
  return (
    <TableRow>
      <TableCell className="text-sm font-medium">
        {item.title}
        <div className="text-xs text-muted-foreground">{titleise(item.work_kind)}</div>
        {item.review_state !== "not_required" && (
          <div className="mt-1"><StatusPill value={item.review_state === "submitted" ? "in_review" : item.review_state} /></div>
        )}
      </TableCell>
      <TableCell className="font-mono text-xs">
        {item.source_table ? `${item.source_table}${opportunity ? `/${opportunity.opportunity_ref}` : ""}` : "staff_work_items"}
      </TableCell>
      <TableCell className="max-w-xs text-sm">{item.next_action ?? "—"}</TableCell>
      <TableCell className="text-sm">{item.next_action_due ?? "—"}</TableCell>
      <TableCell>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex cursor-help items-center gap-1 text-sm font-semibold">
              {score}<Info className="h-3 w-3 text-muted-foreground" />
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <ul className="list-disc space-y-1 pl-4 text-xs">
              {reasons.map((r) => <li key={r}>{r}</li>)}
            </ul>
          </TooltipContent>
        </Tooltip>
      </TableCell>
      <TableCell><StatusPill value={item.status} /></TableCell>
      <TableCell>
        <div className="flex flex-wrap justify-end gap-2">
          {item.review_state === "submitted"
            ? <ReviewDecisionDialog item={item} onSaved={onSaved} />
            : item.status === "done"
              ? <ReviewHistory item={item} staff={staff} />
              : <SubmitReviewDialog item={item} staff={staff} onSaved={onSaved} />}
          {item.status !== "done" && <CorrectiveDialog item={item} staff={staff} onSaved={onSaved} />}
          {opportunity && item.status !== "done" && (
            <ProgressDialog item={item} opportunity={opportunity} onSaved={onSaved} />
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

/** Employee submits work for their manager's documented decision. */
function SubmitReviewDialog({
  item, staff, onSaved,
}: { item: StaffWorkItem; staff: StaffMember[]; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const owner = staff.find((s) => s.id === item.staff_id) ?? null;
  const [reviewer, setReviewer] = useState(owner?.manager_staff_id ?? "");
  const [note, setNote] = useState("");

  const save = useMutation({
    mutationFn: () => org.submitForReview(item, reviewer || null, note),
    onSuccess: () => { onSaved(); toast.success("Submitted for manager review"); setOpen(false); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      busy={save.isPending}
      trigger={<Button size="sm" variant="outline">Submit for review</Button>}
      title="Submit work for review"
      description="The work stays open until a manager records an approval or a return with a documented reason."
      submitLabel="Submit"
      onSubmit={async () => { await save.mutateAsync(); }}
    >
      <SelectField
        label="Reviewer"
        value={reviewer}
        onChange={setReviewer}
        options={staff.filter((s) => s.id !== item.staff_id).map((s) => ({ value: s.id, label: s.full_name }))}
        hint={owner?.manager_staff_id ? "Defaults to the recorded reporting manager." : "No reporting manager recorded on this employee."}
      />
      <AreaField label="What was delivered" value={note} onChange={setNote} placeholder="Quote issued and signed by the customer's procurement lead; contract sent for counter-signature." />
    </FormDialog>
  );
}

/** Manager approves or returns, with a mandatory documented rationale. */
function ReviewDecisionDialog({ item, onSaved }: { item: StaffWorkItem; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [decision, setDecision] = useState<"approved" | "returned" | "changes_requested">("approved");
  const [rationale, setRationale] = useState("");
  const [requiredAction, setRequiredAction] = useState("");
  const [rating, setRating] = useState("");

  const reviewsQ = useQuery({
    queryKey: ["org", "reviews", item.id],
    queryFn: () => org.listWorkReviews({ workItemId: item.id }),
    enabled: open,
  });

  const save = useMutation({
    mutationFn: () => org.decideWorkReview(item, {
      decision,
      rationale,
      requiredAction: decision === "approved" ? null : requiredAction,
      qualityRating: (rating || null) as "good" | "rework" | "escalated" | null,
    }),
    onSuccess: () => { onSaved(); toast.success(decision === "approved" ? "Work approved" : "Returned to the employee"); setOpen(false); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      busy={save.isPending}
      trigger={<Button size="sm">Review</Button>}
      title="Manager review decision"
      description="Approval closes the work item. A return sends it back flagged as rework and counted in the productivity baseline."
      submitLabel="Record decision"
      onSubmit={async () => { await save.mutateAsync(); }}
    >
      <SelectField
        label="Decision"
        value={decision}
        onChange={(v) => setDecision(v as typeof decision)}
        options={[
          { value: "approved", label: "Approve" },
          { value: "returned", label: "Return — not acceptable" },
          { value: "changes_requested", label: "Return — changes requested" },
        ]}
      />
      <SelectField
        label="Quality rating"
        value={rating}
        onChange={setRating}
        options={[
          { value: "good", label: "Good" },
          { value: "rework", label: "Rework" },
          { value: "escalated", label: "Escalated" },
        ]}
        hint="Defaults to good on approval, rework on return."
      />
      <AreaField label="Rationale (required)" value={rationale} onChange={setRationale} placeholder="Pricing matches the approved corporate rate card and the discount sits inside the delegated limit." />
      {decision !== "approved" && (
        <AreaField label="Required action (required)" value={requiredAction} onChange={setRequiredAction} placeholder="Reissue the quote with the fuel surcharge itemised, then resubmit." />
      )}
      <div className="sm:col-span-2">
        <div className="mb-1 text-xs font-medium text-muted-foreground">Review history</div>
        {reviewsQ.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : (reviewsQ.data ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground">No prior decision recorded.</p>
        ) : (
          <ul className="space-y-1 text-xs">
            {(reviewsQ.data ?? []).map((r) => (
              <li key={r.id} className="rounded border p-2">
                <span className="font-medium">{titleise(r.decision)}</span>
                <span className="text-muted-foreground"> · {new Date(r.created_at).toLocaleString("en-KE")}</span>
                <div>{r.rationale}</div>
                {r.required_action && <div className="text-muted-foreground">Required: {r.required_action}</div>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </FormDialog>
  );
}

function ReviewHistory({ item, staff }: { item: StaffWorkItem; staff: StaffMember[] }) {
  const [open, setOpen] = useState(false);
  const reviewsQ = useQuery({
    queryKey: ["org", "reviews", item.id],
    queryFn: () => org.listWorkReviews({ workItemId: item.id }),
    enabled: open,
  });
  const name = (id: string | null) => (id ? staff.find((s) => s.id === id)?.full_name ?? "—" : "—");
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={<Button size="sm" variant="ghost">Decisions</Button>}
      title="Documented decisions"
      description={item.title}
      submitLabel="Close"
      onSubmit={() => undefined}
    >
      <div className="sm:col-span-2">
        {reviewsQ.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : (reviewsQ.data ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground">This work was closed without a manager review.</p>
        ) : (
          <ul className="space-y-2 text-xs">
            {(reviewsQ.data ?? []).map((r) => (
              <li key={r.id} className="rounded border p-2">
                <div className="font-medium">{titleise(r.decision)} · {name(r.reviewer_staff_id)}</div>
                <div className="text-muted-foreground">{new Date(r.created_at).toLocaleString("en-KE")}</div>
                <div className="mt-1">{r.rationale}</div>
                {r.required_action && <div className="text-muted-foreground">Required: {r.required_action}</div>}
                <div className="mt-1 font-mono text-[10px] text-muted-foreground">{r.source_of_record}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </FormDialog>
  );
}

/** Report rework or blocked work with cause, evidence and measured impact. */
function CorrectiveDialog({
  item, staff, onSaved,
}: { item: StaffWorkItem; staff: StaffMember[]; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [trigger, setTrigger] = useState<"rework" | "blocked" | "escalated" | "sla_breach">("blocked");
  const [cause, setCause] = useState<string>("dependency_delay");
  const [description, setDescription] = useState("");
  const [evidence, setEvidence] = useState("");
  const [days, setDays] = useState("");
  const [valueKes, setValueKes] = useState("");
  const [action, setAction] = useState("");
  const [owner, setOwner] = useState(item.staff_id ?? "");
  const [due, setDue] = useState("");

  const save = useMutation({
    mutationFn: () => org.reportCorrectiveAction(item, {
      triggerKind: trigger,
      causeCategory: cause,
      causeDescription: description,
      evidenceNote: evidence,
      impactDays: days ? Number(days) : null,
      impactValueCents: valueKes ? Math.round(Number(valueKes) * 100) : null,
      correctiveAction: action,
      ownerStaffId: owner || null,
      dueDate: due || null,
    }),
    onSuccess: () => { onSaved(); toast.success("Corrective action logged against the objective and work history"); setOpen(false); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      busy={save.isPending}
      trigger={<Button size="sm" variant="outline"><ShieldAlert className="mr-2 h-4 w-4" />Report rework / blocked</Button>}
      title="Report rework or blocked work"
      description={item.objective_id
        ? "The cause, evidence and impact are recorded against this work item and the objective it serves."
        : "This work is not linked to an objective, so the impact will be recorded against the work history only."}
      submitLabel="Log corrective action"
      onSubmit={async () => { await save.mutateAsync(); }}
    >
      <SelectField
        label="Trigger"
        value={trigger}
        onChange={(v) => setTrigger(v as typeof trigger)}
        options={CORRECTIVE_TRIGGERS.map((t) => ({ value: t, label: titleise(t) }))}
      />
      <SelectField
        label="Cause"
        value={cause}
        onChange={setCause}
        options={CAUSE_CATEGORIES.map((c) => ({ value: c, label: titleise(c) }))}
      />
      <AreaField label="What happened (required)" value={description} onChange={setDescription} placeholder="Quote could not be issued: the corporate rate card for Nakuru routes has no approved rate, so pricing had to escalate." />
      <AreaField label="Evidence" value={evidence} onChange={setEvidence} placeholder="Reference the record, email or approval that proves the cause." />
      <TextField label="Time lost (days)" type="number" value={days} onChange={setDays} hint="Leave empty rather than guessing." />
      <TextField label="Value at risk (KES)" type="number" value={valueKes} onChange={setValueKes} hint="Only the amount evidenced on the authoritative record." />
      <AreaField label="Corrective action proposed" value={action} onChange={setAction} placeholder="Publish an approved Nakuru rate band so quotes do not need escalation." />
      <SelectField
        label="Action owner"
        value={owner}
        onChange={setOwner}
        options={staff.map((s) => ({ value: s.id, label: s.full_name }))}
      />
      <TextField label="Due date" type="date" value={due} onChange={setDue} />
    </FormDialog>
  );
}


function AssignDialog({
  opportunity, member, objectives, onSaved,
}: { opportunity: org.SalesOpportunity; member: StaffMember; objectives: OrgObjective[]; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [nextAction, setNextAction] = useState("Contact customer and qualify requirement");
  const [due, setDue] = useState("");
  const [objectiveId, setObjectiveId] = useState("");

  const save = useMutation({
    mutationFn: () => org.assignOpportunity(opportunity, member, { objectiveId: objectiveId || null, nextAction, due: due || null }),
    onSuccess: () => { onSaved(); toast.success(`Assigned to ${member.full_name}`); setOpen(false); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      busy={save.isPending}
      trigger={<Button size="sm" variant="outline"><Briefcase className="mr-2 h-4 w-4" />Assign</Button>}
      title={`Assign ${opportunity.opportunity_ref}`}
      description="Ownership is written back to the authoritative opportunity; the work item tracks the execution."
      submitLabel="Assign work"
      onSubmit={async () => { await save.mutateAsync(); }}
    >
      <TextField label="Next action" value={nextAction} onChange={setNextAction} />
      <TextField label="Next action due" type="date" value={due} onChange={setDue} />
      <SelectField
        label="Link to objective"
        value={objectiveId}
        onChange={setObjectiveId}
        options={objectives.map((o) => ({ value: o.id, label: `${o.title} (${o.kpi_label})` }))}
        hint="Linking makes the outcome countable against a cascaded objective."
      />
    </FormDialog>
  );
}

function ProgressDialog({
  item, opportunity, onSaved,
}: { item: StaffWorkItem; opportunity: org.SalesOpportunity; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const currentIdx = org.OPPORTUNITY_STAGES.indexOf(opportunity.stage as (typeof org.OPPORTUNITY_STAGES)[number]);
  const [stage, setStage] = useState(org.OPPORTUNITY_STAGES[Math.min(currentIdx + 1, org.OPPORTUNITY_STAGES.length - 1)] as string);
  const [note, setNote] = useState("");

  const save = useMutation({
    mutationFn: async () => {
      if (!note.trim()) throw new Error("Record what happened — the outcome note is the audit evidence.");
      return org.progressOpportunity(item, opportunity.id, stage, note.trim());
    },
    onSuccess: () => { onSaved(); toast.success(`Opportunity moved to ${titleise(stage)}`); setOpen(false); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      busy={save.isPending}
      trigger={<Button size="sm">Progress</Button>}
      title={`Progress ${opportunity.opportunity_ref}`}
      description={`Current stage: ${titleise(opportunity.stage)}. The stage change is written to the Sales OS record.`}
      submitLabel="Save progress"
      onSubmit={async () => { await save.mutateAsync(); }}
    >
      <SelectField
        label="New stage"
        value={stage}
        onChange={setStage}
        options={org.OPPORTUNITY_STAGES.map((s) => ({ value: s, label: titleise(s) }))}
      />
      <AreaField label="Outcome note" value={note} onChange={setNote} placeholder="Met the procurement lead; requirement confirmed for 40 monthly airport transfers." />
    </FormDialog>
  );
}
