/**
 * HOMEPAGE QUICK ACTIONS — the three things visitors arrive to do.
 *
 * Book a ride and request a charter both hand off to existing portals; joining
 * as a driver goes to the existing driver registration. No new destinations are
 * invented here.
 */
import { Link } from "react-router-dom";
import { ArrowRight, Car, IdCard, Plane, Search } from "lucide-react";
import { Button } from "@/components/ui/button";

const ACTIONS = [
  {
    to: "/rider",
    label: "Book a Ride",
    desc: "Set your pickup, see the fare and travel with a verified driver partner.",
    icon: Car,
    primary: true,
  },
  {
    to: "/marketplace?family=charter",
    label: "Request a Charter",
    desc: "Ground, air and marine charter for groups, projects and events.",
    icon: Plane,
  },
  {
    to: "/driver/apply",
    label: "Join as a Driver",
    desc: "Register as a SAFARID driver partner and access more demand.",
    icon: IdCard,
  },
];

export default function HomeQuickActions() {
  return (
    <section className="border-y border-border bg-card/60 py-10" aria-labelledby="home-quick-actions">
      <div className="container mx-auto px-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="home-quick-actions" className="text-xl font-semibold">
            Start here
          </h2>
          <Link
            to="/marketplace"
            className="group inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            <Search className="h-3.5 w-3.5" aria-hidden />
            Search all capacity by city, date and vehicle
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </Link>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {ACTIONS.map((a) => (
            <div key={a.label} className="rounded-xl border border-border bg-background p-5">
              <a.icon className="mb-3 h-6 w-6 text-primary" aria-hidden />
              <h3 className="font-semibold">{a.label}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{a.desc}</p>
              <Button asChild className="mt-4" variant={a.primary ? "default" : "outline"} size="sm">
                <Link to={a.to}>
                  {a.label} <ArrowRight className="ml-1.5 h-3.5 w-3.5" aria-hidden />
                </Link>
              </Button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
