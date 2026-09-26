/**
 * OPERATOR EARNINGS — derived, never invented.
 *
 * Every figure here comes from the operator's own bookings: the agreed rate on
 * each booking is the gross value, SAFARID retains a 15% service commission and
 * the operator keeps 85%. Only delivered services count as earned; confirmed
 * work ahead is shown separately as expected.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Coins } from "lucide-react";
import { loadProviderBookings, type ProviderBookingRow } from "@/lib/provider/bookings";

/** SAFARID service commission retained on each completed booking. */
export const COMMISSION_RATE = 0.15;

const money = (cents: number, currency = "KES") =>
  `${currency === "KES" ? "KSh" : currency} ${(cents / 100).toLocaleString("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const payoutCents = (grossCents: number) => Math.round(grossCents * (1 - COMMISSION_RATE));

export default function ProviderEarnings() {
  const { data, isLoading } = useQuery({
    queryKey: ["provider-bookings-earnings"],
    queryFn: loadProviderBookings,
  });

  const rows: ProviderBookingRow[] = data ?? [];
  const delivered = rows.filter((r) => r.status === "DELIVERED");
  const upcoming = rows.filter((r) => r.status === "CONFIRMED");

  const sum = (list: ProviderBookingRow[]) => list.reduce((t, r) => t + Number(r.amount_cents ?? 0), 0);
  const earnedGross = sum(delivered);
  const expectedGross = sum(upcoming);
  const currency = rows[0]?.currency ?? "KES";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Coins className="h-4 w-4" />Assignments and earnings
        </CardTitle>
        <CardDescription>
          You keep 85% of every service you deliver; SAFARID retains a 15% service commission. Amounts follow the rate
          agreed on each booking.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No bookings yet. Earnings appear here as soon as a customer books your capacity.
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="text-xs uppercase text-muted-foreground">Earned (delivered)</p>
                <p className="text-xl font-semibold">{money(payoutCents(earnedGross), currency)}</p>
                <p className="text-xs text-muted-foreground">
                  from {delivered.length} service{delivered.length === 1 ? "" : "s"} worth {money(earnedGross, currency)}
                </p>
              </div>
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="text-xs uppercase text-muted-foreground">Expected (confirmed ahead)</p>
                <p className="text-xl font-semibold">{money(payoutCents(expectedGross), currency)}</p>
                <p className="text-xs text-muted-foreground">
                  from {upcoming.length} confirmed booking{upcoming.length === 1 ? "" : "s"}
                </p>
              </div>
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="text-xs uppercase text-muted-foreground">Commission retained</p>
                <p className="text-xl font-semibold">
                  {money(earnedGross - payoutCents(earnedGross), currency)}
                </p>
                <p className="text-xs text-muted-foreground">15% of delivered services</p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground uppercase">
                  <tr>
                    <th className="text-left py-1 pr-3">Booking</th>
                    <th className="text-left py-1 pr-3">Listing</th>
                    <th className="text-left py-1 pr-3">Customer</th>
                    <th className="text-left py-1 pr-3">Dates</th>
                    <th className="text-left py-1 pr-3">Status</th>
                    <th className="text-right py-1 pr-3">Service value</th>
                    <th className="text-right py-1">Your share</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-t border-border/50">
                      <td className="py-1 pr-3 font-mono">{r.booking_reference}</td>
                      <td className="py-1 pr-3">{r.capacity_title}</td>
                      <td className="py-1 pr-3">{r.customer_company ?? r.customer_contact_name ?? "—"}</td>
                      <td className="py-1 pr-3 whitespace-nowrap">
                        {r.service_from ?? "—"}{r.service_to ? ` → ${r.service_to}` : ""}
                      </td>
                      <td className="py-1 pr-3">
                        <Badge variant="secondary" className="text-[10px]">{r.status.toLowerCase()}</Badge>
                      </td>
                      <td className="py-1 pr-3 text-right">{money(Number(r.amount_cents ?? 0), r.currency)}</td>
                      <td className="py-1 text-right font-semibold">
                        {r.status === "CANCELLED" ? "—" : money(payoutCents(Number(r.amount_cents ?? 0)), r.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
