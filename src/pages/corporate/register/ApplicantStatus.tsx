// Applicant-facing review status page.
//
// After submitting a corporate registration the applicant lands here to see:
//   * Notifications from the admin team (approved / rejected / changes
//     requested / rescan failed) with the reason and any linked evidence,
//   * A live document checklist that includes OCR-extracted fields and
//     confidence scores used by the validation rules,
//   * A re-upload button on any document flagged reupload_required — the
//     original correlation is preserved server-side.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import {
  Bell, CheckCircle2, ClipboardCheck, FileText, Info, Loader2, RefreshCw,
  ShieldAlert, UploadCloud, XCircle,
} from "lucide-react";

type Notif = {
  id: string; kind: string; title: string; message: string | null; reason: string | null;
  evidence: any; slot_key: string | null; document_id: string | null; review_id: string | null;
  read_at: string | null; created_at: string;
  ack_attempts?: number; ack_last_error?: string | null;
  ack_last_attempt_at?: string | null; ack_next_retry_at?: string | null;
};
type DocRow = {
  id: string; slot_key: string; original_name: string; size_bytes: number;
  scan_status: "clean" | "pending" | "infected" | "error";
  validation: { ok?: boolean; errors?: string[] };
  admin_decision: "approved" | "rejected" | null; admin_reason: string | null;
  extracted?: Record<string, unknown>;
  ocr_confidence?: Record<string, number>;
  ocr_provider?: string | null;
  reupload_required?: boolean;
  current_version?: number;
  uploaded_at: string;
};

function getSessionKey(): string {
  return localStorage.getItem("yalla.corp_reg.session_key") ?? "";
}

async function call<T = unknown>(op: string, extra: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke("corporate-kyb-doc", {
    body: { op, session_key: getSessionKey(), ...extra },
  });
  if (error) throw error;
  return data as T;
}

type DraftSummary = {
  id: string;
  status: "draft" | "submitted" | "abandoned" | "withdrawn" | string;
  decision: "pending" | "approved" | "rejected" | "changes_requested" | null;
  submitted_at: string | null;
};

async function loadDraft(): Promise<DraftSummary | null> {
  const { data, error } = await supabase.functions.invoke("corporate-registration-draft", {
    body: { op: "load", session_key: getSessionKey() },
  });
  if (error) return null;
  const d = (data as { draft: DraftSummary | null } | null)?.draft ?? null;
  return d;
}

function canStartFresh(d: DraftSummary): boolean {
  return d.decision === "rejected" || d.status === "withdrawn" || d.status === "abandoned";
}

function SubmissionStatusBadge({
  status, decision,
}: { status: DraftSummary["status"]; decision: DraftSummary["decision"] }) {
  const key = decision ?? status;
  const map: Record<string, { label: string; cls: string }> = {
    pending:            { label: "Pending review",   cls: "bg-status-warning text-ice" },
    approved:           { label: "Approved",          cls: "bg-status-success text-ice" },
    rejected:           { label: "Rejected",          cls: "bg-destructive text-destructive-foreground" },
    changes_requested:  { label: "Changes requested", cls: "bg-status-warning text-ice" },
    submitted:          { label: "Submitted",         cls: "bg-primary text-primary-foreground" },
    withdrawn:          { label: "Withdrawn",         cls: "bg-muted text-muted-foreground" },
    abandoned:          { label: "Abandoned",         cls: "bg-muted text-muted-foreground" },
    draft:              { label: "Draft",             cls: "bg-muted text-muted-foreground" },
  };
  const m = map[key ?? ""] ?? { label: String(key ?? "unknown"), cls: "bg-muted text-muted-foreground" };
  return (
    <Badge
      className={`text-[10px] py-0 ${m.cls}`}
      data-testid="submission-status-badge"
      data-status={key ?? "unknown"}
    >
      {m.label}
    </Badge>
  );

}


export default function ApplicantStatus() {
  const nav = useNavigate();
  const alreadySubmittedBanner =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("reason") === "already_submitted";
  const [notifications, setNotifications] = useState<Notif[]>([]);
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [draft, setDraft] = useState<DraftSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const [ackBusy, setAckBusy] = useState<string | null>(null);
  const [ackFailed, setAckFailed] = useState<Record<string, string>>({});
  const [ackAttempts, setAckAttempts] = useState<Record<string, number>>({});
  const [ackRemaining, setAckRemaining] = useState<Record<string, number>>({});
  const [ackNextRetryAt, setAckNextRetryAt] = useState<Record<string, string>>({});
  const [maxAckAttempts, setMaxAckAttempts] = useState<number>(5);

  const refresh = useCallback(async () => {
    setLoading(true);
    // No application was ever started on this device: say so plainly instead of
    // calling the server and surfacing a raw function error.
    if (!getSessionKey()) {
      setDraft(null);
      setNotifications([]);
      setDocs([]);
      setLoading(false);
      return;
    }
    try {
      const [nr, dr, ds] = await Promise.all([
        call<{ notifications: Notif[]; max_ack_attempts?: number }>("notifications_list"),
        call<{ documents: DocRow[] }>("list"),
        loadDraft(),
      ]);
      setDraft(ds);
      setNotifications(nr.notifications);
      if (nr.max_ack_attempts) setMaxAckAttempts(nr.max_ack_attempts);
      // Seed retry state from server so a page refresh preserves it.
      const failed: Record<string, string> = {};
      const attempts: Record<string, number> = {};
      const remaining: Record<string, number> = {};
      const nextRetry: Record<string, string> = {};
      for (const n of nr.notifications) {
        if (n.ack_attempts) attempts[n.id] = n.ack_attempts;
        if (!n.read_at && n.ack_last_error) failed[n.id] = n.ack_last_error;
        const rem = Math.max(0, (nr.max_ack_attempts ?? 5) - (n.ack_attempts ?? 0));
        remaining[n.id] = rem;
        if (n.ack_next_retry_at) nextRetry[n.id] = n.ack_next_retry_at;
      }
      setAckFailed(failed);
      setAckAttempts(attempts);
      setAckRemaining(remaining);
      setAckNextRetryAt(nextRetry);
      setDocs(dr.documents);
    } catch (e) {
      toast.error((e as Error).message || "Could not load your registration status");
    } finally { setLoading(false); }
  }, []);

  const acknowledge = useCallback(async (id: string, opts: { force?: boolean } = {}) => {
    setAckBusy(id);
    setAckFailed((prev) => { const { [id]: _drop, ...rest } = prev; return rest; });
    // Optimistic — flip read_at immediately so the badge/state updates.
    const nowIso = new Date().toISOString();
    setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read_at: n.read_at ?? nowIso } : n));
    try {
      const res = await call<{
        results?: Array<{ id: string; ok: boolean; attempts_used: number; attempts_remaining: number; next_retry_at?: string | null; error?: string }>;
        skipped?: Array<{ id: string; reason: string; retry_after_ms?: number; attempts_used?: number; attempts_remaining?: number }>;
        max_attempts?: number;
      }>("notifications_ack", { ids: [id], force_retry: !!opts.force });
      const r = res.results?.find((x) => x.id === id);
      const s = res.skipped?.find((x) => x.id === id);
      if (r) {
        setAckAttempts((p) => ({ ...p, [id]: r.attempts_used }));
        setAckRemaining((p) => ({ ...p, [id]: r.attempts_remaining }));
        if (!r.ok) {
          setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read_at: null } : n));
          setAckFailed((p) => ({ ...p, [id]: r.error ?? "acknowledge failed" }));
          if (r.next_retry_at) setAckNextRetryAt((p) => ({ ...p, [id]: r.next_retry_at! }));
          toast.error(`Acknowledge failed (${r.attempts_remaining} attempt${r.attempts_remaining === 1 ? "" : "s"} left): ${r.error ?? ""}`);
        } else {
          setAckNextRetryAt((p) => { const { [id]: _d, ...rest } = p; return rest; });
        }
      } else if (s) {
        setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read_at: null } : n));
        if (typeof s.attempts_used === "number") setAckAttempts((p) => ({ ...p, [id]: s.attempts_used! }));
        if (typeof s.attempts_remaining === "number") setAckRemaining((p) => ({ ...p, [id]: s.attempts_remaining! }));
        setAckFailed((p) => ({
          ...p,
          [id]: s.reason === "backoff_active"
            ? `Please wait ${Math.ceil((s.retry_after_ms ?? 0) / 1000)}s before retrying (exponential backoff).`
            : s.reason === "max_attempts_reached"
            ? "Maximum retry attempts reached. Refresh and try again later."
            : s.reason,
        }));
        toast.error(`Skipped: ${s.reason}`);
      }
    } catch (e) {
      setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read_at: null } : n));
      const msg = (e as Error).message || "Could not acknowledge notification";
      setAckFailed((prev) => ({ ...prev, [id]: msg }));
      setAckAttempts((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }));
      toast.error(msg);
    } finally { setAckBusy(null); }
  }, []);

  useEffect(() => {
    if (!getSessionKey()) { nav("/corporate/register"); return; }
    refresh();
  }, [nav, refresh]);

  const rejectedDocs = useMemo(
    () => docs.filter((d) => d.reupload_required || d.admin_decision === "rejected"),
    [docs],
  );

  return (
    <div className="container mx-auto max-w-5xl px-4 py-8 space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <ClipboardCheck className="h-6 w-6 text-primary" />
            Your corporate registration
          </h1>
          <p className="text-sm text-muted-foreground">
            Track review decisions, extracted OCR fields, and any documents that need re-uploading.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
          {loading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
          Refresh
        </Button>
      </header>

      {alreadySubmittedBanner && (
        <Alert data-testid="already-submitted-banner">
          <Info className="h-4 w-4" aria-hidden />
          <AlertTitle className="text-sm flex items-center gap-2">
            Application already submitted
            {draft && <SubmissionStatusBadge status={draft.status} decision={draft.decision} />}
          </AlertTitle>
          <AlertDescription className="text-xs space-y-1">
            <div>
              Your corporate registration has already been received
              {draft?.submitted_at && <> on {new Date(draft.submitted_at).toLocaleString()}</>}.
              You can't edit the wizard while it's under review.
            </div>
            <div>
              <a
                href="#kyb-timeline"
                className="underline text-primary"
                data-testid="already-submitted-timeline-link"
              >
                View the KYB status timeline ↓
              </a>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {draft && canStartFresh(draft) && (
        <Alert variant="destructive" data-testid="start-new-registration-alert">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Previous application {draft.decision === "rejected" ? "rejected" : "closed"}</AlertTitle>
          <AlertDescription className="text-xs space-y-2">
            <div>
              You can begin a new corporate registration. Your previous submission stays on
              record for the admin team and won't be affected.
            </div>
            <Button
              size="sm"
              variant="secondary"
              data-testid="start-new-registration"
              onClick={() => {
                localStorage.removeItem("yalla.corp_reg.session_key");
                nav("/corporate/register");
              }}
            >
              Start a new registration
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {rejectedDocs.length > 0 && (
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Action required</AlertTitle>
          <AlertDescription className="text-xs">
            {rejectedDocs.length} document{rejectedDocs.length === 1 ? "" : "s"} need re-uploading.
            We keep the original review correlation so admins see the full history.
          </AlertDescription>
        </Alert>
      )}

      <Card id="kyb-timeline" data-testid="kyb-timeline">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Bell className="h-4 w-4" /> Notifications
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {notifications.length === 0 ? (
            <p className="text-sm text-muted-foreground">No notifications yet — we'll ping you as soon as the admin team reviews your application.</p>
          ) : notifications.map((n) => (
            <div
              key={n.id}
              data-testid={`notif-${n.id}`}
              data-read={n.read_at ? "true" : "false"}
              className={`rounded-md border p-3 transition-opacity ${n.read_at ? "opacity-60" : ""}`}
            >
              <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                <NotifBadge kind={n.kind} />
                <span>{n.title}</span>
                {n.read_at
                  ? <Badge variant="secondary" className="text-[10px] py-0" data-testid="notif-acknowledged">Acknowledged</Badge>
                  : <Badge className="text-[10px] py-0 bg-primary text-primary-foreground">New</Badge>}
                <span className="ml-auto text-xs text-muted-foreground">{new Date(n.created_at).toLocaleString()}</span>
              </div>
              {n.message && <p className="mt-1 text-sm text-muted-foreground">{n.message}</p>}
              {n.reason && (
                <p className="mt-1 text-xs">
                  <span className="font-medium">Reason:</span> {n.reason}
                </p>
              )}
              {n.evidence && Object.keys(n.evidence).length > 0 && (
                <details className="mt-1 text-xs">
                  <summary className="cursor-pointer text-muted-foreground">Evidence</summary>
                  <pre className="mt-1 overflow-auto rounded bg-muted/40 p-2 text-[11px]">
                    {JSON.stringify(n.evidence, null, 2)}
                  </pre>
                </details>
              )}
              {ackFailed[n.id] && (
                <div
                  className="mt-2 rounded border border-destructive/40 bg-destructive/5 px-2 py-1 text-xs text-destructive"
                  data-testid={`notif-ack-error-${n.id}`}
                  role="alert"
                >
                  <div><span className="font-medium">Acknowledge failed:</span> {ackFailed[n.id]}</div>
                  <div className="mt-0.5 opacity-90">
                    Attempt {ackAttempts[n.id] ?? 0}/{maxAckAttempts}
                    {typeof ackRemaining[n.id] === "number" && (
                      <> · <span data-testid={`notif-ack-remaining-${n.id}`}>{ackRemaining[n.id]} retr{ackRemaining[n.id] === 1 ? "y" : "ies"} remaining</span></>
                    )}
                    {ackNextRetryAt[n.id] && (
                      <> · next retry available at{" "}
                        <span data-testid={`notif-ack-next-${n.id}`}>
                          {new Date(ackNextRetryAt[n.id]).toLocaleTimeString()}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                {!n.read_at && !ackFailed[n.id] && (
                  <Button size="sm" variant="secondary"
                          onClick={() => acknowledge(n.id)}
                          disabled={ackBusy === n.id}
                          data-testid={`notif-ack-${n.id}`}>
                    {ackBusy === n.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <CheckCircle2 className="mr-1 h-3 w-3" />}
                    Acknowledge
                  </Button>
                )}
                {ackFailed[n.id] && (ackRemaining[n.id] ?? 1) > 0 && (
                  <Button size="sm" variant="destructive"
                          onClick={() => acknowledge(n.id, { force: true })}
                          disabled={ackBusy === n.id}
                          data-testid={`notif-ack-retry-${n.id}`}>
                    {ackBusy === n.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
                    Retry acknowledge ({ackRemaining[n.id]} left)
                  </Button>
                )}
                {n.slot_key && (n.kind === "document_rejected" || n.kind === "rescan_failed" || n.kind === "draft_changes_requested") && (
                  <Button size="sm" variant="outline"
                          onClick={() => nav("/corporate/register/documents")}>
                    <UploadCloud className="mr-1 h-3 w-3" /> Re-upload {n.slot_key.replace(/_/g, " ")}
                  </Button>
                )}
              </div>

            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4" /> Documents & OCR
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {docs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No documents uploaded yet.</p>
          ) : docs.map((d) => (
            <div key={d.id} className="rounded-md border p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                {d.admin_decision === "approved" ? <CheckCircle2 className="h-4 w-4 text-status-success" />
                  : d.admin_decision === "rejected" ? <XCircle className="h-4 w-4 text-destructive" />
                  : <Info className="h-4 w-4 text-muted-foreground" />}
                <span>{d.slot_key.replace(/_/g, " ")}</span>
                <Badge variant="secondary" className="text-[10px] py-0">v{d.current_version ?? 1}</Badge>
                {d.reupload_required && <Badge variant="destructive" className="text-[10px] py-0">Re-upload required</Badge>}
                <span className="ml-auto text-xs text-muted-foreground">{d.original_name}</span>
              </div>
              {d.admin_reason && (
                <p className="mt-1 text-xs text-destructive"><span className="font-medium">Admin note:</span> {d.admin_reason}</p>
              )}
              {d.validation?.errors?.length ? (
                <p className="mt-1 text-xs text-destructive">Validation: {d.validation.errors.join(", ")}</p>
              ) : null}
              <OcrGrid extracted={d.extracted} confidence={d.ocr_confidence} provider={d.ocr_provider ?? null} />
            </div>
          ))}
          <div className="pt-2">
            <Button size="sm" variant="outline" onClick={() => nav("/corporate/register/documents")}>
              <UploadCloud className="mr-1 h-3 w-3" /> Manage documents
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function NotifBadge({ kind }: { kind: string }) {
  const map: Record<string, { label: string; cls?: string; variant?: "default" | "destructive" | "secondary" }> = {
    draft_approved:          { label: "Approved",         cls: "bg-status-success text-ice" },
    draft_rejected:          { label: "Rejected",         variant: "destructive" },
    draft_changes_requested: { label: "Changes requested" },
    document_approved:       { label: "Doc approved",     cls: "bg-status-success text-ice" },
    document_rejected:       { label: "Doc rejected",     variant: "destructive" },
    rescan_failed:           { label: "Rescan failed",    variant: "destructive" },
  };
  const m = map[kind] ?? { label: kind };
  return <Badge variant={m.variant} className={`text-[10px] py-0 ${m.cls ?? ""}`}>{m.label}</Badge>;
}

export function OcrGrid({
  extracted, confidence, provider,
}: { extracted?: Record<string, unknown>; confidence?: Record<string, number>; provider?: string | null }) {
  const entries = Object.entries(extracted ?? {}).filter(([, v]) => v != null && v !== "");
  // Hide confidence chips until a real OCR provider has been wired in. The stub
  // extractor emits fixture confidences that would otherwise mislead reviewers.
  const hasRealOcr = !!provider && provider !== "stub";
  if (!entries.length) {
    return (
      <div className="mt-2 rounded bg-muted/30 p-2 text-[11px] text-muted-foreground">
        OCR pending — extracted fields will appear here once the document is processed.
      </div>
    );
  }
  return (
    <div className="mt-2 grid gap-1 rounded bg-muted/30 p-2 text-xs md:grid-cols-3">
      {entries.map(([k, v]) => {
        const c = confidence?.[k];
        return (
          <div key={k} className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{k.replace(/_/g, " ")}</div>
              <div className="truncate">{String(v)}</div>
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
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground" title="Real OCR not yet connected">
                OCR pending
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
