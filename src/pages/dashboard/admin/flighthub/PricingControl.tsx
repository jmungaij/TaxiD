import { useEffect, useMemo, useState } from "react";
import { FlightHubPage, HubSection } from "@/components/charter/FlightHubPage";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import StatCard from "@/components/common/StatCard";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { computeAviationPrice, priceRouteGrid, type AirportCharges, type GlobalPricingControls } from "@/lib/charter/aviationPricing";
import {
  activePricingConfig, defaultPricingConfig, diffPricingConfig, loadPricingVersions,
  pricingAuditToCsv, savePricingConfig, type PricingConfig,
} from "@/lib/charter/pricingConfigStore";
import { fetchPublishedPricing, publishPricing, normalizeConfig } from "@/lib/charter/publishedPricing";
import { charterApi } from "@/lib/charter/api";


const usd = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

const CONTROL_GROUPS: Array<{ title: string; description: string; fields: Array<[keyof GlobalPricingControls, string, string]> }> = [
  {
    title: "Revenue layers",
    description: "Every booking stacks these on top of the operator's revenue.",
    fields: [
      ["platformCommissionPct", "Platform commission", "%"],
      ["paymentProcessingPct", "Payment processing", "%"],
      ["technologyFee", "Technology fee", "USD"],
      ["premiumServicePct", "Premium service", "%"],
      ["dynamicUpliftSharePct", "Dynamic uplift share", "%"],
    ],
  },
  {
    title: "Margin & booking guardrails",
    description: "Commission is clamped inside the margin band; totals inside the value band.",
    fields: [
      ["minMarginPct", "Minimum margin", "%"],
      ["maxMarginPct", "Maximum margin", "%"],
      ["minBookingValue", "Minimum booking value", "USD"],
      ["maxBookingValue", "Maximum booking value", "USD"],
    ],
  },
  {
    title: "Demand multipliers",
    description: "Applied to base + operational cost before discounts.",
    fields: [
      ["demandMultiplier", "Demand index", "x"],
      ["weekendMultiplier", "Weekend", "x"],
      ["holidayMultiplier", "Holiday / peak season", "x"],
      ["nightMultiplier", "Night operations", "x"],
      ["fuelMultiplier", "Fuel index", "x"],
      ["luxuryMultiplier", "Luxury package", "x"],
    ],
  },
  {
    title: "Discount programmes",
    description: "Additive, capped at 90% combined. Empty-leg discounts are held inside the 20–60% platform band.",
    fields: [
      ["emptyLegDiscountPct", "Empty leg (target)", "%"],
      ["emptyLegMinDiscountPct", "Empty leg floor", "%"],
      ["emptyLegMaxDiscountPct", "Empty leg ceiling", "%"],
      ["corporateDiscountPct", "Corporate", "%"],
      ["vipDiscountPct", "VIP", "%"],
      ["loyaltyDiscountPct", "Loyalty", "%"],
    ],
  },
  {
    title: "Commercial policy",
    description: "Cancellation, refund and operator settlement terms shown on every quote and confirmation.",
    fields: [
      ["vatPct", "Applicable tax (VAT)", "%"],
      ["fxKesPerUsd", "FX display rate", "KES/USD"],
      ["cancellationFeePct", "Standard cancellation fee", "%"],
      ["refundWindowHours", "Refund window", "hours"],
      ["lateCancellationHours", "Late cancellation window", "hours"],
      ["lateCancellationFeePct", "Late cancellation fee", "%"],
      ["noShowFeePct", "No-show fee", "%"],
      ["refundProcessingDays", "Refund settlement", "days"],
      ["operatorPayoutDays", "Operator payout", "days"],
    ],
  },

];

const AIRPORT_FIELDS: Array<[keyof AirportCharges, string]> = [
  ["landingFee", "Landing"],
  ["navigationFee", "Navigation"],
  ["parkingFee", "Parking"],
  ["overnightParking", "Overnight"],
  ["groundHandling", "Handling"],
  ["passengerCharge", "Pax"],
  ["securityCharge", "Security"],
  ["nightSurcharge", "Night"],
  ["internationalClearance", "Intl clearance"],
];

export default function PricingControl() {
  const { user } = useAuth();
  const [config, setConfig] = useState<PricingConfig>(() => activePricingConfig());
  const [saved, setSaved] = useState<PricingConfig>(() => activePricingConfig());
  const [versions, setVersions] = useState(() => loadPricingVersions());
  const [note, setNote] = useState("");
  const [effectiveAt, setEffectiveAt] = useState("");
  const [liveVersion, setLiveVersion] = useState(0);
  const [publishing, setPublishing] = useState(false);
  /** Server-published versions — the rollback source of truth. */
  const [serverVersions, setServerVersions] = useState<Array<Record<string, unknown>>>([]);
  const [rollingBack, setRollingBack] = useState<number | null>(null);

  const refreshServerVersions = () =>
    charterApi.pricingVersions().then(setServerVersions).catch(() => setServerVersions([]));

  useEffect(() => { void refreshServerVersions(); }, []);

  /**
   * Safe rollback: never mutates or deletes history. The chosen version's
   * configuration is re-published as a new, higher version so the audit chain
   * stays append-only and the reversal itself is attributable.
   */
  const rollbackTo = async (v: Record<string, unknown>) => {
    const version = Number(v.version ?? 0);
    const target = normalizeConfig(v.config);
    const changes = diffPricingConfig(config, target);
    if (changes.length === 0) {
      toast.info(`v${version} is already the live configuration.`);
      return;
    }
    setRollingBack(version);
    try {
      const published = await publishPricing(target, {
        note: `Rollback to v${version}${v.note ? ` — ${String(v.note)}` : ""}`,
        changes,
      });
      setConfig(target);
      setSaved(target);
      setLiveVersion(published);
      await refreshServerVersions();
      toast.success(`Rolled back to v${version}`, {
        description: `Re-published as v${published} · ${changes.length} field${changes.length === 1 ? "" : "s"} reverted`,
      });
    } catch (e) {
      toast.error("Rollback failed", { description: e instanceof Error ? e.message : "Unknown error" });
    } finally {
      setRollingBack(null);
    }
  };


  // The governed version customers are being priced against right now.
  useEffect(() => {
    let alive = true;
    fetchPublishedPricing().then((p) => {
      if (!alive) return;
      setLiveVersion(p.version);
      if (!p.fallback) { setConfig(p.config); setSaved(p.config); }
    });
    return () => { alive = false; };
  }, []);

  // Simulator state.
  const [sim, setSim] = useState({
    aircraftKey: "caravan_208b",
    origin: "WIL",
    destination: "MRE",
    passengers: 6,
    roundTrip: true,
    emptyLeg: false,
    weekend: false,
    holiday: false,
    nightOps: false,
    corporate: false,
    nightsAway: 0,
  });

  const dirty = useMemo(() => diffPricingConfig(saved, config), [saved, config]);

  const quote = useMemo(
    () => computeAviationPrice({
      ...sim,
      controls: config.controls,
      airportTable: config.airports,
    }),
    [sim, config],
  );

  const grid = useMemo(
    () => priceRouteGrid(sim.aircraftKey, config.controls, config.airports),
    [sim.aircraftKey, config],
  );

  const setControl = (k: keyof GlobalPricingControls, v: string) =>
    setConfig((c) => ({ ...c, controls: { ...c.controls, [k]: Number(v) || 0 } }));

  const setAirport = (code: string, k: keyof AirportCharges, v: string) =>
    setConfig((c) => ({
      ...c,
      airports: c.airports.map((a) => (a.code === code ? { ...a, [k]: Number(v) || 0 } : a)),
    }));

  const setAircraftRate = (key: string, field: "baseHourlyRate" | "cruiseKts" | "fuelPerHour" | "crewPerHour", v: string) =>
    setConfig((c) => ({
      ...c,
      aircraft: c.aircraft.map((a) => (a.key === key ? { ...a, [field]: Number(v) || 0 } : a)),
    }));

  const save = async () => {
    const version = savePricingConfig(config, {
      actor: user?.email ?? "unknown",
      note,
      effectiveAt: effectiveAt ? new Date(effectiveAt).toISOString() : undefined,
    });
    if (!version) {
      toast.info("No pricing changes to publish.");
      return;
    }
    setVersions(loadPricingVersions());
    setSaved(config);
    setNote("");

    // Publish to the platform so customer quotes price against this version.
    setPublishing(true);
    try {
      const published = await publishPricing(config, {
        note: version.note,
        effectiveAt: version.effectiveAt,
        changes: version.changes,
      });
      setLiveVersion(published);
      toast.success(`Pricing version ${published} published to customers`, {
        description: `${version.changes.length} field change${version.changes.length === 1 ? "" : "s"} effective ${new Date(version.effectiveAt).toLocaleString()}`,
      });
    } catch (e) {
      toast.error("Saved locally, but publishing failed", {
        description: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setPublishing(false);
    }
  };

  const exportAudit = () => {
    const blob = new Blob([pricingAuditToCsv(versions)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `yalla-air-pricing-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <FlightHubPage
      eyebrow="Flight Hub · Commercial"
      title="Dynamic Pricing Control"
      subtitle="TaxiD Air prices every charter automatically: aircraft hourly rate × billable flight time, plus airport charges, demand multipliers and platform revenue layers. Nothing is quoted by hand."
      actions={
        <div className="flex items-center gap-2">
          <Button data-analytics="pricingcontrol.export" size="sm" variant="secondary" className="bg-primary-foreground/12 text-primary-foreground border-0 hover:bg-primary-foreground/20" onClick={exportAudit} disabled={versions.length === 0}>
            Export audit CSV
          </Button>
          <Button size="sm" onClick={save} disabled={dirty.length === 0 || publishing}>
            Publish{dirty.length > 0 ? ` (${dirty.length})` : ""}
          </Button>
        </div>
      }
      metrics={[
        { label: "Live version", value: liveVersion ? `v${liveVersion}` : "Baseline" },
        { label: "Simulated price", value: usd(quote.customerPrice) },
        { label: "Platform revenue", value: `${usd(quote.platformRevenue)} · ${quote.marginPct}%` },
        { label: "Pending changes", value: String(dirty.length) },
      ]}
    >
      <Tabs defaultValue="simulator" className="space-y-6">
        <TabsList className="flex-wrap">
          <TabsTrigger value="simulator">Quote simulator</TabsTrigger>
          <TabsTrigger value="controls">Global controls</TabsTrigger>
          <TabsTrigger value="airports">Airport charges</TabsTrigger>
          <TabsTrigger value="aircraft">Aircraft rates</TabsTrigger>
          <TabsTrigger value="routes">Route intelligence</TabsTrigger>
          <TabsTrigger value="audit">Change audit</TabsTrigger>
          <TabsTrigger value="rollback">Rollback</TabsTrigger>
        </TabsList>

        {/* ---------------------------------------------------------- */}
        <TabsContent value="simulator" className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard title="Customer price" value={usd(quote.customerPrice)} description={`${quote.time.billableHours} billable hours · ${quote.time.distanceNm} nm`} tone="default" />
            <StatCard title="Operator revenue" value={usd(quote.operatorRevenue)} description="Paid out after settlement window" tone="success" />
            <StatCard title="Platform revenue" value={usd(quote.platformRevenue)} description={`${quote.marginPct}% of booking value`} tone="success" />
            <StatCard title="Guardrail" value={quote.clamped ? `${quote.clamped} clamp applied` : "Within band"} description={`Margin band ${config.controls.minMarginPct}–${config.controls.maxMarginPct}%`} tone={quote.clamped ? "warning" : "default"} />
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <HubSection title="Trip inputs" description="Change any input and the price recomputes instantly.">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Aircraft</Label>
                  <Select value={sim.aircraftKey} onValueChange={(v) => setSim((s) => ({ ...s, aircraftKey: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {config.aircraft.map((a) => (
                        <SelectItem key={a.key} value={a.key}>{a.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pax">Passengers</Label>
                  <Input id="pax" type="number" min={1} value={sim.passengers} onChange={(e) => setSim((s) => ({ ...s, passengers: Number(e.target.value) || 1 }))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="from">Origin</Label>
                  <Input id="from" value={sim.origin} onChange={(e) => setSim((s) => ({ ...s, origin: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="to">Destination</Label>
                  <Input id="to" value={sim.destination} onChange={(e) => setSim((s) => ({ ...s, destination: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="nights">Nights away</Label>
                  <Input id="nights" type="number" min={0} value={sim.nightsAway} onChange={(e) => setSim((s) => ({ ...s, nightsAway: Number(e.target.value) || 0 }))} />
                </div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {([
                  ["roundTrip", "Round trip"],
                  ["emptyLeg", "Empty leg"],
                  ["weekend", "Weekend"],
                  ["holiday", "Peak season"],
                  ["nightOps", "Night operations"],
                  ["corporate", "Corporate account"],
                ] as Array<[keyof typeof sim, string]>).map(([k, label]) => (
                  <div key={k} className="flex items-center justify-between rounded-md border px-3 py-2">
                    <Label htmlFor={`sw-${k}`} className="text-sm font-normal">{label}</Label>
                    <Switch id={`sw-${k}`} checked={Boolean(sim[k])} onCheckedChange={(v) => setSim((s) => ({ ...s, [k]: v }))} />
                  </div>
                ))}
              </div>
            </HubSection>

            <HubSection title="Price build-up" description="Deterministic, auditable and identical to the customer-facing quote.">
              <ul className="space-y-2 text-sm">
                <li className="flex justify-between font-medium">
                  <span>Aircraft time · {usd(quote.hourlyRate)}/hr × {quote.time.billableHours} hrs</span>
                  <span className="tabular-nums">{usd(quote.baseCost)}</span>
                </li>
                <li className="pl-3 text-xs text-muted-foreground">
                  Airborne {quote.time.airborneHours}h · taxi {quote.time.taxiHours}h · positioning {quote.time.positioningHours}h · ferry {quote.time.ferryHours}h
                </li>
                {quote.operationalCharges.map((l) => (
                  <li key={l.label} className="flex justify-between text-muted-foreground">
                    <span>{l.label}</span><span className="tabular-nums">{usd(l.amount)}</span>
                  </li>
                ))}
                <li className="flex justify-between border-t pt-2 font-medium">
                  <span>Operational charges</span><span className="tabular-nums">{usd(quote.operationalTotal)}</span>
                </li>
                {quote.multipliers.map((m) => (
                  <li key={m.label} className="flex justify-between text-muted-foreground">
                    <span>{m.label} multiplier</span><span className="tabular-nums">×{m.amount}</span>
                  </li>
                ))}
                {quote.discounts.map((d) => (
                  <li key={d.label} className="flex justify-between text-status-success dark:text-status-success">
                    <span>{d.label} discount</span><span className="tabular-nums">−{d.amount}%</span>
                  </li>
                ))}
                <li className="flex justify-between border-t pt-2 font-medium">
                  <span>Operator revenue</span><span className="tabular-nums">{usd(quote.operatorRevenue)}</span>
                </li>
                <li className="flex justify-between text-muted-foreground"><span>Platform commission</span><span className="tabular-nums">{usd(quote.platformCommission)}</span></li>
                <li className="flex justify-between text-muted-foreground"><span>Technology fee</span><span className="tabular-nums">{usd(quote.technologyFee)}</span></li>
                {quote.premiumServiceFee > 0 && <li className="flex justify-between text-muted-foreground"><span>Premium service</span><span className="tabular-nums">{usd(quote.premiumServiceFee)}</span></li>}
                {quote.dynamicUpliftShare > 0 && <li className="flex justify-between text-muted-foreground"><span>Dynamic uplift share</span><span className="tabular-nums">{usd(quote.dynamicUpliftShare)}</span></li>}
                <li className="flex justify-between text-muted-foreground"><span>Payment processing</span><span className="tabular-nums">{usd(quote.paymentProcessing)}</span></li>
                <li className="flex justify-between border-t pt-2 text-base font-semibold">
                  <span>Customer price</span><span className="tabular-nums">{usd(quote.customerPrice)}</span>
                </li>
                <li className="flex justify-between text-xs text-muted-foreground">
                  <span>Per seat ({sim.passengers})</span>
                  <span className="tabular-nums">{usd(quote.customerPrice / Math.max(1, sim.passengers))}</span>
                </li>
              </ul>
              {!quote.time.resolved && (
                <p className="mt-3 text-xs text-status-warning dark:text-status-warning">
                  Origin or destination not in the airfield registry — priced on a conservative one-hour sector.
                </p>
              )}
            </HubSection>
          </div>
        </TabsContent>

        {/* ---------------------------------------------------------- */}
        <TabsContent value="controls" className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            {CONTROL_GROUPS.map((group) => (
              <HubSection key={group.title} title={group.title} description={group.description}>
                <div className="grid gap-4 sm:grid-cols-2">
                  {group.fields.map(([key, label, unit]) => (
                    <div key={key} className="space-y-1.5">
                      <Label htmlFor={`c-${key}`} className="text-xs">{label} <span className="text-muted-foreground">({unit})</span></Label>
                      <Input
                        id={`c-${key}`} type="number" step="0.01"
                        value={config.controls[key]}
                        onChange={(e) => setControl(key, e.target.value)}
                      />
                    </div>
                  ))}
                </div>
              </HubSection>
            ))}
          </div>
          <HubSection title="Publish" description="Changes take effect immediately unless you schedule an effective date.">
            <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-end">
              <div className="space-y-1.5">
                <Label htmlFor="note">Change note</Label>
                <Input id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Peak-season uplift for Mara corridor" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="eff">Effective from</Label>
                <Input id="eff" type="datetime-local" value={effectiveAt} onChange={(e) => setEffectiveAt(e.target.value)} />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setConfig(defaultPricingConfig())}>Reset to baseline</Button>
                <Button onClick={save} disabled={dirty.length === 0 || publishing}>
                  {publishing ? "Publishing…" : "Publish"}
                </Button>
              </div>
            </div>
          </HubSection>
        </TabsContent>

        {/* ---------------------------------------------------------- */}
        <TabsContent value="airports">
          <HubSection title="Airport charge tables" description="Per-airfield landing, navigation, handling and passenger charges in USD.">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[180px]">Airport</TableHead>
                    {AIRPORT_FIELDS.map(([, label]) => <TableHead key={label}>{label}</TableHead>)}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {config.airports.map((a) => (
                    <TableRow key={a.code}>
                      <TableCell className="font-medium">
                        {a.label}
                        <div className="text-xs text-muted-foreground">
                          {a.code}{a.international ? " · international" : ""}
                        </div>
                      </TableCell>
                      {AIRPORT_FIELDS.map(([field, label]) => (
                        <TableCell key={label}>
                          <Input
                            aria-label={`${a.code} ${label}`}
                            className="h-8 w-24" type="number"
                            value={a[field] as number}
                            onChange={(e) => setAirport(a.code, field, e.target.value)}
                          />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </HubSection>
        </TabsContent>

        {/* ---------------------------------------------------------- */}
        <TabsContent value="aircraft">
          <HubSection title="Aircraft hourly economics" description="Base commercial rate, cruise speed and per-hour cost inputs for each aircraft class.">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Aircraft</TableHead>
                    <TableHead>Seats</TableHead>
                    <TableHead>Hourly rate (USD)</TableHead>
                    <TableHead>Cruise (kts)</TableHead>
                    <TableHead>Fuel /hr</TableHead>
                    <TableHead>Crew /hr</TableHead>
                    <TableHead>WIL→MRE indicative</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {config.aircraft.map((a) => {
                    const indicative = computeAviationPrice({
                      aircraftKey: a.key, origin: "WIL", destination: "MRE", passengers: a.seats,
                      roundTrip: true, controls: config.controls, airportTable: config.airports,
                    });
                    return (
                      <TableRow key={a.key}>
                        <TableCell className="font-medium">{a.label}</TableCell>
                        <TableCell className="tabular-nums">{a.seats}</TableCell>
                        <TableCell><Input aria-label={`${a.label} hourly rate`} className="h-8 w-28" type="number" value={a.baseHourlyRate} onChange={(e) => setAircraftRate(a.key, "baseHourlyRate", e.target.value)} /></TableCell>
                        <TableCell><Input aria-label={`${a.label} cruise`} className="h-8 w-24" type="number" value={a.cruiseKts} onChange={(e) => setAircraftRate(a.key, "cruiseKts", e.target.value)} /></TableCell>
                        <TableCell><Input aria-label={`${a.label} fuel`} className="h-8 w-24" type="number" value={a.fuelPerHour} onChange={(e) => setAircraftRate(a.key, "fuelPerHour", e.target.value)} /></TableCell>
                        <TableCell><Input aria-label={`${a.label} crew`} className="h-8 w-24" type="number" value={a.crewPerHour} onChange={(e) => setAircraftRate(a.key, "crewPerHour", e.target.value)} /></TableCell>
                        <TableCell className="tabular-nums font-medium">{usd(indicative.customerPrice)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </HubSection>
        </TabsContent>

        {/* ---------------------------------------------------------- */}
        <TabsContent value="routes">
          <HubSection
            title="Route intelligence"
            description={`Indicative round-trip economics on Kenya's core charter corridors for the ${config.aircraft.find((a) => a.key === sim.aircraftKey)?.label ?? ""}.`}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Route</TableHead>
                  <TableHead>Distance</TableHead>
                  <TableHead>Block hours</TableHead>
                  <TableHead>Charter price</TableHead>
                  <TableHead>Per seat</TableHead>
                  <TableHead>Empty leg</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {grid.map((r) => (
                  <TableRow key={`${r.origin}-${r.destination}`}>
                    <TableCell className="font-medium">
                      {r.originLabel} → {r.destinationLabel}
                      <div className="text-xs text-muted-foreground">{r.origin} → {r.destination}</div>
                    </TableCell>
                    <TableCell className="tabular-nums">{r.distanceNm} nm</TableCell>
                    <TableCell className="tabular-nums">{r.blockHours} h</TableCell>
                    <TableCell className="tabular-nums font-medium">{usd(r.indicativePrice)}</TableCell>
                    <TableCell className="tabular-nums">{usd(r.perSeat)}</TableCell>
                    <TableCell className="tabular-nums text-status-success dark:text-status-success">{usd(r.emptyLegPrice)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </HubSection>
        </TabsContent>

        {/* ---------------------------------------------------------- */}
        <TabsContent value="audit">
          <HubSection title="Pricing change audit" description="Every published version with actor, effective date and field-level diff.">
            {versions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No pricing versions published yet — the baseline configuration is live.</p>
            ) : (
              <ol className="space-y-4">
                {[...versions].reverse().map((v) => (
                  <li key={v.version} className="rounded-lg border p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">v{v.version}</Badge>
                      <span className="text-sm font-medium">{v.actor}</span>
                      <span className="text-xs text-muted-foreground">effective {new Date(v.effectiveAt).toLocaleString()}</span>
                    </div>
                    {v.note && <p className="mt-1 text-sm text-muted-foreground">{v.note}</p>}
                    <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                      {v.changes.map((c, i) => (
                        <li key={i} className="tabular-nums">
                          <span className="font-mono">{c.field}</span>: {String(c.from)} → <span className="font-medium text-foreground">{String(c.to)}</span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            )}
          </HubSection>

          {/*
            Server-published versions are the authoritative rollback source.
            Rolling back never rewrites history: the chosen configuration is
            re-published as a new, higher version so the chain stays append-only.
          */}
          <HubSection
            title="Published versions · rollback"
            description="Re-publish an earlier governed configuration. History is never deleted or rewritten."
          >
            {serverVersions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No server-published versions yet — nothing to roll back to.
              </p>
            ) : (
              <ul className="space-y-2">
                {serverVersions.map((v) => {
                  const version = Number(v.version ?? 0);
                  return (
                    <li
                      key={version}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge variant={version === liveVersion ? "default" : "secondary"}>v{version}</Badge>
                          {version === liveVersion && (
                            <span className="text-xs text-muted-foreground">live</span>
                          )}
                        </div>
                        {v.note ? (
                          <p className="mt-1 truncate text-sm text-muted-foreground">{String(v.note)}</p>
                        ) : null}
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        data-analytics="pricingcontrol.rollback"
                        disabled={rollingBack !== null || version === liveVersion}
                        onClick={() => void rollbackTo(v)}
                      >
                        {rollingBack === version ? "Rolling back…" : `Roll back to v${version}`}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </HubSection>
        </TabsContent>
      </Tabs>
    </FlightHubPage>
  );
}
