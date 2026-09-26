import { ReactNode } from "react";
import { Link } from "react-router-dom";
import MarketingLayout from "@/components/marketing/MarketingLayout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Package,
  Bike,
  Truck,
  Warehouse,
  ArrowRight,
  ShieldCheck,
  FileCheck,
  Car,
  Users,
} from "lucide-react";

export type DeliveryModule = "package" | "courier" | "fleet" | "logistics";

export interface ModuleMeta {
  id: DeliveryModule;
  slug: string;
  label: string;
  tagline: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string; // tailwind text class for accent
  bookingHref: string;
  /** KYC document checklist surfaced on the module page. */
  kycChecklist: string[];
  /** Vehicle categories surfaced on the module page. */
  vehicleCategories: string[];
}

export const DELIVERY_MODULES: Record<DeliveryModule, ModuleMeta> = {
  package: {
    id: "package",
    slug: "package",
    label: "Package Delivery",
    tagline: "Same-day & scheduled parcel delivery",
    description:
      "Send and receive parcels across the city with live tracking, electronic proof of delivery and SLA-backed pricing.",
    icon: Package,
    accent: "text-primary",
    bookingHref: "/delivery/package",
    kycChecklist: [
      "National ID or passport",
      "KRA PIN certificate",
      "Proof of address (≤ 3 months)",
      "Bank or M-Pesa Till verification",
    ],
    vehicleCategories: ["Motorbike (≤ 30 kg)", "Compact car (≤ 100 kg)", "Pickup (≤ 500 kg)"],
  },
  courier: {
    id: "courier",
    slug: "courier",
    label: "Courier Service",
    tagline: "On-demand express couriers",
    description:
      "City pickups targeting 60 minutes. Onboard couriers with identity, conduct and route-compliance checks.",
    icon: Bike,
    accent: "text-primary",
    bookingHref: "/delivery/courier",
    kycChecklist: [
      "National ID or passport",
      "KRA PIN certificate",
      "Good Conduct certificate",
      "Two referees with phone numbers",
      "Courier uniform compliance form",
    ],
    vehicleCategories: ["Bicycle", "E-bike", "Motorbike (125–250cc)"],
  },
  fleet: {
    id: "fleet",
    slug: "fleet",
    label: "Fleet Management",
    tagline: "Operate a commercial fleet",
    description:
      "Multi-vehicle operators: register your company, drivers and vehicles, then manage compliance, maintenance and utilisation in one place.",
    icon: Truck,
    accent: "text-primary",
    bookingHref: "/delivery/fleet",
    kycChecklist: [
      "Certificate of Incorporation / BRS extract",
      "CR12 (≤ 6 months)",
      "KRA PIN certificate",
      "Tax Compliance certificate",
      "Director IDs + KRA PINs",
      "Fleet operator licence",
    ],
    vehicleCategories: ["Sedans (PSV)", "SUVs", "Vans", "Pickups", "Trucks"],
  },
  logistics: {
    id: "logistics",
    slug: "logistics",
    label: "Logistics",
    tagline: "Multi-stop & warehousing",
    description:
      "Bulk routes, scheduled distribution, cross-dock and integrated warehousing for retailers, FMCG and e-commerce.",
    icon: Warehouse,
    accent: "text-primary",
    bookingHref: "/delivery/logistics",
    kycChecklist: [
      "Certificate of Incorporation / BRS extract",
      "CR12 (≤ 6 months)",
      "KRA PIN certificate",
      "Tax Compliance certificate",
      "NTSA TLB (where applicable)",
      "Goods-in-transit insurance",
      "Warehouse licence (if storing goods)",
    ],
    vehicleCategories: ["3-tonne trucks", "5-tonne trucks", "10-tonne trucks", "Refrigerated vans", "Container haulers"],
  },
};

export const DELIVERY_MODULE_LIST: ModuleMeta[] = [
  DELIVERY_MODULES.package,
  DELIVERY_MODULES.courier,
  DELIVERY_MODULES.fleet,
  DELIVERY_MODULES.logistics,
];

interface ModuleShellProps {
  module: ModuleMeta;
  children: ReactNode;
  /**
   * "bare" renders the marketing chrome only, letting the page supply its own
   * cinematic hero and full-bleed sections (DLEP module experience).
   */
  variant?: "default" | "bare";
}

export function ModuleShell({ module, children, variant = "default" }: ModuleShellProps) {
  const Icon = module.icon;
  if (variant === "bare") return <MarketingLayout>{children}</MarketingLayout>;
  return (
    <MarketingLayout>
      <section className="bg-primary text-primary-foreground">
        <div className="container mx-auto px-4 py-14">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider opacity-90 mb-3">
            <Link to="/delivery" className="hover:underline">
              Delivery
            </Link>
            <span>/</span>
            <span>{module.label}</span>
          </div>
          <div className="flex items-start gap-4">
            <div className="rounded-xl bg-ice/20 p-3">
              <Icon className="h-8 w-8" />
            </div>
            <div>
              <Badge variant="secondary" className="mb-2">
                {module.tagline}
              </Badge>
              <h1 className="text-3xl md:text-4xl font-bold">{module.label}</h1>
              <p className="text-primary-foreground/90 mt-2 max-w-2xl">{module.description}</p>
            </div>
          </div>
        </div>
      </section>
      <div className="container mx-auto px-4 py-10 max-w-7xl">{children}</div>
    </MarketingLayout>
  );
}

/** Public hub showing the 4 categories. */
export function DeliveryHub() {
  return (
    <MarketingLayout>
      <section className="bg-primary text-primary-foreground">
        <div className="container mx-auto px-4 py-20 max-w-4xl text-center">
          <span className="inline-block px-3 py-1 rounded-full bg-ice/20 text-xs font-semibold mb-4 uppercase tracking-wider">
            Delivery & Logistics
          </span>
          <h1 className="text-4xl md:text-5xl font-bold mb-4">
            One delivery network. Four enterprise modules.
          </h1>
          <p className="text-lg text-primary-foreground/90 max-w-2xl mx-auto">
            Pick the module that matches how you ship. Each one ships with its own KYC, document workflow,
            vehicle registry and onboarding wizard.
          </p>
        </div>
      </section>

      <section className="container mx-auto px-4 py-16 max-w-6xl">
        <div className="grid md:grid-cols-2 gap-6">
          {DELIVERY_MODULE_LIST.map((m) => {
            const Icon = m.icon;
            return (
              <Card key={m.id} className="p-6 hover:border-primary/40 transition-colors">
                <div className="flex items-start gap-4">
                  <div className="rounded-lg bg-primary/10 p-3">
                    <Icon className={`h-7 w-7 ${m.accent}`} />
                  </div>
                  <div className="flex-1">
                    <h2 className="text-xl font-bold">{m.label}</h2>
                    <p className="text-xs uppercase tracking-wider text-muted-foreground mt-0.5">
                      {m.tagline}
                    </p>
                    <p className="text-sm text-muted-foreground mt-3">{m.description}</p>
                    <div className="mt-4 grid grid-cols-3 gap-2 text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Users className="h-3 w-3" /> Onboarding
                      </span>
                      <span className="flex items-center gap-1">
                        <ShieldCheck className="h-3 w-3" /> KYC + docs
                      </span>
                      <span className="flex items-center gap-1">
                        <Car className="h-3 w-3" /> Vehicles
                      </span>
                    </div>
                    <Button asChild className="mt-5">
                      <Link to={m.bookingHref}>
                        Open {m.label} <ArrowRight className="h-4 w-4 ml-1" />
                      </Link>
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </section>

      <section className="bg-secondary/40 py-16">
        <div className="container mx-auto px-4 max-w-5xl">
          <h2 className="text-2xl font-bold mb-6 text-center">Every module ships with…</h2>
          <div className="grid sm:grid-cols-3 gap-4">
            <Card className="p-5">
              <Users className="h-5 w-5 text-primary mb-2" />
              <div className="font-semibold text-sm">Onboarding wizard</div>
              <p className="text-xs text-muted-foreground mt-1">
                Multi-step capture of company, contact and service-area details with progress autosave.
              </p>
            </Card>
            <Card className="p-5">
              <FileCheck className="h-5 w-5 text-primary mb-2" />
              <div className="font-semibold text-sm">KYC & document workflow</div>
              <p className="text-xs text-muted-foreground mt-1">
                Per-module document checklist with upload, verification status and expiry tracking.
              </p>
            </Card>
            <Card className="p-5">
              <Car className="h-5 w-5 text-primary mb-2" />
              <div className="font-semibold text-sm">Vehicle registry</div>
              <p className="text-xs text-muted-foreground mt-1">
                Vehicle categories tuned for each module, registration plates, capacity and assignment.
              </p>
            </Card>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
