/**
 * Bookings on the provider portal: turn an acknowledged customer enquiry into a
 * booking with the agreed rate, move it through confirmed and delivered, and see
 * the proforma and invoice raised against it. Money documents remain the
 * commercial team's action — the operator only sees the references.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/hooks/use-toast";
import { CalendarCheck, FileText, Receipt } from "lucide-react";
import {
  BOOKING_STATUS_LABEL, bookingMoney, bookingToProforma, createBooking, explainBookingRefusal,
  linkBookingInvoice, loadProviderBookings, setBookingStatus,
  type BookingStatus, type NewBooking, type ProviderBookingRow,
} from "@/lib/provider/bookings";
import type { CapacityEnquiryRow } from "@/lib/provider/capacity";

const TONE: Record<BookingStatus, string> = {
  REQUESTED: "border-border bg-muted text-muted-foreground",
  CONFIRMED:
    "border-[hsl(var(--status-info)/0.45)] bg-[hsl(var(--status-info)/0.12)] text-[hsl(var(--status-info))]",
  DELIVERED:
    "border-[hsl(var(--status-success)/0.45)] bg-[hsl(var(--status-success)/0.12)] text-[hsl(var(--status-success))]",
  CANCELLED: "border-destructive/40 bg-destructive/10 text-destructive",
};

const dt = (v: string | null) =>
  v ? new Date(v).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" }) : "—";

function BookingForm({
  enquiry,
  currency,
  onDone,
  onCancel,
}: {
  enquiry: CapacityEnquiryRow;
  currency: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [form, setForm] = React.useState<NewBooking>({
    enquiry_id: enquiry.id,
    customer_company: enquiry.organisation_name ?? "",
    customer_contact_name: enquiry.contact_name ?? "",
    customer_email: "",
    customer_phone: "",
    service_from: enquiry.service_date ?? "",
    service_to: "",
    qty: "1",
    unit_rate: "",
    currency,
    notes: enquiry.requirement ?? "",
  });
  const set = (k: keyof NewBooking) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = useMutation({
    mutationFn: () => createBooking(form),
    onSuccess: (r) => {
      toast({ title: "Booking raised", description: `Reference ${r.booking_reference}.` });
      onDone();
    },
    onError: (e: Error) =>
      toast({ title: "Not raised", description: explainBookingRefusal(e.message), variant: "destructive" }),
  });

  const valid = Number(form.unit_rate) > 0 && (form.customer_company ?? "").trim().length > 0;

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`bk-co-${enquiry.id}`}>Customer company</Label>
          <Input id={`bk-co-${enquiry.id}`} value={form.customer_company} onChange={set("customer_company")} />
        </div>
        <div>
          <Label htmlFor={`bk-ct-${enquiry.id}`}>Contact person</Label>
          <Input id={`bk-ct-${enquiry.id}`} value={form.customer_contact_name} onChange={set("customer_contact_name")} />
        </div>
        <div>
          <Label htmlFor={`bk-em-${enquiry.id}`}>Email</Label>
          <Input id={`bk-em-${enquiry.id}`} type="email" value={form.customer_email} onChange={set("customer_email")} />
        </div>
        <div>
          <Label htmlFor={`bk-ph-${enquiry.id}`}>Phone</Label>
          <Input id={`bk-ph-${enquiry.id}`} value={form.customer_phone} onChange={set("customer_phone")} />
        </div>
        <div>
          <Label htmlFor={`bk-df-${enquiry.id}`}>Service from</Label>
          <Input id={`bk-df-${enquiry.id}`} type="date" value={form.service_from} onChange={set("service_from")} />
        </div>
        <div>
          <Label htmlFor={`bk-dtt-${enquiry.id}`}>Service to</Label>
          <Input id={`bk-dtt-${enquiry.id}`} type="date" value={form.service_to} onChange={set("service_to")} />
        </div>
        <div>
          <Label htmlFor={`bk-q-${enquiry.id}`}>Quantity (days, trips or units)</Label>
          <Input id={`bk-q-${enquiry.id}`} inputMode="decimal" value={form.qty} onChange={set("qty")} />
        </div>
        <div>
          <Label htmlFor={`bk-r-${enquiry.id}`}>Agreed rate ({currency}) per unit</Label>
          <Input id={`bk-r-${enquiry.id}`} inputMode="decimal" value={form.unit_rate} onChange={set("unit_rate")} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        The rate you enter is the rate invoiced. Nothing is estimated on your behalf.
      </p>
      <div className="flex gap-2">
        <Button size="sm" disabled={!valid || save.isPending} onClick={() => save.mutate()}>
          Raise booking
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function BookingCard({ row, onChanged }: { row: ProviderBookingRow; onChanged: () => void }) {
  const [note, setNote] = React.useState("");
  const [invoiceRef, setInvoiceRef] = React.useState("");

  const move = useMutation({
    mutationFn: (s: "CONFIRMED" | "DELIVERED" | "CANCELLED") => setBookingStatus(row.id, s, note),
    onSuccess: () => { toast({ title: "Booking updated" }); onChanged(); },
    onError: (e: Error) =>
      toast({ title: "Not updated", description: explainBookingRefusal(e.message), variant: "destructive" }),
  });

  const proforma = useMutation({
    mutationFn: () => bookingToProforma(row.id),
    onSuccess: () => {
      toast({ title: "Proforma raised", description: "It is a draft in the proforma register." });
      onChanged();
    },
    onError: (e: Error) =>
      toast({ title: "No proforma raised", description: explainBookingRefusal(e.message), variant: "destructive" }),
  });

  const linkInvoice = useMutation({
    mutationFn: () => linkBookingInvoice(row.id, invoiceRef),
    onSuccess: () => { toast({ title: "Invoice recorded" }); onChanged(); },
    onError: (e: Error) =>
      toast({ title: "Not recorded", description: explainBookingRefusal(e.message), variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">{row.capacity_title}</CardTitle>
            <CardDescription>
              {row.booking_reference} · {row.customer_company ?? "Customer"}
              {row.service_from ? ` · ${row.service_from}` : ""}
            </CardDescription>
          </div>
          <Badge variant="outline" className={TONE[row.status]}>
            {BOOKING_STATUS_LABEL[row.status]}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>
          {bookingMoney(row.amount_cents, row.currency)}
          <span className="text-muted-foreground">
            {" "}({row.qty} × {bookingMoney(row.unit_rate_cents, row.currency)})
          </span>
        </p>
        {row.notes && <p className="whitespace-pre-line text-muted-foreground">{row.notes}</p>}

        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant="outline">
            <FileText className="mr-1 h-3 w-3" aria-hidden />
            {row.proforma_reference ?? (row.proforma_id ? "Proforma raised" : "No proforma yet")}
          </Badge>
          <Badge variant="outline">
            <Receipt className="mr-1 h-3 w-3" aria-hidden />
            {row.invoice_reference ?? "No invoice yet"}
          </Badge>
        </div>

        {row.status !== "CANCELLED" && (
          <>
            <Input
              className="h-9"
              placeholder="Note (required to cancel)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              {row.status === "REQUESTED" && (
                <Button size="sm" disabled={move.isPending} onClick={() => move.mutate("CONFIRMED")}>
                  Confirm
                </Button>
              )}
              {row.status === "CONFIRMED" && (
                <Button size="sm" disabled={move.isPending} onClick={() => move.mutate("DELIVERED")}>
                  Mark delivered
                </Button>
              )}
              {row.status !== "DELIVERED" && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!note.trim() || move.isPending}
                  onClick={() => move.mutate("CANCELLED")}
                >
                  Cancel booking
                </Button>
              )}
              {!row.proforma_id && row.status !== "REQUESTED" && (
                <Button size="sm" variant="outline" disabled={proforma.isPending} onClick={() => proforma.mutate()}>
                  Raise proforma
                </Button>
              )}
            </div>
          </>
        )}

        {row.proforma_id && !row.invoice_reference && (
          <div className="flex gap-2">
            <Input
              className="h-9"
              placeholder="Issued invoice number"
              value={invoiceRef}
              onChange={(e) => setInvoiceRef(e.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!invoiceRef.trim() || linkInvoice.isPending}
              onClick={() => linkInvoice.mutate()}
            >
              Record invoice
            </Button>
          </div>
        )}

        {row.history.length > 0 && (
          <>
            <Separator />
            <ol className="space-y-1 text-xs text-muted-foreground">
              {row.history.slice(0, 5).map((h, i) => (
                <li key={i}>
                  {dt(h.created_at)} — {h.action.replace(/_/g, " ").toLowerCase()}
                  {h.note ? ` — “${h.note}”` : ""}
                </li>
              ))}
            </ol>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function ProviderBookings({
  enquiries,
  currency = "KES",
  onChanged,
}: {
  enquiries: CapacityEnquiryRow[];
  currency?: string;
  onChanged?: () => void;
}) {
  const qc = useQueryClient();
  const [booking, setBooking] = React.useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["provider-bookings"],
    queryFn: loadProviderBookings,
  });

  const refresh = () => {
    setBooking(null);
    qc.invalidateQueries({ queryKey: ["provider-bookings"] });
    onChanged?.();
  };

  const rows = data ?? [];
  const bookedEnquiries = new Set(rows.map((r) => r.booking_reference));
  const openEnquiries = enquiries.filter((e) => e.status !== "CLOSED");
  const totalBillable = rows
    .filter((r) => r.status === "CONFIRMED" || r.status === "DELIVERED")
    .reduce((s, r) => s + r.amount_cents, 0);

  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <CalendarCheck className="h-4 w-4" aria-hidden /> Bookings
      </h2>

      <div className="flex flex-wrap gap-2">
        <Badge variant="outline">{rows.length} bookings</Badge>
        <Badge variant="outline">{bookedEnquiries.size ? bookingMoney(totalBillable, "KES") : "KES 0"} confirmed value</Badge>
        <Badge variant="outline">{rows.filter((r) => r.invoice_reference).length} invoiced</Badge>
      </div>

      {openEnquiries.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Turn an enquiry into a booking</CardTitle>
            <CardDescription>
              Agree the dates and the rate with the customer, then raise the booking so it can be invoiced.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {openEnquiries.map((e) => (
              <div key={e.id} className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span>
                    {e.capacity_title} — {e.organisation_name ?? "Customer"}
                    {e.service_date ? ` · ${e.service_date}` : ""}
                  </span>
                  <Button
                    size="sm"
                    variant={booking === e.id ? "ghost" : "outline"}
                    onClick={() => setBooking(booking === e.id ? null : e.id)}
                  >
                    {booking === e.id ? "Close" : "Raise booking"}
                  </Button>
                </div>
                {booking === e.id && (
                  <BookingForm
                    enquiry={e}
                    currency={currency}
                    onDone={refresh}
                    onCancel={() => setBooking(null)}
                  />
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {isLoading ? null : rows.length === 0 ? (
        <Card>
          <CardHeader>
            <CardDescription>
              No bookings yet. A booking is created when you agree dates and a rate against a customer
              enquiry.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {rows.map((r) => (
            <BookingCard key={r.id} row={r} onChanged={refresh} />
          ))}
        </div>
      )}
    </section>
  );
}

export default ProviderBookings;
