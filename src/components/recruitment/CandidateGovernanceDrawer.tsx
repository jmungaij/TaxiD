/**
 * Candidate governance drawer — the full evidence and AI-governance dossier for
 * one application, plus the governed next action for its current stage.
 *
 * Governance rules this surface makes visible rather than implements:
 *   • every recommendation carries its process id, model, scorecard reference,
 *     evidence references and confidence;
 *   • a human decision that contradicts the recommendation is labelled as an
 *     override, with who decided and why;
 *   • the audit history is immutable and rendered exactly as persisted.
 *
 * Each action button calls a governed RPC. If the server refuses (wrong stage,
 * missing authority, blocking check outstanding) the refusal is surfaced verbatim.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgeCheck, Bot, CalendarClock, FileSignature, History, Loader2, Mail,
  ShieldAlert, Sparkles, UserCheck,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

import * as ful from "@/lib/recruitment/fulfilment";
import { ELIGIBILITY_LABEL, ELIGIBILITY_TONE, RECOMMENDATION_LABEL, type Eligibility, type Recommendation } from "@/lib/recruitment/selection";

interface Props {
  applicationId: string | null;
  candidateName?: string | null;
  applicationNo?: string | null;
  onClose: () => void;
  onChanged?: () => void;
}

export function CandidateGovernanceDrawer({
  applicationId, candidateName, applicationNo, onClose, onChanged,
}: Props) {
  const qc = useQueryClient();
  const dossier = useQuery({
    queryKey: ["rec", "governance", applicationId],
    queryFn: () => ful.getApplicationGovernance(applicationId!),
    enabled: !!applicationId,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["rec", "governance", applicationId] });
    onChanged?.();
  };

  const refuse = (label: string) => (e: Error) =>
    toast.error(`${label} refused`, { description: e.message });

  /* ------------------------------------------------------------- actions -- */
  const [note, setNote] = useState("");
  const [interviewAt, setInterviewAt] = useState("");
  const [interviewMode, setInterviewMode] = useState("virtual");
  const [interviewLink, setInterviewLink] = useState("");
  const [panelScore, setPanelScore] = useState("");
  const [panelVerdict, setPanelVerdict] = useState<"advance" | "hold" | "reject">("advance");
  const [salary, setSalary] = useState("");
  const [startDate, setStartDate] = useState("");

  const validate = useMutation({
    mutationFn: (decision: "validated" | "rejected") =>
      ful.validateApplication(applicationId!, decision, note || null),
    onSuccess: (_r, decision) => {
      toast.success(decision === "validated" ? "Application validated" : "Application rejected");
      setNote("");
      invalidate();
    },
    onError: refuse("Validation"),
  });

  const schedule = useMutation({
    mutationFn: () =>
      ful.scheduleInterview(applicationId!, {
        scheduledAt: new Date(interviewAt).toISOString(),
        mode: interviewMode as "virtual" | "onsite" | "phone",
        meetingLink: interviewLink || null,
        instructions: note || null,
      }),
    onSuccess: () => {
      toast.success("Interview scheduled", {
        description: "The candidate invitation is queued once and only once.",
      });
      setInterviewAt("");
      setInterviewLink("");
      invalidate();
    },
    onError: refuse("Scheduling"),
  });

  const submitPanel = useMutation({
    mutationFn: (interviewId: string) =>
      ful.submitInterviewEvaluation(interviewId, {
        overallScore: Number(panelScore),
        recommendation: panelVerdict,
        comments: note || null,
      }),
    onSuccess: () => {
      toast.success("Panel evaluation recorded");
      setPanelScore("");
      setNote("");
      invalidate();
    },
    onError: refuse("Evaluation"),
  });

  const makeOffer = useMutation({
    mutationFn: () =>
      ful.createOffer(applicationId!, {
        baseSalaryCents: Math.round(Number(salary) * 100),
        startDate,
      }),
    onSuccess: (r) => {
      toast.success(`Offer ${r.offer_no} drafted`, {
        description: "Nothing is sent to the candidate until you release it.",
      });
      setSalary("");
      invalidate();
    },
    onError: refuse("Offer creation"),
  });

  const releaseOffer = useMutation({
    mutationFn: (offerId: string) => ful.sendOffer(offerId),
    onSuccess: () => { toast.success("Offer released to the candidate"); invalidate(); },
    onError: refuse("Offer release"),
  });

  const offerResponse = useMutation({
    mutationFn: (v: { offerId: string; response: "accepted" | "declined" }) =>
      ful.recordOfferResponse(v.offerId, v.response, note || null),
    onSuccess: (_r, v) => {
      toast.success(
        v.response === "accepted"
          ? "Acceptance recorded — onboarding case and pre-employment checks opened"
          : "Decline recorded",
      );
      setNote("");
      invalidate();
    },
    onError: refuse("Offer response"),
  });

  const decideCheck = useMutation({
    mutationFn: (v: { id: string; status: "passed" | "failed" | "waived" | "in_progress" }) =>
      ful.decidePreEmploymentCheck(v.id, v.status, { notes: note || null }),
    onSuccess: () => { toast.success("Check updated"); invalidate(); },
    onError: refuse("Check decision"),
  });

  const completeTask = useMutation({
    mutationFn: (id: string) => ful.completeOnboardingTask(id),
    onSuccess: () => { toast.success("Onboarding task complete"); invalidate(); },
    onError: refuse("Task completion"),
  });

  const hire = useMutation({
    mutationFn: (caseId: string) => ful.completeOnboarding(caseId),
    onSuccess: (r) => {
      toast.success(
        r.created ? `Staff record ${r.staff_no} created` : `Already provisioned as ${r.staff_no}`,
        { description: "Staff Register and Staff 360 are populated from a single immutable ledger entry." },
      );
      invalidate();
    },
    onError: refuse("Hire provisioning"),
  });

  const d = dossier.data;
  const evaluation = d?.evaluation ?? null;
  const latestOffer = d?.offers?.[0] ?? null;
  const onboarding = d?.onboarding?.[0] ?? null;
  const openInterview = d?.interviews?.find((i) => (i.evaluations ?? []).length === 0)?.interview as
    | { id: string; scheduled_at?: string; interview_stage?: string }
    | undefined;
  const blockingOpen = (d?.checks ?? []).some(
    (c) => c.is_blocking && c.status !== "passed" && c.status !== "waived",
  );

  return (
    <Sheet open={!!applicationId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{candidateName ?? "Candidate dossier"}</SheetTitle>
          <SheetDescription>
            {applicationNo ? `${applicationNo} · ` : ""}
            Evidence, AI governance and the governed next action. The employment decision stays with an
            authorised human and is recorded against their identity.
          </SheetDescription>
        </SheetHeader>

        {dossier.isLoading ? (
          <div className="mt-6 space-y-2">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
          </div>
        ) : !d ? (
          <p className="mt-6 text-sm text-muted-foreground">No governance record for this application.</p>
        ) : (
          <div className="mt-6 space-y-4">
            {/* --------------------------------------------- AI governance -- */}
            <section className="rounded-lg border p-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Bot className="h-4 w-4 text-primary" aria-hidden />
                AI governance panel
              </h3>
              {!evaluation ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  Not evaluated yet. Run evaluation from the vacancy console so a recommendation exists
                  before any human decision is recorded.
                </p>
              ) : (
                <>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <Badge variant="outline" className={ELIGIBILITY_TONE[evaluation.eligibility as Eligibility]}>
                      {ELIGIBILITY_LABEL[evaluation.eligibility as Eligibility]}
                    </Badge>
                    <span className="text-2xl font-bold tabular-nums">{evaluation.weighted_score ?? "—"}</span>
                    <span className="text-sm text-muted-foreground">/ 100</span>
                    <Badge variant="outline">
                      {RECOMMENDATION_LABEL[evaluation.recommendation as Recommendation] ?? evaluation.recommendation}
                    </Badge>
                  </div>
                  <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                    <Field label="Process identifier" value={evaluation.process_id} mono />
                    <Field label="Model / engine" value={evaluation.model} mono />
                    <Field label="Scorecard reference" value={evaluation.scorecard_ref} mono />
                    <Field
                      label="Confidence"
                      value={evaluation.confidence != null ? String(evaluation.confidence) : "Not stated"}
                    />
                    <Field label="Computed" value={new Date(evaluation.computed_at).toLocaleString()} />
                    <Field label="Evidence facts referenced" value={String(d.evidence.length)} />
                  </dl>
                  <p className="mt-3 text-xs text-muted-foreground">
                    Decision support only. This recommendation cannot advance, reject or hire a candidate on
                    its own.
                  </p>
                </>
              )}
            </section>

            <Accordion type="multiple" className="rounded-lg border px-4">
              <AccordionItem value="evidence">
                <AccordionTrigger className="text-sm">
                  Evidence references ({d.evidence.length})
                </AccordionTrigger>
                <AccordionContent>
                  {d.evidence.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No evidence extracted yet.</p>
                  ) : (
                    <ul className="space-y-2">
                      {d.evidence.map((f) => (
                        <li key={f.id} className="rounded-md border p-2 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium">{f.attribute.replace(/_/g, " ")}</span>
                            <span className="text-muted-foreground">confidence {f.confidence}</span>
                          </div>
                          <p className="text-muted-foreground">
                            {f.value_text ?? f.value_numeric ?? "—"} · {f.source_kind}
                            {f.source_locator ? ` · ${f.source_locator}` : ""} · extracted by {f.extracted_by}
                            {f.verified_by ? " · human verified" : ""}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="recommendations">
                <AccordionTrigger className="text-sm">
                  Recommendations & human overrides ({d.ai_recommendations.length + d.decisions.length})
                </AccordionTrigger>
                <AccordionContent className="space-y-2">
                  {d.ai_recommendations.map((r) => (
                    <div key={r.id} className="rounded-md border p-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold capitalize">{r.kind.replace(/_/g, " ")}: {r.recommendation}</span>
                        <span className="text-muted-foreground">{new Date(r.created_at).toLocaleString()}</span>
                      </div>
                      {r.rationale && <p className="mt-1 text-muted-foreground">{r.rationale}</p>}
                      <p className="mt-1 text-muted-foreground">
                        {r.model ? `Model ${r.model}` : "Model not stated"}
                        {r.confidence != null ? ` · confidence ${r.confidence}` : ""}
                        {r.evidence?.length ? ` · ${r.evidence.length} evidence reference(s)` : ""}
                      </p>
                      {r.human_decision && (
                        <p className="mt-1">
                          Human decision: <span className="font-medium">{r.human_decision}</span>
                          {r.human_decision_at ? ` on ${new Date(r.human_decision_at).toLocaleString()}` : ""}
                          {r.override_reason ? ` — ${r.override_reason}` : ""}
                        </p>
                      )}
                    </div>
                  ))}
                  {d.decisions.map((dec) => (
                    <div key={dec.id} className="rounded-md border p-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold capitalize">{dec.decision.replace(/_/g, " ")}</span>
                        <span className="text-muted-foreground">{new Date(dec.decided_at).toLocaleString()}</span>
                      </div>
                      <p className="mt-1 text-muted-foreground">
                        {dec.decision_role ?? "Decision maker"}
                        {dec.ai_recommendation ? ` · recommendation was ${dec.ai_recommendation}` : ""}
                        {dec.ai_confidence != null ? ` (confidence ${dec.ai_confidence})` : ""}
                        {dec.reason_code ? ` · reason ${dec.reason_code}` : ""}
                      </p>
                      {dec.is_override && (
                        <Badge variant="outline" className="mt-1 border-status-warning/40 text-status-warning">
                          Human override of the recommendation
                        </Badge>
                      )}
                      {dec.reason_notes && <p className="mt-1">{dec.reason_notes}</p>}
                    </div>
                  ))}
                  {d.ai_recommendations.length + d.decisions.length === 0 && (
                    <p className="text-xs text-muted-foreground">Nothing recommended or decided yet.</p>
                  )}
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="messages">
                <AccordionTrigger className="text-sm">
                  Candidate communications ({d.notifications.length})
                </AccordionTrigger>
                <AccordionContent>
                  {d.notifications.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No message queued for this candidate.</p>
                  ) : (
                    <ul className="space-y-2">
                      {d.notifications.map(({ job }) => (
                        <li key={job.id} className="rounded-md border p-2 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium">
                              {job.transition_key.replace(/_/g, " ")} · {job.channel}
                            </span>
                            <Badge variant="outline" className={ful.DELIVERY_TONE[job.status]}>
                              {job.status}
                            </Badge>
                          </div>
                          <p className="text-muted-foreground">
                            {job.recipient} · attempt {job.attempts}
                            {job.delivered_at ? ` · delivered ${new Date(job.delivered_at).toLocaleString()}` : ""}
                            {job.provider_message_id ? ` · ref ${job.provider_message_id}` : ""}
                          </p>
                          {job.last_error && <p className="text-destructive">{job.last_error}</p>}
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">
                    One message per transition per channel. Retries never produce a second candidate email.
                  </p>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="audit">
                <AccordionTrigger className="text-sm">
                  <span className="flex items-center gap-2">
                    <History className="h-3.5 w-3.5" aria-hidden />
                    Immutable audit history ({d.audit.length})
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <ol className="space-y-2 border-l pl-4">
                    {d.audit.map((a, i) => (
                      <li key={`${a.created_at}-${i}`} className="relative text-xs">
                        <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-primary" aria-hidden />
                        <div className="font-medium capitalize">{a.action.replace(/_/g, " ")}</div>
                        <p className="text-muted-foreground">
                          {new Date(a.created_at).toLocaleString()}
                          {a.source ? ` · ${a.source}` : ""}
                          {a.object_type ? ` · ${a.object_type}` : ""}
                        </p>
                      </li>
                    ))}
                    {d.audit.length === 0 && (
                      <li className="text-xs text-muted-foreground">No audit entries yet.</li>
                    )}
                  </ol>
                </AccordionContent>
              </AccordionItem>
            </Accordion>

            {/* ------------------------------------------- governed action -- */}
            <section className="rounded-lg border border-primary/30 bg-primary/5 p-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Sparkles className="h-4 w-4 text-primary" aria-hidden />
                Next governed action
              </h3>

              <div className="mt-3 space-y-2">
                <Label htmlFor="gov-note" className="text-xs">Internal note (recorded on the audit trail)</Label>
                <Textarea id="gov-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
              </div>

              <div className="mt-4 space-y-4">
                {/* Validation */}
                <ActionBlock
                  icon={<BadgeCheck className="h-3.5 w-3.5" aria-hidden />}
                  title="Validation"
                  hint="Confirm the evidence is complete and the candidate meets the essential requirements."
                >
                  <Button size="sm" disabled={validate.isPending} onClick={() => validate.mutate("validated")}>
                    {validate.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                    Validate application
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={validate.isPending}
                    onClick={() => validate.mutate("rejected")}
                  >
                    Reject at validation
                  </Button>
                </ActionBlock>

                {/* Interview */}
                <ActionBlock
                  icon={<CalendarClock className="h-3.5 w-3.5" aria-hidden />}
                  title="Interview"
                  hint="Scheduling queues exactly one candidate invitation with the joining details."
                >
                  <div className="grid w-full gap-2 sm:grid-cols-3">
                    <div>
                      <Label htmlFor="iv-at" className="text-xs">Date & time</Label>
                      <Input id="iv-at" type="datetime-local" value={interviewAt} onChange={(e) => setInterviewAt(e.target.value)} />
                    </div>
                    <div>
                      <Label htmlFor="iv-mode" className="text-xs">Mode</Label>
                      <Select value={interviewMode} onValueChange={setInterviewMode}>
                        <SelectTrigger id="iv-mode"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="virtual">Virtual</SelectItem>
                          <SelectItem value="onsite">On site</SelectItem>
                          <SelectItem value="phone">Telephone</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="iv-link" className="text-xs">Joining link or venue</Label>
                      <Input id="iv-link" value={interviewLink} onChange={(e) => setInterviewLink(e.target.value)} />
                    </div>
                  </div>
                  <Button
                    size="sm"
                    disabled={!interviewAt || schedule.isPending}
                    onClick={() => schedule.mutate()}
                  >
                    {schedule.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                    Schedule interview
                  </Button>
                </ActionBlock>

                {/* Panel evaluation */}
                {openInterview && (
                  <ActionBlock
                    icon={<UserCheck className="h-3.5 w-3.5" aria-hidden />}
                    title="Panel evaluation"
                    hint={`Interview ${openInterview.interview_stage ?? ""} awaiting feedback.`}
                  >
                    <div className="grid w-full gap-2 sm:grid-cols-2">
                      <div>
                        <Label htmlFor="panel-score" className="text-xs">Overall score (0–100)</Label>
                        <Input
                          id="panel-score" type="number" min={0} max={100}
                          value={panelScore} onChange={(e) => setPanelScore(e.target.value)}
                        />
                      </div>
                      <div>
                        <Label htmlFor="panel-verdict" className="text-xs">Panel recommendation</Label>
                        <Select value={panelVerdict} onValueChange={(v) => setPanelVerdict(v as typeof panelVerdict)}>
                          <SelectTrigger id="panel-verdict"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="advance">Advance</SelectItem>
                            <SelectItem value="hold">Hold</SelectItem>
                            <SelectItem value="reject">Reject</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      disabled={panelScore === "" || submitPanel.isPending}
                      onClick={() => submitPanel.mutate(openInterview.id)}
                    >
                      {submitPanel.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                      Submit panel evaluation
                    </Button>
                  </ActionBlock>
                )}

                {/* Offer */}
                <ActionBlock
                  icon={<FileSignature className="h-3.5 w-3.5" aria-hidden />}
                  title="Offer"
                  hint="An offer requires a recorded human final selection. Drafting never notifies the candidate."
                >
                  {latestOffer ? (
                    <div className="w-full rounded-md border bg-card p-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{latestOffer.offer_no}</span>
                        <Badge variant="outline">{latestOffer.status}</Badge>
                      </div>
                      <p className="text-muted-foreground">
                        {ful.money(latestOffer.base_salary_cents, latestOffer.currency)} ·{" "}
                        {latestOffer.employment_type}
                        {latestOffer.start_date ? ` · starts ${latestOffer.start_date}` : ""}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {latestOffer.status === "draft" && (
                          <Button size="sm" disabled={releaseOffer.isPending} onClick={() => releaseOffer.mutate(latestOffer.id)}>
                            <Mail className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                            Release offer to candidate
                          </Button>
                        )}
                        {latestOffer.status === "sent" && (
                          <>
                            <Button
                              size="sm"
                              disabled={offerResponse.isPending}
                              onClick={() => offerResponse.mutate({ offerId: latestOffer.id, response: "accepted" })}
                            >
                              Record acceptance
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={offerResponse.isPending}
                              onClick={() => offerResponse.mutate({ offerId: latestOffer.id, response: "declined" })}
                            >
                              Record decline
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="grid w-full gap-2 sm:grid-cols-2">
                        <div>
                          <Label htmlFor="offer-salary" className="text-xs">Monthly base (KES)</Label>
                          <Input id="offer-salary" type="number" min={0} value={salary} onChange={(e) => setSalary(e.target.value)} />
                        </div>
                        <div>
                          <Label htmlFor="offer-start" className="text-xs">Start date</Label>
                          <Input id="offer-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                        </div>
                      </div>
                      <Button
                        size="sm"
                        disabled={!salary || !startDate || makeOffer.isPending}
                        onClick={() => makeOffer.mutate()}
                      >
                        {makeOffer.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                        Draft offer
                      </Button>
                    </>
                  )}
                </ActionBlock>

                {/* Checks & onboarding */}
                {d.checks.length > 0 && (
                  <ActionBlock
                    icon={<ShieldAlert className="h-3.5 w-3.5" aria-hidden />}
                    title="Pre-employment checks"
                    hint="Blocking checks must clear or be waived before a staff record can be created."
                  >
                    <ul className="w-full space-y-2">
                      {d.checks.map((c) => (
                        <li key={c.id} className="rounded-md border bg-card p-2 text-xs">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-medium">
                              {ful.CHECK_LABEL[c.check_type] ?? c.check_type.replace(/_/g, " ")}
                              {c.is_blocking && <span className="text-destructive"> *</span>}
                            </span>
                            <Badge variant="outline" className={ful.CHECK_TONE[c.status]}>{c.status}</Badge>
                          </div>
                          {c.status !== "passed" && c.status !== "waived" && (
                            <div className="mt-2 flex flex-wrap gap-2">
                              <Button size="sm" variant="outline" onClick={() => decideCheck.mutate({ id: c.id, status: "passed" })}>
                                Mark cleared
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => decideCheck.mutate({ id: c.id, status: "failed" })}>
                                Mark failed
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => decideCheck.mutate({ id: c.id, status: "waived" })}>
                                Waive with reason
                              </Button>
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </ActionBlock>
                )}

                {onboarding && (
                  <ActionBlock
                    icon={<UserCheck className="h-3.5 w-3.5" aria-hidden />}
                    title="Onboarding & hire"
                    hint="Completing onboarding creates the Staff Register and Staff 360 record exactly once."
                  >
                    <ul className="w-full space-y-1">
                      {(onboarding.tasks ?? []).map((t) => (
                        <li key={t.id} className="flex items-center justify-between gap-2 rounded-md border bg-card p-2 text-xs">
                          <span className={cn(t.status === "complete" && "text-muted-foreground line-through")}>
                            {t.title}
                          </span>
                          {t.status === "complete" ? (
                            <Badge variant="outline" className="border-emerald-500/40 text-emerald-700">Done</Badge>
                          ) : (
                            <Button size="sm" variant="ghost" onClick={() => completeTask.mutate(t.id)}>
                              Mark complete
                            </Button>
                          )}
                        </li>
                      ))}
                    </ul>
                    {d.provisioning ? (
                      <p className="text-xs">
                        Provisioned as <span className="font-semibold">{d.provisioning.staff_no}</span> on{" "}
                        {new Date(d.provisioning.provisioned_at).toLocaleString()}.
                      </p>
                    ) : (
                      <Button
                        size="sm"
                        disabled={blockingOpen || hire.isPending}
                        onClick={() => hire.mutate((onboarding.case as { id: string }).id)}
                      >
                        {hire.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                        Complete onboarding and create staff record
                      </Button>
                    )}
                    {blockingOpen && !d.provisioning && (
                      <p className="text-xs text-destructive">
                        A blocking pre-employment check is still outstanding, so the hire cannot be provisioned.
                      </p>
                    )}
                  </ActionBlock>
                )}
              </div>
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ActionBlock({
  icon, title, hint, children,
}: { icon: React.ReactNode; title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide">
        {icon}
        {title}
      </h4>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      <div className="mt-2 flex flex-wrap items-end gap-2">{children}</div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={cn("break-all", mono && "font-mono text-[11px]")}>{value}</dd>
    </div>
  );
}
