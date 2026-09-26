/**
 * Road charter approval queue.
 *
 * Operations-facing queue of bus, van and coach bookings that are not yet
 * settled. Unpaid bookings are rendered in red with the exact three-line fare
 * (booking fee, night/Sunday surcharge, platform commission) and an approve
 * action that moves the booking into the next payment step, persisting
 * `payment_status` on the booking record.
 */
import { useEffect, useMemo, useState } from "react";
import { AdminOnly } from "@/components/auth/AdminOnly";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { BusFront, CheckCircle2, RefreshCw } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { charterApi, type CharterBookingRow } from "@/lib/charter/api";
import { fetchBookingBreakdown, type BookingBreakdown } from "@/lib/pricing360/assetBands";
import {
  ROAD_TRAVEL_STAGE_LABELS,
  isRoadAwaitingPayment,
  isRoadUnpaid,
  roadPaymentLabel,
  roadTravelStage,
} from "@/lib/charter/roadPayment";

/** Road categories handled by this queue — aviation has its own console. */
const ROAD_SLUGS = [
  "bus-charter",
  "truck-hauler-leasing",
  "car-rentals",
  "equipment-rentals",
  "event-rentals",
  "heavy-machinery-leasing",
];

const money = (n: number) => `KSh ${new Intl.NumberFormat("en-KE").format(Math.round(n))}`;

/** Breakdowns keyed by booking reference, read from Pricing 360 snapshots. */
type BreakdownMap = Record<string, BookingBreakdown>;

export default function RoadApprovalQueue() {
  const [rows, setRows] = useState<CharterBookingRow[] | null>(null);
  const [breakdowns, setBreakdowns] = useState<BreakdownMap>({});
  const [pricingLoading, setPricingLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      const all = await charterApi.listBookings();
      const road = all.filter((b) => ROAD_SLUGS.includes(b.category_slug));
      setRows(road);
      // Commission, surcharge and base are reconstructed exclusively from the
      // immutable Pricing 360 snapshot captured at booking time. Nothing here
      // is inferred from the stored booking fee.
      setPricingLoading(true);
      const refs = Array.from(new Set(road.filter((b) => isRoadUnpaid(b.payment_status)).map((b) => b.reference)));
      const results = await Promise.all(
        refs.map(async (ref) => {
          try {
            return [ref, await fetchBookingBreakdown(ref)] as const;
          } catch {
            return [ref, { status: "NO_SNAPSHOT" as const }] as const;
          }
        }),
      );
      setBreakdowns(Object.fromEntries(results));
      setPricingLoading(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load bookings");
      setRows([]);
      setPricingLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const unpaid = useMemo(() => (rows ?? []).filter((b) => isRoadUnpaid(b.payment_status)), [rows]);
  /**
   * Outstanding value prefers the governed snapshot total and falls back to the
   * amount recorded on the booking, so pre-snapshot bookings are never dropped
   * from the backlog figure.
   */
  const outstanding = useMemo(
    () =>
      unpaid.reduce((sum, b) => {
        const snap = breakdowns[b.reference];
        const governed = snap?.status === "OK" ? snap.total ?? 0 : null;
        return sum + (governed ?? (Number(b.amount ?? 0) || 0));
      }, 0),
    [unpaid, breakdowns],
  );

  const missingSnapshots = useMemo(
    () => unpaid.filter((b) => breakdowns[b.reference]?.status !== "OK").length,
    [unpaid, breakdowns],
  );

  const approvePayment = async (b: CharterBookingRow) => {
    setBusyId(b.id);
    try {
      const next = isRoadAwaitingPayment(b.payment_status) ? "paid" : "approved";
      const row = await charterApi.adminUpdate("charter_bookings", b.id, { payment_status: next });
      setRows((cur) =>
        (cur ?? []).map((r) => (r.id === b.id ? { ...r, payment_status: String(row.payment_status) } : r)),
      );
      toast({
        title: next === "paid" ? "Payment confirmed" : "Payment approved",
        description: `${b.reference} → ${roadPaymentLabel(next)}`,
      });
    } catch (e) {
      toast({
        title: "Approval failed",
        description: e instanceof Error ? e.message : "Unexpected error",
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <AdminOnly>
      <div className="mx-auto max-w-7xl space-y-6 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold">
              <BusFront className="h-6 w-6 text-primary" /> Road charter approval queue
            </h1>
            <p className="text-sm text-muted-foreground">
              Unpaid bus, van and coach bookings, shown in red with the exact fare build-up.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh
          </Button>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader className="pb-2"><CardDescription>Unpaid bookings</CardDescription></CardHeader>
            <CardContent className="text-2xl font-semibold text-destructive">{unpaid.length}</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardDescription>Outstanding value</CardDescription></CardHeader>
            <CardContent className="text-2xl font-semibold text-destructive">{money(outstanding)}</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardDescription>Missing price snapshots</CardDescription></CardHeader>
            <CardContent className="text-2xl font-semibold">
              {pricingLoading ? "…" : missingSnapshots}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Bookings awaiting settlement</CardTitle>
            <CardDescription>
              Base, surcharge and commission are reconstructed from the immutable Pricing 360 quote
              snapshot taken when the booking was confirmed — never from the stored booking fee. A
              booking without a snapshot cannot be settled from this queue and needs pricing review.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {rows === null ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : unpaid.length === 0 ? (
              <p className="text-sm text-muted-foreground">No unpaid road charter bookings. Queue is clear.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reference</TableHead>
                    <TableHead>Vehicle</TableHead>
                    <TableHead className="text-right">Snapshot base</TableHead>
                    <TableHead className="text-right">Surcharge</TableHead>
                    <TableHead className="text-right">Commission</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Payment</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {unpaid.map((b) => {
                    const snap = breakdowns[b.reference];
                    const governed = snap?.status === "OK";
                    return (
                      <TableRow key={b.id} className={governed ? "text-destructive" : "text-muted-foreground"}>
                        <TableCell className="font-mono text-xs">{b.reference}</TableCell>
                        <TableCell className="text-foreground">{b.asset_name}</TableCell>
                        <TableCell className="text-right">{governed ? money(snap.base ?? 0) : "—"}</TableCell>
                        <TableCell className="text-right">
                          {governed && (snap.surcharge_total ?? 0) > 0 ? money(snap.surcharge_total ?? 0) : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          {governed ? money(snap.commission_total ?? 0) : "—"}
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          {governed ? money(snap.total ?? 0) : money(Number(b.amount ?? 0) || 0)}
                        </TableCell>

                        <TableCell>
                          <Badge
                            variant="outline"
                            className={
                              governed
                                ? "border-destructive/40 bg-destructive/10 text-destructive"
                                : "border-border"
                            }
                          >
                            {roadPaymentLabel(b.payment_status)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-foreground">
                          {ROAD_TRAVEL_STAGE_LABELS[roadTravelStage(b)]}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex flex-col items-end gap-1">
                            <Button
                              size="sm"
                              variant={governed ? "default" : "outline"}
                              disabled={busyId === b.id}
                              onClick={() => void approvePayment(b)}
                            >
                              <CheckCircle2 className="mr-2 h-4 w-4" />
                              {isRoadAwaitingPayment(b.payment_status) ? "Confirm paid" : "Approve payment"}
                            </Button>
                            {!governed && (
                              <span className="text-[11px]">
                                No governed snapshot — settling on the recorded amount, send to pricing review
                              </span>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminOnly>
  );
}
