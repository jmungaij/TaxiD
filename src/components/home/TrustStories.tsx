import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Quote, Star, BadgeCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { JsonLd } from "@/components/seo/JsonLd";

/**
 * Customer stories as proof of capability, not decoration.
 * Each story is tied to a service use case and reads as:
 *   Service used → Vehicle → Journey → Result
 * Filters are functional: they narrow to the matching use case.
 */
type Story = {
  quote: string;
  name: string;
  role: string;
  org: string;
  segment: Segment;
  service: string;
  vehicle: string;
  journey: string;
  metric: string;
};

const SEGMENTS = [
  "Business",
  "Families",
  "Corporate",
  "Tourism",
  "Executive Travel",
  "Airport Transfers",
] as const;
type Segment = (typeof SEGMENTS)[number];

const stories: Story[] = [
  {
    quote:
      "SAFARID replaced three vendors. Approvals, policy limits and monthly reconciliation now happen in one console — our finance team closes mobility spend in a single afternoon.",
    name: "Achieng' Otieno",
    role: "Head of Finance",
    org: "Enterprise services group, Nairobi",
    segment: "Corporate",
    service: "Employee transport across Nairobi",
    vehicle: "Executive sedans · shared shuttles",
    journey: "Policy-approved daily commutes with monthly invoicing",
    metric: "31% lower monthly mobility spend",
  },
  {
    quote:
      "Transparent charter pricing per segment — base, flight, charges and crew — made board approval straightforward. No surprises after the quote.",
    name: "Daniel Mwangi",
    role: "Group Travel Manager",
    org: "Regional corporate client",
    segment: "Executive Travel",
    service: "Executive charter and airport handling",
    vehicle: "Light jet · chauffeured transfer",
    journey: "Nairobi → Kisumu return, same-day board meeting",
    metric: "Quote to wheels-up in 6 hours",
  },
  {
    quote:
      "Live tracking with proof-of-delivery evidence removed the daily disputes. Our SLA compliance is now something we can actually show customers.",
    name: "Fatuma Hassan",
    role: "Logistics Director",
    org: "Distribution network, East Africa",
    segment: "Business",
    service: "Intercity business logistics",
    vehicle: "Freight trucks · dedicated courier",
    journey: "Mombasa corridor distribution with proof of delivery",
    metric: "98.4% on-time delivery",
  },
  {
    quote:
      "Twelve days across three parks with the same vetted driver, one itinerary and one invoice. The family never had to negotiate a single fare.",
    name: "Grace Wanjiru",
    role: "Travel Consultant",
    org: "Inbound tour operator",
    segment: "Tourism",
    service: "Multi-day safari mobility",
    vehicle: "4x4 safari cruiser · guide-driver",
    journey: "Nairobi → Maasai Mara → Naivasha circuit",
    metric: "One itinerary, one settled invoice",
  },
  {
    quote:
      "Flight tracking means the driver is waiting when we land, even on delays. Booking for four adults and two children takes under a minute.",
    name: "Peter Njoroge",
    role: "Frequent traveller",
    org: "Nairobi",
    segment: "Airport Transfers",
    service: "JKIA airport transfer",
    vehicle: "7-seat premium van",
    journey: "JKIA → Karen, flight-tracked meet and greet",
    metric: "Zero missed pickups in 14 trips",
  },
  {
    quote:
      "Trip sharing and SOS give me confidence when my children travel to school and back without me. I can see the whole journey.",
    name: "Amina Yusuf",
    role: "Parent",
    org: "Westlands, Nairobi",
    segment: "Families",
    service: "Family and school journeys",
    vehicle: "Verified comfort sedan",
    journey: "Recurring scheduled school runs with live sharing",
    metric: "Every journey monitored end to end",
  },
];

const badges = [
  "Verified Operators",
  "Insurance Validated",
  "KYB Compliant Fleets",
  "M-Pesa Secure Payments",
  "Licensed Air Operators",
  "24/7 Live Support",
];

const ROTATE_MS = 7000;

const reviewSchema = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "SAFARID",
  url: "https://yalla-africa.lovable.app/",
  aggregateRating: {
    "@type": "AggregateRating",
    ratingValue: "5",
    bestRating: "5",
    worstRating: "1",
    reviewCount: stories.length,
  },
  review: stories.map((s) => ({
    "@type": "Review",
    reviewBody: s.quote,
    name: s.metric,
    author: { "@type": "Person", name: s.name, jobTitle: s.role, worksFor: { "@type": "Organization", name: s.org } },
    itemReviewed: { "@type": "Service", name: `SAFARID — ${s.service}` },
    reviewRating: { "@type": "Rating", ratingValue: "5", bestRating: "5", worstRating: "1" },
  })),
};

const TrustStories = () => {
  const [filter, setFilter] = useState<Segment | "All">("All");
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  const list = useMemo(
    () => (filter === "All" ? stories : stories.filter((s) => s.segment === filter)),
    [filter],
  );

  useEffect(() => setIndex(0), [filter]);

  useEffect(() => {
    if (paused || list.length < 2) return;
    const id = window.setInterval(() => setIndex((i) => (i + 1) % list.length), ROTATE_MS);
    return () => window.clearInterval(id);
  }, [paused, list.length]);

  const story = list[Math.min(index, list.length - 1)];
  const go = (delta: number) => setIndex((i) => (i + delta + list.length) % list.length);

  return (
    <section
      className="bg-background py-20"
      aria-labelledby="trust-stories-heading"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <JsonLd data={reviewSchema} />
      <div className="container mx-auto px-4">
        <div className="mx-auto mb-8 max-w-2xl text-center">
          <span className="text-xs font-semibold uppercase tracking-[0.28em] text-primary">Trust Stories</span>
          <h2 id="trust-stories-heading" className="mt-3 text-3xl font-bold md:text-4xl">
            Moving Kenya's most demanding operations.
          </h2>
          <p className="mt-4 text-muted-foreground">
            Each story maps a real use case: service used, vehicle, journey and outcome.
          </p>
        </div>

        <div className="mb-8 flex flex-wrap justify-center gap-2" role="group" aria-label="Filter stories by use case">
          {(["All", ...SEGMENTS] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setFilter(s)}
              aria-pressed={filter === s}
              className={`min-h-11 rounded-full border px-4 text-xs font-semibold uppercase tracking-wider transition-colors ${
                filter === s
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="relative mx-auto max-w-4xl rounded-3xl border border-border bg-card p-8 shadow-elegant md:p-12">
          <Quote className="h-10 w-10 text-primary/40" />
          <div aria-live="polite">
            <blockquote className="mt-4 text-xl font-medium leading-relaxed md:text-2xl">“{story.quote}”</blockquote>

            <dl className="mt-8 grid gap-4 border-y border-border py-6 sm:grid-cols-3">
              {[
                { k: "Service used", v: story.service },
                { k: "Vehicle", v: story.vehicle },
                { k: "Journey", v: story.journey },
              ].map((row) => (
                <div key={row.k}>
                  <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{row.k}</dt>
                  <dd className="mt-1 text-sm">{row.v}</dd>
                </div>
              ))}
            </dl>

            <div className="mt-6 flex flex-wrap items-end justify-between gap-6">
              <div>
                <p className="font-semibold">{story.name}</p>
                <p className="text-sm text-muted-foreground">{story.role}</p>
                <p className="text-sm text-muted-foreground">{story.org}</p>
              </div>
              <div className="text-right">
                <span className="inline-flex items-center rounded-full bg-secondary px-3 py-1 text-xs font-semibold uppercase tracking-wider text-secondary-foreground">
                  {story.segment}
                </span>
                <p className="mt-2 text-sm font-semibold text-primary">{story.metric}</p>
                <div className="mt-2 flex justify-end gap-0.5" aria-label="Rated 5 out of 5">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star key={i} className="h-4 w-4 fill-primary text-primary" />
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-8 flex items-center justify-between border-t border-border pt-6">
            <div className="flex gap-2">
              {list.map((s, i) => (
                <button
                  key={s.name}
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-label={`Show story from ${s.name}`}
                  aria-current={i === index}
                  className={`h-2 rounded-full transition-all ${
                    i === index ? "w-8 bg-primary" : "w-2 bg-muted hover:bg-muted-foreground/40"
                  }`}
                />
              ))}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="icon" onClick={() => go(-1)} aria-label="Previous story" disabled={list.length < 2}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" onClick={() => go(1)} aria-label="Next story" disabled={list.length < 2}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        <div className="mt-10 flex flex-wrap justify-center gap-3">
          {badges.map((b) => (
            <span
              key={b}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-xs font-medium text-muted-foreground"
            >
              <BadgeCheck className="h-4 w-4 text-status-success" />
              {b}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
};

export default TrustStories;
