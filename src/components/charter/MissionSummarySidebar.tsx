/**
 * Sticky executive mission summary. Always visible so an approver can see the
 * cost, delegation, schedule and quote validity without scrolling back.
 */
import { LifeBuoy, Leaf, Timer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export interface MissionSummaryProps {
  status: string;
  assetName: string;
  units: number;
  partySize: number;
  distanceKm?: number | null;
  durationLabel: string;
  departure: string;
  arrival: string;
  currency: string;
  estimatedCost: number;
  savings?: number;
  extras: string[];
  carbonKg?: number | null;
  quoteExpiry: string;
  supportContact: string;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

export function MissionSummarySidebar(props: MissionSummaryProps) {
  const money = (n: number) =>
    `${props.currency} ${Math.round(n).toLocaleString()}`;
  return (
    <Card className="lg:sticky lg:top-24 border-primary/20 bg-card/80 backdrop-blur">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">Mission summary</CardTitle>
          <Badge variant="secondary">{props.status}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <dl>
          <Row label="Vehicle" value={`${props.units} × ${props.assetName || "—"}`} />
          <Row label="Delegates" value={props.partySize ? String(props.partySize) : "—"} />
          <Row label="Distance" value={props.distanceKm ? `${Math.round(props.distanceKm)} km` : "Calculated on route lock"} />
          <Row label="Duration" value={props.durationLabel} />
          <Row label="Departure" value={props.departure || "—"} />
          <Row label="Arrival" value={props.arrival || "—"} />
        </dl>
        <Separator className="my-3" />
        <dl>
          <Row label="Estimated mission cost" value={money(props.estimatedCost)} />
          {props.savings ? <Row label="Savings applied" value={`− ${money(props.savings)}`} /> : null}
        </dl>
        {props.extras.length > 0 && (
          <>
            <Separator className="my-3" />
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Selected services</p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {props.extras.map((e) => (
                <li key={e}>
                  <Badge variant="outline" className="font-normal">{e}</Badge>
                </li>
              ))}
            </ul>
          </>
        )}
        <Separator className="my-3" />
        <div className="space-y-1.5 text-xs text-muted-foreground">
          {props.carbonKg != null && (
            <p className="flex items-center gap-1.5">
              <Leaf className="h-3.5 w-3.5" aria-hidden="true" />
              Carbon estimate {Math.round(props.carbonKg)} kg CO₂e
            </p>
          )}
          <p className="flex items-center gap-1.5">
            <Timer className="h-3.5 w-3.5" aria-hidden="true" />
            {props.quoteExpiry}
          </p>
          <p className="flex items-center gap-1.5">
            <LifeBuoy className="h-3.5 w-3.5" aria-hidden="true" />
            24/7 operations · {props.supportContact}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
