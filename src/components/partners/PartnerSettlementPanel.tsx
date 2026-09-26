/**
 * SAFARID PARTNERS 360 — settlement drill-down.
 *
 * Settlement status, the variance between what SAFARID approved and what was
 * actually paid, and the linked reconciliation audit trail (staff cases and
 * their append-only event log). Approval and reconciliation are server
 * routines — the browser only submits the paid amount and reference.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ClipboardCheck, Scale } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { kes } from "@/lib/partners/api";
import {
  SETTLEMENT_LABEL, approveSettlement, fetchCaseEvents, fetchCases, fetchSettlementLines,
  fetchSettlements, reconcileSettlement, type Settlement, type SettlementState,
} from "@/lib/partners/lifecycle";

const STATE_TONE: Record<SettlementState, string> = {
  open: "border-muted-foreground/40 text-muted-foreground",
  pending_review: "border-info/50 text-info",
  approved: "border-primary/50 text-primary",
  paid: "border-info/50 text-info",
  reconciled: "border-success/50 text-success",
  disputed: "border-destructive/50 text-destructive",
};

function variance(s: Settlement): number | null {
  if (s.variance_amount !== null && s.variance_amount !== undefined) return Number(s.variance_amount);
  if (s.paid_amount === null || s.paid_amount === undefined) return null;
  return Number(s.paid_amount) - Number(s.payout_amount);
}

export function PartnerSettlementPanel({
  partnerId,
  canAct = false,
}: {
  partnerId: string;
  /** Finance surfaces; the routines re-check the caller's role server-side. */
  canAct?: boolean;
}) {
  const qc = useQueryClient();
  const enabled = Boolean(partnerId);

  const settlements = useQuery({
    queryKey: ["yp-settlements", partnerId],
    queryFn: () => fetchSettlements(partnerId),
    enabled,
  });
  const cases = useQuery({
    queryKey: ["yp-settlement-cases", partnerId],
    queryFn: () => fetchCases({ partnerId, openOnly: false, limit: 300 }),
    enabled,
  });

  const [openId, setOpenId] = useState<string>("");
  const [pay, setPay] = useState({ amount: 0, reference: "", note: "" });

  const lines = useQuery({
    queryKey: ["yp-settlement-lines", openId],
    queryFn: () => fetchSettlementLines(openId),
    enabled: Boolean(openId),
  });

  const linkedCases = useMemo(
    () => (cases.data ?? []).filter((c) => c.settlement_id === openId),
    [cases.data, openId],
  );

  const events = useQuery({
    queryKey: ["yp-settlement-events", openId, linkedCases.map((c) => c.id).join(",")],
    queryFn: async () => {
      const all = await Promise.all(linkedCases.map((c) => fetchCaseEvents(c.id)));
      return all.flat().sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    },
    enabled: Boolean(openId) && linkedCases.length > 0,
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["yp-settlements", partnerId] });
    void qc.invalidateQueries({ queryKey: ["yp-settlement-cases", partnerId] });
    void qc.invalidateQueries({ queryKey: ["yp-ledger", partnerId] });
  };

  const approve = useMutation({
    mutationFn: (id: string) => approveSettlement(id),
    onSuccess: () => { toast.success("Settlement approved for payment."); refresh(); },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Approval refused."),
  });

  const reconcile = useMutation({
    mutationFn: (id: string) => reconcileSettlement(id, Number(pay.amount), pay.reference.trim(), pay.note.trim() || undefined),
    onSuccess: () => {
      toast.success("Payment reconciled against the settlement.");
      setPay({ amount: 0, reference: "", note: "" });
      refresh();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Reconciliation refused."),
  });

  if (settlements.isLoading) return <Skeleton className="h-64 w-full" />;

  const rows = settlements.data ?? [];
  const selected = rows.find((s) => s.id === openId) ?? null;
  const unsettled = rows
    .filter((s) => s.status !== "reconciled")
    .reduce((t, s) => t + Number(s.payout_amount), 0);
  const varianceRows = rows.filter((s) => variance(s) !== null && variance(s) !== 0);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-border/60 bg-card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Settlements</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{rows.length}</p>
        </div>
        <div className="rounded-xl border border-border/60 bg-card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Unsettled payout</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{kes(unsettled)}</p>
        </div>
        <div className="rounded-xl border border-border/60 bg-card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Variances recorded</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{varianceRows.length}</p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Settlement register</CardTitle></CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No settlement has been generated for this partner yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Partner settlements</caption>
                <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th scope="col" className="py-2 pr-4">Settlement</th>
                    <th scope="col" className="py-2 pr-4">Period</th>
                    <th scope="col" className="py-2 pr-4">Status</th>
                    <th scope="col" className="py-2 pr-4 text-right">Payout</th>
                    <th scope="col" className="py-2 pr-4 text-right">Paid</th>
                    <th scope="col" className="py-2 pr-4 text-right">Variance</th>
                    <th scope="col" className="py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((s) => {
                    const v = variance(s);
                    return (
                      <tr key={s.id}>
                        <td className="py-2 pr-4 font-mono text-xs">{s.settlement_code}</td>
                        <td className="py-2 pr-4 text-xs text-muted-foreground">
                          {s.period_start} → {s.period_end}
                        </td>
                        <td className="py-2 pr-4">
                          <Badge variant="outline" className={`text-[10px] uppercase ${STATE_TONE[s.status]}`}>
                            {SETTLEMENT_LABEL[s.status]}
                          </Badge>
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums">{kes(Number(s.payout_amount))}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">
                          {s.paid_amount === null ? "—" : kes(Number(s.paid_amount))}
                        </td>
                        <td className={`py-2 pr-4 text-right tabular-nums ${v ? "text-destructive" : "text-muted-foreground"}`}>
                          {v === null ? "—" : kes(v)}
                        </td>
                        <td className="py-2 text-right">
                          <Button
                            size="sm"
                            variant={openId === s.id ? "secondary" : "outline"}
                            onClick={() => setOpenId(openId === s.id ? "" : s.id)}
                            aria-expanded={openId === s.id}
                          >
                            {openId === s.id ? "Hide" : "Drill down"}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {varianceRows.length > 0 && (
        <Card className="border-warning/40">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Variance history</CardTitle>
            <p className="text-xs text-muted-foreground">Difference between approved payout and the amount actually paid.</p>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border text-sm">
              {varianceRows.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div>
                    <p className="font-mono text-xs">{s.settlement_code}</p>
                    <p className="text-xs text-muted-foreground">
                      {SETTLEMENT_LABEL[s.status]}
                      {s.payment_reference ? ` · ref ${s.payment_reference}` : ""}
                      {s.reconciled_at ? ` · reconciled ${new Date(s.reconciled_at).toLocaleDateString()}` : ""}
                    </p>
                  </div>
                  <span className="tabular-nums text-destructive">{kes(variance(s) ?? 0)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {selected && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              <span className="font-mono">{selected.settlement_code}</span> — reconciliation detail
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <dl className="grid gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
              <div><dt className="text-muted-foreground">Orders</dt><dd className="font-medium tabular-nums">{selected.orders_count}</dd></div>
              <div><dt className="text-muted-foreground">Gross value</dt><dd className="font-medium tabular-nums">{kes(Number(selected.gross_value))}</dd></div>
              <div><dt className="text-muted-foreground">Supplier cost</dt><dd className="font-medium tabular-nums">{kes(Number(selected.supplier_cost))}</dd></div>
              <div><dt className="text-muted-foreground">SAFARID margin</dt><dd className="font-medium tabular-nums">{kes(Number(selected.yalla_margin))}</dd></div>
              <div><dt className="text-muted-foreground">Partner margin</dt><dd className="font-medium tabular-nums">{kes(Number(selected.partner_margin))}</dd></div>
              <div><dt className="text-muted-foreground">Taxes</dt><dd className="font-medium tabular-nums">{kes(Number(selected.taxes))}</dd></div>
            </dl>

            {canAct && (
              <div className="space-y-3 rounded-xl border border-border bg-muted/30 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Finance actions</p>
                {selected.status === "open" || selected.status === "pending_review" ? (
                  <Button size="sm" onClick={() => approve.mutate(selected.id)} disabled={approve.isPending}>
                    <CheckCircle2 className="mr-1.5 h-4 w-4" aria-hidden /> Approve for payment
                  </Button>
                ) : selected.status === "reconciled" ? (
                  <p className="text-sm text-muted-foreground">
                    Closed — reconciled {selected.reconciled_at ? new Date(selected.reconciled_at).toLocaleString() : ""}.
                  </p>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-4 sm:items-end">
                    <div>
                      <Label htmlFor="rec-amount">Amount paid (KES)</Label>
                      <Input
                        id="rec-amount" type="number" min={0} value={pay.amount}
                        onChange={(e) => setPay((p) => ({ ...p, amount: Number(e.target.value) }))}
                      />
                    </div>
                    <div>
                      <Label htmlFor="rec-ref">Payment reference</Label>
                      <Input
                        id="rec-ref" value={pay.reference}
                        onChange={(e) => setPay((p) => ({ ...p, reference: e.target.value }))}
                      />
                    </div>
                    <div>
                      <Label htmlFor="rec-note">Note</Label>
                      <Input
                        id="rec-note" value={pay.note}
                        onChange={(e) => setPay((p) => ({ ...p, note: e.target.value }))}
                      />
                    </div>
                    <Button
                      onClick={() => reconcile.mutate(selected.id)}
                      disabled={reconcile.isPending || Number(pay.amount) <= 0 || !pay.reference.trim()}
                    >
                      <Scale className="mr-1.5 h-4 w-4" aria-hidden /> Reconcile
                    </Button>
                  </div>
                )}
              </div>
            )}

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Settled orders</p>
              {lines.isLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : (lines.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No order lines are attached to this settlement.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <caption className="sr-only">Settlement order lines</caption>
                    <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th scope="col" className="py-2 pr-4">Order</th>
                        <th scope="col" className="py-2 pr-4 text-right">Customer price</th>
                        <th scope="col" className="py-2 pr-4 text-right">Supplier cost</th>
                        <th scope="col" className="py-2 pr-4 text-right">SAFARID margin</th>
                        <th scope="col" className="py-2 text-right">Partner margin</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {(lines.data ?? []).map((l) => (
                        <tr key={l.id}>
                          <td className="py-2 pr-4 font-mono text-xs">{l.order_id.slice(0, 8)}…</td>
                          <td className="py-2 pr-4 text-right tabular-nums">{kes(Number(l.customer_price))}</td>
                          <td className="py-2 pr-4 text-right tabular-nums">{kes(Number(l.supplier_cost))}</td>
                          <td className="py-2 pr-4 text-right tabular-nums">{kes(Number(l.yalla_margin))}</td>
                          <td className="py-2 text-right tabular-nums">{kes(Number(l.partner_margin))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div>
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <ClipboardCheck className="h-3.5 w-3.5" aria-hidden /> Linked reconciliation audit
              </p>
              {linkedCases.length === 0 ? (
                <p className="text-sm text-muted-foreground">No reconciliation case has been raised on this settlement.</p>
              ) : (
                <div className="space-y-4">
                  {linkedCases.map((c) => (
                    <div key={c.id} className="rounded-lg border border-border/60 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium">{c.title}</p>
                        <div className="flex gap-2">
                          <Badge variant="outline" className="text-[10px] uppercase">{c.queue}</Badge>
                          <Badge variant="outline" className="text-[10px] uppercase">{c.state.split("_").join(" ")}</Badge>
                        </div>
                      </div>
                      <p className="mt-1 font-mono text-xs text-muted-foreground">{c.work_code}</p>
                    </div>
                  ))}
                  <ol className="space-y-3">
                    {(events.data ?? []).map((e) => (
                      <li key={e.id} className="border-l-2 border-border pl-4 text-sm">
                        <p className="font-medium capitalize">{e.action.split("_").join(" ")}</p>
                        {e.note && <p className="text-xs text-muted-foreground">{e.note}</p>}
                        <p className="text-xs text-muted-foreground">{new Date(e.created_at).toLocaleString()}</p>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default PartnerSettlementPanel;
