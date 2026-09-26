/**
 * BUSINESS LOGISTICS QUOTE — pickup, drop-off, cargo, vehicle preference.
 *
 * The browser sends facts only. `logistics-quote` decides eligibility, whether
 * the service can be booked online at all, and the price — from the governed
 * rate plan. Where the server says the service is self-service bookable the
 * customer goes straight to booking; where it is priced per contract the
 * customer is routed to the freight desk instead of being shown a guess.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { AlertCircle, ArrowRight, Clock, Loader2, PackageCheck, ShieldCheck, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CONTACT, PHONE_TEL } from "@/config/contact";
import { kes } from "@/lib/marketing/publicRateCard";
import {
  fetchServiceCatalogue,
  requestQuote,
  type CatalogueOffering,
  type DistanceBand,
  type PackageType,
  type QuoteResponse,
} from "@/lib/logistics/booking/api";

const ROUTE = "/logistics/quote";
const CANONICAL = `https://yalla-africa.lovable.app${ROUTE}`;
const OG_IMAGE = "https://yalla-africa.lovable.app/og-yalla-mobility-1200x630.v3.png";

const CARGO_LABEL: Record<PackageType, string> = {
  DOCUMENT: "Documents",
  SMALL_PARCEL: "Small parcel",
  PARCEL: "Parcel",
  PALLET: "Pallet",
  BULK: "Bulk / loose cargo",
  TEMPERATURE_CONTROLLED: "Temperature controlled",
};

const DISTANCE_OPTIONS: { value: DistanceBand; label: string }[] = [
  { value: "UNDER_5", label: "Under 5 km — same neighbourhood" },
  { value: "KM_5_15", label: "5–15 km — across Nairobi" },
  { value: "KM_15_30", label: "15–30 km — greater Nairobi" },
  { value: "OVER_30", label: "Over 30 km — upcountry or intercity" },
];

export default function LogisticsBusinessQuote() {
  const [offerings, setOfferings] = useState<CatalogueOffering[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  const [service, setService] = useState("");
  const [pickup, setPickup] = useState("");
  const [dropoff, setDropoff] = useState("");
  const [distanceBand, setDistanceBand] = useState<DistanceBand>("KM_5_15");
  const [cargo, setCargo] = useState<PackageType | "">("");
  const [weight, setWeight] = useState("");
  const [count, setCount] = useState("1");
  const [value, setValue] = useState("");
  const [dimL, setDimL] = useState("");
  const [dimW, setDimW] = useState("");
  const [dimH, setDimH] = useState("");
  const [requirements, setRequirements] = useState("");

  const [pricing, setPricing] = useState(false);
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchServiceCatalogue()
      .then(setOfferings)
      .catch(() => setLoadError(true));
  }, []);

  const selected = useMemo(() => offerings?.find((o) => o.code === service) ?? null, [offerings, service]);

  const cargoOptions = useMemo<PackageType[]>(
    () => (selected?.allowedPackageTypes?.length ? selected.allowedPackageTypes : (Object.keys(CARGO_LABEL) as PackageType[])),
    [selected],
  );

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pricing || !selected || !cargo) {
      if (!selected) setError("Choose the service you need.");
      else if (!cargo) setError("Tell us what you are moving.");
      return;
    }
    setError(null);
    setQuote(null);
    setPricing(true);
    try {
      const response = await requestQuote({
        offering_code: selected.code,
        package_type: cargo,
        weight_kg: Number(weight) || 0,
        package_count: Math.max(1, Math.trunc(Number(count) || 1)),
        declared_value_kes: value ? Number(value) : null,
        dimensions_cm:
          dimL && dimW && dimH ? { l: Number(dimL), w: Number(dimW), h: Number(dimH) } : null,
        distance_band: distanceBand,
      });
      setQuote(response);
    } catch {
      setError("We could not price this shipment just now. Call the freight desk and we will quote it directly.");
    } finally {
      setPricing(false);
    }
  };

  const enquiryHref = `/delivery/enquiry?origin=${encodeURIComponent(pickup)}&destination=${encodeURIComponent(dropoff)}`;
  const bookingHref = selected
    ? `/delivery/book?service=${encodeURIComponent(selected.code)}&pickup=${encodeURIComponent(pickup)}&dropoff=${encodeURIComponent(dropoff)}`
    : "/delivery/book";

  return (
    <main className="min-h-screen bg-background">
      <Helmet>
        <title>Business logistics quote in Nairobi | Yalla Mobility</title>
        <meta
          name="description"
          content="Get a business logistics quote for Nairobi and upcountry Kenya: give us pickup, drop-off, cargo type and vehicle preference and see a priced quote with a booking link."
        />
        <link rel="canonical" href={CANONICAL} />
        <meta property="og:title" content="Business logistics quote in Nairobi | Yalla Mobility" />
        <meta
          property="og:description"
          content="Priced from our governed rate plan: pickup, drop-off, cargo type and vehicle preference, then book or reach the freight desk."
        />
        <meta property="og:type" content="website" />
        <meta property="og:url" content={CANONICAL} />
        <meta property="og:image" content={OG_IMAGE} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:image" content={OG_IMAGE} />
      </Helmet>

      <section className="border-b bg-secondary/30">
        <div className="container mx-auto px-4 py-14">
          <Badge variant="secondary" className="mb-4">
            Business logistics
          </Badge>
          <h1 className="max-w-3xl text-4xl font-bold tracking-tight">
            Get a logistics quote for your business in Nairobi
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
            Tell us where the cargo is collected, where it is going, what it is and how you would like it moved. Where
            the service can be booked online you will see a price and a booking link on this page. Where it is priced
            per contract, the freight desk quotes it — we never show an invented figure.
          </p>
          <div className="mt-6 flex flex-wrap gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" /> Verified operators only
            </span>
            <span className="flex items-center gap-2">
              <PackageCheck className="h-4 w-4" /> Proof of delivery on every consignment
            </span>
            <span className="flex items-center gap-2">
              <Truck className="h-4 w-4" /> Nairobi, greater Nairobi and upcountry
            </span>
          </div>
        </div>
      </section>

      <section className="container mx-auto grid gap-8 px-4 py-14 lg:grid-cols-[3fr_2fr]">
        <form onSubmit={onSubmit} className="rounded-xl border bg-card p-6 shadow-sm" noValidate>
          <h2 className="text-xl font-semibold">Shipment details</h2>

          {loadError ? (
            <Alert variant="destructive" className="mt-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                We could not load the service list. Call{" "}
                <a href={PHONE_TEL} className="underline">
                  {CONTACT.phoneDisplay}
                </a>{" "}
                and the freight desk will quote your shipment directly.
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="mt-6 grid gap-5 md:grid-cols-2">
            <div className="md:col-span-2">
              <Label htmlFor="lq-service">Service / vehicle preference</Label>
              {offerings === null && !loadError ? (
                <Skeleton className="mt-1 h-10 w-full" />
              ) : (
                <Select value={service} onValueChange={setService}>
                  <SelectTrigger id="lq-service" className="mt-1">
                    <SelectValue placeholder="Choose how it should move" />
                  </SelectTrigger>
                  <SelectContent>
                    {(offerings ?? []).map((o) => (
                      <SelectItem key={o.code} value={o.code}>
                        {o.name}
                        {o.selfServiceBookable ? "" : " — by quotation"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {selected ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  {selected.slaQualifier}
                  {selected.weightLimitKg
                    ? ` · ${selected.weightLimitKg.min}–${selected.weightLimitKg.max} kg per consignment`
                    : ""}
                </p>
              ) : null}
            </div>

            <div>
              <Label htmlFor="lq-pickup">Pickup location</Label>
              <Input
                id="lq-pickup"
                value={pickup}
                onChange={(e) => setPickup(e.target.value)}
                placeholder="e.g. Industrial Area, Nairobi"
                className="mt-1"
                required
              />
            </div>

            <div>
              <Label htmlFor="lq-dropoff">Drop-off location</Label>
              <Input
                id="lq-dropoff"
                value={dropoff}
                onChange={(e) => setDropoff(e.target.value)}
                placeholder="e.g. Nakuru CBD"
                className="mt-1"
                required
              />
            </div>

            <div>
              <Label htmlFor="lq-distance">Distance</Label>
              <Select value={distanceBand} onValueChange={(v) => setDistanceBand(v as DistanceBand)}>
                <SelectTrigger id="lq-distance" className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DISTANCE_OPTIONS.map((d) => (
                    <SelectItem key={d.value} value={d.value}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="lq-cargo">Cargo type</Label>
              <Select value={cargo} onValueChange={(v) => setCargo(v as PackageType)}>
                <SelectTrigger id="lq-cargo" className="mt-1">
                  <SelectValue placeholder="What are you moving?" />
                </SelectTrigger>
                <SelectContent>
                  {cargoOptions.map((c) => (
                    <SelectItem key={c} value={c}>
                      {CARGO_LABEL[c] ?? c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="lq-weight">Total weight (kg)</Label>
              <Input
                id="lq-weight"
                type="number"
                inputMode="numeric"
                min={0}
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                className="mt-1"
                required
              />
            </div>

            <div>
              <Label htmlFor="lq-count">Number of items</Label>
              <Input
                id="lq-count"
                type="number"
                inputMode="numeric"
                min={1}
                value={count}
                onChange={(e) => setCount(e.target.value)}
                className="mt-1"
              />
            </div>

            {selected?.dimensionsRequired ? (
              <div className="md:col-span-2">
                <Label htmlFor="lq-dim-l">Package size (cm)</Label>
                <div className="mt-1 grid grid-cols-3 gap-3">
                  <Input
                    id="lq-dim-l"
                    type="number"
                    min={1}
                    value={dimL}
                    onChange={(e) => setDimL(e.target.value)}
                    placeholder="Length"
                    required
                  />
                  <Input
                    id="lq-dim-w"
                    type="number"
                    min={1}
                    value={dimW}
                    onChange={(e) => setDimW(e.target.value)}
                    placeholder="Width"
                    required
                  />
                  <Input
                    id="lq-dim-h"
                    type="number"
                    min={1}
                    value={dimH}
                    onChange={(e) => setDimH(e.target.value)}
                    placeholder="Height"
                    required
                  />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Used to work out billable weight — bulky light cargo is charged on the space it takes.
                </p>
              </div>
            ) : null}

            <div className="md:col-span-2">
              <Label htmlFor="lq-value">
                Declared value of the contents (KSh)
                {selected?.declaredValueRequired ? "" : " — optional"}
              </Label>
              <Input
                id="lq-value"
                type="number"
                inputMode="numeric"
                min={0}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="mt-1"
                required={selected?.declaredValueRequired ?? false}
              />
            </div>

            <div className="md:col-span-2">
              <Label htmlFor="lq-req">Handling requirements (optional)</Label>
              <Textarea
                id="lq-req"
                rows={3}
                value={requirements}
                onChange={(e) => setRequirements(e.target.value)}
                className="mt-1"
                placeholder="Loading help, timed delivery window, fragile goods, cold chain…"
              />
            </div>
          </div>

          {error ? (
            <Alert variant="destructive" className="mt-6">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <Button type="submit" size="lg" className="mt-6" disabled={pricing}>
            {pricing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Pricing your shipment
              </>
            ) : (
              <>
                Get my quote <ArrowRight className="ml-2 h-4 w-4" />
              </>
            )}
          </Button>
        </form>

        {/* ------------------------------- the answer ------------------------- */}
        <aside className="space-y-4">
          {quote === null ? (
            <div className="rounded-xl border bg-card p-6">
              <h2 className="text-lg font-semibold">What you get back</h2>
              <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                <li>A price from the governed rate plan, with every line shown.</li>
                <li>A booking link where the service can be booked online.</li>
                <li>A direct route to the freight desk where it is priced per contract.</li>
                <li>Proof of delivery and a receipt on every consignment.</li>
              </ul>
              <p className="mt-4 text-sm text-muted-foreground">
                Moving regularly? Call{" "}
                <a href={PHONE_TEL} className="text-primary underline">
                  {CONTACT.phoneDisplay}
                </a>{" "}
                about a contract rate.
              </p>
            </div>
          ) : quote.quotable && quote.snapshot ? (
            <div className="rounded-xl border bg-card p-6">
              <h2 className="text-lg font-semibold">{quote.offering?.name ?? "Your quote"}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {pickup || "Pickup"} → {dropoff || "Drop-off"}
              </p>
              <p className="mt-4 text-3xl font-bold">{kes(quote.snapshot.quoted_amount_kes)}</p>
              <p className="text-xs text-muted-foreground">
                Includes VAT where applicable · rate plan v{quote.snapshot.rate_plan_version}
              </p>

              <table className="mt-4 w-full text-sm">
                <tbody>
                  {quote.snapshot.lines.map((l) => (
                    <tr key={l.code} className="border-b last:border-0">
                      <td className="py-2 pr-3">{l.label}</td>
                      <td className="py-2 text-right font-medium">{kes(l.amount_kes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {quote.snapshot.expires_at ? (
                <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" /> Holds until{" "}
                  {new Date(quote.snapshot.expires_at).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" })}
                </p>
              ) : null}

              {selected?.selfServiceBookable ? (
                <Button asChild size="lg" className="mt-5 w-full">
                  <Link to={bookingHref}>
                    Book this shipment <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              ) : (
                <>
                  <Alert className="mt-5">
                    <AlertDescription>
                      This service is confirmed by our freight desk before booking. Send the shipment through and we
                      will come back with a confirmed slot.
                    </AlertDescription>
                  </Alert>
                  <Button asChild size="lg" className="mt-4 w-full">
                    <Link to={enquiryHref}>Send to the freight desk</Link>
                  </Button>
                </>
              )}
            </div>
          ) : (
            <div className="rounded-xl border bg-card p-6">
              <h2 className="text-lg font-semibold">This one is quoted by a person</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {quote.eligibility?.messages?.[0] ??
                  quote.message ??
                  "This shipment needs a human quotation — the freight desk will price it against your route and volumes."}
              </p>
              {quote.eligibility?.messages?.length ? (
                <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
                  {quote.eligibility.messages.slice(0, 4).map((m) => (
                    <li key={m}>· {m}</li>
                  ))}
                </ul>
              ) : null}
              <Button asChild size="lg" className="mt-5 w-full">
                <Link to={enquiryHref}>Send to the freight desk</Link>
              </Button>
              <p className="mt-3 text-sm text-muted-foreground">
                Or call{" "}
                <a href={PHONE_TEL} className="text-primary underline">
                  {CONTACT.phoneDisplay}
                </a>{" "}
                · {CONTACT.salesEmail}
              </p>
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}
