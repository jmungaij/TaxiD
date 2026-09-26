import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Download, Scale, Search } from "lucide-react";
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
};

const STATUS_STYLES: Record<string, string> = {
  RECONCILED: "bg-status-success/10 text-status-success border-status-success/30",
  MISMATCH: "bg-status-warning/10 text-status-warning border-status-warning/30",
  FRAUD_ALERT: "bg-status-danger/10 text-status-danger border-status-danger/30",
  ORPHAN: "bg-ai/10 text-ai border-ai/30",
  FAILED: "bg-status-warning/10 text-status-warning border-status-warning/30",
  PENDING_REVIEW: "bg-muted text-foreground",
};

const KES = (c: number | null | undefined) =>
  c == null ? "—" : `KES ${(c / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

export default function CorporateReconciliation({ corporateId }: { corporateId: string | null }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState("");
  const [paybillRef, setPaybillRef] = useState("");

  useEffect(() => {
    if (!corporateId) return;
    (async () => {
      const { data: corp } = await supabase.from("corporate_accounts")
        .select("paybill_reference").eq("id", corporateId).maybeSingle();
      setPaybillRef(corp?.paybill_reference ?? "");
      const { data, error } = await supabase
        .from("corporate_financial_reconciliation")
        .select("id, corp_reference, proof_reference, mpesa_receipt, expected_amount_cents, proof_amount_cents, wallet_amount_cents, cash_ledger_amount_cents, amount_difference_cents, reconciliation_status, mismatch_reason, severity, confidence_score, created_at")
        .eq("corporate_id", corporateId)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) toast.error(error.message);
      setRows((data ?? []) as Row[]);
    })();
  }, [corporateId]);

  // Realtime updates for this corporate
  useEffect(() => {
    if (!corporateId) return;
    const ch = supabase.channel(`corporate-${corporateId}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "corporate_financial_reconciliation", filter: `corporate_id=eq.${corporateId}` },
        (payload) => {
          const row = (payload.new ?? payload.old) as Row | undefined;
          if (payload.eventType === "INSERT" && row) {
            setRows((prev) => [row, ...prev].slice(0, 500));
            if (row.reconciliation_status === "RECONCILED") toast.success(`✓ ${row.proof_reference ?? row.corp_reference} reconciled`);
            else if (row.reconciliation_status === "FRAUD_ALERT") toast.error(`Fraud alert: ${row.proof_reference ?? row.corp_reference}`);
          } else if (payload.eventType === "UPDATE" && row) {
            setRows((prev) => prev.map((r) => r.id === row.id ? { ...r, ...row } : r));
            toast.info(`Status updated: ${row.proof_reference ?? row.corp_reference} → ${row.reconciliation_status}`);
          }
        })
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "wallet_freezes", filter: `corporate_id=eq.${corporateId}` },
        () => toast.warning("Your corporate wallet was frozen pending review. Contact support@yalla.africa."))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [corporateId]);

  const filtered = rows.filter((r) => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return (
      r.corp_reference.toLowerCase().includes(s) ||
      (r.proof_reference ?? "").toLowerCase().includes(s) ||
      (r.mpesa_receipt ?? "").toLowerCase().includes(s)
    );
  });

  function exportCsv() {
    const header = ["created_at","corp_reference","proof_reference","mpesa_receipt","status","severity","confidence","expected_kes","proof_kes","wallet_kes","ledger_kes","difference_kes","reason"];
    const csv = [header, ...filtered.map((r) => [
      r.created_at, r.corp_reference, r.proof_reference ?? "", r.mpesa_receipt ?? "",
      r.reconciliation_status, r.severity, r.confidence_score,
      (r.expected_amount_cents/100).toFixed(2),
      r.proof_amount_cents != null ? (r.proof_amount_cents/100).toFixed(2) : "",
      r.wallet_amount_cents != null ? (r.wallet_amount_cents/100).toFixed(2) : "",
      r.cash_ledger_amount_cents != null ? (r.cash_ledger_amount_cents/100).toFixed(2) : "",
      (r.amount_difference_cents/100).toFixed(2),
      r.mismatch_reason ?? "",
    ])].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url;
    a.download = `reconciliation-${paybillRef || "corp"}-${new Date().toISOString().slice(0,10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold flex items-center gap-2">
            <Scale className="h-4 w-4 text-primary" />Financial Reconciliation
          </h3>
          <p className="text-xs text-muted-foreground">
            Independent verification of paybill proofs, wallet credits, and cash-ledger postings.
            Paybill reference <span className="font-mono font-semibold">{paybillRef || "—"}</span>.
          </p>
        </div>
        <Button data-analytics="reconciliation.export_csv" variant="outline" size="sm" onClick={exportCsv}>
          <Download className="h-4 w-4 mr-1.5" />Export CSV
        </Button>
      </div>

      <div className="relative max-w-md">
        <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Search CORP, proof or M-Pesa" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>

      <Card className="overflow-x-auto">
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
              <th className="text-right p-2">Confidence</th>
              <th className="text-left p-2">When</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={9} className="text-center p-6 text-muted-foreground">No reconciliation records yet.</td></tr>
            )}
            {filtered.map((r) => (
              <tr key={r.id} className="border-t hover:bg-muted/30">
                <td className="p-2 font-mono text-xs">{r.proof_reference ?? r.corp_reference}</td>
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
                <td className="p-2 text-right">{r.confidence_score}%</td>
                <td className="p-2 text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <p className="text-xs text-muted-foreground">
        Mismatches and fraud alerts are reviewed by SAFARID finance. For questions, contact{" "}
        <a href="mailto:support@yalla.africa" className="text-primary hover:underline">support@yalla.africa</a>.
      </p>
    </div>
  );
}
