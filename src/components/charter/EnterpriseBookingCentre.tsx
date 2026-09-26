/**
 * Enterprise Booking Centre.
 *
 * ONE booking engine that switches wizard shape by sector — Bus & Road,
 * Flight, Marine, Logistics and Rental — while reusing every existing
 * service: the charter catalogue and pricing engine (`computeQuote`), the
 * portal pricing/procurement profiles, the corporate wallet + notification
 * services and the booking audit trail already wired into the mission
 * planner. No sector gets a parallel implementation.
 */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ArrowRight, Bus, Plane, Ship, Truck, KeyRound, Info } from "lucide-react";
import {
  CHARTER_CATALOG, categoryBySlug, computeQuote, defaultCostSettings, formatMoney,
  itemFromRate, type CharterCategory,
} from "@/lib/charter/catalog";
import { loadPricingProfile } from "@/lib/charter/portalProfile";

export type BookingSector = "bus" | "flight" | "marine" | "logistics" | "rental";

interface SectorSpec {
  key: BookingSector;
  label: string;
  icon: typeof Bus;
  blurb: string;
  slugs: string[];
  /** Wizard fields this sector requires beyond the shared spine. */
  fields: Array<"route" | "airports" | "ports" | "cargo" | "collection">;
  unitLabel: string;
}

export const BOOKING_SECTORS: SectorSpec[] = [
  {
    key: "bus",
    label: "Bus, van & coach",
    icon: Bus,
    blurb: "Staff shuttles, delegate movements and executive road missions.",
    slugs: ["bus-charter"],
    fields: ["route"],
    unitLabel: "Days of service",
  },
  {
    key: "flight",
    label: "Flight",
    icon: Plane,
    blurb: "Private aircraft and helicopter charter with crew and handling.",
    slugs: ["aircraft-charter", "helicopter-charter"],
    fields: ["airports"],
    unitLabel: "Flight hours",
  },
  {
    key: "marine",
    label: "Marine",
    icon: Ship,
    blurb: "Boat and ship charter for coastal transfers and offshore work.",
    slugs: ["marine-charter"],
    fields: ["ports"],
    unitLabel: "Days at sea",
  },
  {
    key: "logistics",
    label: "Logistics",
    icon: Truck,
    blurb: "Trucks, haulers and heavy machinery for project cargo.",
    slugs: ["truck-hauler-leasing", "heavy-machinery-leasing"],
    fields: ["route", "cargo"],
    unitLabel: "Days on hire",
  },
  {
    key: "rental",
    label: "Rental",
    icon: KeyRound,
    blurb: "Cars, equipment and event assets on short or long hire.",
    slugs: ["car-rentals", "equipment-rentals", "event-rentals"],
    fields: ["collection"],
    unitLabel: "Rental units",
  },
];

const availableCategories = (spec: SectorSpec): CharterCategory[] =>
  spec.slugs.map((s) => categoryBySlug(s)).filter((c): c is CharterCategory => Boolean(c));

interface Props {
  /** Restrict the sector switcher (e.g. employee mobility = bus + rental). */
  sectors?: BookingSector[];
  /** Pre-selected sector. */
  initialSector?: BookingSector;
  /** Procurement defaults already captured by the workspace. */
  costCenter?: string;
  organizationName?: string;
}

export function EnterpriseBookingCentre({
  sectors, initialSector, costCenter, organizationName,
}: Props) {
  const navigate = useNavigate();
  const specs = useMemo(
    () => (sectors ? BOOKING_SECTORS.filter((s) => sectors.includes(s.key)) : BOOKING_SECTORS),
    [sectors],
  );
  const [sectorKey, setSectorKey] = useState<BookingSector>(initialSector ?? specs[0]?.key ?? "bus");
  const spec = specs.find((s) => s.key === sectorKey) ?? specs[0];
  const categories = useMemo(() => (spec ? availableCategories(spec) : []), [spec]);
  const [slug, setSlug] = useState<string>(categories[0]?.slug ?? "");
  const category = categoryBySlug(slug) ?? categories[0];
  const [assetName, setAssetName] = useState<string>(category?.inventory[0]?.name ?? "");
  const [duration, setDuration] = useState<number>(category?.defaultDuration ?? 1);
  const [quantity, setQuantity] = useState(1);
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [departDate, setDepartDate] = useState("");
  const [cargo, setCargo] = useState("");

  const switchSector = (next: string) => {
    const nextSpec = specs.find((s) => s.key === next);
    if (!nextSpec) return;
    setSectorKey(nextSpec.key);
    const cats = availableCategories(nextSpec);
    const first = cats[0];
    setSlug(first?.slug ?? "");
    setAssetName(first?.inventory[0]?.name ?? "");
    setDuration(first?.defaultDuration ?? 1);
  };

  const switchCategory = (nextSlug: string) => {
    setSlug(nextSlug);
    const cat = categoryBySlug(nextSlug);
    setAssetName(cat?.inventory[0]?.name ?? "");
    setDuration(cat?.defaultDuration ?? 1);
  };

  const asset = category?.inventory.find((i) => i.name === assetName) ?? category?.inventory[0];

  const estimate = useMemo(() => {
    if (!category || !asset) return null;
    const profile = loadPricingProfile() ?? {};
    return computeQuote({
      category,
      baseRate: itemFromRate(asset),
      duration,
      quantity,
      costs: { ...defaultCostSettings(category), ...profile },
    });
  }, [category, asset, duration, quantity]);

  const blockers: string[] = [];
  if (!category) blockers.push("Select a service line.");
  if (!asset) blockers.push("Select an asset.");
  if (spec?.fields.includes("route") && (!origin.trim() || !destination.trim()))
    blockers.push("Enter the pickup and drop-off locations.");
  if (spec?.fields.includes("airports") && (!origin.trim() || !destination.trim()))
    blockers.push("Enter the departure and arrival airports.");
  if (spec?.fields.includes("ports") && (!origin.trim() || !destination.trim()))
    blockers.push("Enter the embarkation and disembarkation ports.");
  if (spec?.fields.includes("cargo") && !cargo.trim())
    blockers.push("Describe the cargo or machinery being moved.");
  if (spec?.fields.includes("collection") && !origin.trim())
    blockers.push("Enter the collection location.");
  if (!departDate) blockers.push("Choose the start date.");

  const continueToPlanner = () => {
    if (!category || blockers.length > 0) return;
    const params = new URLSearchParams({
      sector: sectorKey,
      asset: asset?.name ?? "",
      duration: String(duration),
      quantity: String(quantity),
      from: origin,
      to: destination,
      date: departDate,
    });
    if (cargo) params.set("cargo", cargo);
    if (costCenter) params.set("costCenter", costCenter);
    if (organizationName) params.set("company", organizationName);
    navigate(`/dashboard/charter/book/${category.slug}?${params.toString()}`);
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" role="tablist" aria-label="Booking sector">
        {specs.map((s) => {
          const Icon = s.icon;
          const active = s.key === sectorKey;
          return (
            <button
              key={s.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => switchSector(s.key)}
              className={`rounded-xl border p-4 text-left transition-colors ${
                active
                  ? "border-primary bg-primary/10 shadow-enterprise-sm"
                  : "border-border bg-card hover:border-primary/40"
              }`}
            >
              <Icon className={`h-5 w-5 ${active ? "text-primary" : "text-muted-foreground"}`} aria-hidden />
              <p className="mt-2 font-semibold text-sm">{s.label}</p>
              <p className="mt-1 text-xs text-muted-foreground">{s.blurb}</p>
            </button>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {spec?.label} wizard
            {category && (
              <Badge variant="outline" className="ml-2 align-middle">{category.label}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="bc-line">Service line</Label>
              <Select value={slug} onValueChange={switchCategory}>
                <SelectTrigger id="bc-line"><SelectValue placeholder="Select a service line" /></SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.slug} value={c.slug}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bc-asset">Asset</Label>
              <Select value={asset?.name ?? ""} onValueChange={setAssetName}>
                <SelectTrigger id="bc-asset"><SelectValue placeholder="Select an asset" /></SelectTrigger>
                <SelectContent>
                  {(category?.inventory ?? []).map((i) => (
                    <SelectItem key={i.name} value={i.name}>{i.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="bc-from">
                {spec?.fields.includes("airports")
                  ? "Departure airport"
                  : spec?.fields.includes("ports")
                    ? "Embarkation port"
                    : spec?.fields.includes("collection")
                      ? "Collection location"
                      : "Pickup location"}
              </Label>
              <Input id="bc-from" value={origin} onChange={(e) => setOrigin(e.target.value)} placeholder="e.g. Nairobi CBD" />
            </div>
            {!spec?.fields.includes("collection") && (
              <div className="space-y-1.5">
                <Label htmlFor="bc-to">
                  {spec?.fields.includes("airports")
                    ? "Arrival airport"
                    : spec?.fields.includes("ports")
                      ? "Disembarkation port"
                      : "Drop-off location"}
                </Label>
                <Input id="bc-to" value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="e.g. Mombasa" />
              </div>
            )}
          </div>

          {spec?.fields.includes("cargo") && (
            <div className="space-y-1.5">
              <Label htmlFor="bc-cargo">Cargo / machinery</Label>
              <Input id="bc-cargo" value={cargo} onChange={(e) => setCargo(e.target.value)} placeholder="e.g. 2 × 20ft containers, 24t" />
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="bc-date">Start date</Label>
              <Input id="bc-date" type="date" value={departDate} onChange={(e) => setDepartDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bc-duration">{spec?.unitLabel}</Label>
              <Input
                id="bc-duration" type="number" min={1} value={duration}
                onChange={(e) => setDuration(Math.max(1, Number(e.target.value) || 1))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bc-qty">Units / assets</Label>
              <Input
                id="bc-qty" type="number" min={1} value={quantity}
                onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
              />
            </div>
          </div>

          <Separator />

          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Indicative price</p>
              <p className="text-2xl font-bold tabular-nums">
                {estimate && category ? formatMoney(estimate.net, category.currency) : "—"}
              </p>
              <p className="text-xs text-muted-foreground">
                Derived from the trip details and the selected asset category — governed rate cards apply at quotation.
              </p>
            </div>
            <Button onClick={continueToPlanner} disabled={blockers.length > 0}>
              Continue in mission planner<ArrowRight className="ml-2 h-4 w-4" aria-hidden />
            </Button>
          </div>

          {blockers.length > 0 && (
            <div role="status" className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm">
              <p className="flex items-center gap-2 font-medium text-destructive">
                <Info className="h-4 w-4" aria-hidden /> Complete these before continuing
              </p>
              <ul className="mt-1 list-disc pl-6 text-muted-foreground">
                {blockers.map((b) => <li key={b}>{b}</li>)}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Every sector reuses the same booking, pricing, wallet, notification and audit services — the wizard only
        changes which mission details it collects. {CHARTER_CATALOG.length} service lines are registered.
      </p>
    </div>
  );
}
