import {
  BadgeCheck, Receipt, CreditCard, Building2, Bot, Navigation,
  Wallet, Headphones, UserCheck, Layers, Search, GitCompare, CalendarCheck,
  MapPin, Car, FileText, Star,
} from "lucide-react";

const BENEFITS = [
  { icon: BadgeCheck, t: "Verified Operators", d: "Every driver, fleet and operator passes NTSA, document and background checks." },
  { icon: Receipt, t: "Transparent Pricing", d: "Upfront fares and itemised receipts — base, distance, time, surge and VAT." },
  { icon: CreditCard, t: "Secure Digital Payments", d: "M-Pesa, card and wallet, protected end to end." },
  { icon: Building2, t: "Corporate Ready", d: "Policy limits, approvals, cost centres and eTIMS-compliant invoicing." },
  { icon: Bot, t: "AI Travel Assistant", d: "Compare services, estimate fares and plan journeys conversationally." },
  { icon: Navigation, t: "Real-Time Tracking", d: "Live ETA, route visibility and shareable trip links for family." },
  { icon: Wallet, t: "Flexible Payment Options", d: "Pay now, use a wallet balance or bill your business account." },
  { icon: Headphones, t: "24/7 Support", d: "Human support, emergency assistance and corporate concierge." },
  { icon: UserCheck, t: "Professional Drivers", d: "Rated, trained and continuously monitored on every trip." },
  { icon: Layers, t: "Integrated Marketplace", d: "Rides, charter, rentals and logistics under one account." },
];

const JOURNEY = [
  { icon: Search, t: "Search", d: "Tell us where you're going." },
  { icon: GitCompare, t: "Compare", d: "See options, fares and operators." },
  { icon: CalendarCheck, t: "Book", d: "Confirm in a few taps." },
  { icon: CreditCard, t: "Pay", d: "M-Pesa, card, wallet or business account." },
  { icon: MapPin, t: "Track", d: "Live location and ETA." },
  { icon: Car, t: "Travel", d: "Monitored, safe and on time." },
  { icon: FileText, t: "Invoice", d: "Itemised receipt, eTIMS ready." },
  { icon: Star, t: "Rate", d: "Feedback that shapes the network." },
];

export function RiderValue() {
  return (
    <>
      <section className="container mx-auto px-4 py-20">
        <div className="max-w-2xl">
          <span className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Why riders choose us</span>
          <h2 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">Confidence on every journey</h2>
          <p className="mt-3 text-muted-foreground">Outcomes you can feel — not features you have to learn.</p>
        </div>
        <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
          {BENEFITS.map((b) => (
            <li key={b.t} className="rounded-2xl border border-border bg-card p-5 transition-shadow hover:shadow-elegant">
              <b.icon className="mb-3 h-6 w-6 text-primary" aria-hidden />
              <h3 className="text-sm font-semibold">{b.t}</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{b.d}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="border-y border-border bg-secondary/30 py-20">
        <div className="container mx-auto px-4">
          <div className="max-w-2xl">
            <span className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Journey experience</span>
            <h2 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">From search to receipt, effortlessly</h2>
          </div>
          <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {JOURNEY.map((s, i) => (
              <li key={s.t} className="relative rounded-2xl border border-border bg-card p-5">
                <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Step {i + 1}</span>
                <s.icon className="mt-3 h-5 w-5 text-primary" aria-hidden />
                <h3 className="mt-2 font-semibold">{s.t}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{s.d}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </>
  );
}

export default RiderValue;
