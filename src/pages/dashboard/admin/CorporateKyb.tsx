import type { LooseRow } from "@/lib/types/loose";
// Admin Corporate KYB console — reviews submitted registrations, adapting the
// verification checklist to the applicant's business type. All actions are
// audited into corporate_registration_reviews with reason + evidence.
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { RequireRole } from "@/components/auth/RequireRole";
import { toast } from "sonner";
import {
  Building2, CheckCircle2, Eye, FileText, Loader2, RefreshCw, ShieldCheck,
  XCircle,
} from "lucide-react";

type DraftRow = {
  id: string;
  status: string;
  decision: string | null;
  submitted_at: string | null;
  business_registration_type: "limited_company" | "registered_business" | null;
  business_info: LooseRow;
  personal_info: LooseRow;
  validation: LooseRow;
};
type DocRow = {
  id: string; slot_key: string; original_name: string; mime: string;
  size_bytes: number; scan_status: string; validation: { ok?: boolean; errors?: string[] };
  admin_decision: "approved" | "rejected" | null; admin_reason: string | null;
  extracted?: Record<string, unknown>;
  ocr_confidence?: Record<string, number>;
  ocr_provider?: string | null;
  current_version?: number;
  reupload_required?: boolean;
  last_scanned_at?: string | null;
  last_rescan_run_id?: string | null;
};
type ReviewRow = {
  id: string; scope: "document" | "draft"; decision: string; reason: string | null;
  created_at: string; document_id: string | null;
  correlation_id?: string | null; document_version_id?: string | null;
};
type VersionRow = {
  id: string; slot_key: string; version: number; original_name: string;
  scan_status: string; validation: { ok?: boolean; errors?: string[] };
  admin_decision: "approved" | "rejected" | null; admin_reason: string | null;
  admin_reviewed_at: string | null; review_id: string | null;
  superseded_at: string | null; created_at: string;
  extracted?: Record<string, unknown>;
  ocr_confidence?: Record<string, number>;
};
type RescanRun = {
  id: string; started_at: string; finished_at: string | null;
  scanned_count: number | null; changed_count: number | null;
  newly_failed_count: number | null; detail?: Record<string, unknown>;
};
type Checklist = Array<{ key: string; label: string; required: boolean }>;

// Builds a CSV of every review decision joined with the exact document version
// (OCR fields + confidence) that decision was based on, then downloads it.
function exportReviewsCsv(
  reviews: ReviewRow[],
  documents: DocRow[],
  versionsBySlot: Record<string, VersionRow[]>,
) {
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = [
    "review_id", "created_at", "scope", "decision", "reason", "correlation_id",
    "document_id", "slot_key", "version", "scan_status",
    "extracted_business_name", "extracted_permit_number", "extracted_expiry_date",
    "conf_business_name", "conf_permit_number", "conf_expiry_date",
    "ocr_fields_json", "ocr_confidence_json",
  ];
  const allVersions = Object.values(versionsBySlot).flat();
  const rows = reviews.map((r) => {
    const version = r.document_version_id ? allVersions.find((v) => v.id === r.document_version_id) : undefined;
    const doc = r.document_id ? documents.find((d) => d.id === r.document_id) : undefined;
    const ex = (version?.extracted ?? doc?.extracted ?? {}) as Record<string, unknown>;
    const cf = (version?.ocr_confidence ?? doc?.ocr_confidence ?? {}) as Record<string, number>;
    return [
      r.id, r.created_at, r.scope, r.decision, r.reason ?? "", r.correlation_id ?? "",
      r.document_id ?? "", version?.slot_key ?? doc?.slot_key ?? "",
      version?.version ?? doc?.current_version ?? "",
      version?.scan_status ?? doc?.scan_status ?? "",
      ex["business_name"] ?? "", ex["permit_number"] ?? "", ex["expiry_date"] ?? "",
      cf["business_name"] ?? "", cf["permit_number"] ?? "", cf["expiry_date"] ?? "",
      Object.keys(ex).length ? JSON.stringify(ex) : "",
      Object.keys(cf).length ? JSON.stringify(cf) : "",
    ].map(esc).join(",");
  });
  const csv = [header.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `kyb-review-log-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

class ApiError extends Error {
  status?: number;
  body?: LooseRow;
  constructor(message: string, status?: number, body?: LooseRow) {
    super(message); this.status = status; this.body = body;
  }
}
async function api<T = any>(op: string, extra: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke("corporate-kyb-review", { body: { op, ...extra } });
  if (error) {
    // supabase-js exposes the raw Response on error.context — parse the JSON
    // body so we can surface throttle metadata (retry_after_ms, reasons).
    let body: LooseRow = null;
    try {
      const resp = (error as LooseRow).context?.response as Response | undefined;
      if (resp) body = await resp.clone().json();
    } catch { /* ignore */ }
    throw new ApiError(body?.error || error.message || "request_failed", (error as LooseRow).context?.response?.status, body);
  }
  return data as T;
}


export default function CorporateKyb() {
  return (
    <RequireRole roles={["admin", "super_admin", "compliance_admin"]}>
      <CorporateKybInner />
    </RequireRole>
  );
}

function CorporateKybInner() {
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<"submitted" | "approved" | "rejected">("submitted");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<{ drafts: DraftRow[] }>("list", { status });
      setDrafts(res.drafts);
      if (!selectedId && res.drafts[0]) setSelectedId(res.drafts[0].id);
    } catch (e) { toast.error((e as Error).message || "Failed to load"); }
    finally { setLoading(false); }
  }, [status, selectedId]);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div className="container mx-auto max-w-7xl px-4 py-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-primary" /> Corporate KYB verification
          </h1>
          <p className="text-sm text-muted-foreground">
            Review and approve corporate registration submissions. Checklist adapts by business type.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(["submitted", "approved", "rejected"] as const).map((s) => (
            <Button key={s} size="sm" variant={status === s ? "default" : "outline"}
                    onClick={() => { setStatus(s); setSelectedId(null); }}>
              {s}
            </Button>
          ))}
          <Button size="sm" variant="outline" onClick={refresh} disabled={loading}>
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">Queue ({drafts.length})</CardTitle></CardHeader>
          <CardContent className="max-h-[70vh] overflow-y-auto p-0">
            <ul className="divide-y">
              {drafts.map((d) => {
                const bn = d.business_info?.registered_name ?? "(no name)";
                const brtLabel = d.business_registration_type === "limited_company" ? "Limited"
                  : d.business_registration_type === "registered_business" ? "Registered" : "—";
                return (
                  <li key={d.id}>
                    <button
                      data-testid={`kyb-queue-item-${d.id}`}
                      className={`w-full text-left px-3 py-3 hover:bg-muted/50 ${selectedId === d.id ? "bg-muted" : ""}`}
                      onClick={() => setSelectedId(d.id)}
                    >
                      <div className="text-sm font-medium truncate">{bn}</div>
                      <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="secondary" className="text-[10px] py-0">{brtLabel}</Badge>
                        <span>{d.submitted_at ? new Date(d.submitted_at).toLocaleDateString() : "—"}</span>
                        {d.decision === "approved" && <Badge className="bg-status-success text-[10px] py-0">Approved</Badge>}
                        {d.decision === "rejected" && <Badge variant="destructive" className="text-[10px] py-0">Rejected</Badge>}
                      </div>
                    </button>
                  </li>

                );
              })}
              {drafts.length === 0 && !loading && (
                <li className="p-6 text-center text-sm text-muted-foreground">No {status} submissions.</li>
              )}
            </ul>
          </CardContent>
        </Card>

        {selectedId ? <DraftDetail draftId={selectedId} onChanged={refresh} /> :
          <Card><CardContent className="p-8 text-sm text-muted-foreground">Select a submission to review.</CardContent></Card>}
      </div>
    </div>
  );
}

function DraftDetail({ draftId, onChanged }: { draftId: string; onChanged: () => void }) {
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<DraftRow | null>(null);
  const [documents, setDocuments] = useState<DocRow[]>([]);
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [checklist, setChecklist] = useState<Checklist>([]);
  const [versionsBySlot, setVersionsBySlot] = useState<Record<string, VersionRow[]>>({});
  const [rescanRunsByDoc, setRescanRunsByDoc] = useState<Record<string, RescanRun>>({});
  const [lastRescan, setLastRescan] = useState<RescanRun | null>(null);
  const [rescanBusy, setRescanBusy] = useState<string | null>(null); // null | "draft" | doc_id
  const [rescanThrottle, setRescanThrottle] = useState<Record<string, { until: number; reason: string; scope: string }>>({});
  const [draftReason, setDraftReason] = useState("");
  const [conflicts, setConflicts] = useState<Array<{
    id: string; op: string; reason: string; correlation_id: string | null;
    created_at: string; user_id: string | null; session_key: string | null;
    request_ip: string | null; user_agent: string | null; detail: Record<string, unknown>;
  }>>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<{
        draft: DraftRow; documents: DocRow[]; reviews: ReviewRow[];
        checklist: Checklist; versions_by_slot: Record<string, VersionRow[]>;
        rescan_runs_by_document: Record<string, RescanRun>;
      }>("get", { draft_id: draftId });
      setDraft(res.draft); setDocuments(res.documents);
      setReviews(res.reviews); setChecklist(res.checklist);
      setVersionsBySlot(res.versions_by_slot ?? {});
      setRescanRunsByDoc(res.rescan_runs_by_document ?? {});
      // Best-effort — surface REG-409 conflict history for this draft.
      try {
        const cf = await supabase.functions.invoke("corporate-registration-draft", {
          body: { op: "list_conflicts", draft_id: draftId, limit: 25 },
        });
        if (!cf.error && cf.data?.conflicts) setConflicts(cf.data.conflicts);
      } catch { /* non-fatal */ }
    } finally { setLoading(false); }
  }, [draftId]);
  useEffect(() => { load(); }, [load]);

  const docBySlot = useMemo(() => {
    const m: Record<string, DocRow> = {};
    for (const d of documents) m[d.slot_key] = d;
    return m;
  }, [documents]);

  const rescanNow = async (documentId?: string) => {
    const key = documentId ?? "draft";
    setRescanBusy(key);
    try {
      const res = await api<{ run: RescanRun | null; scanned: number; changed: number; newly_failed: number }>(
        "rescan_now",
        documentId ? { draft_id: draftId, document_id: documentId } : { draft_id: draftId },
      );
      if (res.run) setLastRescan(res.run);
      setRescanThrottle((p) => { const { [key]: _d, ...rest } = p; return rest; });
      toast.success(`Rescan complete · ${res.scanned} scanned, ${res.changed} changed, ${res.newly_failed} newly failed`);
      await load();
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 429 && err.body) {
        const ms = Number(err.body.retry_after_ms ?? 60_000);
        const worst = Array.isArray(err.body.reasons) && err.body.reasons.length
          ? err.body.reasons.reduce((a: LooseRow, b: LooseRow) => a.retry_after_ms > b.retry_after_ms ? a : b)
          : { reason: "throttled", scope: "unknown" };
        setRescanThrottle((p) => ({ ...p, [key]: { until: Date.now() + ms, reason: worst.reason, scope: worst.scope } }));
        toast.error(`Rescan throttled (${worst.reason}) — try again in ${Math.ceil(ms / 1000)}s`);
      } else {
        toast.error(err.message);
      }
    }
    finally { setRescanBusy(null); }
  };


  const decideDoc = async (docId: string, decision: "approved" | "rejected") => {
    let reason: string | null = null;
    if (decision === "rejected") {
      reason = window.prompt("Reason for rejection (required)")?.trim() || null;
      if (!reason) return;
    }
    try {
      await api("decide_document", { document_id: docId, decision, reason, evidence: { source: "admin_console" } });
      toast.success(`Document ${decision}`);
      load();
    } catch (e) { toast.error((e as Error).message); }
  };

  const decideDraft = async (decision: "approved" | "rejected" | "changes_requested") => {
    if (decision !== "approved" && (!draftReason.trim() || draftReason.trim().length < 3)) {
      toast.error("Reason required for reject / request changes"); return;
    }
    try {
      await api("decide_draft", {
        draft_id: draftId, decision, reason: draftReason || null,
        evidence: {
          approved_docs: documents.filter((d) => d.admin_decision === "approved").map((d) => d.slot_key),
          rejected_docs: documents.filter((d) => d.admin_decision === "rejected").map((d) => d.slot_key),
        },
      });
      toast.success(`Application ${decision}`);
      onChanged();
      load();
    } catch (e) { toast.error((e as Error).message); }
  };

  const preview = async (docId: string) => {
    try {
      const res = await api<{ url: string }>("signed_url", { document_id: docId });
      window.open(res.url, "_blank", "noopener,noreferrer");
    } catch (e) { toast.error((e as Error).message); }
  };

  if (loading || !draft) {
    return <Card><CardContent className="p-8 flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading…
    </CardContent></Card>;
  }

  const brt = draft.business_registration_type;
  const brtLabel = brt === "limited_company" ? "Limited Company"
    : brt === "registered_business" ? "Registered Business" : "—";

  return (
    <div className="space-y-4">
      <Card data-testid="draft-detail">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            {brt === "limited_company" ? <Building2 className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
            {draft.business_info?.registered_name || "Corporate applicant"}
            <Badge variant="secondary" className="ml-2">{brtLabel}</Badge>
            {draft.decision === "approved" && <Badge data-testid="draft-decision-badge" data-decision="approved" className="bg-status-success">Approved</Badge>}
            {draft.decision === "rejected" && <Badge data-testid="draft-decision-badge" data-decision="rejected" variant="destructive">Rejected</Badge>}
            {draft.decision === "pending" && <Badge data-testid="draft-decision-badge" data-decision="pending" className="bg-status-warning text-ice">Pending review</Badge>}
            {draft.decision === "changes_requested" && <Badge data-testid="draft-decision-badge" data-decision="changes_requested" className="bg-status-warning text-ice">Changes requested</Badge>}
          </CardTitle>
        </CardHeader>

        <CardContent className="grid gap-2 text-sm md:grid-cols-2">
          <Info k="KRA PIN" v={draft.business_info?.kra_pin} />
          <Info k={brt === "limited_company" ? "CoI #" : "Registration #"}
                v={brt === "limited_company" ? draft.business_info?.certificate_of_incorporation_number : draft.business_info?.registration_number} />
          <Info k="Industry" v={draft.business_info?.industry} />
          <Info k="Authorized officer"
                v={[draft.personal_info?.first_name, draft.personal_info?.last_name].filter(Boolean).join(" ")} />
          <Info k="Corporate email" v={draft.personal_info?.corporate_email} />
          <Info k="Submitted" v={draft.submitted_at ? new Date(draft.submitted_at).toLocaleString() : "—"} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-base">Verification checklist ({brtLabel})</CardTitle>
          <div className="flex items-center gap-2">
            {lastRescan && (
              <span className="text-xs text-muted-foreground">
                Last rescan {new Date(lastRescan.finished_at ?? lastRescan.started_at).toLocaleTimeString()} ·
                {" "}{lastRescan.scanned_count ?? 0} scanned · {lastRescan.newly_failed_count ?? 0} failed
              </span>
            )}
            {rescanThrottle["draft"] && rescanThrottle["draft"].until > Date.now() && (
              <Badge variant="destructive" className="text-[10px] py-0" data-testid="rescan-throttled-draft">
                Throttled ({rescanThrottle["draft"].reason}) · retry in {Math.max(1, Math.ceil((rescanThrottle["draft"].until - Date.now()) / 1000))}s
              </Badge>
            )}
            <Button size="sm" variant="outline"
                    onClick={() => rescanNow()}
                    disabled={rescanBusy !== null || (rescanThrottle["draft"]?.until ?? 0) > Date.now()}
                    data-testid="rescan-all">
              {rescanBusy === "draft"
                ? <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                : <RefreshCw className="mr-1 h-3 w-3" />}
              Rescan all
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {checklist.map((slot) => {
            const doc = docBySlot[slot.key];
            return (
              <div key={slot.key} className="flex items-start justify-between gap-3 rounded-md border p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {slot.label}
                    {slot.required
                      ? <Badge variant="destructive" className="text-[10px] py-0">Required</Badge>
                      : <Badge variant="secondary" className="text-[10px] py-0">Optional</Badge>}
                    {doc && <ScanBadge status={doc.scan_status} ok={doc.validation?.ok} />}
                    {doc?.current_version ? <Badge variant="secondary" className="text-[10px] py-0">v{doc.current_version}</Badge> : null}
                    {doc?.reupload_required && <Badge variant="destructive" className="text-[10px] py-0">Awaiting re-upload</Badge>}
                    {doc?.admin_decision === "approved" && <Badge className="bg-status-success text-[10px] py-0">Approved</Badge>}
                    {doc?.admin_decision === "rejected" && <Badge variant="destructive" className="text-[10px] py-0">Rejected</Badge>}
                  </div>
                  {doc ? (
                    <div className="mt-1 text-xs text-muted-foreground truncate">
                      {doc.original_name} · {(doc.size_bytes / 1024 / 1024).toFixed(2)} MB
                      {doc.last_scanned_at ? ` · last scanned ${new Date(doc.last_scanned_at).toLocaleString()}` : ""}
                      {doc.validation?.errors?.length ? ` · issues: ${doc.validation.errors.join(", ")}` : ""}
                    </div>
                  ) : (
                    <div className="mt-1 text-xs text-muted-foreground">Not uploaded</div>
                  )}
                  {doc?.admin_reason && <div className="mt-1 text-xs text-destructive">Note: {doc.admin_reason}</div>}
                  {doc && <OcrPanel extracted={doc.extracted} confidence={doc.ocr_confidence} provider={doc.ocr_provider ?? null} />}
                  {doc && rescanRunsByDoc[doc.id] && (
                    <RescanRunPanel
                      run={rescanRunsByDoc[doc.id]}
                      doc={doc}
                      busy={rescanBusy === doc.id}
                      onRerun={() => rescanNow(doc.id)}
                    />
                  )}
                  {doc && (versionsBySlot[doc.slot_key]?.length ?? 0) > 1 && (
                    <VersionsPanel versions={versionsBySlot[doc.slot_key] ?? []} />
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {doc && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => preview(doc.id)} aria-label="Preview">
                        <Eye className="h-3 w-3" />
                      </Button>
                      <Button size="sm" variant="ghost"
                              onClick={() => rescanNow(doc.id)}
                              disabled={rescanBusy !== null || (rescanThrottle[doc.id]?.until ?? 0) > Date.now()}
                              data-testid={`rescan-doc-${doc.slot_key}`}
                              title={rescanThrottle[doc.id] && rescanThrottle[doc.id].until > Date.now()
                                ? `Throttled (${rescanThrottle[doc.id].reason}) — retry in ${Math.ceil((rescanThrottle[doc.id].until - Date.now()) / 1000)}s`
                                : "Rescan this document"}>
                        {rescanBusy === doc.id
                          ? <Loader2 className="h-3 w-3 animate-spin" />
                          : <RefreshCw className="h-3 w-3" />}
                      </Button>
                      {rescanThrottle[doc.id] && rescanThrottle[doc.id].until > Date.now() && (
                        <Badge variant="destructive" className="text-[10px] py-0" data-testid={`rescan-throttled-${doc.slot_key}`}>
                          {rescanThrottle[doc.id].reason} · {Math.max(1, Math.ceil((rescanThrottle[doc.id].until - Date.now()) / 1000))}s
                        </Badge>
                      )}
                      <Button size="sm" variant="outline"
                              className="text-status-success border-status-success/30 hover:bg-status-success/10"
                              onClick={() => decideDoc(doc.id, "approved")}>
                        <CheckCircle2 className="mr-1 h-3 w-3" /> Approve
                      </Button>
                      <Button size="sm" variant="outline"
                              className="text-destructive border-destructive hover:bg-destructive/10"
                              onClick={() => decideDoc(doc.id, "rejected")}>
                        <XCircle className="mr-1 h-3 w-3" /> Reject
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Final decision</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            data-testid="draft-reason"
            placeholder="Reason (required for reject or request-changes)"
            value={draftReason} onChange={(e) => setDraftReason(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button data-testid="decide-draft-approved" onClick={() => decideDraft("approved")} className="bg-status-success hover:bg-status-success">
              <CheckCircle2 className="mr-1 h-4 w-4" /> Approve application
            </Button>
            <Button data-testid="decide-draft-changes_requested" variant="outline" onClick={() => decideDraft("changes_requested")}>
              Request changes
            </Button>
            <Button data-testid="decide-draft-rejected" variant="destructive" onClick={() => decideDraft("rejected")}>
              <XCircle className="mr-1 h-4 w-4" /> Reject application
            </Button>
          </div>

        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-base">Review history</CardTitle>
          <Button data-analytics="corporatekyb.export_csv"
            size="sm" variant="outline" disabled={reviews.length === 0}
            onClick={() => exportReviewsCsv(reviews, documents, versionsBySlot)}
            data-testid="export-review-log-csv"
          >
            <FileText className="mr-1 h-3 w-3" /> Export CSV
          </Button>
        </CardHeader>
        <CardContent>
          {reviews.length === 0 ? (
            <p className="text-sm text-muted-foreground">No reviews yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {reviews.map((r) => {
                // Correlate this decision with the exact document version reviewed so
                // the OCR fields + confidence used at that time are visible in the log.
                const version = r.document_version_id
                  ? Object.values(versionsBySlot).flat().find((v) => v.id === r.document_version_id)
                  : undefined;
                const doc = r.document_id ? documents.find((d) => d.id === r.document_id) : undefined;
                return (
                  <li key={r.id} className="rounded border p-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="secondary" className="text-[10px] py-0">{r.scope}</Badge>
                      <Badge className={`text-[10px] py-0 ${r.decision === "approved" ? "bg-status-success text-ice" : r.decision === "rejected" ? "bg-destructive text-destructive-foreground" : ""}`}>
                        {r.decision}
                      </Badge>
                      {doc && <span className="font-medium text-foreground">{doc.slot_key}</span>}
                      {version && <span>· v{version.version}</span>}
                      <span>· {new Date(r.created_at).toLocaleString()}</span>
                      {r.correlation_id && <span className="font-mono">· cid {r.correlation_id.slice(0, 8)}</span>}
                    </div>
                    {r.reason && <div className="mt-1">{r.reason}</div>}
                    {version && (version.extracted || version.ocr_confidence) && (
                      <OcrPanel
                        extracted={version.extracted}
                        confidence={version.ocr_confidence}
                        provider={(version as LooseRow).ocr_provider ?? (doc?.ocr_provider ?? null)}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            Submission conflicts (REG-409)
            <Badge variant="secondary" className="text-[10px] py-0">{conflicts.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {conflicts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No duplicate-submission attempts recorded for this draft.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs" data-testid="reg-409-conflicts">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-1 pr-2">When</th>
                    <th className="py-1 pr-2">Op</th>
                    <th className="py-1 pr-2">Reason</th>
                    <th className="py-1 pr-2">User</th>
                    <th className="py-1 pr-2">Correlation ID</th>
                    <th className="py-1 pr-2">IP</th>
                  </tr>
                </thead>
                <tbody>
                  {conflicts.map((c) => (
                    <tr key={c.id} className="border-b last:border-0 align-top">
                      <td className="py-1 pr-2 whitespace-nowrap">{new Date(c.created_at).toLocaleString()}</td>
                      <td className="py-1 pr-2"><Badge variant="outline" className="text-[10px] py-0">{c.op}</Badge></td>
                      <td className="py-1 pr-2">{c.reason}</td>
                      <td className="py-1 pr-2 font-mono text-[10px]">{c.user_id ? c.user_id.slice(0, 8) : "anon"}</td>
                      <td className="py-1 pr-2 font-mono text-[10px]">{c.correlation_id ?? "—"}</td>
                      <td className="py-1 pr-2 font-mono text-[10px]">{c.request_ip ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ScanBadge({ status, ok }: { status: string; ok?: boolean }) {
  if (status === "clean" && ok !== false) return <Badge className="bg-status-success text-[10px] py-0">Scan clean</Badge>;
  if (status === "clean" && ok === false) return <Badge variant="destructive" className="text-[10px] py-0">Rules failed</Badge>;
  if (status === "pending") return <Badge variant="secondary" className="text-[10px] py-0">Pending</Badge>;
  if (status === "infected") return <Badge variant="destructive" className="text-[10px] py-0">Infected</Badge>;
  return <Badge variant="destructive" className="text-[10px] py-0">Scan error</Badge>;
}

function Info({ k, v }: { k: string; v?: string | null }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{k}</div>
      <div className="truncate">{v || "—"}</div>
    </div>
  );
}

function OcrPanel({
  extracted, confidence, provider,
}: { extracted?: Record<string, unknown>; confidence?: Record<string, number>; provider?: string | null }) {
  const entries = Object.entries(extracted ?? {}).filter(([, v]) => v != null && v !== "");
  const hasRealOcr = !!provider && provider !== "stub";
  if (!entries.length) {
    return (
      <div className="mt-2 rounded bg-muted/30 p-2 text-[11px] text-muted-foreground">
        OCR pending — no extracted fields yet.
      </div>
    );
  }
  return (
    <div className="mt-2 rounded bg-muted/30 p-2 text-xs">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Extracted OCR fields</span>
        <span className="text-[10px] text-muted-foreground">
          provider: <span className="font-medium">{provider ?? "unknown"}</span>
          {!hasRealOcr && " · confidence hidden until real OCR is wired"}
        </span>
      </div>
      <div className="grid gap-1 md:grid-cols-3">
        {entries.map(([k, v]) => {
          const c = confidence?.[k];
          return (
            <div key={k} className="flex items-center justify-between gap-2">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{k.replace(/_/g, " ")}</div>
                <div className="truncate font-medium">{String(v)}</div>
              </div>
              {hasRealOcr && typeof c === "number" ? (
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                  c >= 0.85 ? "bg-status-success text-ice"
                    : c >= 0.6 ? "bg-status-warning text-ice"
                    : "bg-destructive text-destructive-foreground"
                }`} title="OCR confidence used by validation rules">
                  {(c * 100).toFixed(0)}%
                </span>
              ) : (
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  OCR pending
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function VersionsPanel({ versions }: { versions: VersionRow[] }) {
  // Versions arrive newest-first from the API. For the diff we walk pairs of
  // adjacent versions (newer vs older) and highlight OCR field + confidence
  // changes so reviewers can see what actually changed between uploads.
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer text-muted-foreground">
        Version history ({versions.length})
      </summary>
      <ol className="mt-1 space-y-1">
        {versions.map((v, idx) => {
          const older = versions[idx + 1]; // next in list == previous version
          return (
            <li key={v.id} className="rounded border p-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="text-[10px] py-0">v{v.version}</Badge>
                {v.admin_decision === "approved" && <Badge className="bg-status-success text-[10px] py-0">Approved</Badge>}
                {v.admin_decision === "rejected" && <Badge variant="destructive" className="text-[10px] py-0">Rejected</Badge>}
                {v.superseded_at && <span className="text-muted-foreground">superseded</span>}
                <span className="ml-auto text-muted-foreground">{new Date(v.created_at).toLocaleString()}</span>
              </div>
              <div className="truncate text-muted-foreground">{v.original_name}</div>
              {v.admin_reason && <div className="text-destructive">Note: {v.admin_reason}</div>}
              {older && <OcrDiff current={v} previous={older} />}
            </li>
          );
        })}
      </ol>
    </details>
  );
}

function OcrDiff({ current, previous }: { current: VersionRow; previous: VersionRow }) {
  const curEx = (current.extracted ?? {}) as Record<string, unknown>;
  const prevEx = (previous.extracted ?? {}) as Record<string, unknown>;
  const curConf = (current.ocr_confidence ?? {}) as Record<string, number>;
  const prevConf = (previous.ocr_confidence ?? {}) as Record<string, number>;
  const keys = Array.from(new Set([...Object.keys(curEx), ...Object.keys(prevEx)])).sort();
  const rows = keys
    .map((k) => {
      const a = prevEx[k]; const b = curEx[k];
      const ca = prevConf[k]; const cb = curConf[k];
      const valueChanged = JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);
      const confChanged = (typeof ca === "number" || typeof cb === "number")
        && Math.abs((ca ?? 0) - (cb ?? 0)) > 0.001;
      return { k, a, b, ca, cb, valueChanged, confChanged };
    })
    .filter((r) => r.valueChanged || r.confChanged);
  if (!rows.length) {
    return (
      <div className="mt-2 rounded bg-muted/20 p-2 text-[11px] text-muted-foreground" data-testid={`ocr-diff-${current.id}`}>
        OCR fields unchanged vs v{previous.version}.
      </div>
    );
  }
  const delta = (from?: number, to?: number) => {
    if (typeof from !== "number" && typeof to !== "number") return null;
    const f = typeof from === "number" ? Math.round(from * 100) : null;
    const t = typeof to === "number" ? Math.round(to * 100) : null;
    const d = (t ?? 0) - (f ?? 0);
    const cls = d > 0 ? "text-status-success" : d < 0 ? "text-destructive" : "text-muted-foreground";
    return <span className={`ml-1 ${cls}`}>({f ?? "—"}% → {t ?? "—"}%{d ? `, ${d > 0 ? "+" : ""}${d}pt` : ""})</span>;
  };
  return (
    <div className="mt-2 rounded bg-muted/20 p-2 text-[11px]" data-testid={`ocr-diff-${current.id}`}>
      <div className="mb-1 text-muted-foreground">OCR diff · v{previous.version} → v{current.version}</div>
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.k} className="grid gap-0.5">
            <span className="uppercase tracking-wide text-muted-foreground">{r.k.replace(/_/g, " ")}</span>
            {r.valueChanged ? (
              <span>
                <span className="line-through text-destructive/80">{fmt(r.a)}</span>
                {" → "}
                <span className="font-medium text-status-success">{fmt(r.b)}</span>
                {delta(r.ca, r.cb)}
              </span>
            ) : (
              <span className="text-muted-foreground">confidence only{delta(r.ca, r.cb)}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function fmt(v: unknown): string {
  if (v == null || v === "") return "—";
  return String(v);
}

function RescanRunPanel({
  run, doc, busy, onRerun,
}: { run: RescanRun; doc: DocRow; busy: boolean; onRerun: () => void }) {
  // Explicit failure reasons: prefer the doc-scoped rescan failures reported
  // in run.detail.items; fall back to validation errors from the doc itself.
  const items = Array.isArray((run.detail as LooseRow)?.items) ? (run.detail as LooseRow).items as LooseRow[] : [];
  const myFailures = items.filter((it) => it && it.document_id === doc.id);
  const validationErrors = doc.validation?.errors ?? [];
  const failing = doc.scan_status !== "clean" || doc.validation?.ok === false || myFailures.length > 0;
  return (
    <div
      className={`mt-2 rounded border p-2 text-[11px] ${failing ? "border-destructive/40 bg-destructive/5" : "border-dashed bg-muted/20 text-muted-foreground"}`}
      data-testid="rescan-run-panel"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={failing ? "destructive" : "secondary"} className="text-[10px] py-0">Last rescan</Badge>
        <span>{run.finished_at ? new Date(run.finished_at).toLocaleString() : "in progress"}</span>
        <span>· scanned {run.scanned_count ?? 0}</span>
        <span>· changed {run.changed_count ?? 0}</span>
        <span>· newly failed {run.newly_failed_count ?? 0}</span>
        <Button size="sm" variant={failing ? "destructive" : "outline"}
                className="ml-auto h-6 px-2 text-[10px]"
                onClick={onRerun} disabled={busy}
                data-testid={`rescan-rerun-${doc.slot_key}`}>
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
          Re-run
        </Button>
      </div>
      {failing && (
        <div className="mt-1" data-testid={`rescan-failure-${doc.slot_key}`}>
          <div className="font-medium text-destructive">Rescan reported errors:</div>
          <ul className="mt-0.5 list-disc pl-4 text-destructive/90">
            {myFailures.map((f, i) => (
              <li key={`f${i}`}>
                scan: {f.scan ?? "unknown"}
                {Array.isArray(f.errors) && f.errors.length ? ` · ${f.errors.join(", ")}` : ""}
              </li>
            ))}
            {myFailures.length === 0 && validationErrors.map((e, i) => (
              <li key={`v${i}`}>{e}</li>
            ))}
            {myFailures.length === 0 && validationErrors.length === 0 && (
              <li>scan status: {doc.scan_status}</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
