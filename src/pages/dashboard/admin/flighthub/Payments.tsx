import { useMemo } from "react";
import { FlightHubPage, HubSection } from "@/components/charter/FlightHubPage";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import StatCard from "@/components/common/StatCard";
import { useFlightHub } from "@/lib/charter/useFlightHub";
import { buildPayments, computePulse, money, pct } from "@/lib/charter/flightHub";

export default function Payments() {
  const { data, loading, error, reload } = useFlightHub();
  const buckets = useMemo(() => buildPayments(data), [data]);
  const pulse = useMemo(() => computePulse(data), [data]);
  const total = buckets.reduce((s, b) => s + b.value, 0);
  const currency = buckets[0]?.currency ?? "KES";
  const unsettled = buckets.filter((b) => !["paid", "settled"].includes(b.status)).reduce((s, b) => s + b.value, 0);

  const methods = useMemo(() => {
    const m = new Map<string, { count: number; value: number }>();
    for (const b of data.bookings) {
      const key = b.payment_method || "unspecified";
      const row = m.get(key) ?? { count: 0, value: 0 };
      row.count += 1;
      row.value += b.amount || 0;
      m.set(key, row);
    }
    return [...m.entries()].sort((a, b) => b[1].value - a[1].value);
  }, [data.bookings]);

  return (
    <FlightHubPage
      eyebrow="Flight Hub · Finance"
      title="Payment System"
      subtitle="Settlement posture across charter bookings — exposure, method mix and cash conversion."
      loading={loading}
      error={error}
      onReload={reload}
      metrics={[
        { label: "Gross booked", value: money(total, currency) },
        { label: "Unsettled exposure", value: money(unsettled, currency) },
        { label: "Settled rate", value: `${pulse.settledPct}%` },
        { label: "Transactions", value: String(data.bookings.length) },
      ]}
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {buckets.slice(0, 4).map((b) => (
          <StatCard
            key={b.status}
            title={b.label}
            value={money(b.value, b.currency)}
            description={`${b.count} booking${b.count === 1 ? "" : "s"} · ${pct(b.value, total)}% of gross`}
            tone={["paid", "settled"].includes(b.status) ? "success" : b.status === "failed" ? "danger" : "warning"}
          />
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <HubSection title="Settlement breakdown" description="Value distribution by payment status.">
          <ul className="space-y-3">
            {buckets.map((b) => (
              <li key={b.status}>
                <div className="flex items-baseline justify-between text-sm">
                  <span className="font-medium">{b.label}</span>
                  <span className="tabular-nums text-muted-foreground">{money(b.value, b.currency)}</span>
                </div>
                <div className="mt-1.5 h-2 rounded-full bg-muted">
                  <div className="h-2 rounded-full bg-primary" style={{ width: `${Math.max(3, pct(b.value, total))}%` }} />
                </div>
              </li>
            ))}
            {buckets.length === 0 && <li className="text-sm text-muted-foreground">No payments recorded yet.</li>}
          </ul>
        </HubSection>

        <HubSection title="Payment method mix" description="How charter customers pay.">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Method</TableHead>
                  <TableHead className="text-right">Transactions</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead className="text-right">Share</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {methods.map(([method, v]) => (
                  <TableRow key={method} className="row-hover">
                    <TableCell className="font-medium capitalize">{method.replace(/[_-]/g, " ")}</TableCell>
                    <TableCell className="text-right tabular-nums">{v.count}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(v.value, currency)}</TableCell>
                    <TableCell className="text-right tabular-nums">{pct(v.value, total)}%</TableCell>
                  </TableRow>
                ))}
                {methods.length === 0 && (
                  <TableRow><TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">No transactions yet.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </HubSection>
      </div>

      <HubSection title="Unsettled bookings" description="Requires finance follow-up before departure clearance.">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>Asset</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Payment status</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.bookings.filter((b) => !["paid", "settled"].includes(b.payment_status)).map((b) => (
                <TableRow key={b.id} className="row-hover">
                  <TableCell className="font-mono text-xs">{b.reference}</TableCell>
                  <TableCell className="font-medium">{b.asset_name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground capitalize">{(b.payment_method || "—").replace(/[_-]/g, " ")}</TableCell>
                  <TableCell><Badge variant="outline">{b.payment_status}</Badge></TableCell>
                  <TableCell className="text-right tabular-nums">{money(b.amount, b.currency)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </HubSection>
    </FlightHubPage>
  );
}
