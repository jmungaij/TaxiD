/**
 * Employee Mobility fleet showcase — swipeable marketplace carousel.
 *
 * Each card deep-links into the EXISTING charter planner with the vehicle class,
 * capacity and category pre-selected, so no data is re-entered after hand-off.
 * Comparison is client-side only (presentation), and every interaction reports
 * into the shared Employee Mobility funnel analytics.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Check, GitCompareArrows, Share2, Star, Users } from "lucide-react";
import {
  Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious,
  type CarouselApi,
} from "@/components/ui/carousel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { VEHICLE_IMAGES } from "@/lib/charter/vehicleImages";
import { charterPlannerPath, portalEntryHref } from "@/lib/charter/portalRoutes";
import { trackEmCta, trackEmStep } from "@/lib/marketing/employeeMobilityFunnel";

export interface FleetVehicle {
  key: string;
  name: string;
  seats: string;
  capacity: number;
  note: string;
  category: string;
  rating: number;
  reviews: number;
  fromKes: number;
  amenities: string[];
}

interface Props {
  vehicles: FleetVehicle[];
  authenticated: boolean;
  /** Passenger count captured in the booking widget, if any. */
  passengers?: string;
}

const kes = (n: number) => `KES ${n.toLocaleString("en-KE")}`;

export function FleetCarousel({ vehicles, authenticated, passengers }: Props) {
  const [api, setApi] = useState<CarouselApi>();
  const [current, setCurrent] = useState(0);
  const [compare, setCompare] = useState<string[]>([]);

  useEffect(() => {
    if (!api) return;
    const onSelect = () => {
      const i = api.selectedScrollSnap();
      setCurrent(i);
      const v = vehicles[i];
      if (v) trackEmStep("vehicle_viewed", { vehicle: v.key, vehicle_name: v.name, slide: i });
    };
    onSelect();
    api.on("select", onSelect);
    return () => { api.off("select", onSelect); };
  }, [api, vehicles]);

  /** Deep link that pre-selects vehicle class, capacity and category. */
  const bookHref = (v: FleetVehicle) => {
    const params = new URLSearchParams({
      fleet: v.key,
      vehicle: v.name,
      pax: passengers && Number(passengers) > 0 ? passengers : String(v.capacity),
      category: v.category,
      source: "employee-mobility-fleet",
    });
    return portalEntryHref(
      charterPlannerPath("bus-charter", `?${params.toString()}`),
      authenticated,
      `employee-mobility-fleet-${v.key}`,
    );
  };

  const comparison = useMemo(
    () => vehicles.filter((v) => compare.includes(v.key)),
    [compare, vehicles],
  );

  function toggleCompare(v: FleetVehicle) {
    setCompare((prev) => {
      const next = prev.includes(v.key)
        ? prev.filter((k) => k !== v.key)
        : [...prev, v.key].slice(-3);
      trackEmStep("vehicle_compared", { vehicle: v.key, selection: next });
      return next;
    });
  }

  async function share(v: FleetVehicle) {
    const url = `${window.location.origin}/riders/corporate#fleet-${v.key}`;
    trackEmStep("vehicle_viewed", { vehicle: v.key, action: "share" });
    try {
      if (navigator.share) await navigator.share({ title: `${v.name} — SAFARID`, url });
      else {
        await navigator.clipboard.writeText(url);
        toast({ title: "Link copied", description: `${v.name} link copied to your clipboard.` });
      }
    } catch {
      /* user dismissed the share sheet */
    }
  }

  return (
    <div>
      <Carousel
        setApi={setApi}
        opts={{ align: "start", loop: true }}
        className="w-full"
        aria-roledescription="carousel"
        aria-label="Corporate fleet classes"
      >
        <CarouselContent className="-ml-4">
          {vehicles.map((v, i) => {
            const selected = compare.includes(v.key);
            return (
              <CarouselItem
                key={v.key}
                id={`fleet-${v.key}`}
                className="pl-4 sm:basis-1/2 lg:basis-1/3"
                aria-roledescription="slide"
                aria-label={`${v.name}, slide ${i + 1} of ${vehicles.length}`}
              >
                <article className="flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card transition-colors hover:border-primary/40">
                  <div className="relative aspect-[16/10] overflow-hidden bg-muted">
                    <img
                      src={VEHICLE_IMAGES[v.key]}
                      alt={`${v.name} — ${v.seats}, SAFARID corporate fleet`}
                      loading={i < 2 ? "eager" : "lazy"}
                      decoding="async"
                      width={640}
                      height={400}
                      className="size-full object-cover"
                    />
                    <Badge className="absolute left-3 top-3 gap-1 bg-background/90 text-foreground">
                      <Star className="h-3.5 w-3.5 text-primary" aria-hidden />
                      {v.rating.toFixed(1)}
                      <span className="text-muted-foreground">({v.reviews})</span>
                    </Badge>
                  </div>

                  <div className="flex flex-1 flex-col p-5">
                    <h3 className="font-semibold">{v.name}</h3>
                    <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Users className="h-4 w-4" aria-hidden />{v.seats}
                    </p>
                    <p className="mt-2 text-sm text-muted-foreground">{v.note}</p>

                    <ul className="mt-3 flex flex-wrap gap-1.5">
                      {v.amenities.map((a) => (
                        <li key={a}>
                          <Badge variant="secondary" className="font-normal">{a}</Badge>
                        </li>
                      ))}
                    </ul>

                    <p className="mt-4 text-sm">
                      <span className="font-semibold text-primary">{kes(v.fromKes)}</span>
                      <span className="text-muted-foreground"> corporate rate from / day</span>
                    </p>

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <Button asChild size="sm" className="min-h-11">
                        <Link
                          to={bookHref(v)}
                          onClick={() =>
                            trackEmCta(`employee_mobility.fleet.book.${v.key}`, {
                              step: "vehicle_selected",
                              target: bookHref(v),
                              metadata: { vehicle: v.key, capacity: v.capacity, category: v.category },
                            })
                          }
                        >
                          Book this class <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden />
                        </Link>
                      </Button>
                      <Button
                        size="sm"
                        variant={selected ? "default" : "outline"}
                        className="min-h-11"
                        aria-pressed={selected}
                        onClick={() => toggleCompare(v)}
                      >
                        {selected
                          ? <Check className="mr-1.5 h-4 w-4" aria-hidden />
                          : <GitCompareArrows className="mr-1.5 h-4 w-4" aria-hidden />}
                        Compare
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="min-h-11 min-w-11"
                        aria-label={`Share ${v.name}`}
                        onClick={() => share(v)}
                      >
                        <Share2 className="h-4 w-4" aria-hidden />
                      </Button>
                    </div>
                  </div>
                </article>
              </CarouselItem>
            );
          })}
        </CarouselContent>
        <CarouselPrevious className="hidden min-h-11 min-w-11 sm:flex" aria-label="Previous vehicle" />
        <CarouselNext className="hidden min-h-11 min-w-11 sm:flex" aria-label="Next vehicle" />
      </Carousel>

      <p className="mt-4 text-xs text-muted-foreground sm:hidden">Swipe to browse the fleet.</p>
      <p className="sr-only" aria-live="polite">
        Showing {vehicles[current]?.name ?? ""}, {current + 1} of {vehicles.length}
      </p>

      {comparison.length > 1 && (
        <div className="mt-8 overflow-x-auto rounded-2xl border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold">Comparing {comparison.length} vehicle classes</h3>
          <table className="w-full min-w-[560px] text-sm">
            <caption className="sr-only">Corporate fleet comparison</caption>
            <thead>
              <tr className="text-left text-muted-foreground">
                <th scope="col" className="py-2 pr-4 font-medium">Class</th>
                <th scope="col" className="py-2 pr-4 font-medium">Capacity</th>
                <th scope="col" className="py-2 pr-4 font-medium">Rating</th>
                <th scope="col" className="py-2 pr-4 font-medium">From / day</th>
                <th scope="col" className="py-2 font-medium">Book</th>
              </tr>
            </thead>
            <tbody>
              {comparison.map((v) => (
                <tr key={v.key} className="border-t border-border">
                  <th scope="row" className="py-3 pr-4 text-left font-medium">{v.name}</th>
                  <td className="py-3 pr-4">{v.capacity} seats</td>
                  <td className="py-3 pr-4">{v.rating.toFixed(1)} ({v.reviews})</td>
                  <td className="py-3 pr-4">{kes(v.fromKes)}</td>
                  <td className="py-3">
                    <Button asChild size="sm" variant="outline" className="min-h-11">
                      <Link to={bookHref(v)}>Book</Link>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
