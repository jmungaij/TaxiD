/**
 * OPERATOR STATEMENTS — provider portal.
 * Open a period, see every trip with TaxiD's 15%, your 85% and the 5% fee that
 * applies when you withdraw, then submit it for payment. Amounts come from the
 * platform's own trip records, so nothing here can be typed over.
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
import {
  INVOICE_STATE_LABEL,
  defaultPeriod,
  loadMyInvoices,
  money,
  periodLabel,
  prepareInvoice,
  submitInvoice,
} from "@/lib/provider/invoices";

export default function ProviderInvoices() {
  const qc = useQueryClient();
  const period = defaultPeriod();
  const [from, setFrom] = React.useState(period.start);
  const [to, setTo] = React.useState(period.end);
  const [openId, setOpenId] = React.useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["provider-invoices-self"],
    queryFn: loadMyInvoices,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["provider-invoices-self"] });

  const build = useMutation({
    mutationFn: () => prepareInvoice(from, to),
    onSuccess: (r) => {
      toast({
        title: r.lines > 0 ? `Statement built with ${r.lines} trip(s)` : "No trips in that period",
        description:
          r.lines > 0 ? "Check it, then submit it for payment." : "Nothing was found to invoice for those dates.",
      });
      refresh();
    },
    onError: (e: Error) => toast({ title: "Not built", description: e.message, variant: "destructive" }),
  });

  const submit = useMutation({
    mutationFn: (id: string) => submitInvoice(id),
    onSuccess: (r) => {
      toast({ title: `Submitted as ${r.invoice_number}`, description: "Finance will review it." });
      refresh();
    },
    onError: (e: Error) => toast({ title: "Not submitted", description: e.message, variant: "destructive" }),
  });

  if (isLoading) return <Skeleton className="h-72 w-full" />;
  if (error) return <p className="text-sm text-destructive">{(error as Error).message}</p>;

  const u = data?.uninvoiced;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invoice your completed trips</CardTitle>
          <CardDescription>
            {data?.require_invoice_approval
              ? "Finance approves your statement before the money can be withdrawn, so submit each period as it closes."
              : "Submit a statement for each period so your payments are documented."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Trips not yet invoiced</p>
              <p className="text-lg font-semibold">{u?.trips ?? 0}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Their value</p>
              <p className="text-lg font-semibold">{money(u?.gross_cents ?? 0)}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Your 85% of that</p>
              <p className="text-lg font-semibold">{money(u?.net_cents ?? 0)}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="inv-from">From</Label>
              <Input id="inv-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="inv-to">To</Label>
              <Input id="inv-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <Button disabled={build.isPending} onClick={() => build.mutate()}>
              {build.isPending ? "Building…" : "Build statement"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your statements</CardTitle>
          <CardDescription>Draft statements can be rebuilt; submitted ones are locked.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {(data?.invoices ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              You have not built a statement yet. Choose a period above to start one.
            </p>
          ) : (
            (data?.invoices ?? []).map((i) => (
              <div key={i.id} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-xs text-muted-foreground">
                      {i.invoice_number ?? "draft"}
                    </p>
                    <p className="text-sm font-semibold">{money(i.net_cents, i.currency)} payable to you</p>
                    <p className="text-xs text-muted-foreground">
                      {periodLabel(i)} · {i.lines_count} trip(s) · {money(i.gross_cents, i.currency)} trip
                      value · {money(i.commission_cents, i.currency)} TaxiD{" "}
                      {(i.commission_bps / 100).toFixed(0)}% ·{" "}
                      {money(i.estimated_fee_cents, i.currency)} withdrawal fee at{" "}
                      {(i.withdrawal_fee_bps / 100).toFixed(0)}%
                    </p>
                  </div>
                  <Badge variant={i.state === "APPROVED" ? "default" : i.state === "QUERIED" ? "destructive" : "outline"}>
                    {INVOICE_STATE_LABEL[i.state]}
                  </Badge>
                </div>

                {i.decision_note && (
                  <p className="mt-2 text-xs text-muted-foreground">Finance said: {i.decision_note}</p>
                )}

                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setOpenId(openId === i.id ? null : i.id)}>
                    {openId === i.id ? "Hide trips" : "Show trips"}
                  </Button>
                  {(i.state === "DRAFT" || i.state === "QUERIED") && (
                    <Button size="sm" disabled={submit.isPending} onClick={() => submit.mutate(i.id)}>
                      Submit for payment
                    </Button>
                  )}
                </div>

                {openId === i.id && (
                  <Table className="mt-3">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Trip</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead className="text-right">Trip value</TableHead>
                        <TableHead className="text-right">TaxiD 15%</TableHead>
                        <TableHead className="text-right">Your 85%</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {i.lines.map((l) => (
                        <TableRow key={l.id}>
                          <TableCell className="font-mono text-xs">{l.booking_reference}</TableCell>
                          <TableCell className="text-sm">
                            {l.service_date ? new Date(l.service_date).toLocaleDateString() : "—"}
                          </TableCell>
                          <TableCell className="text-right text-sm">{money(l.gross_cents, i.currency)}</TableCell>
                          <TableCell className="text-right text-sm">{money(l.commission_cents, i.currency)}</TableCell>
                          <TableCell className="text-right text-sm">{money(l.net_cents, i.currency)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
