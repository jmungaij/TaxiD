/**
 * OPERATOR WALLET, M-PESA ACCOUNT AND WITHDRAWALS.
 *
 * Policy shown here, exactly as the database enforces it:
 *   client pays in full   -> the operator's 85% is HELD in this wallet
 *   trip fulfilled        -> the 85% is released and becomes withdrawable,
 *                            and SAFARID's 15% is posted to the SAFARID paybill
 *   operator withdraws    -> the amount is taken from THIS wallet balance only,
 *                            a 5% withdrawal fee is retained by SAFARID and the
 *                            remainder is sent to their M-Pesa number over the
 *                            dedicated payouts short code (never the paybill)
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
import { toast } from "@/hooks/use-toast";
import { ArrowUpRight, Lock, Smartphone, ShieldCheck, Wallet } from "lucide-react";
import {
  ACCOUNT_STATE_LABEL,
  EARNING_STATE_LABEL,
  PAYOUT_STATE_LABEL,
  WALLET_ENTRY_LABEL,
  loadProviderSettlementSelf,
  requestWithdrawal,
  savePayoutAccount,
  settlementMoney,
} from "@/lib/provider/settlement";

export default function ProviderPayoutAccount() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["provider-settlement-self"],
    queryFn: loadProviderSettlementSelf,
  });

  const [msisdn, setMsisdn] = React.useState("");
  const [name, setName] = React.useState("");
  const [amount, setAmount] = React.useState("");

  React.useEffect(() => {
    if (data?.account) {
      setMsisdn(data.account.msisdn);
      setName(data.account.account_name);
    }
  }, [data?.account]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["provider-settlement-self"] });

  const save = useMutation({
    mutationFn: () => savePayoutAccount(msisdn, name),
    onSuccess: () => {
      toast({
        title: "M-Pesa number saved",
        description: "Our team will verify it before your first withdrawal is sent.",
      });
      refresh();
    },
    onError: (e: Error) => toast({ title: "Not saved", description: e.message, variant: "destructive" }),
  });

  const withdraw = useMutation({
    mutationFn: () => requestWithdrawal(Math.round(Number(amount) * 100)),
    onSuccess: (r) => {
      toast({
        title: "Withdrawal requested",
        description: `${settlementMoney(r.gross_cents)} from your balance · fee ${settlementMoney(
          r.fee_cents,
        )} · ${settlementMoney(r.net_cents)} to ${r.msisdn} once approved.`,
      });
      setAmount("");
      refresh();
    },
    onError: (e: Error) =>
      toast({ title: "Withdrawal not requested", description: e.message, variant: "destructive" }),
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  const w = data?.wallet;
  const account = data?.account ?? null;
  const verified = account?.verification_state === "VERIFIED";
  const commission = ((data?.commission_bps ?? 1500) / 100).toFixed(0);
  const feeRate = ((data?.withdrawal_fee_bps ?? 500) / 100).toFixed(0);
  const share = 100 - Number(commission);

  const requested = Math.round((Number(amount) || 0) * 100);
  const feePreview = Math.round((requested * (data?.withdrawal_fee_bps ?? 500)) / 10000);
  const netPreview = requested - feePreview;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Wallet className="h-4 w-4" />Your wallet
          </CardTitle>
          <CardDescription>
            When a client pays in full, your {share}% appears here as held. It becomes withdrawable as soon
            as the trip is fulfilled — that is also when SAFARID's {commission}% goes to the SAFARID paybill.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-4">
          <div className="rounded-lg border p-3">
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Lock className="h-3 w-3" />Held until fulfilment
            </p>
            <p className="text-lg font-semibold">{settlementMoney(w?.held_cents ?? 0)}</p>
          </div>
          <div className="rounded-lg border border-primary/30 p-3">
            <p className="text-xs text-muted-foreground">Available to withdraw</p>
            <p className="text-lg font-semibold text-primary">
              {settlementMoney(w?.available_cents ?? 0)}
            </p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">In a withdrawal</p>
            <p className="text-lg font-semibold">{settlementMoney(w?.reserved_cents ?? 0)}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Withdrawn to M-Pesa</p>
            <p className="text-lg font-semibold">{settlementMoney(w?.lifetime_withdrawn_cents ?? 0)}</p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Smartphone className="h-4 w-4" />Your M-Pesa number
            </CardTitle>
            <CardDescription>Withdrawals are only ever sent to this verified number.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="payout-msisdn">M-Pesa phone number</Label>
              <Input
                id="payout-msisdn"
                inputMode="tel"
                placeholder="0712 345 678"
                value={msisdn}
                onChange={(e) => setMsisdn(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="payout-name">Name registered on the number</Label>
              <Input
                id="payout-name"
                placeholder="As it appears on M-Pesa"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => save.mutate()} disabled={save.isPending || !msisdn || !name}>
                {save.isPending ? "Saving…" : account ? "Update number" : "Save number"}
              </Button>
              {account && (
                <Badge variant={verified ? "default" : "outline"} className="gap-1">
                  <ShieldCheck className="h-3 w-3" />
                  {ACCOUNT_STATE_LABEL[account.verification_state]}
                </Badge>
              )}
            </div>
            {account?.verification_note && (
              <p className="text-xs text-muted-foreground">Note from our team: {account.verification_note}</p>
            )}
            {!verified && (
              <p className="text-xs text-muted-foreground">
                No money is sent until this number is verified against your documents.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ArrowUpRight className="h-4 w-4" />Withdraw to M-Pesa
            </CardTitle>
            <CardDescription>
              Withdrawals come out of your own wallet balance above — never out of SAFARID's collections
              paybill. A {feeRate}% withdrawal fee is deducted and kept by SAFARID. Smallest amount that can
              reach M-Pesa: {settlementMoney(data?.min_payout_cents ?? 1000)}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="wd-amount">Amount to take from your balance (KSh)</Label>
              <Input
                id="wd-amount"
                type="number"
                min={0}
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={!verified}
              />
            </div>
            {requested > 0 && (
              <div className="space-y-1 rounded-lg bg-muted/50 p-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">From your balance</span>
                  <span>{settlementMoney(requested)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Withdrawal fee ({feeRate}%)</span>
                  <span>− {settlementMoney(feePreview)}</span>
                </div>
                <div className="flex justify-between font-semibold">
                  <span>You receive on M-Pesa</span>
                  <span>{settlementMoney(netPreview)}</span>
                </div>
              </div>
            )}
            <Button
              className="w-full"
              onClick={() => withdraw.mutate()}
              disabled={withdraw.isPending || !verified || requested <= 0}
            >
              {withdraw.isPending ? "Requesting…" : "Request withdrawal"}
            </Button>
            {!verified ? (
              <p className="text-xs text-muted-foreground">
                Save and verify your M-Pesa number first.
              </p>
            ) : (
              data?.requires_finance_approval && (
                <p className="text-xs text-muted-foreground">
                  Our finance team approves each withdrawal before it is sent.
                </p>
              )
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Withdrawals</CardTitle>
          <CardDescription>
            A withdrawal is only marked paid once Safaricom confirms it; if it fails the full amount returns
            to your balance.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {(data?.payouts ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No withdrawals yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reference</TableHead>
                  <TableHead>To</TableHead>
                  <TableHead className="text-right">From balance</TableHead>
                  <TableHead className="text-right">Fee</TableHead>
                  <TableHead className="text-right">Received</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>M-Pesa code</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.payouts ?? []).map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs">{p.reference}</TableCell>
                    <TableCell className="text-xs">{p.msisdn}</TableCell>
                    <TableCell className="text-right">
                      {settlementMoney(p.gross_cents ?? p.amount_cents, p.currency)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {settlementMoney(p.fee_cents ?? 0, p.currency)}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {settlementMoney(p.amount_cents, p.currency)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={p.state === "PAID" ? "default" : "outline"}>
                        {PAYOUT_STATE_LABEL[p.state]}
                      </Badge>
                      {p.failure_reason && (
                        <p className="mt-1 text-xs text-destructive">{p.failure_reason}</p>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{p.provider_transaction_id ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Earnings by job</CardTitle>
          <CardDescription>
            Gross is the rate agreed on the booking; commission is SAFARID's {commission}% share.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {(data?.earnings ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Earnings appear here once a booking is confirmed and priced.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Booking</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">SAFARID {commission}%</TableHead>
                  <TableHead className="text-right">Your {share}%</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.earnings ?? []).map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="font-mono text-xs">{e.booking_reference}</TableCell>
                    <TableCell className="text-right">{settlementMoney(e.gross_cents, e.currency)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {settlementMoney(e.commission_cents, e.currency)}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {settlementMoney(e.net_cents, e.currency)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={e.state === "CREDITED" ? "default" : "outline"}>
                        {EARNING_STATE_LABEL[e.state]}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Wallet movements</CardTitle>
          <CardDescription>Every change to your balance, in order.</CardDescription>
        </CardHeader>
        <CardContent>
          {(data?.wallet_ledger ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No wallet movements yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Movement</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Available after</TableHead>
                  <TableHead className="text-right">Held after</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.wallet_ledger ?? []).map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(l.created_at).toLocaleString("en-KE")}
                    </TableCell>
                    <TableCell className="text-sm">{WALLET_ENTRY_LABEL[l.entry_type]}</TableCell>
                    <TableCell className="text-right">{settlementMoney(l.amount_cents, l.currency)}</TableCell>
                    <TableCell className="text-right">{settlementMoney(l.available_after, l.currency)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {settlementMoney(l.held_after, l.currency)}
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
