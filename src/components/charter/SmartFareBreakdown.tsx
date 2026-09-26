import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { formatKes, SMARTFARE_DISCLAIMER, type MissionFare } from "@/lib/charter/smartFare";

/**
 * Premium SmartFare pricing workspace — mission summary, fully expanded cost
 * layers, explained savings and enterprise readiness signals.
 */
export function SmartFareBreakdown({ fare }: { fare: MissionFare }) {
  const savingsPct = fare.grossMissionCost > 0
    ? Math.round((fare.totalSavings / fare.grossMissionCost) * 100)
    : 0;

  return (
    <Card className="overflow-hidden border-border/70 bg-card/80 backdrop-blur">
      <CardHeader className="bg-gradient-to-br from-primary/10 via-transparent to-transparent">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <CardTitle className="text-lg">Mission price · Yalla SmartFare™</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {fare.from?.city ?? "—"} ({fare.from?.code}) → {fare.to?.city ?? "—"} ({fare.to?.code}) ·{" "}
              {fare.aircraft.label} · {fare.sectors === 2 ? "Round trip" : "One way"}
            </p>
          </div>
          <div className="text-right">
            <div className="text-3xl font-semibold tracking-tight">{formatKes(fare.total)}</div>
            <p className="text-xs text-muted-foreground">{formatKes(fare.perSeat)} per seat · VAT included</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge variant="secondary">{fare.distanceNm} nm</Badge>
          <Badge variant="secondary">
            {fare.blockHours.toFixed(2)} {fare.blockHoursConfirmed ? "confirmed" : "estimated"} block hours
          </Badge>
          <Badge variant="secondary">{fare.carbonKg.toLocaleString()} kg CO₂e</Badge>
          <Badge variant="outline">Operational readiness {fare.evidence.operationalReadiness}/100</Badge>
          <Badge variant="outline">Operator-priced {fare.evidence.pricingCompleteness}%</Badge>
          <Badge variant="outline">Commercial confirmation {fare.evidence.commercialConfirmation}/100</Badge>
          <Badge variant={fare.confidence === "high-confidence" ? "default" : "outline"}>
            {fare.confidence === "high-confidence" ? "High-confidence estimate" : "Indicative estimate"}
          </Badge>

        </div>
      </CardHeader>

      <CardContent className="space-y-5 pt-6">
        <section>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pricing breakdown</h4>
          <ul className="space-y-2">
            {fare.costLines.map((line) => (
              <li key={line.key} className="flex items-start justify-between gap-4 text-sm">
                <span>
                  <span className="font-medium">{line.label}</span>
                  {line.detail && <span className="block text-xs text-muted-foreground">{line.detail}</span>}
                </span>
                <span className="tabular-nums">{formatKes(line.amount)}</span>
              </li>
            ))}
          </ul>
          <Separator className="my-3" />
          <div className="flex justify-between text-sm font-medium">
            <span>Gross mission cost</span>
            <span className="tabular-nums">{formatKes(fare.grossMissionCost)}</span>
          </div>
        </section>

        {fare.savings.length > 0 && (
          <section className="rounded-lg border border-primary/25 bg-primary/5 p-4">
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Savings applied
              </h4>
              <span className="animate-fade-in text-sm font-semibold text-primary">
                − {formatKes(fare.totalSavings)} ({savingsPct}%)
              </span>
            </div>
            <ul className="space-y-2">
              {fare.savings.map((s) => (
                <li key={s.key} className="text-sm">
                  <div className="flex items-start justify-between gap-4">
                    <span className="font-medium">{s.label}</span>
                    <span className="tabular-nums text-primary">− {formatKes(s.amount)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{s.explanation}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {fare.potentialSavings.length > 0 && (
          <section className="rounded-lg border border-border bg-muted/40 p-4">
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Potential savings — not applied
              </h4>
              <span className="text-sm font-semibold text-muted-foreground">
                up to − {formatKes(fare.potentialSavingsTotal)}
              </span>
            </div>
            <ul className="space-y-2">
              {fare.potentialSavings.map((s) => (
                <li key={s.key} className="text-sm">
                  <div className="flex items-start justify-between gap-4">
                    <span className="font-medium text-muted-foreground">{s.label}</span>
                    <span className="tabular-nums text-muted-foreground">− {formatKes(s.amount)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{s.explanation}</p>
                </li>
              ))}
            </ul>
          </section>
        )}


        <section className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span>Operator mission cost</span>
            <span className="tabular-nums">{formatKes(fare.operatorMissionCost)}</span>
          </div>
          <div className="flex justify-between">
            <span>Yalla platform fee ({fare.platformFeePct}%)</span>
            <span className="tabular-nums">{formatKes(fare.platformFee)}</span>
          </div>
          <div className="flex justify-between">
            <span>VAT</span>
            <span className="tabular-nums">{formatKes(fare.vat)}</span>
          </div>
          <Separator />
          <div className="flex justify-between text-base font-semibold">
            <span>Mission price</span>
            <span className="tabular-nums">{formatKes(fare.total)}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Sustainable operating floor {formatKes(fare.operatingFloor)}
            {fare.floorApplied ? " — discounts capped at cost, Yalla never prices below cost." : "."}
          </p>
        </section>

        <section className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          {fare.notes.map((n) => <p key={n}>{n}</p>)}
          <p className="mt-1">{SMARTFARE_DISCLAIMER}</p>
        </section>
      </CardContent>
    </Card>
  );
}

export default SmartFareBreakdown;
