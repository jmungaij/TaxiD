/**
 * Vacancy 360 — the evidence-driven selection console.
 *
 * One surface answers the recruiter's real question for a vacancy with 1,000+
 * applicants: who must I look at next, and why? Everything on screen is derived
 * from persisted state through governed RPCs — the funnel counts, the ranking,
 * the eligibility verdicts and the evidence behind each score.
 *
 * The system ranks and recommends. The recruiter decides, and when the decision
 * contradicts the recommendation the override is captured with its reason.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, FileSearch, Gauge,
  ListChecks, Loader2, ShieldAlert, Sparkles, Users,
} from "lucide-react";
import { toast } from "sonner";

import { StaffPageHeader } from "@/components/staff/primitives";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import { CandidateGovernanceDrawer } from "@/components/recruitment/CandidateGovernanceDrawer";
import { FulfilmentLadder } from "@/components/recruitment/FulfilmentLadder";
import * as rec from "@/lib/recruitment/api";
import * as sel from "@/lib/recruitment/selection";
import * as ful from "@/lib/recruitment/fulfilment";


const PAGE_SIZE = 25;

export default function Vacancy360() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const vacancyId = params.get("vacancy") ?? "";
  const queue = (params.get("queue") ?? "human_review") as sel.QueueKey;

  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<sel.BulkAction | null>(null);
  const [reasonCode, setReasonCode] = useState("");
  const [notes, setNotes] = useState("");
  const [sendFeedback, setSendFeedback] = useState(true);
  const [inspecting, setInspecting] = useState<sel.QueueRow | null>(null);
  const [editingScorecard, setEditingScorecard] = useState(false);
  const [draft, setDraft] = useState<sel.ScorecardCriterion[]>([]);

  const vacancies = useQuery({ queryKey: ["rec", "vacancies"], queryFn: rec.listVacancies });

  useEffect(() => {
    if (!vacancyId && vacancies.data?.length) {
      const next = new URLSearchParams(params);
      next.set("vacancy", vacancies.data[0].id);
      setParams(next, { replace: true });
    }
  }, [vacancyId, vacancies.data, params, setParams]);

  useEffect(() => {
    setPage(0);
    setSelected(new Set());
  }, [vacancyId, queue, search]);

  const vacancy = useMemo(
    () => (vacancies.data ?? []).find((v) => v.id === vacancyId) ?? null,
    [vacancies.data, vacancyId],
  );

  const funnel = useQuery({
    queryKey: ["rec", "funnel", vacancyId],
    queryFn: () => sel.getFunnel(vacancyId),
    enabled: !!vacancyId,
  });

  const scorecard = useQuery({
    queryKey: ["rec", "scorecard", vacancyId],
    queryFn: () => sel.getScorecard(vacancyId),
    enabled: !!vacancyId,
  });

  const queuePage = useQuery({
    queryKey: ["rec", "queue", vacancyId, queue, page, search],
    queryFn: () => sel.getQueue(vacancyId, queue, PAGE_SIZE, page * PAGE_SIZE, search),
    enabled: !!vacancyId,
  });

  const reasons = useQuery({ queryKey: ["rec", "reasons"], queryFn: sel.listRejectionReasons });

  const pipeline = useQuery({
    queryKey: ["rec", "pipeline", vacancyId],
    queryFn: () => ful.getPipelineState(vacancyId),
    enabled: !!vacancyId,
  });


  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["rec", "funnel", vacancyId] });
    qc.invalidateQueries({ queryKey: ["rec", "pipeline", vacancyId] });
    qc.invalidateQueries({ queryKey: ["rec", "queue", vacancyId] });

  };

  const batch = useMutation({
    mutationFn: () => sel.evaluateVacancyBatch(vacancyId, 500),
    onSuccess: (r) => {
      toast.success(`Evaluated ${r.evaluated} applications`, {
        description: r.remaining > 0
          ? `${r.remaining} still awaiting evaluation — run the batch again.`
          : "Every active application for this vacancy now has a current evaluation.",
      });
      refresh();
    },
    onError: (e: Error) => toast.error("Batch evaluation refused", { description: e.message }),
  });

  const publishScorecard = useMutation({
    mutationFn: () => sel.saveScorecard(vacancyId, draft, "Published from Vacancy 360"),
    onSuccess: (r) => {
      toast.success(`Scorecard v${r.version} published`, {
        description: "Re-run evaluation so candidates are scored against the new criteria.",
      });
      setEditingScorecard(false);
      qc.invalidateQueries({ queryKey: ["rec", "scorecard", vacancyId] });
    },
    onError: (e: Error) => toast.error("Scorecard rejected", { description: e.message }),
  });

  const bulk = useMutation({
    mutationFn: () =>
      sel.bulkDecide(
        [...selected],
        pending!,
        reasonCode || null,
        notes || null,
        sendFeedback,
      ),
    onSuccess: (r) => {
      toast.success(`${r.applied} application${r.applied === 1 ? "" : "s"} processed`, {
        description: [
          r.feedback_queued ? `${r.feedback_queued} candidate message(s) queued` : null,
          r.skipped ? `${r.skipped} refused by the workflow` : null,
        ].filter(Boolean).join(" · ") || "Audit records written for every candidate.",
      });
      setPending(null);
      setSelected(new Set());
      setReasonCode("");
      setNotes("");
      refresh();
    },
    onError: (e: Error) => toast.error("Bulk action refused", { description: e.message }),
  });

  const rows = queuePage.data?.rows ?? [];
  const total = queuePage.data?.total ?? 0;
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const overrideCount = pending
    ? rows.filter((r) => selected.has(r.id) && sel.isOverride(pending, r.recommendation)).length
    : 0;
  const actionMeta = sel.BULK_ACTIONS.find((a) => a.key === pending);
  const needsReason = pending === "not_selected";
  const chosenReason = reasons.data?.find((r) => r.code === reasonCode);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const openScorecardEditor = () => {
    setDraft(
      scorecard.data?.criteria.length
        ? scorecard.data.criteria.map((c) => ({ ...c }))
        : sel.defaultCriteria(vacancy?.min_years_experience ?? 3),
    );
    setEditingScorecard(true);
  };

  const draftWeight = sel.scoredWeight(draft);

  return (
    <div className="p-6 lg:p-8">
      <StaffPageHeader
        eyebrow="Recruitment 360"
        title="Vacancy 360 — selection console"
        lede="Evidence-based processing for high-volume vacancies. The system ranks and recommends; the authorised human decides, and every override is recorded with its reason."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={vacancyId}
              onValueChange={(v) => {
                const next = new URLSearchParams(params);
                next.set("vacancy", v);
                setParams(next);
              }}
            >
              <SelectTrigger className="w-[280px]">
                <SelectValue placeholder="Select a vacancy" />
              </SelectTrigger>
              <SelectContent>
                {(vacancies.data ?? []).map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.title} · {v.vacancy_no}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={openScorecardEditor} disabled={!vacancyId}>
              <ListChecks className="mr-2 h-4 w-4" />
              {scorecard.data?.scorecard ? `Scorecard v${scorecard.data.scorecard.version}` : "Configure scorecard"}
            </Button>
            <Button onClick={() => batch.mutate()} disabled={!vacancyId || batch.isPending}>
              {batch.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              Evaluate new applications
            </Button>
          </div>
        }
      />

      {!scorecard.isLoading && vacancyId && !scorecard.data?.scorecard && (
        <Card className="mb-6 border-status-warning/40 bg-status-warning/5">
          <CardContent className="flex items-start gap-3 py-4">
            <ShieldAlert className="mt-0.5 h-5 w-5 text-status-warning" aria-hidden />
            <div className="text-sm">
              <p className="font-semibold">No active scorecard for this vacancy</p>
              <p className="text-muted-foreground">
                Candidates cannot be evaluated until authorised recruitment staff publish the weighted
                criteria and essential requirements for this role. Nothing is scored by guesswork.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <FunnelStrip funnel={funnel.data} loading={funnel.isLoading} />

      <div className="mt-6">
        <FulfilmentLadder state={pipeline.data} loading={pipeline.isLoading} />
      </div>


      <Card className="mt-6">
        <CardHeader className="gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4 text-primary" aria-hidden />
              Review queues
            </CardTitle>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search candidate name"
              className="w-full sm:w-64"
              aria-label="Search candidates in this queue"
            />
          </div>
          <Tabs
            value={queue}
            onValueChange={(v) => {
              const next = new URLSearchParams(params);
              next.set("queue", v);
              setParams(next);
            }}
          >
            <TabsList className="flex h-auto flex-wrap justify-start">
              {sel.QUEUES.map((q) => (
                <TabsTrigger key={q.key} value={q.key} title={q.help} className="text-xs">
                  {q.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <p className="text-xs text-muted-foreground">
            {sel.QUEUES.find((q) => q.key === queue)?.help}
          </p>
        </CardHeader>

        <CardContent>
          {selected.size > 0 && (
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
              <span className="text-sm font-semibold">{selected.size} selected</span>
              {sel.BULK_ACTIONS.map((a) => (
                <Button
                  key={a.key}
                  size="sm"
                  variant={a.key === "not_selected" ? "destructive" : "outline"}
                  onClick={() => setPending(a.key)}
                >
                  {a.label}
                </Button>
              ))}
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                Clear selection
              </Button>
            </div>
          )}

          {queuePage.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No applications in this queue.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Candidates in the {sel.QUEUES.find((q) => q.key === queue)?.label} queue, ranked by evidence score
                </caption>
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="p-2">
                      <Checkbox
                        checked={allChecked}
                        onCheckedChange={(c) =>
                          setSelected(c ? new Set(rows.map((r) => r.id)) : new Set())
                        }
                        aria-label="Select every candidate on this page"
                      />
                    </th>
                    <th scope="col" className="p-2">Candidate</th>
                    <th scope="col" className="p-2">Eligibility</th>
                    <th scope="col" className="p-2">Score</th>
                    <th scope="col" className="p-2">Recommendation</th>
                    <th scope="col" className="p-2">Stage</th>
                    <th scope="col" className="p-2 text-right">Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="p-2">
                        <Checkbox
                          checked={selected.has(r.id)}
                          onCheckedChange={() => toggle(r.id)}
                          aria-label={`Select ${r.full_name}`}
                        />
                      </td>
                      <td className="p-2">
                        <div className="font-medium">{r.full_name}</div>
                        <div className="text-xs text-muted-foreground">
                          {r.application_no}
                          {r.location ? ` · ${r.location}` : ""}
                          {r.years_experience != null ? ` · ${r.years_experience} yrs` : ""}
                        </div>
                      </td>
                      <td className="p-2">
                        {r.eligibility ? (
                          <Badge variant="outline" className={sel.ELIGIBILITY_TONE[r.eligibility]}>
                            {sel.ELIGIBILITY_LABEL[r.eligibility]}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">Not evaluated</span>
                        )}
                      </td>
                      <td className="p-2 font-semibold tabular-nums">
                        {r.weighted_score != null ? `${r.weighted_score}` : "—"}
                      </td>
                      <td className="p-2">
                        {r.recommendation ? (
                          <span className="text-xs">
                            {sel.RECOMMENDATION_LABEL[r.recommendation]}
                            {r.confidence != null && (
                              <span className="text-muted-foreground"> · {r.confidence}</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="p-2 text-xs capitalize">{r.stage.replace(/_/g, " ")}</td>
                      <td className="p-2 text-right">
                        <Button size="sm" variant="ghost" onClick={() => setInspecting(r)}>
                          <FileSearch className="mr-1.5 h-4 w-4" />
                          Inspect evidence
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {total === 0 ? "No records" : `Showing ${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, total)} of ${total}`}
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft className="mr-1 h-4 w-4" /> Previous page
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={(page + 1) * PAGE_SIZE >= total}
                onClick={() => setPage((p) => p + 1)}
              >
                Next page <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* --------------------------------------------- bulk confirmation ---- */}
      <Dialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{actionMeta?.label}: {selected.size} candidates</DialogTitle>
            <DialogDescription>
              {vacancy?.title ?? "This vacancy"} · every candidate receives an immutable decision record
              {needsReason ? " and the approved feedback message for the reason you select." : "."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {overrideCount > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-status-warning/40 bg-status-warning/5 p-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 text-status-warning" aria-hidden />
                <span>
                  {overrideCount} of these decisions contradict the system recommendation. They will be
                  recorded as human overrides against your identity.
                </span>
              </div>
            )}

            {needsReason && (
              <div className="space-y-2">
                <Label htmlFor="reason">Reason code (required)</Label>
                <Select value={reasonCode} onValueChange={setReasonCode}>
                  <SelectTrigger id="reason">
                    <SelectValue placeholder="Select a controlled reason" />
                  </SelectTrigger>
                  <SelectContent>
                    {(reasons.data ?? []).map((r) => (
                      <SelectItem key={r.code} value={r.code}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {chosenReason?.candidate_message && (
                  <p className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
                    <span className="font-semibold">Candidate will read: </span>
                    {chosenReason.candidate_message}
                  </p>
                )}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="notes">Internal note</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Recorded on the audit trail; never shown to the candidate."
              />
            </div>

            {needsReason && (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={sendFeedback} onCheckedChange={(c) => setSendFeedback(!!c)} />
                Queue the approved feedback message to each candidate
              </label>
            )}

            <p className="text-xs text-muted-foreground">
              This action cannot be undone. A candidate who already received this message will not receive
              a second one.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)}>Cancel</Button>
            <Button
              variant={needsReason ? "destructive" : "default"}
              disabled={bulk.isPending || (needsReason && !reasonCode)}
              onClick={() => bulk.mutate()}
            >
              {bulk.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm {actionMeta?.label.toLowerCase()} for {selected.size}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ------------------------------------- governance & action drawer -- */}
      <CandidateGovernanceDrawer
        applicationId={inspecting?.id ?? null}
        candidateName={inspecting?.full_name}
        applicationNo={inspecting?.application_no}
        onClose={() => setInspecting(null)}
        onChanged={() => {
          refresh();
          qc.invalidateQueries({ queryKey: ["rec", "pipeline", vacancyId] });
        }}
      />


      {/* ------------------------------------------------ scorecard editor -- */}
      <Dialog open={editingScorecard} onOpenChange={setEditingScorecard}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Selection scorecard — {vacancy?.title}</DialogTitle>
            <DialogDescription>
              Hard gates are essential requirements and carry no weight. Scored and preferred criteria must
              total exactly 100 points — that is the denominator of every candidate score.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {draft.map((c, i) => (
              <div key={c.code} className="grid grid-cols-12 items-end gap-2 rounded-md border p-3">
                <div className="col-span-12 sm:col-span-4">
                  <Label className="text-xs" htmlFor={`label-${c.code}`}>Criterion</Label>
                  <Input
                    id={`label-${c.code}`}
                    value={c.label}
                    onChange={(e) =>
                      setDraft((d) => d.map((x, xi) => (xi === i ? { ...x, label: e.target.value } : x)))
                    }
                  />
                </div>
                <div className="col-span-6 sm:col-span-3">
                  <Label className="text-xs">Type</Label>
                  <Select
                    value={c.criterion_type}
                    onValueChange={(v) =>
                      setDraft((d) =>
                        d.map((x, xi) =>
                          xi === i
                            ? { ...x, criterion_type: v as sel.CriterionType, weight: v === "hard_gate" || v === "evidence" ? 0 : x.weight }
                            : x,
                        ),
                      )
                    }
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {sel.CRITERION_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>{sel.CRITERION_TYPE_LABEL[t]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-3 sm:col-span-2">
                  <Label className="text-xs" htmlFor={`w-${c.code}`}>Weight</Label>
                  <Input
                    id={`w-${c.code}`}
                    type="number"
                    min={0}
                    max={100}
                    value={c.weight}
                    disabled={c.criterion_type === "hard_gate" || c.criterion_type === "evidence"}
                    onChange={(e) =>
                      setDraft((d) => d.map((x, xi) => (xi === i ? { ...x, weight: Number(e.target.value) } : x)))
                    }
                  />
                </div>
                <div className="col-span-3 sm:col-span-2">
                  <Label className="text-xs" htmlFor={`t-${c.code}`}>Minimum</Label>
                  <Input
                    id={`t-${c.code}`}
                    type="number"
                    value={c.min_threshold ?? ""}
                    onChange={(e) =>
                      setDraft((d) =>
                        d.map((x, xi) =>
                          xi === i ? { ...x, min_threshold: e.target.value === "" ? null : Number(e.target.value) } : x,
                        ),
                      )
                    }
                  />
                </div>
                <div className="col-span-12 sm:col-span-1 text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setDraft((d) => d.filter((_, xi) => xi !== i))}
                    aria-label={`Remove ${c.label}`}
                  >
                    Remove
                  </Button>
                </div>
                <p className="col-span-12 text-xs text-muted-foreground">
                  {sel.CRITERION_TYPE_HELP[c.criterion_type]} Evidence source: {c.evidence_source}.
                </p>
              </div>
            ))}
          </div>

          <DialogFooter className="flex-col items-stretch gap-2 sm:flex-row sm:items-center">
            <span className={cn("text-sm", draftWeight === 100 ? "text-emerald-600" : "text-destructive")}>
              Scored + preferred weight: {draftWeight} / 100
            </span>
            <div className="flex gap-2 sm:ml-auto">
              <Button variant="outline" onClick={() => setEditingScorecard(false)}>Cancel</Button>
              <Button
                disabled={draftWeight !== 100 || publishScorecard.isPending}
                onClick={() => publishScorecard.mutate()}
              >
                {publishScorecard.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Publish scorecard version
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}


function FunnelStrip({ funnel, loading }: { funnel?: sel.VacancyFunnel; loading: boolean }) {
  const steps: Array<{ key: keyof sel.VacancyFunnel; label: string }> = [
    { key: "received", label: "Received" },
    { key: "evaluated", label: "Evaluated" },
    { key: "eligible", label: "Eligible" },
    { key: "recommended", label: "Recommended" },
    { key: "shortlist", label: "Shortlist" },
    { key: "interview", label: "Interview" },
    { key: "offer", label: "Offer" },
    { key: "hired", label: "Hired" },
  ];
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Gauge className="h-4 w-4 text-primary" aria-hidden />
          Processing funnel
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
              {steps.map((s) => (
                <div key={s.key} className="rounded-lg border bg-card p-3">
                  <div className="text-xl font-bold tabular-nums">{funnel?.[s.key] ?? 0}</div>
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{s.label}</div>
                </div>
              ))}
            </div>
            <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
              Every figure is counted from live application and evaluation records.
              {funnel && funnel.review > 0 && ` ${funnel.review} require eligibility review.`}
              {funnel && funnel.ineligible > 0 && ` ${funnel.ineligible} failed an essential requirement.`}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
