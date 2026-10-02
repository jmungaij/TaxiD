import { GuestBookingsTable } from "@/components/corporate/GuestRides";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import CorporateBillingPanel from "@/components/corporate/CorporateBillingPanel";
import { ArrowDownLeft, ArrowUpRight, BookOpen, Download } from "lucide-react";

interface Entry {
  id: string;
  entry_type: string;
  amount_cents: number;
  balance_after_cents: number;
  currency: string;
  reference: string | null;
  description: string | null;
  source_kind: string | null;
  occurred_at: string;
}

export default function CorporateCashLedger({ corporateId }: { corporateId: string | null }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [paybillRef, setPaybillRef] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!corporateId) return;
    (async () => {
      const { data: corp, error: corpErr } = await supabase.from("corporate_accounts")
        .select("paybill_reference").eq("id", corporateId).maybeSingle();
      setPaybillRef(corp?.paybill_reference ?? "");

      const { data, error } = await supabase.from("corporate_cash_ledger")
        .select("id, entry_type, amount_cents, balance_after_cents, currency, reference, description, source_kind, occurred_at")
        .eq("corporate_id", corporateId)
        .order("occurred_at", { ascending: false }).limit(200);
      // A failed read must never render as "no ledger entries yet" on an audit trail.
      setLoadError(error?.message ?? corpErr?.message ?? null);
      setEntries((data ?? []) as Entry[]);
    })();
  }, [corporateId]);


  function exportCsv() {
    const header = ["occurred_at","entry_type","amount_cents","balance_after_cents","currency","reference","description","source_kind","paybill_reference"];
    const rows = entries.map(e => [
      e.occurred_at, e.entry_type, e.amount_cents, e.balance_after_cents, e.currency,
      e.reference ?? "", (e.description ?? "").replace(/"/g, "''"), e.source_kind ?? "", paybillRef,
    ]);
    const csv = [header, ...rows].map(r => r.map(v => `"${v}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = `cash-ledger-${paybillRef}.csv`; a.click();
  }

  const fmt = (c: number) => `${(c / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="space-y-4">
      <CorporateBillingPanel corporateId={corporateId} />
      {corporateId && (
        <div className="rounded-xl border bg-card p-4 space-y-2">
          <h3 className="font-semibold">Guest, client & hotel bookings</h3>
          <p className="text-xs text-muted-foreground">Estimated fares charged to the company, with project, client, PO and accounting codes.</p>
          <GuestBookingsTable corporateId={corporateId} />
        </div>
      )}
      <div className="rounded-xl border bg-card p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold flex items-center gap-2"><BookOpen className="h-4 w-4 text-primary" />Cash Ledger</h3>
          <p className="text-xs text-muted-foreground">Posted, immutable entries. Paybill reference <span className="font-mono font-semibold">{paybillRef || "—"}</span>.</p>
        </div>
        <button data-analytics="cashledger.export_csv" onClick={exportCsv} className="text-sm px-3 py-1.5 rounded-md border hover:bg-muted flex items-center gap-1.5">
          <Download className="h-4 w-4" />Export CSV
        </button>
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-2">Posted</th>
              <th className="text-left px-4 py-2">Type</th>
              <th className="text-left px-4 py-2">Description</th>
              <th className="text-left px-4 py-2">Reference</th>
              <th className="text-right px-4 py-2">Amount</th>
              <th className="text-right px-4 py-2">Balance after</th>
            </tr>
          </thead>
          <tbody>
            {loadError && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-sm text-destructive" role="alert">
                Ledger could not be loaded — this is not an empty ledger. {loadError}
              </td></tr>
            )}
            {!loadError && entries.length === 0 && (
              <tr><td colSpan={6} className="text-center text-muted-foreground py-8">No ledger entries yet.</td></tr>
            )}

            {entries.map((e) => {
              const credit = e.amount_cents > 0;
              return (
                <tr key={e.id} className="border-t">
                  <td className="px-4 py-2 text-xs text-muted-foreground whitespace-nowrap">{new Date(e.occurred_at).toLocaleString()}</td>
                  <td className="px-4 py-2">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${credit ? "bg-status-success/10 text-status-success dark:bg-status-success/40 dark:text-status-success" : "bg-status-danger/10 text-status-danger dark:bg-status-danger/40 dark:text-status-danger"}`}>
                      {credit ? <ArrowDownLeft className="h-3 w-3" /> : <ArrowUpRight className="h-3 w-3" />}{e.entry_type}
                    </span>
                  </td>
                  <td className="px-4 py-2 max-w-sm truncate">{e.description}</td>
                  <td className="px-4 py-2 text-xs font-mono">{e.reference}</td>
                  <td className={`px-4 py-2 text-right font-mono ${credit ? "text-status-success" : "text-status-danger"}`}>
                    {credit ? "+" : ""}{fmt(e.amount_cents)} {e.currency}
                  </td>
                  <td className="px-4 py-2 text-right font-mono">{fmt(e.balance_after_cents)} {e.currency}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
