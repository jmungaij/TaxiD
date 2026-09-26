import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { ListOrdered, ThumbsUp, ThumbsDown, PauseCircle, Plus, CalendarClock } from "lucide-react";
import { toast } from "sonner";

import { StaffPageHeader } from "@/components/staff/primitives";
import { InterviewScheduleDialog } from "@/components/staff/recruitment/InterviewScheduleDialog";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

import * as rec from "@/lib/recruitment/api";
import { daysSince, titleise } from "@/lib/recruitment/types";

/**
 * Shortlisting — ranked candidates per vacancy and the hiring-manager decision
 * that either sends them to interview or closes them out, always with a reason.
 */
export default function RecruitmentShortlist() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const vacancyId = params.get("vacancy") ?? "";

  const vacancies = useQuery({ queryKey: ["rec", "vacancies"], queryFn: rec.listVacancies });
  const applications = useQuery({ queryKey: ["rec", "applications"], queryFn: () => rec.listApplications() });
  const candidates = useQuery({ queryKey: ["rec", "candidates"], queryFn: rec.listCandidates });
  const shortlist = useQuery({ queryKey: ["rec", "shortlist"], queryFn: () => rec.listShortlist() });

  const [decisionTarget, setDecisionTarget] = useState<
    { entry: rec.RecShortlistEntry; decision: "approved" | "rejected" | "hold" } | null
  >(null);
  const [reason, setReason] = useState("");
  const [scheduling, setScheduling] = useState<{ applicationId: string; label: string } | null>(null);


  const candidateName = (id: string) =>
    (candidates.data ?? []).find((c) => c.id === id)?.full_name ?? "Candidate";
  const appById = (id: string) => (applications.data ?? []).find((a) => a.id === id);

  const openVacancies = (vacancies.data ?? []).filter((v) => v.status === "open");
  const effectiveVacancy = vacancyId || openVacancies[0]?.id || "";

  const entries = useMemo(
    () => (shortlist.data ?? []).filter((e) => !effectiveVacancy || e.vacancy_id === effectiveVacancy),
    [shortlist.data, effectiveVacancy],
  );

  /** Screened-through applications that are not yet on the shortlist. */
  const addable = useMemo(
    () =>
      (applications.data ?? []).filter(
        (a) =>
          a.status === "active" &&
          a.stage === "shortlisted" &&
          (!effectiveVacancy || a.vacancy_id === effectiveVacancy) &&
          !(shortlist.data ?? []).some((e) => e.application_id === a.id),
      ),
    [applications.data, shortlist.data, effectiveVacancy],
  );

  const add = useMutation({
    mutationFn: (applicationId: string) => {
      const app = appById(applicationId);
      if (!app) throw new Error("Application not found.");
      return rec.addToShortlist({
        vacancy_id: app.vacancy_id,
        application_id: app.id,
        rank: entries.length + 1,
        reason: "Advanced from screening",
      });
    },
    onSuccess: () => {
      toast.success("Added to the shortlist.");
      qc.invalidateQueries({ queryKey: ["rec"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const decide = useMutation({
    mutationFn: () => {
      if (!decisionTarget) throw new Error("No decision selected.");
      if (!reason.trim()) throw new Error("A shortlist decision needs a reason.");
      return rec.decideShortlist(decisionTarget.entry, decisionTarget.decision, reason.trim());
    },
    onSuccess: () => {
      toast.success("Shortlist decision recorded and audited.");
      setDecisionTarget(null);
      setReason("");
      qc.invalidateQueries({ queryKey: ["rec"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const loading = vacancies.isLoading || applications.isLoading || shortlist.isLoading;

  return (
    <div className="p-6 lg:p-8">
      <StaffPageHeader
        eyebrow="Recruitment 360"
        title="Shortlisting"
        lede="Rank screened candidates per vacancy and record the hiring-manager decision that moves them to interview."
        actions={
          <Select
            value={effectiveVacancy}
            onValueChange={(v) => setParams({ vacancy: v }, { replace: true })}
          >
            <SelectTrigger className="w-[260px]"><SelectValue placeholder="Select vacancy" /></SelectTrigger>
            <SelectContent>
              {openVacancies.map((v) => (
                <SelectItem key={v.id} value={v.id}>{v.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      {loading ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <ListOrdered className="h-4 w-4" aria-hidden="true" /> Shortlist ({entries.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {entries.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground">
                  Nothing shortlisted for this vacancy yet. Advance candidates from Screening, then add them here.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {entries.map((e) => {
                    const app = appById(e.application_id);
                    return (
                      <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">
                            #{e.rank ?? "—"} {app ? candidateName(app.candidate_id) : e.application_id}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {app?.application_no ?? "—"}
                            {app ? ` · ${daysSince(app.stage_entered_at)} day(s) in stage` : ""}
                            {e.reason ? ` · ${e.reason}` : ""}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">{titleise(e.decision ?? "pending")}</Badge>
                          {e.decision === "advanced" ? (
                            <Button
                              size="sm"
                              onClick={() =>
                                setScheduling({
                                  applicationId: e.application_id,
                                  label: app ? candidateName(app.candidate_id) : "Candidate",
                                })
                              }
                            >
                              <CalendarClock className="mr-1 h-4 w-4" aria-hidden="true" /> Schedule interview
                            </Button>
                          ) : (
                            <Button size="sm" onClick={() => setDecisionTarget({ entry: e, decision: "approved" })}>
                              <ThumbsUp className="mr-1 h-4 w-4" aria-hidden="true" /> Approve
                            </Button>
                          )}
                          <Button size="sm" variant="outline" onClick={() => setDecisionTarget({ entry: e, decision: "hold" })}>
                            <PauseCircle className="mr-1 h-4 w-4" aria-hidden="true" /> Hold
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setDecisionTarget({ entry: e, decision: "rejected" })}>
                            <ThumbsDown className="mr-1 h-4 w-4 text-destructive" aria-hidden="true" /> Reject
                          </Button>
                        </div>
                      </li>

                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Ready to shortlist</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {addable.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No screened candidates are waiting to be added.
                </p>
              ) : (
                addable.map((a) => (
                  <div key={a.id} className="flex items-center justify-between gap-2 rounded-md border p-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{candidateName(a.candidate_id)}</p>
                      <p className="text-xs text-muted-foreground">{a.application_no}</p>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => add.mutate(a.id)} disabled={add.isPending}>
                      <Plus className="mr-1 h-4 w-4" aria-hidden="true" /> Add
                    </Button>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <Dialog open={!!decisionTarget} onOpenChange={(o) => !o && setDecisionTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record shortlist decision</DialogTitle>
            <DialogDescription>
              Approving moves the candidate to Interview. Rejecting closes the application. Both are audited with your reason.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="shortlist-reason">Reason</Label>
            <Textarea
              id="shortlist-reason"
              rows={4}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="What drove this decision?"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDecisionTarget(null)}>Cancel</Button>
            <Button onClick={() => decide.mutate()} disabled={decide.isPending}>
              {decide.isPending ? "Recording…" : "Record decision"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <InterviewScheduleDialog
        open={!!scheduling}
        onOpenChange={(o) => !o && setScheduling(null)}
        applicationId={scheduling?.applicationId}
        candidateLabel={scheduling?.label}
      />
    </div>
  );
}

