/**
 * How a company's finished business trips are paid: prepaid wallet, approved
 * credit (1–3 day cycle, invoiced) or hybrid. Settlement happens in the
 * database when a trip completes; this panel only reads it, and TaxiD finance
 * staff can change the arrangement through a guarded action.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Landmark, RefreshCw } from "lucide-react";
import { toast } from "sonner";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

type Mode = "PREPAID_WALLET" | "CREDIT" | "HYBRID";
interface Overview {
  mode: Mode; credit_period_days: number; status: string;
  wallet_cents: number; available_credit_cents: number; has_facility: boolean; settled_count: number;
  exceptions: { booking_id: string; booking_number: string; fare_cents: number; reason: string; at: string }[];
  recent: { booking_number: string; fare_cents: number; wallet_cents: number; credit_cents: number; invoice_number: string | null; at: string }[];
  open_invoices: { invoice_number: string; status: string; total_cents: number; balance_cents: number; due_at: string }[];
}

const MODE_LABEL: Record<Mode, string> = {
  PREPAID_WALLET: "Prepaid wallet — debited when each trip finishes",
  CREDIT: "Approved credit — added to the company invoice",
  HYBRID: "Hybrid — wallet first, then approved credit",
};
const REASON: Record<string, string> = {
  WALLET_INSUFFICIENT: "Wallet didn't cover the fare",
  CREDIT_LIMIT_EXCEEDED: "Credit limit reached",
  NO_ACTIVE_CREDIT_FACILITY: "No active credit facility",
  WALLET_AND_CREDIT_INSUFFICIENT: "Wallet and credit didn't cover the fare",
  BILLING_SUSPENDED: "Company billing suspended",
  NO_FINAL_FARE: "Trip has no final fare",
};
const kes = (c: number) => `KES ${(c / 100).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function CorporateBillingPanel({ corporateId }: { corporateId: string | null }) {
  const { user } = useAuth() as { user: { id: string } | null };
  const [o, setO] = useState<Overview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [isFinance, setIsFinance] = useState(false);
  const [mode, setMode] = useState<Mode>("PREPAID_WALLET");
  const [days, setDays] = useState(1);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!corporateId) return;
    const { data, error } = await db.rpc("corporate_billing_overview", { _corporate_id: corporateId });
    if (error) { setErr(error.message); return; }
    setErr(null); setO(data); setMode(data.mode); setDays(data.credit_period_days);
  }, [corporateId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!user) return;
    db.from("user_roles").select("role").eq("user_id", user.id).then(({ data }: { data: { role: string }[] | null }) =>
      setIsFinance((data ?? []).some((r) => ["finance_admin", "admin", "super_admin"].includes(r.role))));
  }, [user]);

  async function save() {
    setBusy(true);
    const { data, error } = await db.rpc("corporate_billing_set", { _corporate_id: corporateId, _mode: mode, _credit_period_days: days });
    setBusy(false);
    if (error || !data?.ok) {
      const e = data?.error === "NO_ACTIVE_CREDIT_FACILITY" ? "This company needs an active approved credit facility first." : (error?.message ?? data?.error);
      toast.error(e); return;
    }
    toast.success("Billing arrangement saved"); load();
  }
  async function retry(id: string) {
    const { data, error } = await db.rpc("corporate_settlement_retry", { _booking_id: id });
    if (error) return toast.error(error.message);
    if (data?.status === "SETTLED") toast.success("Trip settled"); else toast.error(REASON[data?.reason] ?? "Still can't settle");
    load();
  }

  if (!corporateId) return null;
  if (err) return <div className="rounded-xl border bg-card p-4 text-sm text-destructive">Couldn't load company billing: {err}</div>;
  if (!o) return <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">Loading company billing…</div>;

  return (
    <div className="rounded-xl border bg-card p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold flex items-center gap-2"><Landmark className="h-4 w-4 text-primary" />How business trips are paid</h3>
          <p className="text-xs text-muted-foreground">{MODE_LABEL[o.mode]}{o.mode !== "PREPAID_WALLET" && ` · ${o.credit_period_days}-day credit cycle`}{o.status === "SUSPENDED" && " · Suspended"}</p>
        </div>
        <button onClick={load} className="text-xs px-2 py-1 rounded-md border hover:bg-muted flex items-center gap-1"><RefreshCw className="h-3 w-3" />Refresh</button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
        <div className="rounded-md border p-2"><p className="text-[11px] text-muted-foreground">Wallet balance</p><p className="font-semibold">{kes(o.wallet_cents)}</p></div>
        <div className="rounded-md border p-2"><p className="text-[11px] text-muted-foreground">Available credit</p><p className="font-semibold">{o.has_facility ? kes(o.available_credit_cents) : "None"}</p></div>
        <div className="rounded-md border p-2"><p className="text-[11px] text-muted-foreground">Trips settled</p><p className="font-semibold">{o.settled_count}</p></div>
        <div className="rounded-md border p-2"><p className="text-[11px] text-muted-foreground">Needs attention</p><p className={`font-semibold ${o.exceptions.length ? "text-destructive" : ""}`}>{o.exceptions.length}</p></div>
      </div>

      {isFinance && (
        <div className="flex flex-wrap items-end gap-2 rounded-md border bg-muted/30 p-3">
          <label className="text-xs">Arrangement
            <select className="mt-1 block rounded-md border bg-background px-2 py-1 text-sm" value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
              <option value="PREPAID_WALLET">Prepaid wallet</option>
              <option value="CREDIT">Approved credit</option>
              <option value="HYBRID">Hybrid (wallet, then credit)</option>
            </select>
          </label>
          <label className="text-xs">Credit cycle
            <select className="mt-1 block rounded-md border bg-background px-2 py-1 text-sm" value={days} disabled={mode === "PREPAID_WALLET"} onChange={(e) => setDays(Number(e.target.value))}>
              <option value={1}>1 day</option><option value={2}>2 days</option><option value={3}>3 days</option>
            </select>
          </label>
          <button disabled={busy} onClick={save} className="text-sm px-3 py-1.5 rounded-md bg-primary text-primary-foreground disabled:opacity-50">Save</button>
          <p className="w-full text-[11px] text-muted-foreground">TaxiD finance only. Credit and hybrid need an active approved credit facility.</p>
        </div>
      )}

      {o.exceptions.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-semibold">Trips not yet paid by the company — the rider was not charged</p>
          {o.exceptions.map((x) => (
            <div key={x.booking_id} className="flex items-center justify-between rounded-md border border-destructive/40 px-2 py-1 text-xs">
              <span className="font-mono">{x.booking_number}</span><span>{kes(x.fare_cents)}</span><span>{REASON[x.reason] ?? x.reason}</span>
              {isFinance && <button onClick={() => retry(x.booking_id)} className="rounded border px-2 py-0.5 hover:bg-muted">Retry</button>}
            </div>
          ))}
        </div>
      )}

      {o.open_invoices.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-semibold">Credit invoices</p>
          {o.open_invoices.map((i) => (
            <div key={i.invoice_number} className="flex justify-between rounded-md border px-2 py-1 text-xs">
              <span className="font-mono">{i.invoice_number}</span>
              <span>{i.status === "DRAFT" ? "Building this cycle" : i.status}</span>
              <span>{kes(i.balance_cents)}</span><span>Due {new Date(i.due_at).toLocaleDateString()}</span>
            </div>
          ))}
        </div>
      )}

      {o.recent.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-semibold">Recently settled trips</p>
          {o.recent.map((r) => (
            <div key={r.booking_number} className="grid grid-cols-4 gap-2 rounded-md border px-2 py-1 text-xs">
              <span className="font-mono truncate">{r.booking_number}</span><span>{kes(r.fare_cents)}</span>
              <span>{r.wallet_cents > 0 && `Wallet ${kes(r.wallet_cents)}`}{r.wallet_cents > 0 && r.credit_cents > 0 && " + "}{r.credit_cents > 0 && `Credit ${kes(r.credit_cents)}`}</span>
              <span className="truncate">{r.invoice_number ?? "Receipt in ledger"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
