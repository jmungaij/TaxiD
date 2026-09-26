import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { AppButton } from "@/components/nav/AppButton";

type Service = {
  group: string;
  name: string;
  desc: string;
  features: string[];
  price: string;
  availability: string;
  book: string;
  learn: string;
};

const SERVICES: Service[] = [
  { group: "Personal", name: "Ride Hailing", desc: "On-demand city rides with upfront fares.", features: ["<5 min pickup", "Live tracking"], price: "from KSh 250", availability: "Available now", book: "/rider", learn: "/pricing" },
  { group: "Personal", name: "Airport Transfers", desc: "Flat fares with flight tracking and meet & greet.", features: ["Flight monitoring", "Meet & greet"], price: "from KSh 2,200", availability: "24/7 · JKIA & Wilson", book: "/rider/airport", learn: "/pricing" },
  { group: "Personal", name: "Scheduled & Intercity", desc: "Plan trips days or weeks in advance.", features: ["Recurring trips", "Guaranteed vehicle"], price: "from KSh 400", availability: "Book 30 days ahead", book: "/rider/schedule", learn: "/pricing" },
  { group: "Personal", name: "Executive Chauffeur", desc: "Protocol-grade chauffeur service and VIP travel.", features: ["Vetted chauffeurs", "Hourly hire"], price: "from KSh 6,500/day", availability: "On request", book: "/rider", learn: "/riders/corporate" },
  { group: "Business", name: "Corporate Mobility", desc: "Company-paid travel with policy and approvals.", features: ["Cost centres", "eTIMS invoices"], price: "Contracted rates", availability: "Business accounts", book: "/corporates", learn: "/blog/corporate-travel-management-guide" },
  { group: "Business", name: "Employee Transport", desc: "Managed daily staff shuttles and night runs.", features: ["Route planning", "Attendance"], price: "Per-route pricing", availability: "Contract based", book: "/riders/corporate", learn: "/corporates" },
  { group: "Charter", name: "Bus & Coach Charter", desc: "Staff, school, tour and VIP shuttle charter.", features: ["18–70 seats", "Verified operators"], price: "from KSh 28,000/day", availability: "Live fleet search", book: "/charter", learn: "/charter" },
  { group: "Charter", name: "Van Charter", desc: "Group travel, events and small-team transfers.", features: ["7–14 seats", "Driver included"], price: "from KSh 12,000/day", availability: "Same-day", book: "/charter", learn: "/charter" },
  { group: "Charter", name: "Private Aircraft", desc: "Private jets and turboprops across the region.", features: ["Empty legs", "Crewed"], price: "On quotation", availability: "Charter concierge", book: "/charter", learn: "/charter" },
  { group: "Charter", name: "Helicopter Charter", desc: "Transfers, aerial tours and offshore support.", features: ["Fast transfers", "Licensed crews"], price: "On quotation", availability: "On request", book: "/charter", learn: "/charter" },
  { group: "Charter", name: "Boat & Yacht Charter", desc: "Yachts, ferries and cargo vessels.", features: ["Coastal routes", "Crewed"], price: "On quotation", availability: "Coast & lakes", book: "/charter", learn: "/charter" },
  { group: "Rentals", name: "Car & SUV Rental", desc: "Self-drive fleet with flexible durations.", features: ["Daily/monthly", "Insurance options"], price: "from KSh 4,500/day", availability: "Live availability", book: "/rentals", learn: "/rentals" },
  { group: "Rentals", name: "Luxury Vehicles", desc: "Premium cars, chauffeur-driven or self-drive.", features: ["Executive fleet", "Airport delivery"], price: "from KSh 18,000/day", availability: "Limited fleet", book: "/rentals", learn: "/rentals" },
  { group: "Rentals", name: "Truck & Hauler Hire", desc: "Commercial transport for business loads.", features: ["3T–30T", "Driver optional"], price: "from KSh 9,000/day", availability: "Regional", book: "/rentals", learn: "/rentals" },
  { group: "Rentals", name: "Equipment Rental", desc: "Project gear, tools and heavy equipment.", features: ["Excavators", "Event gear"], price: "On quotation", availability: "Project based", book: "/rentals", learn: "/rentals" },
  { group: "Send", name: "Courier & Express", desc: "Documents, medical and legal same-day delivery.", features: ["POD photos", "Live GPS"], price: "from KSh 200", availability: "Same day", book: "/delivery", learn: "/delivery" },
  { group: "Send", name: "Parcel Delivery", desc: "Everyday parcels across the city.", features: ["Instant quotes", "Insured"], price: "from KSh 350", availability: "Available now", book: "/delivery", learn: "/delivery" },
  { group: "Send", name: "Freight & Logistics", desc: "Cross-dock, regional hubs and repeat routes.", features: ["SLA tracking", "Warehouse"], price: "Contracted", availability: "B2B", book: "/delivery", learn: "/delivery" },
];

const GROUPS = ["Personal", "Business", "Charter", "Rentals", "Send"] as const;

export function RiderMarketplace() {
  return (
    <section id="marketplace" className="scroll-mt-24 border-t border-border bg-secondary/30 py-20">
      <div className="container mx-auto px-4">
        <div className="max-w-2xl">
          <span className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">The marketplace</span>
          <h2 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">Everything you can book</h2>
          <p className="mt-3 text-muted-foreground">
            One account and one booking experience across every SAFARID service — with verified
            operators, transparent pricing and live availability.
          </p>
        </div>

        {GROUPS.map((g) => (
          <div key={g} className="mt-12">
            <h3 className="mb-5 text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">{g}</h3>
            <ul className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {SERVICES.filter((s) => s.group === g).map((s) => (
                <li key={s.name} className="group flex flex-col rounded-2xl border border-border bg-card p-6 transition-all hover:border-primary/40 hover:shadow-elegant">
                  <div className="flex items-start justify-between gap-3">
                    <h4 className="font-semibold">{s.name}</h4>
                    <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">{s.availability}</span>
                  </div>
                  <p className="mt-2 flex-1 text-sm text-muted-foreground">{s.desc}</p>
                  <ul className="mt-4 flex flex-wrap gap-2">
                    {s.features.map((f) => (
                      <li key={f} className="rounded-full bg-muted px-2.5 py-1 text-[11px] text-muted-foreground">{f}</li>
                    ))}
                  </ul>
                  <p className="mt-4 text-sm font-semibold text-foreground">{s.price}</p>
                  <div className="mt-4 flex items-center gap-3 border-t border-border pt-4">
                    <AppButton size="sm" analytics={`rider_marketplace_book_${s.name.toLowerCase().replace(/[^a-z]+/g, "_")}`} action="navigate" target={s.book}>
                      Book Now
                    </AppButton>
                    <Link to={s.learn} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                      Learn about {s.name.toLowerCase()} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

export default RiderMarketplace;
