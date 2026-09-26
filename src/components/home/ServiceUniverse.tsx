/**
 * "One marketplace. Every way to move." — the five booking universes, organised the
 * way customers think about transport. Presentation only.
 */
import { Link } from "react-router-dom";
import { ArrowRight, Building2, Car, Package, Plane, Wrench } from "lucide-react";
import ridersImg from "@/assets/riders.jpg";
import corporatesImg from "@/assets/corporates.jpg";
import deliveryImg from "@/assets/delivery.jpg";
import jetImg from "@/assets/charter/jet-exterior.jpg";
import truckImg from "@/assets/rentals.jpg";

interface Universe {
  icon: typeof Car;
  title: string;
  tagline: string;
  img: string;
  hub: string;
  items: { label: string; to: string }[];
}

const UNIVERSES: Universe[] = [
  {
    icon: Car,
    title: "Book a Ride",
    tagline: "Everyday rides, airport transfers and scheduled journeys for individuals.",
    img: ridersImg,
    hub: "/riders",
    items: [
      { label: "On-Demand City Rides", to: "/riders" },
      { label: "Airport Transfers", to: "/riders/individual" },
      { label: "Schedule a Ride", to: "/riders" },
      { label: "Luxury Chauffeur", to: "/rentals/chauffeur" },
      { label: "Intercity Travel", to: "/charter/bus-charter" },
    ],
  },
  {
    icon: Building2,
    title: "Corporate Mobility",
    tagline: "Employee, executive and group travel with approvals, reporting and consolidated invoicing.",
    img: corporatesImg,
    hub: "/corporates",
    items: [
      { label: "Employee Transport", to: "/corporates" },
      { label: "Executive Travel", to: "/riders/corporate" },
      { label: "Event & Group Travel", to: "/charter/bus-charter" },
      { label: "Company-Paid Rides", to: "/corporates" },
      { label: "Business Travel Management", to: "/enterprise" },
    ],
  },
  {
    icon: Package,
    title: "Deliver & Logistics",
    tagline: "Parcels, courier, freight and managed logistics for businesses and individuals.",
    img: deliveryImg,
    hub: "/delivery",
    items: [
      { label: "Package & Same-Day Delivery", to: "/delivery/package" },
      { label: "Courier Services", to: "/delivery/courier" },
      { label: "Fleet Delivery", to: "/delivery/fleet" },
      { label: "Freight & Line Haul", to: "/delivery/logistics" },
      { label: "Scheduled Logistics Routes", to: "/delivery/logistics" },
    ],
  },
  {
    icon: Plane,
    title: "Charter Services",
    tagline: "Ground, air and marine charter for groups, projects, events and business travel.",
    img: jetImg,
    hub: "/charter",
    items: [
      { label: "Private Aircraft Charter", to: "/charter/aircraft-charter" },
      { label: "Helicopter Charter", to: "/charter/helicopter-charter" },
      { label: "Bus, Van & Coach Charter", to: "/charter/bus-charter" },
      { label: "Luxury Vehicle Charter", to: "/charter/car-rentals" },
      { label: "Boat, Yacht & Cargo Vessel", to: "/charter/marine-charter" },
    ],
  },
  {
    icon: Wrench,
    title: "Leasing & Commercial Assets",
    tagline: "Vehicles, fleets, equipment and aircraft on flexible rental and long-term lease terms.",
    img: truckImg,
    hub: "/rentals",
    items: [
      { label: "Aircraft Leasing", to: "/charter/aircraft-leasing" },
      { label: "Truck & Lorry Leasing", to: "/charter/truck-hauler-leasing" },
      { label: "Commercial Fleet Leasing", to: "/rentals/corporate-leasing" },
      { label: "Heavy Machinery Leasing", to: "/charter/heavy-machinery-leasing" },
      { label: "Construction & Logistics Equipment", to: "/charter/equipment-rentals" },
    ],
  },
];

export function ServiceUniverse() {
  return (
    <section className="container mx-auto px-4 py-20">
      <div className="mx-auto mb-12 max-w-3xl text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-primary">Everything that moves</p>
        <h2 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">One marketplace. Every way to move.</h2>
        <p className="mt-4 text-muted-foreground">
          SAFARID connects mobility demand with transportation supply: discover verified providers,
          compare options and book rides, charter, rentals, leasing and logistics from one account.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {UNIVERSES.map((u) => (
          <article
            key={u.title}
            className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition-all duration-300 hover:shadow-[var(--shadow-elegant)]"
          >
            <div className="relative h-40 overflow-hidden">
              <img
                src={u.img}
                alt={u.title}
                loading="lazy"
                width={800}
                height={500}
                className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-card via-card/40 to-transparent" />
              <span className="absolute bottom-3 left-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary-glow shadow-lg">
                <u.icon className="h-5 w-5 text-primary-foreground" />
              </span>
            </div>
            <div className="flex flex-1 flex-col p-6">
              <h3 className="text-lg font-semibold tracking-tight">{u.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{u.tagline}</p>
              <ul className="mt-4 flex-1 space-y-2">
                {u.items.map((it) => (
                  <li key={it.label}>
                    <Link
                      to={it.to}
                      className="inline-flex items-center gap-2 text-sm text-foreground/80 transition-colors hover:text-primary"
                    >
                      <span className="h-1 w-1 rounded-full bg-primary" aria-hidden />
                      {it.label}
                    </Link>
                  </li>
                ))}
              </ul>
              <Link
                to={u.hub}
                aria-label={`Explore ${u.title}`}
                className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-primary"
              >
                Explore {u.title} <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </article>
        ))}

        {/* Journey finder */}
        <article className="flex flex-col justify-between rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/10 via-background to-primary-glow/10 p-6">
          <div>
            <h3 className="text-lg font-semibold tracking-tight">Find the right transport for every journey</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              A quick city ride, an urgent courier, a safari van, a school bus, an executive coach, a
              helicopter, a private jet, a yacht or heavy construction equipment.
            </p>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            {[
              { label: "City ride", to: "/riders" },
              { label: "Airport transfer", to: "/riders/individual" },
              { label: "Chauffeur", to: "/rentals/chauffeur" },
              { label: "Courier", to: "/delivery/courier" },
              { label: "Cargo truck", to: "/charter/truck-hauler-leasing" },
              { label: "Safari van", to: "/charter/bus-charter" },
              { label: "School bus", to: "/rentals/bus-coach" },
              { label: "Executive coach", to: "/charter/bus-charter" },
              { label: "Helicopter", to: "/charter/helicopter-charter" },
              { label: "Private aircraft", to: "/charter/aircraft-charter" },
              { label: "Yacht", to: "/charter/marine-charter" },
              { label: "Excavator", to: "/charter/heavy-machinery-leasing" },
            ].map((c) => (
              <Link
                key={c.label}
                to={c.to}
                className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium transition-colors hover:border-primary/50 hover:text-primary"
              >
                {c.label}
              </Link>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}

export default ServiceUniverse;
