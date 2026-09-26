/**
 * SAFARID WALLET desk.
 *
 * Shows the four real balances of the platform account — cash held, client money
 * in custody, money owed to operators and SAFARID's earned income — with the
 * append-only movement history, plus funding through M-Pesa.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  fundPlatformWallet,
  loadPlatformWallet,
  walletMoney,
  WALLET_ENTRY_LABEL,
  YALLA_WALLET_FUNDING_MSISDN,
  type PlatformWalletEntry,
} from "@/lib/platform/wallet";
import type { CheckoutProgress } from "@/lib/payments/checkout";

function Balance({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="text-[11px] uppercase tracking-[0.14em]">{label}</CardDescription>
        <CardTitle className="text-xl">{value}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0 text-xs text-muted-foreground">{hint}</CardContent>
    </Card>
  );
}

export function YallaWalletPanel() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["platform-wallet"],
    queryFn: loadPlatformWallet,
  });

  const [amount, setAmount] = React.useState("");
  const [phone, setPhone] = React.useState(YALLA_WALLET_FUNDING_MSISDN);
  const [progress, setProgress] = React.useState<string | null>(null);

  const fund = useMutation({
    mutationFn: async () => {
      const amountKes = Number(amount);
      return fundPlatformWallet({ amountKes, phone }, (p: CheckoutProgress) => setProgress(p.message));
    },
    onSuccess: (res) => {
      setProgress(null);
      if (res.state === "funded") {
        toast({
          title: "SAFARID wallet funded",
          description: `${walletMoney(res.amountCents)} received${res.receipt ? ` · ${res.receipt}` : ""}.`,
        });
        setAmount("");
        void qc.invalidateQueries({ queryKey: ["platform-wallet"] });
      } else if (res.state === "already_funded") {
        toast({ title: "Already recorded", description: "That payment was credited earlier." });
      } else {
        toast({
          title: res.state === "pending" ? "Payment not confirmed yet" : "Funding failed",
          description: res.message,
          variant: res.state === "failed" ? "destructive" : undefined,
        });
      }
    },
    onError: (e: unknown) => {
      setProgress(null);
      toast({
        title: "Funding failed",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (error || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">SAFARID wallet</CardTitle>
          <CardDescription>
            {error instanceof Error ? error.message : "The wallet could not be loaded."}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const w = data.wallet;
  const cur = w.currency ?? "KES";

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Balance
          label="Cash in the wallet"
          value={walletMoney(w.float_cents, cur)}
          hint={`${walletMoney(w.lifetime_funded_cents, cur)} funded to date`}
        />
        <Balance
          label="Held until fulfilment"
          value={walletMoney(w.custody_cents, cur)}
          hint={`${data.pending_custody.length} paid job(s) awaiting fulfilment`}
        />
        <Balance
          label="Owed to operators"
          value={walletMoney(w.liability_cents, cur)}
          hint={`${walletMoney(w.lifetime_paid_out_cents, cur)} withdrawn to date`}
        />
        <Balance
          label="SAFARID income earned"
          value={walletMoney(w.income_cents, cur)}
          hint={`15% at fulfilment and 5% on successful withdrawals · paybill ${w.paybill}`}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Fund the wallet</CardTitle>
          <CardDescription>
            An M-Pesa prompt goes to the funding number. The wallet is credited only once
            Safaricom confirms the payment.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="w-40">
            <Label htmlFor="yw-amount">Amount (KSh)</Label>
            <Input
              id="yw-amount"
              type="number"
              min={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="10000"
            />
          </div>
          <div className="w-48">
            <Label htmlFor="yw-phone">Paying number</Label>
            <Input id="yw-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <Button
            onClick={() => fund.mutate()}
            disabled={fund.isPending || !amount || Number(amount) < 1}
          >
            {fund.isPending ? "Awaiting M-Pesa…" : "Send M-Pesa prompt"}
          </Button>
          {progress && <span className="text-xs text-muted-foreground">{progress}</span>}
        </CardContent>
      </Card>

      {data.pending_custody.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Paid, awaiting fulfilment</CardTitle>
            <CardDescription>
              These client funds stay in the SAFARID wallet. Nothing is released and no commission is
              taken until the job is fulfilled.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Booking</TableHead>
                  <TableHead className="text-right">Client paid</TableHead>
                  <TableHead className="text-right">Operator 85%</TableHead>
                  <TableHead className="text-right">SAFARID 15% (not yet taken)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.pending_custody.map((r) => (
                  <TableRow key={r.earning_id}>
                    <TableCell className="font-medium">{r.booking_reference ?? "—"}</TableCell>
                    <TableCell className="text-right">{walletMoney(r.gross_cents, cur)}</TableCell>
                    <TableCell className="text-right">{walletMoney(r.net_cents, cur)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {walletMoney(r.commission_cents, cur)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Movements</CardTitle>
          <CardDescription>Recorded permanently; nothing here can be edited or removed.</CardDescription>
        </CardHeader>
        <CardContent>
          {data.ledger.length === 0 ? (
            <p className="text-sm text-muted-foreground">No movements recorded yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Movement</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Held after</TableHead>
                  <TableHead className="text-right">Cash after</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.ledger.map((l: PlatformWalletEntry) => (
                  <TableRow key={l.id}>
                    <TableCell>
                      <Badge variant="secondary">{WALLET_ENTRY_LABEL[l.entry_type] ?? l.entry_type}</Badge>
                      <div className="mt-1 text-xs text-muted-foreground">{l.reference}</div>
                    </TableCell>
                    <TableCell className="text-right">{walletMoney(l.amount_cents, l.currency)}</TableCell>
                    <TableCell className="text-right">{walletMoney(l.custody_after, l.currency)}</TableCell>
                    <TableCell className="text-right">{walletMoney(l.float_after, l.currency)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(l.created_at).toLocaleString("en-KE")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default YallaWalletPanel;
