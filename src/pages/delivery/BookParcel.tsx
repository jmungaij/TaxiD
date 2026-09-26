/**
 * PARCEL & COURIER BOOKING — the live customer journey.
 *
 * Service discovery → shipment facts → goods compliance → authoritative quote
 * → acceptance → contacts → payment → shipment creation → tracking numbers.
 *
 * Nothing on this page decides price, eligibility, goods policy or service
 * availability: every one of those is returned by the logistics functions.
 * The page renders decisions and collects facts.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, CheckCircle2, Info, Loader2, PackageCheck, ShieldAlert, Truck } from "lucide-react";
import MarketingLayout from "@/components/marketing/MarketingLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { LogisticsErrorNotice } from "@/components/logistics/LogisticsErrorNotice";
import type { MappedLogisticsError } from "@/lib/logistics/errorContract";
import { useAuth } from "@/hooks/useAuth";
import { runMpesaCheckout } from "@/lib/payments/checkout";
import { settleBookingPayment } from "@/lib/logistics/booking/api";
import { CONTACT } from "@/config/contact";
import {
  DISTANCE_BAND_OPTIONS,
  GOODS_OPTIONS,
  bookingIdempotencyKey,
  createBooking,
  fetchServiceCatalogue,
  requestQuote,
  type BookingResult,
  type CatalogueOffering,
  type DistanceBand,
  type PackageType,
  type PaymentMethod,
  type QuoteResponse,
} from "@/lib/logistics/booking/api";

type Step = 1 | 2 | 3 | 4 | 5 | 6;

const STEP_LABELS: Record<Step, string> = {
  1: "Service",
  2: "Route",
  3: "Package",
  4: "Price",
  5: "Payment",
  6: "Confirmed",
};

const PAYMENT_OPTIONS: { code: PaymentMethod; label: string; note: string; enabled: boolean }[] = [
  { code: "MPESA", label: "M-Pesa", note: "You get an STK prompt on your phone.", enabled: true },
  { code: "INVOICE", label: "Pay on invoice", note: "For accounts with agreed credit terms.", enabled: true },
  { code: "CORPORATE_ACCOUNT", label: "Corporate account", note: "Billed to your company account.", enabled: true },
  { code: "CARD", label: "Card", note: "Card acquiring is not yet enabled.", enabled: false },
];

const kes = (n: number) => `KES ${n.toLocaleString("en-KE", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

const BookParcel = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, authLoading } = useAuth();

  // The marketing hero hands off complete route facts and asks us to resume at
  // the package step so the customer never re-types what they already gave us.
  const handoffStep = (() => {
    const raw = Number(params.get("step"));
    const hasRoute = Boolean(params.get("pickup")?.trim() && params.get("dropoff")?.trim());
    return hasRoute && raw >= 1 && raw <= 3 ? (raw as Step) : 1;
  })();
  const [step, setStep] = useState<Step>(handoffStep);
  const [catalogue, setCatalogue] = useState<CatalogueOffering[]>([]);
  const [catalogueError, setCatalogueError] = useState<string | null>(null);
  const [loadingCatalogue, setLoadingCatalogue] = useState(true);
  const [offeringCode, setOfferingCode] = useState<string>(params.get("offering") ?? "");

  // Route
  const [pickupAddress, setPickupAddress] = useState(params.get("pickup") ?? "");
  const [dropoffAddress, setDropoffAddress] = useState(params.get("dropoff") ?? "");
  const [distanceBand, setDistanceBand] = useState<DistanceBand>("KM_5_15");

  // Package
  const [packageType, setPackageType] = useState<PackageType>(() => {
    const handed = params.get("packageType") as PackageType | null;
    const allowed: PackageType[] = ["SMALL_PARCEL", "PARCEL", "DOCUMENT", "PALLET", "BULK"];
    return handed && allowed.includes(handed) ? handed : "PARCEL";
  });
  const [weightKg, setWeightKg] = useState(params.get("weight")?.replace(/[^\d.]/g, "") ?? "");
  const [packageCount, setPackageCount] = useState("1");
  const [dims, setDims] = useState({ l: "", w: "", h: "" });
  const [declaredValue, setDeclaredValue] = useState("");
  const [goodsCode, setGoodsCode] = useState("general_merchandise");
  const [goodsDescription, setGoodsDescription] = useState("");
  const [handling, setHandling] = useState<string[]>([]);

  // Contacts + payment
  const [senderName, setSenderName] = useState("");
  const [senderPhone, setSenderPhone] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("MPESA");

  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [booking, setBooking] = useState(false);
  const [paying, setPaying] = useState<string | null>(null);
  const [result, setResult] = useState<BookingResult | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [bookingError, setBookingError] = useState<string | null>(null);
  /** Canonical refusal (code, customer copy, operator facts) for the last attempt. */
  const [bookingFailure, setBookingFailure] = useState<MappedLogisticsError | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchServiceCatalogue()
      .then((offerings) => {
        if (cancelled) return;
        setCatalogue(offerings);
        setOfferingCode((current) => current || offerings.find((o) => o.selfServiceBookable)?.code || "");
      })
      .catch((e: Error) => !cancelled && setCatalogueError(e.message))
      .finally(() => !cancelled && setLoadingCatalogue(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const offering = useMemo(() => catalogue.find((o) => o.code === offeringCode) ?? null, [catalogue, offeringCode]);
  // Server truth: logistics-book refuses anything it does not mark bookable for
  // this caller, so the wizard must not walk the user to the payment step first.
  const bookable = offering?.selfServiceBookable === true;

  const dimsPayload = useMemo(() => {
    const l = Number(dims.l);
    const w = Number(dims.w);
    const h = Number(dims.h);
    return l > 0 && w > 0 && h > 0 ? { l, w, h } : null;
  }, [dims]);

  const facts = useMemo(
    () => ({
      offering_code: offeringCode,
      package_type: packageType,
      weight_kg: Number(weightKg) || 0,
      package_count: Number(packageCount) || 1,
      dimensions_cm: dimsPayload,
      declared_value_kes: declaredValue ? Number(declaredValue) : null,
      goods_code: goodsCode === "other" ? null : goodsCode,
      handling,
      distance_band: distanceBand,
    }),
    [offeringCode, packageType, weightKg, packageCount, dimsPayload, declaredValue, goodsCode, handling, distanceBand],
  );

  const getQuote = useCallback(async () => {
    setQuoting(true);
    setQuote(null);
    try {
      const response = await requestQuote(facts);
      setQuote(response);
      setStep(4);
    } catch (e) {
      toast({
        title: "Pricing unavailable",
        description: e instanceof Error ? e.message : "We could not price this shipment right now.",
        variant: "destructive",
      });
    } finally {
      setQuoting(false);
    }
  }, [facts, toast]);

  const confirmBooking = useCallback(async () => {
    if (!quote?.snapshot) return;
    setBooking(true);
    setBookingError(null);
    setBookingFailure(null);
    setFieldErrors({});

    const outcome = await createBooking({
      ...facts,
      goods_description: goodsDescription || null,
      pickup_details: { address: pickupAddress, contact_name: senderName, contact_phone: senderPhone },
      dropoff_details: { address: dropoffAddress, contact_name: recipientName, contact_phone: recipientPhone },
      payment_method: paymentMethod,
      notes: notes || null,
      idempotency_key: bookingIdempotencyKey(`${offeringCode}`),
      quoted_amount_kes: quote.snapshot.quoted_amount_kes,
    });

    setBooking(false);

    if (outcome.ok !== true) {
      const failure = outcome as Extract<typeof outcome, { ok: false }>;
      setFieldErrors(failure.fields ?? {});
      setBookingFailure(failure.mapped);
      setBookingError(failure.mapped.customer.detail);
      if (failure.repriced_amount_kes) {
        await getQuote();
      }
      return;
    }


    setResult(outcome.result);
    setStep(6);

    if (outcome.result.compliance_hold) {
      toast({
        title: "Booked — compliance check pending",
        description: outcome.result.compliance_message ?? "Our team will confirm before dispatch.",
      });
      return;
    }

    if (paymentMethod === "MPESA") {
      setPaying("Sending an M-Pesa prompt…");
      const checkout = await runMpesaCheckout(
        {
          amountKes: outcome.result.payment.amount_kes,
          phone: senderPhone,
          reference: outcome.result.payment.reference,
        },
        (p) => setPaying(p.message),
      );
      setPaying(null);

      // The provider — not the browser — decides whether the shipment is paid.
      // We ask the backend to settle against the verified M-Pesa ledger and we
      // display only what the backend confirms.
      const settlement = await settleBookingPayment(
        outcome.result.order.order_number,
        checkout.state === "paid" || checkout.state === "timeout" ? checkout.checkoutRequestId : null,
      );
      if (settlement.settled) {
        setResult((prev) =>
          prev ? { ...prev, order: { ...prev.order, payment_status: "paid" }, payment: { ...prev.payment, status: "paid" } } : prev,
        );
      }

      toast({
        title: settlement.settled
          ? "Payment confirmed"
          : checkout.state === "timeout"
            ? "Payment reconciling"
            : checkout.state === "duplicate"
              ? "Payment already in progress"
              : checkout.state === "paid"
                ? "Awaiting payment confirmation"
                : "Payment not completed",
        description: settlement.settled ? settlement.message : ((checkout as { message?: string }).message ?? settlement.message),
        variant: checkout.state === "failed" ? "destructive" : "default",
      });

    }
  }, [
    quote,
    facts,
    goodsDescription,
    pickupAddress,
    senderName,
    senderPhone,
    dropoffAddress,
    recipientName,
    recipientPhone,
    paymentMethod,
    notes,
    offeringCode,
    toast,
    getQuote,
  ]);

  const routeReady = pickupAddress.trim().length >= 5 && dropoffAddress.trim().length >= 5;
  const packageReady =
    Number(weightKg) > 0 &&
    (!offering?.dimensionsRequired || dimsPayload !== null) &&
    (!offering?.declaredValueRequired || Number(declaredValue) > 0);
  const contactsReady =
    senderName.trim().length >= 2 && senderPhone.trim().length >= 9 && recipientName.trim().length >= 2 && recipientPhone.trim().length >= 9;

  const toggleHandling = (code: string) =>
    setHandling((h) => (h.includes(code) ? h.filter((x) => x !== code) : [...h, code]));

  return (
    <MarketingLayout>
      <section className="border-b bg-muted/30">
        <div className="container mx-auto px-4 py-10">
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Book a delivery</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            Tell us what you are sending. We check what we are allowed to carry, price it from the rate card in force, and
            create the shipment with tracking numbers the moment you confirm.
          </p>
          <ol className="mt-6 flex flex-wrap gap-2" aria-label="Booking progress">
            {([1, 2, 3, 4, 5, 6] as Step[]).map((s) => (
              <li key={s}>
                <span
                  aria-current={s === step ? "step" : undefined}
                  className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${
                    s === step
                      ? "bg-primary text-primary-foreground"
                      : s < step
                        ? "bg-primary/10 text-primary"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {s}. {STEP_LABELS[s]}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="container mx-auto grid gap-6 px-4 py-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          {/* ------------------------------- 1. service ------------------------------ */}
          {step === 1 && (
            <Card>
              <CardHeader>
                <CardTitle>Choose a service</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {loadingCatalogue && (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading the service catalogue…
                  </p>
                )}
                {catalogueError && (
                  <Alert variant="destructive">
                    <AlertTitle>Service catalogue unavailable</AlertTitle>
                    <AlertDescription>
                      We could not load available services. Call {CONTACT.phoneDisplay} or email {CONTACT.supportEmail}.
                    </AlertDescription>
                  </Alert>
                )}
                {catalogue.map((o) => {
                  const selectable = o.selfServiceBookable;
                  return (
                    <button
                      key={o.code}
                      type="button"
                      onClick={() => setOfferingCode(o.code)}
                      aria-pressed={o.code === offeringCode}
                      className={`w-full rounded-xl border p-4 text-left transition-colors ${
                        o.code === offeringCode ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                      } ${selectable ? "" : "opacity-70"}`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{o.name}</span>
                        <Badge variant={selectable ? "default" : "secondary"}>
                          {selectable
                            ? "Book online"
                            : o.availability === "LIMITED" || o.availability === "PILOT_ONLY"
                              ? "Pilot — arranged by our team"
                              : o.availability === "ENQUIRY_ONLY"
                                ? "Enquiry only"
                                : o.availability === "CONFIGURATION_REQUIRED"
                                  ? "Being set up"
                                  : o.availability === "SUSPENDED"
                                    ? "Temporarily suspended"
                                    : "Unavailable"}
                        </Badge>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{o.slaQualifier}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {o.weightLimitKg.min}–{o.weightLimitKg.max} kg · proof of delivery: {o.podRequired.join(", ").toLowerCase()}
                      </p>
                      {!selectable && (
                        <p className="mt-2 text-xs font-medium text-muted-foreground">
                          {o.unavailableMessage ??
                            (o.availability === "LIMITED" || o.availability === "PILOT_ONLY"
                              ? "Running as a controlled pilot — send an enquiry and our team books it for you."
                              : "Priced per contract — request a quotation instead of booking online.")}
                        </p>
                      )}

                    </button>
                  );
                })}

                <div className="flex flex-wrap gap-3 pt-2">
                  {bookable ? (
                    <Button onClick={() => setStep(2)} disabled={!offering}>
                      Continue <ArrowRight className="ml-1 h-4 w-4" aria-hidden />
                    </Button>
                  ) : (
                    <Button asChild disabled={!offering}>
                      <Link to={`/delivery/enquiry?offering=${encodeURIComponent(offeringCode)}`}>
                        Send an enquiry <ArrowRight className="ml-1 h-4 w-4" aria-hidden />
                      </Link>
                    </Button>
                  )}
                  <Button variant="outline" asChild>
                    <Link to="/contact?topic=logistics">Request a quotation instead</Link>
                  </Button>
                </div>
                {offering && !bookable && (
                  <p className="text-sm text-muted-foreground">
                    {offering.name} is not open for self-service booking on your account, so we do not take payment for it
                    online. Send an enquiry and our team arranges the collection, or call {CONTACT.phoneDisplay}.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* -------------------------------- 2. route ------------------------------- */}
          {step === 2 && (
            <Card>
              <CardHeader>
                <CardTitle>Pickup and destination</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="pickup">Pickup address</Label>
                  <Input id="pickup" value={pickupAddress} onChange={(e) => setPickupAddress(e.target.value)} placeholder="Building, street, area" />
                </div>
                <div>
                  <Label htmlFor="dropoff">Delivery address</Label>
                  <Input id="dropoff" value={dropoffAddress} onChange={(e) => setDropoffAddress(e.target.value)} placeholder="Building, street, area" />
                </div>
                <div>
                  <Label htmlFor="band">Approximate distance</Label>
                  <select
                    id="band"
                    value={distanceBand}
                    onChange={(e) => setDistanceBand(e.target.value as DistanceBand)}
                    className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    {DISTANCE_BAND_OPTIONS.map((b) => (
                      <option key={b.code} value={b.code}>
                        {b.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Distance is estimated from the band you choose. A routed distance provider is not yet connected, so
                    your price is based on this estimate and is shown in full before you pay.
                  </p>
                </div>
                <div className="flex gap-3">
                  <Button variant="ghost" onClick={() => setStep(1)}>
                    <ArrowLeft className="mr-1 h-4 w-4" aria-hidden /> Back
                  </Button>
                  <Button onClick={() => setStep(3)} disabled={!routeReady}>
                    Continue <ArrowRight className="ml-1 h-4 w-4" aria-hidden />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ------------------------------- 3. package ------------------------------ */}
          {step === 3 && !offering && (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                {catalogueError
                  ? `We could not load the service catalogue: ${catalogueError}`
                  : "Loading your selected service…"}
              </CardContent>
            </Card>
          )}
          {step === 3 && offering && (
            <Card>
              <CardHeader>
                <CardTitle>Package details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="ptype">Package type</Label>
                    <select
                      id="ptype"
                      value={packageType}
                      onChange={(e) => setPackageType(e.target.value as PackageType)}
                      className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      {offering.allowedPackageTypes.map((t) => (
                        <option key={t} value={t}>
                          {t.replace(/_/g, " ").toLowerCase()}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label htmlFor="count">Number of packages</Label>
                    <Input id="count" type="number" min={1} max={20} value={packageCount} onChange={(e) => setPackageCount(e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="weight">Total weight (kg)</Label>
                    <Input id="weight" type="number" step="0.1" min={offering.weightLimitKg.min} value={weightKg} onChange={(e) => setWeightKg(e.target.value)} />
                    <p className="mt-1 text-xs text-muted-foreground">
                      {offering.weightLimitKg.min}–{offering.weightLimitKg.max} kg on this service.
                    </p>
                  </div>
                  <div>
                    <Label htmlFor="value">Declared value (KES){offering.declaredValueRequired ? "" : " — optional"}</Label>
                    <Input id="value" type="number" min={0} value={declaredValue} onChange={(e) => setDeclaredValue(e.target.value)} />
                  </div>
                </div>

                <div>
                  <Label>Dimensions (cm){offering.dimensionsRequired ? "" : " — optional"}</Label>
                  <div className="mt-1 grid grid-cols-3 gap-2">
                    {(["l", "w", "h"] as const).map((k) => (
                      <Input
                        key={k}
                        type="number"
                        min={1}
                        aria-label={k === "l" ? "Length in cm" : k === "w" ? "Width in cm" : "Height in cm"}
                        placeholder={k === "l" ? "Length" : k === "w" ? "Width" : "Height"}
                        value={dims[k]}
                        onChange={(e) => setDims((d) => ({ ...d, [k]: e.target.value }))}
                      />
                    ))}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Billable weight is the greater of actual weight and volumetric weight (L×W×H ÷ 5000).
                  </p>
                </div>

                <div>
                  <Label htmlFor="goods">What is inside?</Label>
                  <select
                    id="goods"
                    value={goodsCode}
                    onChange={(e) => setGoodsCode(e.target.value)}
                    className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    {GOODS_OPTIONS.map((g) => (
                      <option key={g.code} value={g.code}>
                        {g.label}
                      </option>
                    ))}
                  </select>
                  <Textarea
                    className="mt-2"
                    placeholder="Describe the contents (helps our compliance check)"
                    value={goodsDescription}
                    onChange={(e) => setGoodsDescription(e.target.value)}
                    rows={2}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    We cannot carry firearms, narcotics, explosives, live animals, human remains, cash or counterfeit goods
                    on any service.
                  </p>
                </div>

                {offering.specialHandling.length > 0 && (
                  <div className="space-y-2">
                    <Label>Special handling</Label>
                    {offering.specialHandling.map((h) => (
                      <label key={h} className="flex items-center gap-2 text-sm">
                        <Checkbox checked={handling.includes(h)} onCheckedChange={() => toggleHandling(h)} />
                        {h.replace(/_/g, " ")}
                      </label>
                    ))}
                  </div>
                )}

                <div className="flex gap-3">
                  <Button variant="ghost" onClick={() => setStep(2)}>
                    <ArrowLeft className="mr-1 h-4 w-4" aria-hidden /> Back
                  </Button>
                  <Button onClick={getQuote} disabled={!packageReady || quoting}>
                    {quoting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : null}
                    Get my price
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* -------------------------------- 4. price ------------------------------- */}
          {step === 4 && (
            <Card>
              <CardHeader>
                <CardTitle>Your price</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {!quote?.quotable && (
                  <Alert variant="destructive">
                    <ShieldAlert className="h-4 w-4" aria-hidden />
                    <AlertTitle>We cannot book this as entered</AlertTitle>
                    <AlertDescription>
                      <ul className="mt-1 list-disc pl-5">
                        {(quote?.eligibility?.messages ?? [quote?.message ?? "Adjust the shipment details and try again."]).map((m) => (
                          <li key={m}>{m}</li>
                        ))}
                      </ul>
                    </AlertDescription>
                  </Alert>
                )}

                {quote?.quotable && quote.snapshot && (
                  <>
                    <div className="rounded-xl border p-4">
                      <table className="w-full text-sm">
                        <caption className="sr-only">Price breakdown</caption>
                        <tbody>
                          {quote.snapshot.lines.map((l) => (
                            <tr key={l.code} className="border-b last:border-0">
                              <td className="py-2">{l.label}</td>
                              <td className="py-2 text-right tabular-nums">{kes(l.amount_kes)}</td>
                            </tr>
                          ))}
                          <tr>
                            <td className="pt-3 font-semibold">Total payable</td>
                            <td className="pt-3 text-right text-lg font-bold tabular-nums">{kes(quote.snapshot.quoted_amount_kes)}</td>
                          </tr>
                        </tbody>
                      </table>
                      <p className="mt-3 text-xs text-muted-foreground">
                        Rate card {quote.snapshot.rate_plan_id} v{quote.snapshot.rate_plan_version} · billable weight{" "}
                        {String(quote.snapshot.inputs.billable_weight_kg)} kg · estimated distance{" "}
                        {String(quote.snapshot.inputs.distance_km)} km. This price is held for 30 minutes and is the exact
                        amount we invoice.
                      </p>
                    </div>

                    {quote.eligibility.requiresManualReview && (
                      <Alert>
                        <Info className="h-4 w-4" aria-hidden />
                        <AlertTitle>Compliance check needed</AlertTitle>
                        <AlertDescription>{quote.eligibility.goods.message}</AlertDescription>
                      </Alert>
                    )}
                  </>
                )}

                <div className="flex gap-3">
                  <Button variant="ghost" onClick={() => setStep(3)}>
                    <ArrowLeft className="mr-1 h-4 w-4" aria-hidden /> Change details
                  </Button>
                  <Button onClick={() => setStep(5)} disabled={!quote?.quotable}>
                    Accept and continue <ArrowRight className="ml-1 h-4 w-4" aria-hidden />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ------------------------------- 5. payment ------------------------------ */}
          {step === 5 && (
            <Card>
              <CardHeader>
                <CardTitle>Contacts and payment</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {!authLoading && !user && (
                  <Alert>
                    <AlertTitle>Sign in to confirm</AlertTitle>
                    <AlertDescription className="space-y-2">
                      <p>Every shipment is attached to an account so you can track it, download proof of delivery and get receipts.</p>
                      <Button size="sm" onClick={() => navigate(`/auth?redirect=${encodeURIComponent("/delivery/book")}`)}>
                        Sign in or create an account
                      </Button>
                    </AlertDescription>
                  </Alert>
                )}

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="sname">Sender name</Label>
                    <Input id="sname" value={senderName} onChange={(e) => setSenderName(e.target.value)} />
                    {fieldErrors.sender_name && <p className="mt-1 text-xs text-destructive">{fieldErrors.sender_name}</p>}
                  </div>
                  <div>
                    <Label htmlFor="sphone">Sender phone</Label>
                    <Input id="sphone" inputMode="tel" placeholder="07XXXXXXXX" value={senderPhone} onChange={(e) => setSenderPhone(e.target.value)} />
                    {fieldErrors.sender_phone && <p className="mt-1 text-xs text-destructive">{fieldErrors.sender_phone}</p>}
                  </div>
                  <div>
                    <Label htmlFor="rname">Recipient name</Label>
                    <Input id="rname" value={recipientName} onChange={(e) => setRecipientName(e.target.value)} />
                    {fieldErrors.recipient_name && <p className="mt-1 text-xs text-destructive">{fieldErrors.recipient_name}</p>}
                  </div>
                  <div>
                    <Label htmlFor="rphone">Recipient phone</Label>
                    <Input id="rphone" inputMode="tel" placeholder="07XXXXXXXX" value={recipientPhone} onChange={(e) => setRecipientPhone(e.target.value)} />
                    {fieldErrors.recipient_phone && <p className="mt-1 text-xs text-destructive">{fieldErrors.recipient_phone}</p>}
                  </div>
                </div>

                <div>
                  <Label htmlFor="notes">Delivery instructions (optional)</Label>
                  <Textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
                </div>

                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">Payment method</legend>
                  {PAYMENT_OPTIONS.map((p) => (
                    <label
                      key={p.code}
                      className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm ${
                        paymentMethod === p.code ? "border-primary bg-primary/5" : ""
                      } ${p.enabled ? "" : "cursor-not-allowed opacity-60"}`}
                    >
                      <input
                        type="radio"
                        name="payment"
                        className="mt-1"
                        disabled={!p.enabled}
                        checked={paymentMethod === p.code}
                        onChange={() => setPaymentMethod(p.code)}
                      />
                      <span>
                        <span className="font-medium">{p.label}</span>
                        <span className="block text-xs text-muted-foreground">{p.note}</span>
                      </span>
                    </label>
                  ))}
                </fieldset>

                {bookingFailure ? (
                  <LogisticsErrorNotice mapped={bookingFailure} onRetry={() => void confirmBooking()} />
                ) : bookingError ? (
                  <Alert variant="destructive">
                    <AlertTitle>Booking not completed</AlertTitle>
                    <AlertDescription>{bookingError}</AlertDescription>
                  </Alert>
                ) : null}

                {offering && !bookable && (
                  <Alert>
                    <AlertTitle>{offering.name} is enquiry-only</AlertTitle>
                    <AlertDescription>
                      This service is in controlled pilot, so we cannot take a production booking or payment for it.
                      Send an enquiry and our logistics desk will arrange it, or switch to Standard Parcel.
                    </AlertDescription>
                  </Alert>
                )}

                <div className="flex flex-wrap gap-3">
                  <Button variant="ghost" onClick={() => setStep(4)}>
                    <ArrowLeft className="mr-1 h-4 w-4" aria-hidden /> Back
                  </Button>
                  {offering && !bookable && (
                    <Button asChild variant="secondary">
                      <Link to={`/delivery/enquiry?offering=${encodeURIComponent(offeringCode)}`}>Send an enquiry</Link>
                    </Button>
                  )}
                  <Button onClick={confirmBooking} disabled={!contactsReady || !user || booking || !bookable}>
                    {booking ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : null}
                    Confirm booking {quote?.snapshot ? `· ${kes(quote.snapshot.quoted_amount_kes)}` : ""}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ----------------------------- 6. confirmation --------------------------- */}
          {step === 6 && result && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-[hsl(var(--status-success))]" aria-hidden /> Shipment created
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Order <span className="font-mono font-semibold">{result.order.order_number}</span> ·{" "}
                  {kes(result.order.total_amount)} · {result.order.payment_status}
                </p>

                {paying && (
                  <Alert>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    <AlertTitle>Payment in progress</AlertTitle>
                    <AlertDescription>{paying}</AlertDescription>
                  </Alert>
                )}

                {result.compliance_hold && (
                  <Alert>
                    <ShieldAlert className="h-4 w-4" aria-hidden />
                    <AlertTitle>Held for compliance review</AlertTitle>
                    <AlertDescription>
                      {result.compliance_message} Dispatch is intentionally blocked until this is cleared.
                    </AlertDescription>
                  </Alert>
                )}

                <div className="space-y-2">
                  <h2 className="text-sm font-semibold">Tracking numbers</h2>
                  {result.packages.map((p) => (
                    <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
                      <span className="font-mono text-sm font-semibold">{p.tracking_number}</span>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">{p.status.replace(/_/g, " ")}</Badge>
                        <Button size="sm" variant="outline" asChild>
                          <Link to={`/track?tracking=${p.tracking_number}`}>Track</Link>
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>

                <p className="text-xs text-muted-foreground">
                  {result.dispatch
                    ? "The shipment is queued for courier assignment."
                    : "The shipment will be queued for dispatch once the compliance check clears."}
                </p>

                <div className="flex flex-wrap gap-3">
                  <Button asChild>
                    <Link to="/track">Track a shipment</Link>
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setResult(null);
                      setQuote(null);
                      setStep(1);
                    }}
                  >
                    Book another delivery
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* ------------------------------- side summary ------------------------------ */}
        <aside className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Truck className="h-4 w-4" aria-hidden /> Shipment summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <SummaryRow label="Service" value={offering?.name ?? "—"} />
              <SummaryRow label="From" value={pickupAddress || "—"} />
              <SummaryRow label="To" value={dropoffAddress || "—"} />
              <SummaryRow label="Packages" value={packageCount} />
              <SummaryRow label="Weight" value={weightKg ? `${weightKg} kg` : "—"} />
              <Separator />
              <SummaryRow label="Price" value={quote?.snapshot ? kes(quote.snapshot.quoted_amount_kes) : "Not yet priced"} />
              {offering && <p className="pt-2 text-xs text-muted-foreground">{offering.slaQualifier}</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <PackageCheck className="h-4 w-4" aria-hidden /> Need help?
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm text-muted-foreground">
              <p>{CONTACT.phoneDisplay}</p>
              <p>{CONTACT.supportEmail}</p>
              <p className="text-xs">For contracted freight, warehousing or fulfilment, email {CONTACT.salesEmail}.</p>
            </CardContent>
          </Card>
        </aside>
      </section>
    </MarketingLayout>
  );
};

const SummaryRow = ({ label, value }: { label: string; value: string | number }) => (
  <div className="flex justify-between gap-4">
    <span className="text-muted-foreground">{label}</span>
    <span className="text-right font-medium">{value}</span>
  </div>
);

export default BookParcel;
