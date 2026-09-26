/**
 * SAFARID PARTNERS 360 — wallet, margin and ledger drill-down.
 *
 * The wallet balance is never computed in the browser: it is read from
 * `partner_wallets`, which only the server-side money routines write. The
 * ledger below it is append-only, so what is listed is the audit record —
 * every row carries its running balance, memo and reference.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, Wallet } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { kes } from "@/lib/partners/api";
import { fetchLedger, fetchWallet, topUpWallet, type LedgerEntry } from "@/lib/partners/lifecycle";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

const KIND_LABEL = (kind: string) => kind.split("_").join(" ").toLowerCase();

export function PartnerWalletPanel({
  partnerId,
  marginPct,
  canTopUp = false,
}: {
  partnerId: string;
  marginPct: number;
  /** Finance-role surfaces only; the routine re-checks the role server-side. */
  canTopUp?: boolean;
}) {
  const qc = useQueryClient();
  const enabled = Boolean(partnerId);

  const wallet = useQuery({ queryKey: ["yp-wallet", partnerId], queryFn: () => fetchWallet(partnerId), enabled });
  const ledger = useQuery({ queryKey: ["yp-ledger", partnerId], queryFn: () => fetchLedger(partnerId, 200), enabled });

  const [form, setForm] = useState({ amount: 0, reference: "", memo: "" });

  const topUp = useMutation({
    mutationFn: () => topUpWallet(partnerId, Number(form.amount), form.reference.trim(), form.memo.trim() || undefined),
    onSuccess: () => {
      toast.success("Wallet funded and ledger entry recorded.");
      setForm({ amount: 0, reference: "", memo: "" });
      void qc.invalidateQueries({ queryKey: ["yp-wallet", partnerId] });
      void qc.invalidateQueries({ queryKey: ["yp-ledger", partnerId] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Top-up refused."),
  });

  const rows = ledger.data ?? [];
  const totals = useMemo(() => {
    let credits = 0;
    let debits = 0;
    let margin = 0;
    for (const r of rows) {
      const amt = Number(r.amount) || 0;
      if (r.direction === "CREDIT") credits += amt;
      else debits += amt;
      if (r.entry_kind.toUpperCase().includes("MARGIN")) margin += amt;
    }
    return { credits, debits, margin };
  }, [rows]);

  if (wallet.isLoading || ledger.isLoading) return <Skeleton className="h-64 w-full" />;

  const w = wallet.data;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Wallet balance"
          value={w ? kes(Number(w.balance)) : "No wallet"}
          hint={w ? `${w.currency} · ${w.is_prefunded ? "pre-funded model" : "credit model"}` : "Opened at promotion"}
        />
        <Stat label="Reserved / on hold" value={w ? kes(Number(w.reserved)) : "—"} hint="Committed to live orders" />
        <Stat label="Contracted margin" value={`${Number(marginPct)}%`} hint={`Earned to date ${kes(totals.margin)}`} />
        <Stat
          label="Credit limit"
          value={w ? kes(Number(w.credit_limit)) : "—"}
          hint={w ? `Low-balance alert at ${kes(Number(w.low_balance_threshold))}` : undefined}
        />
      </div>

      {canTopUp && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Record a wallet top-up</CardTitle></CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-4 sm:items-end">
            <div>
              <Label htmlFor="tu-amount">Amount (KES)</Label>
              <Input
                id="tu-amount" type="number" min={1} value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: Number(e.target.value) }))}
              />
            </div>
            <div>
              <Label htmlFor="tu-ref">Payment reference</Label>
              <Input
                id="tu-ref" value={form.reference}
                onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="tu-memo">Memo</Label>
              <Input
                id="tu-memo" value={form.memo}
                onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))}
              />
            </div>
            <Button
              onClick={() => topUp.mutate()}
              disabled={topUp.isPending || Number(form.amount) <= 0 || !form.reference.trim()}
            >
              <Wallet className="mr-1.5 h-4 w-4" aria-hidden /> Fund wallet
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Ledger history</CardTitle>
          <p className="text-xs text-muted-foreground">
            Append-only. {rows.length} entry(ies) · credits {kes(totals.credits)} · debits {kes(totals.debits)}
          </p>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No money has moved on this partner account.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Partner wallet ledger</caption>
                <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th scope="col" className="py-2 pr-4">When</th>
                    <th scope="col" className="py-2 pr-4">Entry</th>
                    <th scope="col" className="py-2 pr-4">Reference</th>
                    <th scope="col" className="py-2 pr-4 text-right">Amount</th>
                    <th scope="col" className="py-2 text-right">Balance after</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r: LedgerEntry) => (
                    <tr key={r.id}>
                      <td className="py-2 pr-4 text-xs text-muted-foreground">
                        {new Date(r.created_at).toLocaleString()}
                      </td>
                      <td className="py-2 pr-4">
                        <span className="flex items-center gap-1.5">
                          {r.direction === "CREDIT" ? (
                            <ArrowUpRight className="h-3.5 w-3.5 text-success" aria-hidden />
                          ) : (
                            <ArrowDownRight className="h-3.5 w-3.5 text-destructive" aria-hidden />
                          )}
                          <span className="capitalize">{KIND_LABEL(r.entry_kind)}</span>
                        </span>
                        {r.memo && <span className="block text-xs text-muted-foreground">{r.memo}</span>}
                      </td>
                      <td className="py-2 pr-4 font-mono text-xs text-muted-foreground">
                        {r.reference ?? (r.order_id ? `order ${r.order_id.slice(0, 8)}…` : "—")}
                      </td>
                      <td className={`py-2 pr-4 text-right tabular-nums ${r.direction === "CREDIT" ? "text-success" : "text-destructive"}`}>
                        {r.direction === "CREDIT" ? "+" : "−"}{kes(Number(r.amount))}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {r.balance_after === null ? "—" : kes(Number(r.balance_after))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {w && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline" className="text-[10px] uppercase">Source of truth</Badge>
          partner_wallets · last movement {new Date(w.updated_at).toLocaleString()}
        </p>
      )}
    </div>
  );
}

export default PartnerWalletPanel;
