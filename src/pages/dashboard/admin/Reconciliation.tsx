import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import {
  AlertTriangle, CheckCircle2, Download, RefreshCcw, Search, ShieldAlert,
  TrendingDown, FileWarning, Ghost, Loader2,
} from "lucide-react";
import { toast } from "sonner";

type Row = {
  id: string;
  corp_reference: string;
  proof_reference: string | null;
  mpesa_receipt: string | null;
  expected_amount_cents: number;
  proof_amount_cents: number | null;
  wallet_amount_cents: number | null;
  cash_ledger_amount_cents: number | null;
  amount_difference_cents: number;
  reconciliation_status: string;
  mismatch_reason: string | null;
  severity: string;
  confidence_score: number;
  created_at: string;
  corporate_id: string;
};

const STATUS_STYLES: Record<string, string> = {
  RECONCILED: "bg-status-success/10 text-status-success border-status-success/30",
  MISMATCH: "bg-status-warning/10 text-status-warning border-status-warning/30",
  FRAUD_ALERT: "bg-status-danger/10 text-status-danger border-status-danger/30",
  ORPHAN: "bg-ai/10 text-ai border-ai/30",
  FAILED: "bg-status-warning/10 text-status-warning border-status-warning/30",
  PENDING_REVIEW: "bg-muted text-foreground border-border",
};

const SEVERITY_STYLES: Record<string, string> = {
  LOW: "bg-muted text-muted-foreground",
  MEDIUM: "bg-status-warning/10 text-status-warning",
  HIGH: "bg-status-warning/10 text-status-warning",
  CRITICAL: "bg-status-danger/10 text-status-danger",
};

const PAGE_SIZES = [25, 50, 100, 250];
const KES = (c: number | null | undefined) =>
  c == null ? "—" : `KES ${(c / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

export default function AdminReconciliation() {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [severity, setSeverity] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);

  const [kpis, setKpis] = useState({
    reconciled: 0, mismatch: 0, fraud: 0, orphan: 0, failed: 0, pending: 0, recoveryCents: 0,
  });

  async function load() {
    setLoading(true);
    let q = supabase
      .from("corporate_financial_reconciliation")
      .select(
        "id, corp_reference, proof_reference, mpesa_receipt, expected_amount_cents, proof_amount_cents, wallet_amount_cents, cash_ledger_amount_cents, amount_difference_cents, reconciliation_status, mismatch_reason, severity, confidence_score, created_at, corporate_id",
        { count: "exact" }
      )
      .order("created_at", { ascending: false });

    if (status !== "all") q = q.eq("reconciliation_status", status as Row["reconciliation_status"] as never);
    if (severity !== "all") q = q.eq("severity", severity as Row["severity"] as never);
    if (search.trim()) {
      const s = `%${search.trim()}%`;
      q = q.or(`corp_reference.ilike.${s},proof_reference.ilike.${s},mpesa_receipt.ilike.${s}`);
    }

    const from = page * pageSize;
    const to = from + pageSize - 1;
    const { data, count, error } = await q.range(from, to);
    if (error) toast.error(error.message);
    setRows((data ?? []) as Row[]);
    setTotal(count ?? 0);
    setLoading(false);
  }

  async function loadKpis() {
    const { data } = await supabase
      .from("corporate_financial_reconciliation")
      .select("reconciliation_status, amount_difference_cents");
    const k = { reconciled: 0, mismatch: 0, fraud: 0, orphan: 0, failed: 0, pending: 0, recoveryCents: 0 };
    (data ?? []).forEach((r: { reconciliation_status: string; amount_difference_cents: number }) => {
      switch (r.reconciliation_status) {
        case "RECONCILED": k.reconciled++; break;
        case "MISMATCH": k.mismatch++; k.recoveryCents += Math.abs(r.amount_difference_cents ?? 0); break;
        case "FRAUD_ALERT": k.fraud++; k.recoveryCents += Math.abs(r.amount_difference_cents ?? 0); break;
        case "ORPHAN": k.orphan++; break;
        case "FAILED": k.failed++; break;
        case "PENDING_REVIEW": k.pending++; break;
      }
    });
    setKpis(k);
  }

  useEffect(() => { void load(); }, [status, severity, page, pageSize]);
  useEffect(() => { void loadKpis(); }, []);

  // Realtime: live updates from reconciliation engine + wallet freezes
  useEffect(() => {
    const ch = supabase
      .channel("reconciliation-admin")
      .on("postgres_changes",
        { event: "*", schema: "public", table: "corporate_financial_reconciliation" },
        (payload) => {
          const row = (payload.new ?? payload.eventType === "DELETE" ? payload.old : payload.new) as Row | null;
          void loadKpis();
          void load();
          if (payload.eventType === "INSERT" && row?.reconciliation_status === "FRAUD_ALERT") {
            toast.error(`⚠ Fraud alert: ${row.proof_reference ?? row.corp_reference} — ${row.mismatch_reason ?? "duplicate or suspicious"}`, { duration: 8000 });
          } else if (payload.eventType === "UPDATE" && row?.reconciliation_status === "FRAUD_ALERT") {
            toast.warning(`Updated: ${row.proof_reference ?? row.corp_reference} → FRAUD_ALERT`);
          }
        })
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "wallet_freezes" },
        (payload) => {
          const f = payload.new as { freeze_type?: string; reason?: string } | null;
          if (f) toast.warning(`Wallet frozen (${f.freeze_type}) — ${f.reason ?? ""}`, { duration: 8000 });
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  async function runEngine() {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("reconcile-corporate-finance", { body: {} });
      if (error) throw error;
      toast.success(`Engine run complete — ${data?.processed ?? 0} processed`);
      await load(); await loadKpis();
    } catch (e) {
      toast.error("Engine failed: " + String(e));
    } finally { setRunning(false); }
  }

  async function exportCsv() {
    toast.message("Preparing CSV export…");
    const chunkSize = 1000;
    let offset = 0; const all: Row[] = [];
    while (true) {
      let q = supabase
        .from("corporate_financial_reconciliation")
        .select("id, corp_reference, proof_reference, mpesa_receipt, expected_amount_cents, proof_amount_cents, wallet_amount_cents, cash_ledger_amount_cents, amount_difference_cents, reconciliation_status, mismatch_reason, severity, confidence_score, created_at, corporate_id")
        .order("created_at", { ascending: false })
        .range(offset, offset + chunkSize - 1);
      if (status !== "all") q = q.eq("reconciliation_status", status as Row["reconciliation_status"] as never);
      if (severity !== "all") q = q.eq("severity", severity as Row["severity"] as never);
      const { data, error } = await q;
      if (error) { toast.error(error.message); return; }
      all.push(...((data ?? []) as Row[]));
      if (!data || data.length < chunkSize) break;
      offset += chunkSize;
    }
    const header = [
      "created_at","corp_reference","proof_reference","mpesa_receipt","status","severity","confidence",
      "expected_kes","proof_kes","wallet_kes","ledger_kes","difference_kes","reason",
    ];
    const csv = [header, ...all.map((r) => [
      r.created_at, r.corp_reference, r.proof_reference ?? "", r.mpesa_receipt ?? "",
      r.reconciliation_status, r.severity, r.confidence_score,
      (r.expected_amount_cents / 100).toFixed(2),
      r.proof_amount_cents != null ? (r.proof_amount_cents / 100).toFixed(2) : "",
      r.wallet_amount_cents != null ? (r.wallet_amount_cents / 100).toFixed(2) : "",
      r.cash_ledger_amount_cents != null ? (r.cash_ledger_amount_cents / 100).toFixed(2) : "",
      (r.amount_difference_cents / 100).toFixed(2),
      r.mismatch_reason ?? "",
    ])].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url;
    a.download = `reconciliation-${new Date().toISOString().slice(0,10)}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${all.length} rows`);
  }

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total, pageSize]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Financial Reconciliation</h1>
          <p className="text-sm text-muted-foreground">
            Automated reconciliation of corporate paybill proofs, wallet credits, and the cash ledger.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button data-analytics="reconciliation.export_csv" variant="outline" onClick={exportCsv}><Download className="h-4 w-4 mr-1.5" />Export CSV</Button>
          <Button onClick={runEngine} disabled={running}>
            {running ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <RefreshCcw className="h-4 w-4 mr-1.5" />}
            Run engine now
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <Kpi icon={<CheckCircle2 className="h-4 w-4" />} label="Reconciled" value={kpis.reconciled} tint="text-status-success" />
        <Kpi icon={<TrendingDown className="h-4 w-4" />} label="Mismatches" value={kpis.mismatch} tint="text-status-warning" />
        <Kpi icon={<ShieldAlert className="h-4 w-4" />} label="Fraud alerts" value={kpis.fraud} tint="text-status-danger" />
        <Kpi icon={<Ghost className="h-4 w-4" />} label="Orphan" value={kpis.orphan} tint="text-ai" />
        <Kpi icon={<FileWarning className="h-4 w-4" />} label="Failed" value={kpis.failed} tint="text-status-warning" />
        <Kpi icon={<AlertTriangle className="h-4 w-4" />} label="Pending" value={kpis.pending} tint="text-muted-foreground" />
        <Kpi icon={<TrendingDown className="h-4 w-4" />} label="Recovery value" value={KES(kpis.recoveryCents)} tint="text-foreground" small />
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search} onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { setPage(0); void load(); } }}
              placeholder="Search CORP-, M-Pesa receipt, or proof reference"
              className="pl-9"
            />
          </div>
          <Select value={status} onValueChange={(v) => { setStatus(v); setPage(0); }}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="RECONCILED">Reconciled</SelectItem>
              <SelectItem value="MISMATCH">Mismatch</SelectItem>
              <SelectItem value="FRAUD_ALERT">Fraud alert</SelectItem>
              <SelectItem value="ORPHAN">Orphan</SelectItem>
              <SelectItem value="FAILED">Failed</SelectItem>
              <SelectItem value="PENDING_REVIEW">Pending review</SelectItem>
            </SelectContent>
          </Select>
          <Select value={severity} onValueChange={(v) => { setSeverity(v); setPage(0); }}>
            <SelectTrigger className="w-[150px]"><SelectValue placeholder="Severity" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All severities</SelectItem>
              <SelectItem value="LOW">Low</SelectItem>
              <SelectItem value="MEDIUM">Medium</SelectItem>
              <SelectItem value="HIGH">High</SelectItem>
              <SelectItem value="CRITICAL">Critical</SelectItem>
            </SelectContent>
          </Select>
          <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(0); }}>
            <SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((s) => (<SelectItem key={s} value={String(s)}>{s} / page</SelectItem>))}
            </SelectContent>
          </Select>
        </div>

        <div className="overflow-x-auto border rounded-md">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left p-2">CORP / Proof</th>
                <th className="text-left p-2">M-Pesa</th>
                <th className="text-right p-2">Proof</th>
                <th className="text-right p-2">Wallet</th>
                <th className="text-right p-2">Ledger</th>
                <th className="text-right p-2">Δ</th>
                <th className="text-left p-2">Status</th>
                <th className="text-left p-2">Severity</th>
                <th className="text-right p-2">Confidence</th>
                <th className="text-left p-2">Created</th>
              </tr>
            </thead>
            <tbody>
              {loading && (<tr><td colSpan={10} className="text-center p-6 text-muted-foreground">Loading…</td></tr>)}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={10} className="text-center p-6 text-muted-foreground">
                  No reconciliation rows yet. Click "Run engine now" to generate the first pass.
                </td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className="border-t hover:bg-muted/30">
                  <td className="p-2 font-mono text-xs">
                    <Link to={`/dashboard/admin/reconciliation/${r.id}`} className="text-primary hover:underline">
                      {r.proof_reference ?? r.corp_reference}
                    </Link>
                  </td>
                  <td className="p-2 font-mono text-xs">{r.mpesa_receipt ?? "—"}</td>
                  <td className="p-2 text-right">{KES(r.proof_amount_cents)}</td>
                  <td className="p-2 text-right">{KES(r.wallet_amount_cents)}</td>
                  <td className="p-2 text-right">{KES(r.cash_ledger_amount_cents)}</td>
                  <td className="p-2 text-right font-semibold">
                    {r.amount_difference_cents === 0 ? "—" : KES(r.amount_difference_cents)}
                  </td>
                  <td className="p-2">
                    <Badge variant="outline" className={STATUS_STYLES[r.reconciliation_status] ?? ""}>
                      {r.reconciliation_status}
                    </Badge>
                  </td>
                  <td className="p-2">
                    <Badge variant="outline" className={SEVERITY_STYLES[r.severity] ?? ""}>{r.severity}</Badge>
                  </td>
                  <td className="p-2 text-right">{r.confidence_score}%</td>
                  <td className="p-2 text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between mt-3 text-sm">
          <div className="text-muted-foreground">
            {total.toLocaleString()} total • Page {page + 1} of {totalPages}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(0)}>First</Button>
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Prev</Button>
            <Button variant="outline" size="sm" disabled={page + 1 >= totalPages} onClick={() => setPage(page + 1)}>Next</Button>
            <Button variant="outline" size="sm" disabled={page + 1 >= totalPages} onClick={() => setPage(totalPages - 1)}>Last</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function Kpi({ icon, label, value, tint, small }: { icon: React.ReactNode; label: string; value: React.ReactNode; tint: string; small?: boolean }) {
  return (
    <Card className="p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">{icon}{label}</div>
      <div className={`mt-1 font-bold ${small ? "text-base" : "text-2xl"} ${tint}`}>{value}</div>
    </Card>
  );
}
