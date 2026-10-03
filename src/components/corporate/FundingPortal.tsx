/**
 * Company funding portal: balance, money held for trips, credit line,
 * M-Pesa top-up (via AccountBalancePanel) and full payment history.
 * Credit lines are approved only by a TaxiD super admin (server-enforced).
 */
import * as React from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import AccountBalancePanel from "./AccountBalancePanel";
import { ENTRY_LABEL, loadWalletLedger, money, type WalletLedgerRow } from "@/lib/corporate/wallet";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

interface Overview {
  balance_cents: number; held_cents: number;
  credit: { limit_cents: number; used_cents: number; available_cents: number; expiry_date: string } | null;
  arrangement: { mode: string; credit_period_days: number; status: string } | null;
  is_super_admin: boolean; can_manage: boolean;
}
interface CreditReq {
  id: string; requested_limit_cents: number; approved_limit_cents: number | null; credit_period_days: number;
  reason: string | null; status: string; created_at: string; decided_at: string | null; decision_note: string | null;
}

const ERR: Record<string, string> = {
  NOT_AUTHORISED: "Only company admins and managers can ask for credit.",
  INVALID_AMOUNT: "Enter a credit limit of at least KES 1,000.",
  REQUEST_ALREADY_PENDING: "A credit request is already waiting for a decision.",
  CREDIT_PERIOD_1_TO_3_DAYS: "Payment period must be 1 to 3 days.",
  ALREADY_DECIDED: "This request has already been decided.",
  INVALID_TERMS: "Check the limit, payment period and length.",
};

export default function FundingPortal({ corporateId }: { corporateId: string | null }) {
  const [ov, setOv] = React.useState<Overview | null>(null);
  const [reqs, setReqs] = React.useState<CreditReq[]>([]);
  const [ledger, setLedger] = React.useState<WalletLedgerRow[]>([]);
  const [limit, setLimit] = React.useState("");
  const [period, setPeriod] = React.useState("3");
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [months, setMonths] = React.useState("12");

  const load = React.useCallback(async () => {
    if (!corporateId) return;
    const [o, r, l] = await Promise.all([
      db.rpc("corporate_funding_overview", { _corporate_id: corporateId }),
      db.from("corporate_credit_requests").select("*").eq("corporate_id", corporateId).order("created_at", { ascending: false }).limit(50),
      loadWalletLedger(corporateId, 200).catch(() => []),
    ]);
    if (!o.error) setOv(o.data as Overview);
    setReqs((r.data ?? []) as CreditReq[]);
    setLedger(l as WalletLedgerRow[]);
  }, [corporateId]);
  React.useEffect(() => { load(); }, [load]);

  const requestCredit = async () => {
    setBusy(true);
    const { data, error } = await db.rpc("corporate_credit_request", {
      _corporate_id: corporateId, _limit_kes: Number(limit), _period_days: Number(period), _reason: reason,
    });
    setBusy(false);
    if (error || !data?.ok) return toast({ title: "Not sent", description: ERR[data?.error] ?? error?.message ?? data?.error, variant: "destructive" });
    toast({ title: "Credit request sent", description: "A TaxiD super admin will review it." });
    setLimit(""); setReason(""); load();
  };

  const decide = async (id: string, approve: boolean) => {
    setBusy(true);
    const { data, error } = await db.rpc("corporate_credit_decide", { _request_id: id, _approve: approve, _months: Number(months) });
    setBusy(false);
    if (error || !data?.ok) return toast({ title: "Not saved", description: ERR[data?.error] ?? error?.message ?? data?.error, variant: "destructive" });
    toast({ title: approve ? "Credit approved" : "Request declined" });
    load();
  };

  if (!corporateId) return null;
  const spendable = (ov?.balance_cents ?? 0) - (ov?.held_cents ?? 0) + (ov?.credit?.available_cents ?? 0);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Wallet balance" value={money(ov?.balance_cents ?? 0)} />
        <Stat label="Held for booked trips" value={money(ov?.held_cents ?? 0)} />
        <Stat label="Credit available" value={ov?.credit ? money(ov.credit.available_cents) : "No credit line"} />
        <Stat label="Available to book" value={money(Math.max(spendable, 0))} strong />
      </div>

      <AccountBalancePanel corporateId={corporateId} onSettled={load} />

      <Card>
        <CardHeader>
          <CardTitle>Credit line</CardTitle>
          <CardDescription>
            Trips beyond the wallet balance go on credit and are invoiced every {ov?.arrangement?.credit_period_days ?? "1–3"} day(s). Only a TaxiD super admin can approve credit.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {ov?.credit ? (
            <p className="text-sm">
              Limit <b>{money(ov.credit.limit_cents)}</b> · used {money(ov.credit.used_cents)} · valid until {ov.credit.expiry_date}
            </p>
          ) : <p className="text-sm text-muted-foreground">No active credit line.</p>}
          {ov?.can_manage && (
            <div className="grid gap-3 sm:grid-cols-3">
              <div><Label>Credit limit (KES)</Label><Input type="number" min={1000} value={limit} onChange={(e) => setLimit(e.target.value)} /></div>
              <div><Label>Pay within (days)</Label><Input type="number" min={1} max={3} value={period} onChange={(e) => setPeriod(e.target.value)} /></div>
              <div className="sm:col-span-3"><Label>Reason</Label><Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Monthly staff airport travel" /></div>
              <div><Button disabled={busy || !limit} onClick={requestCredit}>Request credit</Button></div>
            </div>
          )}
          {ov?.is_super_admin && (
            <div className="flex items-center gap-2 text-sm"><Label>Approve for (months)</Label><Input className="w-24" type="number" min={1} max={36} value={months} onChange={(e) => setMonths(e.target.value)} /></div>
          )}
          {reqs.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-muted-foreground"><th className="py-2">Asked</th><th>Limit</th><th>Days</th><th>Reason</th><th>Status</th><th /></tr></thead>
                <tbody>{reqs.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="py-2">{new Date(r.created_at).toLocaleDateString()}</td>
                    <td>{money(r.approved_limit_cents ?? r.requested_limit_cents)}</td>
                    <td>{r.credit_period_days}</td>
                    <td className="max-w-xs truncate">{r.reason}</td>
                    <td><Badge variant={r.status === "APPROVED" ? "default" : r.status === "DECLINED" ? "destructive" : "secondary"}>{r.status.toLowerCase()}</Badge></td>
                    <td className="space-x-2 text-right">{ov?.is_super_admin && r.status === "PENDING" && (<>
                      <Button size="sm" disabled={busy} onClick={() => decide(r.id, true)}>Approve</Button>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => decide(r.id, false)}>Decline</Button></>)}</td>
                  </tr>))}</tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Payment history</CardTitle><CardDescription>Every top-up, trip charge, refund and adjustment. Entries can't be edited.</CardDescription></CardHeader>
        <CardContent className="overflow-x-auto">
          {ledger.length === 0 ? <p className="text-sm text-muted-foreground">No payments yet.</p> : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-muted-foreground"><th className="py-2">Date</th><th>Type</th><th>Reference</th><th className="text-right">Amount</th><th className="text-right">Balance after</th></tr></thead>
              <tbody>{ledger.map((e) => (
                <tr key={e.id} className="border-t border-border">
                  <td className="py-2">{new Date(e.occurred_at).toLocaleString()}</td>
                  <td>{ENTRY_LABEL[e.entry_type] ?? e.entry_type}</td>
                  <td className="max-w-xs truncate">{e.reference ?? e.description}</td>
                  <td className="text-right">{money(e.amount_cents)}</td>
                  <td className="text-right">{money(e.balance_after_cents)}</td>
                </tr>))}</tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <Card><CardContent className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={strong ? "text-xl font-semibold text-primary" : "text-xl font-semibold"}>{value}</p>
    </CardContent></Card>
  );
}
