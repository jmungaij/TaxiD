/**
 * Public rental quote form (self-drive and chauffeured).
 *
 * The form collects facts only. Every shilling shown after submission is
 * computed by the `rental-quote` function from the published rate card, so the
 * figure the customer sees is the figure the platform recorded. When no rate
 * card is published the server refuses to quote and the customer is routed to
 * the commercial desk rather than shown an invented price.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, CalendarDays, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CONTACT, PHONE_TEL } from "@/config/contact";
import { kes, type PublicRateCard } from "@/lib/marketing/publicRateCard";
import { createRentalQuote, type RentalCategory } from "@/lib/marketing/rentalQuote";
import { trackRentalQuoteRequest } from "@/lib/marketing/rentalsFunnel";
import {
  AVAILABILITY_MESSAGE,
  availabilityKey,
  fetchRentalAvailability,
  type RentalAvailability,
} from "@/lib/marketing/rentalAvailability";

interface Props {
  category: RentalCategory;
  /** Published rate card already loaded by the page (null = nothing published). */
  rateCard: PublicRateCard | null;
  pageRoute: string;
  /** Copy shown above the form. */
  heading?: string;
  intro?: string;
}

const today = () => new Date().toISOString().slice(0, 10);

/** A band is identified by class + label + seats, which is unique on the card. */
const bandKey = (assetClass: string, label: string, seats: number | null) =>
  `${assetClass}|${label}|${seats ?? 0}`;

export function RentalQuoteForm({ category, rateCard, pageRoute, heading, intro }: Props) {
  const navigate = useNavigate();
  const startedAt = useRef(Date.now());

  const [vehicle, setVehicle] = useState("");
  const [startDate, setStartDate] = useState("");
  const [days, setDays] = useState("1");
  const [extraHours, setExtraHours] = useState("0");
  const [expectedKm, setExpectedKm] = useState("");
  const [pickup, setPickup] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [notes, setNotes] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [availability, setAvailability] = useState<RentalAvailability | null>(null);
  const [checkingStock, setCheckingStock] = useState(false);

  /**
   * Real stock for the chosen window. Availability is computed on the server
   * from the fleet register, so a class is only ever offered when a genuine
   * vehicle of that class is free for those dates.
   */
  useEffect(() => {
    if (!startDate) {
      setAvailability(null);
      return;
    }
    const requestedDays = Math.max(1, Math.min(365, Number(days) || 1));
    let cancelled = false;
    setCheckingStock(true);
    void fetchRentalAvailability(category, startDate, requestedDays).then((result) => {
      if (cancelled) return;
      setAvailability(result);
      setCheckingStock(false);
    });
    return () => {
      cancelled = true;
    };
  }, [category, startDate, days]);

  const freeByKey = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of availability?.classes ?? []) {
      map.set(availabilityKey(c.assetClass, c.bandLabel), c.unitsFree);
    }
    return map;
  }, [availability]);

  /** Clear a chosen class that stops being free when the dates change. */
  useEffect(() => {
    if (!vehicle || !availability?.ok) return;
    const [assetClass, label] = vehicle.split("|");
    if (!freeByKey.has(availabilityKey(assetClass, label))) setVehicle("");
  }, [freeByKey, availability, vehicle]);

  const allBands = useMemo(() => rateCard?.rows ?? [], [rateCard]);
  /**
   * Before a date is chosen we show the published classes. Once the window is
   * known we show only the classes with a vehicle genuinely free for it.
   */
  const bands = useMemo(() => {
    if (!availability?.ok) return allBands;
    return allBands.filter((b) => freeByKey.has(availabilityKey(b.assetClass, b.label)));
  }, [allBands, availability, freeByKey]);
  const selected = useMemo(
    () => bands.find((b) => bandKey(b.assetClass, b.label, b.seats) === vehicle) ?? null,
    [bands, vehicle],
  );

  /** Indicative figure so the customer is never surprised; server is truth. */
  const indicative = useMemo(() => {
    if (!selected) return null;
    const d = Math.max(1, Math.min(365, Number(days) || 1));
    const eh = Math.max(0, Math.min(12, Number(extraHours) || 0));
    const km = Math.max(0, Number(expectedKm) || 0);
    const included = selected.includedKmPerDay * d;
    const subtotal =
      selected.minKes * d + selected.extraHourKes * eh + Math.max(0, km - included) * selected.perKmKes;
    return Math.round(subtotal * (1 + selected.vatPct / 100));
  }, [selected, days, extraHours, expectedKm]);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setFormError(null);
    setFieldErrors({});

    if (!selected) {
      setFieldErrors({ asset_class: "Choose a vehicle class." });
      return;
    }

    setSubmitting(true);
    trackRentalQuoteRequest("quote", {
      category: category === "SELF_DRIVE" ? "self-drive" : "chauffeur",
      surface: "quote-form",
      pageRoute,
      target: "rental-quote",
    });

    const outcome = await createRentalQuote({
      category,
      assetClass: selected.assetClass,
      bandLabel: selected.label,
      seats: selected.seats,
      startDate,
      rentalDays: Math.trunc(Number(days) || 0),
      extraHours: Math.trunc(Number(extraHours) || 0),
      expectedKm: Math.trunc(Number(expectedKm) || 0),
      pickupLocation: pickup,
      notes: notes.trim() || undefined,
      contactName: name,
      contactEmail: email,
      contactPhone: phone,
      companyName: company.trim() || undefined,
      sourcePage: pageRoute,
      website: honeypot,
    });

    setSubmitting(false);

    if (outcome.ok === true) {
      navigate(`/rentals/quote/${outcome.receipt.token}`);
      return;
    }

    setFieldErrors(outcome.fields ?? {});
    setFormError(outcome.message);
  };

  const err = (key: string) =>
    fieldErrors[key] ? <p className="mt-1 text-sm text-destructive">{fieldErrors[key]}</p> : null;

  if (!rateCard) {
    return (
      <div className="rounded-xl border bg-card p-6">
        <h2 className="text-xl font-semibold">{heading ?? "Request a quotation"}</h2>
        <p className="mt-2 text-muted-foreground">
          Rates are confirmed on quotation right now. Call the commercial desk on{" "}
          <a href={PHONE_TEL} className="font-medium text-primary underline">
            {CONTACT.phoneDisplay}
          </a>{" "}
          or email{" "}
          <a href={`mailto:${CONTACT.salesEmail}`} className="font-medium text-primary underline">
            {CONTACT.salesEmail}
          </a>{" "}
          and we will price your request directly.
        </p>
      </div>
    );
  }

  const elapsedSeconds = Math.round((Date.now() - startedAt.current) / 1000);

  return (
    <form onSubmit={onSubmit} className="rounded-xl border bg-card p-6 shadow-sm" noValidate>
      <h2 className="text-xl font-semibold">{heading ?? "Get a firm quote"}</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {intro ??
          `Priced from rate card v${rateCard.version}. You will see the full breakdown, a reference and a payment link before you commit.`}
      </p>

      <div className="mt-6 grid gap-5 md:grid-cols-2">
        <div className="md:col-span-2">
          <Label htmlFor="rq-vehicle">Vehicle class</Label>
          <Select value={vehicle} onValueChange={setVehicle}>
            <SelectTrigger id="rq-vehicle" className="mt-1">
              <SelectValue placeholder="Choose a vehicle class" />
            </SelectTrigger>
            <SelectContent>
              {bands.map((b) => (
                <SelectItem key={bandKey(b.assetClass, b.label, b.seats)} value={bandKey(b.assetClass, b.label, b.seats)}>
                  {b.label}
                  {b.seats ? ` — ${b.seats} seats` : ""} · from {kes(b.minKes)}/day
                  {freeByKey.has(availabilityKey(b.assetClass, b.label))
                    ? ` · ${freeByKey.get(availabilityKey(b.assetClass, b.label))} free`
                    : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {err("asset_class")}
          {selected ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Includes {selected.includedKmPerDay} km per day. Extra distance is metered at{" "}
              {kes(selected.perKmKes)}/km and extra hours at {kes(selected.extraHourKes)}/hour. VAT {selected.vatPct}%.
            </p>
          ) : null}
        </div>

        <div>
          <Label htmlFor="rq-start">Collection date</Label>
          <Input
            id="rq-start"
            type="date"
            min={today()}
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="mt-1"
            required
          />
          {err("start_date")}
        </div>

        <div>
          <Label htmlFor="rq-days">Duration (days)</Label>
          <Input
            id="rq-days"
            type="number"
            inputMode="numeric"
            min={1}
            max={365}
            value={days}
            onChange={(e) => setDays(e.target.value)}
            className="mt-1"
            required
          />
          {err("rental_days")}
        </div>

        <div>
          <Label htmlFor="rq-km">Distance you expect to cover (km)</Label>
          <Input
            id="rq-km"
            type="number"
            inputMode="numeric"
            min={0}
            value={expectedKm}
            onChange={(e) => setExpectedKm(e.target.value)}
            placeholder="e.g. 400"
            className="mt-1"
            required
          />
          {err("expected_km")}
        </div>

        <div>
          <Label htmlFor="rq-hours">Extra hours per day (optional)</Label>
          <Input
            id="rq-hours"
            type="number"
            inputMode="numeric"
            min={0}
            max={12}
            value={extraHours}
            onChange={(e) => setExtraHours(e.target.value)}
            className="mt-1"
          />
          {err("extra_hours")}
        </div>

        <div className="md:col-span-2">
          <Label htmlFor="rq-pickup">
            {category === "SELF_DRIVE" ? "Collection or delivery location" : "Pick-up location"}
          </Label>
          <Input
            id="rq-pickup"
            value={pickup}
            onChange={(e) => setPickup(e.target.value)}
            placeholder="e.g. Westlands, Nairobi"
            className="mt-1"
            required
          />
          {err("pickup_location")}
        </div>

        <div>
          <Label htmlFor="rq-name">Your name</Label>
          <Input id="rq-name" value={name} onChange={(e) => setName(e.target.value)} className="mt-1" required />
          {err("contact_name")}
        </div>

        <div>
          <Label htmlFor="rq-company">Company (optional)</Label>
          <Input id="rq-company" value={company} onChange={(e) => setCompany(e.target.value)} className="mt-1" />
        </div>

        <div>
          <Label htmlFor="rq-email">Email</Label>
          <Input
            id="rq-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1"
            required
          />
          {err("contact_email")}
        </div>

        <div>
          <Label htmlFor="rq-phone">M-Pesa phone number</Label>
          <Input
            id="rq-phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="0712 345 678"
            className="mt-1"
            required
          />
          {err("contact_phone")}
        </div>

        <div className="md:col-span-2">
          <Label htmlFor="rq-notes">Anything we should know? (optional)</Label>
          <Textarea
            id="rq-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="mt-1"
            placeholder={
              category === "SELF_DRIVE"
                ? "Driver age, upcountry travel, child seats…"
                : "Airport transfers, multi-day itinerary, guest list size…"
            }
          />
        </div>

        {/* Bot trap — visually hidden, never focusable for a real visitor. */}
        <div className="hidden" aria-hidden="true">
          <label htmlFor="rq-website">Website</label>
          <input id="rq-website" tabIndex={-1} value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
        </div>
      </div>

      {startDate ? (
        <div className="mt-4">
          {checkingStock ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking which vehicles are free on those dates…
            </p>
          ) : availability?.ok === false ? (
            <Alert variant="destructive">
              <AlertDescription>
                {AVAILABILITY_MESSAGE[availability.reasonCode ?? ""] ?? "We could not check availability."}
              </AlertDescription>
            </Alert>
          ) : availability && availability.classes.length === 0 ? (
            <Alert>
              <AlertDescription>
                No vehicle is free from {availability.startDate} to {availability.endDate}. Try different dates, or
                call{" "}
                <a href={PHONE_TEL} className="underline">
                  {CONTACT.phoneDisplay}
                </a>{" "}
                and the commercial desk will find you an option.
              </AlertDescription>
            </Alert>
          ) : availability ? (
            <p className="text-sm text-muted-foreground">
              {availability.classes.reduce((n, c) => n + c.unitsFree, 0)} vehicle
              {availability.classes.reduce((n, c) => n + c.unitsFree, 0) === 1 ? "" : "s"} free from{" "}
              {availability.startDate} to {availability.endDate}.
            </p>
          ) : null}
        </div>
      ) : null}

      {indicative !== null ? (
        <div className="mt-6 rounded-lg border bg-secondary/40 p-4">
          <p className="text-sm text-muted-foreground">Indicative total, VAT included</p>
          <p className="text-2xl font-semibold">{kes(indicative)}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            The binding figure is calculated on the server from rate card v{rateCard.version} when you submit.
          </p>
        </div>
      ) : null}

      {formError ? (
        <Alert variant="destructive" className="mt-6">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <Button type="submit" size="lg" disabled={submitting || checkingStock || bands.length === 0}>
          {submitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Pricing your request
            </>
          ) : (
            <>
              Get my quote <ArrowRight className="ml-2 h-4 w-4" />
            </>
          )}
        </Button>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <ShieldCheck className="h-4 w-4" /> No payment is taken on this step.
        </p>
      </div>

      <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
        <CalendarDays className="h-3.5 w-3.5" />
        Quotations stand for 7 days. Prefer to talk? Call{" "}
        <a href={PHONE_TEL} className="underline">
          {CONTACT.phoneDisplay}
        </a>
        .
      </p>
      <input type="hidden" name="elapsed" value={elapsedSeconds} />
    </form>
  );
}
