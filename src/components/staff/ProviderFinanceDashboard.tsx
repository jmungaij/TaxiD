/**
 * FINANCE DASHBOARD — operator settlement money movement.
 * Every figure comes from `provider_finance_dashboard`; nothing is computed here.
 */
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { loadFinanceDashboard, hasActivity, monthLabel } from "@/lib/provider/financeDashboard";
import { money } from "@/lib/provider/invoices";

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

export default function ProviderFinanceDashboard() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["provider-finance-dashboard"],
    queryFn: loadFinanceDashboard,
  });

  if (isLoading) return <Skeleton className="h-80 w-full" />;
  if (error) return <p className="text-sm text-destructive">{(error as Error).message}</p>;
  if (!data) return null;

  const w = data.withdrawals;
  const peak = Math.max(
    1,
    ...data.trend.map((t) => Math.max(t.commission_cents + t.fee_cents, t.paid_out_cents)),
  );

  return (
    <div className="space-y-4">
      {!hasActivity(data) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">No settlement activity yet</CardTitle>
            <CardDescription>
              No operator has earned, invoiced or withdrawn anything so far, so the figures below are
              genuinely empty rather than still loading. They fill in as soon as a paid trip is fulfilled.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Withdrawals by stage</CardTitle>
          <CardDescription>
            What operators are waiting on right now — amounts, not just counts.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Pending approval" value={money(w.pending_cents)} sub={`${w.pending_count} request(s)`} />
          <Metric label="Approved, awaiting release" value={money(w.approved_cents)} sub={`${w.approved_count} request(s)`} />
          <Metric label="Sent, awaiting confirmation" value={money(w.in_flight_cents)} sub={`${w.in_flight_count} request(s)`} />
          <Metric
            label="Paid to operators"
            value={money(w.paid_cents)}
            sub={`${w.paid_count} paid · ${w.failed_count} failed · ${w.rejected_count} rejected`}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">SAFARID income</CardTitle>
          <CardDescription>
            15% commission is recognised at fulfilment; the 5% fee posts only when a withdrawal
            actually succeeds.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Commission — this month" value={money(data.income.commission_month_cents)} />
          <Metric label="Commission — to date" value={money(data.income.commission_cents)} />
          <Metric label="Withdrawal fees — this month" value={money(data.income.fee_month_cents)} />
          <Metric label="Withdrawal fees — to date" value={money(data.income.fee_cents)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Operator wallets and statements</CardTitle>
          <CardDescription>Money owed, money ready to draw, and statements waiting on finance.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Held until fulfilment" value={money(data.wallets.held_cents)} sub={`${data.wallets.operators} operator wallet(s)`} />
          <Metric label="Available to withdraw" value={money(data.wallets.available_cents)} />
          <Metric label="Reserved in withdrawals" value={money(data.wallets.reserved_cents)} />
          <Metric
            label="Statements with finance"
            value={money(data.invoices.submitted_net_cents)}
            sub={`${data.invoices.submitted} submitted · ${data.invoices.approved} approved · ${data.invoices.queried} queried`}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Six-month trend</CardTitle>
          <CardDescription>Commission, withdrawal fees, operator earnings and money paid out.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex items-end gap-3">
            {data.trend.map((t) => {
              const income = t.commission_cents + t.fee_cents;
              return (
                <div key={t.month} className="flex flex-1 flex-col items-center gap-1">
                  <div className="flex h-28 w-full items-end justify-center gap-1">
                    <div
                      className="w-3 rounded-t bg-primary"
                      style={{ height: `${Math.max(2, (income / peak) * 100)}%` }}
                      title={`SAFARID income ${money(income)}`}
                    />
                    <div
                      className="w-3 rounded-t bg-muted-foreground/40"
                      style={{ height: `${Math.max(2, (t.paid_out_cents / peak) * 100)}%` }}
                      title={`Paid out ${money(t.paid_out_cents)}`}
                    />
                  </div>
                  <span className="text-[11px] text-muted-foreground">{monthLabel(t.month)}</span>
                </div>
              );
            })}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead className="text-right">Commission</TableHead>
                <TableHead className="text-right">Fees</TableHead>
                <TableHead className="text-right">Operator earnings</TableHead>
                <TableHead className="text-right">Paid out</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.trend.map((t) => (
                <TableRow key={t.month}>
                  <TableCell className="text-sm">{monthLabel(t.month)}</TableCell>
                  <TableCell className="text-right text-sm">{money(t.commission_cents)}</TableCell>
                  <TableCell className="text-right text-sm">{money(t.fee_cents)}</TableCell>
                  <TableCell className="text-right text-sm">{money(t.earned_cents)}</TableCell>
                  <TableCell className="text-right text-sm">{money(t.paid_out_cents)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">By operator</CardTitle>
          <CardDescription>
            Earned, withdrawn, still held, and how much finance has already approved for payment.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.operators.length === 0 ? (
            <p className="text-sm text-muted-foreground">No operator wallet has been opened yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Operator</TableHead>
                  <TableHead className="text-right">Earned</TableHead>
                  <TableHead className="text-right">Held</TableHead>
                  <TableHead className="text-right">Available</TableHead>
                  <TableHead className="text-right">Withdrawn</TableHead>
                  <TableHead className="text-right">Fees paid</TableHead>
                  <TableHead className="text-right">Approved cover</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.operators.map((o) => (
                  <TableRow key={o.provider_user_id}>
                    <TableCell className="font-mono text-xs">{o.provider_user_id.slice(0, 8)}</TableCell>
                    <TableCell className="text-right text-sm">{money(o.earned_cents, o.currency)}</TableCell>
                    <TableCell className="text-right text-sm">{money(o.held_cents, o.currency)}</TableCell>
                    <TableCell className="text-right text-sm">{money(o.available_cents, o.currency)}</TableCell>
                    <TableCell className="text-right text-sm">{money(o.withdrawn_cents, o.currency)}</TableCell>
                    <TableCell className="text-right text-sm">{money(o.fees_cents, o.currency)}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant={o.invoice_cover_cents > 0 ? "default" : "outline"}>
                        {money(Math.max(o.invoice_cover_cents, 0), o.currency)}
                      </Badge>
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
