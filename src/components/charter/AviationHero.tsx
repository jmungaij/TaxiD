/**
 * Yalla Air cinematic hero — the Charter Business entry point.
 *
 * Rotating aviation backdrop (jet, helicopter, safari turboprop, cabin) with a
 * glassmorphism charter search widget layered over it, followed by the
 * step-by-step "How to book online" guide.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowRight, Search } from "lucide-react";
import CharterSearchWidget from "./CharterSearchWidget";
import jetExterior from "@/assets/charter/jet-exterior.jpg";
import jetInterior from "@/assets/charter/jet-interior.jpg";
import helicopterImg from "@/assets/charter/helicopter.jpg";
import turbopropImg from "@/assets/charter/turboprop.jpg";

const SLIDES = [
  { src: jetExterior, alt: "Private jet on the apron at golden hour" },
  { src: helicopterImg, alt: "Executive helicopter on a city helipad at dusk" },
  { src: turbopropImg, alt: "Safari turboprop on a Maasai Mara airstrip" },
  { src: jetInterior, alt: "Luxury private jet cabin interior" },
];

const STEPS = [
  { n: 1, t: "Set your route", d: "Enter your departure airport or city and select your destination. Search by airport name, city, IATA code or ICAO code." },
  { n: 2, t: "Choose your journey type", d: "One way, return or multi-city — the form adapts to the itinerary you are building." },
  { n: 3, t: "Pick dates and time", d: "Select travel dates and a preferred departure window, or set an exact departure time." },
  { n: 4, t: "Add your party", d: "Adults, children, infants, pets, baggage and any special assistance requirements." },
  { n: 5, t: "Search available aircraft", d: "Yalla AI instantly searches verified operators across East Africa." },
  { n: 6, t: "Compare aircraft", d: "Review aircraft photos, cabin interiors, seat maps, capacity, flight time, amenities, operator rating and estimated total price." },
  { n: 7, t: "Confirm and fly", d: "Complete payment securely, then receive your itinerary and live trip updates." },
];

export function AviationHero() {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setIdx((i) => (i + 1) % SLIDES.length), 7000);
    return () => window.clearInterval(t);
  }, []);

  return (
    <>
      <section className="relative isolate overflow-hidden border-b border-border">
        {SLIDES.map((s, i) => (
          <img
            key={s.src}
            src={s.src}
            alt={i === idx ? s.alt : ""}
            aria-hidden={i !== idx}
            width={1280}
            height={720}
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-[1600ms] ${
              i === idx ? "opacity-100 scale-105" : "opacity-0"
            }`}
            style={{ transition: "opacity 1.6s ease-in-out, transform 9s ease-out" }}
          />
        ))}
        <div className="absolute inset-0 bg-gradient-to-br from-background/95 via-background/80 to-background/60" aria-hidden />

        <div className="container relative mx-auto px-4 py-14 md:py-20">
          <div className="max-w-3xl">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-primary">Yalla Air · Charter Business</p>
            <h1 className="text-3xl font-bold tracking-tight md:text-5xl">
              Fly Private. Book Instantly. Travel Without Limits.
            </h1>
            <p className="mt-4 text-lg text-muted-foreground">
              Charter aircraft across East Africa with transparent pricing, premium service and seamless
              ground transportation.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button size="lg" asChild>
                <a href="#charter-search"><Search className="mr-2 h-4 w-4" /> Search flights</a>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link to="/contact?subject=charter-enquiry">Request custom charter</Link>
              </Button>
            </div>
          </div>

          <div id="charter-search" className="mt-8 scroll-mt-24">
            <CharterSearchWidget />
          </div>
        </div>
      </section>

      <section className="border-b border-border bg-secondary/30 py-14">
        <div className="container mx-auto px-4">
          <h2 className="text-2xl font-bold md:text-3xl">How to book online</h2>
          <p className="mt-1 text-muted-foreground">Seven steps from search to boarding.</p>
          <ol className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s) => (
              <li key={s.n} className="rounded-xl border border-border bg-card p-5">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                  {s.n}
                </span>
                <h3 className="mt-3 font-semibold">{s.t}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{s.d}</p>
              </li>
            ))}
          </ol>
          <p className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
            Already booked? <Link to="/charter/booking-status" className="inline-flex items-center text-primary">
              Track your flight status <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Link>
          </p>
        </div>
      </section>
    </>
  );
}

export default AviationHero;
