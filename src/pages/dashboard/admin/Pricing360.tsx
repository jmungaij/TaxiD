import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "react-router-dom";
import {
  AlertTriangle, Calculator, CheckCircle2, Coins, ExternalLink, Gauge, LineChart,
  MapPin, ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { AdminOnly } from "@/components/auth/AdminOnly";
import { useTabDeepLink } from "@/hooks/useTabDeepLink";
import { AppButton } from "@/components/nav/AppButton";
import { AssetBandGovernance } from "@/components/pricing360/AssetBandGovernance";
import { AssetPricing360Console } from "@/components/pricing360/AssetPricing360Console";
import {
  calculatePriceServer, fetchComponents, fetchPricingAudit, fetchPricingHealth,
  fetchQuoteSnapshots, fetchRateCards, fetchRateLines, fetchRuleSets,
  type PricingAuditEvent, type PricingHealth, type QuoteSnapshotRow,
} from "@/lib/pricing360/api";
import { explainPrice } from "@/lib/pricing360/engine";
import { auditedPricingAction } from "@/lib/pricing360/audit";
import {
  PRICE_STATUS_COPY, type DayType, type PriceCalculationInput, type PriceResult, type PricingComponent,
  type PricingRuleSet, type RateCard, type RateLine,
} from "@/lib/pricing360/types";

const money = (n: number, currency = "KES") =>
  `${currency} ${Math.round(n).toLocaleString()}`;

const KIND_TONE: Record<string, string> = {
  base: "bg-muted text-foreground",
  surcharge: "bg-warning/10 text-warning-foreground",
  fee: "bg-info/10 text-info",
  discount: "bg-success/10 text-success",
  tax: "bg-destructive/10 text-destructive",
  floor: "bg-muted text-muted-foreground",
  commission: "bg-secondary text-secondary-foreground",
};

const DAY_TYPES: DayType[] = ["standard", "night", "sunday", "holiday"];

/**
 * Pricing 360 Control Centre — the single commercial control plane.
 *
 * Every figure on this page is read from the governed configuration
 * (`commercial_rate_cards` + `pricing_rule_sets`/`pricing_components`) and every
 * simulated price is calculated by the server RPC `pricing360_calculate`, never
 * in the browser. The console is a window onto the authoritative engine, not a
 * second engine.
 */
import { usePricingFlags } from "@/hooks/usePricingFlags";
import { FlagDisabledState } from "@/components/pricing360/FlagDisabledState";
import { PricingAccessGovernance } from "@/components/pricing360/PricingAccessGovernance";

const TAB_KEYS = [
  "overview", "products", "markets", "intelligence", "rates", "rules",
  "asset-bands", "asset-360", "dynamic", "simulator", "snapshots", "health", "audit", "access",
] as const;

/** Business lines TaxiD prices. Coverage is proven from configuration, never assumed. */
const BUSINESS_LINES: { domain: string; label: string; editor: string; editorLabel: string }[] = [
  { domain: "ride_hailing", label: "Ride Hailing", editor: "/dashboard/admin/smartfare-pricing", editorLabel: "SmartFare settings" },
  { domain: "delivery", label: "Delivery & Parcel", editor: "/dashboard/admin/pricing-360?tab=asset-bands", editorLabel: "Asset pricing bands" },
  { domain: "logistics", label: "Logistics", editor: "/dashboard/admin/pricing-360?tab=asset-bands", editorLabel: "Asset pricing bands" },
  { domain: "corporate_charter", label: "Corporate Charter", editor: "/staff/commercial/charter", editorLabel: "Charter commercial engine" },
  { domain: "rentals", label: "Rentals", editor: "/dashboard/admin/pricing-360?tab=asset-bands", editorLabel: "Asset pricing bands" },
  { domain: "leasing", label: "Leasing", editor: "/dashboard/admin/pricing-360?tab=asset-bands", editorLabel: "Asset pricing bands" },
];

export default function Pricing360() {
  const { flags, source: flagSource, loading: flagsLoading } = usePricingFlags();
  const { tab, goTo } = useTabDeepLink(TAB_KEYS as unknown as string[], "overview");
  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState<PricingHealth | null>(null);
  const [ruleSets, setRuleSets] = useState<PricingRuleSet[]>([]);
  const [components, setComponents] = useState<PricingComponent[]>([]);
  const [cards, setCards] = useState<RateCard[]>([]);
  const [lines, setLines] = useState<RateLine[]>([]);
  const [audit, setAudit] = useState<PricingAuditEvent[]>([]);
  const [snapshots, setSnapshots] = useState<QuoteSnapshotRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [h, rs, comps, rc, ev, snaps] = await Promise.all([
        fetchPricingHealth(), fetchRuleSets(), fetchComponents(), fetchRateCards(),
        fetchPricingAudit(50).catch(() => []), fetchQuoteSnapshots(25).catch(() => []),
      ]);
      setHealth(h); setRuleSets(rs); setComponents(comps); setCards(rc);
      setAudit(ev); setSnapshots(snaps);
      const approved = rc.find((c) => c.status === "approved") ?? rc[0];
      if (approved) setLines(await fetchRateLines(approved.id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load pricing configuration");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const published = useMemo(() => ruleSets.find((r) => r.status === "published") ?? null, [ruleSets]);
  const publishedComponents = useMemo(
    () => components.filter((c) => c.rule_set_id === published?.id),
    [components, published],
  );

  const integrity = useMemo(() => {
    if (!health) return null;
    const checks = [
      { label: "Published commercial rule set in force", ok: health.published_rule_sets > 0 },
      { label: "Every priced business line has a rule set", ok: (health.domains_without_rule_set ?? []).length === 0 },
      { label: "Approved rate card in force", ok: health.approved_rate_cards > 0 },
      { label: "No non-positive published rates", ok: health.non_positive_rates === 0 },
      { label: "No duplicate rate lines", ok: health.duplicate_rate_lines === 0 },
      { label: "No invalid effective windows", ok: health.invalid_effective_windows === 0 },
      { label: "Rate coverage present", ok: health.rate_lines > 0 },
    ];
    const score = Math.round((checks.filter((c) => c.ok).length / checks.length) * 100);
    return { checks, score };
  }, [health]);

  return (
    <AdminOnly>
      <div className="container mx-auto space-y-6 px-4 py-8">
        {/* Cinematic command band — atmosphere stays subordinate to the numbers. */}
        <header className="hero-band px-6 py-6">
          <div className="relative flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] opacity-80">
                Commercial &amp; Pricing
              </p>
              <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
                <Coins className="h-6 w-6" aria-hidden /> Pricing 360
              </h1>
              <p className="mt-1 max-w-2xl text-sm opacity-85">
                Commercial intelligence &amp; pricing control. Rate cards, rules, fees, surcharges,
                taxes, discounts and quotes resolve through one deterministic, versioned, auditable
                engine — the single source of commercial truth for every business line.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={published ? "secondary" : "destructive"}>
                {published ? `Live · rules ${published.version}` : "No published rules"}
              </Badge>
              <AppButton variant="secondary" analytics="pricing360_refresh" action="noop" aria-label="Refresh pricing configuration" onClick={() => void load()}>
                Refresh configuration
              </AppButton>
            </div>
          </div>
        </header>

        {loading || flagsLoading ? (
          <div className="grid gap-4 md:grid-cols-4">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}
          </div>
        ) : !flags.kpi_band ? (
          <FlagDisabledState flag="kpi_band" source={flagSource} />
        ) : (
          <div className="grid gap-4 md:grid-cols-4">
            {/* Truthful states: an unreachable health model reads "Model unavailable",
                a reachable model with nothing configured reads "Insufficient data".
                Never a fabricated zero. */}
            <Kpi
              label="Approved rate cards"
              value={!health ? "Model unavailable" : health.approved_rate_cards > 0 ? String(health.approved_rate_cards) : "Insufficient data"}
              tone={!health ? "warning" : health.approved_rate_cards > 0 ? undefined : "warning"}
              onClick={() => goTo("rates")}
            />
            <Kpi
              label="Published rate lines"
              value={!health ? "Model unavailable" : health.rate_lines > 0 ? String(health.rate_lines) : "Insufficient data"}
              tone={!health ? "warning" : health.rate_lines > 0 ? undefined : "warning"}
              onClick={() => goTo("rates")}
            />
            <Kpi
              label="Active commercial rules"
              value={
                !published
                  ? "Model unavailable"
                  : publishedComponents.filter((c) => c.active).length > 0
                    ? String(publishedComponents.filter((c) => c.active).length)
                    : "Insufficient data"
              }
              tone={published && publishedComponents.some((c) => c.active) ? undefined : "warning"}
              onClick={() => goTo("rules")}
            />
            {flags.kpi_integrity ? (
              <Kpi
                label="Pricing integrity"
                value={integrity ? `${integrity.score}%` : "Model unavailable"}
                tone={integrity ? (integrity.score === 100 ? "success" : "warning") : "warning"}
                onClick={() => goTo("health")}
              />
            ) : (
              <FlagDisabledState flag="kpi_integrity" source={flagSource} />
            )}
          </div>
        )}

        <Tabs value={tab} onValueChange={goTo}>
          <TabsList className="flex-wrap">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="products">Products</TabsTrigger>
            <TabsTrigger value="markets">Markets</TabsTrigger>
            <TabsTrigger value="intelligence">Pricing intelligence</TabsTrigger>
            <TabsTrigger value="rates">Rate cards</TabsTrigger>
            <TabsTrigger value="rules">Rules, fees &amp; taxes</TabsTrigger>
            <TabsTrigger value="asset-bands">Asset bands</TabsTrigger>
            <TabsTrigger value="asset-360">Asset Pricing 360</TabsTrigger>
            <TabsTrigger value="dynamic">Dynamic pricing</TabsTrigger>
            <TabsTrigger value="simulator">Simulator</TabsTrigger>
            <TabsTrigger value="snapshots">Quote snapshots</TabsTrigger>
            <TabsTrigger value="health">Health</TabsTrigger>
            <TabsTrigger value="audit">Audit</TabsTrigger>
            <TabsTrigger value="access">Access &amp; flags</TabsTrigger>
          </TabsList>

          {/* ---------------- Overview ---------------- */}
          <TabsContent value="overview" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Rule-set version timeline</CardTitle>
                <CardDescription>
                  Draft → under review → approved → published → superseded. Only a published
                  version prices live transactions; superseded versions stay readable so historic
                  quotes remain reproducible.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Version</TableHead><TableHead>Domain</TableHead>
                      <TableHead>Status</TableHead><TableHead>Effective from</TableHead>
                      <TableHead>Published</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ruleSets.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{r.code} {r.version}</TableCell>
                        <TableCell>{r.domain}</TableCell>
                        <TableCell><Badge variant={r.status === "published" ? "default" : "secondary"}>{r.status}</Badge></TableCell>
                        <TableCell>{new Date(r.effective_from).toLocaleDateString()}</TableCell>
                        <TableCell>{r.published_at ? new Date(r.published_at).toLocaleString() : "—"}</TableCell>
                      </TableRow>
                    ))}
                    {!ruleSets.length && !loading && (
                      <TableRow><TableCell colSpan={5} className="text-muted-foreground">No rule sets configured.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Governed pricing surfaces</CardTitle>
                <CardDescription>
                  Pricing 360 is the parent capability. These existing consoles remain the
                  domain-specific editors and feed the same control plane.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2 sm:grid-cols-2">
                {[
                  { to: "/dashboard/admin/pricing-360?tab=asset-bands", label: "Asset pricing bands (bands, mileage, multipliers)" },
                  { to: "/dashboard/admin/smartfare-pricing", label: "SmartFare settings (ride fares)" },
                  { to: "/dashboard/admin/smartfare-what-if", label: "SmartFare what-if analysis" },
                  { to: "/dashboard/admin/charter-pricing-alerts", label: "Charter pricing alerts" },
                  { to: "/staff/commercial/charter", label: "Corporate charter commercial engine" },
                ].map((l) => (
                  <Link key={l.to} to={l.to} className="flex items-center justify-between rounded-md border p-3 text-sm hover:bg-accent">
                    <span>{l.label}</span><ExternalLink className="h-4 w-4 text-muted-foreground" />
                  </Link>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ---------------- Products ---------------- */}
          <TabsContent value="products">
            {flags.products_markets
              ? <ProductCoverage cards={cards} ruleSets={ruleSets} loading={loading} />
              : <FlagDisabledState flag="products_markets" source={flagSource} />}
          </TabsContent>

          {/* ---------------- Markets ---------------- */}
          <TabsContent value="markets">
            {flags.products_markets
              ? <MarketPricing lines={lines} loading={loading} />
              : <FlagDisabledState flag="products_markets" source={flagSource} />}
          </TabsContent>

          {/* ---------------- Pricing intelligence ---------------- */}
          <TabsContent value="intelligence">
            {flags.pricing_intelligence
              ? <PricingIntelligence snapshots={snapshots} loading={loading} />
              : <FlagDisabledState flag="pricing_intelligence" source={flagSource} />}
          </TabsContent>

          {/* ---------------- Dynamic pricing ---------------- */}
          <TabsContent value="dynamic">
            {flags.dynamic_pricing
              ? <DynamicPricing />
              : <FlagDisabledState flag="dynamic_pricing" source={flagSource} />}
          </TabsContent>

          {/* ---------------- Rate cards ---------------- */}
          <TabsContent value="rates" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Rate cards</CardTitle>
                <CardDescription>Versioned, effective-dated and approval-controlled.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Card</TableHead><TableHead>Business line</TableHead>
                      <TableHead>Version</TableHead><TableHead>Status</TableHead><TableHead>Effective</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cards.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium">{c.name}</TableCell>
                        <TableCell>{c.product_domain}</TableCell>
                        <TableCell>{c.version}</TableCell>
                        <TableCell><Badge variant={c.status === "approved" ? "default" : "secondary"}>{c.status}</Badge></TableCell>
                        <TableCell>{c.effective_from ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                <div>
                  <h3 className="mb-2 text-sm font-semibold">Published rate lines</h3>
                  <div className="max-h-[28rem] overflow-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Service</TableHead><TableHead>Scope</TableHead>
                          <TableHead>Category</TableHead><TableHead>Basis</TableHead>
                          <TableHead className="text-right">Rate</TableHead>
                          <TableHead className="text-right">Included km</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {lines.map((l) => (
                          <TableRow key={l.id}>
                            <TableCell>{l.service_code}</TableCell>
                            <TableCell>{l.scope_label || "—"}</TableCell>
                            <TableCell>{l.category_code}</TableCell>
                            <TableCell>{l.pricing_basis.replace("per_", "per ")}</TableCell>
                            <TableCell className="text-right font-medium">{money(l.amount, l.currency)}</TableCell>
                            <TableCell className="text-right">{l.included_distance_km ?? "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ---------------- Rules ---------------- */}
          <TabsContent value="rules">
            <Card>
              <CardHeader>
                <CardTitle>Commercial rules in force</CardTitle>
                <CardDescription>
                  Fees, surcharges, discounts, taxes and floors of the published rule set. Nothing is
                  hard-coded in the application: an empty tax list means no tax is charged.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Kind</TableHead><TableHead>Rule</TableHead><TableHead>Calculation</TableHead>
                      <TableHead>Basis</TableHead><TableHead>Priority</TableHead>
                      <TableHead>Stacks</TableHead><TableHead>Scope</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {publishedComponents.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell><span className={`rounded px-2 py-0.5 text-xs font-medium ${KIND_TONE[c.kind]}`}>{c.kind}</span></TableCell>
                        <TableCell className="font-medium">{c.label}<div className="text-xs text-muted-foreground">{c.code}</div></TableCell>
                        <TableCell>{c.calc === "percentage" ? `${c.value}%` : c.calc === "multiplier" ? `×${c.value}` : money(c.value)}</TableCell>
                        <TableCell>{c.basis.replace(/_/g, " ")}</TableCell>
                        <TableCell>{c.priority}</TableCell>
                        <TableCell>{c.stackable ? "Yes" : "No"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {Object.keys(c.scope ?? {}).length ? JSON.stringify(c.scope) : "All services"}
                        </TableCell>
                      </TableRow>
                    ))}
                    {!publishedComponents.length && !loading && (
                      <TableRow><TableCell colSpan={7} className="text-muted-foreground">No published commercial rules.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ---------------- Simulator ---------------- */}
          {/* Engine B: governed per-vehicle bands used by charter, rental and logistics. */}
          <TabsContent value="asset-bands">
            <AssetBandGovernance />
          </TabsContent>

          {/* Asset Pricing 360: engine-aware governance across the 11 asset families. */}
          <TabsContent value="asset-360">
            <AssetPricing360Console />
          </TabsContent>


          <TabsContent value="simulator">
            {flags.simulator
              ? <Simulator lines={lines} />
              : <FlagDisabledState flag="simulator" source={flagSource} />}
          </TabsContent>

          {/* ---------------- Snapshots ---------------- */}
          <TabsContent value="snapshots">
            <Card>
              <CardHeader>
                <CardTitle>Immutable quote snapshots</CardTitle>
                <CardDescription>
                  Every issued price is frozen with its rate-card and rule-set version, so a quote
                  stays reproducible after configuration changes. Snapshots cannot be edited or deleted.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Reference</TableHead><TableHead>Business line</TableHead>
                      <TableHead>Rate card</TableHead><TableHead>Rules</TableHead>
                      <TableHead className="text-right">Total</TableHead><TableHead>Calculated</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {snapshots.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="font-medium">{s.quote_ref ?? s.id.slice(0, 8)}</TableCell>
                        <TableCell>{s.domain}</TableCell>
                        <TableCell>{s.rate_card_version ?? "—"}</TableCell>
                        <TableCell>{s.rule_set_version ?? "—"}</TableCell>
                        <TableCell className="text-right">{money(s.total, s.currency)}</TableCell>
                        <TableCell>{new Date(s.calculated_at).toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                    {!snapshots.length && !loading && (
                      <TableRow><TableCell colSpan={6} className="text-muted-foreground">No priced quotes yet.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ---------------- Health ---------------- */}
          <TabsContent value="health">
            <Card>
              <CardHeader>
                <CardTitle>Pricing health monitor</CardTitle>
                <CardDescription>
                  Scored on real conditions in the configuration, not on the existence of tables.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {(integrity?.checks ?? []).map((c) => (
                  <div key={c.label} className="flex items-center gap-2 text-sm">
                    {c.ok
                      ? <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />
                      : <AlertTriangle className="h-4 w-4 text-warning" aria-hidden />}
                    <span>{c.label}</span>
                  </div>
                ))}
                {health && (
                  <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                    <div>Active tax rules: <strong>{health.active_tax_components}</strong></div>
                    <div>Active discount rules: <strong>{health.active_discount_components}</strong></div>
                    <div>Duplicate rate lines: <strong>{health.duplicate_rate_lines}</strong></div>
                    <div>Frozen snapshots: <strong>{health.snapshots}</strong></div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ---------------- Audit ---------------- */}
          <TabsContent value="audit">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4" aria-hidden /> Pricing audit trail
                </CardTitle>
                <CardDescription>Append-only. Configuration history is never overwritten.</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead><TableHead>Action</TableHead>
                      <TableHead>Entity</TableHead><TableHead>Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {audit.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell>{new Date(e.created_at).toLocaleString()}</TableCell>
                        <TableCell><Badge variant="secondary">{e.action}</Badge></TableCell>
                        <TableCell>{e.entity}</TableCell>
                        <TableCell className="text-muted-foreground">{e.reason || "—"}</TableCell>
                      </TableRow>
                    ))}
                    {!audit.length && !loading && (
                      <TableRow><TableCell colSpan={4} className="text-muted-foreground">No pricing changes recorded.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ---------------- Access & flags ---------------- */}
          <TabsContent value="access">
            <PricingAccessGovernance />
          </TabsContent>
        </Tabs>
      </div>
    </AdminOnly>
  );
}

function Kpi({
  label, value, tone, onClick,
}: { label: string; value: string; tone?: "success" | "warning"; onClick?: () => void }) {
  return (
    <Card
      className={onClick ? "glass-panel cursor-pointer transition-colors hover:border-primary/40" : undefined}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
      aria-label={onClick ? `${label} — open detail` : undefined}
    >
      <CardContent className="pt-6">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={`mt-1 text-2xl font-semibold ${tone === "warning" ? "text-warning" : tone === "success" ? "text-success" : ""}`}>
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Pricing simulator — inputs on the left, the server's authoritative
 * calculation on the right. The browser never computes the answer.
 */
function Simulator({ lines }: { lines: RateLine[] }) {
  const services = useMemo(() => Array.from(new Set(lines.map((l) => l.service_code))), [lines]);
  const [service, setService] = useState("");
  const [scope, setScope] = useState("");
  const [category, setCategory] = useState("");
  const [dayType, setDayType] = useState<DayType>("standard");
  const [quantity, setQuantity] = useState(1);
  const [promo, setPromo] = useState("");
  const [result, setResult] = useState<PriceResult | null>(null);
  const [busy, setBusy] = useState(false);

  const effectiveService = service || services[0] || "";
  const scopes = useMemo(
    () => Array.from(new Set(lines.filter((l) => l.service_code === effectiveService).map((l) => l.scope_label))),
    [lines, effectiveService],
  );
  const effectiveScope = scope || scopes[0] || "";
  const matching = useMemo(
    () => lines.filter((l) => l.service_code === effectiveService && l.scope_label === effectiveScope),
    [lines, effectiveService, effectiveScope],
  );
  const effectiveCategory = category || matching[0]?.category_code || "";
  const basis = matching.find((l) => l.category_code === effectiveCategory)?.pricing_basis ?? "per_day";

  const run = async () => {
    setBusy(true);
    try {
      const input: PriceCalculationInput = {
        domain: "corporate_charter",
        service_code: effectiveService,
        scope_label: effectiveScope,
        category_code: effectiveCategory,
        pricing_basis: basis,
        quantity,
        day_type: dayType,
        promo_code: promo || undefined,
      };
      const priced = await auditedPricingAction(
        {
          action: "simulate",
          entity: "pricing360_calculate",
          reason: "Pricing simulator run",
          after: input as unknown as Record<string, unknown>,
        },
        () => calculatePriceServer(input),
      );
      setResult(priced);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Pricing service unavailable");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Calculator className="h-4 w-4" aria-hidden /> Scenario</CardTitle>
          <CardDescription>Only combinations with a published rate can be priced.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Service">
            <Select value={effectiveService} onValueChange={(v) => { setService(v); setScope(""); setCategory(""); }}>
              <SelectTrigger><SelectValue placeholder="Select service" /></SelectTrigger>
              <SelectContent>{services.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Scope">
            <Select value={effectiveScope} onValueChange={(v) => { setScope(v); setCategory(""); }}>
              <SelectTrigger><SelectValue placeholder="Select scope" /></SelectTrigger>
              <SelectContent>{scopes.map((s) => <SelectItem key={s || "none"} value={s}>{s || "—"}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Vehicle category">
            <Select value={effectiveCategory} onValueChange={setCategory}>
              <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
              <SelectContent>
                {matching.map((l) => <SelectItem key={l.id} value={l.category_code}>{l.category_code}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Operating day">
            <Select value={dayType} onValueChange={(v) => setDayType(v as DayType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{DAY_TYPES.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={`Quantity (${basis.replace("per_", "")}s)`}>
              <Input type="number" min={1} value={quantity} onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))} />
            </Field>
            <Field label="Promotion code (optional)">
              <Input value={promo} onChange={(e) => setPromo(e.target.value)} placeholder="e.g. LAUNCH10" />
            </Field>
          </div>
          <AppButton analytics="pricing360_simulate" action="noop" aria-label="Calculate price with the pricing engine" disabled={busy || !effectiveCategory} onClick={() => void run()}>
            {busy ? "Calculating…" : "Calculate authoritative price"}
          </AppButton>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Calculation</CardTitle>
          <CardDescription>
            {result?.status === "OK" || result?.status === "PRICE_FLOOR_BREACH"
              ? `Rate card ${result.rate_card_version} · rules ${result.rule_set_version}`
              : "Server-side result, component by component."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!result && <p className="text-sm text-muted-foreground">Run a scenario to see how the price is constructed.</p>}
          {result && result.status !== "OK" && (
            <div className="mb-4 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
              <div className="font-medium">{result.status}</div>
              <div className="text-muted-foreground">{result.error ?? PRICE_STATUS_COPY[result.status]}</div>
            </div>
          )}
          {result?.components && (
            <>
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Component</TableHead><TableHead className="text-right">Amount</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {result.components.map((c) => (
                    <TableRow key={c.code}>
                      <TableCell>
                        <span className={`mr-2 rounded px-2 py-0.5 text-xs font-medium ${KIND_TONE[c.kind]}`}>{c.kind}</span>
                        {c.label}
                        <div className="text-xs text-muted-foreground">{c.reason}</div>
                      </TableCell>
                      <TableCell className="text-right font-medium">{money(c.amount, result.currency)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell className="font-semibold">Customer total</TableCell>
                    <TableCell className="text-right text-lg font-semibold">{money(result.total ?? 0, result.currency)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
              <pre className="mt-4 overflow-auto rounded-md bg-muted p-3 text-xs">{explainPrice(result).join("\n")}</pre>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

/**
 * Products — pricing coverage per TaxiD business line, proven from the governed
 * configuration. A line with no approved rate card is reported as unconfigured
 * rather than shown with an invented price.
 */
function ProductCoverage({
  cards, ruleSets, loading,
}: { cards: RateCard[]; ruleSets: PricingRuleSet[]; loading: boolean }) {
  const rows = BUSINESS_LINES.map((b) => {
    const domainCards = cards.filter((c) => c.product_domain === b.domain);
    const approved = domainCards.filter((c) => c.status === "approved");
    const rules = ruleSets.filter((r) => r.domain === b.domain || r.domain === "all");
    const publishedRules = rules.filter((r) => r.status === "published");
    return { ...b, cards: domainCards.length, approved: approved.length, publishedRules: publishedRules.length };
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pricing by business line</CardTitle>
        <CardDescription>
          One engine, many products. Each line links to its authoritative editor — no business
          line owns a private pricing engine.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Business line</TableHead><TableHead>Rate cards</TableHead>
              <TableHead>Approved</TableHead><TableHead>Rules in force</TableHead>
              <TableHead>Status</TableHead><TableHead>Authoritative editor</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.domain}>
                <TableCell className="font-medium">{r.label}</TableCell>
                <TableCell>{r.cards}</TableCell>
                <TableCell>{r.approved}</TableCell>
                <TableCell>{r.publishedRules}</TableCell>
                <TableCell>
                  {r.approved > 0 && r.publishedRules > 0
                    ? <Badge>Configured</Badge>
                    : <Badge variant="secondary">Not configured</Badge>}
                </TableCell>
                <TableCell>
                  <Link to={r.editor} className="inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline">
                    {r.editorLabel} <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  </Link>
                </TableCell>
              </TableRow>
            ))}
            {loading && <TableRow><TableCell colSpan={6}><Skeleton className="h-6" /></TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/**
 * Markets — derived strictly from the scopes present in the published rate
 * lines. No market is hard-coded: if configuration names no scope, the surface
 * reports that truthfully.
 */
function MarketPricing({ lines, loading }: { lines: RateLine[]; loading: boolean }) {
  const markets = useMemo(() => {
    const map = new Map<string, { scope: string; count: number; min: number; max: number; currency: string }>();
    for (const l of lines) {
      const key = l.scope_label || "Unscoped";
      const cur = map.get(key);
      if (!cur) map.set(key, { scope: key, count: 1, min: l.amount, max: l.amount, currency: l.currency });
      else {
        cur.count += 1;
        cur.min = Math.min(cur.min, l.amount);
        cur.max = Math.max(cur.max, l.amount);
      }
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [lines]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><MapPin className="h-4 w-4" aria-hidden /> Market &amp; scope pricing</CardTitle>
        <CardDescription>
          Scopes present in the rate card in force, with the configured rate range for each.
          Demand, supply and price-index telemetry is not part of the pricing control plane.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Market / scope</TableHead><TableHead>Rate lines</TableHead>
              <TableHead className="text-right">Lowest rate</TableHead>
              <TableHead className="text-right">Highest rate</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {markets.map((m) => (
              <TableRow key={m.scope}>
                <TableCell className="font-medium">{m.scope}</TableCell>
                <TableCell>{m.count}</TableCell>
                <TableCell className="text-right">{money(m.min, m.currency)}</TableCell>
                <TableCell className="text-right">{money(m.max, m.currency)}</TableCell>
              </TableRow>
            ))}
            {!markets.length && !loading && (
              <TableRow><TableCell colSpan={4} className="text-muted-foreground">No scoped markets configured in the rate card in force.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/**
 * Pricing intelligence — computed only from frozen quote snapshots, the one
 * real record of prices TaxiD has actually issued. No forecast, elasticity or
 * optimisation model exists yet, so none is displayed.
 */
function PricingIntelligence({ snapshots, loading }: { snapshots: QuoteSnapshotRow[]; loading: boolean }) {
  const byDomain = useMemo(() => {
    const map = new Map<string, { domain: string; count: number; total: number; currency: string; last: string }>();
    for (const s of snapshots) {
      const cur = map.get(s.domain);
      if (!cur) map.set(s.domain, { domain: s.domain, count: 1, total: s.total, currency: s.currency, last: s.calculated_at });
      else {
        cur.count += 1;
        cur.total += s.total;
        if (s.calculated_at > cur.last) cur.last = s.calculated_at;
      }
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [snapshots]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><LineChart className="h-4 w-4" aria-hidden /> Issued price intelligence</CardTitle>
          <CardDescription>
            Aggregated from {snapshots.length} frozen quote snapshot{snapshots.length === 1 ? "" : "s"} —
            the authoritative record of prices actually issued.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Business line</TableHead><TableHead>Quotes</TableHead>
                <TableHead className="text-right">Average price</TableHead>
                <TableHead className="text-right">Quoted value</TableHead>
                <TableHead>Latest</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byDomain.map((d) => (
                <TableRow key={d.domain}>
                  <TableCell className="font-medium">{d.domain}</TableCell>
                  <TableCell>{d.count}</TableCell>
                  <TableCell className="text-right">{money(d.total / d.count, d.currency)}</TableCell>
                  <TableCell className="text-right">{money(d.total, d.currency)}</TableCell>
                  <TableCell>{new Date(d.last).toLocaleString()}</TableCell>
                </TableRow>
              ))}
              {!byDomain.length && !loading && (
                <TableRow><TableCell colSpan={5} className="text-muted-foreground">Insufficient data — no quote snapshots recorded yet.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Elasticity, conversion &amp; revenue forecasting</CardTitle>
          <CardDescription>Model unavailable</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          TaxiD has no calibrated demand-elasticity or conversion model in the pricing control
          plane, so expected revenue, GMV, trip-volume and cancellation impacts are not projected
          here. Realised outcomes remain available in Payments &amp; Finance reporting.
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Dynamic pricing — Pricing 360 governs the static commercial plane. Live
 * multiplier decisioning is owned by the SmartFare and Air consoles, so this
 * surface routes there instead of simulating controls that do not exist.
 */
function DynamicPricing() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Gauge className="h-4 w-4" aria-hidden /> Dynamic pricing governance</CardTitle>
        <CardDescription>
          Guardrails and multipliers are configured in the product consoles below and are bound by
          the published rule set in force. Pricing 360 does not hold a second dynamic engine.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2">
        {[
          { to: "/dashboard/admin/smartfare-pricing", label: "SmartFare guardrails & multipliers (ride)" },
          { to: "/dashboard/admin/smartfare-what-if", label: "SmartFare what-if impact analysis" },
          { to: "/dashboard/admin/smartfare-versions", label: "SmartFare version diff & approval audit" },
          { to: "/dashboard/admin/flight-hub/pricing", label: "Air dynamic pricing control" },
          { to: "/dashboard/admin/charter-pricing-alerts", label: "Charter pricing alerts & exceptions" },
        ].map((l) => (
          <Link key={l.to} to={l.to} className="flex items-center justify-between rounded-md border p-3 text-sm hover:bg-accent">
            <span>{l.label}</span><ExternalLink className="h-4 w-4 text-muted-foreground" aria-hidden />
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
