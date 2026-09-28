/**
 * TaxiD PARTNERS — partner-side onboarding document submission.
 *
 * The partner sees exactly what TaxiD requires, submits evidence into their own
 * storage folder (RLS-scoped), and reads back the reviewer's decision. Approval
 * is never granted here: a fresh upload is always "awaiting review".
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock, ExternalLink, FileUp, ShieldAlert, Upload } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  documentUrl, fetchOnboardingGaps, fetchPartnerDocuments, fetchRequirements, uploadPartnerDocument,
  type DocStatus, type PartnerDocument,
} from "@/lib/partners/lifecycle";

const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp";

const STATUS_VIEW: Record<DocStatus | "missing", { label: string; tone: string }> = {
  approved: { label: "Approved by TaxiD", tone: "border-success/50 text-success" },
  pending: { label: "Awaiting review", tone: "border-info/50 text-info" },
  rejected: { label: "Rejected — resubmit", tone: "border-destructive/50 text-destructive" },
  expired: { label: "Expired — resubmit", tone: "border-warning/50 text-warning" },
  missing: { label: "Not submitted", tone: "border-muted-foreground/40 text-muted-foreground" },
};

export function PartnerDocumentUploadPanel({ partnerId }: { partnerId: string }) {
  const qc = useQueryClient();
  const enabled = Boolean(partnerId);

  const requirements = useQuery({ queryKey: ["yp-requirements"], queryFn: fetchRequirements });
  const gaps = useQuery({
    queryKey: ["yp-my-gaps", partnerId],
    queryFn: () => fetchOnboardingGaps(partnerId),
    enabled,
  });
  const docs = useQuery({
    queryKey: ["yp-my-docs", partnerId],
    queryFn: () => fetchPartnerDocuments(partnerId),
    enabled,
  });

  const [busyCode, setBusyCode] = useState<string>("");
  const [expiry, setExpiry] = useState<Record<string, string>>({});

  const upload = useMutation({
    mutationFn: (v: { code: string; file: File }) =>
      uploadPartnerDocument({
        partnerId,
        requirementCode: v.code,
        file: v.file,
        expiresAt: expiry[v.code] || null,
      }),
    onSuccess: (_d, v) => {
      toast.success("Document submitted. The TaxiD partner desk will review it.");
      setExpiry((e) => ({ ...e, [v.code]: "" }));
      void qc.invalidateQueries({ queryKey: ["yp-my-docs", partnerId] });
      void qc.invalidateQueries({ queryKey: ["yp-my-gaps", partnerId] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Upload failed."),
    onSettled: () => setBusyCode(""),
  });

  const rows = useMemo(() => {
    const byCode = new Map<string, PartnerDocument[]>();
    for (const d of docs.data ?? []) {
      const arr = byCode.get(d.requirement_code) ?? [];
      arr.push(d);
      byCode.set(d.requirement_code, arr);
    }
    return (requirements.data ?? []).map((r) => {
      const gap = (gaps.data ?? []).find((g) => g.code === r.code);
      return {
        ...r,
        status: (gap?.doc_status ?? "missing") as DocStatus | "missing",
        latest: (byCode.get(r.code) ?? [])[0],
        history: byCode.get(r.code) ?? [],
      };
    });
  }, [requirements.data, gaps.data, docs.data]);

  if (requirements.isLoading || gaps.isLoading || docs.isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  const mandatory = rows.filter((r) => r.is_mandatory);
  const done = mandatory.filter((r) => r.status === "approved").length;
  const pct = mandatory.length === 0 ? 0 : Math.round((done / mandatory.length) * 100);

  const open = async (path: string) => {
    const url = await documentUrl(path);
    if (!url) return toast.error("That document could not be opened.");
    window.open(url, "_blank", "noopener");
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Compliance pack progress</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Progress value={pct} aria-label="Mandatory documents approved" />
          <p className="text-sm text-muted-foreground">
            {done} of {mandatory.length} mandatory document(s) approved. Your account cannot be verified
            until all of them are approved by the TaxiD partner desk.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Required documents</CardTitle>
          <p className="text-xs text-muted-foreground">PDF or image, up to 10 MB. Uploads are private to your partner account and the TaxiD desk.</p>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No document requirements are configured for your partner type.</p>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((r) => {
                const view = STATUS_VIEW[r.status];
                const inputId = `upload-${r.code}`;
                return (
                  <li key={r.code} className="space-y-3 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 font-medium">
                          {r.status === "approved" ? (
                            <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />
                          ) : r.status === "pending" ? (
                            <Clock className="h-4 w-4 text-info" aria-hidden />
                          ) : (
                            <ShieldAlert className="h-4 w-4 text-muted-foreground" aria-hidden />
                          )}
                          {r.label}
                          {r.is_mandatory && <Badge variant="outline" className="text-[10px] uppercase">Required</Badge>}
                        </p>
                        {r.description && <p className="mt-1 text-xs text-muted-foreground">{r.description}</p>}
                        {r.latest?.review_notes && r.status === "rejected" && (
                          <p className="mt-1 text-xs text-destructive">Reviewer: {r.latest.review_notes}</p>
                        )}
                      </div>
                      <Badge variant="outline" className={`text-[10px] uppercase ${view.tone}`}>{view.label}</Badge>
                    </div>

                    <div className="flex flex-wrap items-end gap-3">
                      <div>
                        <Label htmlFor={inputId} className="text-xs">Upload evidence</Label>
                        <Input
                          id={inputId}
                          type="file"
                          accept={ACCEPT}
                          className="max-w-xs"
                          disabled={upload.isPending}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            e.target.value = "";
                            if (!file) return;
                            setBusyCode(r.code);
                            upload.mutate({ code: r.code, file });
                          }}
                        />
                      </div>
                      {r.validity_months ? (
                        <div>
                          <Label htmlFor={`exp-${r.code}`} className="text-xs">Expiry date</Label>
                          <Input
                            id={`exp-${r.code}`}
                            type="date"
                            className="max-w-[11rem]"
                            value={expiry[r.code] ?? ""}
                            onChange={(e) => setExpiry((x) => ({ ...x, [r.code]: e.target.value }))}
                          />
                        </div>
                      ) : null}
                      {busyCode === r.code && upload.isPending && (
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Upload className="h-3.5 w-3.5 animate-pulse" aria-hidden /> Uploading…
                        </span>
                      )}
                    </div>

                    {r.history.length > 0 && (
                      <ul className="space-y-1 rounded-lg border border-border/60 bg-muted/30 p-3 text-xs">
                        {r.history.slice(0, 4).map((d) => (
                          <li key={d.id} className="flex flex-wrap items-center justify-between gap-2">
                            <span className="flex items-center gap-1.5">
                              <FileUp className="h-3.5 w-3.5" aria-hidden /> {d.file_name}
                            </span>
                            <span className="flex items-center gap-2 text-muted-foreground">
                              {new Date(d.created_at).toLocaleDateString()}
                              <Badge variant="outline" className={`text-[10px] uppercase ${STATUS_VIEW[d.status].tone}`}>
                                {d.status}
                              </Badge>
                              <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => void open(d.file_path)}>
                                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                                <span className="sr-only">Open {d.file_name}</span>
                              </Button>
                            </span>
                          </li>
                        ))}
                      </ul>
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

export default PartnerDocumentUploadPanel;
