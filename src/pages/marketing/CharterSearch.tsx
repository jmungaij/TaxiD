/**
 * Yalla Air charter search results — the marketplace comparison surface.
 *
 * Reads the search brief from the URL, prices every eligible aircraft through
 * the governed aviation pricing engine, and presents price insights, an AI
 * recommendation, airport intelligence, aircraft imagery with seat selection,
 * and ground-transport bundling before handing off to the booking workflow.
 */
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { SeoHead } from "@/components/seo/SeoHead";
import { MarketingPage } from "@/components/marketing/PageHero";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ArrowRight, Car, Clock, Gauge, Sparkles, Star, Users } from "lucide-react";
import CharterSearchWidget from "@/components/charter/CharterSearchWidget";
import { paramsToCriteria } from "@/lib/charter/searchParams";
import { searchCharter, type AircraftOption } from "@/lib/charter/flightSearch";
import { GROUND_SERVICES } from "@/lib/charter/groundTransport";
import { AirportIntelPanel } from "@/components/charter/AirportIntelPanel";

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** Cabin plan picker — customers who care about seating choose it up front. */
function SeatSelector({ option, selected, onToggle, capacity }: {
  option: AircraftOption; selected: string[]; onToggle: (id: string) => void; capacity: number;
}) {
  const { seatMap } = option;
  return (
    <div>
      <div className="mx-auto w-fit rounded-[2rem] border border-border bg-muted/40 p-4">
        <p className="mb-3 text-center text-xs uppercase tracking-wide text-muted-foreground">Flight deck</p>
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${seatMap.layout}, minmax(0,1fr))` }}>
          {seatMap.seats.map((id) => {
            const isSelected = selected.includes(id);
            const full = !isSelected && selected.length >= capacity;
            return (
              <button
                key={id}
                type="button"
                disabled={full}
                aria-pressed={isSelected}
                aria-label={`Seat ${id}${seatMap.windows.includes(id) ? " (window)" : ""}`}
                onClick={() => onToggle(id)}
                className={`h-11 w-11 rounded-lg border text-xs font-medium transition-colors disabled:opacity-40 ${
                  isSelected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background hover:border-primary/60"
                }`}
              >
                {id}
              </button>
            );
          })}
        </div>
      </div>
      <p className="mt-3 text-center text-xs text-muted-foreground">{seatMap.note}</p>
      <p className="mt-1 text-center text-sm">
        {selected.length}/{capacity} seats selected{selected.length ? `: ${selected.join(", ")}` : ""}
      </p>
    </div>
  );
}

/** Airport briefing card — shared with the booking itinerary. */
const AirportIntel = AirportIntelPanel;

/** Shared with the booking itinerary so quoted legs carry through to payment. */
const GROUND_OPTIONS = GROUND_SERVICES;

const CharterSearchPage = () => {
  const [params] = useSearchParams();
  const criteria = useMemo(() => paramsToCriteria(params), [params]);
  const result = useMemo(() => searchCharter(criteria), [criteria]);
  const [seats, setSeats] = useState<Record<string, string[]>>({});
  const [ground, setGround] = useState<string[]>([]);

  const capacity = criteria.passengers.adults + criteria.passengers.children;
  const groundTotal = GROUND_OPTIONS.filter((g) => ground.includes(g.key)).reduce((s, g) => s + g.price, 0);
  const { insight, recommendation, from, to } = result;

  const toggleSeat = (key: string, id: string) =>
    setSeats((p) => {
      const cur = p[key] ?? [];
      return { ...p, [key]: cur.includes(id) ? cur.filter((s) => s !== id) : [...cur, id] };
    });

  const bookHref = (o: AircraftOption) => {
    const q = new URLSearchParams({
      asset: o.aircraft.label,
      rate: String(Math.round(o.price)),
      duration: String(Math.max(1, Math.round(o.hours))),
      qty: "1",
      origin: from?.code ?? criteria.origin,
      destination: to?.code ?? criteria.destination,
      date: criteria.departDate,
      pax: String(capacity),
      cabin: criteria.cabin,
    });
    const chosen = seats[o.aircraft.key] ?? [];
    if (chosen.length) q.set("seats", chosen.join(","));
    if (ground.length) q.set("ground", ground.join(","));
    return `/charter/aircraft-charter/book?${q.toString()}`;
  };

  return (
    <MarketingPage>
      <SeoHead
        title="Charter flight search — compare private aircraft | Yalla Air"
        description="Compare verified private jets, turboprops and helicopters across East Africa with transparent pricing, flight times, cabin imagery and seat selection."
        path="/charter/search"
      />

      <section className="border-b border-border bg-gradient-to-br from-primary/10 via-background to-primary-glow/10">
        <div className="container mx-auto px-4 py-8">
          <h1 className="mb-4 text-2xl font-bold tracking-tight md:text-3xl">
            {from && to ? `${from.city} → ${to.city}` : "Charter search"}
            {result.distanceNm > 0 && (
              <span className="ml-3 align-middle text-sm font-normal text-muted-foreground">
                {result.distanceNm} nm
              </span>
            )}
          </h1>
          <CharterSearchWidget initial={criteria} variant="inline" />
        </div>
      </section>

      {result.options.length === 0 ? (
        <section className="container mx-auto px-4 py-20 text-center">
          <p className="text-lg font-medium">No aircraft matches this brief.</p>
          <p className="mt-2 text-muted-foreground">
            Widen the aircraft preference or reduce the party size, or request a bespoke charter.
          </p>
          <Button asChild className="mt-6"><Link to="/contact?subject=charter-enquiry">Request custom charter</Link></Button>
        </section>
      ) : (
        <section className="container mx-auto grid gap-8 px-4 py-12 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            {/* Charter price insights */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Charter price insights</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Indicative pricing for this sector. Charter prices move with demand and positioning — these are
                  estimates, not guaranteed fares.
                </p>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-3 sm:grid-cols-4">
                  {[
                    { t: "Lowest available", v: usd(insight.lowest), s: result.options[0].aircraft.label },
                    { t: "Best value", v: insight.bestValue ? usd(insight.bestValue.price) : "—", s: insight.bestValue?.aircraft.label ?? "" },
                    { t: "Premium option", v: insight.premium ? usd(insight.premium.price) : "—", s: insight.premium?.aircraft.label ?? "" },
                    { t: "Fastest", v: insight.fastest ? insight.fastest.flightTimeLabel : "—", s: insight.fastest?.aircraft.label ?? "" },
                  ].map((k) => (
                    <div key={k.t} className="rounded-lg border border-border p-3">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">{k.t}</p>
                      <p className="mt-1 text-lg font-semibold">{k.v}</p>
                      <p className="text-xs text-muted-foreground">{k.s}</p>
                    </div>
                  ))}
                </div>
                <div>
                  <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Price across nearby dates</p>
                  <div className="flex items-end gap-2">
                    {insight.nearbyDates.map((d) => {
                      const max = Math.max(...insight.nearbyDates.map((x) => x.price), 1);
                      const isPick = d.date === criteria.departDate;
                      return (
                        <div key={d.date} className="flex-1 text-center">
                          <div
                            className={`mx-auto w-full rounded-t-md ${isPick ? "bg-primary" : "bg-primary/25"}`}
                            style={{ height: `${Math.max(12, (d.price / max) * 88)}px` }}
                            title={`${d.date}: ${usd(d.price)} (${d.tier} demand)`}
                          />
                          <p className="mt-1 text-[10px] text-muted-foreground">{d.date.slice(5)}</p>
                          <p className="text-[10px] font-medium">{usd(d.price)}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Aircraft options */}
            <div className="space-y-4">
              <h2 className="text-xl font-semibold">{result.options.length} aircraft available</h2>
              {result.options.map((o) => {
                const chosen = seats[o.aircraft.key] ?? [];
                return (
                  <Card key={o.aircraft.key} className="overflow-hidden transition-shadow hover:shadow-elegant">
                    <div className="grid md:grid-cols-[260px_1fr]">
                      <img
                        src={o.images.exterior}
                        alt={`${o.aircraft.label} exterior`}
                        loading="lazy"
                        width={1280}
                        height={720}
                        className="h-44 w-full object-cover md:h-full"
                      />
                      <CardContent className="p-5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <h3 className="text-lg font-semibold">{o.aircraft.label}</h3>
                            <p className="text-sm text-muted-foreground">
                              {o.operator} · <Star className="inline h-3 w-3 text-primary" /> {o.operatorRating}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-xl font-bold">{usd(o.price)}</p>
                            <p className="text-xs text-muted-foreground">estimated total, incl. taxes</p>
                          </div>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2 text-xs">
                          <Badge variant="secondary" className="gap-1"><Users className="h-3 w-3" />{o.aircraft.seats} seats</Badge>
                          <Badge variant="secondary" className="gap-1"><Clock className="h-3 w-3" />{o.flightTimeLabel} airborne</Badge>
                          <Badge variant="secondary" className="gap-1"><Gauge className="h-3 w-3" />{o.aircraft.cruiseKts} kts</Badge>
                          {o.tags.map((t) => <Badge key={t} className="bg-primary/15 text-primary border-primary/30" variant="outline">{t}</Badge>)}
                        </div>

                        {o.amenities.length > 0 && (
                          <p className="mt-3 text-sm text-muted-foreground">{o.amenities.join(" · ")}</p>
                        )}

                        <div className="mt-4 flex flex-wrap gap-2">
                          <Dialog>
                            <DialogTrigger asChild>
                              <Button variant="outline" size="sm">
                                View cabin &amp; choose seats
                                {chosen.length > 0 && <Badge className="ml-2" variant="secondary">{chosen.length}</Badge>}
                              </Button>
                            </DialogTrigger>
                            <DialogContent className="max-w-2xl">
                              <DialogHeader><DialogTitle>{o.aircraft.label} — cabin</DialogTitle></DialogHeader>
                              <Tabs defaultValue="exterior">
                                <TabsList>
                                  <TabsTrigger value="exterior">Exterior</TabsTrigger>
                                  <TabsTrigger value="interior">Interior</TabsTrigger>
                                  <TabsTrigger value="seats">Seat map</TabsTrigger>
                                </TabsList>
                                <TabsContent value="exterior">
                                  <img src={o.images.exterior} alt={`${o.aircraft.label} exterior`} loading="lazy"
                                    width={1280} height={720} className="w-full rounded-lg object-cover" />
                                </TabsContent>
                                <TabsContent value="interior">
                                  <img src={o.images.interior} alt={`${o.aircraft.label} cabin interior`} loading="lazy"
                                    width={1280} height={720} className="w-full rounded-lg object-cover" />
                                </TabsContent>
                                <TabsContent value="seats">
                                  <SeatSelector option={o} selected={chosen} capacity={Math.max(1, capacity)}
                                    onToggle={(id) => toggleSeat(o.aircraft.key, id)} />
                                </TabsContent>
                              </Tabs>
                            </DialogContent>
                          </Dialog>
                          <Button size="sm" asChild>
                            <Link to={bookHref(o)}>Select aircraft<ArrowRight className="ml-1 h-4 w-4" /></Link>
                          </Button>
                        </div>
                      </CardContent>
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>

          {/* Sidebar: AI recommendation, airport intelligence, ground transport */}
          <aside className="space-y-6">
            {recommendation && (
              <Card className="border-primary/40">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Sparkles className="h-4 w-4 text-primary" /> Yalla AI recommends
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <p className="font-semibold">{recommendation.option.aircraft.label}</p>
                    <p className="text-sm text-muted-foreground">{recommendation.option.operator}</p>
                  </div>
                  <p className="text-sm text-muted-foreground">{recommendation.reason}</p>
                  <p className="text-sm">{recommendation.suitability}</p>
                  <p className="text-lg font-bold">{usd(recommendation.option.price)}</p>
                  <p className="text-sm text-muted-foreground">{recommendation.groundTransport}</p>
                  {recommendation.alternatives.length > 0 && (
                    <div className="border-t border-border pt-3">
                      <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Alternatives</p>
                      <ul className="space-y-1 text-sm">
                        {recommendation.alternatives.map((alt) => (
                          <li key={alt.aircraft.key} className="flex justify-between gap-2">
                            <span>{alt.aircraft.label}</span>
                            <span className="text-muted-foreground">{usd(alt.price)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <Button className="w-full" asChild>
                    <Link to={bookHref(recommendation.option)}>Book recommended aircraft</Link>
                  </Button>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base"><Car className="h-4 w-4 text-primary" /> Ground transport</CardTitle>
                <p className="text-sm text-muted-foreground">Bundle chauffeur and transfer legs into one itinerary.</p>
              </CardHeader>
              <CardContent className="space-y-3">
                {GROUND_OPTIONS.map((g) => (
                  <div key={g.key} className="flex items-center justify-between gap-3">
                    <Label htmlFor={`g-${g.key}`} className="text-sm font-normal">
                      {g.label} <span className="text-muted-foreground">· from {usd(g.price)}</span>
                    </Label>
                    <Switch
                      id={`g-${g.key}`}
                      checked={ground.includes(g.key)}
                      onCheckedChange={(v) => setGround((p) => (v ? [...p, g.key] : p.filter((k) => k !== g.key)))}
                    />
                  </div>
                ))}
                {groundTotal > 0 && (
                  <p className="border-t border-border pt-3 text-sm font-medium">
                    Ground transport subtotal {usd(groundTotal)}
                  </p>
                )}
              </CardContent>
            </Card>

            {from && <AirportIntel airport={from} role="Departure" />}
            {to && <AirportIntel airport={to} role="Arrival" />}
          </aside>
        </section>
      )}
    </MarketingPage>
  );
};

export default CharterSearchPage;
