import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";

type Item = { label: string; href: string; desc: string };

const LIBRARY: Record<string, Item> = {
  riders: { label: "Rides", href: "/riders", desc: "Everyday rides, airport transfers and scheduled journeys." },
  drivers: { label: "Drive with Yalla Mobility", href: "/drivers", desc: "Access more demand, manage your work and get paid." },
  corporates: { label: "Corporate Mobility", href: "/corporates", desc: "Controlled spending, approvals and reporting for organisations." },
  delivery: { label: "Package Delivery", href: "/delivery", desc: "Parcels, courier, freight and managed logistics." },
  rentals: { label: "Car Rentals", href: "/rentals", desc: "Vehicle rental, chauffeured travel and long-term leasing." },
  enterprise: { label: "Enterprise Solutions", href: "/enterprise", desc: "Mobility technology for operators and large organisations." },
  pricing: { label: "Pricing", href: "/pricing", desc: "Fares, fees and business plans explained." },
  careers: { label: "Careers at Yalla Mobility", href: "/careers", desc: "Open roles across engineering, operations and commercial." },
  developers: { label: "Developer APIs", href: "/developers", desc: "APIs for mobility, dispatch and payments." },
  security: { label: "Security Centre", href: "/security", desc: "How we protect customer and business data." },
  faq: { label: "FAQ", href: "/faq", desc: "Answers for customers, driver partners and operators." },
  support: { label: "Help Centre", href: "/support", desc: "Guides, troubleshooting and contact options." },
};

interface CrossLinksProps {
  /** Heading shown above the link grid. */
  heading?: string;
  /** Keys from the link library to render. */
  keys: Array<keyof typeof LIBRARY>;
}

export const CrossLinks = ({ heading = "Explore Yalla Mobility", keys }: CrossLinksProps) => (
  <section className="container mx-auto px-4 py-16">
    <h2 className="text-2xl md:text-3xl font-bold mb-8">{heading}</h2>
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {keys.map((k) => {
        const item = LIBRARY[k];
        if (!item) return null;
        return (
          <Link
            key={k}
            to={item.href}
            aria-label={item.label}
            className="group flex items-start justify-between gap-4 p-5 rounded-xl bg-card border border-border hover:border-primary/40 transition-all"
          >
            <div>
              <div className="font-semibold mb-1">{item.label}</div>
              <p className="text-sm text-muted-foreground">{item.desc}</p>
            </div>
            <ArrowRight className="h-4 w-4 mt-1 text-primary opacity-0 group-hover:opacity-100 transition-opacity" />
          </Link>
        );
      })}
    </div>
  </section>
);

export default CrossLinks;
