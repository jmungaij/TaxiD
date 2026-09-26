import { Link } from "react-router-dom";
import {
  ShieldCheck, Car, Radar, Siren, Umbrella, Fingerprint, Lock, Scale, EyeOff, ArrowRight,
} from "lucide-react";

const PILLARS = [
  { icon: ShieldCheck, t: "Verified Drivers", d: "Background, NTSA and document verification before activation.", to: "/rider/safety" },
  { icon: Car, t: "Verified Fleet", d: "Inspection records and roadworthiness checks per vehicle.", to: "/rider/safety" },
  { icon: Radar, t: "Trip Monitoring", d: "Route deviation and idle-time detection on live trips.", to: "/rider/safety" },
  { icon: Siren, t: "Emergency Assistance", d: "One-tap SOS routed to our 24/7 safety centre.", to: "/rider/safety" },
  { icon: Umbrella, t: "Insurance Options", d: "Passenger and cargo cover available per booking.", to: "/rider/safety" },
  { icon: Fingerprint, t: "Identity Verification", d: "Rider and operator identity checks on sensitive journeys.", to: "/security-center" },
  { icon: Lock, t: "Secure Payments", d: "Tokenised payments, no card details stored on device.", to: "/security-center" },
  { icon: Scale, t: "Corporate Compliance", d: "Policy enforcement, audit logs and eTIMS invoicing.", to: "/compliance" },
  { icon: EyeOff, t: "Privacy", d: "Trip data minimised, access controlled and logged.", to: "/security-center" },
];

export function RiderTrustSafety() {
  return (
    <section className="container mx-auto px-4 py-20">
      <div className="max-w-2xl">
        <span className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Trust &amp; safety</span>
        <h2 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">Built to be trusted with the people you care about</h2>
      </div>
      <ul className="mt-10 grid gap-5 md:grid-cols-3">
        {PILLARS.map((p) => (
          <li key={p.t} className="rounded-2xl border border-border bg-card p-6 transition-all hover:border-primary/40 hover:shadow-elegant">
            <p.icon className="mb-3 h-6 w-6 text-primary" aria-hidden />
            <h3 className="font-semibold">{p.t}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{p.d}</p>
            <Link to={p.to} className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
              Learn more <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default RiderTrustSafety;
