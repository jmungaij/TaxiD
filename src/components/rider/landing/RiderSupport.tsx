import { Link } from "react-router-dom";
import { MessageSquare, Phone, Mail, BookOpen, Siren, LifeBuoy, Headset, ArrowRight } from "lucide-react";

const CHANNELS = [
  { icon: MessageSquare, t: "Live chat", d: "Instant answers in the support centre.", to: "/support" },
  { icon: Phone, t: "Phone", d: "Talk to a support agent, 24/7.", to: "/support" },
  { icon: MessageSquare, t: "WhatsApp", d: "Booking help on your favourite app.", to: "/support" },
  { icon: Mail, t: "Email", d: "Detailed queries and documentation.", to: "/contact" },
  { icon: BookOpen, t: "Knowledge centre", d: "Guides, FAQs and pricing explained.", to: "/faq" },
  { icon: Siren, t: "Emergency support", d: "Safety incidents escalated immediately.", to: "/rider/safety" },
  { icon: LifeBuoy, t: "Booking assistance", d: "Help choosing or changing a booking.", to: "/support" },
  { icon: Headset, t: "Corporate concierge", d: "Dedicated support for business accounts.", to: "/corporates" },
];

export function RiderSupport() {
  return (
    <section className="container mx-auto px-4 py-20">
      <div className="max-w-2xl">
        <span className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Support</span>
        <h2 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">Help, whenever you travel</h2>
      </div>
      <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {CHANNELS.map((c) => (
          <li key={c.t}>
            <Link
              to={c.to}
              className="flex h-full flex-col rounded-2xl border border-border bg-card p-5 transition-all hover:border-primary/40 hover:shadow-elegant focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <c.icon className="mb-3 h-5 w-5 text-primary" aria-hidden />
              <h3 className="text-sm font-semibold">{c.t}</h3>
              <p className="mt-1 flex-1 text-xs text-muted-foreground">{c.d}</p>
              <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary">
                Open <ArrowRight className="h-3 w-3" aria-hidden />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default RiderSupport;
