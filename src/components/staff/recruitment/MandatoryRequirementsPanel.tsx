/**
 * Recruitment 360 — mandatory requirement eligibility for one application.
 *
 * Every row is a hard requirement declared on the vacancy's requirement
 * version, with what the candidate declared, the evidence filed against it and
 * its verification state. The verdict is computed by
 * `rec_requirement_eligibility` server-side: this panel renders it and offers
 * the recruiter's decision on a declaration. A declaration is never presented as
 * satisfied evidence.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BadgeCheck, ShieldAlert, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  eligibilityStateLabel, eligibilityStateTone, requirementEligibility,
  reviewRequirementResponse, verdictLabel, verdictTone, type EligibilityItem,
} from "@/lib/recruitment/mandatoryRequirements";

const TONE: Record<string, string> = {
  success: "bg-success/10 text-success border-success/30",
  warning: "bg-warning/10 text-warning-foreground border-warning/30",
  destructive: "bg-destructive/10 text-destructive border-destructive/30",
  neutral: "bg-muted text-muted-foreground border-border",
};

function DeclarationDecision({ item, onDone }: { item: EligibilityItem; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");

  const decide = useMutation({
    mutationFn: (input: { action: "accept" | "reject"; note?: string }) =>
      reviewRequirementResponse(item.response_id!, input.action, input.note ?? null),
    onSuccess: (r) => {
      toast.success(`Declaration ${r.staff_status}`);
      setOpen(false);
      setNote("");
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!item.response_id) {
    return <span className="text-xs text-muted-foreground">No declaration on file</span>;
  }

  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      <Button
        size="sm" variant="outline" data-analytics="none"
        disabled={item.response_status === "accepted" || decide.isPending}
        onClick={() => decide.mutate({ action: "accept" })}
      >
        <BadgeCheck className="mr-1.5 h-3.5 w-3.5" aria-hidden />
        {item.response_status === "accepted" ? "Accepted" : "Accept declaration"}
      </Button>
      <Button
        size="sm" variant="outline" data-analytics="none"
        disabled={decide.isPending}
        onClick={() => setOpen(true)}
      >
        <XCircle className="mr-1.5 h-3.5 w-3.5" aria-hidden />Reject
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject this requirement declaration</DialogTitle>
            <DialogDescription>
              A reason is mandatory and is stored with the decision in the requirement audit trail.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor={`req-note-${item.requirement_key}`}>Reason</Label>
            <Textarea
              id={`req-note-${item.requirement_key}`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Evidence does not support the declared experience…"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} data-analytics="none">Cancel</Button>
            <Button
              disabled={!note.trim() || decide.isPending}
              onClick={() => decide.mutate({ action: "reject", note: note.trim() })}
              data-analytics="none"
            >Record decision</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function MandatoryRequirementsPanel({ applicationId }: { applicationId: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["rec", "requirement-eligibility", applicationId],
    queryFn: () => requirementEligibility(applicationId),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["rec", "requirement-eligibility", applicationId] });
    void qc.invalidateQueries({ queryKey: ["rec", "application-review", applicationId] });
  };

  if (q.isLoading) return <Skeleton className="h-40" />;
  if (q.isError) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">
          Eligibility could not be resolved: {(q.error as Error).message}
        </CardContent>
      </Card>
    );
  }

  const report = q.data!;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldAlert className="h-4 w-4" aria-hidden />Mandatory requirements
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={TONE[verdictTone(report.verdict)]}>
              {verdictLabel(report.verdict)}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {report.hard_satisfied}/{report.hard_total} satisfied
              {report.requirement_version ? ` · requirement v${report.requirement_version}` : ""}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {report.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            This vacancy's requirement version declares no mandatory requirements.
          </p>
        ) : (
          report.items.map((item) => (
            <div key={item.requirement_key} className="rounded-xl border border-border p-4 space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{item.label}</div>
                  {item.requirement_text ? (
                    <p className="text-xs text-muted-foreground">{item.requirement_text}</p>
                  ) : null}
                </div>
                <Badge variant="outline" className={TONE[eligibilityStateTone(item.state)]}>
                  {eligibilityStateLabel(item.state)}
                </Badge>
              </div>

              <dl className="grid gap-1 text-xs sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">Candidate declared</dt>
                  <dd>
                    {item.declared === true ? "Yes" : item.declared === false ? "No" : "Not answered"}
                    {item.declared_detail ? ` — ${item.declared_detail}` : ""}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Evidence filed</dt>
                  <dd>
                    {item.file_name ?? "None"}
                    {item.verification_status ? ` · ${item.verification_status.replace(/_/g, " ")}` : ""}
                  </dd>
                </div>
              </dl>

              {(item.accepted_evidence_types ?? []).length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {item.accepted_evidence_types.map((t) => (
                    <Badge key={t} variant="secondary" className="text-[10px] font-normal">{t}</Badge>
                  ))}
                </div>
              ) : null}

              {item.response_note ? (
                <p className="text-xs text-destructive">Decision note: {item.response_note}</p>
              ) : null}

              <DeclarationDecision item={item} onDone={refresh} />
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
