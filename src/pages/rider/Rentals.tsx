/**
 * RIDER — MY RENTALS.
 *
 * Everything shown here is read back from the rental register for the signed-in
 * person: quotations still awaiting payment, confirmed bookings with the vehicle
 * actually reserved, and finished rentals. Reschedules and cancellations are
 * recorded as requests — our commercial desk approves them, and the database
 * refuses a reschedule onto dates where no vehicle of that class is free.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { CalendarClock, CarFront, Clock, FileText, Loader2, ReceiptText } from "lucide-react";
import { RiderShell } from "@/components/rider/RiderShell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { CONTACT, PHONE_TEL } from "@/config/contact";
import { kes } from "@/lib/marketing/publicRateCard";
import {
  BOOKING_STATUS_LABEL,
  loadMyRentals,
  requestBookingChange,
  type MyRentals,
  type RentalBookingSummary,
} from "@/lib/rentals/myRentals";

const dateLong = (iso: string) =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" }) : "—";

const STATUS_TONE: Record<string, string> = {
  CONFIRMED: "bg-status-success/15 text-status-success",
  AWAITING_ALLOCATION: "bg-status-warning/15 text-status-warning",
  PICKED_UP: "bg-ai/15 text-ai",
  RETURNED: "bg-muted text-muted-foreground",
  CANCELLED: "bg-destructive/15 text-destructive",
};

const categoryLabel = (c: string) => (c === "SELF_DRIVE" ? "Self-drive" : "Chauffeured");

export default function RiderRentalsPage() {
  const [data, setData] = useState<MyRentals | null>(null);
  const [loading, setLoading] = useState(true);
  const [changing, setChanging] = useState<{ booking: RentalBookingSummary; mode: "RESCHEDULE" | "CANCELLATION" } | null>(
    null,
  );
  const [newStart, setNewStart] = useState("");
  const [newEnd, setNewEnd] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await loadMyRentals();
    setData(result);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const active = useMemo(
    () => (data?.bookings ?? []).filter((b) => b.status !== "RETURNED" && b.status !== "CANCELLED"),
    [data],
  );
  const past = useMemo(
    () => (data?.bookings ?? []).filter((b) => b.status === "RETURNED" || b.status === "CANCELLED"),
    [data],
  );
  const openQuotes = useMemo(
    () => (data?.quotes ?? []).filter((q) => q.paymentStatus !== "paid"),
    [data],
  );

  const openChange = (booking: RentalBookingSummary, mode: "RESCHEDULE" | "CANCELLATION") => {
    setChanging({ booking, mode });
    setNewStart(booking.startDate);
    setNewEnd(booking.endDate);
    setReason("");
    setRefusal(null);
  };

  const submitChange = async () => {
    if (!changing || saving) return;
    setSaving(true);
    setRefusal(null);
    const outcome = await requestBookingChange({
      bookingReference: changing.booking.bookingReference,
      action: changing.mode,
      newStart: changing.mode === "RESCHEDULE" ? newStart : undefined,
      newEnd: changing.mode === "RESCHEDULE" ? newEnd : undefined,
      reason: reason || undefined,
    });
    setSaving(false);
    if (outcome.ok !== true) {
      setRefusal("message" in outcome ? outcome.message : "We could not record that request.");
      return;
    }
    toast.success(
      changing.mode === "RESCHEDULE"
        ? "Reschedule requested — our team will confirm."
        : "Cancellation requested — our team will be in touch.",
    );
    setChanging(null);
    await load();
  };

  return (
    <RiderShell>
      <Helmet>
        <title>My rentals | Yalla Mobility</title>
        <meta name="robots" content="noindex" />
      </Helmet>

      <h1 className="text-2xl font-bold">My rentals</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Quotations awaiting payment, confirmed bookings and past rentals.
      </p>

      {loading ? (
        <div className="mt-6 space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : (
        <div className="mt-6 space-y-8">
          {/* ------------------------------- quotations ---------------------- */}
          <section>
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <FileText className="h-4 w-4" /> Quotations awaiting payment
            </h2>
            {openQuotes.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Nothing pending.{" "}
                <Link to="/rentals/self-drive" className="text-primary underline">
                  Request a rental quote
                </Link>
                .
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                {openQuotes.map((q) => (
                  <Card key={q.reference} className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground">{q.reference}</span>
                          <Badge variant={q.expired ? "destructive" : "secondary"}>
                            {q.expired ? "Expired" : "Awaiting payment"}
                          </Badge>
                        </div>
                        <p className="mt-1 font-medium">
                          {categoryLabel(q.category)} · {q.bandLabel}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {dateLong(q.startDate)} → {dateLong(q.endDate)} · {q.rentalDays} day
                          {q.rentalDays === 1 ? "" : "s"} · {q.pickupLocation}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold">{kes(q.totalKes)}</p>
                        <Button asChild size="sm" className="mt-2">
                          <Link to={`/rentals/quote/${q.token}`}>{q.expired ? "View quotation" : "Pay now"}</Link>
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </section>

          {/* -------------------------------- bookings ----------------------- */}
          <section>
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <CarFront className="h-4 w-4" /> Active bookings
            </h2>
            {active.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No active rental bookings.</p>
            ) : (
              <div className="mt-3 space-y-2">
                {active.map((b) => (
                  <Card key={b.bookingReference} className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground">{b.bookingReference}</span>
                          <Badge className={STATUS_TONE[b.status] ?? "bg-muted"}>
                            {BOOKING_STATUS_LABEL[b.status] ?? b.status}
                          </Badge>
                        </div>
                        <p className="mt-1 font-medium">
                          {b.vehicle
                            ? `${b.vehicle.make} ${b.vehicle.model}${b.vehicle.year ? ` (${b.vehicle.year})` : ""}`
                            : b.bandLabel}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {categoryLabel(b.category)} · {dateLong(b.startDate)} → {dateLong(b.endDate)}
                        </p>
                        <p className="text-sm text-muted-foreground">Collection: {b.pickupLocation}</p>
                        {b.pickedUpAt ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Handed over {new Date(b.pickedUpAt).toLocaleString("en-KE")}
                          </p>
                        ) : null}
                        {b.changeRequest ? (
                          <p className="mt-2 flex items-center gap-1 text-xs text-status-warning">
                            <Clock className="h-3 w-3" />
                            {b.changeRequest === "RESCHEDULE"
                              ? `Reschedule requested to ${dateLong(b.requestedStartDate ?? "")} → ${dateLong(
                                  b.requestedEndDate ?? "",
                                )} — awaiting our confirmation`
                              : "Cancellation requested — awaiting our confirmation"}
                          </p>
                        ) : null}
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-muted-foreground">Paid</p>
                        <p className="text-lg font-bold">{kes(b.amountPaidKes)}</p>
                        {!b.changeRequest && b.status !== "PICKED_UP" ? (
                          <div className="mt-2 flex flex-col gap-2">
                            <Button size="sm" variant="outline" onClick={() => openChange(b, "RESCHEDULE")}>
                              <CalendarClock className="mr-2 h-3.5 w-3.5" /> Reschedule
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => openChange(b, "CANCELLATION")}>
                              Cancel
                            </Button>
                          </div>
                        ) : null}
                        {b.quoteToken ? (
                          <Button asChild size="sm" variant="ghost" className="mt-2">
                            <Link to={`/rentals/quote/${b.quoteToken}`}>
                              <ReceiptText className="mr-2 h-3.5 w-3.5" /> Receipt
                            </Link>
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </section>

          {/* ---------------------------------- past -------------------------- */}
          {past.length > 0 ? (
            <section>
              <h2 className="text-lg font-semibold">Past rentals</h2>
              <div className="mt-3 space-y-2">
                {past.map((b) => (
                  <Card key={b.bookingReference} className="p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground">{b.bookingReference}</span>
                          <Badge className={STATUS_TONE[b.status] ?? "bg-muted"}>
                            {BOOKING_STATUS_LABEL[b.status] ?? b.status}
                          </Badge>
                        </div>
                        <p className="mt-1 text-sm">
                          {b.vehicle ? `${b.vehicle.make} ${b.vehicle.model}` : b.bandLabel} ·{" "}
                          {dateLong(b.startDate)} → {dateLong(b.endDate)}
                        </p>
                      </div>
                      <p className="font-semibold">{kes(b.amountPaidKes)}</p>
                    </div>
                  </Card>
                ))}
              </div>
            </section>
          ) : null}

          <p className="text-sm text-muted-foreground">
            Need help with a rental? Call{" "}
            <a href={PHONE_TEL} className="text-primary underline">
              {CONTACT.phoneDisplay}
            </a>{" "}
            or email{" "}
            <a href={`mailto:${CONTACT.supportEmail}`} className="text-primary underline">
              {CONTACT.supportEmail}
            </a>
            .
          </p>
        </div>
      )}

      {/* ------------------------------- change dialog ---------------------- */}
      <Dialog open={changing !== null} onOpenChange={(open) => (open ? null : setChanging(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {changing?.mode === "RESCHEDULE" ? "Request new dates" : "Request cancellation"}
            </DialogTitle>
            <DialogDescription>
              {changing?.mode === "RESCHEDULE"
                ? "Keep the same number of days so the price stays as quoted. We confirm the new dates only if a vehicle of your class is free."
                : "Our commercial desk will confirm the cancellation and any refund with you directly."}
            </DialogDescription>
          </DialogHeader>

          {changing?.mode === "RESCHEDULE" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="new-start">New collection date</Label>
                <Input id="new-start" type="date" value={newStart} onChange={(e) => setNewStart(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="new-end">New return date</Label>
                <Input id="new-end" type="date" value={newEnd} onChange={(e) => setNewEnd(e.target.value)} />
              </div>
            </div>
          ) : null}

          <div>
            <Label htmlFor="change-reason">
              {changing?.mode === "CANCELLATION" ? "Why are you cancelling?" : "Anything we should know? (optional)"}
            </Label>
            <Textarea id="change-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
          </div>

          {refusal ? (
            <Alert variant="destructive">
              <AlertDescription>{refusal}</AlertDescription>
            </Alert>
          ) : null}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setChanging(null)}>
              Close
            </Button>
            <Button onClick={submitChange} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Send request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </RiderShell>
  );
}
