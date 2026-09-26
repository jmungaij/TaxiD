/**
 * Operator payout breakdown.
 *
 * Mirrors the customer's stacked price layer for layer, so an operator can see
 * exactly which part of what the customer paid becomes their settlement, which
 * part is a platform layer, and which part is tax held for remittance. Every
 * figure is derived from the same published pricing version used to quote the
 * booking — a payout can therefore never drift from the price charged.
 */
import { useEffect, useMemo, useState } from "react";
import { FlightHubPage, HubSection } from "@/components/charter/FlightHubPage";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useFlightHub } from "@/lib/charter/useFlightHub";
import { computeAviationPrice } from "@/lib/charter/aviationPricing";
import { aircraftKeyFor } from "@/lib/charter/aircraftMatch";
import { computeOperatorPayout, type OperatorPayout } from "@/lib/charter/payout";
import { fetchPublishedPricing, type PublishedPricing } from "@/lib/charter/publishedPricing";
import type { CharterBookingRow } from "@/lib/charter/api";

const usd = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface PayoutRow {
  booking: CharterBookingRow;
  payout: OperatorPayout;
}

export default function OperatorPayouts() {
  const { data, loading, error, reload } = useFlightHub();
  const [pricing, setPricing] = useState<PublishedPricing | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => { void fetchPublishedPricing().then(setPricing); }, []);

  const rows = useMemo<PayoutRow[]>(() => {
    if (!pricing) return [];
    return data.bookings.map((booking) => {
      const trip = (booking.trip ?? {}) as Record<string, string>;
      const breakdown = computeAviationPrice({
        aircraftKey: aircraftKeyFor(booking.asset_name),
        origin: trip.origin ?? "",
        destination: trip.destination ?? "",
        passengers: Math.max(1, booking.passengers?.length ?? 1),
        controls: pricing.config.controls,
        airportTable: pricing.config.airports,
      });
      return {
        booking,
        payout: computeOperatorPayout(breakdown, pricing.config.controls, {
          bookedAt: new Date(booking.created_at),
        }),
      };
    });
  }, [data.bookings, pricing]);

  const totals = useMemo(() => rows.reduce(
    (acc, r) => ({
      gross: acc.gross + r.payout.customerPrice,
      payout: acc.payout + r.payout.payoutAmount,
      platform: acc.platform + r.payout.platformRevenue,
      tax: acc.tax + r.payout.taxes,
    }),
    { gross: 0, payout: 0, platform: 0, tax: 0 },
  ), [rows]);

  const active = rows.find((r) => r.booking.id === selected) ?? rows[0] ?? null;

  return (
    <FlightHubPage
      eyebrow="Flight Hub · Operator"
      title="Payout Breakdown"
      subtitle="The customer's stacked price, mirrored — what you earn, what the platform deducts, and when it settles."
      loading={loading}
      error={error}
      onReload={reload}
      metrics={[
        { label: "Gross booked", value: usd(totals.gross) },
        { label: "Your settlement", value: usd(totals.payout) },
        { label: "Platform layers", value: usd(totals.platform) },
        { label: "Tax for remittance", value: usd(totals.tax) },
      ]}
    >
      <HubSection
        title="Bookings"
        description={
          pricing
            ? `Priced on published version ${pricing.version}${pricing.fallback ? " (platform defaults)" : ""}.`
            : "Loading published pricing…"
        }
      >
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No bookings to settle yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reference</TableHead>
                  <TableHead>Aircraft</TableHead>
                  <TableHead className="text-right">Customer paid</TableHead>
                  <TableHead className="text-right">Your payout</TableHead>
                  <TableHead className="text-right">Share</TableHead>
                  <TableHead>Settles</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ booking, payout }) => (
                  <TableRow key={booking.id} data-state={active?.booking.id === booking.id ? "selected" : undefined}>
                    <TableCell className="font-mono text-xs">{booking.reference}</TableCell>
                    <TableCell className="text-xs">{booking.asset_name}</TableCell>
                    <TableCell className="text-right text-xs">{usd(payout.customerPrice)}</TableCell>
                    <TableCell className="text-right text-xs font-semibold">{usd(payout.payoutAmount)}</TableCell>
                    <TableCell className="text-right text-xs">{payout.payoutSharePct}%</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">
                      {new Date(payout.settlementDate).toLocaleDateString()}
                      <span className="text-muted-foreground"> · T+{payout.settlementDays}</span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => setSelected(booking.id)}>Breakdown</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </HubSection>

      {active && (
        <>
          <HubSection
            title={`Stacked breakdown · ${active.booking.reference}`}
            description="Credits build your revenue, debits are platform layers, info rows are contextual and never deducted twice."
          >
            <ul className="space-y-2">
              {active.payout.lines.map((l, i) => (
                <li key={`${l.label}-${i}`} className="flex items-start justify-between gap-4 border-b border-border/60 pb-2 last:border-0">
                  <div>
                    <div className="text-sm flex items-center gap-2">
                      {l.label}
                      {l.kind === "info" && <Badge variant="outline" className="text-[10px]">info</Badge>}
                    </div>
                    {l.hint && <p className="text-[11px] text-muted-foreground">{l.hint}</p>}
                  </div>
                  <span className={
                    l.kind === "debit"
                      ? "text-sm whitespace-nowrap text-status-danger dark:text-status-danger"
                      : l.kind === "credit"
                        ? "text-sm whitespace-nowrap text-status-success dark:text-status-success"
                        : "text-sm whitespace-nowrap text-muted-foreground"
                  }>
                    {usd(l.amount)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <SummaryTile label="Net of tax" value={usd(active.payout.netOfTax)} />
              <SummaryTile label="Platform share" value={`${active.payout.platformSharePct}%`} />
              <SummaryTile label="You receive" value={usd(active.payout.payoutAmount)} accent />
            </div>
          </HubSection>

          <HubSection
            title="Cancellation exposure"
            description="If the customer cancels, this is the portion of the retained fee that reaches you and the amount refunded."
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tier</TableHead>
                  <TableHead>Window</TableHead>
                  <TableHead className="text-right">You retain</TableHead>
                  <TableHead className="text-right">Customer refund</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {active.payout.cancellationExposure.map((c) => (
                  <TableRow key={c.label}>
                    <TableCell className="text-xs">{c.label}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{c.window}</TableCell>
                    <TableCell className="text-right text-xs">{usd(c.retained)}</TableCell>
                    <TableCell className="text-right text-xs">{usd(c.refunded)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </HubSection>
        </>
      )}
    </FlightHubPage>
  );
}

function SummaryTile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${accent ? "border-primary/40 bg-primary/5" : "border-border"}`}>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold mt-1">{value}</p>
    </div>
  );
}
