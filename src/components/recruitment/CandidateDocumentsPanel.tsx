/**
 * Recruitment 360 — candidate documents during screening.
 *
 * Lives inside the existing candidate/screening surface: it reads the
 * server-resolved requirement checklist plus every filed document version,
 * mints short-lived signed links for a private bucket (logging each view and
 * download), and exposes the reviewer dispositions. Every disposition is a
 * server RPC — hiding a button here grants nothing.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2, Download, Eye, FileWarning, History, Loader2, ShieldAlert, XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  applicationDocumentStatus,
  documentEvents,
  documentForRequirement,
  documentStateLabel,
  REJECTION_REASONS,
  replaceDocument,
  reviewDocument,
  signedDocumentUrl,
  verificationLabel,
  verificationTone,
  versionHistory,
  type CandidateDocumentRow,
  type RequirementItem,
  type ReviewAction,
} from "@/lib/recruitment/documentControl";

interface Props {
  applicationId: string;
  candidateName?: string | null;
  vacancyTitle?: string | null;
}

const toneVariant = (tone: ReturnType<typeof verificationTone>) =>
  tone === "success" ? "default" : tone === "destructive" ? "destructive" : "secondary";

export default function CandidateDocumentsPanel({ applicationId, candidateName, vacancyTitle }: Props) {
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<{ doc: CandidateDocumentRow; action: ReviewAction } | null>(null);
  const [reason, setReason] = useState("");
  const [reasonPreset, setReasonPreset] = useState("");
  const [historyKey, setHistoryKey] = useState<string | null>(null);

  const status = useQuery({
    queryKey: ["recruitment", "document-status", applicationId],
    queryFn: () => applicationDocumentStatus(applicationId),
  });

  const events = useQuery({
    queryKey: ["recruitment", "document-events", applicationId],
    queryFn: () => documentEvents(applicationId),
  });

  const review = useMutation({
    mutationFn: ({ id, action, why }: { id: string; action: ReviewAction; why?: string }) =>
      reviewDocument(id, action, why),
    onSuccess: (r) => {
      toast.success(`Document ${verificationLabel(r.verification_status as never).toLowerCase()}.`);
      setDialog(null); setReason(""); setReasonPreset("");
      void queryClient.invalidateQueries({ queryKey: ["recruitment", "document-status", applicationId] });
      void queryClient.invalidateQueries({ queryKey: ["recruitment", "document-events", applicationId] });
    },
    onError: (e: Error) => toast.error(
      e.message.includes("waiver_requires_platform_admin")
        ? "Only a platform administrator may waive a mandatory requirement."
        : e.message.includes("reason_required")
          ? "A reason is required for this action."
          : e.message,
    ),
  });

  const replace = useMutation({
    mutationFn: ({ doc, file }: { doc: CandidateDocumentRow; file: File }) =>
      replaceDocument(doc.id, applicationId, file, "Replacement filed by recruitment"),
    onSuccess: (r) => {
      toast.success(`Replacement filed as version ${r.version_no} — submitted for verification.`);
      void queryClient.invalidateQueries({ queryKey: ["recruitment", "document-status", applicationId] });
      void queryClient.invalidateQueries({ queryKey: ["recruitment", "document-events", applicationId] });
      void queryClient.invalidateQueries({ queryKey: ["recruitment", "document-gate", applicationId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const open = useMutation({
    mutationFn: async ({ doc, purpose }: { doc: CandidateDocumentRow; purpose: "view" | "download" }) =>
      signedDocumentUrl(doc.storage_path, doc.id, purpose),
    onSuccess: (url) => window.open(url, "_blank", "noopener,noreferrer"),
    onError: (e: Error) => toast.error(e.message),
  });

  if (status.isLoading) {
    return (
      <Card>
        <CardContent className="py-10 text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Loading candidate documents…
        </CardContent>
      </Card>
    );
  }

  if (status.isError) {
    return (
      <Alert variant="destructive" role="alert">
        <ShieldAlert className="h-4 w-4" aria-hidden="true" />
        <AlertTitle>Documents unavailable</AlertTitle>
        <AlertDescription>{(status.error as Error).message}</AlertDescription>
      </Alert>
    );
  }

  const data = status.data!;
  const docs = data.documents ?? [];

  const submitReview = () => {
    if (!dialog) return;
    const why = reasonPreset === "Other" || !reasonPreset ? reason.trim() : `${reasonPreset}${reason.trim() ? ` — ${reason.trim()}` : ""}`;
    review.mutate({ id: dialog.doc.id, action: dialog.action, why: why || undefined });
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Documents</CardTitle>
              <p className="text-sm text-muted-foreground">
                {candidateName ?? "Candidate"}{vacancyTitle ? ` · ${vacancyTitle}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={data.document_state === "VERIFIED" ? "default" : "secondary"}>
                {documentStateLabel(data.document_state)}
              </Badge>
              <Badge variant="outline">{data.completion_percent}% complete</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Progress value={data.completion_percent} />
          <div className="grid gap-2 sm:grid-cols-4 text-sm">
            <Metric label="Required" value={String(data.mandatory_total)} />
            <Metric label="Provided" value={String(data.mandatory_satisfied)} />
            <Metric label="Pending verification" value={String(data.pending_verification)} />
            <Metric label="Verified" value={String(data.verified_count)} />
          </div>

          {data.missing.length > 0 ? (
            <Alert variant="destructive" role="alert">
              <FileWarning className="h-4 w-4" aria-hidden="true" />
              <AlertTitle>Screening blocked — mandatory documentation incomplete</AlertTitle>
              <AlertDescription>
                Outstanding: {data.missing.join(", ")}
              </AlertDescription>
            </Alert>
          ) : data.document_state === "COMPLETE_PENDING_VERIFICATION" ? (
            <Alert>
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              <AlertTitle>Complete — pending verification</AlertTitle>
              <AlertDescription>
                Every required document was submitted. Authenticity is not established until each
                document is verified below.
              </AlertDescription>
            </Alert>
          ) : null}

          <p className="text-xs text-muted-foreground">
            Declared status: {data.education_status ?? "not declared"}
            {data.qualification_level ? ` · ${data.qualification_level}` : ""}
            {data.completed_years !== null ? ` · ${data.completed_years} year(s) completed` : ""}
            {data.consolidated_transcript ? " · consolidated transcript" : ""}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Requirement checklist</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {data.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No document requirements are configured for this vacancy.</p>
          ) : null}
          {data.items.map((item: RequirementItem) => {
            const doc = documentForRequirement(docs, item);
            const versions = doc ? versionHistory(docs, item.doc_key, item.academic_year) : [];
            const key = item.requirement_key;
            return (
              <div key={key} className="rounded-lg border border-border p-3 space-y-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium flex items-center gap-2">
                      {doc ? (
                        <CheckCircle2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                      ) : (
                        <XCircle className="h-4 w-4 text-destructive" aria-hidden="true" />
                      )}
                      {item.label}
                      {item.mandatory ? null : <span className="text-xs text-muted-foreground">(optional)</span>}
                    </p>
                    <p className="text-xs text-muted-foreground break-words">
                      {doc
                        ? `${doc.file_name} · uploaded ${new Date(doc.uploaded_at).toLocaleDateString()} · v${doc.version_no}`
                        : "Not provided"}
                    </p>
                    {doc?.review_reason ? (
                      <p className="text-xs text-destructive">Reviewer note: {doc.review_reason}</p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {doc ? (
                      <Badge variant={toneVariant(verificationTone(doc.verification_status))}>
                        {verificationLabel(doc.verification_status)}
                      </Badge>
                    ) : (
                      <Badge variant="destructive">Missing</Badge>
                    )}
                  </div>
                </div>

                {doc ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="outline" disabled={open.isPending}
                      onClick={() => open.mutate({ doc, purpose: "view" })}>
                      <Eye className="mr-1 h-3.5 w-3.5" aria-hidden="true" />View
                    </Button>
                    <Button size="sm" variant="outline" disabled={open.isPending}
                      data-analytics="staff_recruitment_document_download"
                      onClick={() => open.mutate({ doc, purpose: "download" })}>
                      <Download className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Download
                    </Button>
                    <Button size="sm" disabled={review.isPending}
                      onClick={() => review.mutate({ id: doc.id, action: "verify" })}>
                      <CheckCircle2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Verify
                    </Button>
                    <Button size="sm" variant="destructive"
                      onClick={() => { setDialog({ doc, action: "reject" }); setReason(""); setReasonPreset(""); }}>
                      Reject
                    </Button>
                    <Button size="sm" variant="outline"
                      onClick={() => { setDialog({ doc, action: "request_replacement" }); setReason(""); setReasonPreset(""); }}>
                      Request replacement
                    </Button>
                    <Button size="sm" variant="ghost"
                      onClick={() => { setDialog({ doc, action: "waive" }); setReason(""); setReasonPreset(""); }}>
                      Waive
                    </Button>
                    {versions.length > 1 ? (
                      <Button size="sm" variant="ghost"
                        onClick={() => setHistoryKey(historyKey === key ? null : key)}>
                        <History className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                        {versions.length} versions
                      </Button>
                    ) : null}
                  </div>
                ) : null}

                {doc && ["rejected", "replacement_required"].includes(doc.verification_status) ? (
                  <div className="space-y-1.5 rounded-md bg-muted/40 p-2">
                    <Label htmlFor={`replace-${key}`} className="text-xs">
                      File a replacement (previous version is retained)
                    </Label>
                    <Input
                      id={`replace-${key}`}
                      type="file"
                      disabled={replace.isPending}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) replace.mutate({ doc, file });
                      }}
                    />
                  </div>
                ) : null}

                {historyKey === key && versions.length > 1 ? (
                  <div className="rounded-md bg-muted/40 p-2 space-y-1">
                    {versions.map((v) => (
                      <p key={v.id} className="text-xs text-muted-foreground">
                        v{v.version_no} · {v.file_name} · {verificationLabel(v.verification_status)}
                        {v.superseded_at ? " · superseded" : ""}
                      </p>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Document audit trail</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {events.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading events…</p>
          ) : (events.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No document events recorded yet.</p>
          ) : (
            (events.data ?? []).map((e) => (
              <div key={e.id} className="text-xs">
                <span className="font-medium">{e.action.replace(/_/g, " ").toLowerCase()}</span>
                {e.doc_key ? ` · ${e.doc_key}` : ""}
                {e.academic_year ? ` (year ${e.academic_year})` : ""}
                {e.previous_status && e.new_status ? ` · ${e.previous_status} → ${e.new_status}` : ""}
                {e.reason ? ` · ${e.reason}` : ""}
                <span className="text-muted-foreground"> · {new Date(e.created_at).toLocaleString()}</span>
                <Separator className="mt-2" />
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Dialog open={!!dialog} onOpenChange={(o) => { if (!o) setDialog(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog?.action === "reject" ? "Reject document"
                : dialog?.action === "request_replacement" ? "Request replacement"
                  : "Waive requirement"}
            </DialogTitle>
            <DialogDescription>
              A reason is mandatory and is recorded permanently against this document.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="review-reason-preset">Reason</Label>
              <Select value={reasonPreset} onValueChange={setReasonPreset}>
                <SelectTrigger id="review-reason-preset"><SelectValue placeholder="Select a reason" /></SelectTrigger>
                <SelectContent>
                  {REJECTION_REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="review-reason">Explanation</Label>
              <Textarea id="review-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Cancel</Button>
            <Button onClick={submitReview} disabled={review.isPending || (!reasonPreset && !reason.trim())}>
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/40 p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}
