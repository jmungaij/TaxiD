/**
 * FINANCE QUEUE FOR OPERATOR STATEMENTS.
 * Approve or query each submitted statement. Approval is what makes the money
 * withdrawable, and the database refuses approval when the statement total no
 * longer matches the trips it recorded.
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
import {
  INVOICE_STATE_LABEL,
  decideInvoice,
  invoiceDisputed,
  loadInvoiceQueue,
  money,
  periodLabel,
} from "@/lib/provider/invoices";

export default function ProviderInvoiceQueue() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["provider-invoice-queue"],
    queryFn: loadInvoiceQueue,
  });
  const [notes, setNotes] = React.useState<Record<string, string>>({});
  const [openId, setOpenId] = React.useState<string | null>(null);

  const decide = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) =>
      decideInvoice(id, approve, notes[id]),
    onSuccess: (r) => {
      toast({ title: r.state === "APPROVED" ? "Statement approved for payment" : "Statement queried" });
      qc.invalidateQueries({ queryKey: ["provider-invoice-queue"] });
      qc.invalidateQueries({ queryKey: ["provider-finance-dashboard"] });
    },
    onError: (e: Error) => toast({ title: "Not recorded", description: e.message, variant: "destructive" }),
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (error) return <p className="text-sm text-destructive">{(error as Error).message}</p>;

  const s = data?.summary;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Operator statements</CardTitle>
          <CardDescription>
            Each statement lists the trips the platform recorded, SAFARID's 15% and the operator's 85%.
            Approving one is what releases the money for withdrawal.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Awaiting a decision</p>
            <p className="text-lg font-semibold">{money(s?.submitted_net_cents ?? 0)}</p>
            <p className="text-xs text-muted-foreground">{s?.submitted ?? 0} statement(s)</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Approved for payment</p>
            <p className="text-lg font-semibold">{money(s?.approved_net_cents ?? 0)}</p>
            <p className="text-xs text-muted-foreground">{s?.approved ?? 0} statement(s)</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Queried, back with the operator</p>
            <p className="text-lg font-semibold">{s?.queried ?? 0}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Queue</CardTitle>
          {!data?.can_decide && (
            <CardDescription>
              You can follow this queue but only finance settlement staff may decide on a statement.
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {(data?.invoices ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No operator has submitted a statement yet.
            </p>
          ) : (
            (data?.invoices ?? []).map((i) => (
              <div key={i.id} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-xs text-muted-foreground">
                      {i.invoice_number ?? "unnumbered"} ·{" "}
                      {(i.provider_user_id ?? "").slice(0, 8)}
                    </p>
                    <p className="text-sm font-semibold">
                      {money(i.net_cents, i.currency)} to the operator
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {periodLabel(i)} · {i.lines_count} trip(s) ·{" "}
                      {money(i.gross_cents, i.currency)} gross ·{" "}
                      {money(i.commission_cents, i.currency)} SAFARID 15% ·{" "}
                      {money(i.estimated_fee_cents, i.currency)} fee on withdrawal
                    </p>
                  </div>
                  <div className="space-y-1 text-right">
                    <Badge variant={i.state === "APPROVED" ? "default" : i.state === "QUERIED" ? "destructive" : "outline"}>
                      {INVOICE_STATE_LABEL[i.state]}
                    </Badge>
                    {invoiceDisputed(i) && (
                      <p className="text-xs text-destructive">
                        Recorded trips total {money(i.recomputed_net_cents ?? 0, i.currency)}
                      </p>
                    )}
                  </div>
                </div>

                {i.decision_note && (
                  <p className="mt-2 text-xs text-muted-foreground">Note: {i.decision_note}</p>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setOpenId(openId === i.id ? null : i.id)}>
                    {openId === i.id ? "Hide trips" : "Show trips"}
                  </Button>
                  {data?.can_decide && i.state === "SUBMITTED" && (
                    <>
                      <Input
                        className="h-9 max-w-xs"
                        placeholder="Decision note / query reason"
                        value={notes[i.id] ?? ""}
                        onChange={(e) => setNotes((n) => ({ ...n, [i.id]: e.target.value }))}
                      />
                      <Button
                        size="sm"
                        disabled={decide.isPending}
                        onClick={() => decide.mutate({ id: i.id, approve: true })}
                      >
                        Approve for payment
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={decide.isPending}
                        onClick={() => decide.mutate({ id: i.id, approve: false })}
                      >
                        Query
                      </Button>
                    </>
                  )}
                </div>

                {openId === i.id && (
                  <Table className="mt-3">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Trip</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead className="text-right">Trip value</TableHead>
                        <TableHead className="text-right">SAFARID 15%</TableHead>
                        <TableHead className="text-right">Operator 85%</TableHead>
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
