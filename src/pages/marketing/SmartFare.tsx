import { useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import RouteMap from "@/components/charter/RouteMap";
import SmartFareBreakdown from "@/components/charter/SmartFareBreakdown";
import PricingProvenancePanel from "@/components/charter/PricingProvenancePanel";
import QuoteReadinessPanel from "@/components/charter/QuoteReadinessPanel";
import { downloadSmartFareCsv, downloadSmartFarePdf } from "@/lib/charter/smartFareExport";
import { validateFare } from "@/lib/charter/rateCardValidation";
import { recordPricingAudit } from "@/lib/charter/pricingAuditLog";
import { downloadQuoteAudit } from "@/lib/charter/quoteAuditExport";
import {
  computeMissionFare, recommendAircraft, formatKes, CUSTOMER_SEGMENTS,
  SMARTFARE_DISCLAIMER, type CustomerSegment,
} from "@/lib/charter/smartFare";
import { pricePopularRoutes, POPULAR_ROUTES } from "@/lib/charter/smartRoutes";
import { airportByCode } from "@/lib/charter/airportRegistry";

const SEASON_LABEL: Record<string, string> = { peak: "Peak season", shoulder: "Shoulder", steady: "Steady demand" };

/** TaxiD SmartFare™ — mission-centric charter pricing workspace. */
export default function SmartFarePage() {
  const [segment, setSegment] = useState<CustomerSegment>("retail");
  const [routeId, setRouteId] = useState(POPULAR_ROUTES[0].id);
  const [passengers, setPassengers] = useState(6);
  const [roundTrip, setRoundTrip] = useState(false);
  const [flexible, setFlexible] = useState(true);
  const [emptyLeg, setEmptyLeg] = useState(true);
  const [shared, setShared] = useState(false);
  const [aircraftKey, setAircraftKey] = useState<string | null>(null);

  const routes = useMemo(() => pricePopularRoutes(segment), [segment]);
  const route = useMemo(() => POPULAR_ROUTES.find((r) => r.id === routeId)!, [routeId]);

  const missionBase = {
    fromCode: route.fromCode,
    toCode: route.toCode,
    passengers,
    roundTrip,
    segment,
    flexibleDeparture: flexible,
    emptyLegMatch: emptyLeg,
    sharedMission: shared,
  };

  const recommendations = useMemo(() => recommendAircraft(missionBase).slice(0, 6),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [route.id, passengers, roundTrip, segment, flexible, emptyLeg, shared]);

  const selectedKey = aircraftKey ?? recommendations[0]?.aircraft.key ?? route.recommendedAircraftKey;
  const fare = useMemo(() => computeMissionFare({ ...missionBase, aircraftKey: selectedKey, autoResolveOperator: true }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedKey, route.id, passengers, roundTrip, segment, flexible, emptyLeg, shared]);

  const validation = useMemo(() => validateFare(fare), [fare]);

  useEffect(() => {
    recordPricingAudit(fare, { reason: "quote_view" });
  }, [fare]);

  const alternates = useMemo(
    () => ["NBO", "ASV", "UKA"].map(airportByCode).filter(Boolean).filter((a) => a!.code !== route.toCode) as NonNullable<ReturnType<typeof airportByCode>>[],
    [route.toCode],
  );

  return (
    <main className="mx-auto max-w-7xl px-4 py-10">
      <Helmet>
        <title>TaxiD SmartFare™ — Transparent Charter Mission Pricing</title>
        <meta name="description" content="Mission-based charter pricing for East Africa: transparent cost layers, explained savings, empty-leg matching and lean platform fees in KSh." />
        <link rel="canonical" href="https://yalla-africa.lovable.app/charter/smartfare" />
        <meta property="og:title" content="TaxiD SmartFare™ — Transparent Charter Mission Pricing" />
        <meta property="og:description" content="Mission-based charter pricing for East Africa: transparent cost layers, explained savings, empty-leg matching and lean platform fees in KSh." />
        <meta property="og:url" content="https://yalla-africa.lovable.app/charter/smartfare" />
        <meta property="og:image" content="https://yalla-africa.lovable.app/og-taxid-1200x630.png" />
        <meta name="twitter:image" content="https://yalla-africa.lovable.app/og-taxid-1200x630.png" />
      </Helmet>

      <header className="mb-8">
        <Badge variant="secondary" className="mb-3">TaxiD SmartFare™ v2.0</Badge>
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
          You are buying a mission, not aircraft hours.
        </h1>
        <p className="mt-3 max-w-3xl text-muted-foreground">
          SmartFare prices every charter from the real mission — route, positioning, airport charges, crew
          and services — then subtracts the efficiencies we can genuinely find. Every layer and every saving
          is shown. We never price below the sustainable cost of operating the aircraft.
        </p>
      </header>

      {/* Popular routes */}
      <section className="mb-10">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-xl font-semibold">Popular charter routes</h2>
          <div className="w-56">
            <Label className="text-xs text-muted-foreground">Customer segment</Label>
            <Select value={segment} onValueChange={(v) => setSegment(v as CustomerSegment)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CUSTOMER_SEGMENTS.map((s) => (
                  <SelectItem key={s.key} value={s.key}>{s.label} — {s.note}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {routes.map((r) => (
            <Card key={r.route.id}
              className={`cursor-pointer transition hover:shadow-lg ${r.route.id === routeId ? "border-primary" : ""}`}
              onClick={() => { setRouteId(r.route.id); setAircraftKey(null); }}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{r.route.label}</CardTitle>
                <p className="text-xs text-muted-foreground">{SEASON_LABEL[r.route.seasonality]}</p>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <div className="text-2xl font-semibold">From {formatKes(r.fromPrice)}</div>
                <p className="text-xs text-muted-foreground">Indicative starting mission price</p>
                <p className="pt-2">{r.aircraft.label} · up to {r.aircraft.seats} seats</p>
                <p className="text-muted-foreground">{r.flightTimeLabel} · {r.distanceNm} nm</p>
                <p className="text-xs text-primary">{r.route.savingsOpportunity}</p>
              </CardContent>
            </Card>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{SMARTFARE_DISCLAIMER}</p>
      </section>

      {/* Mission workspace */}
      <section className="grid gap-6 lg:grid-cols-[1fr_420px]">
        <div className="space-y-6">
          <RouteMap
            from={airportByCode(route.fromCode)}
            to={airportByCode(route.toCode)}
            alternates={alternates.slice(0, 2)}
            distanceNm={fare.distanceNm}
            flightTimeLabel={`${fare.blockHours.toFixed(2)} h`}
            carbonKg={fare.carbonKg}
          />

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Mission parameters</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="pax">Passengers</Label>
                <Input id="pax" type="number" min={1} max={18} value={passengers}
                  onChange={(e) => setPassengers(Math.max(1, Number(e.target.value) || 1))} />
              </div>
              <div className="flex items-end gap-6">
                <div className="flex items-center gap-2">
                  <Switch id="rt" checked={roundTrip} onCheckedChange={setRoundTrip} />
                  <Label htmlFor="rt">Round trip</Label>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Switch id="flex" checked={flexible} onCheckedChange={setFlexible} />
                <Label htmlFor="flex">Flexible departure (±2h)</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch id="el" checked={emptyLeg} onCheckedChange={setEmptyLeg} />
                <Label htmlFor="el">Match empty-leg availability</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch id="shared" checked={shared} onCheckedChange={setShared} />
                <Label htmlFor="shared">Allow shared mission</Label>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">AI aircraft recommendation</CardTitle>
              <p className="text-xs text-muted-foreground">
                Ranked by delivered value, not by price — the cheapest suitable aircraft leads.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              {recommendations.map((r) => (
                <button key={r.aircraft.key} type="button" onClick={() => setAircraftKey(r.aircraft.key)}
                  className={`w-full rounded-lg border p-3 text-left transition hover:border-primary ${r.aircraft.key === selectedKey ? "border-primary bg-primary/5" : "border-border"}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{r.aircraft.label}</span>
                    <span className="font-semibold">{formatKes(r.fare.total)}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {r.tags.map((t) => <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>)}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {r.aircraft.seats} seats · {r.fare.blockHours.toFixed(2)} h · {r.fare.carbonKg.toLocaleString()} kg CO₂e
                    {r.savingsVsPremium > 0 && ` · saves ${formatKes(r.savingsVsPremium)} vs the premium option`}
                  </p>
                </button>
              ))}
              {recommendations.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No aircraft in the fleet matches {passengers} passengers on this airfield. Reduce the party size or split the mission.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <SmartFareBreakdown fare={fare} />
          <PricingProvenancePanel fare={fare} />
          <QuoteReadinessPanel fare={fare} />
          <div className="grid grid-cols-2 gap-2">
            <Button data-analytics="smartfare.download" variant="outline" onClick={() => downloadSmartFareCsv(fare)}>
              Download CSV
            </Button>
            <Button data-analytics="smartfare.download" variant="outline" onClick={() => void downloadSmartFarePdf(fare)}>
              Download PDF
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="ghost" size="sm" onClick={() => downloadQuoteAudit(fare, "json")}>
              Audit log (JSON)
            </Button>
            <Button variant="ghost" size="sm" onClick={() => downloadQuoteAudit(fare, "csv")}>
              Audit log (CSV)
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Procurement-ready breakdown: every cost layer, the platform fee, explained savings and the
            admin pricing configuration version used.
          </p>
          {validation.canFinalise ? (
            <Button className="w-full" asChild>
              <a href={`/charter/private-jet-charter/book?from=${route.fromCode}&to=${route.toCode}&pax=${passengers}&aircraft=${selectedKey}`}>
                Accept binding mission quote
              </a>
            </Button>
          ) : (
            <div className="space-y-2">
              <Button className="w-full" disabled>
                Binding quote locked — operator inputs incomplete
              </Button>
              <Button variant="outline" className="w-full" asChild>
                <a href={`/charter/private-jet-charter/book?from=${route.fromCode}&to=${route.toCode}&pax=${passengers}&aircraft=${selectedKey}`}>
                  Request operator confirmation
                </a>
              </Button>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            A confirmed price is issued only after operator availability, mission parameters and applicable
            commercial charges are verified.
          </p>
        </div>
      </section>
    </main>
  );
}
