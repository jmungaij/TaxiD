/**
 * DRIVER RIDES PANEL — available rides, booked trips and earnings for the
 * signed-in driver. Every row is a recorded booking; dispatch stays with the
 * operations team, so waiting rides are shown read-only.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarClock, Car, Coins, MapPin } from "lucide-react";
import {
  isOpenTrip, loadDriverRides, rideMoney, rideWhen,
  type DriverAvailableRide, type DriverTrip,
} from "@/lib/provider/driverRides";
import { loadProviderSettlementSelf } from "@/lib/provider/settlement";

export default function DriverRides() {
  const { data, isLoading } = useQuery({ queryKey: ["driver-rides-self"], queryFn: loadDriverRides });

  if (isLoading) return <Skeleton className="h-48 w-full" />;

  if (!data?.is_driver) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">No driver record on your account</CardTitle>
          <CardDescription>
            Rides only appear here once you are registered and approved as a driver. Fleet operators see
            their bookings under Assignments.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const { summary, currency, available, trips } = data;
  const open = trips.filter(isOpenTrip);
  const done = trips.filter((t) => t.status === "completed");
  const share = 100 - Math.round(data.commission_bps / 100);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={Car} label="Waiting for dispatch" value={String(summary.available)}
          hint="rides not yet given to a driver" />
        <Stat icon={CalendarClock} label="Your booked trips" value={String(open.length)}
          hint={`${summary.in_progress} on the road now`} />
        <Stat icon={Coins} label="Earned on completed trips" value={rideMoney(summary.net_cents, currency)}
          hint={`your ${share}% of ${rideMoney(summary.gross_cents, currency)} from ${summary.completed} trip${summary.completed === 1 ? "" : "s"}`} />
        <Stat icon={Coins} label="Expected from booked trips" value={rideMoney(summary.upcoming_net_cents, currency)}
          hint="paid once the trip is completed" />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Rides waiting for a driver</CardTitle>
          <CardDescription>
            Requests already in the system with no driver yet. Our dispatch team assigns them — you cannot
            claim one here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {available.length === 0 ? (
            <p className="text-muted-foreground">No rides are waiting right now.</p>
          ) : (
            <ul className="divide-y">
              {available.map((r) => <AvailableRow key={r.id} r={r} share={share} />)}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Your trips</CardTitle>
          <CardDescription>
            Trips assigned to you, with what each one pays you after TaxiD's {100 - share}% commission.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {trips.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No trips assigned to you yet. Assigned rides appear here with the pickup, the time and your share.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="uppercase text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-3 text-left">Trip</th>
                    <th className="py-1 pr-3 text-left">Route</th>
                    <th className="py-1 pr-3 text-left">When</th>
                    <th className="py-1 pr-3 text-left">Status</th>
                    <th className="py-1 pr-3 text-right">Trip value</th>
                    <th className="py-1 pr-3 text-right">Commission</th>
                    <th className="py-1 text-right">Your share</th>
                  </tr>
                </thead>
                <tbody>
                  {trips.map((t) => <TripRow key={t.id} t={t} />)}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <DriverTripStatement done={done} currency={currency} commissionBps={data.commission_bps} />

      {done.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Completed trips total {rideMoney(summary.gross_cents, currency)}; TaxiD retains{" "}
          {rideMoney(summary.commission_cents, currency)} and you keep{" "}
          {rideMoney(summary.net_cents, currency)}. Money reaches your wallet once the customer has paid and
          the trip is fulfilled.
        </p>
      )}

    </div>
  );
}

function Stat({
  icon: Icon, label, value, hint,
}: { icon: React.ElementType; label: string; value: string; hint: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="flex items-center gap-1.5 text-xs uppercase">
          <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold">{value}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}

function AvailableRow({ r, share }: { r: DriverAvailableRide; share: number }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2">
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 font-medium">
          <MapPin className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          {r.pickup_address ?? "Pickup to confirm"} → {r.dropoff_address ?? "Destination to confirm"}
        </p>
        <p className="text-xs text-muted-foreground">
          {r.booking_number ?? "reference pending"} · {rideWhen(r.scheduled_for)}
          {r.intent === "corporate" ? " · corporate" : ""}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm">
          {r.gross_cents > 0 ? `${rideMoney(r.net_cents, r.currency)} (${share}%)` : "Fare on confirmation"}
        </span>
        <Badge variant="outline">awaiting dispatch</Badge>
      </div>
    </li>
  );
}

function TripRow({ t }: { t: DriverTrip }) {
  return (
    <tr className="border-t border-border/50">
      <td className="py-1 pr-3 font-mono">{t.booking_number ?? "—"}</td>
      <td className="py-1 pr-3">
        {t.pickup_address ?? "—"} → {t.dropoff_address ?? "—"}
      </td>
      <td className="py-1 pr-3 whitespace-nowrap">
        {rideWhen(t.completed_at ?? t.started_at ?? t.scheduled_for)}
      </td>
      <td className="py-1 pr-3">
        <Badge variant="secondary" className="text-[10px]">{t.status.replace(/_/g, " ")}</Badge>
      </td>
      <td className="py-1 pr-3 text-right">{rideMoney(t.gross_cents, t.currency)}</td>
      <td className="py-1 pr-3 text-right">{rideMoney(t.commission_cents, t.currency)}</td>
      <td className="py-1 text-right font-semibold">
        {t.status === "cancelled" ? "—" : rideMoney(t.net_cents, t.currency)}
      </td>
    </tr>
  );
}

/**
 * TRIP STATEMENT — what each completed ride puts in the driver's wallet.
 *
 * The trip value and TaxiD's commission come from the recorded booking; the
 * withdrawal fee percentage is the live settlement setting, shown as what the
 * driver would pay if that money is withdrawn to their M-Pesa number. Nothing
 * is charged here — the fee is only taken when a withdrawal succeeds.
 */
function DriverTripStatement({
  done, currency, commissionBps,
}: { done: DriverTrip[]; currency: string; commissionBps: number }) {
  const { data: settlement } = useQuery({
    queryKey: ["provider-settlement-self", "driver-statement"],
    queryFn: loadProviderSettlementSelf,
    retry: false,
  });

  const feeBps = settlement?.withdrawal_fee_bps ?? 500;
  const feePct = feeBps / 100;
  const commissionPct = commissionBps / 100;
  const feeOn = (netCents: number) => Math.round((netCents * feeBps) / 10000);

  const totals = done.reduce(
    (t, r) => {
      const fee = feeOn(r.net_cents);
      return {
        gross: t.gross + r.gross_cents,
        commission: t.commission + r.commission_cents,
        net: t.net + r.net_cents,
        fee: t.fee + fee,
        payout: t.payout + (r.net_cents - fee),
      };
    },
    { gross: 0, commission: 0, net: 0, fee: 0, payout: 0 },
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Your statement</CardTitle>
        <CardDescription>
          Every completed ride, the {commissionPct}% TaxiD commission, what lands in your wallet and the{" "}
          {feePct}% fee charged only when you withdraw that money to your M-Pesa number.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {done.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No completed rides yet, so there is nothing on your statement.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="uppercase text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3 text-left">Ride</th>
                  <th className="py-1 pr-3 text-left">Completed</th>
                  <th className="py-1 pr-3 text-right">Ride amount</th>
                  <th className="py-1 pr-3 text-right">TaxiD {commissionPct}%</th>
                  <th className="py-1 pr-3 text-right">To your wallet</th>
                  <th className="py-1 pr-3 text-right">Withdrawal fee {feePct}%</th>
                  <th className="py-1 text-right">If withdrawn</th>
                </tr>
              </thead>
              <tbody>
                {done.map((t) => {
                  const fee = feeOn(t.net_cents);
                  return (
                    <tr key={t.id} className="border-t border-border/50">
                      <td className="py-1 pr-3 font-mono">{t.booking_number ?? "—"}</td>
                      <td className="py-1 pr-3 whitespace-nowrap">{rideWhen(t.completed_at)}</td>
                      <td className="py-1 pr-3 text-right">{rideMoney(t.gross_cents, t.currency)}</td>
                      <td className="py-1 pr-3 text-right">-{rideMoney(t.commission_cents, t.currency)}</td>
                      <td className="py-1 pr-3 text-right font-semibold">{rideMoney(t.net_cents, t.currency)}</td>
                      <td className="py-1 pr-3 text-right">-{rideMoney(fee, t.currency)}</td>
                      <td className="py-1 text-right">{rideMoney(t.net_cents - fee, t.currency)}</td>
                    </tr>
                  );
                })}
                <tr className="border-t-2 border-border font-semibold">
                  <td className="py-1 pr-3" colSpan={2}>Totals</td>
                  <td className="py-1 pr-3 text-right">{rideMoney(totals.gross, currency)}</td>
                  <td className="py-1 pr-3 text-right">-{rideMoney(totals.commission, currency)}</td>
                  <td className="py-1 pr-3 text-right">{rideMoney(totals.net, currency)}</td>
                  <td className="py-1 pr-3 text-right">-{rideMoney(totals.fee, currency)}</td>
                  <td className="py-1 text-right">{rideMoney(totals.payout, currency)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
