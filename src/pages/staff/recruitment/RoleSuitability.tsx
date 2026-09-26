import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, CircleDashed, ClipboardList, ShieldAlert, XCircle } from "lucide-react";

import { StaffPageHeader } from "@/components/staff/primitives";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";

import { BAND_LABEL, type ScoreBand } from "@/lib/recruitment/assessmentScoring";
import {
  approveForOffer, declineCandidate, decisionFor, loadHiringDecisions, loadRequirementSet,
  loadRoleCandidates, loadRoleOffers, suitabilityOf, DECLINE_REASONS,
  type HiringDecision, type RoleCandidate, type RoleOffer, type SuitabilityVerdict,
} from "@/lib/recruitment/suitability";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

/**
 * Role suitability — the requirement set for a role, every candidate's score
 * against each requirement, and who is suitable.
 *
 * Scores, bands and the pass/fail on each minimum come from the assessment
 * engine in the database. A candidate with no assessment shows as not assessed;
 * nothing is inferred from a CV, an interview note or a hiring decision.
 */

const VERDICT: Record<SuitabilityVerdict, { label: string; className: string; Icon: typeof CheckCircle2 }> = {
  SUITABLE: { label: "Suitable", className: "bg-success/15 text-success", Icon: CheckCircle2 },
  NOT_SUITABLE: { label: "Not suitable", className: "bg-destructive/10 text-destructive", Icon: XCircle },
  IN_PROGRESS: { label: "In progress", className: "bg-warning/15 text-warning", Icon: CircleDashed },
  NOT_ASSESSED: { label: "Not assessed", className: "bg-muted text-muted-foreground", Icon: ShieldAlert },
};

export default function RoleSuitability() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [vacancyId, setVacancyId] = useState<string>("");
  const [basis, setBasis] = useState("Competency validation against the published role requirements");

  const vacancies = useQuery({
    queryKey: ["rec", "suitability-vacancies"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rec_vacancies")
        .select("id, title, vacancy_no, status")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  const selected = vacancyId || vacancies.data?.find((v) => v.title.toLowerCase().includes("corporate sales"))?.id || vacancies.data?.[0]?.id || "";

  const requirements = useQuery({
    queryKey: ["rec", "requirement-set", selected],
    queryFn: () => loadRequirementSet(selected),
    enabled: Boolean(selected),
  });

  const candidates = useQuery({
    queryKey: ["rec", "role-candidates", selected],
    queryFn: () => loadRoleCandidates(selected),
    enabled: Boolean(selected),
  });

  const openSession = useMutation({
    mutationFn: async (applicationId: string) => {
      const { data, error } = await supabase.rpc("rec_role_assessment_session_open" as never, {
        p_application_id: applicationId,
        p_basis: basis,
      } as never);
      if (error) throw new Error(error.message);
      return data as unknown as { interview_id: string };
    },
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ["rec", "role-candidates", selected] });
      navigate(`/staff/recruitment/assessment/${res.interview_id}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const decisions = useQuery({
    queryKey: ["rec", "hiring-decisions", selected],
    queryFn: () => loadHiringDecisions(selected),
    enabled: Boolean(selected),
  });

  const offers = useQuery({
    queryKey: ["rec", "role-offers", selected],
    queryFn: () => loadRoleOffers(selected),
    enabled: Boolean(selected),
  });

  const refreshDecisions = () => {
    void qc.invalidateQueries({ queryKey: ["rec", "hiring-decisions", selected] });
    void qc.invalidateQueries({ queryKey: ["rec", "role-candidates", selected] });
    void qc.invalidateQueries({ queryKey: ["rec", "role-offers", selected] });
  };

  const approve = useMutation({
    mutationFn: (v: { applicationId: string; notes: string }) => approveForOffer(v.applicationId, v.notes),
    onSuccess: () => {
      toast.success("Approved for a job offer. Raise the offer in Offer management.");
      refreshDecisions();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const decline = useMutation({
    mutationFn: (v: { applicationId: string; reasonCode: string; notes: string }) =>
      declineCandidate(v.applicationId, v.reasonCode, v.notes),
    onSuccess: () => {
      toast.success("Decision recorded — the candidate was not selected.");
      refreshDecisions();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reqs = requirements.data?.requirements ?? [];
  const rows = candidates.data ?? [];
  const decisionRows = decisions.data ?? [];
  const offerRows = offers.data ?? [];

  const summary = useMemo(() => {
    const counts: Record<SuitabilityVerdict, number> = { SUITABLE: 0, NOT_SUITABLE: 0, IN_PROGRESS: 0, NOT_ASSESSED: 0 };
    for (const r of rows) counts[suitabilityOf(r).verdict] += 1;
    return counts;
  }, [rows]);

  const approvedCount = decisionRows.filter((d) => d.decision === "selected").length;

  return (
    <div className="space-y-6">
      <StaffPageHeader
        title="Role suitability"
        lede="Score each candidate against the role's published requirements and see who is suitable. Every score is recorded against the requirement it answers."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ClipboardList className="h-4 w-4" aria-hidden="true" />
            Role &amp; requirement set
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="role">Role</Label>
              <Select value={selected} onValueChange={setVacancyId}>
                <SelectTrigger id="role"><SelectValue placeholder="Choose a role" /></SelectTrigger>
                <SelectContent>
                  {(vacancies.data ?? []).map((v) => (
                    <SelectItem key={v.id} value={v.id}>{v.title} · {v.vacancy_no}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="basis">Why this assessment is being held</Label>
              <Input id="basis" value={basis} onChange={(e) => setBasis(e.target.value)} />
            </div>
          </div>

          {requirements.isLoading ? (
            <Skeleton className="h-24" />
          ) : !requirements.data ? (
            <p className="text-sm text-muted-foreground">
              This role has no published requirement set yet, so nobody can be scored against it.
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                {requirements.data.title} · version {requirements.data.version} · {requirements.data.status} ·{" "}
                {requirements.data.total_marks} marks across {reqs.length} requirements
              </p>
              <ol className="space-y-2">
                {reqs.map((r) => (
                  <li key={r.competency_code} className="rounded-md border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{r.competency_label}</span>
                      <Badge variant="outline">out of {r.max_marks}</Badge>
                      {r.critical_min != null && <Badge variant="outline">minimum {r.critical_min}</Badge>}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{r.prompt}</p>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Candidates ({rows.length}) — {summary.SUITABLE} suitable, {summary.NOT_SUITABLE} not suitable,{" "}
            {summary.IN_PROGRESS} in progress, {summary.NOT_ASSESSED} not assessed · {approvedCount} approved for an offer
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {candidates.isLoading ? (
            <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No applications recorded against this role.</p>
          ) : (
            rows.map((c) => (
              <CandidateRow
                key={c.application_id}
                candidate={c}
                requirements={reqs}
                decision={decisionFor(decisionRows, c.application_id)}
                offer={offerRows.find((o) => o.application_id === c.application_id) ?? null}
                onScore={() => openSession.mutate(c.application_id)}
                busy={openSession.isPending}
                onApprove={(notes) => approve.mutate({ applicationId: c.application_id, notes })}
                onDecline={(reasonCode, notes) => decline.mutate({ applicationId: c.application_id, reasonCode, notes })}
                deciding={approve.isPending || decline.isPending}
              />
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CandidateRow({
  candidate, requirements, decision, offer, onScore, busy, onApprove, onDecline, deciding,
}: {
  candidate: RoleCandidate;
  requirements: { competency_code: string; competency_label: string; max_marks: number; critical_min: number | null }[];
  decision: HiringDecision | null;
  offer: RoleOffer | null;
  onScore: () => void;
  busy: boolean;
  onApprove: (notes: string) => void;
  onDecline: (reasonCode: string, notes: string) => void;
  deciding: boolean;
}) {
  const verdict = suitabilityOf(candidate);
  const v = VERDICT[verdict.verdict];
  const a = candidate.assessment;
  const canApprove = verdict.verdict === "SUITABLE" && decision?.decision !== "selected";
  const closed = decision?.decision === "not_selected";

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium">{candidate.candidate_name}</p>
          <p className="text-sm text-muted-foreground">
            {candidate.stage.replace(/_/g, " ")} · {candidate.status}
            {a?.assessor_name ? ` · assessed by ${a.assessor_name}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge className={v.className}><v.Icon className="mr-1 h-3 w-3" aria-hidden="true" />{v.label}</Badge>
          {decision?.decision === "selected" && (
            <Badge className="bg-success/15 text-success">Approved for an offer</Badge>
          )}
          {closed && <Badge className="bg-destructive/10 text-destructive">Not selected</Badge>}
          {offer && <Badge variant="outline">Offer {offer.offer_no} · {offer.status}</Badge>}
          <Button size="sm" variant={a ? "outline" : "default"} onClick={onScore} disabled={busy} data-analytics="rec-role-score">
            {a ? "Open scoring" : "Score against the requirements"}
          </Button>
          {canApprove && (
            <ApprovalDialog
              name={candidate.candidate_name}
              summary={
                a
                  ? `${a.total_score ?? 0} / ${a.max_score}${a.percentage != null ? ` (${a.percentage}%)` : ""}`
                  : "no assessment"
              }
              busy={deciding}
              onApprove={onApprove}
            />
          )}
          {!closed && decision?.decision !== "selected" && (
            <DeclineDialog name={candidate.candidate_name} busy={deciding} onDecline={onDecline} />
          )}
        </div>
      </div>

      <p className="text-sm">{verdict.reason}</p>

      {decision && (
        <p className="text-sm text-muted-foreground">
          {decision.decision === "selected" ? "Approved for a job offer" : "Not selected"}
          {decision.decided_at ? ` on ${new Date(decision.decided_at).toLocaleString("en-KE")}` : ""}
          {decision.reason_code ? ` · reason: ${decision.reason_code.replace(/_/g, " ")}` : ""}
          {decision.reason_notes ? ` · ${decision.reason_notes}` : ""}
        </p>
      )}

      {verdict.verdict !== "SUITABLE" && decision?.decision !== "selected" && (
        <p className="text-sm text-muted-foreground">
          A job offer can only be approved once every required minimum is met and the assessor has recommended advancing.
        </p>
      )}

      {a && (
        <p className="text-sm text-muted-foreground">
          {a.total_score ?? 0} / {a.max_score}
          {a.percentage != null ? ` (${a.percentage}%)` : ""}
          {a.band ? ` · ${BAND_LABEL[a.band as ScoreBand] ?? a.band}` : ""}
          {a.recommendation ? ` · recommendation: ${a.recommendation.replace(/_/g, " ")}` : ""}
        </p>
      )}

      {requirements.length > 0 && (
        <ul className="grid gap-2 md:grid-cols-2">
          {requirements.map((r) => {
            const s = candidate.scores[r.competency_code];
            const below = s?.score != null && r.critical_min != null && s.score < r.critical_min;
            return (
              <li key={r.competency_code} className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2 text-sm">
                <span>{r.competency_label}</span>
                <span className={below ? "text-destructive font-medium" : "font-medium"}>
                  {s?.score == null ? "not scored" : `${s.score} / ${r.max_marks}`}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Records the hiring approval. The database refuses it unless the evidence supports it. */
function ApprovalDialog({
  name, summary, busy, onApprove,
}: { name: string; summary: string; busy: boolean; onApprove: (notes: string) => void }) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState("");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={busy} data-analytics="rec-hiring-approve">Approve for a job offer</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Approve {name} for a job offer</DialogTitle>
          <DialogDescription>
            This records your approval against the assessment on file ({summary}). The offer terms are then raised in
            Offer management.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="approval-notes">Note for the record (optional)</Label>
          <Textarea
            id="approval-notes"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What made this candidate the right appointment for the role."
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            disabled={busy}
            onClick={() => {
              onApprove(notes.trim());
              setOpen(false);
            }}
          >
            Approve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Records a decline. A reason is always required. */
function DeclineDialog({
  name, busy, onDecline,
}: { name: string; busy: boolean; onDecline: (reasonCode: string, notes: string) => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>("");
  const [notes, setNotes] = useState("");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={busy} data-analytics="rec-hiring-decline">Not selected</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record that {name} was not selected</DialogTitle>
          <DialogDescription>The reason is kept on the record and closes this application.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="decline-reason">Reason</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger id="decline-reason"><SelectValue placeholder="Choose a reason" /></SelectTrigger>
              <SelectContent>
                {DECLINE_REASONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="decline-notes">Note (optional)</Label>
            <Textarea id="decline-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            variant="destructive"
            disabled={busy || !reason}
            onClick={() => {
              onDecline(reason, notes.trim());
              setOpen(false);
            }}
          >
            Record decision
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
