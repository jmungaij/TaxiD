import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  BadgeCheck,
  Boxes,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  Clock,
  Leaf,
  Sparkle,
  ShieldAlert,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { DeliveryModule } from "@/components/delivery/ModuleShell";
import {
  aiRecommendations,
  cargoCategories,
  deliveryTrend,
  demandCurve,
  fleetAssets,
  governanceChecks,
  lifecycleStages,
  marketplaceSignals,
  moduleObservation,
  priceDelivery,
  PROCUREMENT_CAPABILITIES,
  routeCompliance,
  slaTiers,
  sustainabilityMetrics,
  zonePerformance,
  type GovernanceState,
  type PricingInput,
  type SlaTierId,
} from "@/lib/delivery/controlTower";

const kes = (n: number) => `KSh ${Math.round(n).toLocaleString("en-KE")}`;

export function SectionHeading({ title, subtitle, icon: Icon }: { title: string; subtitle: string; icon: typeof Sparkle }) {
  return (
    <div className="flex items-start gap-3">
      <div className="rounded-lg bg-primary/10 p-2">
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div>
        <h3 className="font-semibold text-sm">{title}</h3>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ AI dispatch */

const SEVERITY_STYLE = {
  info: "border-primary/30 bg-primary/5",
  warning: "border-status-warning/40 bg-status-warning/5",
  critical: "border-destructive/40 bg-destructive/5",
} as const;

export function AiDispatchPanel({ module }: { module: DeliveryModule }) {
  const recs = useMemo(() => aiRecommendations(module), [module]);
  const [applied, setApplied] = useState<string[]>([]);

  return (
    <Card className="p-4 border-border/70">
      <div className="flex items-center justify-between gap-2">
        <SectionHeading
          icon={BrainCircuit}
          title="AI dispatcher"
          subtitle="Recommendations generated from the live digital twin, prediction engine and demand model"
        />
        <Badge variant="secondary" className="text-[10px] shrink-0">{recs.length} signals</Badge>
      </div>
      <div className="mt-4 space-y-2.5 max-h-[440px] overflow-y-auto pr-1">
        {recs.map((r) => {
          const isApplied = applied.includes(r.id);
          return (
            <div key={r.id} className={cn("rounded-lg border p-3 transition-colors", SEVERITY_STYLE[r.severity])}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold capitalize">{r.title}</div>
                  <p className="text-xs text-muted-foreground mt-0.5">{r.detail}</p>
                </div>
                <Badge variant="outline" className="text-[10px] shrink-0">{Math.round(r.confidence * 100)}%</Badge>
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-status-success">{r.impact}</span>
                <Button
                  size="sm"
                  variant={isApplied ? "secondary" : "outline"}
                  className="h-7 text-[11px]"
                  onClick={() => setApplied((prev) => (isApplied ? prev.filter((x) => x !== r.id) : [...prev, r.id]))}
                >
                  {isApplied ? (
                    <>
                      <CheckCircle2 className="h-3 w-3 mr-1" /> Queued for dispatch
                    </>
                  ) : (
                    "Apply recommendation"
                  )}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------- lifecycle */

export function LifecyclePanel({ module }: { module: DeliveryModule }) {
  const stages = useMemo(() => lifecycleStages(module), [module]);
  return (
    <Card className="p-4 border-border/70">
      <SectionHeading
        icon={Clock}
        title="Parcel lifecycle & chain of custody"
        subtitle="Every hop timestamped, attributed to a responsible party and backed by evidence"
      />
      <ol className="mt-4 relative border-l border-border ml-3 space-y-3">
        {stages.map((s) => (
          <li key={s.key} className="ml-4 relative">
            <span
              className={cn(
                "absolute -left-[1.42rem] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-background",
                s.state === "done" && "bg-status-success",
                s.state === "active" && "bg-primary motion-safe:animate-pulse",
                s.state === "pending" && "bg-muted-foreground/40",
              )}
            />
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn("text-sm font-medium", s.state === "pending" && "text-muted-foreground")}>{s.label}</span>
              {s.state !== "pending" && (
                <span className="text-[11px] tabular-nums text-muted-foreground">{s.timestamp}</span>
              )}
              {s.state === "active" && <Badge className="text-[10px]">In progress</Badge>}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {s.owner} · {s.evidence}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

/* -------------------------------------------------------------- SLA */

export function SlaPanel({ module }: { module: DeliveryModule }) {
  const tiers = useMemo(() => slaTiers(module), [module]);
  const exposure = tiers.reduce((s, t) => s + t.exposureKes, 0);
  return (
    <Card className="p-4 border-border/70">
      <div className="flex items-center justify-between gap-2">
        <SectionHeading icon={ShieldAlert} title="SLA intelligence" subtitle="Compliance, breaches and financial exposure by priority tier" />
        <div className="text-right shrink-0">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Exposure</div>
          <div className="text-sm font-bold">{kes(exposure)}</div>
        </div>
      </div>
      <div className="mt-4 grid sm:grid-cols-2 gap-3">
        {tiers.map((t) => (
          <div key={t.id} className="rounded-lg border p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">{t.label}</span>
              <Badge variant="outline" className="text-[10px]">{t.window}</Badge>
            </div>
            <Progress value={t.compliancePct} className="mt-2 h-1.5" />
            <div className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-muted-foreground">
              <span>Compliance <b className="text-foreground">{t.compliancePct}%</b></span>
              <span>Volume <b className="text-foreground">{t.volume}</b></span>
              <span>Breaches <b className={cn(t.breaches > 0 ? "text-destructive" : "text-status-success")}>{t.breaches}</b></span>
              <span>Next cut-off <b className="text-foreground">{t.timeRemainingMinutes} min</b></span>
              <span className="col-span-2">Exposure <b className="text-foreground">{kes(t.exposureKes)}</b></span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ----------------------------------------------------------- pricing */

const PRIORITIES: SlaTierId[] = ["critical", "high", "standard", "economy"];

export function PricingIntelligence({ module }: { module: DeliveryModule }) {
  const [input, setInput] = useState<PricingInput>({
    distanceKm: 12,
    weightKg: 8,
    priority: "standard",
    insuredValueKes: 50_000,
    waitingMinutes: 5,
    enterprise: true,
  });
  const quote = useMemo(() => priceDelivery(module, input), [module, input]);

  return (
    <Card className="p-4 border-border/70">
      <SectionHeading icon={Sparkle} title="Transparent pricing intelligence" subtitle="Every component of the quote, priced live against today's network conditions" />
      <div className="mt-4 grid lg:grid-cols-2 gap-5">
        <div className="space-y-4">
          <Field label={`Distance — ${input.distanceKm} km`}>
            <Slider value={[input.distanceKm]} min={1} max={200} step={1} onValueChange={([v]) => setInput((p) => ({ ...p, distanceKm: v }))} />
          </Field>
          <Field label={`Weight — ${input.weightKg} kg`}>
            <Slider value={[input.weightKg]} min={1} max={500} step={1} onValueChange={([v]) => setInput((p) => ({ ...p, weightKg: v }))} />
          </Field>
          <Field label={`Declared value — ${kes(input.insuredValueKes)}`}>
            <Slider value={[input.insuredValueKes]} min={5_000} max={1_000_000} step={5_000} onValueChange={([v]) => setInput((p) => ({ ...p, insuredValueKes: v }))} />
          </Field>
          <Field label={`Waiting time — ${input.waitingMinutes} min`}>
            <Slider value={[input.waitingMinutes]} min={0} max={60} step={1} onValueChange={([v]) => setInput((p) => ({ ...p, waitingMinutes: v }))} />
          </Field>
          <div>
            <div className="text-xs font-medium mb-1.5">Priority</div>
            <div className="flex flex-wrap gap-1.5">
              {PRIORITIES.map((p) => (
                <Button
                  key={p}
                  size="sm"
                  variant={input.priority === p ? "default" : "outline"}
                  className="h-7 text-[11px] capitalize"
                  onClick={() => setInput((prev) => ({ ...prev, priority: p }))}
                >
                  {p}
                </Button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <Label htmlFor="ct-enterprise" className="text-xs">Enterprise contract pricing</Label>
            <Switch id="ct-enterprise" checked={input.enterprise} onCheckedChange={(v) => setInput((p) => ({ ...p, enterprise: v }))} />
          </div>
        </div>

        <div className="rounded-lg border bg-muted/30 p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Estimated total</div>
          <div className="text-2xl font-bold tabular-nums">{kes(quote.totalKes)}</div>
          <div className="mt-3 space-y-1.5">
            {quote.lines.map((l) => (
              <div key={l.label} className="flex items-start justify-between gap-3 text-xs">
                <span className="text-muted-foreground">
                  {l.label} <span className="text-[10px]">— {l.note}</span>
                </span>
                <span className="font-medium tabular-nums shrink-0">{kes(l.amountKes)}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 pt-3 border-t space-y-1 text-xs">
            <Line2 k="Subtotal" v={kes(quote.subtotalKes)} />
            <Line2 k="Enterprise discount" v={`- ${kes(quote.discountKes)}`} />
            <div className="flex items-center justify-between font-semibold">
              <span>Total</span>
              <span className="tabular-nums">{kes(quote.totalKes)}</span>
            </div>
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">{quote.savingsNote}</p>
        </div>
      </div>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium mb-2">{label}</div>
      {children}
    </div>
  );
}

function Line2({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between text-muted-foreground">
      <span>{k}</span>
      <span className="tabular-nums">{v}</span>
    </div>
  );
}

/* -------------------------------------------------------- governance */

const GOV_STYLE: Record<GovernanceState, string> = {
  verified: "text-status-success border-status-success/40 bg-status-success/10",
  pending: "text-status-warning border-status-warning/40 bg-status-warning/10",
  expiring: "text-status-warning border-status-warning/40 bg-status-warning/10",
  expired: "text-destructive border-destructive/40 bg-destructive/10",
};

export function GovernancePanel({ module }: { module: DeliveryModule }) {
  const checks = useMemo(() => governanceChecks(module), [module]);
  const compliance = useMemo(() => routeCompliance(module), [module]);
  return (
    <div className="space-y-4">
      <Card className="p-4 border-border/70">
        <SectionHeading icon={BadgeCheck} title="Enterprise governance" subtitle="Operator, driver and asset compliance monitored continuously with expiry tracking" />
        <div className="mt-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {checks.map((c) => (
            <div key={c.id} className="rounded-lg border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold truncate">{c.label}</span>
                <Badge variant="outline" className={cn("text-[10px] capitalize shrink-0", GOV_STYLE[c.state])}>
                  {c.state}
                </Badge>
              </div>
              <Progress value={c.coveragePct} className="mt-2 h-1" />
              <p className="mt-1.5 text-[11px] text-muted-foreground">{c.detail}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-4 border-border/70">
        <SectionHeading icon={AlertTriangle} title="Route & safety compliance" subtitle="Geofence, driving-behaviour and incident telemetry in real time" />
        <div className="mt-4 grid sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
          {compliance.map((c) => (
            <div key={c.id} className="rounded-lg border p-2.5">
              <div className="text-[11px] text-muted-foreground truncate">{c.label}</div>
              <div
                className={cn(
                  "text-sm font-semibold",
                  c.state === "breach" && "text-destructive",
                  c.state === "watch" && "text-status-warning",
                  c.state === "ok" && "text-status-success",
                )}
              >
                {c.value}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------- fleet */

export function FleetIntelligence({ module }: { module: DeliveryModule }) {
  const assets = useMemo(() => fleetAssets(module), [module]);
  const cats = useMemo(() => cargoCategories(module), [module]);
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <Card className="p-4 border-border/70">
        <SectionHeading icon={Wrench} title="Fleet intelligence" subtitle="Capacity, utilisation, maintenance and unit economics for every asset class" />
        <div className="mt-4 space-y-2">
          {assets.map((a) => (
            <Collapsible key={a.id} open={open === a.id} onOpenChange={(v) => setOpen(v ? a.id : null)}>
              <CollapsibleTrigger className="w-full rounded-lg border p-3 text-left hover:border-primary/40 transition-colors">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">{a.type}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {a.capacity} · {a.assigned} assigned · {a.available} available
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px] capitalize",
                        a.maintenance === "overdue" && "border-destructive/50 text-destructive",
                        a.maintenance === "due" && "border-status-warning/50 text-status-warning",
                        a.maintenance === "ok" && "border-status-success/50 text-status-success",
                      )}
                    >
                      {a.maintenance === "ok" ? "service ok" : `service ${a.maintenance}`}
                    </Badge>
                    <span className="text-xs font-semibold tabular-nums">{a.utilisationPct}%</span>
                    <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open === a.id && "rotate-180")} />
                  </div>
                </div>
                <Progress value={a.utilisationPct} className="mt-2 h-1" />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3 text-[11px]">
                  <Stat k="Payload" v={`${a.payloadKg.toLocaleString()} kg`} />
                  <Stat k="Fuel" v={a.fuel} />
                  <Stat k="Refrigeration" v={a.refrigerated ? "Yes" : "No"} />
                  <Stat k="Hazmat certified" v={a.hazmat ? "Yes" : "No"} />
                  <Stat k="Revenue / asset" v={kes(a.revenuePerAssetKes)} />
                  <Stat k="Cost / km" v={kes(a.costPerKmKes)} />
                  <Stat k="Utilisation" v={`${a.utilisationPct}%`} />
                  <Stat k="Driver assignment" v={`${a.assigned} drivers`} />
                </div>
              </CollapsibleContent>
            </Collapsible>
          ))}
        </div>
      </Card>

      <Card className="p-4 border-border/70">
        <SectionHeading icon={Boxes} title="Cargo categories & handling rules" subtitle="Each category carries its own handling, compliance and insurance tier" />
        <div className="mt-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {cats.map((c) => (
            <div key={c.id} className="rounded-lg border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold truncate">{c.label}</span>
                <Badge variant="secondary" className="text-[10px] capitalize shrink-0">{c.insuranceTier.replace("_", " ")}</Badge>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">{c.handling}</p>
              <p className="text-[11px] text-muted-foreground">{c.compliance}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-md bg-muted/40 p-2">
      <div className="text-muted-foreground">{k}</div>
      <div className="font-semibold">{v}</div>
    </div>
  );
}

/* --------------------------------------------------------- analytics */

export function AnalyticsPanel({ module }: { module: DeliveryModule }) {
  const trend = useMemo(() => deliveryTrend(module), [module]);
  const demand = useMemo(() => demandCurve(module), [module]);
  const zones = useMemo(() => zonePerformance(module), [module]);
  const [metric, setMetric] = useState<"deliveries" | "revenueKes" | "failed">("deliveries");

  return (
    <div className="space-y-4">
      <Card className="p-4 border-border/70">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionHeading icon={Sparkle} title="Delivery trends" subtitle="Seven-day operational and commercial performance" />
          <div className="flex gap-1.5">
            {(["deliveries", "revenueKes", "failed"] as const).map((m) => (
              <Button key={m} size="sm" variant={metric === m ? "secondary" : "ghost"} className="h-7 text-[11px]" onClick={() => setMetric(m)}>
                {m === "revenueKes" ? "Revenue" : m === "failed" ? "Failures" : "Deliveries"}
              </Button>
            ))}
          </div>
        </div>
        <div className="mt-4 h-56">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={trend}>
              <defs>
                <linearGradient id="ct-area" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="hsl(var(--chart-grid))" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" width={48} />
              <RTooltip
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                formatter={(v: number) => (metric === "revenueKes" ? kes(v) : v.toLocaleString())}
              />
              <Area type="monotone" dataKey={metric} stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#ct-area)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="p-4 border-border/70">
          <SectionHeading icon={Clock} title="Peak demand vs capacity" subtitle="Hourly request volume against dispatchable capacity" />
          <div className="mt-4 h-52">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={demand}>
                <CartesianGrid stroke="hsl(var(--chart-grid))" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="hour" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" width={40} />
                <RTooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="requests" name="Requests" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="capacity" name="Capacity" stroke="hsl(var(--chart-3))" strokeWidth={2} strokeDasharray="4 3" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-4 border-border/70">
          <SectionHeading icon={Sparkle} title="Zone performance" subtitle="On-time delivery by service zone, shaded by demand" />
          <div className="mt-4 h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={zones}>
                <CartesianGrid stroke="hsl(var(--chart-grid))" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="zone" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" interval={0} angle={-18} height={44} textAnchor="end" />
                <YAxis domain={[80, 100]} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" width={40} />
                <RTooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="onTimePct" name="On-time %" radius={[4, 4, 0, 0]}>
                  {zones.map((z) => (
                    <Cell key={z.zone} fill={z.demandIndex > 0.75 ? "hsl(var(--status-warning))" : "hsl(var(--primary))"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </div>
  );
}

/* -------------------------------------------------- marketplace + procure */

export function MarketplacePanel({ module }: { module: DeliveryModule }) {
  const signals = useMemo(() => marketplaceSignals(module), [module]);
  const green = useMemo(() => sustainabilityMetrics(module), [module]);
  return (
    <div className="space-y-4">
      <Card className="p-4 border-border/70">
        <SectionHeading icon={Sparkle} title="Marketplace intelligence" subtitle="Supply, demand, pricing signals and optimisation opportunities" />
        <div className="mt-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          {signals.map((s) => (
            <div key={s.id} className="rounded-lg border p-3 bg-card/70 backdrop-blur-sm">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground truncate">{s.label}</div>
              <div className="text-sm font-bold mt-0.5">{s.value}</div>
              <p className="text-[11px] text-muted-foreground mt-1">{s.detail}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-4 border-border/70">
        <SectionHeading icon={Leaf} title="Sustainability" subtitle="ESG-reportable emissions and electrification metrics" />
        <div className="mt-4 grid sm:grid-cols-3 gap-2.5">
          {green.map((g) => (
            <div key={g.id} className="rounded-lg border p-3">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{g.label}</div>
              <div className="text-sm font-bold">{g.value}</div>
              <p className="text-[11px] text-muted-foreground mt-0.5">{g.detail}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

export function ProcurementPanel({ module }: { module: DeliveryModule }) {
  const o = moduleObservation(module);
  return (
    <Card className="p-4 border-border/70">
      <SectionHeading icon={BadgeCheck} title="Enterprise procurement" subtitle="Everything a government, NGO or multinational finance team needs before onboarding" />
      <div className="mt-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
        {PROCUREMENT_CAPABILITIES.map((c) => (
          <div key={c.id} className="rounded-lg border p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold truncate">{c.label}</span>
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px] shrink-0",
                  c.status === "live" && "border-status-success/40 text-status-success",
                  c.status === "configurable" && "border-primary/40 text-primary",
                  c.status === "on_request" && "border-status-warning/40 text-status-warning",
                )}
              >
                {c.status.replace("_", " ")}
              </Badge>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">{c.detail}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-lg border bg-muted/30 p-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
        <Stat k="Avg cost / parcel" v={kes(o.costPerParcelKes)} />
        <Stat k="Revenue booked today" v={kes(o.revenueTodayKes)} />
        <Stat k="Customer satisfaction" v={`${o.csatPct}%`} />
        <Stat k="Inventory accuracy" v={`${o.inventoryAccuracyPct}%`} />
      </div>
    </Card>
  );
}
