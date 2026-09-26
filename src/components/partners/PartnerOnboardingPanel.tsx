/**
 * YALLA PARTNERS 360 — onboarding checklist drill-down (staff surface).
 *
 * Presents the requirement catalogue against what the partner has actually
 * submitted: nothing is inferred. Verification is gated by the server
 * (`partner_advance_onboarding` refuses while mandatory evidence is missing);
 * this panel only tells the truth about where the partner stands.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BadgeCheck, CircleDashed, ExternalLink, FileCheck2, XCircle } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  ONBOARDING_STAGES, STAGE_LABEL, advanceOnboarding, documentUrl, expiringDocuments,
  fetchOnboardingGaps, fetchPartnerDocuments, fetchRequirements, readyToVerify, reviewDocument,
  stageProgress, type DocStatus, type OnboardingStage, type PartnerDocument,
} from "@/lib/partners/lifecycle";

const DOC_TONE: Record<DocStatus | "missing", string> = {
  approved: "border-success/50 text-success",
  pending: "border-info/50 text-info",
  rejected: "border-destructive/50 text-destructive",
  expired: "border-warning/50 text-warning",
  missing: "border-muted-foreground/40 text-muted-foreground",
};

const DOC_LABEL: Record<DocStatus | "missing", string> = {
  approved: "Approved",
  pending: "Awaiting review",
  rejected: "Rejected",
  expired: "Expired",
  missing: "Not submitted",
};

async function openDocument(path: string) {
  const url = await documentUrl(path);
  if (!url) {
    toast.error("That document could not be opened.");
    return;
  }
  window.open(url, "_blank", "noopener");
}

export function PartnerOnboardingPanel({
  partnerId,
  stage,
}: {
  partnerId: string;
  stage: OnboardingStage;
}) {
  const qc = useQueryClient();
  const [notes, setNotes] = useState<Record<string, string>>({});

  const requirements = useQuery({ queryKey: ["yp-requirements"], queryFn: fetchRequirements });
  const gaps = useQuery({
    queryKey: ["yp-gaps", partnerId],
    queryFn: () => fetchOnboardingGaps(partnerId),
    enabled: Boolean(partnerId),
  });
  const docs = useQuery({
    queryKey: ["yp-docs", partnerId],
    queryFn: () => fetchPartnerDocuments(partnerId),
    enabled: Boolean(partnerId),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["yp-gaps", partnerId] });
    void qc.invalidateQueries({ queryKey: ["yp-docs", partnerId] });
    void qc.invalidateQueries({ queryKey: ["yp-partner", partnerId] });
    void qc.invalidateQueries({ queryKey: ["yp-partner-events", partnerId] });
  };

  const review = useMutation({
    mutationFn: (v: { id: string; decision: Exclude<DocStatus, "pending"> }) =>
      reviewDocument(v.id, v.decision, notes[v.id]?.trim() || undefined),
    onSuccess: () => {
      toast.success("Document decision recorded.");
      refresh();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Review failed."),
  });

  const advance = useMutation({
    mutationFn: (next: OnboardingStage) => advanceOnboarding(partnerId, next),
    onSuccess: () => {
      toast.success("Onboarding stage advanced.");
      refresh();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Stage change refused."),
  });

  if (requirements.isLoading || gaps.isLoading || docs.isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  const gapList = gaps.data ?? [];
  const docList = docs.data ?? [];
  const docsByCode = new Map<string, PartnerDocument[]>();
  for (const d of docList) {
    const arr = docsByCode.get(d.requirement_code) ?? [];
    arr.push(d);
    docsByCode.set(d.requirement_code, arr);
  }

  const rows = (requirements.data ?? []).map((r) => {
    const gap = gapList.find((g) => g.code === r.code);
    return {
      code: r.code,
      label: r.label,
      description: r.description,
      mandatory: r.is_mandatory ?? gap?.is_mandatory ?? false,
      status: (gap?.doc_status ?? "missing") as DocStatus | "missing",
      expires: gap?.expires_at ?? null,
      documents: docsByCode.get(r.code) ?? [],
    };
  });

  const mandatory = rows.filter((r) => r.mandatory);
  const approvedMandatory = mandatory.filter((r) => r.status === "approved").length;
  const canVerify = readyToVerify(gapList);
  const expiring = expiringDocuments(docList);
  const currentIdx = ONBOARDING_STAGES.indexOf(stage);
  const nextStage = currentIdx >= 0 ? ONBOARDING_STAGES[currentIdx + 1] : undefined;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Blocked → verified progression</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="outline" className="text-[10px] uppercase">{STAGE_LABEL[stage]}</Badge>
            <span className="text-sm text-muted-foreground">
              {approvedMandatory} of {mandatory.length} mandatory document(s) approved
            </span>
            <Badge
              variant="outline"
              className={canVerify ? "border-success/50 text-[10px] uppercase text-success" : "border-warning/50 text-[10px] uppercase text-warning"}
            >
              {canVerify ? "Ready to verify" : "Blocked on evidence"}
            </Badge>
          </div>

          <Progress value={stageProgress(stage)} aria-label="Onboarding progression" />

          <ol className="flex flex-wrap gap-2 text-xs">
            {ONBOARDING_STAGES.map((s, i) => (
              <li
                key={s}
                className={`rounded-full border px-2.5 py-1 ${
                  i <= currentIdx ? "border-primary/50 text-primary" : "border-border text-muted-foreground"
                }`}
              >
                {STAGE_LABEL[s]}
              </li>
            ))}
          </ol>

          {nextStage && (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => advance.mutate(nextStage)}
                disabled={advance.isPending || (nextStage === "verified" && !canVerify)}
              >
                Advance to {STAGE_LABEL[nextStage]}
              </Button>
              {nextStage === "verified" && !canVerify && (
                <p className="flex items-center gap-1.5 text-xs text-warning">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                  Verification is refused by the server until every mandatory document is approved.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {expiring.length > 0 && (
        <Card className="border-warning/40">
          <CardHeader className="pb-3"><CardTitle className="text-base">Evidence expiring</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {expiring.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>{d.requirement_code.split("_").join(" ")} · {d.file_name}</span>
                  <span className="text-xs text-warning">Expires {new Date(d.expires_at!).toLocaleDateString()}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Required documents</CardTitle></CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No onboarding requirement catalogue is configured.</p>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((r) => {
                const latest = r.documents[0];
                return (
                  <li key={r.code} className="space-y-3 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 font-medium">
                          {r.status === "approved" ? (
                            <BadgeCheck className="h-4 w-4 text-success" aria-hidden />
                          ) : r.status === "rejected" ? (
                            <XCircle className="h-4 w-4 text-destructive" aria-hidden />
                          ) : (
                            <CircleDashed className="h-4 w-4 text-muted-foreground" aria-hidden />
                          )}
                          {r.label}
                          {r.mandatory ? (
                            <Badge variant="outline" className="text-[10px] uppercase">Mandatory</Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] uppercase text-muted-foreground">Optional</Badge>
                          )}
                        </p>
                        {r.description && <p className="mt-1 text-xs text-muted-foreground">{r.description}</p>}
                        {r.expires && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Valid until {new Date(r.expires).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                      <Badge variant="outline" className={`text-[10px] uppercase ${DOC_TONE[r.status]}`}>
                        {DOC_LABEL[r.status]}
                      </Badge>
                    </div>

                    {latest && (
                      <div className="space-y-2 rounded-lg border border-border/60 bg-muted/30 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span className="flex items-center gap-1.5">
                            <FileCheck2 className="h-3.5 w-3.5" aria-hidden /> {latest.file_name}
                          </span>
                          <span className="text-muted-foreground">
                            Submitted {new Date(latest.created_at).toLocaleString()}
                          </span>
                        </div>
                        {latest.review_notes && (
                          <p className="text-xs text-muted-foreground">Reviewer note: {latest.review_notes}</p>
                        )}
                        <div className="flex flex-wrap items-center gap-2">
                          <Button size="sm" variant="outline" onClick={() => void openDocument(latest.file_path)}>
                            <ExternalLink className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Open
                          </Button>
                          {latest.status === "pending" && (
                            <>
                              <Button
                                size="sm"
                                onClick={() => review.mutate({ id: latest.id, decision: "approved" })}
                                disabled={review.isPending}
                              >
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => review.mutate({ id: latest.id, decision: "rejected" })}
                                disabled={review.isPending || !(notes[latest.id]?.trim())}
                              >
                                Reject
                              </Button>
                            </>
                          )}
                        </div>
                        {latest.status === "pending" && (
                          <Textarea
                            rows={2}
                            aria-label={`Review note for ${r.label}`}
                            placeholder="Reason (required to reject)"
                            value={notes[latest.id] ?? ""}
                            onChange={(e) => setNotes((n) => ({ ...n, [latest.id]: e.target.value }))}
                          />
                        )}
                        {r.documents.length > 1 && (
                          <p className="text-xs text-muted-foreground">
                            {r.documents.length - 1} earlier submission(s) retained for audit.
                          </p>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default PartnerOnboardingPanel;
