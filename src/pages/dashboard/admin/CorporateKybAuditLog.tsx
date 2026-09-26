// Corporate KYB audit log — records every notification acknowledgement,
// manual rescan, throttle, and background retry attempt.
//
// Filters:   global search (correlation_id / notification_id / actor),
//            action, document/notification/draft IDs, date range with
//            Last 24h / 7d / 30d / Custom presets. All time boundaries
//            are converted to UTC ISO strings before querying — matching
//            corporate_kyb_audit_log.created_at (TIMESTAMPTZ, stored UTC).
// Sorting:   any column, asc/desc. Created_at sorts server-side; other
//            columns sort the current page in-memory.
// Paging:    server-side count + range so large date ranges stay usable.
// CSV:       chunked async export with progress and Ready/Downloading state;
//            includes error_code, error_message, correlation_id.
// Drawer:    keyboard-navigable (Esc closes, focus trap, ARIA labels) with
//            per-attempt retry history.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import {
  History, Download, Search, Loader2, RefreshCw, ArrowUp, ArrowDown,
  ChevronLeft, ChevronRight, X, CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { downloadCsv, toCsv } from "@/lib/csv";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

type ActionType =
  | "notification_ack"
  | "notification_ack_failed"
  | "notification_ack_retry"
  | "rescan_manual"
  | "rescan_throttled"
  | "rescan_scheduled";

interface Row {
  id: string;
  action: string;
  actor_kind: string;
  actor_id: string | null;
  actor_session_key: string | null;
  draft_id: string | null;
  document_id: string | null;
  notification_id: string | null;
  outcome: string;
  detail: Record<string, unknown>;
  created_at: string;
}

const ACTIONS: { value: ActionType | ""; label: string }[] = [
  { value: "", label: "All actions" },
  { value: "notification_ack", label: "notification_ack" },
  { value: "notification_ack_failed", label: "notification_ack_failed" },
  { value: "notification_ack_retry", label: "notification_ack_retry" },
  { value: "rescan_manual", label: "rescan_manual" },
  { value: "rescan_throttled", label: "rescan_throttled" },
  { value: "rescan_scheduled", label: "rescan_scheduled" },
];

type SortKey = "created_at" | "action" | "outcome" | "actor_kind";
const PAGE_SIZES = [25, 50, 100, 250] as const;

type Preset = "24h" | "7d" | "30d" | "custom";

// The DB stores created_at as TIMESTAMPTZ (UTC). The UI always renders in
// the admin's local timezone but every filter boundary sent to PostgREST is
// converted to a UTC ISO string so range queries are unambiguous regardless
// of the admin's browser locale.
function utcIso(d: Date): string { return d.toISOString(); }
function nowUtc(): Date { return new Date(); }
function presetBoundsUtc(p: Preset, customFrom?: string, customTo?: string): { fromIso: string; toIso: string } {
  const now = nowUtc();
  if (p === "24h") return { fromIso: utcIso(new Date(now.getTime() - 24 * 3600_000)), toIso: utcIso(now) };
  if (p === "7d")  return { fromIso: utcIso(new Date(now.getTime() - 7  * 86400_000)), toIso: utcIso(now) };
  if (p === "30d") return { fromIso: utcIso(new Date(now.getTime() - 30 * 86400_000)), toIso: utcIso(now) };
  // Custom: use the admin's local calendar dates but pin to UTC midnight/
  // end-of-day. The date input yields YYYY-MM-DD strings.
  const from = customFrom ? new Date(customFrom + "T00:00:00Z") : new Date(now.getTime() - 7 * 86400_000);
  const to   = customTo   ? new Date(customTo   + "T23:59:59Z") : now;
  return { fromIso: utcIso(from), toIso: utcIso(to) };
}
function localDateForInput(iso: string): string { return iso.slice(0, 10); }
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function extractError(detail: Record<string, unknown> | null | undefined): {
  code: string; message: string; correlation_id: string;
} {
  const d = (detail ?? {}) as Record<string, unknown>;
  const raw = d.error;
  let code = "", message = "";
  if (typeof raw === "string") { message = raw; code = raw.split(":")[0]?.trim() ?? ""; }
  else if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    code = String(o.code ?? o.name ?? "");
    message = String(o.message ?? o.msg ?? JSON.stringify(o));
  }
  if (!code && typeof d.error_code === "string") code = d.error_code;
  if (!message && typeof d.error_message === "string") message = d.error_message;
  const correlation_id = String(d.correlation_id ?? d.request_id ?? d.trace_id ?? "");
  return { code, message, correlation_id };
}

export default function CorporateKybAuditLog() {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const [globalSearch, setGlobalSearch] = useState("");
  const debouncedSearch = useDebouncedValue(globalSearch, 300);

  const [action, setAction] = useState<ActionType | "">("");
  const [docId, setDocId] = useState("");
  const [notifId, setNotifId] = useState("");
  const [draftId, setDraftId] = useState("");

  const [preset, setPreset] = useState<Preset>("7d");
  const initial = presetBoundsUtc("7d");
  const [from, setFrom] = useState(localDateForInput(initial.fromIso));
  const [to, setTo] = useState(localDateForInput(initial.toIso));

  const [sortKey, setSortKey] = useState<SortKey>("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(50);

  const [drawer, setDrawer] = useState<Row | null>(null);
  const [drawerAttempts, setDrawerAttempts] = useState<Row[]>([]);
  const [drawerLoading, setDrawerLoading] = useState(false);

  // Async export state
  const [exportState, setExportState] = useState<"idle" | "running" | "ready">("idle");
  const [exportDone, setExportDone] = useState(0);
  const [exportTotal, setExportTotal] = useState(0);
  const exportCancelled = useRef(false);

  function applyFilters(fn: () => void) { setPage(0); fn(); }

  function applyBounds() {
    const { fromIso, toIso } = presetBoundsUtc(preset, from, to);
    return { fromIso, toIso };
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const fromIdx = page * pageSize;
      const toIdx = fromIdx + pageSize - 1;
      const { fromIso, toIso } = applyBounds();
      let q = (supabase as any)
        .from("corporate_kyb_audit_log")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: sortKey === "created_at" ? sortDir === "asc" : false })
        .range(fromIdx, toIdx)
        .gte("created_at", fromIso)
        .lte("created_at", toIso);
      if (action) q = q.eq("action", action);
      if (docId.trim()) q = q.eq("document_id", docId.trim());
      if (notifId.trim()) q = q.eq("notification_id", notifId.trim());
      if (draftId.trim()) q = q.eq("draft_id", draftId.trim());

      const s = debouncedSearch.trim();
      if (s) {
        // Build a PostgREST `or` predicate. UUID-shaped queries hit indexed
        // uuid columns; free-text queries hit actor_session_key (ilike) and
        // the correlation_id embedded in the detail JSONB (also ilike).
        // JSON path uses `->>` — PostgREST syntax is detail->>correlation_id.
        const isUuid = UUID_RE.test(s);
        const escaped = s.replace(/[,()]/g, "");
        const clauses: string[] = [];
        if (isUuid) {
          clauses.push(`notification_id.eq.${s}`, `document_id.eq.${s}`, `draft_id.eq.${s}`, `actor_id.eq.${s}`);
        }
        clauses.push(
          `actor_session_key.ilike.%${escaped}%`,
          `detail->>correlation_id.ilike.%${escaped}%`,
          `detail->>request_id.ilike.%${escaped}%`,
          `detail->>trace_id.ilike.%${escaped}%`,
        );
        q = q.or(clauses.join(","));
      }

      const { data, error, count } = await q;
      if (error) throw error;
      setRows((data ?? []) as Row[]);
      setTotal(count ?? 0);
    } catch (e) {
      toast.error((e as Error).message || "Failed to load audit log");
    } finally { setLoading(false); }
  }, [action, docId, notifId, draftId, from, to, preset, page, pageSize, sortKey, sortDir, debouncedSearch]);

  useEffect(() => { void load(); }, [load]);

  const sortedRows = useMemo(() => {
    if (sortKey === "created_at") return rows;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = String((a as any)[sortKey] ?? "");
      const bv = String((b as any)[sortKey] ?? "");
      return av.localeCompare(bv) * dir;
    });
  }, [rows, sortKey, sortDir]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(k === "created_at" ? "desc" : "asc"); }
  }

  function choosePreset(p: Preset) {
    setPreset(p);
    setPage(0);
    if (p !== "custom") {
      const { fromIso, toIso } = presetBoundsUtc(p);
      setFrom(localDateForInput(fromIso));
      setTo(localDateForInput(toIso));
    }
  }

  async function exportCsv() {
    setExportState("running");
    setExportDone(0);
    setExportTotal(total);
    exportCancelled.current = false;
    // Yield so the progress dialog paints before we start hammering PostgREST.
    await new Promise((r) => setTimeout(r, 0));
    try {
      const chunk = 1000;
      const { fromIso, toIso } = applyBounds();
      let offset = 0;
      const all: Row[] = [];
      while (!exportCancelled.current) {
        let q = (supabase as any)
          .from("corporate_kyb_audit_log")
          .select("*")
          .order("created_at", { ascending: false })
          .range(offset, offset + chunk - 1)
          .gte("created_at", fromIso)
          .lte("created_at", toIso);
        if (action) q = q.eq("action", action);
        if (docId.trim()) q = q.eq("document_id", docId.trim());
        if (notifId.trim()) q = q.eq("notification_id", notifId.trim());
        if (draftId.trim()) q = q.eq("draft_id", draftId.trim());
        const s = debouncedSearch.trim();
        if (s) {
          const isUuid = UUID_RE.test(s);
          const escaped = s.replace(/[,()]/g, "");
          const clauses: string[] = [];
          if (isUuid) clauses.push(`notification_id.eq.${s}`, `document_id.eq.${s}`, `draft_id.eq.${s}`, `actor_id.eq.${s}`);
          clauses.push(
            `actor_session_key.ilike.%${escaped}%`,
            `detail->>correlation_id.ilike.%${escaped}%`,
            `detail->>request_id.ilike.%${escaped}%`,
            `detail->>trace_id.ilike.%${escaped}%`,
          );
          q = q.or(clauses.join(","));
        }

        const { data, error } = await q;
        if (error) throw error;
        const batch = (data ?? []) as Row[];
        all.push(...batch);
        setExportDone(all.length);
        // Yield each chunk so the progress bar can repaint.
        await new Promise((r) => setTimeout(r, 0));
        if (batch.length < chunk) break;
        offset += chunk;
        if (all.length >= 250_000) break;
      }
      if (exportCancelled.current) {
        setExportState("idle");
        toast.message("Export cancelled");
        return;
      }
      const flat = all.map((r) => {
        const err = extractError(r.detail);
        const d = (r.detail ?? {}) as Record<string, unknown>;
        return {
          id: r.id,
          created_at: r.created_at,
          action: r.action,
          outcome: r.outcome,
          actor_kind: r.actor_kind,
          actor_id: r.actor_id ?? "",
          actor_session_key: r.actor_session_key ?? "",
          draft_id: r.draft_id ?? "",
          document_id: r.document_id ?? "",
          notification_id: r.notification_id ?? "",
          attempts: (d.attempts as number | undefined) ?? "",
          next_retry_at: (d.next_retry_at as string | undefined) ?? "",
          triggered_by: (d.triggered_by as string | undefined) ?? "",
          error_code: err.code,
          error_message: err.message,
          correlation_id: err.correlation_id,
          detail_json: JSON.stringify(r.detail ?? {}),
        };
      });
      const csv = toCsv(flat);
      downloadCsv(`corporate-kyb-audit-${from}_to_${to}.csv`, csv);
      setExportState("ready");
      toast.success(`Exported ${flat.length.toLocaleString()} rows`);
    } catch (e) {
      setExportState("idle");
      toast.error((e as Error).message || "Export failed");
    }
  }

  async function openDrawer(r: Row) {
    setDrawer(r);
    setDrawerAttempts([]);
    if (!r.notification_id) return;
    setDrawerLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from("corporate_kyb_audit_log")
        .select("*")
        .eq("notification_id", r.notification_id)
        .in("action", ["notification_ack", "notification_ack_failed", "notification_ack_retry"])
        .order("created_at", { ascending: true })
        .limit(200);
      if (error) throw error;
      setDrawerAttempts((data ?? []) as Row[]);
    } catch (e) {
      toast.error((e as Error).message || "Failed to load attempt history");
    } finally { setDrawerLoading(false); }
  }

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const SortIcon = ({ k }: { k: SortKey }) =>
    sortKey !== k ? null : sortDir === "asc"
      ? <ArrowUp className="inline h-3 w-3 ml-1" aria-hidden="true" />
      : <ArrowDown className="inline h-3 w-3 ml-1" aria-hidden="true" />;

  const bounds = applyBounds();
  const tzLabel = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <History className="h-6 w-6 text-primary" aria-hidden="true" /> Corporate KYB Audit Log
        </h1>
        <p className="text-sm text-muted-foreground">
          Every notification acknowledgement, retry, and manual rescan for corporate registrations.
          Times shown in <strong>{tzLabel}</strong>; queries run in UTC.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Global search */}
          <div className="mb-4">
            <Label htmlFor="corp-kyb-audit-search" className="text-xs">Global search</Label>
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <Input
                id="corp-kyb-audit-search"
                data-testid="corp-kyb-audit-search"
                aria-label="Search audit log by correlation ID, notification ID or actor"
                value={globalSearch}
                onChange={(e) => applyFilters(() => setGlobalSearch(e.target.value))}
                placeholder="correlation_id, notification_id, actor session…"
                className="pl-8"
              />
            </div>
          </div>

          {/* Date presets */}
          <div className="mb-4" role="group" aria-label="Date range preset">
            <Label className="text-xs">Date range</Label>
            <div className="flex flex-wrap gap-2 mt-1" data-testid="corp-kyb-audit-presets">
              {([
                { k: "24h", label: "Last 24h" },
                { k: "7d",  label: "Last 7d"  },
                { k: "30d", label: "Last 30d" },
                { k: "custom", label: "Custom" },
              ] as { k: Preset; label: string }[]).map((opt) => (
                <Button
                  key={opt.k}
                  size="sm"
                  variant={preset === opt.k ? "default" : "outline"}
                  aria-pressed={preset === opt.k}
                  data-testid={`corp-kyb-audit-preset-${opt.k}`}
                  onClick={() => choosePreset(opt.k)}
                >
                  {opt.label}
                </Button>
              ))}
              <span className="text-xs text-muted-foreground self-center ml-2" data-testid="corp-kyb-audit-utc-window">
                UTC window: {bounds.fromIso} → {bounds.toIso}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
            <div className="md:col-span-2">
              <Label htmlFor="corp-kyb-audit-action" className="text-xs">Action</Label>
              <select
                id="corp-kyb-audit-action"
                data-testid="corp-kyb-audit-action"
                value={action}
                onChange={(e) => applyFilters(() => setAction(e.target.value as ActionType | ""))}
                className="block w-full px-3 py-2 text-sm rounded-md border bg-background"
              >
                {ACTIONS.map((a) => <option key={a.value || "all"} value={a.value}>{a.label}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor="corp-kyb-audit-from" className="text-xs">From (local)</Label>
              <Input id="corp-kyb-audit-from" type="date" value={from}
                     disabled={preset !== "custom"}
                     onChange={(e) => applyFilters(() => { setPreset("custom"); setFrom(e.target.value); })} />
            </div>
            <div>
              <Label htmlFor="corp-kyb-audit-to" className="text-xs">To (local)</Label>
              <Input id="corp-kyb-audit-to" type="date" value={to}
                     disabled={preset !== "custom"}
                     onChange={(e) => applyFilters(() => { setPreset("custom"); setTo(e.target.value); })} />
            </div>
            <div className="md:col-span-2 flex gap-2">
              <Button data-analytics="corporatekybauditlog.apply" onClick={() => void load()} variant="outline" className="flex-1" aria-label="Apply filters">
                {loading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" aria-hidden="true" /> : <Search className="h-4 w-4 mr-1" aria-hidden="true" />}
                Apply
              </Button>
              <Button onClick={() => void load()} variant="ghost" size="icon" aria-label="Refresh audit log">
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>

            <div className="md:col-span-2">
              <Label htmlFor="corp-kyb-audit-doc-id" className="text-xs">Document ID</Label>
              <Input id="corp-kyb-audit-doc-id" data-testid="corp-kyb-audit-doc-id" value={docId}
                     onChange={(e) => applyFilters(() => setDocId(e.target.value))} placeholder="uuid…" />
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="corp-kyb-audit-notif-id" className="text-xs">Notification ID</Label>
              <Input id="corp-kyb-audit-notif-id" data-testid="corp-kyb-audit-notif-id" value={notifId}
                     onChange={(e) => applyFilters(() => setNotifId(e.target.value))} placeholder="uuid…" />
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="corp-kyb-audit-draft-id" className="text-xs">Draft ID</Label>
              <Input id="corp-kyb-audit-draft-id" value={draftId}
                     onChange={(e) => applyFilters(() => setDraftId(e.target.value))} placeholder="uuid…" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-base" data-testid="corp-kyb-audit-count">
            {total.toLocaleString()} entr{total === 1 ? "y" : "ies"}
          </CardTitle>
          <div className="flex items-center gap-2">
            {exportState === "running" && (
              <div className="flex items-center gap-2 text-xs" data-testid="corp-kyb-audit-export-progress">
                <Progress
                  value={exportTotal > 0 ? Math.min(100, (exportDone / Math.max(1, exportTotal)) * 100) : 0}
                  className="w-32 h-2"
                  aria-label={`Exporting ${exportDone} of ${exportTotal}`}
                />
                <span>{exportDone.toLocaleString()} / {exportTotal.toLocaleString()}</span>
                <Button size="sm" variant="ghost" onClick={() => { exportCancelled.current = true; }} data-testid="corp-kyb-audit-export-cancel">
                  Cancel
                </Button>
              </div>
            )}
            {exportState === "ready" && (
              <span className="flex items-center gap-1 text-xs text-primary" data-testid="corp-kyb-audit-export-ready">
                <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> Ready — check downloads
              </span>
            )}
            <Button
              onClick={exportCsv}
              disabled={exportState === "running" || total === 0}
              data-testid="corp-kyb-audit-export"
              aria-label="Export filtered audit log as CSV"
            >
              {exportState === "running"
                ? <Loader2 className="h-4 w-4 mr-1 animate-spin" aria-hidden="true" />
                : <Download className="h-4 w-4 mr-1" aria-hidden="true" />}
              {exportState === "running" ? "Exporting…" : "Export CSV"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <button data-testid="sort-created_at" className="hover:underline"
                            aria-label={`Sort by time ${sortKey === "created_at" && sortDir === "asc" ? "descending" : "ascending"}`}
                            onClick={() => toggleSort("created_at")}>
                      When<SortIcon k="created_at" />
                    </button>
                  </TableHead>
                  <TableHead>
                    <button data-testid="sort-action" className="hover:underline"
                            aria-label="Sort by action" onClick={() => toggleSort("action")}>
                      Action<SortIcon k="action" />
                    </button>
                  </TableHead>
                  <TableHead>
                    <button data-testid="sort-outcome" className="hover:underline"
                            aria-label="Sort by outcome" onClick={() => toggleSort("outcome")}>
                      Outcome<SortIcon k="outcome" />
                    </button>
                  </TableHead>
                  <TableHead>
                    <button data-testid="sort-actor_kind" className="hover:underline"
                            aria-label="Sort by actor" onClick={() => toggleSort("actor_kind")}>
                      Actor<SortIcon k="actor_kind" />
                    </button>
                  </TableHead>
                  <TableHead>Draft / Doc / Notif</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>
                )}
                {!loading && sortedRows.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No audit events match your filters.</TableCell></TableRow>
                )}
                {sortedRows.map((r) => {
                  const err = extractError(r.detail);
                  return (
                    <TableRow
                      key={r.id}
                      data-testid={`corp-kyb-audit-row-${r.id}`}
                      className="cursor-pointer"
                      role="button"
                      tabIndex={0}
                      aria-label={`Open details for ${r.action} at ${new Date(r.created_at).toLocaleString()}`}
                      onClick={() => void openDrawer(r)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); void openDrawer(r); } }}
                    >
                      <TableCell className="text-xs whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</TableCell>
                      <TableCell><Badge variant="outline">{r.action}</Badge></TableCell>
                      <TableCell>
                        <Badge variant={r.outcome === "ok" ? "secondary" : r.outcome === "throttled" ? "outline" : "destructive"}>
                          {r.outcome}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        <div>{r.actor_kind}</div>
                        <div className="text-muted-foreground">{r.actor_id?.slice(0, 8) ?? r.actor_session_key?.slice(0, 12) ?? "—"}</div>
                      </TableCell>
                      <TableCell className="text-xs">
                        {r.draft_id && <div>d·{r.draft_id.slice(0, 8)}</div>}
                        {r.document_id && <div>doc·{r.document_id.slice(0, 8)}</div>}
                        {r.notification_id && <div>n·{r.notification_id.slice(0, 8)}</div>}
                      </TableCell>
                      <TableCell className="text-xs max-w-md truncate" title={JSON.stringify(r.detail)}>
                        {err.message
                          ? <span className="text-destructive">{err.code || "error"}: {err.message}</span>
                          : JSON.stringify(r.detail)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
            <div>{total.toLocaleString()} entries · page {page + 1} of {pages}</div>
            <div className="flex items-center gap-2">
              <label>Rows:&nbsp;
                <select value={pageSize} onChange={(e) => { setPage(0); setPageSize(Number(e.target.value)); }}
                        className="px-2 py-1 rounded border bg-background" data-testid="corp-kyb-audit-page-size"
                        aria-label="Rows per page">
                  {PAGE_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <button data-testid="corp-kyb-audit-prev" disabled={page === 0}
                      onClick={() => setPage(p => Math.max(0, p - 1))}
                      className="p-1 rounded border hover:bg-muted disabled:opacity-40"
                      aria-label="Previous page">
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </button>
              <button data-testid="corp-kyb-audit-next" disabled={page + 1 >= pages}
                      onClick={() => setPage(p => p + 1)}
                      className="p-1 rounded border hover:bg-muted disabled:opacity-40"
                      aria-label="Next page">
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Sheet open={!!drawer} onOpenChange={(o) => { if (!o) { setDrawer(null); setDrawerAttempts([]); } }}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-xl overflow-y-auto"
          data-testid="corp-kyb-audit-drawer"
          aria-labelledby="corp-kyb-audit-drawer-title"
          aria-describedby="corp-kyb-audit-drawer-desc"
          onEscapeKeyDown={() => setDrawer(null)}
        >
          {drawer && (
            <>
              <SheetHeader>
                <SheetTitle id="corp-kyb-audit-drawer-title" className="flex items-center justify-between">
                  <span>Audit entry · {drawer.action}</span>
                  <button className="text-muted-foreground hover:text-foreground rounded p-1 focus:outline-none focus:ring-2 focus:ring-ring"
                          onClick={() => setDrawer(null)}
                          aria-label="Close audit details">
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </SheetTitle>
                <SheetDescription id="corp-kyb-audit-drawer-desc">
                  {new Date(drawer.created_at).toLocaleString()} · outcome {drawer.outcome}
                </SheetDescription>
              </SheetHeader>

              <div className="space-y-4 mt-4">
                <section className="text-xs space-y-1" aria-label="Actor and resource identifiers">
                  <div><span className="text-muted-foreground">Actor:</span> {drawer.actor_kind} {drawer.actor_id?.slice(0, 8) ?? drawer.actor_session_key?.slice(0, 12) ?? ""}</div>
                  {drawer.draft_id        && <div><span className="text-muted-foreground">Draft:</span> {drawer.draft_id}</div>}
                  {drawer.document_id     && <div><span className="text-muted-foreground">Document:</span> {drawer.document_id}</div>}
                  {drawer.notification_id && <div><span className="text-muted-foreground">Notification:</span> {drawer.notification_id}</div>}
                </section>

                {(() => {
                  const e = extractError(drawer.detail);
                  if (!e.code && !e.message && !e.correlation_id) return null;
                  return (
                    <section className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs space-y-1" aria-label="Error details">
                      <div className="font-medium text-destructive">Error</div>
                      {e.code           && <div><span className="text-muted-foreground">Code:</span> {e.code}</div>}
                      {e.message        && <div><span className="text-muted-foreground">Message:</span> {e.message}</div>}
                      {e.correlation_id && <div><span className="text-muted-foreground">Correlation:</span> {e.correlation_id}</div>}
                    </section>
                  );
                })()}

                {drawer.notification_id && (
                  <section aria-label="Retry attempt history">
                    <div className="text-xs font-medium mb-2 flex items-center gap-2">
                      Retry attempts
                      {drawerLoading && <Loader2 className="h-3 w-3 animate-spin" aria-label="Loading attempts" />}
                    </div>
                    {drawerAttempts.length === 0 && !drawerLoading && (
                      <div className="text-xs text-muted-foreground">No related attempts recorded.</div>
                    )}
                    <ol className="space-y-2" data-testid="corp-kyb-audit-drawer-attempts">
                      {drawerAttempts.map((a, i) => {
                        const d = (a.detail ?? {}) as Record<string, unknown>;
                        const err = extractError(a.detail);
                        return (
                          <li key={a.id} className="rounded border p-2 text-xs" data-testid={`corp-kyb-audit-attempt-${i}`}>
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-muted-foreground">#{(d.attempts as number | undefined) ?? i + 1}</span>
                                <Badge variant={a.outcome === "ok" ? "secondary" : "destructive"}>{a.outcome}</Badge>
                                <span className="text-muted-foreground">{a.action}</span>
                              </div>
                              <span className="text-muted-foreground">{new Date(a.created_at).toLocaleString()}</span>
                            </div>
                            {err.message && (
                              <div className="mt-1 text-destructive">
                                {err.code ? `${err.code}: ` : ""}{err.message}
                              </div>
                            )}
                            {typeof d.next_retry_at === "string" && d.next_retry_at && (
                              <div className="mt-1 text-muted-foreground">
                                Next retry at {new Date(d.next_retry_at as string).toLocaleString()}
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ol>
                  </section>
                )}

                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring rounded">
                    Raw detail JSON
                  </summary>
                  <pre className="mt-2 p-2 rounded bg-muted overflow-x-auto">{JSON.stringify(drawer.detail, null, 2)}</pre>
                </details>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
