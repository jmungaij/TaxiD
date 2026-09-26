/**
 * BOOK A MOVEMENT FOR A LEAD.
 *
 * Two explicit steps, both server-side: the platform prices the movement from
 * the tariff in force, then — only after the specialist has seen that price —
 * converts it into a live booking and requests capacity. No price is ever
 * shown or stored that the pricing engine did not produce.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { Truck } from "lucide-react";
import {
  bookQuotedMovement,
  quoteMovement,
  CARGO_TYPES,
  DISTANCE_BANDS,
  VEHICLE_CLASSES,
  VEHICLE_CLASS_LABEL,
  type CargoType,
  type DistanceBand,
  type MovementRequest,
  type QuoteResult,
  type VehicleClass,
} from "@/lib/sales/booking";
import type { SalesLead } from "@/lib/sales/pipeline";

const KES = (n: number) =>
  new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(n);

const BAND_LABEL: Record<DistanceBand, string> = {
  INTRA_CITY: "Within one city",
  REGIONAL: "Regional",
  LONG_HAUL: "Long haul",
};

function isoLocal(date: string, time: string) {
  if (!date) return "";
  return new Date(`${date}T${time || "08:00"}:00`).toISOString();
}

export default function BookMovementDialog({
  lead,
  onBooked,
}: {
  lead: SalesLead;
  onBooked: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [quote, setQuote] = React.useState<QuoteResult | null>(null);
  const [busy, setBusy] = React.useState<"quote" | "book" | null>(null);
  const [form, setForm] = React.useState({
    originLabel: lead.origin_label ?? "",
    destinationLabel: lead.destination_label ?? "",
    originLat: "",
    originLng: "",
    destinationLat: "",
    destinationLng: "",
    vehicleClass: "TRUCK_3T" as VehicleClass,
    cargoType: "GENERAL" as CargoType,
    grossWeightKg: "",
    pieces: "1",
    volumeCbm: "",
    declaredValueKes: "",
    distanceKm: "",
    distanceBand: "REGIONAL" as DistanceBand,
    pickupDate: lead.service_date ?? "",
    pickupTime: "08:00",
    pickupEndTime: "12:00",
    notes: "",
  });

  const set = (k: keyof typeof form) => (v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setQuote(null);
  };
  const onInput =
    (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      set(k)(e.target.value);

  const request = (): MovementRequest => ({
    originLabel: form.originLabel.trim(),
    destinationLabel: form.destinationLabel.trim(),
    originLat: Number(form.originLat),
    originLng: Number(form.originLng),
    destinationLat: Number(form.destinationLat),
    destinationLng: Number(form.destinationLng),
    vehicleClass: form.vehicleClass,
    cargoType: form.cargoType,
    grossWeightKg: Number(form.grossWeightKg),
    pieces: Number(form.pieces || 1),
    volumeCbm: form.volumeCbm ? Number(form.volumeCbm) : 0,
    declaredValueKes: form.declaredValueKes ? Number(form.declaredValueKes) : 0,
    distanceKm: form.distanceKm ? Number(form.distanceKm) : undefined,
    distanceBand: form.distanceKm ? undefined : form.distanceBand,
    pickupWindowStart: isoLocal(form.pickupDate, form.pickupTime),
    pickupWindowEnd: isoLocal(form.pickupDate, form.pickupEndTime),
    shipperName: lead.contact_name,
    shipperPhone: lead.contact_phone ?? undefined,
    notes: form.notes.trim() || undefined,
  });

  const coordsGiven =
    Number.isFinite(Number(form.originLat)) &&
    form.originLat.trim() !== "" &&
    form.originLng.trim() !== "" &&
    form.destinationLat.trim() !== "" &&
    form.destinationLng.trim() !== "";

  const ready =
    form.originLabel.trim() &&
    form.destinationLabel.trim() &&
    coordsGiven &&
    Number(form.grossWeightKg) > 0 &&
    form.pickupDate;


  const getPrice = async () => {
    setBusy("quote");
    try {
      const res = await quoteMovement(request());
      setQuote(res);
      if (!res.quotable) {
        toast({
          title: "This movement cannot be priced",
          description: res.message ?? res.code ?? "No tariff in force for this movement.",
          variant: "destructive",
        });
      }
    } catch (e) {
      toast({
        title: "Price not returned",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  const confirmBooking = async () => {
    if (!quote?.quote_id) return;
    setBusy("book");
    try {
      const req = request();
      const res = await bookQuotedMovement({
        leadId: lead.id,
        quoteId: quote.quote_id,
        quoteNumber: quote.quote_number ?? "",
        pickupWindowStart: req.pickupWindowStart,
        pickupWindowEnd: req.pickupWindowEnd,
      });
      toast({
        title: `Booked — ${res.order_number}`,
        description: res.request_number
          ? `Capacity requested: ${res.request_number}${res.matching_status ? ` (${res.matching_status})` : ""}`
          : "Booking created.",
      });
      setOpen(false);
      setQuote(null);
      onBooked();
    } catch (e) {
      toast({
        title: "Booking refused",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Truck className="mr-1.5 h-4 w-4" aria-hidden /> Book the movement
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Book for {lead.organisation_name}</DialogTitle>
          <DialogDescription>
            The platform prices the movement first. You see the price before anything is committed.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="bk-from">Collect from</Label>
            <Input id="bk-from" value={form.originLabel} onChange={onInput("originLabel")} />
          </div>
          <div>
            <Label htmlFor="bk-to">Deliver to</Label>
            <Input id="bk-to" value={form.destinationLabel} onChange={onInput("destinationLabel")} />
          </div>
          <div className="sm:col-span-2 rounded-md border border-border bg-muted/30 p-3">
            <p className="text-sm font-medium">Map points</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Needed so the platform can work out which trucks are close enough to collect. Without
              them no vehicle can be assigned.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-4">
              <div>
                <Label htmlFor="bk-olat">Collection latitude</Label>
                <Input
                  id="bk-olat"
                  type="number"
                  step="0.000001"
                  placeholder="-1.3086"
                  value={form.originLat}
                  onChange={onInput("originLat")}
                />
              </div>
              <div>
                <Label htmlFor="bk-olng">Collection longitude</Label>
                <Input
                  id="bk-olng"
                  type="number"
                  step="0.000001"
                  placeholder="36.8514"
                  value={form.originLng}
                  onChange={onInput("originLng")}
                />
              </div>
              <div>
                <Label htmlFor="bk-dlat">Delivery latitude</Label>
                <Input
                  id="bk-dlat"
                  type="number"
                  step="0.000001"
                  placeholder="-0.3031"
                  value={form.destinationLat}
                  onChange={onInput("destinationLat")}
                />
              </div>
              <div>
                <Label htmlFor="bk-dlng">Delivery longitude</Label>
                <Input
                  id="bk-dlng"
                  type="number"
                  step="0.000001"
                  placeholder="36.0800"
                  value={form.destinationLng}
                  onChange={onInput("destinationLng")}
                />
              </div>
            </div>
          </div>

          <div>
            <Label>Vehicle</Label>
            <Select value={form.vehicleClass} onValueChange={(v) => set("vehicleClass")(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VEHICLE_CLASSES.map((v) => (
                  <SelectItem key={v} value={v}>
                    {VEHICLE_CLASS_LABEL[v]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Goods</Label>
            <Select value={form.cargoType} onValueChange={(v) => set("cargoType")(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CARGO_TYPES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c.charAt(0) + c.slice(1).toLowerCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="bk-weight">Total weight (kg)</Label>
            <Input
              id="bk-weight"
              type="number"
              min="1"
              value={form.grossWeightKg}
              onChange={onInput("grossWeightKg")}
            />
          </div>
          <div>
            <Label htmlFor="bk-pieces">Number of items</Label>
            <Input id="bk-pieces" type="number" min="1" value={form.pieces} onChange={onInput("pieces")} />
          </div>
          <div>
            <Label htmlFor="bk-vol">Volume (m³, optional)</Label>
            <Input id="bk-vol" type="number" min="0" step="0.01" value={form.volumeCbm} onChange={onInput("volumeCbm")} />
          </div>
          <div>
            <Label htmlFor="bk-value">Declared value (KES, optional)</Label>
            <Input
              id="bk-value"
              type="number"
              min="0"
              value={form.declaredValueKes}
              onChange={onInput("declaredValueKes")}
            />
          </div>
          <div>
            <Label htmlFor="bk-km">Distance (km, if known)</Label>
            <Input id="bk-km" type="number" min="1" value={form.distanceKm} onChange={onInput("distanceKm")} />
          </div>
          <div>
            <Label>Otherwise, distance range</Label>
            <Select
              value={form.distanceBand}
              onValueChange={(v) => set("distanceBand")(v)}
              disabled={!!form.distanceKm}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DISTANCE_BANDS.map((b) => (
                  <SelectItem key={b} value={b}>
                    {BAND_LABEL[b]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="bk-date">Collection date</Label>
            <Input id="bk-date" type="date" value={form.pickupDate} onChange={onInput("pickupDate")} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="bk-t1">From</Label>
              <Input id="bk-t1" type="time" value={form.pickupTime} onChange={onInput("pickupTime")} />
            </div>
            <div>
              <Label htmlFor="bk-t2">Until</Label>
              <Input id="bk-t2" type="time" value={form.pickupEndTime} onChange={onInput("pickupEndTime")} />
            </div>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="bk-notes">Instructions for the driver</Label>
            <Textarea id="bk-notes" rows={2} value={form.notes} onChange={onInput("notes")} />
          </div>
        </div>

        {quote?.quotable && (
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <p className="font-semibold">
              {quote.total_amount != null ? KES(quote.total_amount) : "PRICE NOT RETURNED"}
              <span className="ml-2 font-normal text-muted-foreground">
                quote {quote.quote_number}
                {quote.distance_km ? ` · ${quote.distance_km} km` : ""}
              </span>
            </p>
            <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
              {(quote.lines ?? []).map((l, i) => (
                <li key={`${l.code ?? i}`} className="flex justify-between gap-4">
                  <span>{l.label ?? l.code}</span>
                  <span>{l.amount_kes != null ? KES(l.amount_kes) : "—"}</span>
                </li>
              ))}
            </ul>
            {quote.valid_until && (
              <p className="mt-2 text-xs text-muted-foreground">
                Valid until {new Date(quote.valid_until).toLocaleString("en-KE")}
              </p>
            )}
          </div>
        )}

        {quote && !quote.quotable && (
          <p className="rounded-md border border-destructive/40 p-3 text-sm">
            {quote.message ?? "This movement cannot be priced from the tariff in force."}
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button size="sm" variant="secondary" disabled={!ready || busy !== null} onClick={getPrice}>
            {busy === "quote" ? "Pricing…" : "Get the price"}
          </Button>
          <Button
            size="sm"
            disabled={!quote?.quotable || busy !== null}
            onClick={confirmBooking}
          >
            {busy === "book" ? "Booking…" : "Confirm booking"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
