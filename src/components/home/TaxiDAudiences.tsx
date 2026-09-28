import { ArrowUpRight, BriefcaseBusiness, CarFront, UsersRound } from "lucide-react";
import { Link } from "react-router-dom";
import driverImage from "@/assets/driver/taxid-driver-daylight.jpg";
import businessImage from "@/assets/corporates.jpg";
import riderImage from "@/assets/rider/taxid-rider-daylight.jpg";

const audiences = [
  {
    icon: CarFront,
    eyebrow: "For drivers",
    title: "Drive with confidence.",
    description: "Apply to join TaxiD, submit your documents and follow your application from one place.",
    action: "Start driving",
    href: "/driver/onboarding",
    image: driverImage,
    alt: "TaxiD driver ready for a journey",
    accent: "text-primary",
    line: "bg-primary",
  },
  {
    icon: UsersRound,
    eyebrow: "For fleet partners",
    title: "Grow your fleet.",
    description: "Explore the fleet-owner path and manage your vehicles and partner application.",
    action: "Explore fleet partnership",
    href: "/partner/fleet-owner",
    image: riderImage,
    alt: "A TaxiD passenger meeting a transport partner",
    accent: "text-status-success",
    line: "bg-status-success",
  },
  {
    icon: BriefcaseBusiness,
    eyebrow: "For business",
    title: "Keep business moving.",
    description: "Create an organisation account, request a fleet quote and track your own requests.",
    action: "Explore Power Business",
    href: "/business/portal",
    image: businessImage,
    alt: "Corporate passengers and professional transport",
    accent: "text-primary",
    line: "bg-gold",
  },
];

export function TaxiDAudiences() {
  return (
    <section aria-labelledby="taxid-audiences-title" className="border-b border-border bg-background py-14 md:py-20">
      <div className="container mx-auto px-4">
        <div className="mb-9 max-w-3xl">
          <p className="text-sm font-semibold text-primary">A place for every journey</p>
          <h2 id="taxid-audiences-title" className="mt-2 text-3xl font-bold leading-tight md:text-4xl">
            <span className="text-primary">Move people.</span>{" "}
            <span className="text-status-success">Create opportunity.</span>{" "}
            <span className="text-foreground">Power business.</span>
          </h2>
        </div>
        <div className="grid gap-7 md:grid-cols-3">
          {audiences.map((audience) => (
            <article key={audience.eyebrow} className="min-w-0 border-t border-border pt-4">
              <div className={`mb-4 h-1 w-12 ${audience.line}`} aria-hidden="true" />
              <div className="aspect-[16/10] overflow-hidden rounded-md bg-muted">
                <img src={audience.image} alt={audience.alt} loading="lazy" className="h-full w-full object-cover" />
              </div>
              <div className={`mt-5 flex items-center gap-2 text-sm font-semibold ${audience.accent}`}>
                <audience.icon className="h-5 w-5" aria-hidden="true" />
                {audience.eyebrow}
              </div>
              <h3 className="mt-2 text-xl font-bold text-foreground">{audience.title}</h3>
              <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">{audience.description}</p>
              <Link to={audience.href} className="mt-5 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                {audience.action} <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}