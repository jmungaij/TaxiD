/**
 * FREIGHT, TRUCK, WAREHOUSING & FULFILMENT ENQUIRY — the live journey for the
 * services TaxiD quotes by hand.
 *
 * These services are enquiry-only on purpose: freight is priced against a
 * surveyed load and committed capacity. Rather than a dead "contact us" link,
 * this page captures the facts the commercial desk needs, records the enquiry
 * server-side, and returns a reference with the response window we commit to.
 *
 * The page never shows a price and never claims the enquiry was received unless
 * the server confirms the record committed.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import {
  AlertCircle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  PhoneCall,
  Warehouse,
} from "lucide-react";
import MarketingLayout from "@/components/marketing/MarketingLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { CONTACT } from "@/config/contact";
import {
  FREQUENCY_LABELS,
  MISSING_FACT_LABELS,
  fetchEnquiryTopics,
  submitEnquiry,
  type EnquiryReceipt,
  type EnquiryTopic,
  type ShipmentFrequency,
} from "@/lib/logistics/enquiry/api";

/** Marketing intents (?topic=) mapped to canonical server topic codes. */
const INTENT_ALIASES: Record<string, string> = {
  freight: "FREIGHT_CARGO",
  cargo: "FREIGHT_CARGO",
  truck: "TRUCK_DISPATCH",
  "truck-dispatch": "TRUCK_DISPATCH",
  fleet: "TRUCK_DISPATCH",
  warehousing: "WAREHOUSING",
  storage: "WAREHOUSING",
  fulfilment: "ECOMMERCE_FULFILMENT",
  fulfillment: "ECOMMERCE_FULFILMENT",
  ecommerce: "ECOMMERCE_FULFILMENT",
  business: "CORPORATE_LOGISTICS",
  corporate: "CORPORATE_LOGISTICS",
  logistics: "FREIGHT_CARGO",
};

function resolveRequestedTopic(params: URLSearchParams): string | null {
  const raw = (params.get("topic") ?? params.get("offering") ?? params.get("intent") ?? "").trim();
  if (!raw) return null;
  return INTENT_ALIASES[raw.toLowerCase()] ?? raw.toUpperCase();
}

const formatDeadline = (iso: string) =>
  new Date(iso).toLocaleString("en-KE", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

const FreightEnquiry = () => {
  const [params] = useSearchParams();
  const { user } = useAuth();
  const openedAt = useRef(Date.now());

  const [topics, setTopics] = useState<EnquiryTopic[]>([]);
  const [frequencies, setFrequencies] = useState<ShipmentFrequency[]>(["ONE_OFF"]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [topicCode, setTopicCode] = useState<string>("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState(user?.email ?? "");
  const [contactPhone, setContactPhone] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [origin, setOrigin] = useState(params.get("pickup") ?? params.get("origin") ?? "");
  const [destination, setDestination] = useState(params.get("dropoff") ?? params.get("destination") ?? "");
  const [cargo, setCargo] = useState("");
  const [weight, setWeight] = useState(params.get("weight") ?? "");
  const [volume, setVolume] = useState("");
  const [frequency, setFrequency] = useState<ShipmentFrequency>("ONE_OFF");
  const [targetDate, setTargetDate] = useState("");
  const [budget, setBudget] = useState("");
  const [requirements, setRequirements] = useState("");
  const [honeypot, setHoneypot] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<{ message: string; missing?: string[]; correlationId?: string } | null>(null);
  const [receipt, setReceipt] = useState<EnquiryReceipt | null>(null);

  useEffect(() => {
    if (user?.email) setContactEmail((prev) => prev || user.email!);
  }, [user?.email]);

  useEffect(() => {
    let alive = true;
    fetchEnquiryTopics()
      .then(({ topics: t, frequencies: f }) => {
        if (!alive) return;
        setTopics(t);
        setFrequencies(f);
        const requested = resolveRequestedTopic(params);
        const match = t.find((x) => x.code === requested);
        setTopicCode(match?.code ?? t[0]?.code ?? "");
        setLoading(false);
      })
      .catch((e: Error) => {
        if (!alive) return;
        setLoadError(e.message);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const topic = useMemo(() => topics.find((t) => t.code === topicCode) ?? null, [topics, topicCode]);

  const submit = async () => {
    if (!topic) return;
    setSubmitting(true);
    setFailure(null);
    const outcome = await submitEnquiry({
      topic_code: topic.code,
      contact_name: contactName.trim(),
      contact_email: contactEmail.trim(),
      contact_phone: contactPhone.trim() || null,
      company_name: companyName.trim() || null,
      origin_label: origin.trim(),
      destination_label: destination.trim(),
      cargo_description: cargo.trim(),
      weight_kg: weight ? Number(weight) : null,
      volume_cbm: volume ? Number(volume) : null,
      shipment_frequency: frequency,
      target_date: targetDate || null,
      budget_amount: budget ? Number(budget) : null,
      requirements: requirements.trim() || null,
      source_page: `/delivery/enquiry?topic=${topic.code}`,
      website: honeypot,
      elapsed_ms: Date.now() - openedAt.current,
    });
    setSubmitting(false);
    if (outcome.ok === true) {
      setReceipt(outcome.receipt);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setFailure({
      message: outcome.message,
      missing: outcome.missing,
      correlationId: outcome.correlationId,
    });
  };

  const canSubmit =
    !!topic &&
    contactName.trim().length >= 2 &&
    /.+@.+\..+/.test(contactEmail) &&
    origin.trim().length >= 2 &&
    destination.trim().length >= 2 &&
    cargo.trim().length >= 10 &&
    (!topic.requires.weight || Number(weight) > 0) &&
    (!topic.requires.volume || Number(volume) > 0) &&
    (!topic.requires.targetDate || !!targetDate);

  return (
    <MarketingLayout>
      <Helmet>
        <title>Freight, Truck & Fulfilment Enquiry | TaxiD</title>
        <meta
          name="description"
          content="Tell us about your freight, truck dispatch, warehousing or fulfilment requirement. A TaxiD commercial specialist responds with a costed proposal and a reference you can quote."
        />
        <link rel="canonical" href="https://taxid.us/delivery/enquiry" />
        <meta property="og:image" content="https://yalla-africa.lovable.app/og-taxid-1200x630.png" />
        <meta name="twitter:image" content="https://yalla-africa.lovable.app/og-taxid-1200x630.png" />
      </Helmet>

      <div className="border-b border-border/60 bg-muted/30">
        <div className="mx-auto max-w-6xl px-4 py-10">
          <Badge variant="outline" className="mb-3 border-primary/30 text-primary">
            Quoted by a specialist
          </Badge>
          <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Freight, truck, warehousing and fulfilment
          </h1>
          <p className="mt-3 max-w-3xl text-muted-foreground">
            These services are not priced by a calculator. Give us the load and the route, and a commercial
            specialist comes back with a costed proposal — you get a reference immediately and a response
            window we hold ourselves to.
          </p>
          <p className="mt-3 text-sm text-muted-foreground">
            Sending a parcel, documents or a same-day city delivery instead?{" "}
            <Link to="/delivery/book" className="font-semibold text-primary hover:underline">
              Get an instant price and book it now
            </Link>
            .
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 py-10">
        {/* ------------------------------ receipt ------------------------------ */}
        {receipt ? (
          <Card className="border-primary/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-primary" /> Enquiry {receipt.reference} recorded
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Your {receipt.service.toLowerCase()} enquiry is in the commercial queue. Quote reference{" "}
                <span className="font-mono font-semibold text-foreground">{receipt.reference}</span> in any
                follow-up.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-border/60 p-3">
                  <p className="text-xs text-muted-foreground">We respond by</p>
                  <p className="text-sm font-semibold text-foreground">{formatDeadline(receipt.respond_by)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Within {receipt.response_hours} working hours of receipt.
                  </p>
                </div>
                <div className="rounded-lg border border-border/60 p-3">
                  <p className="text-xs text-muted-foreground">Talk to us sooner</p>
                  <p className="text-sm font-semibold text-foreground">{receipt.contact.phone}</p>
                  <p className="text-xs text-muted-foreground">{receipt.contact.email}</p>
                </div>
              </div>
              {!receipt.desk_notified && (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Your enquiry is saved</AlertTitle>
                  <AlertDescription>
                    The email alert to our desk did not go out, so the enquiry is queued in our console rather
                    than in an inbox. If you need it moved today, call {receipt.contact.phone} and quote{" "}
                    {receipt.reference}.
                  </AlertDescription>
                </Alert>
              )}
              <Separator />
              <div className="flex flex-wrap gap-3">
                <Button asChild variant="outline">
                  <Link to="/delivery/logistics">Back to logistics</Link>
                </Button>
                <Button asChild>
                  <Link to="/delivery/book">
                    Send a parcel now <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : loading ? (
          <div className="space-y-4">
            <Skeleton className="h-28 w-full rounded-xl" />
            <Skeleton className="h-96 w-full rounded-xl" />
          </div>
        ) : loadError ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>We cannot load the enquiry desk right now</AlertTitle>
            <AlertDescription>
              {loadError}. Call {CONTACT.phoneDisplay} or email {CONTACT.salesEmail} and we will take the
              details directly.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
            <Card>
              <CardHeader>
                <CardTitle>Tell us what needs moving</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* topic */}
                <div className="space-y-2">
                  <Label>Service</Label>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {topics.map((t) => (
                      <button
                        key={t.code}
                        type="button"
                        onClick={() => setTopicCode(t.code)}
                        aria-pressed={topicCode === t.code}
                        className={`rounded-lg border p-3 text-left transition ${
                          topicCode === t.code ? "border-primary bg-primary/5" : "border-border/60 hover:border-primary/40"
                        }`}
                      >
                        <p className="text-sm font-semibold text-foreground">{t.label}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{t.summary}</p>
                      </button>
                    ))}
                  </div>
                </div>

                {topic && (
                  <Alert>
                    <ClipboardCheck className="h-4 w-4" />
                    <AlertTitle>Why this is quoted by a person</AlertTitle>
                    <AlertDescription>{topic.why_enquiry}</AlertDescription>
                  </Alert>
                )}

                <Separator />

                {/* route */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="origin">Collection point</Label>
                    <Input
                      id="origin"
                      value={origin}
                      onChange={(e) => setOrigin(e.target.value)}
                      placeholder="Town, area or facility"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="destination">Delivery point</Label>
                    <Input
                      id="destination"
                      value={destination}
                      onChange={(e) => setDestination(e.target.value)}
                      placeholder="Town, area or facility"
                    />
                  </div>
                </div>

                {/* load */}
                <div className="space-y-1.5">
                  <Label htmlFor="cargo">What are you moving?</Label>
                  <Textarea
                    id="cargo"
                    rows={3}
                    value={cargo}
                    onChange={(e) => setCargo(e.target.value)}
                    placeholder={topic?.cargo_hint ?? "Describe the load"}
                  />
                  <p className="text-xs text-muted-foreground">{topic?.cargo_hint}</p>
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="weight">
                      Total weight (kg){topic?.requires.weight ? "" : " · optional"}
                    </Label>
                    <Input
                      id="weight"
                      type="number"
                      min={0}
                      value={weight}
                      onChange={(e) => setWeight(e.target.value)}
                      placeholder="e.g. 2500"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="volume">
                      Volume (cbm){topic?.requires.volume ? "" : " · optional"}
                    </Label>
                    <Input
                      id="volume"
                      type="number"
                      min={0}
                      value={volume}
                      onChange={(e) => setVolume(e.target.value)}
                      placeholder="e.g. 18"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="target">
                      Target date{topic?.requires.targetDate ? "" : " · optional"}
                    </Label>
                    <Input
                      id="target"
                      type="date"
                      value={targetDate}
                      onChange={(e) => setTargetDate(e.target.value)}
                    />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>How often?</Label>
                    <div className="flex flex-wrap gap-2">
                      {frequencies.map((f) => (
                        <button
                          key={f}
                          type="button"
                          onClick={() => setFrequency(f)}
                          aria-pressed={frequency === f}
                          className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                            frequency === f
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border/60 text-muted-foreground hover:border-primary/40"
                          }`}
                        >
                          {FREQUENCY_LABELS[f]}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="budget">Indicative budget (KES) · optional</Label>
                    <Input
                      id="budget"
                      type="number"
                      min={0}
                      value={budget}
                      onChange={(e) => setBudget(e.target.value)}
                      placeholder="Helps us shape the option"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="requirements">Anything else we should plan for? · optional</Label>
                  <Textarea
                    id="requirements"
                    rows={2}
                    value={requirements}
                    onChange={(e) => setRequirements(e.target.value)}
                    placeholder="Loading equipment, escorts, temperature control, insurance, reporting…"
                  />
                </div>

                <Separator />

                {/* contact */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="name">Your name</Label>
                    <Input id="name" value={contactName} onChange={(e) => setContactName(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="company">Company · optional</Label>
                    <Input id="company" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      value={contactEmail}
                      onChange={(e) => setContactEmail(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="phone">Phone · optional</Label>
                    <Input id="phone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
                  </div>
                </div>

                {/* honeypot — never shown to humans */}
                <input
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  aria-hidden="true"
                  value={honeypot}
                  onChange={(e) => setHoneypot(e.target.value)}
                  className="pointer-events-none absolute h-0 w-0 opacity-0"
                />

                {failure && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Enquiry not recorded</AlertTitle>
                    <AlertDescription>
                      {failure.message}
                      {failure.missing?.length ? (
                        <span className="mt-1 block">
                          Still needed: {failure.missing.map((m) => MISSING_FACT_LABELS[m] ?? m).join(", ")}.
                        </span>
                      ) : null}
                      {failure.correlationId ? (
                        <span className="mt-1 block text-xs opacity-80">
                          Support reference {failure.correlationId}
                        </span>
                      ) : null}
                    </AlertDescription>
                  </Alert>
                )}

                <Button onClick={submit} disabled={!canSubmit || submitting} className="w-full sm:w-auto">
                  {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {submitting ? "Recording your enquiry…" : "Send enquiry"}
                </Button>
              </CardContent>
            </Card>

            {/* aside */}
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <CalendarClock className="h-4 w-4 text-primary" /> What happens next
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-muted-foreground">
                  <p>
                    <span className="font-semibold text-foreground">1 · Reference issued.</span> You get an ENQ
                    reference the moment the enquiry is recorded.
                  </p>
                  <p>
                    <span className="font-semibold text-foreground">2 · Specialist review.</span> The desk
                    checks capacity on your corridor
                    {topic ? ` within ${topic.response_hours} working hours` : ""}.
                  </p>
                  <p>
                    <span className="font-semibold text-foreground">3 · Costed proposal.</span> Rates, service
                    level and terms in writing — nothing is charged until you accept.
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <PhoneCall className="h-4 w-4 text-primary" /> Prefer to talk
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-sm">
                  <p className="font-semibold text-foreground">{CONTACT.phoneDisplay}</p>
                  <p className="text-muted-foreground">{CONTACT.salesEmail}</p>
                  <p className="pt-2 text-xs text-muted-foreground">
                    For contracted freight, warehousing and fulfilment programmes.
                  </p>
                </CardContent>
              </Card>

              <Card className="border-primary/20 bg-primary/5">
                <CardContent className="space-y-2 p-4 text-sm">
                  <p className="flex items-center gap-2 font-semibold text-foreground">
                    <Warehouse className="h-4 w-4 text-primary" /> Honest scope
                  </p>
                  <p className="text-muted-foreground">
                    Freight, truck dispatch, warehousing and fulfilment are quoted by our commercial team, not
                    instantly booked. Parcels, documents and city express are priced and booked online.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </div>
    </MarketingLayout>
  );
};

export default FreightEnquiry;
