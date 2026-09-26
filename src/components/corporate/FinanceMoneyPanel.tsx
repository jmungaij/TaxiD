/**
 * MONEY, RECEIVABLES, RECEIPTS AND LEDGER (finance only).
 *
 * Every figure here is a stored record:
 *   • trip payment records with their state and reference,
 *   • receipts finance has actually recorded from the bank statement or PayBill,
 *   • reconciliation matches with any difference kept, and
 *   • the append-only double-entry ledger.
 * Confirming payment is a server decision (fin_reconcile_intent); this panel can
 * never mark a trip paid on its own, and a receipt below the trip amount leaves
 * the trip awaiting payment with the difference recorded.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, RefreshCw } from "lucide-react";
import {
  INTENT_STATE_LABEL,
  loadBankReceipts,
  loadLedger,
  loadPaymentChannels,
  loadPaymentIntents,
  loadReceivables,
  loadReconciliationMatches,
  money,
  recordBankReceipt,
  reconcileIntent,
  type BankReceiptRow,
  type LedgerEntryRow,
  type PaymentChannel,
  type PaymentIntentRow,
  type ReceivableRow,
} from "@/lib/corporate/payments";

export function FinanceMoneyPanel() {
  const [intents, setIntents] = useState<PaymentIntentRow[]>([]);
  const [receivables, setReceivables] = useState<ReceivableRow[]>([]);
  const [receipts, setReceipts] = useState<BankReceiptRow[]>([]);
  const [ledger, setLedger] = useState<LedgerEntryRow[]>([]);
  const [matches, setMatches] = useState<Record<string, unknown>[]>([]);
  const [channels, setChannels] = useState<PaymentChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [receiptForm, setReceiptForm] = useState({
    channel_id: "",
    external_reference: "",
    amount_kes: "",
    paid_at: "",
    payer_reference: "",
    statement_reference: "",
  });
  const [pair, setPair] = useState({ intent_id: "", receipt_id: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [i, r, b, l, m, c] = await Promise.all([
        loadPaymentIntents(undefined, 50),
        loadReceivables(),
        loadBankReceipts(),
        loadLedger(),
        loadReconciliationMatches(),
        loadPaymentChannels(),
      ]);
      setIntents(i);
      setReceivables(r);
      setReceipts(b);
      setLedger(l);
      setMatches(m as Record<string, unknown>[]);
      setChannels(c);
      setReceiptForm((f) => ({ ...f, channel_id: f.channel_id || (c[0]?.id ?? "") }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load the money records");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveReceipt = async () => {
    const amount = Number(receiptForm.amount_kes);
    if (!receiptForm.channel_id || !receiptForm.external_reference.trim() || !Number.isFinite(amount) || amount <= 0) {
      toast.error("Choose the account, and enter the receipt reference and the amount received.");
      return;
    }
    setBusy(true);
    const res = await recordBankReceipt({
      channelId: receiptForm.channel_id,
      externalReference: receiptForm.external_reference.trim(),
      amountCents: Math.round(amount * 100),
      paidAt: receiptForm.paid_at ? new Date(receiptForm.paid_at).toISOString() : new Date().toISOString(),
      payerReference: receiptForm.payer_reference || null,
      statementReference: receiptForm.statement_reference || null,
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error ?? "Refused");
      return;
    }
    toast.success("Receipt recorded. Match it to a trip to confirm the payment.");
    setReceiptForm((f) => ({ ...f, external_reference: "", amount_kes: "", statement_reference: "" }));
    void load();
  };

  const doReconcile = async () => {
    if (!pair.intent_id || !pair.receipt_id) {
      toast.error("Choose a trip payment and a recorded receipt.");
      return;
    }
    setBusy(true);
    const res = await reconcileIntent(pair.intent_id, pair.receipt_id, "reconciled in the finance console");
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error ?? "Refused");
      return;
    }
    toast.success(
      res.state === "MATCHED"
        ? `Matched exactly. Trip is now ${res.intent_state ? INTENT_STATE_LABEL[res.intent_state].toLowerCase() : "updated"}.`
        : `Recorded with a difference of ${money(Math.abs(res.variance_cents ?? 0))}.`,
    );
    void load();
  };

  const channelName = useMemo(
    () => (id: string) => channels.find((c) => c.id === id)?.display_name ?? "Account",
    [channels],
  );

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading money records…
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => void load()}>
          <RefreshCw className="mr-2 h-4 w-4" aria-hidden /> Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Trip payments</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {intents.length === 0 ? (
            <p className="text-muted-foreground">No trip payment records yet.</p>
          ) : (
            intents.map((i) => (
              <div key={i.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border p-3">
                <span className="font-mono text-xs">{i.reference}</span>
                <Badge variant={i.state === "AWAITING_PAYMENT" ? "secondary" : "default"}>
                  {INTENT_STATE_LABEL[i.state]}
                </Badge>
                <span>{money(i.amount_cents, i.currency)}</span>
                <span className="text-muted-foreground">
                  {i.mode === "CREDIT" ? "on credit" : "cash"}
                  {i.mpesa_receipt ? ` · receipt ${i.mpesa_receipt}` : ""}
                  {" · "}
                  {new Date(i.created_at).toLocaleString()}
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Record a receipt from the bank statement or PayBill</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Account it was received into</Label>
              <Select
                value={receiptForm.channel_id}
                onValueChange={(v) => setReceiptForm({ ...receiptForm, channel_id: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose an account" />
                </SelectTrigger>
                <SelectContent>
                  {channels.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rc-ref">Receipt / transaction reference</Label>
              <Input
                id="rc-ref"
                value={receiptForm.external_reference}
                onChange={(e) => setReceiptForm({ ...receiptForm, external_reference: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rc-amount">Amount received (KES)</Label>
              <Input
                id="rc-amount"
                inputMode="numeric"
                value={receiptForm.amount_kes}
                onChange={(e) => setReceiptForm({ ...receiptForm, amount_kes: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rc-paid">Received on</Label>
              <Input
                id="rc-paid"
                type="datetime-local"
                value={receiptForm.paid_at}
                onChange={(e) => setReceiptForm({ ...receiptForm, paid_at: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rc-payer">Paid by (as it appears)</Label>
              <Input
                id="rc-payer"
                value={receiptForm.payer_reference}
                onChange={(e) => setReceiptForm({ ...receiptForm, payer_reference: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rc-stmt">Statement reference</Label>
              <Input
                id="rc-stmt"
                value={receiptForm.statement_reference}
                onChange={(e) => setReceiptForm({ ...receiptForm, statement_reference: e.target.value })}
              />
            </div>
          </div>
          <Button onClick={() => void saveReceipt()} disabled={busy}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Record receipt
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Reconcile a trip against money actually received</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Trip payment</Label>
              <Select value={pair.intent_id} onValueChange={(v) => setPair({ ...pair, intent_id: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a trip payment" />
                </SelectTrigger>
                <SelectContent>
                  {intents.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.reference} · {money(i.amount_cents)} · {INTENT_STATE_LABEL[i.state]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Recorded receipt</Label>
              <Select value={pair.receipt_id} onValueChange={(v) => setPair({ ...pair, receipt_id: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a receipt" />
                </SelectTrigger>
                <SelectContent>
                  {receipts.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.external_reference} · {money(r.amount_cents)} · {channelName(r.channel_id)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button onClick={() => void doReconcile()} disabled={busy}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Reconcile
          </Button>
          {matches.length ? (
            <div className="space-y-2 pt-2 text-sm">
              {matches.map((m) => (
                <div key={String(m.id)} className="rounded-md border border-border p-3">
                  <Badge variant={m.state === "MATCHED" ? "default" : "secondary"}>{String(m.state)}</Badge>{" "}
                  {money(Number(m.matched_amount_cents))} · difference {money(Number(m.variance_cents))} ·{" "}
                  {new Date(String(m.created_at)).toLocaleString()}
                </div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Receivables</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {receivables.length === 0 ? (
            <p className="text-muted-foreground">No receivables raised.</p>
          ) : (
            receivables.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border p-3">
                <Badge variant="secondary">{r.state.toLowerCase()}</Badge>
                <span>{money(r.amount_cents, r.currency)}</span>
                <span className="text-muted-foreground">due {r.due_date}</span>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Financial ledger</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          {ledger.length === 0 ? (
            <p className="text-muted-foreground">No ledger entries yet.</p>
          ) : (
            ledger.map((l) => (
              <div key={l.id} className="flex flex-wrap items-center gap-2 border-b border-border/60 py-2">
                <span className="font-mono text-xs">{l.account_code}</span>
                <span className="min-w-40">{l.account_name}</span>
                <Badge variant="secondary">{l.kind.split("_").join(" ").toLowerCase()}</Badge>
                <span>
                  {l.debit_cents > 0 ? `Dr ${money(l.debit_cents, l.currency)}` : `Cr ${money(l.credit_cents, l.currency)}`}
                </span>
                <span className="text-muted-foreground">
                  {l.reference ?? ""} {l.memo ? `· ${l.memo}` : ""}
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
