/**
 * ENTERPRISE ACCOUNT BALANCE PANEL
 *
 * Shows the funded balance from the append-only cash ledger and lets an
 * organisation admin add funds with a real M-Pesa prompt. The balance only
 * moves when M-Pesa confirms the payment.
 */
import * as React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { Wallet, Loader2 } from "lucide-react";
import {
  ENTRY_LABEL, loadWalletBalanceCents, loadWalletLedger, money, topUpByMpesa,
  type WalletLedgerRow,
} from "@/lib/corporate/wallet";

export default function AccountBalancePanel({
  corporateId,
  onSettled,
}: {
  corporateId: string | null;
  onSettled?: () => void;
}) {
  const [balance, setBalance] = React.useState<number | null>(null);
  const [ledger, setLedger] = React.useState<WalletLedgerRow[]>([]);
  const [open, setOpen] = React.useState(false);
  const [amount, setAmount] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [progress, setProgress] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    if (!corporateId) return;
    try {
      const [b, l] = await Promise.all([
        loadWalletBalanceCents(corporateId),
        loadWalletLedger(corporateId, 8),
      ]);
      setBalance(b);
      setLedger(l);
    } catch (e) {
      toast({
        title: "Could not load the account balance",
        description: (e as Error).message,
        variant: "destructive",
      });
    }
  }, [corporateId]);

  React.useEffect(() => { void refresh(); }, [refresh]);

  async function submit() {
    const kes = Number(amount);
    if (!Number.isFinite(kes) || kes < 1) {
      toast({ title: "Enter an amount", description: "Add the amount you want to pay in shillings.", variant: "destructive" });
      return;
    }
    setBusy(true);
    setProgress("Starting the M-Pesa payment…");
    try {
      const result = await topUpByMpesa(
        { amountKes: Math.round(kes), phone, reference: `CORP-TOPUP-${corporateId?.slice(0, 8).toUpperCase()}` },
        (p) => setProgress(p.message),
      );
      if (result.state === "credited") {
        toast({
          title: "Payment received",
          description: `${money(result.amountCents)} added${result.receipt ? ` — receipt ${result.receipt}` : ""}.`,
        });
        setOpen(false);
        setAmount("");
        await refresh();
        onSettled?.();
      } else if (result.state === "already_credited") {
        toast({ title: "Already added", description: "That payment was already credited to the account." });
        setOpen(false);
        await refresh();
      } else if (result.state === "pending") {
        toast({ title: "Payment still confirming", description: result.message });
      } else {
        toast({ title: "Payment not completed", description: result.message, variant: "destructive" });
      }
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  if (!corporateId) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Wallet className="h-4 w-4" />Account balance
          </CardTitle>
          <CardDescription>
            Funds collected by M-Pesa. Completed rides are charged against this balance and invoices settle from it.
          </CardDescription>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}>Add funds</Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-2xl font-semibold">
          {balance === null ? "—" : money(balance)}
          {balance !== null && balance < 0 && (
            <Badge variant="destructive" className="ml-2 align-middle text-xs">Amount owed</Badge>
          )}
        </p>
        {ledger.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground uppercase">
                <tr>
                  <th className="text-left py-1 pr-3">Date</th>
                  <th className="text-left py-1 pr-3">Movement</th>
                  <th className="text-left py-1 pr-3">Reference</th>
                  <th className="text-right py-1 pr-3">Amount</th>
                  <th className="text-right py-1">Balance</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((row) => (
                  <tr key={row.id} className="border-t border-border/50">
                    <td className="py-1 pr-3 whitespace-nowrap">
                      {new Date(row.occurred_at).toLocaleDateString("en-KE", { dateStyle: "medium" })}
                    </td>
                    <td className="py-1 pr-3">{ENTRY_LABEL[row.entry_type] ?? row.entry_type}</td>
                    <td className="py-1 pr-3 font-mono">{row.reference ?? "—"}</td>
                    <td className={`py-1 pr-3 text-right ${row.amount_cents < 0 ? "text-destructive" : ""}`}>
                      {money(row.amount_cents, row.currency)}
                    </td>
                    <td className="py-1 text-right">{money(row.balance_after_cents, row.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Add funds by M-Pesa</DialogTitle>
            <DialogDescription>
              We send a payment request to the phone number you enter. Approve it with your M-Pesa PIN and the balance
              updates as soon as M-Pesa confirms.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Amount (KSh)</Label>
              <Input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Paying phone number</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" />
            </div>
            {progress && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />{progress}
              </p>
            )}
            <p className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
              Prefer to pay from the bank or your own M-Pesa menu? Use Paybill <strong>4573823</strong> with account
              number <strong className="font-mono">CORP-TOPUP-{corporateId?.slice(0, 8).toUpperCase()}</strong>. The
              balance updates automatically once M-Pesa confirms the payment.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={submit} disabled={busy}>{busy ? "Waiting for M-Pesa…" : "Send payment request"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
