import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  DEFAULT_SMARTFARE_CONFIG, activeSmartFareConfig, loadSmartFareVersions,
  saveSmartFareConfig, formatKes, type SmartFareConfig,
} from "@/lib/charter/smartFare";
import { diffConfigs } from "@/lib/charter/pricingVersionDiff";

/** Numeric levers an admin can move in a what-if scenario. */
const LEVERS: { key: keyof SmartFareConfig; label: string; suffix: string }[] = [
  { key: "missionBaseFee", label: "Mission base fee", suffix: "KES" },
  { key: "navPerNm", label: "Navigation charge / nm", suffix: "KES" },
  { key: "passengerCharge", label: "Passenger charge / pax", suffix: "KES" },
  { key: "crewDayRate", label: "Crew day rate", suffix: "KES" },
  { key: "crewOvernight", label: "Crew overnight", suffix: "KES" },
  { key: "fuelAdjustmentPct", label: "Fuel adjustment", suffix: "%" },
  { key: "emptyLegDiscountPct", label: "Empty-leg discount", suffix: "%" },
  { key: "sharedMissionDiscountPct", label: "Shared mission discount", suffix: "%" },
  { key: "operatingFloorPct", label: "Sustainable operating floor", suffix: "%" },
  { key: "vatPct", label: "VAT", suffix: "%" },
];

/**
 * Admin "what-if" simulator: compare RFQ quotes produced under the SmartFare
 * v2.0 configuration in force against a candidate configuration — either a
 * stored version or one built here — before publishing it.
 */
export default function SmartFareWhatIf() {
  const stored = useMemo(() => loadSmartFareVersions(), []);
  const baseline = useMemo(() => activeSmartFareConfig(), []);
  const [sourceKey, setSourceKey] = useState("draft");
  const [draft, setDraft] = useState<SmartFareConfig>(() => ({ ...baseline }));
  const [note, setNote] = useState("What-if scenario published from the simulator");

  const candidate: SmartFareConfig = useMemo(() => {
    if (sourceKey === "draft") return draft;
    if (sourceKey === "defaults") return DEFAULT_SMARTFARE_CONFIG;
    return stored.find((v) => String(v.version) === sourceKey)?.config ?? draft;
  }, [sourceKey, draft, stored]);

  const diff = useMemo(() => diffConfigs(baseline, candidate), [baseline, candidate]);

  const setLever = (key: keyof SmartFareConfig, value: number) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const publish = () => {
    saveSmartFareConfig(candidate, { actor: "admin", note });
    toast.success("Candidate configuration published as a new SmartFare version");
  };

  const move = diff.averageQuoteMovePct;
  const moveTone = move > 5 ? "text-destructive" : move < -5 ? "text-status-warning" : "text-primary";

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">SmartFare what-if simulator</h1>
        <p className="text-sm text-muted-foreground">
          Model an upcoming pricing configuration against the SmartFare v2.0 configuration in force and
          see the effect on representative RFQ quotes before you publish it.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Candidate configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Source</Label>
              <Select value={sourceKey} onValueChange={setSourceKey}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft scenario (edit below)</SelectItem>
                  <SelectItem value="defaults">SmartFare v2.0 defaults</SelectItem>
                  {stored.map((v) => (
                    <SelectItem key={v.version} value={String(v.version)}>
                      Stored v{v.version} — {v.note || v.actor}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-3">
              {LEVERS.map((l) => (
                <div key={String(l.key)} className="grid grid-cols-[1fr_110px] items-center gap-2">
                  <Label className="text-xs">{l.label} ({l.suffix})</Label>
                  <Input
                    type="number"
                    disabled={sourceKey !== "draft"}
                    value={Number(candidate[l.key] as number)}
                    onChange={(e) => setLever(l.key, Number(e.target.value) || 0)}
                  />
                </div>
              ))}
            </div>

            <div>
              <Label htmlFor="wf-note">Publish note</Label>
              <Input id="wf-note" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <Button className="w-full" onClick={publish} disabled={diff.changed.length === 0}>
              Publish candidate as new version
            </Button>
            {diff.changed.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No differences against the configuration in force.
              </p>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base">Quote impact</CardTitle>
                <Badge variant="secondary" className={moveTone}>
                  Average move {move > 0 ? "+" : ""}{move}%
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {diff.impact.map((i) => (
                <div key={i.routeId} className="flex items-center justify-between gap-3 border-b border-border/60 pb-2 last:border-0">
                  <div>
                    <p className="font-medium">{i.route}</p>
                    <p className="text-xs text-muted-foreground">{i.aircraftKey}</p>
                  </div>
                  <div className="text-right text-xs">
                    <p className="text-muted-foreground">{formatKes(i.before)} → <span className="font-medium text-foreground">{formatKes(i.after)}</span></p>
                    <p className={i.delta > 0 ? "text-destructive" : i.delta < 0 ? "text-status-warning" : "text-muted-foreground"}>
                      {i.delta > 0 ? "+" : ""}{formatKes(i.delta)} ({i.deltaPct > 0 ? "+" : ""}{i.deltaPct}%)
                    </p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Configuration changes ({diff.changed.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-xs">
              {diff.changed.length === 0 && <p className="text-muted-foreground">Nothing changed.</p>}
              {diff.changed.map((c) => (
                <div key={c.key} className="flex items-center justify-between gap-3">
                  <span className="font-medium">{c.label}</span>
                  <span className="text-muted-foreground">
                    {String(c.before ?? "—")} → {String(c.after ?? "—")}
                    {c.deltaPct !== null && ` (${c.deltaPct > 0 ? "+" : ""}${c.deltaPct}%)`}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
