/**
 * FINANCE PAYOUT DESK.
 *
 * Verifies each operator's M-Pesa number and approves withdrawals that operators
 * raise against their OWN wallet balance. Money leaves over the dedicated M-Pesa
 * payouts short code, never the collections paybill; TaxiD's 15% commission and
 * the 5% withdrawal fee are income and are never disbursed.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { Banknote, RefreshCw } from "lucide-react";
import {
  ACCOUNT_STATE_LABEL,
  decidePayoutAccount,
  loadProviderSettlementConsole,
  preparePayouts,
  settlementMoney,
  syncEarnings,
} from "@/lib/provider/settlement";
import ProviderWithdrawalApprovalPanel from "@/components/staff/ProviderWithdrawalApprovalPanel";

export default function ProviderPayoutDesk() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["provider-settlement-console"],
    queryFn: loadProviderSettlementConsole,
  });
  const [notes, setNotes] = React.useState<Record<string, string>>({});
  const refresh = () => qc.invalidateQueries({ queryKey: ["provider-settlement-console"] });

  const cycle = useMutation({
    mutationFn: async () => {
      const s = await syncEarnings();
      const p = await preparePayouts();
      return { s, p };
    },
    onSuccess: ({ s }) => {
      toast({
        title: "Settlement run complete",
        description: `${s.held} job(s) held on client payment · ${s.credited} released to operator wallets on fulfilment.`,
      });
      refresh();
    },
    onError: (e: Error) => toast({ title: "Run failed", description: e.message, variant: "destructive" }),
  });

  const account = useMutation({
    mutationFn: ({ id, state }: { id: string; state: "VERIFIED" | "REJECTED" }) =>
      decidePayoutAccount(id, state, notes[id]),
    onSuccess: () => {
      toast({ title: "M-Pesa number updated" });
      refresh();
    },
    onError: (e: Error) => toast({ title: "Not updated", description: e.message, variant: "destructive" }),
  });



  if (isLoading) return <Skeleton className="h-72 w-full" />;
  if (error) return <p className="text-sm text-destructive">{(error as Error).message}</p>;

  const s = data?.summary;
  const rate = ((data?.settings.commission_bps ?? 1500) / 100).toFixed(0);
  const fee = ((data?.settings.withdrawal_fee_bps ?? 500) / 100).toFixed(0);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Banknote className="h-4 w-4" />Operator payouts
            </CardTitle>
            <CardDescription>
              A client's payment holds {100 - Number(rate)}% in the operator's own wallet; once the trip is
              fulfilled that amount becomes withdrawable and TaxiD's {rate}% is recognised as income into
              paybill {data?.settings.platform_paybill}. Operators withdraw strictly against their own wallet
              balance — the collections paybill is never a balance they draw on — and a {fee}% withdrawal fee
              is retained. Smallest payout {settlementMoney(data?.settings.min_payout_cents ?? 1000)}.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => cycle.mutate()} disabled={cycle.isPending}>
            <RefreshCw className="mr-2 h-4 w-4" />
            {cycle.isPending ? "Running…" : "Run settlement now"}
          </Button>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {[
            { label: `TaxiD ${rate}% commission`, value: s?.commission_cents ?? 0 },
            { label: `Withdrawal fees (${fee}%)`, value: s?.withdrawal_fee_cents ?? 0 },
            { label: "Awaiting customer payment", value: s?.accrued_cents ?? 0 },
            { label: "Held until fulfilment", value: s?.held_cents ?? 0 },
            { label: "Operator wallet balances", value: s?.payable_cents ?? 0 },
            { label: "In a withdrawal", value: s?.reserved_cents ?? 0 },
            { label: "Withdrawn to operators", value: s?.paid_cents ?? 0 },
          ].map((k) => (
            <div key={k.label} className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">{k.label}</p>
              <p className="text-lg font-semibold">{settlementMoney(k.value)}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            M-Pesa numbers to verify ({s?.accounts_in_review ?? 0})
          </CardTitle>
          <CardDescription>Confirm the number against the operator's documents before any money moves.</CardDescription>
        </CardHeader>
        <CardContent>
          {(data?.accounts ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No operator has saved an M-Pesa number yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Registered name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead className="text-right">Decision</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.accounts ?? []).map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-mono text-xs">{a.msisdn}</TableCell>
                    <TableCell className="text-sm">{a.account_name}</TableCell>
                    <TableCell>
                      <Badge variant={a.verification_state === "VERIFIED" ? "default" : "outline"}>
                        {ACCOUNT_STATE_LABEL[a.verification_state]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Input
                        placeholder="Optional note"
                        value={notes[a.id] ?? ""}
                        onChange={(e) => setNotes((n) => ({ ...n, [a.id]: e.target.value }))}
                      />
                    </TableCell>
                    <TableCell className="space-x-2 text-right">
                      <Button
                        size="sm"
                        disabled={account.isPending || a.verification_state === "VERIFIED"}
                        onClick={() => account.mutate({ id: a.id, state: "VERIFIED" })}
                      >
                        Verify
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={account.isPending}
                        onClick={() => account.mutate({ id: a.id, state: "REJECTED" })}
                      >
                        Reject
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ProviderWithdrawalApprovalPanel />

    </div>
  );
}
