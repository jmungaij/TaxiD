/**
 * DriverNetworkCategories — the professional categories the marketplace
 * already supports. Presentation only.
 */
import {
  Car, Building2, Plane, Crown, Bus, Truck, Package, GraduationCap,
  Boxes, Gem, KeyRound, Users, Route,
} from "lucide-react";

const CATEGORIES = [
  { icon: Car, t: "Ride-Hailing" },
  { icon: Building2, t: "Corporate Mobility" },
  { icon: Plane, t: "Airport Transfers" },
  { icon: Crown, t: "Executive Chauffeur" },
  { icon: Bus, t: "Bus Charter" },
  { icon: Users, t: "Van Charter" },
  { icon: Route, t: "Coach Charter" },
  { icon: GraduationCap, t: "School Transport" },
  { icon: Package, t: "Parcel Delivery" },
  { icon: Truck, t: "Courier" },
  { icon: Boxes, t: "Logistics" },
  { icon: Gem, t: "Luxury Transport" },
  { icon: KeyRound, t: "Rental Fleet" },
];

export function DriverNetworkCategories() {
  return (
    <section className="container mx-auto px-4 py-16 md:py-20" aria-labelledby="driver-network-title">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">Professional driver network</p>
      <h2 id="driver-network-title" className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">
        Thirteen ways to earn on one platform
      </h2>
      <ul className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {CATEGORIES.map((c) => (
          <li
            key={c.t}
            className="flex items-center gap-3 rounded-2xl border border-border bg-gradient-to-br from-card to-secondary/30 p-4 transition-all hover:border-primary hover:shadow-md"
          >
            <c.icon className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
            <span className="text-sm font-medium">{c.t}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default DriverNetworkCategories;
