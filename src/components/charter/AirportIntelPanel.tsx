/**
 * Airport intelligence panel — imagery, runway capability, VIP lounge status,
 * estimated check-in time and curated nearby hotels for a selected airfield.
 * Shared by charter search results and the booking itinerary.
 */
import { Building2, Clock, Fuel, Gauge, Plane, ShieldCheck, Star, Sun, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AIRPORT_TYPE_LABEL, type AirportRecord } from "@/lib/charter/airportRegistry";
import { airportIntel } from "@/lib/charter/airportIntel";

export function AirportIntelPanel({ airport, role }: { airport: AirportRecord; role: string }) {
  const intel = airportIntel(airport);

  const facts = [
    { icon: Plane, label: AIRPORT_TYPE_LABEL[airport.type] },
    { icon: Gauge, label: `${intel.runway.label} · ${intel.runway.surface}` },
    { icon: Plane, label: `Accepts ${intel.runway.accepts}` },
    { icon: Fuel, label: airport.fuel ? "Fuel uplift available" : "No fuel uplift" },
    { icon: ShieldCheck, label: airport.customs ? "Customs & immigration" : "Domestic clearance only" },
    { icon: Sun, label: airport.nightOps ? "Night operations" : "Daylight operations only" },
    { icon: Star, label: intel.loungeNote },
    { icon: Users, label: `${airport.operators} operators serving` },
    { icon: Clock, label: `Arrive ~${intel.checkInMinutes} min before departure` },
  ];

  return (
    <Card className="overflow-hidden">
      <img
        src={intel.image}
        alt={`${airport.name}, ${airport.city}`}
        loading="lazy"
        width={1280}
        height={720}
        className="h-36 w-full object-cover"
      />
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base">{role} · {airport.name}</CardTitle>
          <Badge variant={intel.vipLounge ? "default" : "outline"}>
            {intel.vipLounge ? "VIP lounge" : "No lounge"}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {airport.city}, {airport.country} · {airport.iata ?? "—"} / {airport.icao ?? "—"}
        </p>
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2">
        {facts.map((f) => (
          <div key={f.label} className="flex items-center gap-2 text-sm">
            <f.icon className="h-4 w-4 shrink-0 text-primary" aria-hidden />
            <span className="text-muted-foreground">{f.label}</span>
          </div>
        ))}
        <div className="sm:col-span-2 rounded-lg border border-border/70 bg-secondary/20 p-3">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Building2 className="h-4 w-4 text-primary" aria-hidden /> Nearby hotels
          </p>
          <ul className="mt-2 space-y-1">
            {intel.hotels.map((h) => (
              <li key={h.name} className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span>{h.name}</span>
                <span className="whitespace-nowrap">{h.tier} · {h.driveMinutes} min drive</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Hotel and chauffeur transfers can be bundled into your itinerary at booking.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export default AirportIntelPanel;
