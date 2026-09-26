import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Upload, Eye, Trash2, RefreshCw, FileText, Loader2, CheckCircle2, Clock, XCircle,
  Download, ShieldCheck, AlertTriangle, History, Search, ArrowUpDown, Bell, RotateCcw, X,
  Settings, FileDown, MailWarning, Undo2, ChevronLeft, ChevronRight,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { downloadCsv, toCsv } from "@/lib/csv";
import { validateExportRows } from "./exportAuditFilters";
import { ExportSummary } from "./ExportSummary";
import { ExportErrorBanner } from "./ExportErrorBanner";
import { computeExportToken, InflightExportRegistry } from "./exportRequestToken";
import {
  detectTokenConflict, ExportTokenConflictError, canonicalizeFilters,
  type PriorAttempt,
} from "./exportGuardValidator";
import { AppButton } from "@/components/nav/AppButton";
import { recordDiagnostic } from "@/lib/runtime/diagnostics";

// Per-tab idempotency guard for audit-log exports. Repeated retries with the
// exact same fmt+ids+filters within the dedupe window share a single result
// so the audit log stays clean and no duplicate downloads are produced.
const exportRegistry = new InflightExportRegistry<{ count: number }>();

type DocType =
  | "business_photo" | "certificate_of_incorporation" | "contract" | "cr12"
  | "crb_payment" | "crb_report" | "kra_pin" | "tax_compliance";

type Status = "pending" | "approved" | "rejected";

type Row = {
  id: string;
  corporate_id: string;
  doc_type: DocType;
  document_number: string | null;
  expiry_date: string | null;
  storage_path: string;
  original_name: string;
  mime: string;
  size_bytes: number;
  status: Status;
  reviewer_notes: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  uploaded_at: string;
};

type AuditRow = {
  id: string; action: string; actor_id: string | null; actor_role: string | null;
  from_status: string | null; to_status: string | null; reason: string | null;
  detail: Record<string, unknown>; created_at: string;
};

type VersionRow = {
  id: string; document_id: string; version_number: number; reason: string | null;
  storage_path: string; original_name: string; mime: string; size_bytes: number;
  status: string; document_number: string | null; expiry_date: string | null;
  snapshotted_at: string; snapshotted_by: string | null;
};

type NotifRow = {
  id: string; document_id: string | null; doc_type: string | null;
  kind: string; severity: string; title: string; body: string | null;
  expiry_date: string | null; read_at: string | null; created_at: string;
};

const DOC_CATALOG: { key: DocType; label: string; hasExpiry: boolean; hasNumber: boolean }[] = [
  { key: "business_photo",              label: "Business Photo",              hasExpiry: false, hasNumber: false },
  { key: "certificate_of_incorporation",label: "Certificate of Incorporation",hasExpiry: true,  hasNumber: true  },
  { key: "contract",                    label: "Contract",                    hasExpiry: true,  hasNumber: false },
  { key: "cr12",                        label: "CR12 Application Form",       hasExpiry: true,  hasNumber: true  },
  { key: "crb_payment",                 label: "CRB Payment",                 hasExpiry: false, hasNumber: true  },
  { key: "crb_report",                  label: "CRB Report",                  hasExpiry: true,  hasNumber: false },
  { key: "kra_pin",                     label: "KRA PIN",                     hasExpiry: false, hasNumber: true  },
  { key: "tax_compliance",              label: "Tax Compliance",              hasExpiry: true,  hasNumber: true  },
];
const LABELS: Record<string, string> = Object.fromEntries(DOC_CATALOG.map(d => [d.key, d.label]));

const BUCKET = "corporate-documents";
const EXPIRY_WARN_DAYS = 30;

const fmtDate = (d: string | null) => d ? new Date(d).toISOString().slice(0, 10) : "—";
const fmtDT = (d: string) => {
  const dt = new Date(d); const iso = dt.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
};

function expiryState(dateStr: string | null, warnDays: number = EXPIRY_WARN_DAYS): "none" | "expired" | "soon" | "ok" {
  if (!dateStr) return "none";
  const now = Date.now(); const t = new Date(dateStr).getTime();
  if (t < now) return "expired";
  if (t - now < warnDays * 86400_000) return "soon";
  return "ok";
}

type ExpiryFilter = "all" | "expiring" | "expired";
type SortKey = "type" | "status" | "expiry" | "number" | "uploaded";
type SortDir = "asc" | "desc";

export default function CorporateDocuments({ corporateId }: { corporateId: string | null }) {
  const { user, isAdmin, isCorporateAdmin } = useAuth();
  const canReview = !!isAdmin;
  const canDownload = !!(isAdmin || isCorporateAdmin);

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Filters + search + sort
  const [filter, setFilter] = useState<ExpiryFilter>("all");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | Status>("all");
  const [typeFilter, setTypeFilter] = useState<"all" | DocType>("all");
  const [sortKey, setSortKey] = useState<SortKey>("type");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Selection
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<{ decision: "approved" | "rejected"; reason: string } | null>(null);

  // Dialogs
  const [preview, setPreview] = useState<{ url: string; row: Row } | null>(null);
  const [review, setReview] = useState<{ row: Row; decision: "approved" | "rejected" } | null>(null);
  const [reviewReason, setReviewReason] = useState("");
  const [auditRow, setAuditRow] = useState<Row | null>(null);
  const [auditEntries, setAuditEntries] = useState<AuditRow[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [historyRow, setHistoryRow] = useState<Row | null>(null);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);

  // In-app notifications
  const [notifs, setNotifs] = useState<NotifRow[]>([]);

  // Notification preferences
  type Prefs = { in_app: boolean; email: boolean; expiry_window_days: number };
  const [prefs, setPrefs] = useState<Prefs>({ in_app: true, email: true, expiry_window_days: 30 });
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [prefsSaving, setPrefsSaving] = useState(false);

  // Bulk validation summary
  const [bulkValidation, setBulkValidation] = useState<{
    ok: { id: string; label: string }[];
    conflicts: { id: string; label: string; reason: string }[];
  } | null>(null);

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Notification banner: show read history + pagination
  const [showReadNotifs, setShowReadNotifs] = useState(false);
  const [notifPage, setNotifPage] = useState(1);
  const NOTIF_PAGE_SIZE = 5;

  // Export filters dialog
  type ExportFilters = {
    fromDate: string; toDate: string;
    docTypes: DocType[];
    actions: string[]; // e.g. approve/reject/upload/delete/view/download/restore_version
  };
  const emptyExportFilters: ExportFilters = { fromDate: "", toDate: "", docTypes: [], actions: [] };
  const [exportOpen, setExportOpen] = useState<null | "csv" | "pdf">(null);
  const [exportFilters, setExportFilters] = useState<ExportFilters>(emptyExportFilters);
  // Preserve last attempt so a failed export can be retried with the same
  // filters — never cleared on dialog close.
  const [exportError, setExportError] = useState<{
    fmt: "csv" | "pdf"; filters: ExportFilters; message: string; at: string; requestToken?: string;
  } | null>(null);
  // Dedicated retry indicator — kept distinct from the generic `busy` flag so
  // the banner shows "Retrying export…" instead of a shared spinner state.
  const [retrying, setRetrying] = useState(false);
  // Export summary (dialog): expected row count preview + last actual count.
  const [exportPreview, setExportPreview] = useState<{
    loading: boolean; expected: number | null; error: string | null;
  }>({ loading: false, expected: null, error: null });
  const [lastExportActual, setLastExportActual] = useState<number | null>(null);
  // Stable snapshot for "Mark page read" — freezes the ids at click time so
  // realtime INSERT/UPDATE events cannot shift the marked set mid-flight.
  const [markingSnapshot, setMarkingSnapshot] = useState<{
    ids: string[]; page: number; totalPages: number;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingDocTypeRef = useRef<DocType | null>(null);

  // Email verification — required before enabling email alerts
  const emailVerified = !!(user as { email_confirmed_at?: string } | null)?.email_confirmed_at;

  const load = useCallback(async () => {
    if (!corporateId) { setLoading(false); return; }
    setLoading(true); setError(null);
    const sortColumn: Record<SortKey, string> = {
      type: "doc_type", status: "status", expiry: "expiry_date",
      number: "document_number", uploaded: "uploaded_at",
    };
    const [docs, ns, pf] = await Promise.all([
      supabase.from("corporate_documents")
        .select("id, corporate_id, doc_type, document_number, expiry_date, storage_path, original_name, mime, size_bytes, status, reviewer_notes, reviewed_by, reviewed_at, uploaded_at")
        .eq("corporate_id", corporateId)
        .order(sortColumn[sortKey], { ascending: sortDir === "asc", nullsFirst: false }),
      supabase.from("corporate_document_notifications")
        .select("id, document_id, doc_type, kind, severity, title, body, expiry_date, read_at, created_at")
        .eq("corporate_id", corporateId)
        .order("created_at", { ascending: false })
        .limit(100),
      user ? supabase.from("corporate_document_notification_prefs")
        .select("in_app, email, expiry_window_days")
        .eq("corporate_id", corporateId).eq("user_id", user.id).maybeSingle()
        : Promise.resolve({ data: null as Prefs | null, error: null }),
    ]);
    if (docs.error) setError(docs.error.message);
    else setRows((docs.data ?? []) as Row[]);
    if (!ns.error) setNotifs((ns.data ?? []) as NotifRow[]);
    if (pf && !pf.error && pf.data) setPrefs(pf.data as Prefs);
    setLoading(false);
  }, [corporateId, user, sortKey, sortDir]);

  useEffect(() => { load(); }, [load]);

  // Realtime: new expiry notifications appear instantly (respecting in-app pref)
  useEffect(() => {
    if (!corporateId) return;
    const channel = supabase
      .channel(`corp-doc-notifs-${corporateId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "corporate_document_notifications", filter: `corporate_id=eq.${corporateId}` },
        (payload) => {
          const n = payload.new as NotifRow;
          setNotifs((prev) => (prev.some((x) => x.id === n.id) ? prev : [n, ...prev].slice(0, 100)));
          if (!prefs.in_app || n.read_at) return;
          toast({
            title: n.title,
            description: n.body ?? undefined,
            variant: n.severity === "critical" ? "destructive" : "default",
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "corporate_document_notifications", filter: `corporate_id=eq.${corporateId}` },
        (payload) => {
          const n = payload.new as NotifRow;
          setNotifs((prev) => prev.map((x) => (x.id === n.id ? n : x)));
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [corporateId, prefs.in_app]);

  const savePrefs = async (next: Prefs) => {
    if (!corporateId || !user) return;
    if (next.email && !emailVerified) {
      toast({
        title: "Verify your email first",
        description: "Confirm your email address before enabling email alerts.",
        variant: "destructive",
      });
      return;
    }
    setPrefsSaving(true);
    const { error } = await supabase.from("corporate_document_notification_prefs").upsert({
      corporate_id: corporateId, user_id: user.id,
      in_app: next.in_app, email: next.email, expiry_window_days: next.expiry_window_days,
    }, { onConflict: "corporate_id,user_id" });
    setPrefsSaving(false);
    if (error) { toast({ title: "Could not save preferences", description: error.message, variant: "destructive" }); return; }
    setPrefs(next);
    toast({ title: "Preferences saved" });
  };

  // Derived notification lists — realtime state changes flow through here so
  // the unread badge updates instantly whenever a notification is marked
  // read/unread (locally, by realtime UPDATEs, or by cron INSERTs).
  const unreadNotifs = useMemo(() => notifs.filter((n) => !n.read_at), [notifs]);
  const visibleNotifs = showReadNotifs ? notifs : unreadNotifs;
  const notifTotalPages = Math.max(1, Math.ceil(visibleNotifs.length / NOTIF_PAGE_SIZE));
  const safeNotifPage = Math.min(notifPage, notifTotalPages);
  const pagedNotifs = useMemo(
    () => visibleNotifs.slice((safeNotifPage - 1) * NOTIF_PAGE_SIZE, safeNotifPage * NOTIF_PAGE_SIZE),
    [visibleNotifs, safeNotifPage],
  );
  const pagedUnreadCount = pagedNotifs.filter((n) => !n.read_at).length;

  // Reset notification page when the filter changes.
  useEffect(() => { setNotifPage(1); }, [showReadNotifs]);


  const rowsByType = useMemo(() => new Map(rows.map(r => [r.doc_type, r])), [rows]);
  const uploadedCount = rows.length;
  const expiringCount = rows.filter(r => expiryState(r.expiry_date, prefs.expiry_window_days) === "soon").length;
  const expiredCount  = rows.filter(r => expiryState(r.expiry_date, prefs.expiry_window_days) === "expired").length;

  const audit = useCallback(async (entry: {
    action: string; document_id?: string | null; doc_type?: DocType | string | null;
    from_status?: string | null; to_status?: string | null; reason?: string | null;
    detail?: Record<string, unknown>;
  }) => {
    if (!corporateId || !user) return;
    try {
      await supabase.from("corporate_document_audit_log").insert({
        corporate_id: corporateId,
        document_id: entry.document_id ?? null,
        doc_type: entry.doc_type ?? null,
        action: entry.action,
        actor_id: user.id,
        actor_role: isAdmin ? "platform_admin" : (isCorporateAdmin ? "corporate_admin" : "corporate_member"),
        from_status: entry.from_status ?? null,
        to_status: entry.to_status ?? null,
        reason: entry.reason ?? null,
        detail: (entry.detail ?? {}) as never,
      });
    } catch { /* best effort */ }
  }, [corporateId, user, isAdmin, isCorporateAdmin]);

  // Build displayable list: one entry per catalog doc type + apply filters/search/sort
  type Item = { doc: typeof DOC_CATALOG[number]; row?: Row };
  const items: Item[] = useMemo(() => {
    let base: Item[] = DOC_CATALOG.map(doc => ({ doc, row: rowsByType.get(doc.key) }));
    if (filter !== "all") {
      base = base.filter(({ row }) => {
        const st = expiryState(row?.expiry_date ?? null, prefs.expiry_window_days);
        return filter === "expired" ? st === "expired" : st === "soon";
      });
    }
    if (statusFilter !== "all") {
      base = base.filter(({ row }) => (row?.status ?? "pending") === statusFilter && !!row);
    }
    if (typeFilter !== "all") {
      base = base.filter(({ doc }) => doc.key === typeFilter);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      base = base.filter(({ doc, row }) =>
        doc.label.toLowerCase().includes(q) ||
        (row?.document_number ?? "").toLowerCase().includes(q) ||
        (row?.original_name ?? "").toLowerCase().includes(q)
      );
    }
    const dir = sortDir === "asc" ? 1 : -1;
    const cmp = (a: Item, b: Item): number => {
      switch (sortKey) {
        case "type": return a.doc.label.localeCompare(b.doc.label) * dir;
        case "status": return ((a.row?.status ?? "zzz").localeCompare(b.row?.status ?? "zzz")) * dir;
        case "number": return ((a.row?.document_number ?? "").localeCompare(b.row?.document_number ?? "")) * dir;
        case "uploaded": return ((a.row?.uploaded_at ?? "").localeCompare(b.row?.uploaded_at ?? "")) * dir;
        case "expiry": {
          const av = a.row?.expiry_date ? new Date(a.row.expiry_date).getTime() : Number.POSITIVE_INFINITY;
          const bv = b.row?.expiry_date ? new Date(b.row.expiry_date).getTime() : Number.POSITIVE_INFINITY;
          return (av - bv) * dir;
        }
      }
    };
    return [...base].sort(cmp);
  }, [rowsByType, filter, statusFilter, typeFilter, search, sortKey, sortDir, prefs.expiry_window_days]);

  // Client-side pagination on top of server-sorted data
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedItems = useMemo(
    () => items.slice((safePage - 1) * pageSize, safePage * pageSize),
    [items, safePage, pageSize],
  );

  // Reset to first page whenever filters/sort/pageSize change
  useEffect(() => { setPage(1); }, [filter, statusFilter, typeFilter, search, sortKey, sortDir, pageSize]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir("asc"); }
  };

  // Selection helpers
  const selectableRows = items.filter(i => i.row).map(i => i.row!);
  const allSelected = selectableRows.length > 0 && selectableRows.every(r => selected.has(r.id));
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(selectableRows.map(r => r.id)));
  };
  const toggleOne = (id: string) => {
    setSelected(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  // Upload
  const startUpload = (dt: DocType) => { pendingDocTypeRef.current = dt; fileInputRef.current?.click(); };
  const onFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; const dt = pendingDocTypeRef.current;
    e.target.value = "";
    if (!file || !dt || !corporateId || !user) return;
    if (file.size > 15 * 1024 * 1024) {
      toast({ title: "File too large", description: "Max 15 MB per document.", variant: "destructive" }); return;
    }
    setBusy(dt);
    try {
      const ext = file.name.split(".").pop() || "bin";
      const path = `${corporateId}/${dt}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw upErr;
      const existing = rowsByType.get(dt);
      let documentId = existing?.id ?? null; let action: "upload" | "replace" = "upload";
      if (existing) {
        action = "replace";
        await supabase.storage.from(BUCKET).remove([existing.storage_path]).catch(() => {});
        const { error } = await supabase.from("corporate_documents").update({
          storage_path: path, original_name: file.name, mime: file.type || "application/octet-stream",
          size_bytes: file.size, status: "pending", reviewer_notes: null, reviewed_by: null, reviewed_at: null, uploaded_by: user.id,
        }).eq("id", existing.id);
        if (error) throw error;
      } else {
        const { data: ins, error } = await supabase.from("corporate_documents").insert({
          corporate_id: corporateId, doc_type: dt, storage_path: path, original_name: file.name,
          mime: file.type || "application/octet-stream", size_bytes: file.size, status: "pending", uploaded_by: user.id,
        }).select("id").single();
        if (error) throw error;
        documentId = ins?.id ?? null;
      }
      await audit({ action, document_id: documentId, doc_type: dt, to_status: "pending",
        detail: { original_name: file.name, size_bytes: file.size, mime: file.type } });
      toast({ title: "Uploaded", description: "Document sent for verification." });
      await load();
    } catch (err) {
      toast({ title: "Upload failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally { setBusy(null); pendingDocTypeRef.current = null; }
  };

  const openPreview = async (r: Row) => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(r.storage_path, 300);
    if (error || !data?.signedUrl) {
      toast({ title: "Cannot open file", description: error?.message ?? "No URL returned.", variant: "destructive" }); return;
    }
    setPreview({ url: data.signedUrl, row: r });
    await audit({ action: "view", document_id: r.id, doc_type: r.doc_type });
  };

  const onDownload = async (r: Row) => {
    if (!canDownload) { toast({ title: "Not permitted", variant: "destructive" }); return; }
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(r.storage_path, 120, { download: r.original_name });
    if (error || !data?.signedUrl) {
      toast({ title: "Download failed", description: error?.message, variant: "destructive" }); return;
    }
    window.open(data.signedUrl, "_blank", "noopener");
    await audit({ action: "download", document_id: r.id, doc_type: r.doc_type });
  };

  const onDelete = async (r: Row) => {
    if (!confirm(`Delete "${r.original_name}"?`)) return;
    setBusy(r.doc_type);
    try {
      await supabase.storage.from(BUCKET).remove([r.storage_path]).catch(() => {});
      const { error } = await supabase.from("corporate_documents").delete().eq("id", r.id);
      if (error) throw error;
      await audit({ action: "delete", document_id: r.id, doc_type: r.doc_type, from_status: r.status,
        detail: { original_name: r.original_name, storage_path: r.storage_path } });
      toast({ title: "Deleted" }); await load();
    } catch (err) {
      toast({ title: "Delete failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally { setBusy(null); }
  };

  const submitReview = async () => {
    if (!review || !user) return;
    if (review.decision === "rejected" && !reviewReason.trim()) {
      toast({ title: "Reason required", variant: "destructive" }); return;
    }
    setBusy(review.row.doc_type);
    try {
      const { error } = await supabase.from("corporate_documents").update({
        status: review.decision, reviewer_notes: reviewReason.trim() || null,
        reviewed_by: user.id, reviewed_at: new Date().toISOString(),
      }).eq("id", review.row.id);
      if (error) throw error;
      await audit({ action: review.decision === "approved" ? "approve" : "reject",
        document_id: review.row.id, doc_type: review.row.doc_type,
        from_status: review.row.status, to_status: review.decision, reason: reviewReason.trim() || null });
      toast({ title: review.decision === "approved" ? "Approved" : "Rejected" });
      setReview(null); setReviewReason(""); await load();
    } catch (err) {
      toast({ title: "Update failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally { setBusy(null); }
  };

  // Per-item validation before opening the bulk confirm dialog.
  const openBulk = (decision: "approved" | "rejected") => {
    const ok: { id: string; label: string }[] = [];
    const conflicts: { id: string; label: string; reason: string }[] = [];
    for (const id of selected) {
      const r = rows.find((x) => x.id === id); if (!r) continue;
      const catalog = DOC_CATALOG.find((d) => d.key === r.doc_type);
      const label = catalog?.label ?? r.doc_type;
      const problems: string[] = [];
      if (r.status === decision) problems.push(`already ${decision}`);
      if (decision === "approved") {
        if (catalog?.hasNumber && !r.document_number) problems.push("missing document number");
        if (catalog?.hasExpiry && !r.expiry_date) problems.push("missing expiry date");
        if (catalog?.hasExpiry && r.expiry_date && new Date(r.expiry_date).getTime() < Date.now())
          problems.push("document is expired");
        if (!r.storage_path) problems.push("no file uploaded");
      }
      if (problems.length) conflicts.push({ id, label, reason: problems.join("; ") });
      else ok.push({ id, label });
    }
    setBulkValidation({ ok, conflicts });
    setBulk({ decision, reason: "" });
  };

  const submitBulk = async () => {
    if (!bulk || !user || !bulkValidation) return;
    if (bulk.decision === "rejected" && !bulk.reason.trim()) {
      toast({ title: "Reason required for bulk rejection", variant: "destructive" }); return;
    }
    setBusy("__bulk__");
    const ids = bulkValidation.ok.map((x) => x.id); let ok = 0; let fail = 0;
    for (const id of ids) {
      const src = rows.find(r => r.id === id); if (!src) continue;
      const { error } = await supabase.from("corporate_documents").update({
        status: bulk.decision, reviewer_notes: bulk.reason.trim() || null,
        reviewed_by: user.id, reviewed_at: new Date().toISOString(),
      }).eq("id", id);
      if (error) { fail++; continue; }
      await audit({ action: bulk.decision === "approved" ? "approve" : "reject",
        document_id: id, doc_type: src.doc_type, from_status: src.status,
        to_status: bulk.decision, reason: bulk.reason.trim() || null, detail: { bulk: true } });
      ok++;
    }
    setBusy(null); setBulk(null); setBulkValidation(null); setSelected(new Set());
    toast({ title: `Bulk ${bulk.decision}`, description: `${ok} updated${fail ? `, ${fail} failed` : ""}` });
    await load();
  };

  // Export audit log for selected documents (or all if none selected) as CSV or PDF.
  // Applies optional filters: date range, doc types, action set.
  // After the query returns, the results are re-validated client-side to
  // confirm every row falls within the requested date range, doc types, and
  // action set — a defence-in-depth check against backend filter drift.
  const runExportAudit = async (fmt: "csv" | "pdf", filters: ExportFilters) => {
    if (!corporateId) return;
    let ids = selected.size > 0 ? Array.from(selected) : rows.map((r) => r.id);
    if (filters.docTypes.length > 0) {
      const allowed = new Set(filters.docTypes as string[]);
      ids = rows.filter((r) => allowed.has(r.doc_type) && ids.includes(r.id)).map((r) => r.id);
    }
    if (ids.length === 0) {
      const msg = "No documents matched the current selection and filters.";
      setExportError({ fmt, filters, message: msg, at: new Date().toISOString() });
      toast({ title: "Nothing to export", description: msg, variant: "destructive" });
      return;
    }
    setBusy("__export__");
    const startedAt = toast({
      title: `Preparing ${fmt.toUpperCase()} export…`,
      description: "Gathering audit events. This may take a moment for large ranges.",
    });
    // Idempotency: derive a stable token from fmt + ids + filters. Duplicate
    // concurrent submissions share one producer call; identical repeats
    // within the dedupe window replay the cached result.
    const token = computeExportToken({
      fmt,
      documentIds: ids,
      filters: {
        fromDate: filters.fromDate, toDate: filters.toDate,
        docTypes: filters.docTypes as string[], actions: filters.actions,
      },
    });
    // Normalised prior-attempt shape used by the guard (see exportGuardValidator).
    const currentAttempt: PriorAttempt = {
      request_token: token,
      fmt,
      documentIds: ids,
      filters: {
        fromDate: filters.fromDate, toDate: filters.toDate,
        docTypes: filters.docTypes as string[], actions: filters.actions,
      },
    };
    try {
      // Pre-flight guard: if a prior audit row exists for this token, its
      // recorded payload MUST match the current submission. Different filters
      // → 409 mismatch (recorded, surfaced to UI, download refused).
      const { data: priorRows } = await supabase
        .from("corporate_document_audit_log")
        .select("detail, created_at")
        .eq("corporate_id", corporateId)
        .eq("action", "export_audit_log")
        .contains("detail", { request_token: token } as never)
        .order("created_at", { ascending: false })
        .limit(1);
      const priorDetail = (priorRows?.[0]?.detail ?? null) as null | {
        format?: "csv" | "pdf"; document_ids?: string[]; filters?: PriorAttempt["filters"];
      };
      const prior: PriorAttempt | null = priorDetail && priorDetail.format && priorDetail.filters
        ? {
            request_token: token,
            fmt: priorDetail.format,
            documentIds: priorDetail.document_ids ?? [],
            filters: priorDetail.filters,
          }
        : null;
      const conflict = detectTokenConflict(prior, currentAttempt);
      if (conflict) {
        // Record the mismatch so the admin trail shows the exact drift.
        await audit({
          action: "export_audit_log_mismatch",
          detail: {
            request_token: token,
            conflict_field: conflict.field,
            prior: conflict.prior,
            current: conflict.current,
            message: conflict.message,
          } as never,
        });
        throw new ExportTokenConflictError(token, conflict);
      }

      const { result, deduped } = await exportRegistry.run(token, async () => {
        let q = supabase.from("corporate_document_audit_log")
          .select("id, document_id, doc_type, action, actor_id, actor_role, from_status, to_status, reason, created_at")
          .in("document_id", ids)
          .order("created_at", { ascending: false });
        if (filters.fromDate) q = q.gte("created_at", `${filters.fromDate}T00:00:00`);
        if (filters.toDate) q = q.lte("created_at", `${filters.toDate}T23:59:59`);
        if (filters.actions.length > 0) q = q.in("action", filters.actions);
        const { data, error } = await q;
        if (error) throw error;

        // Defence-in-depth: re-validate every returned row against the filters
        // using the shared helper covered by exportAuditFilters.test.ts.
        const violations = validateExportRows((data ?? []) as never, filters);
        if (violations.length > 0) {
          throw new Error(
            `Export validation failed — backend returned ${violations.length} row(s) outside your filters. ` +
            `First: ${violations[0].rowId} – ${violations[0].reason}. The download was cancelled to preserve integrity.`
          );
        }

        const flat = (data ?? []).map((e) => ({
          document_type: LABELS[e.doc_type as string] ?? e.doc_type ?? "",
          document_id: e.document_id ?? "",
          action: e.action,
          actor_role: e.actor_role ?? "",
          actor_id: e.actor_id ?? "",
          from_status: e.from_status ?? "",
          to_status: e.to_status ?? "",
          reason: e.reason ?? "",
          timestamp: e.created_at,
        }));
        const stamp = new Date().toISOString().slice(0, 10);
        const rangeLabel = filters.fromDate || filters.toDate
          ? ` · ${filters.fromDate || "…"} → ${filters.toDate || "…"}` : "";
        if (fmt === "csv") {
          downloadCsv(`kyb-audit-${stamp}.csv`, toCsv(flat));
        } else {
          const html = `<!doctype html><html><head><meta charset="utf-8"><title>KYB Audit ${stamp}</title>
            <style>body{font:12px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;padding:24px;color:hsl(218 48% 10%)}
            h1{font-size:16px;margin:0 0 4px} .meta{color:hsl(216 10% 38%);margin-bottom:16px}
            table{border-collapse:collapse;width:100%;font-size:11px}
            th,td{border:1px solid hsl(214 18% 88%);padding:6px 8px;text-align:left;vertical-align:top}
            th{background:hsl(213 24% 95%)} tr:nth-child(even) td{background:hsl(213 27% 98%)}
            @media print{ button{display:none} }</style></head><body>
            <h1>Corporate KYB Audit Log</h1>
            <div class="meta">Generated ${new Date().toLocaleString()} · ${flat.length} events · ${ids.length} document${ids.length === 1 ? "" : "s"}${rangeLabel}</div>
            <button onclick="window.print()">Print / Save as PDF</button>
            <table><thead><tr><th>Timestamp</th><th>Document</th><th>Action</th><th>Actor role</th><th>From</th><th>To</th><th>Reason</th></tr></thead>
            <tbody>${flat.map((r) => `<tr><td>${r.timestamp}</td><td>${escapeHtml(r.document_type)}</td><td>${escapeHtml(r.action)}</td><td>${escapeHtml(r.actor_role)}</td><td>${escapeHtml(r.from_status)}</td><td>${escapeHtml(r.to_status)}</td><td>${escapeHtml(r.reason)}</td></tr>`).join("")}</tbody></table>
            <script>setTimeout(()=>window.print(),300)</script></body></html>`;
          const w = window.open("", "_blank", "noopener,width=1000,height=800");
          if (w) { w.document.open(); w.document.write(html); w.document.close(); }
        }
        await audit({ action: "export_audit_log", detail: { format: fmt, document_ids: ids, event_count: flat.length, filters, request_token: token } });
        return { count: flat.length };
      });
      setLastExportActual(result.count);
      const rangeLabel = filters.fromDate || filters.toDate
        ? ` · ${filters.fromDate || "…"} → ${filters.toDate || "…"}` : "";
      startedAt.dismiss();
      setExportError(null);
      // Dedupe toast: expose the short token and confirm the current filter
      // fingerprint matched the original submission. If deduped, the guard
      // has already verified filter equality (otherwise it would have thrown
      // ExportTokenConflictError above), so "Filters matched" is always true
      // on this branch — surface it explicitly for operator confidence.
      const shortToken = token.length > 20 ? `${token.slice(0, 12)}…${token.slice(-4)}` : token;
      const filtersFingerprint = canonicalizeFilters({
        fromDate: filters.fromDate, toDate: filters.toDate,
        docTypes: filters.docTypes as string[], actions: filters.actions,
      });
      toast({
        title: deduped ? `${fmt.toUpperCase()} export reused (deduped)` : `${fmt.toUpperCase()} export ready`,
        description: deduped
          ? `Reused prior download of ${result.count} event${result.count === 1 ? "" : "s"}. Token ${shortToken} · Filters matched ✓`
          : `${result.count} event${result.count === 1 ? "" : "s"} across ${ids.length} document${ids.length === 1 ? "" : "s"}${rangeLabel}. Download started.`,
      });
      // Machine-readable trace for the debug panel / e2e checks.
      recordDiagnostic({
        category: "API",
        operation: "corporate_documents.export_complete",
        message: "Document export completed",
        metadata: { deduped, token, filtersFingerprint, count: result.count },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      startedAt.dismiss();
      // Distinguish the 4xx token-conflict path so the UI reads clearly.
      const isConflict = err instanceof ExportTokenConflictError;
      setExportError({ fmt, filters, message, at: new Date().toISOString(), requestToken: token });
      toast({
        title: isConflict
          ? `${fmt.toUpperCase()} export refused (409)`
          : `${fmt.toUpperCase()} export failed`,
        description: isConflict
          ? `Token ${token.slice(0, 12)}… was previously used with different ${(err as ExportTokenConflictError).conflict.field}. The mismatch has been recorded in the admin audit trail.`
          : `${message} — filters preserved. Use "Retry export" to try again.`,
        variant: "destructive",
      });
    } finally { setBusy(null); }
  };

  // Re-run the export with the EXACT same fmt + filters. The export dialog
  // (if open) stays open — retry uses its own progress indicator on the
  // banner so callers can keep tweaking filters in parallel if needed.
  const retryExport = async () => {
    if (!exportError || retrying) return;
    setRetrying(true);
    try {
      await runExportAudit(exportError.fmt, exportError.filters);
    } finally {
      setRetrying(false);
    }
  };

  // Preview the expected row count for the current export dialog filters.
  // Uses PostgREST's HEAD count=exact so no rows travel the wire.
  const previewExportCount = useCallback(async () => {
    if (!corporateId) return;
    const filters = exportFilters;
    let ids = selected.size > 0 ? Array.from(selected) : rows.map((r) => r.id);
    if (filters.docTypes.length > 0) {
      const allowed = new Set(filters.docTypes as string[]);
      ids = rows.filter((r) => allowed.has(r.doc_type) && ids.includes(r.id)).map((r) => r.id);
    }
    if (ids.length === 0) {
      setExportPreview({ loading: false, expected: 0, error: null });
      return;
    }
    setExportPreview({ loading: true, expected: null, error: null });
    let q = supabase.from("corporate_document_audit_log")
      .select("id", { count: "exact", head: true })
      .in("document_id", ids);
    if (filters.fromDate) q = q.gte("created_at", `${filters.fromDate}T00:00:00`);
    if (filters.toDate)   q = q.lte("created_at", `${filters.toDate}T23:59:59`);
    if (filters.actions.length > 0) q = q.in("action", filters.actions);
    const { count, error } = await q;
    if (error) setExportPreview({ loading: false, expected: null, error: error.message });
    else setExportPreview({ loading: false, expected: count ?? 0, error: null });
  }, [corporateId, exportFilters, selected, rows]);

  // Auto-refresh the expected count whenever the dialog opens or filters change.
  useEffect(() => {
    if (!exportOpen) return;
    void previewExportCount();
  }, [exportOpen, previewExportCount]);






  const openAudit = async (r: Row) => {
    setAuditRow(r); setAuditEntries([]); setAuditLoading(true);
    const { data } = await supabase.from("corporate_document_audit_log")
      .select("id, action, actor_id, actor_role, from_status, to_status, reason, detail, created_at")
      .eq("document_id", r.id).order("created_at", { ascending: false });
    setAuditEntries((data ?? []) as AuditRow[]); setAuditLoading(false);
  };

  const openHistory = async (r: Row) => {
    setHistoryRow(r); setVersions([]); setVersionsLoading(true);
    const { data } = await supabase.from("corporate_document_versions")
      .select("id, document_id, version_number, reason, storage_path, original_name, mime, size_bytes, status, document_number, expiry_date, snapshotted_at, snapshotted_by")
      .eq("document_id", r.id).order("version_number", { ascending: false });
    setVersions((data ?? []) as VersionRow[]); setVersionsLoading(false);
  };

  const previewVersion = async (v: VersionRow) => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(v.storage_path, 300);
    if (error || !data?.signedUrl) { toast({ title: "Cannot open version", variant: "destructive" }); return; }
    window.open(data.signedUrl, "_blank", "noopener");
    if (historyRow) await audit({ action: "view_version", document_id: historyRow.id, doc_type: historyRow.doc_type, detail: { version_number: v.version_number } });
  };

  const restoreVersion = async (v: VersionRow) => {
    if (!historyRow || !user) return;
    if (!confirm(`Restore version #${v.version_number}? This becomes the active file (pending re-review).`)) return;
    setBusy(historyRow.doc_type);
    try {
      // Copy the old storage object to a new path so both versions remain intact
      const { data: src } = await supabase.storage.from(BUCKET).download(v.storage_path);
      if (!src) throw new Error("Version file missing from storage.");
      const ext = v.original_name.split(".").pop() || "bin";
      const path = `${historyRow.corporate_id}/${historyRow.doc_type}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, src, { contentType: v.mime, upsert: false });
      if (upErr) throw upErr;
      const { error } = await supabase.from("corporate_documents").update({
        storage_path: path, original_name: `restored-v${v.version_number}-${v.original_name}`,
        mime: v.mime, size_bytes: v.size_bytes, status: "pending",
        reviewer_notes: null, reviewed_by: null, reviewed_at: null, uploaded_by: user.id,
      }).eq("id", historyRow.id);
      if (error) throw error;
      await audit({ action: "restore_version", document_id: historyRow.id, doc_type: historyRow.doc_type,
        from_status: historyRow.status, to_status: "pending",
        reason: `Restored version #${v.version_number}`, detail: { version_id: v.id, version_number: v.version_number } });
      toast({ title: "Restored", description: `Version #${v.version_number} is now active (pending re-review).` });
      setHistoryRow(null); await load();
    } catch (err) {
      toast({ title: "Restore failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally { setBusy(null); }
  };

  const markRead = async (id: string) => {
    const stamp = new Date().toISOString();
    setNotifs((prev) => prev.map((n) => (n.id === id ? { ...n, read_at: stamp } : n)));
    await supabase.from("corporate_document_notifications").update({ read_at: stamp }).eq("id", id);
  };
  const markUnread = async (id: string) => {
    setNotifs((prev) => prev.map((n) => (n.id === id ? { ...n, read_at: null } : n)));
    await supabase.from("corporate_document_notifications").update({ read_at: null }).eq("id", id);
  };
  const dismissNotif = markRead; // alias — dismissing = mark read
  // Mark-all-read operates on a STABLE SNAPSHOT of the current page's unread
  // ids, taken at click time. Realtime INSERT/UPDATE events cannot shift the
  // marked set mid-flight because we (a) capture ids up-front, (b) freeze
  // pagination via `markingSnapshot`, and (c) apply the same id list on both
  // the optimistic UI update and the backend UPDATE query.
  const markAllRead = async () => {
    if (markingSnapshot) return; // already in flight — ignore repeat clicks
    const snapshot = {
      ids: pagedNotifs.filter((n) => !n.read_at).map((n) => n.id),
      page: safeNotifPage,
      totalPages: notifTotalPages,
    };
    if (!snapshot.ids.length) {
      toast({ title: "Nothing to mark", description: "No unread alerts on this page." });
      return;
    }
    setMarkingSnapshot(snapshot);
    const stamp = new Date().toISOString();
    // Optimistic UI — only the frozen id set is touched.
    setNotifs((prev) => prev.map((n) => (snapshot.ids.includes(n.id) ? { ...n, read_at: stamp } : n)));
    const { error } = await supabase.from("corporate_document_notifications")
      .update({ read_at: stamp }).in("id", snapshot.ids);
    if (error) {
      // Roll back the optimistic update on failure — again using the snapshot.
      setNotifs((prev) => prev.map((n) => (snapshot.ids.includes(n.id) ? { ...n, read_at: null } : n)));
      setMarkingSnapshot(null);
      toast({ title: "Could not mark all as read", description: error.message, variant: "destructive" });
      return;
    }
    setMarkingSnapshot(null);
    toast({ title: `Marked ${snapshot.ids.length} as read`, description: `Applied to page ${snapshot.page} of ${snapshot.totalPages}.` });
  };

  if (!corporateId) {
    return <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">Link a corporate account to manage documents.</div>;
  }

  return (
    <div className="space-y-4">
      {/* Notification banner */}
      {(unreadNotifs.length > 0 || showReadNotifs) && notifs.length > 0 && (
        <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 border-b bg-status-warning/10 dark:bg-status-warning/20">
            <div className="flex items-center gap-2 text-sm font-semibold text-status-warning dark:text-status-warning">
              <div className="relative">
                <Bell className="h-4 w-4" />
                {unreadNotifs.length > 0 && (
                  <span
                    aria-label={`${unreadNotifs.length} unread alerts`}
                    className="absolute -top-2 -right-2 min-w-[18px] h-[18px] px-1 rounded-full bg-status-danger text-ice text-[10px] font-bold flex items-center justify-center border-2 border-status-warning/30 dark:border-status-warning/30"
                  >
                    {unreadNotifs.length > 99 ? "99+" : unreadNotifs.length}
                  </span>
                )}
              </div>
              <span>{unreadNotifs.length} unread</span>
              <span className="text-status-warning/70 dark:text-status-warning/70 font-normal">
                · {notifs.length - unreadNotifs.length} read
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" className="h-7" onClick={() => setShowReadNotifs((v) => !v)}>
                {showReadNotifs ? "Hide read" : "Show read"}
              </Button>
              <Button
                size="sm" variant="ghost" className="h-7 gap-1"
                onClick={markAllRead}
                disabled={pagedUnreadCount === 0 || !!markingSnapshot}
                title="Marks only alerts on the current page (snapshot frozen while in flight)"
              >
                {markingSnapshot ? (
                  <><Loader2 className="h-3 w-3 animate-spin" /> Marking {markingSnapshot.ids.length}…</>
                ) : (
                  <>Mark page read{pagedUnreadCount > 0 ? ` (${pagedUnreadCount})` : ""}</>
                )}
              </Button>
            </div>
          </div>
          <ul className="divide-y">
            {pagedNotifs.map((n) => {
              const isRead = !!n.read_at;
              return (
                <li key={n.id} className={cn("flex items-start justify-between gap-3 px-4 py-2.5 text-sm", isRead && "opacity-60")}>
                  <div className="flex items-start gap-2 min-w-0">
                    <span className={cn("mt-0.5 inline-block h-2 w-2 rounded-full shrink-0",
                      isRead ? "bg-muted-foreground/40"
                      : n.severity === "critical" ? "bg-status-danger"
                      : n.severity === "warning" ? "bg-status-warning" : "bg-primary")} />
                    <div className="min-w-0">
                      <div className={cn("truncate", isRead ? "font-normal" : "font-medium")}>{n.title}</div>
                      {n.body && <div className="text-xs text-muted-foreground truncate">{n.body}</div>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {isRead ? (
                      <button onClick={() => markUnread(n.id)} className="text-muted-foreground hover:text-foreground" title="Mark as unread">
                        <Undo2 className="h-4 w-4" />
                      </button>
                    ) : (
                      <button onClick={() => dismissNotif(n.id)} className="text-muted-foreground hover:text-foreground" title="Mark as read">
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
            {visibleNotifs.length === 0 && (
              <li className="px-4 py-3 text-sm text-muted-foreground text-center">All caught up.</li>
            )}
          </ul>
          {visibleNotifs.length > NOTIF_PAGE_SIZE && (
            <div className="flex items-center justify-between gap-2 px-4 py-2 border-t bg-muted/10 text-xs text-muted-foreground">
              <span>
                {(safeNotifPage - 1) * NOTIF_PAGE_SIZE + 1}
                –{Math.min(safeNotifPage * NOTIF_PAGE_SIZE, visibleNotifs.length)} of {visibleNotifs.length}
              </span>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="outline" className="h-7 px-2"
                        onClick={() => setNotifPage((p) => Math.max(1, p - 1))}
                        disabled={safeNotifPage <= 1 || !!markingSnapshot}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="px-2">Page {safeNotifPage} / {notifTotalPages}</span>
                <Button size="sm" variant="outline" className="h-7 px-2"
                        onClick={() => setNotifPage((p) => Math.min(notifTotalPages, p + 1))}
                        disabled={safeNotifPage >= notifTotalPages || !!markingSnapshot}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}




      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        <input ref={fileInputRef} type="file" className="hidden"
               accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx" onChange={onFilePicked} />

        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b">
          <div>
            <h2 className="text-lg font-semibold text-primary">Corporate Documents</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {uploadedCount} / {DOC_CATALOG.length} uploaded
              {expiringCount > 0 && <> · <span className="text-status-warning font-medium">{expiringCount} expiring soon</span></>}
              {expiredCount > 0 && <> · <span className="text-status-danger font-medium">{expiredCount} expired</span></>}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)}
                     placeholder="Search name or number…" className="pl-8 h-9 w-56" />
            </div>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as "all" | DocType)}
                    className="h-9 rounded-md border bg-background px-2 text-sm">
              <option value="all">All types</option>
              {DOC_CATALOG.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "all" | Status)}
                    className="h-9 rounded-md border bg-background px-2 text-sm">
              <option value="all">All statuses</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
            <div className="inline-flex rounded-md border overflow-hidden text-xs">
              {(["all","expiring","expired"] as ExpiryFilter[]).map(f => (
                <button key={f} onClick={() => setFilter(f)}
                        className={cn("px-3 py-1.5 font-medium transition-colors",
                          filter === f ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted")}>
                  {f === "all" ? "All" : f === "expiring" ? `Expiring (${expiringCount})` : `Expired (${expiredCount})`}
                </button>
              ))}
            </div>
            <Button size="sm" variant="outline"
                    onClick={() => { setExportFilters(emptyExportFilters); setExportOpen("csv"); }}
                    className="gap-2" disabled={busy === "__export__"} title="Export audit log CSV">
              <FileDown className="h-4 w-4" />CSV
            </Button>
            <Button size="sm" variant="outline"
                    onClick={() => { setExportFilters(emptyExportFilters); setExportOpen("pdf"); }}
                    className="gap-2" disabled={busy === "__export__"} title="Export audit log PDF">
              <FileDown className="h-4 w-4" />PDF
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPrefsOpen(true)} className="gap-2" title="Notification settings">
              <Settings className="h-4 w-4" />Alerts
            </Button>
            <Button size="sm" onClick={load} className="gap-2" disabled={loading}>
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />Refresh
            </Button>
          </div>
        </div>

        {/* Bulk toolbar */}
        {canReview && selected.size > 0 && (
          <div className="flex items-center justify-between gap-3 px-5 py-2 bg-primary/5 border-b">
            <div className="text-sm font-medium">{selected.size} selected</div>
            <div className="flex items-center gap-2">
              <Button size="sm" className="bg-status-success hover:bg-status-success gap-1.5"
                      onClick={() => openBulk("approved")}>
                <ShieldCheck className="h-4 w-4" />Bulk approve
              </Button>
              <Button size="sm" className="bg-status-danger hover:bg-status-danger gap-1.5"
                      onClick={() => openBulk("rejected")}>
                <XCircle className="h-4 w-4" />Bulk reject
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
            </div>
          </div>
        )}

        {error && (
          <div className="px-5 py-3 bg-status-danger/10 dark:bg-status-danger/20 text-sm text-status-danger dark:text-status-danger border-b">{error}</div>
        )}

        {exportError && (
          <ExportErrorBanner
            exportError={exportError}
            retrying={retrying}
            onRetry={retryExport}
            onAdjust={() => { setExportFilters(exportError.filters); setExportOpen(exportError.fmt); }}
            onDismiss={() => setExportError(null)}
          />
        )}


        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                {canReview && (
                  <th className="w-10 px-3 py-3">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll}
                           disabled={selectableRows.length === 0} aria-label="Select all" />
                  </th>
                )}
                <SortHeader label="Document Name" k="type" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortHeader label="Number" k="number" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortHeader label="Expiry" k="expiry" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortHeader label="Uploaded" k="uploaded" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortHeader label="Status" k="status" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <th className="text-right px-5 py-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {pagedItems.map(({ doc, row: r }) => {
                const isBusy = busy === doc.key;
                const exp = expiryState(r?.expiry_date ?? null, prefs.expiry_window_days);
                return (
                  <tr key={doc.key} className={cn("border-t hover:bg-muted/20 transition-colors",
                    exp === "expired" && "bg-status-danger/60 dark:bg-status-danger/10",
                    exp === "soon" && "bg-status-warning/60 dark:bg-status-warning/10")}>
                    {canReview && (
                      <td className="px-3 py-3">
                        {r ? (
                          <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleOne(r.id)} />
                        ) : null}
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="font-medium">{doc.label}</span>
                        {doc.hasExpiry && (
                          <span className="ml-1 inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-primary/10 text-primary">
                            Has Expiry
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {r ? (r.document_number ?? "—") : <span className="italic">Not uploaded</span>}
                    </td>
                    <td className="px-4 py-3">
                      {r ? (
                        <span className={cn("inline-flex items-center gap-1",
                          exp === "expired" && "text-status-danger font-semibold",
                          exp === "soon" && "text-status-warning font-semibold",
                          (exp === "ok" || exp === "none") && "text-muted-foreground")}>
                          {(exp === "expired" || exp === "soon") && <AlertTriangle className="h-3.5 w-3.5" />}
                          {fmtDate(r.expiry_date)}
                          {exp === "expired" && <span className="text-[10px] uppercase">Expired</span>}
                          {exp === "soon" && <span className="text-[10px] uppercase">Soon</span>}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{r ? fmtDT(r.uploaded_at) : "—"}</td>
                    <td className="px-4 py-3"><StatusPill status={r?.status} /></td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        {r ? (
                          <>
                            <Button size="sm" variant="default" className="h-8 px-2.5" onClick={() => openPreview(r)} title="Preview">
                              <Eye className="h-4 w-4" />
                            </Button>
                            {canDownload && (
                              <AppButton analytics="corporate_kyb_document_download" action="submit" size="sm" variant="outline" className="h-8 px-2.5" onClick={() => onDownload(r)} aria-label={`Download document ${r.doc_type}`} title={`Download document ${r.doc_type}`}>
                                <Download className="h-4 w-4" />
                              </AppButton>
                            )}
                            {canReview && r.status !== "approved" && (
                              <Button size="sm" variant="outline" className="h-8 px-2.5 border-status-success/30 text-status-success hover:bg-status-success/10"
                                      onClick={() => { setReview({ row: r, decision: "approved" }); setReviewReason(""); }} title="Approve">
                                <ShieldCheck className="h-4 w-4" />
                              </Button>
                            )}
                            {canReview && r.status !== "rejected" && (
                              <Button size="sm" variant="outline" className="h-8 px-2.5 border-status-danger/30 text-status-danger hover:bg-status-danger/10"
                                      onClick={() => { setReview({ row: r, decision: "rejected" }); setReviewReason(""); }} title="Reject">
                                <XCircle className="h-4 w-4" />
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" className="h-8 px-2.5" onClick={() => openHistory(r)} title="Version history">
                              <RotateCcw className="h-4 w-4" />
                            </Button>
                            <Button size="sm" variant="ghost" className="h-8 px-2.5" onClick={() => openAudit(r)} title="Audit timeline">
                              <History className="h-4 w-4" />
                            </Button>
                            <Button size="sm" variant="destructive" className="h-8 px-2.5" onClick={() => onDelete(r)}
                                    disabled={isBusy} title="Delete">
                              {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                            </Button>
                          </>
                        ) : (
                          <Button size="sm" className="h-8 gap-1.5" onClick={() => startUpload(doc.key)} disabled={isBusy}>
                            {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}Upload
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!loading && items.length === 0 && (
                <tr><td colSpan={canReview ? 7 : 6} className="px-5 py-8 text-center text-muted-foreground text-sm">
                  No documents match the current filters.
                </td></tr>
              )}
              {loading && rows.length === 0 && (
                <tr><td colSpan={canReview ? 7 : 6} className="px-5 py-6 text-center text-muted-foreground text-sm">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" />Loading documents…
                </td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-5 py-3 border-t bg-muted/10 text-xs">
          <div className="flex items-center gap-3 text-muted-foreground">
            <span>
              {totalItems === 0 ? "0" : `${(safePage - 1) * pageSize + 1}–${Math.min(safePage * pageSize, totalItems)}`} of {totalItems}
            </span>
            <label className="flex items-center gap-1">Rows per page
              <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}
                      className="h-7 rounded-md border bg-background px-1.5">
                {[5, 10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          </div>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" className="h-7 px-2"
                    onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage <= 1}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="px-2">Page {safePage} / {totalPages}</span>
            <Button size="sm" variant="outline" className="h-7 px-2"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="px-5 py-3 border-t bg-muted/20 text-xs text-muted-foreground">
          Files stored securely. Downloads restricted to corporate admins. Reviews recorded with reviewer identity, reason and timestamp.
          Accepted formats: PDF, PNG, JPG, DOC/DOCX (max 15 MB).
        </div>
      </div>


      {/* Preview */}
      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="truncate">{preview?.row.original_name}</DialogTitle>
            <DialogDescription>Secure in-app preview. Link expires in 5 minutes.</DialogDescription>
          </DialogHeader>
          {preview && (
            <div className="w-full h-[70vh] bg-muted rounded overflow-hidden">
              {preview.row.mime.startsWith("image/") ? (
                <img
                  src={preview.url}
                  alt={`Scanned copy of the ${String(preview.row.doc_type ?? "company document").split("_").join(" ")} uploaded for this organisation`}
                  className="w-full h-full object-contain"
                />
              ) : preview.row.mime === "application/pdf" ? (
                <iframe src={preview.url} title="preview" className="w-full h-full" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-sm text-muted-foreground p-6 text-center">
                  In-app preview not available for {preview.row.mime || "this file type"}.
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            {preview && canDownload && (
              <Button data-analytics="documents.download" variant="outline" onClick={() => onDownload(preview.row)} className="gap-2"><Download className="h-4 w-4" />Download</Button>
            )}
            <Button onClick={() => setPreview(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Review */}
      <Dialog open={!!review} onOpenChange={(o) => { if (!o) { setReview(null); setReviewReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{review?.decision === "approved" ? "Approve document" : "Reject document"}</DialogTitle>
            <DialogDescription>
              {review && LABELS[review.row.doc_type]} — {review?.row.original_name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium">
              Reason {review?.decision === "rejected" && <span className="text-status-danger">*</span>}
            </label>
            <Textarea value={reviewReason} onChange={(e) => setReviewReason(e.target.value)}
                      placeholder={review?.decision === "approved" ? "Optional note" : "Explain rejection"} rows={4} />
            <p className="text-xs text-muted-foreground">Your identity and timestamp are recorded in the audit log.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setReview(null); setReviewReason(""); }}>Cancel</Button>
            <Button onClick={submitReview}
                    className={review?.decision === "approved" ? "bg-status-success hover:bg-status-success" : "bg-status-danger hover:bg-status-danger"}>
              {review?.decision === "approved" ? "Approve" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk */}
      <Dialog open={!!bulk} onOpenChange={(o) => { if (!o) { setBulk(null); setBulkValidation(null); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {bulk?.decision === "approved" ? "Bulk approve" : "Bulk reject"} — {selected.size} document{selected.size === 1 ? "" : "s"}
            </DialogTitle>
            <DialogDescription>
              Review the summary below. Each change is recorded individually in the audit log with your identity and timestamp.
            </DialogDescription>
          </DialogHeader>

          {bulkValidation && (
            <div className="space-y-3 max-h-64 overflow-y-auto">
              {bulkValidation.ok.length > 0 && (
                <div className="rounded-md border border-status-success/30 bg-status-success/10 dark:bg-status-success/20 p-3">
                  <div className="text-xs font-semibold text-status-success dark:text-status-success mb-1.5 flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {bulkValidation.ok.length} will be {bulk?.decision}
                  </div>
                  <ul className="text-xs text-status-success dark:text-status-success space-y-0.5">
                    {bulkValidation.ok.map((x) => <li key={x.id}>• {x.label}</li>)}
                  </ul>
                </div>
              )}
              {bulkValidation.conflicts.length > 0 && (
                <div className="rounded-md border border-status-warning/30 bg-status-warning/10 dark:bg-status-warning/20 p-3">
                  <div className="text-xs font-semibold text-status-warning dark:text-status-warning mb-1.5 flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {bulkValidation.conflicts.length} will be skipped
                  </div>
                  <ul className="text-xs text-status-warning dark:text-status-warning space-y-0.5">
                    {bulkValidation.conflicts.map((x) => (
                      <li key={x.id}>• <span className="font-medium">{x.label}</span> — {x.reason}</li>
                    ))}
                  </ul>
                </div>
              )}
              {bulkValidation.ok.length === 0 && (
                <div className="text-sm text-muted-foreground">No documents are eligible for this action.</div>
              )}
            </div>
          )}

          <Textarea value={bulk?.reason ?? ""} onChange={(e) => setBulk(b => b ? { ...b, reason: e.target.value } : b)}
                    placeholder={bulk?.decision === "approved" ? "Optional bulk note" : "Reason for rejection (required)"} rows={3} />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setBulk(null); setBulkValidation(null); }}>Cancel</Button>
            <Button onClick={submitBulk}
                    disabled={busy === "__bulk__" || !bulkValidation || bulkValidation.ok.length === 0}
                    className={bulk?.decision === "approved" ? "bg-status-success hover:bg-status-success" : "bg-status-danger hover:bg-status-danger"}>
              {busy === "__bulk__" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Confirm {bulk?.decision} ({bulkValidation?.ok.length ?? 0})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Notification preferences */}
      <Dialog open={prefsOpen} onOpenChange={setPrefsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Alert preferences</DialogTitle>
            <DialogDescription>Choose how you're notified about document expiry and set your early-warning window.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">In-app notifications</div>
                <div className="text-xs text-muted-foreground">Banner alerts inside this dashboard, live.</div>
              </div>
              <Switch checked={prefs.in_app} onCheckedChange={(v) => setPrefs(p => ({ ...p, in_app: v }))} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium flex items-center gap-1.5">
                  Email alerts
                  {!emailVerified && <MailWarning className="h-3.5 w-3.5 text-status-warning" aria-label="Email not verified" />}
                </div>
                <div className="text-xs text-muted-foreground">
                  {emailVerified
                    ? `Sent to ${user?.email ?? "your work email"}.`
                    : "Verify your email address to enable email alerts."}
                </div>
              </div>
              <Switch
                checked={prefs.email && emailVerified}
                disabled={!emailVerified}
                onCheckedChange={(v) => setPrefs(p => ({ ...p, email: v }))}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Warn me this many days before expiry</label>
              <Input type="number" min={1} max={365} value={prefs.expiry_window_days}
                     onChange={(e) => setPrefs(p => ({ ...p, expiry_window_days: Math.max(1, Math.min(365, Number(e.target.value) || 30)) }))}
                     className="mt-1 w-28" />
              <p className="text-xs text-muted-foreground mt-1">Documents expiring within this window are highlighted and trigger alerts.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPrefsOpen(false)}>Cancel</Button>
            <Button disabled={prefsSaving} onClick={async () => { await savePrefs(prefs); setPrefsOpen(false); }}>
              {prefsSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}Save preferences
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Export audit log filters */}
      <Dialog open={!!exportOpen} onOpenChange={(o) => { if (!o) setExportOpen(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Export audit log — {exportOpen?.toUpperCase()}</DialogTitle>
            <DialogDescription>
              Filter events before exporting. Leave blank to include everything for {selected.size > 0 ? `${selected.size} selected document(s)` : "all documents"}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium">From date</label>
                <Input type="date" value={exportFilters.fromDate}
                       onChange={(e) => setExportFilters(f => ({ ...f, fromDate: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs font-medium">To date</label>
                <Input type="date" value={exportFilters.toDate}
                       onChange={(e) => setExportFilters(f => ({ ...f, toDate: e.target.value }))} />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium">Document types</label>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {DOC_CATALOG.map((d) => {
                  const on = exportFilters.docTypes.includes(d.key);
                  return (
                    <button key={d.key} type="button"
                            onClick={() => setExportFilters(f => ({
                              ...f, docTypes: on ? f.docTypes.filter(x => x !== d.key) : [...f.docTypes, d.key],
                            }))}
                            className={cn("px-2 py-1 text-xs rounded border",
                              on ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted")}>
                      {d.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <label className="text-xs font-medium">Actions / status transitions</label>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {["upload","replace","approve","reject","delete","view","download","restore_version","export_audit_log"].map((a) => {
                  const on = exportFilters.actions.includes(a);
                  return (
                    <button key={a} type="button"
                            onClick={() => setExportFilters(f => ({
                              ...f, actions: on ? f.actions.filter(x => x !== a) : [...f.actions, a],
                            }))}
                            className={cn("px-2 py-1 text-xs rounded border capitalize",
                              on ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted")}>
                      {a.replace(/_/g, " ")}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Export summary — applied filters + expected/actual counts */}
            <ExportSummary
              filters={exportFilters}
              selectedCount={selected.size}
              totalCount={rows.length}
              preview={exportPreview}
              lastExportActual={lastExportActual}
              onRefresh={previewExportCount}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExportOpen(null)}>Cancel</Button>
            <Button data-analytics="documents.export" disabled={busy === "__export__"}
                    onClick={async () => { const fmt = exportOpen!; setExportOpen(null); await runExportAudit(fmt, exportFilters); }}>
              {busy === "__export__" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <FileDown className="h-4 w-4 mr-2" />}
              Export {exportOpen?.toUpperCase()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>



      {/* Audit timeline */}
      <Dialog open={!!auditRow} onOpenChange={(o) => !o && setAuditRow(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Audit timeline</DialogTitle>
            <DialogDescription>
              {auditRow && LABELS[auditRow.doc_type]} — {auditRow?.original_name}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto">
            {auditLoading && <div className="text-sm text-muted-foreground py-6 text-center"><Loader2 className="h-4 w-4 animate-spin inline mr-2" />Loading…</div>}
            {!auditLoading && auditEntries.length === 0 && (
              <div className="text-sm text-muted-foreground py-6 text-center">No audit entries yet.</div>
            )}
            {!auditLoading && auditEntries.length > 0 && (
              <ol className="relative border-l pl-4 space-y-4">
                {auditEntries.map(e => (
                  <li key={e.id} className="relative">
                    <span className={cn("absolute -left-[9px] top-1.5 h-3 w-3 rounded-full border-2 border-background",
                      e.action.includes("approve") ? "bg-status-success"
                      : e.action.includes("reject") ? "bg-status-danger"
                      : e.action.includes("delete") ? "bg-status-danger"
                      : e.action.includes("upload") || e.action.includes("replace") ? "bg-primary"
                      : e.action.includes("restore") ? "bg-status-warning"
                      : "bg-muted-foreground")} />
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-sm capitalize">{e.action.replace(/_/g, " ")}</span>
                      <span className="text-xs text-muted-foreground">{fmtDT(e.created_at)}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Actor: {e.actor_role ?? "—"} · {e.actor_id ? e.actor_id.slice(0, 8) : "system"}
                      {e.from_status && e.to_status && <> · {e.from_status} → <span className="font-medium">{e.to_status}</span></>}
                    </div>
                    {e.reason && <div className="text-xs mt-1 italic">"{e.reason}"</div>}
                  </li>
                ))}
              </ol>
            )}
          </div>
          <DialogFooter><Button onClick={() => setAuditRow(null)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Version history */}
      <Dialog open={!!historyRow} onOpenChange={(o) => !o && setHistoryRow(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Version history</DialogTitle>
            <DialogDescription>
              {historyRow && LABELS[historyRow.doc_type]} — previous file uploads and status snapshots.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto">
            {versionsLoading && <div className="text-sm text-muted-foreground py-6 text-center"><Loader2 className="h-4 w-4 animate-spin inline mr-2" />Loading…</div>}
            {!versionsLoading && versions.length === 0 && (
              <div className="text-sm text-muted-foreground py-6 text-center">No previous versions.</div>
            )}
            {!versionsLoading && versions.length > 0 && (
              <ul className="divide-y">
                {versions.map(v => (
                  <li key={v.id} className="py-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-semibold">v{v.version_number}</span>
                        <span className="text-xs px-2 py-0.5 rounded bg-muted">{v.reason ?? "snapshot"}</span>
                        <StatusPill status={v.status as Status} />
                      </div>
                      <div className="text-xs text-muted-foreground mt-1 truncate">{v.original_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {fmtDT(v.snapshotted_at)}
                        {v.expiry_date && <> · expiry {fmtDate(v.expiry_date)}</>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button size="sm" variant="outline" className="h-8 px-2.5" onClick={() => previewVersion(v)} title="Open">
                        <Eye className="h-4 w-4" />
                      </Button>
                      {v.status === "approved" && (
                        <Button size="sm" className="h-8 gap-1.5" onClick={() => restoreVersion(v)}
                                disabled={busy === historyRow?.doc_type} title="Restore this version">
                          <RotateCcw className="h-4 w-4" />Restore
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <DialogFooter><Button onClick={() => setHistoryRow(null)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SortHeader({ label, k, sortKey, sortDir, onClick }: {
  label: string; k: SortKey; sortKey: SortKey; sortDir: SortDir; onClick: (k: SortKey) => void;
}) {
  const active = sortKey === k;
  return (
    <th className="text-left px-4 py-3 font-medium">
      <button className={cn("inline-flex items-center gap-1 hover:text-foreground", active && "text-foreground")}
              onClick={() => onClick(k)}>
        {label}<ArrowUpDown className={cn("h-3 w-3", active ? "opacity-100" : "opacity-40")} />
        {active && <span className="text-[10px]">{sortDir === "asc" ? "↑" : "↓"}</span>}
      </button>
    </th>
  );
}

function StatusPill({ status }: { status?: Status }) {
  const s = status ?? "pending";
  if (s === "approved") return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-status-success text-ice">
      <CheckCircle2 className="h-3 w-3" />Approved
    </span>
  );
  if (s === "rejected") return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-status-danger text-ice">
      <XCircle className="h-3 w-3" />Rejected
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-primary/90 text-primary-foreground">
      <Clock className="h-3 w-3" />Pending
    </span>
  );
}

function escapeHtml(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string
  ));
}
