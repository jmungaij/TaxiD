import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  activeSmartFareConfig, saveSmartFareConfig, resetSmartFareConfig, loadSmartFareVersions,
  CUSTOMER_SEGMENTS, formatKes, type SmartFareConfig, type CustomerSegment,
} from "@/lib/charter/smartFare";
import { pricePopularRoutes } from "@/lib/charter/smartRoutes";
import { useAuth } from "@/hooks/useAuth";

const NUMERIC_FIELDS: { key: keyof SmartFareConfig; label: string; suffix?: string }[] = [
  { key: "missionBaseFee", label: "Mission base fee", suffix: "KSh" },
  { key: "emptyLegDiscountPct", label: "Empty-leg discount", suffix: "%" },
  { key: "emptyLegMaxDiscountPct", label: "Empty-leg discount ceiling", suffix: "%" },
  { key: "sharedMissionDiscountPct", label: "Shared mission discount", suffix: "%" },
  { key: "flexibleWindowDiscountPct", label: "Flexible departure discount", suffix: "%" },
  { key: "nearbyAirportDiscountPct", label: "Nearby airport optimisation", suffix: "%" },
  { key: "fuelAdjustmentPct", label: "Fuel adjustment", suffix: "%" },
  { key: "navPerNm", label: "Navigation charge", suffix: "KSh / nm" },
  { key: "passengerCharge", label: "Passenger charge", suffix: "KSh / pax" },
  { key: "internationalClearance", label: "International clearance", suffix: "KSh" },
  { key: "crewDayRate", label: "Crew day rate", suffix: "KSh" },
  { key: "crewOvernight", label: "Crew overnight", suffix: "KSh" },
  { key: "operatingFloorPct", label: "Sustainable operating floor", suffix: "% of flight cost" },
  { key: "vatPct", label: "VAT", suffix: "%" },
];

/** Admin console for the SmartFare™ pricing rules — no code changes required. */
export default function SmartFareSettings() {
  const { user } = useAuth();
  const [config, setConfig] = useState<SmartFareConfig>(() => activeSmartFareConfig());
  const [versions, setVersions] = useState(() => loadSmartFareVersions());
  const preview = pricePopularRoutes("retail").slice(0, 4);

  const setNum = (key: keyof SmartFareConfig, value: number) =>
    setConfig((c) => ({ ...c, [key]: value } as SmartFareConfig));

  const setSegmentValue = (group: "platformFeePct" | "contractDiscountPct", seg: CustomerSegment, value: number) =>
    setConfig((c) => ({ ...c, [group]: { ...c[group], [seg]: value } }));

  const save = () => {
    const entry = saveSmartFareConfig(config, { actor: user?.email ?? "admin", note: "Pricing console update" });
    setVersions(loadSmartFareVersions());
    toast.success(`SmartFare configuration v${entry.version} published`);
  };

  const reset = () => {
    resetSmartFareConfig();
    setConfig(activeSmartFareConfig());
    setVersions(loadSmartFareVersions());
    toast.info("Reverted to SmartFare defaults");
  };

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">SmartFare™ pricing configuration</h1>
        <p className="text-sm text-muted-foreground">
          Mission base fee, platform fees, discounts, charges and the sustainable operating floor.
          Every change is versioned for procurement and regulatory review.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Platform fee by segment</CardTitle></CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {CUSTOMER_SEGMENTS.map((s) => (
              <div key={s.key}>
                <Label>{s.label} fee (%)</Label>
                <Input type="number" step="0.5" value={config.platformFeePct[s.key]}
                  onChange={(e) => setSegmentValue("platformFeePct", s.key, Number(e.target.value))} />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Framework discount by segment</CardTitle></CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {CUSTOMER_SEGMENTS.map((s) => (
              <div key={s.key}>
                <Label>{s.label} discount (%)</Label>
                <Input type="number" step="0.5" value={config.contractDiscountPct[s.key]}
                  onChange={(e) => setSegmentValue("contractDiscountPct", s.key, Number(e.target.value))} />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Mission pricing controls</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {NUMERIC_FIELDS.map((f) => (
            <div key={String(f.key)}>
              <Label>{f.label} {f.suffix && <span className="text-muted-foreground">({f.suffix})</span>}</Label>
              <Input type="number" value={config[f.key] as number}
                onChange={(e) => setNum(f.key, Number(e.target.value))} />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Impact preview (retail, indicative)</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {preview.map((p) => (
            <div key={p.route.id} className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground">{p.route.label}</p>
              <p className="text-lg font-semibold">From {formatKes(p.fromPrice)}</p>
              <p className="text-xs text-muted-foreground">{p.aircraft.label}</p>
            </div>
          ))}
          <p className="col-span-full text-xs text-muted-foreground">
            Preview uses the saved configuration. Publish to apply your pending edits.
          </p>
        </CardContent>
      </Card>

      <div className="flex gap-3">
        <Button onClick={save}>Publish configuration</Button>
        <Button variant="outline" onClick={reset}>Reset to defaults</Button>
        <Button variant="ghost" asChild>
          <a href="/dashboard/admin/smartfare-versions">Version diff & pricing audit</a>
        </Button>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Change history</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {versions.length === 0 && <p className="text-muted-foreground">No published changes — defaults in force.</p>}
          {versions.slice().reverse().map((v) => (
            <div key={v.version} className="flex items-center justify-between rounded border border-border px-3 py-2">
              <span><Badge variant="secondary">v{v.version}</Badge> <span className="ml-2">{v.actor}</span></span>
              <span className="text-muted-foreground">{new Date(v.savedAt).toLocaleString()}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
