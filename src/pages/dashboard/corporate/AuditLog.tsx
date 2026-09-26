import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ShieldCheck, Download, Search, Filter, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { trackCta } from "@/lib/cta";
import { AnalyticsEvents } from "@/lib/analyticsEvents";
import { logExportAudit } from "@/lib/exportAudit";
import { toast } from "sonner";

interface AuditRow {
  id: string;
  corporate_id: string;
  event_type: string;
  ledger_entry_id: string | null;
  proof_id: string | null;
  amount_cents: number | null;
  balance_after_cents: number | null;
  reference: string | null;
  paybill_reference: string | null;
  actor_user_id: string | null;
  actor_email: string | null;
  notes: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
}

const EVENT_LABELS: Record<string, string> = {
  ledger_post: "Cash Ledger Posting",
  proof_approved: "Proof Approved",
  proof_rejected: "Proof Rejected",
};

const EVENT_OPTIONS = [
  { value: "ledger_post", label: "Ledger Posting" },
  { value: "proof_approved", label: "Proof Approved" },
  { value: "proof_rejected", label: "Proof Rejected" },
];

const PAGE_SIZES = [25, 50, 100, 250] as const;

function rangeFromPreset(p: string): { from: string; to: string } | null {
  const today = new Date();
  const d = (dt: Date) => dt.toISOString().slice(0, 10);
  const start = (dt: Date) => { const x = new Date(dt); x.setHours(0,0,0,0); return x; };
  if (p === "today") return { from: d(start(today)), to: d(today) };
  if (p === "yesterday") {
    const y = new Date(today); y.setDate(y.getDate() - 1);
    return { from: d(start(y)), to: d(start(y)) };
  }
  if (p === "7d") { const x = new Date(today); x.setDate(x.getDate() - 7); return { from: d(x), to: d(today) }; }
  if (p === "30d") { const x = new Date(today); x.setDate(x.getDate() - 30); return { from: d(x), to: d(today) }; }
  return null;
}

export default function CorporateAuditLog({ corporateId }: { corporateId: string | null }) {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [paybillRef, setPaybillRef] = useState("");
  const [corporateName, setCorporateName] = useState("");

  const [eventFilters, setEventFilters] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [preset, setPreset] = useState<string>("30d");
  const [from, setFrom] = useState<string>(() => rangeFromPreset("30d")!.from);
  const [to, setTo] = useState<string>(() => rangeFromPreset("30d")!.to);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(50);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!corporateId) return;
    (async () => {
      const { data: corp } = await supabase.from("corporate_accounts")
        .select("paybill_reference,legal_name").eq("id", corporateId).maybeSingle();
      setPaybillRef(corp?.paybill_reference ?? "");
      setCorporateName(corp?.legal_name ?? "");
    })();
  }, [corporateId]);

  const buildQuery = useCallback(() => {
    let q = supabase.from("corporate_cash_ledger_audit")
      .select("*", { count: "exact" }).eq("corporate_id", corporateId!);
    if (eventFilters.length) q = q.in("event_type", eventFilters);
    if (from) q = q.gte("created_at", new Date(from).toISOString());
    if (to) q = q.lte("created_at", new Date(to + "T23:59:59").toISOString());
    if (search.trim()) {
      const s = search.trim().replace(/[%]/g, "");
      q = q.or(
        `reference.ilike.%${s}%,paybill_reference.ilike.%${s}%,actor_email.ilike.%${s}%,notes.ilike.%${s}%`
      );
    }
    return q.order("created_at", { ascending: false });
  }, [corporateId, eventFilters, from, to, search]);

  useEffect(() => {
    if (!corporateId) return;
    setLoading(true);
    (async () => {
      const fromIdx = page * pageSize;
      const toIdx = fromIdx + pageSize - 1;
      const { data, count: c } = await buildQuery().range(fromIdx, toIdx);
      setRows((data ?? []) as unknown as AuditRow[]);
      setCount(c ?? 0);
      setLoading(false);
    })();
  }, [corporateId, buildQuery, page, pageSize]);

  function toggleEvent(v: string) {
    setPage(0);
    setEventFilters((cur) => cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v]);
  }
  function applyPreset(p: string) {
    setPreset(p); setPage(0);
    if (p === "custom") return;
    const r = rangeFromPreset(p);
    if (r) { setFrom(r.from); setTo(r.to); }
  }

  async function exportCsv() {
    if (!corporateId) return;
    setExporting(true);
    try {
      // Stream in chunks of 1000 from the filtered query
      const chunkSize = 1000;
      const all: AuditRow[] = [];
      let offset = 0;
      while (true) {
        const { data, error } = await buildQuery().range(offset, offset + chunkSize - 1);
        if (error) throw error;
        const batch = (data ?? []) as unknown as AuditRow[];
        all.push(...batch);
        if (batch.length < chunkSize) break;
        offset += chunkSize;
        if (all.length >= 100_000) break; // safety cap
      }

      const header = [
        "reference_no","timestamp","event_type","actor_name","actor_email","actor_role",
        "company_name","action","status","amount","currency","proof_reference","proof_status",
        "wallet_transaction_id","cash_ledger_entry_id","ip_address","device","notes",
      ];
      const lines = all.map((r) => {
        const payload = (r.payload ?? {}) as Record<string, unknown>;
        const cells = [
          r.reference ?? "",
          new Date(r.created_at).toISOString(),
          r.event_type,
          (payload.actor_name as string) ?? "",
          r.actor_email ?? "",
          (payload.actor_role as string) ?? "corporate_employee",
          corporateName,
          r.event_type,
          r.event_type === "proof_rejected" ? "rejected" : "success",
          r.amount_cents != null ? (r.amount_cents / 100).toFixed(2) : "",
          (payload.currency as string) ?? "KES",
          (payload.proof_reference as string) ?? r.proof_id ?? "",
          r.event_type === "proof_approved" ? "approved" : r.event_type === "proof_rejected" ? "rejected" : "",
          (payload.wallet_transaction_id as string) ?? "",
          r.ledger_entry_id ?? "",
          (payload.ip_address as string) ?? "",
          (payload.device as string) ?? "",
          (r.notes ?? "").replace(/[\r\n]+/g, " "),
        ];
        return cells.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",");
      });
      const csv = [header.join(","), ...lines].join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `yalla-audit-${paybillRef || "corp"}-${new Date().toISOString().slice(0,10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);

      void trackCta({
        buttonName: AnalyticsEvents.AUDIT_CSV_EXPORTED,
        actionType: "submit",
        target: "corporate.audit_log",
        metadata: { company_id: corporateId, rows_exported: all.length, scope: "corporate" },
      });
      void logExportAudit({
        dataset: "corporate.audit_log",
        exportType: "csv",
        rowCount: all.length,
        byteSize: blob.size,
        filters: { from, to, events: eventFilters, search, paybill_reference: paybillRef },
      });
      toast.success(`Exported ${all.length.toLocaleString()} rows`);
    } catch (e) {
      toast.error(e?.message ?? "Export failed");
    } finally {
      setExporting(false);
    }
  }

  const pages = Math.max(1, Math.ceil(count / pageSize));
  const fmt = (c: number | null) => c == null ? "—" : (c / 100).toLocaleString(undefined, { minimumFractionDigits: 2 });

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" />Immutable Audit Log</h3>
          <p className="text-xs text-muted-foreground">
            Append-only record for{" "}
            <span className="font-mono font-semibold">{paybillRef || "—"}</span>. Entries cannot be edited or deleted.
          </p>
        </div>
        <button data-analytics="auditlog.export_csv" onClick={exportCsv} disabled={exporting || !corporateId}
                className="text-sm px-3 py-1.5 rounded-md border hover:bg-muted flex items-center gap-1.5 disabled:opacity-50">
          {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Export CSV
        </button>
      </div>

      <div className="rounded-xl border bg-card p-4 space-y-3">
        <div className="grid sm:grid-cols-4 gap-3">
          <div className="sm:col-span-2 relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <input value={search} onChange={(e) => { setPage(0); setSearch(e.target.value); }}
                   placeholder="Search reference, paybill ref, actor email, notes…"
                   className="w-full pl-8 pr-3 py-2 text-sm rounded-md border bg-background" />
          </div>
          <select value={preset} onChange={(e) => applyPreset(e.target.value)}
                  className="px-3 py-2 text-sm rounded-md border bg-background">
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="custom">Custom range</option>
          </select>
          <div className="flex gap-2 text-sm">
            <input type="date" value={from} onChange={(e) => { setPreset("custom"); setPage(0); setFrom(e.target.value); }}
                   className="px-2 py-2 rounded-md border bg-background flex-1" />
            <input type="date" value={to} onChange={(e) => { setPreset("custom"); setPage(0); setTo(e.target.value); }}
                   className="px-2 py-2 rounded-md border bg-background flex-1" />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">Events:</span>
          {EVENT_OPTIONS.map(opt => (
            <button key={opt.value} onClick={() => toggleEvent(opt.value)}
                    className={`px-2 py-1 rounded-md border ${eventFilters.includes(opt.value) ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted"}`}>
              {opt.label}
            </button>
          ))}
          {eventFilters.length > 0 && (
            <button onClick={() => { setEventFilters([]); setPage(0); }}
                    className="text-muted-foreground underline ml-2">Clear</button>
          )}
        </div>
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2">When</th>
                <th className="text-left px-4 py-2">Event</th>
                <th className="text-left px-4 py-2">Paybill Ref</th>
                <th className="text-left px-4 py-2">Reference</th>
                <th className="text-right px-4 py-2">Amount</th>
                <th className="text-right px-4 py-2">Balance after</th>
                <th className="text-left px-4 py-2">Actor</th>
                <th className="text-left px-4 py-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={8} className="text-center text-muted-foreground py-8">Loading…</td></tr>
              )}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={8} className="text-center text-muted-foreground py-8 flex items-center justify-center gap-2"><Filter className="h-4 w-4" />No matching audit entries.</td></tr>
              )}
              {!loading && rows.map(r => (
                <tr key={r.id} className="border-t align-top">
                  <td className="px-4 py-2 text-xs whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="px-4 py-2"><EventBadge type={r.event_type} /></td>
                  <td className="px-4 py-2 font-mono text-xs">{r.paybill_reference ?? paybillRef}</td>
                  <td className="px-4 py-2 font-mono text-xs">{r.reference ?? "—"}</td>
                  <td className="px-4 py-2 text-right font-mono">{fmt(r.amount_cents)}</td>
                  <td className="px-4 py-2 text-right font-mono">{fmt(r.balance_after_cents)}</td>
                  <td className="px-4 py-2 text-xs">{r.actor_email ?? r.actor_user_id?.slice(0,8) ?? "system"}</td>
                  <td className="px-4 py-2 text-xs max-w-sm truncate text-muted-foreground">{r.notes ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between p-3 border-t text-xs text-muted-foreground">
          <div>
            {count.toLocaleString()} entries · page {page + 1} of {pages}
          </div>
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
      </div>
    </div>
  );
}

function EventBadge({ type }: { type: string }) {
  const styles: Record<string, string> = {
    ledger_post: "bg-ai/10 text-ai dark:bg-ai/40 dark:text-ai",
    proof_approved: "bg-status-success/10 text-status-success dark:bg-status-success/40 dark:text-status-success",
    proof_rejected: "bg-status-danger/10 text-status-danger dark:bg-status-danger/40 dark:text-status-danger",
  };
  return <span className={`px-2 py-0.5 rounded text-xs ${styles[type] ?? "bg-muted"}`}>{EVENT_LABELS[type] ?? type}</span>;
}
