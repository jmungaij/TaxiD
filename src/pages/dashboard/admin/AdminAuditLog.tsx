import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { sanitizeOrFilterTerm } from "@/lib/security/postgrestFilter";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { History, Search, Download, FileText, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { AppButton } from "@/components/nav/AppButton";
import { AnalyticsEvents } from "@/lib/analyticsEvents";
import { logExportAudit } from "@/lib/exportAudit";
import { trackCta } from "@/lib/cta";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { toast } from "sonner";

interface AuditRow {
  id: string;
  actor_id: string | null;
  actor_email: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  reason: string | null;
  ip: string | null;
  created_at: string;
  record_hash?: string | null;
  prev_hash?: string | null;
}

interface LoginRow {
  id: string;
  user_id: string | null;
  email: string | null;
  success: boolean;
  failure_reason: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
  record_hash?: string | null;
}

const PAGE_SIZES = [25, 50, 100, 250] as const;

function presetRange(p: string): { from: string; to: string } | null {
  const today = new Date(); const d = (dt: Date) => dt.toISOString().slice(0, 10);
  if (p === "today") return { from: d(today), to: d(today) };
  if (p === "yesterday") { const y = new Date(today); y.setDate(y.getDate() - 1); return { from: d(y), to: d(y) }; }
  if (p === "7d") { const x = new Date(today); x.setDate(x.getDate() - 7); return { from: d(x), to: d(today) }; }
  if (p === "30d") { const x = new Date(today); x.setDate(x.getDate() - 30); return { from: d(x), to: d(today) }; }
  return null;
}

export default function AdminAuditLog() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [count, setCount] = useState(0);
  const [logins, setLogins] = useState<LoginRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [preset, setPreset] = useState("7d");
  const init = presetRange("7d")!;
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(50);
  const [exporting, setExporting] = useState(false);

  const buildAudit = useCallback(() => {
    let qy = supabase.from("admin_audit_log").select("*", { count: "exact" });
    if (from) qy = qy.gte("created_at", new Date(from).toISOString());
    if (to) qy = qy.lte("created_at", new Date(to + "T23:59:59").toISOString());
    if (q.trim()) {
      const s = sanitizeOrFilterTerm(q);
      qy = qy.or(`action.ilike.%${s}%,actor_email.ilike.%${s}%,resource_type.ilike.%${s}%,resource_id.ilike.%${s}%,reason.ilike.%${s}%`);
    }
    return qy.order("created_at", { ascending: false });
  }, [q, from, to]);

  useEffect(() => {
    setLoading(true);
    (async () => {
      const fromIdx = page * pageSize;
      const toIdx = fromIdx + pageSize - 1;
      const [{ data: a, count: c }, { data: l }] = await Promise.all([
        buildAudit().range(fromIdx, toIdx),
        (supabase as any).from("admin_login_events").select("*")
          .order("created_at", { ascending: false }).limit(500),
      ]);
      setRows((a ?? []) as AuditRow[]);
      setCount(c ?? 0);
      setLogins((l ?? []) as LoginRow[]);
      setLoading(false);
    })();
  }, [buildAudit, page, pageSize]);

  function applyPreset(p: string) {
    setPreset(p); setPage(0);
    if (p === "custom") return;
    const r = presetRange(p);
    if (r) { setFrom(r.from); setTo(r.to); }
  }

  async function exportCsv() {
    setExporting(true);
    try {
      const chunkSize = 1000;
      const all: AuditRow[] = [];
      let offset = 0;
      while (true) {
        const { data, error } = await buildAudit().range(offset, offset + chunkSize - 1);
        if (error) throw error;
        const batch = (data ?? []) as AuditRow[];
        all.push(...batch);
        if (batch.length < chunkSize) break;
        offset += chunkSize;
        if (all.length >= 200_000) break;
      }
      const header = [
        "reference_no","timestamp","event_type","actor_email","actor_role","action",
        "resource_type","resource_id","status","reason","ip_address","record_hash",
      ];
      const lines = all.map(r => {
        const cells = [
          r.id, new Date(r.created_at).toISOString(), "admin_action",
          r.actor_email ?? "", "admin", r.action,
          r.resource_type ?? "", r.resource_id ?? "", "success",
          (r.reason ?? "").replace(/[\r\n]+/g, " "),
          r.ip ?? "", r.record_hash ?? "",
        ];
        return cells.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",");
      });
      const csv = [header.join(","), ...lines].join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `yalla-admin-audit-${from}-to-${to}.csv`; a.click();
      URL.revokeObjectURL(url);

      void trackCta({
        buttonName: AnalyticsEvents.AUDIT_CSV_EXPORTED,
        actionType: "submit",
        target: "admin.audit_log",
        metadata: { rows_exported: all.length, scope: "admin" },
      });
      void logExportAudit({
        dataset: "admin.audit_log", exportType: "csv",
        rowCount: all.length, byteSize: blob.size,
        filters: { from, to, search: q },
      });
      toast.success(`Exported ${all.length.toLocaleString()} rows`);
    } catch (e) {
      toast.error(e?.message ?? "Export failed");
    } finally {
      setExporting(false);
    }
  }

  async function exportPdf() {
    const fromDate = new Date(from + "T00:00:00Z");
    const toDate = new Date(to + "T23:59:59Z");
    const inRange = <T extends { created_at: string }>(r: T) => {
      const t = new Date(r.created_at).getTime();
      return t >= fromDate.getTime() && t <= toDate.getTime();
    };
    const login = logins.filter(inRange);

    const doc = new jsPDF();
    doc.setFontSize(16); doc.text("SAFARID Admin Audit Report", 14, 18);
    doc.setFontSize(10);
    doc.text(`Range: ${from} → ${to}`, 14, 26);
    doc.text(`Generated: ${new Date().toISOString()}`, 14, 32);
    doc.setFontSize(12); doc.text(`Audit Events (${rows.length} shown)`, 14, 44);
    autoTable(doc, {
      startY: 48,
      head: [["When", "Actor", "Action", "Resource", "Hash"]],
      body: rows.map((r) => [
        new Date(r.created_at).toLocaleString(),
        r.actor_email ?? r.actor_id?.slice(0, 8) ?? "—",
        r.action,
        r.resource_type ? `${r.resource_type}${r.resource_id ? `·${r.resource_id.slice(0,8)}` : ""}` : "—",
        (r.record_hash ?? "").slice(0, 16),
      ]),
      styles: { fontSize: 7 },
    });
    const afterAudit = (doc as any).lastAutoTable?.finalY ?? 60;
    doc.setFontSize(12); doc.text(`Login Events (${login.length})`, 14, afterAudit + 10);
    autoTable(doc, {
      startY: afterAudit + 14,
      head: [["When", "Email", "Result", "IP", "Hash"]],
      body: login.map((r) => [
        new Date(r.created_at).toLocaleString(),
        r.email ?? "—",
        r.success ? "OK" : `FAIL: ${r.failure_reason ?? ""}`,
        r.ip_address ?? "—",
        (r.record_hash ?? "").slice(0, 16),
      ]),
      styles: { fontSize: 7 },
    });
    const blob = doc.output("blob") as Blob;
    doc.save(`yalla-audit-${from}-to-${to}.pdf`);
    void logExportAudit({
      dataset: "admin.audit_log", exportType: "pdf",
      rowCount: rows.length + login.length, byteSize: blob.size,
      filters: { from, to },
    });
    toast.success("Audit PDF generated");
  }

  const pages = Math.max(1, Math.ceil(count / pageSize));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <History className="h-6 w-6 text-primary" /> Admin Audit Log
        </h1>
        <p className="text-sm text-muted-foreground">
          Hash-chained record of every admin action — login, role changes, document approvals, policy overrides.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input value={q} onChange={(e) => { setPage(0); setQ(e.target.value); }}
                placeholder="Search action, actor, resource, reason…" className="pl-8" />
            </div>
            <div>
              <Label className="text-xs">Range</Label>
              <select value={preset} onChange={(e) => applyPreset(e.target.value)}
                      className="block w-36 px-3 py-2 text-sm rounded-md border bg-background">
                <option value="today">Today</option>
                <option value="yesterday">Yesterday</option>
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            <div>
              <Label className="text-xs">From</Label>
              <Input type="date" value={from} onChange={(e) => { setPreset("custom"); setPage(0); setFrom(e.target.value); }} />
            </div>
            <div>
              <Label className="text-xs">To</Label>
              <Input type="date" value={to} onChange={(e) => { setPreset("custom"); setPage(0); setTo(e.target.value); }} />
            </div>
            <AppButton analytics={AnalyticsEvents.AUDIT_CSV_EXPORTED} action="submit"
              aria-label="Export admin audit log to CSV" onClick={exportCsv} disabled={exporting}
              trackingMeta={{ dataset: "admin.audit_log", export_type: "csv" }}>
              {exporting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
              Export CSV
            </AppButton>
            <AppButton analytics={AnalyticsEvents.ADMIN_EXPORT_DOWNLOAD} action="submit"
              aria-label="Export admin audit log to PDF" onClick={exportPdf}
              trackingMeta={{ dataset: "admin.audit_log", export_type: "pdf" }}>
              <FileText className="h-4 w-4 mr-1" /> PDF
            </AppButton>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Resource</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>IP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>
                )}
                {!loading && rows.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No audit events.</TableCell></TableRow>
                )}
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs">{new Date(r.created_at).toLocaleString()}</TableCell>
                    <TableCell className="text-xs">{r.actor_email ?? r.actor_id?.slice(0, 8) ?? "—"}</TableCell>
                    <TableCell><Badge variant="outline">{r.action}</Badge></TableCell>
                    <TableCell className="text-xs">
                      {r.resource_type ? `${r.resource_type}${r.resource_id ? ` · ${r.resource_id.slice(0, 12)}` : ""}` : "—"}
                    </TableCell>
                    <TableCell className="text-xs">{r.reason ?? "—"}</TableCell>
                    <TableCell className="text-xs">{r.ip ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
            <div>{count.toLocaleString()} entries · page {page + 1} of {pages}</div>
            <div className="flex items-center gap-2">
              <label>Rows:&nbsp;
                <select value={pageSize} onChange={(e) => { setPage(0); setPageSize(Number(e.target.value)); }}
                        className="px-2 py-1 rounded border bg-background">
                  {PAGE_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <button disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}
                      className="p-1 rounded border hover:bg-muted disabled:opacity-40">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button disabled={page + 1 >= pages} onClick={() => setPage(p => p + 1)}
                      className="p-1 rounded border hover:bg-muted disabled:opacity-40">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
