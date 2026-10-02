import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, RefreshCw, Smartphone } from "lucide-react";

interface Attempt {
  id: string;
  user_id: string | null;
  amount_cents: number;
  phone: string | null;
  state: string;
  wallet_posted: boolean | null;
  mpesa_receipt_number: string | null;
  account_reference: string | null;
  receiving_account: string | null;
  failure_reason: string | null;
  created_at: string;
  completed_at: string | null;
}

const OK = new Set(["COMPLETED", "RECONCILED"]);
const BAD = new Set(["FAILED", "CANCELLED", "TIMEOUT", "EXPIRED", "REJECTED"]);

function stateVariant(s: string): "default" | "secondary" | "destructive" | "outline" {
  if (OK.has(s)) return "default";
  if (BAD.has(s)) return "destructive";
  return "secondary";
}

const kes = (cents: number) => `KSh ${(cents / 100).toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;
const maskPhone = (p: string | null) => (p && p.length > 6 ? `${p.slice(0, 5)}•••${p.slice(-3)}` : p ?? "—");

export default function MpesaPayments() {
  const [rows, setRows] = useState<Attempt[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("ALL");
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from("payment_attempts")
      .select("id,user_id,amount_cents,phone,state,wallet_posted,mpesa_receipt_number,account_reference,receiving_account,failure_reason,created_at,completed_at")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    const list = (data ?? []) as Attempt[];
    setRows(list);
    const ids = [...new Set(list.map((r) => r.user_id).filter(Boolean))] as string[];
    if (ids.length) {
      const { data: profs } = await supabase.from("profiles").select("user_id,full_name").in("user_id", ids);
      const m: Record<string, string> = {};
      (profs ?? []).forEach((p: { user_id: string; full_name: string | null }) => { if (p.full_name) m[p.user_id] = p.full_name; });
      setNames(m);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const states = useMemo(() => ["ALL", ...new Set(rows.map((r) => r.state))], [rows]);
  const shown = rows.filter((r) =>
    (filter === "ALL" || r.state === filter) &&
    (!q || [r.mpesa_receipt_number, r.phone, r.account_reference, names[r.user_id ?? ""]].some((v) => v?.toLowerCase().includes(q.toLowerCase()))),
  );

  const totals = useMemo(() => {
    const done = rows.filter((r) => OK.has(r.state));
    return {
      count: rows.length,
      done: done.length,
      collected: done.reduce((s, r) => s + r.amount_cents, 0),
      credited: rows.filter((r) => r.wallet_posted).length,
      failed: rows.filter((r) => BAD.has(r.state)).length,
      pending: rows.filter((r) => !OK.has(r.state) && !BAD.has(r.state)).length,
    };
  }, [rows]);

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Smartphone className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">M-Pesa Payments</h1>
            <p className="text-sm text-muted-foreground">Every top-up attempt, its status, and whether it reached the wallet.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild><Link to="/dashboard/admin/payment-credentials">Payment Credentials</Link></Button>
          <Button onClick={load} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {[
          ["Attempts", String(totals.count)],
          ["Completed", String(totals.done)],
          ["Collected", kes(totals.collected)],
          ["Credited to wallet", String(totals.credited)],
          ["Pending / Failed", `${totals.pending} / ${totals.failed}`],
        ].map(([label, value]) => (
          <Card key={label}>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle></CardHeader>
            <CardContent><div className="text-2xl font-bold">{value}</div></CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle>Payment attempts</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Input placeholder="Search receipt, phone, name…" value={q} onChange={(e) => setQ(e.target.value)} className="w-56" />
            <select
              aria-label="Filter by status"
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              {states.map((s) => <option key={s} value={s}>{s === "ALL" ? "All statuses" : s}</option>)}
            </select>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {error ? (
            <p className="text-sm text-destructive">Couldn't load payments: {error}</p>
          ) : loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : shown.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payment attempts yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="py-2 pr-3">Time</th>
                  <th className="py-2 pr-3">Payer</th>
                  <th className="py-2 pr-3">Phone</th>
                  <th className="py-2 pr-3 text-right">Amount</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Paid into</th>
                  <th className="py-2 pr-3">M-Pesa receipt</th>
                  <th className="py-2 pr-3">Wallet</th>
                  <th className="py-2">Note</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} className="border-b border-border/60 align-top">
                    <td className="py-2 pr-3 whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                    <td className="py-2 pr-3">{names[r.user_id ?? ""] ?? "—"}</td>
                    <td className="py-2 pr-3 font-mono">{maskPhone(r.phone)}</td>
                    <td className="py-2 pr-3 text-right font-medium">{kes(r.amount_cents)}</td>
                    <td className="py-2 pr-3"><Badge variant={stateVariant(r.state)}>{r.state}</Badge></td>
                    <td className="py-2 pr-3">{r.receiving_account ? `PayBill ${r.receiving_account}` : "PayBill 4573823"}</td>
                    <td className="py-2 pr-3 font-mono">{r.mpesa_receipt_number ?? "—"}</td>
                    <td className="py-2 pr-3">{r.wallet_posted ? <Badge>Credited</Badge> : <Badge variant="outline">Not yet</Badge>}</td>
                    <td className="py-2 text-muted-foreground">{r.failure_reason ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
