/**
 * Delivery Control Tower — deterministic operational intelligence model for the
 * four public delivery modules (package, courier, fleet, logistics).
 *
 * Everything here is a pure projection of a seeded observation onto the existing
 * ELOS engines (digital twin, prediction engine, cold chain) so the marketing
 * control-tower surfaces reason against the same state as the internal Ops Hub.
 * No new backend, no random values: the same module always yields the same view.
 */
import { buildTwin, type TwinObservation, type TwinSnapshot } from "@/lib/logistics/digitalTwin";
import {
  detectAnomalies,
  forecastCapacity,
  type CapacityForecast,
  type LogisticsAnomaly,
} from "@/lib/logistics/predictionEngine";
import { COLD_CHAIN_LANES } from "@/lib/logistics/coldChain";
import type { DeliveryModule } from "@/components/delivery/ModuleShell";

export const CONTROL_TOWER_VERSION = "1.0.0";

/* ------------------------------------------------------------------ seeds */

export interface ModuleObservation extends TwinObservation {
  failedRatePct: number;
  carrierOnTimePct: number;
  vehiclesOverdueService: number;
  returnsBacklog: number;
  inventoryAccuracyPct: number;
  revenueTodayKes: number;
  avgPickupMinutes: number;
  avgDeliveryMinutes: number;
  csatPct: number;
  costPerParcelKes: number;
  co2SavedKg: number;
  evSharePct: number;
}

const NAIROBI_REGIONS = [
  { id: "cbd", name: "CBD" },
  { id: "westlands", name: "Westlands" },
  { id: "eastlands", name: "Eastlands" },
  { id: "industrial", name: "Industrial Area" },
];

const OBSERVATIONS: Record<DeliveryModule, ModuleObservation> = {
  package: {
    regions: NAIROBI_REGIONS,
    parcelsInTransit: 1284, parcelsAwaiting: 342, parcelsDelivered: 4870, parcelsFailed: 61,
    coldChainParcels: 96, vehiclesActive: 168, vehiclesTotal: 210, couriersActive: 184, ordersOpen: 402,
    trafficIndex: 0.42, weatherIndex: 0.24,
    failedRatePct: 1.2, carrierOnTimePct: 94.6, vehiclesOverdueService: 6, returnsBacklog: 44,
    inventoryAccuracyPct: 98.4, revenueTodayKes: 3_642_000, avgPickupMinutes: 22, avgDeliveryMinutes: 78,
    csatPct: 93.1, costPerParcelKes: 268, co2SavedKg: 1420, evSharePct: 27,
  },
  courier: {
    regions: NAIROBI_REGIONS,
    parcelsInTransit: 486, parcelsAwaiting: 128, parcelsDelivered: 2310, parcelsFailed: 17,
    coldChainParcels: 38, vehiclesActive: 212, vehiclesTotal: 248, couriersActive: 212, ordersOpen: 164,
    trafficIndex: 0.55, weatherIndex: 0.31,
    failedRatePct: 0.7, carrierOnTimePct: 96.2, vehiclesOverdueService: 4, returnsBacklog: 12,
    inventoryAccuracyPct: 99.1, revenueTodayKes: 1_186_000, avgPickupMinutes: 14, avgDeliveryMinutes: 41,
    csatPct: 95.4, costPerParcelKes: 412, co2SavedKg: 980, evSharePct: 46,
  },
  fleet: {
    regions: NAIROBI_REGIONS,
    parcelsInTransit: 742, parcelsAwaiting: 210, parcelsDelivered: 2960, parcelsFailed: 38,
    coldChainParcels: 120, vehiclesActive: 96, vehiclesTotal: 142, couriersActive: 96, ordersOpen: 231,
    trafficIndex: 0.38, weatherIndex: 0.2,
    failedRatePct: 1.0, carrierOnTimePct: 93.2, vehiclesOverdueService: 11, returnsBacklog: 26,
    inventoryAccuracyPct: 97.6, revenueTodayKes: 4_105_000, avgPickupMinutes: 34, avgDeliveryMinutes: 112,
    csatPct: 91.2, costPerParcelKes: 640, co2SavedKg: 2210, evSharePct: 12,
  },
  logistics: {
    regions: NAIROBI_REGIONS,
    parcelsInTransit: 2140, parcelsAwaiting: 690, parcelsDelivered: 7420, parcelsFailed: 84,
    coldChainParcels: 412, vehiclesActive: 128, vehiclesTotal: 176, couriersActive: 128, ordersOpen: 518,
    trafficIndex: 0.47, weatherIndex: 0.28,
    failedRatePct: 1.1, carrierOnTimePct: 92.4, vehiclesOverdueService: 9, returnsBacklog: 78,
    inventoryAccuracyPct: 96.9, revenueTodayKes: 7_940_000, avgPickupMinutes: 41, avgDeliveryMinutes: 186,
    csatPct: 90.4, costPerParcelKes: 918, co2SavedKg: 3860, evSharePct: 9,
  },
};

export function moduleObservation(module: DeliveryModule): ModuleObservation {
  return OBSERVATIONS[module];
}

export function moduleTwin(module: DeliveryModule): TwinSnapshot {
  return buildTwin(moduleObservation(module));
}

/* -------------------------------------------------------------------- KPIs */

export type KpiTone = "good" | "warn" | "bad" | "neutral";

export interface ControlTowerKpi {
  key: string;
  label: string;
  value: number;
  /** Formatting hint used by the UI counter. */
  unit: "count" | "pct" | "minutes" | "kes";
  delta: number;
  tone: KpiTone;
  hint: string;
  /** Whether the value came from live operational rows or the digital twin. */
  source?: "live" | "modelled";
}


const pct1 = (n: number) => Math.round(n * 10) / 10;

export function controlTowerKpis(module: DeliveryModule): ControlTowerKpi[] {
  const o = moduleObservation(module);
  const twin = moduleTwin(module);
  const totalHandled = (o.parcelsDelivered ?? 0) + (o.parcelsFailed ?? 0);
  const successPct = pct1(((o.parcelsDelivered ?? 0) / Math.max(1, totalHandled)) * 100);
  const fleetAvailPct = pct1((((o.vehiclesTotal ?? 0) - (o.vehiclesActive ?? 0)) / Math.max(1, o.vehiclesTotal ?? 1)) * 100);
  const slaPct = pct1(o.carrierOnTimePct - o.failedRatePct * 0.6);

  return [
    { key: "active", label: "Active deliveries", value: o.parcelsInTransit ?? 0, unit: "count", delta: 4.2, tone: "neutral", hint: "Parcels currently in transit across all zones" },
    { key: "awaiting", label: "Awaiting dispatch", value: o.parcelsAwaiting ?? 0, unit: "count", delta: -3.1, tone: (o.parcelsAwaiting ?? 0) > 500 ? "warn" : "good", hint: "Accepted orders not yet assigned to a courier" },
    { key: "fleet", label: "Fleet availability", value: fleetAvailPct, unit: "pct", delta: -1.4, tone: fleetAvailPct < 15 ? "warn" : "good", hint: "Idle capacity available for new assignments" },
    { key: "eta", label: "Average ETA", value: o.avgDeliveryMinutes, unit: "minutes", delta: -2.6, tone: "good", hint: "Mean predicted door-to-door duration" },
    { key: "pickup", label: "Average pickup", value: o.avgPickupMinutes, unit: "minutes", delta: -1.8, tone: "good", hint: "Request accepted → parcel collected" },
    { key: "sla", label: "SLA compliance", value: slaPct, unit: "pct", delta: 0.8, tone: slaPct >= 95 ? "good" : slaPct >= 90 ? "warn" : "bad", hint: "Weighted across all four priority tiers" },
    { key: "success", label: "Success rate", value: successPct, unit: "pct", delta: 0.3, tone: successPct >= 98 ? "good" : "warn", hint: "Delivered ÷ (delivered + failed) today" },
    { key: "failed", label: "Failed deliveries", value: o.parcelsFailed ?? 0, unit: "count", delta: -6.5, tone: (o.parcelsFailed ?? 0) > 60 ? "warn" : "good", hint: "Failures pending re-attempt or return" },
    { key: "cost", label: "Cost per parcel", value: o.costPerParcelKes, unit: "kes", delta: -2.2, tone: "good", hint: "Fully-loaded operating cost per handled unit" },
    { key: "ontime", label: "On-time rate", value: pct1(o.carrierOnTimePct), unit: "pct", delta: 1.1, tone: o.carrierOnTimePct >= 95 ? "good" : "warn", hint: "Delivered within the committed window" },
    { key: "revenue", label: "Revenue today", value: o.revenueTodayKes, unit: "kes", delta: 7.4, tone: "good", hint: "Gross booked value, settled + pending" },
    { key: "health", label: "Network health", value: twin.health, unit: "pct", delta: 0.6, tone: twin.health >= 70 ? "good" : twin.health >= 50 ? "warn" : "bad", hint: "Digital-twin composite of utilisation, traffic and weather" },
  ];
}

/* --------------------------------------------------------------- live map */

export interface MapZone {
  id: string;
  name: string;
  /** Percent coordinates within the map viewport. */
  x: number;
  y: number;
  demandIndex: number; // 0-1
  couriers: number;
  openRequests: number;
  avgEtaMinutes: number;
  surge: boolean;
}

export interface MapUnit {
  id: string;
  kind: "courier" | "vehicle" | "pickup" | "hub" | "depot";
  label: string;
  x: number;
  y: number;
  status: "moving" | "idle" | "loading" | "delayed";
}

export interface MapRoute {
  id: string;
  from: string;
  to: string;
  points: Array<{ x: number; y: number }>;
  etaMinutes: number;
  risk: "low" | "medium" | "high";
}

export interface LiveMapModel {
  zones: MapZone[];
  units: MapUnit[];
  routes: MapRoute[];
  trafficIndex: number;
  weatherIndex: number;
  heat: Array<{ x: number; y: number; intensity: number }>;
}

const ZONE_LAYOUT = [
  { id: "cbd", name: "CBD", x: 50, y: 52 },
  { id: "westlands", name: "Westlands", x: 30, y: 32 },
  { id: "eastlands", name: "Eastlands", x: 72, y: 60 },
  { id: "industrial", name: "Industrial Area", x: 56, y: 78 },
  { id: "karen", name: "Karen / Langata", x: 24, y: 72 },
  { id: "thika", name: "Thika Road", x: 68, y: 22 },
];

/** Deterministic pseudo-noise so unit positions are stable per module. */
function noise(seed: string, i: number): number {
  let h = 2166136261;
  const s = `${seed}:${i}`;
  for (let k = 0; k < s.length; k += 1) {
    h ^= s.charCodeAt(k);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

export function liveMapModel(module: DeliveryModule): LiveMapModel {
  const o = moduleObservation(module);
  const twin = moduleTwin(module);
  const couriers = o.couriersActive ?? 0;

  const zones: MapZone[] = ZONE_LAYOUT.map((z, i) => {
    const demandIndex = Math.round((0.35 + noise(module + "d", i) * 0.6) * 100) / 100;
    return {
      ...z,
      demandIndex,
      couriers: Math.max(3, Math.round((couriers / ZONE_LAYOUT.length) * (0.6 + demandIndex))),
      openRequests: Math.round(((o.parcelsAwaiting ?? 0) / ZONE_LAYOUT.length) * (0.5 + demandIndex)),
      avgEtaMinutes: Math.round(o.avgDeliveryMinutes * (0.7 + demandIndex * 0.6)),
      surge: demandIndex > 0.75,
    };
  });

  const unitCount = 18;
  const kinds: MapUnit["kind"][] = ["courier", "vehicle", "pickup"];
  const units: MapUnit[] = Array.from({ length: unitCount }, (_, i) => {
    const zone = zones[i % zones.length];
    const kind = kinds[i % kinds.length];
    const status: MapUnit["status"] =
      noise(module + "s", i) > 0.86 ? "delayed" : noise(module + "s", i) > 0.62 ? "loading" : noise(module + "s", i) > 0.2 ? "moving" : "idle";
    return {
      id: `${module}-u${i}`,
      kind,
      label: kind === "pickup" ? `Pickup #${1200 + i}` : kind === "vehicle" ? `Vehicle KDA ${300 + i}F` : `Courier #${40 + i}`,
      x: Math.round((zone.x + (noise(module + "x", i) - 0.5) * 16) * 10) / 10,
      y: Math.round((zone.y + (noise(module + "y", i) - 0.5) * 14) * 10) / 10,
      status,
    };
  });

  const hubs: MapUnit[] = [
    { id: "hub-embakasi", kind: "hub", label: "Embakasi Hub", x: 76, y: 70, status: "loading" },
    { id: "depot-industrial", kind: "depot", label: "Industrial Depot", x: 52, y: 84, status: "idle" },
    { id: "hub-westlands", kind: "hub", label: "Westlands Micro-hub", x: 27, y: 27, status: "moving" },
  ];

  const routes: MapRoute[] = [
    {
      id: "r1", from: "Industrial Depot", to: "CBD",
      points: [{ x: 52, y: 84 }, { x: 54, y: 70 }, { x: 50, y: 52 }],
      etaMinutes: Math.round(o.avgDeliveryMinutes * 0.5), risk: twin.environment.trafficIndex > 0.5 ? "high" : "medium",
    },
    {
      id: "r2", from: "Westlands Micro-hub", to: "Eastlands",
      points: [{ x: 27, y: 27 }, { x: 46, y: 44 }, { x: 72, y: 60 }],
      etaMinutes: Math.round(o.avgDeliveryMinutes * 0.8), risk: "medium",
    },
    {
      id: "r3", from: "Embakasi Hub", to: "Karen / Langata",
      points: [{ x: 76, y: 70 }, { x: 52, y: 74 }, { x: 24, y: 72 }],
      etaMinutes: Math.round(o.avgDeliveryMinutes * 0.95), risk: "low",
    },
  ];

  return {
    zones,
    units: [...units, ...hubs],
    routes,
    trafficIndex: twin.environment.trafficIndex,
    weatherIndex: twin.environment.weatherIndex,
    heat: zones.map((z) => ({ x: z.x, y: z.y, intensity: z.demandIndex })),
  };
}

/* ------------------------------------------------------------ AI dispatch */

export interface AiRecommendation {
  id: string;
  kind: "consolidation" | "reassignment" | "weather" | "route" | "capacity" | "pricing" | "risk";
  title: string;
  detail: string;
  impact: string;
  confidence: number;
  severity: "info" | "warning" | "critical";
}

export function aiRecommendations(module: DeliveryModule): AiRecommendation[] {
  const o = moduleObservation(module);
  const twin = moduleTwin(module);
  const anomalies: LogisticsAnomaly[] = detectAnomalies(o, twin);
  const forecast: CapacityForecast[] = forecastCapacity(o, twin);
  const map = liveMapModel(module);
  const hottest = [...map.zones].sort((a, b) => b.demandIndex - a.demandIndex)[0];
  const coldest = [...map.zones].sort((a, b) => a.demandIndex - b.demandIndex)[0];

  const consolidatable = Math.round((o.parcelsAwaiting ?? 0) * 0.11);
  const routeSaveMinutes = Math.round(twin.environment.networkDelayMinutes * 0.42);

  const out: AiRecommendation[] = [
    {
      id: "consolidate",
      kind: "consolidation",
      title: `${consolidatable} deliveries can be consolidated`,
      detail: `${consolidatable} awaiting parcels share a drop corridor in ${hottest.name}. Merging them into ${Math.max(1, Math.round(consolidatable / 4))} multi-stop runs removes duplicate trips.`,
      impact: `≈ KES ${(consolidatable * o.costPerParcelKes * 0.28).toLocaleString("en-KE", { maximumFractionDigits: 0 })} saved today`,
      confidence: 0.88,
      severity: "info",
    },
    {
      id: "reassign",
      kind: "reassignment",
      title: `Rebalance couriers from ${coldest.name} to ${hottest.name}`,
      detail: `${coldest.name} is running ${coldest.couriers} couriers against ${coldest.openRequests} open requests while ${hottest.name} holds ${hottest.openRequests}. Move ${Math.max(2, Math.round(coldest.couriers * 0.15))} units.`,
      impact: `ETA in ${hottest.name} improves by ~${Math.round(hottest.avgEtaMinutes * 0.14)} min`,
      confidence: 0.81,
      severity: "warning",
    },
    {
      id: "route",
      kind: "route",
      title: `Route optimisation saves ${routeSaveMinutes} minutes`,
      detail: `Re-sequencing the ${map.routes.length} active corridors around the ${Math.round(twin.environment.trafficIndex * 100)}% congestion index shortens total drive time.`,
      impact: `${routeSaveMinutes} min recovered · ${Math.round(routeSaveMinutes * 0.36)} kg CO₂e avoided`,
      confidence: 0.76,
      severity: "info",
    },
  ];

  if (twin.environment.weatherIndex > 0.25) {
    out.push({
      id: "weather",
      kind: "weather",
      title: "Rain forecast may delay the western corridor",
      detail: `Weather index at ${Math.round(twin.environment.weatherIndex * 100)}% over Westlands / Karen. Two-wheel assignments there carry elevated delay risk for the next two dispatch windows.`,
      impact: `${Math.round((o.parcelsInTransit ?? 0) * 0.06)} parcels at risk of SLA slip`,
      confidence: 0.72,
      severity: "warning",
    });
  }

  for (const f of forecast) {
    if (f.shortfall > 0) {
      out.push({
        id: `capacity-${f.window}`,
        kind: "capacity",
        title: `Capacity shortfall in the ${f.window.replace("next_", "next ")} window`,
        detail: f.recommendation,
        impact: `${f.shortfall} units of unmet demand · utilisation ${Math.round(f.utilisation * 100)}%`,
        confidence: f.confidence,
        severity: f.utilisation > 1.2 ? "critical" : "warning",
      });
    }
  }

  for (const a of anomalies.slice(0, 3)) {
    out.push({
      id: `anomaly-${a.kind}-${a.subject}`,
      kind: "risk",
      title: `${a.subject}: ${a.kind.replace(/_/g, " ")}`,
      detail: `${a.detail}. ${a.recommendedAction}.`,
      impact: `Likelihood ${Math.round(a.likelihood * 100)}%`,
      confidence: a.likelihood,
      severity: a.severity === "critical" ? "critical" : a.severity === "high" ? "warning" : "info",
    });
  }

  return out;
}

/* ---------------------------------------------------------- lifecycle */

export interface LifecycleStage {
  key: string;
  label: string;
  owner: string;
  timestamp: string;
  evidence: string;
  state: "done" | "active" | "pending";
}

const BASE_LIFECYCLE: Array<Omit<LifecycleStage, "state">> = [
  { key: "requested", label: "Pickup requested", owner: "Customer portal / API", timestamp: "08:04", evidence: "Order payload + cost centre" },
  { key: "assigned", label: "Driver assigned", owner: "AI dispatcher", timestamp: "08:07", evidence: "Assignment score + ETA model" },
  { key: "verified", label: "Identity verified", owner: "Courier app", timestamp: "08:21", evidence: "ID scan + face match" },
  { key: "collected", label: "Parcel collected", owner: "Courier #42", timestamp: "08:26", evidence: "Photo + weight capture" },
  { key: "hub", label: "Distribution hub", owner: "Embakasi Hub", timestamp: "09:02", evidence: "Cross-dock scan" },
  { key: "transit", label: "In transit", owner: "Vehicle KDA 312F", timestamp: "09:18", evidence: "GPS breadcrumb trail" },
  { key: "out", label: "Out for delivery", owner: "Courier #61", timestamp: "10:44", evidence: "Final-mile manifest" },
  { key: "otp", label: "Recipient OTP", owner: "Recipient", timestamp: "11:09", evidence: "6-digit OTP + timestamp" },
  { key: "delivered", label: "Delivered", owner: "Courier #61", timestamp: "11:10", evidence: "Signature capture" },
  { key: "pod", label: "Proof of delivery uploaded", owner: "Courier app", timestamp: "11:11", evidence: "Photo + QR confirmation" },
  { key: "rated", label: "Customer rated", owner: "Customer", timestamp: "11:26", evidence: "CSAT 5/5 + notes" },
  { key: "archive", label: "Archived to audit ledger", owner: "Chain of custody", timestamp: "11:27", evidence: "Hash-chained record" },
];

export function lifecycleStages(module: DeliveryModule): LifecycleStage[] {
  const activeIndex = module === "courier" ? 8 : module === "logistics" ? 5 : module === "fleet" ? 6 : 7;
  return BASE_LIFECYCLE.map((s, i) => ({
    ...s,
    state: i < activeIndex ? "done" : i === activeIndex ? "active" : "pending",
  }));
}

/* ---------------------------------------------------------------- SLA */

export type SlaTierId = "critical" | "high" | "standard" | "economy";

export interface SlaTier {
  id: SlaTierId;
  label: string;
  window: string;
  compliancePct: number;
  breaches: number;
  timeRemainingMinutes: number;
  exposureKes: number;
  volume: number;
}

export function slaTiers(module: DeliveryModule): SlaTier[] {
  const o = moduleObservation(module);
  const base = o.carrierOnTimePct;
  const vol = o.parcelsInTransit ?? 0;
  const rows: Array<[SlaTierId, string, string, number, number, number]> = [
    ["critical", "Critical", "≤ 60 min", base + 3.4, 0.06, 0.9],
    ["high", "High", "≤ 3 h", base + 1.1, 0.18, 0.55],
    ["standard", "Standard", "same day", base - 0.9, 0.46, 0.3],
    ["economy", "Economy", "≤ 48 h", base - 3.2, 0.3, 0.12],
  ];
  return rows.map(([id, label, window, compliance, share, exposureWeight]) => {
    const volume = Math.round(vol * share);
    const compliancePct = pct1(Math.min(99.6, compliance));
    const breaches = Math.max(0, Math.round((volume * (100 - compliancePct)) / 100));
    return {
      id, label, window, compliancePct, breaches, volume,
      timeRemainingMinutes: id === "critical" ? 18 : id === "high" ? 84 : id === "standard" ? 246 : 1180,
      exposureKes: Math.round(breaches * o.costPerParcelKes * (1 + exposureWeight * 4)),
    };
  });
}

/* ------------------------------------------------------------- pricing */

export interface PricingInput {
  distanceKm: number;
  weightKg: number;
  priority: SlaTierId;
  insuredValueKes: number;
  waitingMinutes: number;
  enterprise: boolean;
}

export interface PricingLine {
  label: string;
  amountKes: number;
  note: string;
}

export interface PricingQuote {
  lines: PricingLine[];
  subtotalKes: number;
  discountKes: number;
  totalKes: number;
  savingsNote: string;
}

const PRIORITY_MULTIPLIER: Record<SlaTierId, number> = { critical: 1.85, high: 1.4, standard: 1, economy: 0.82 };

const MODULE_PRICING_BASE: Record<DeliveryModule, { pickup: number; perKm: number; perKg: number }> = {
  package: { pickup: 180, perKm: 42, perKg: 18 },
  courier: { pickup: 250, perKm: 55, perKg: 12 },
  fleet: { pickup: 900, perKm: 96, perKg: 6 },
  logistics: { pickup: 1600, perKm: 128, perKg: 4 },
};

export function priceDelivery(module: DeliveryModule, input: PricingInput): PricingQuote {
  const b = MODULE_PRICING_BASE[module];
  const twin = moduleTwin(module);
  const mult = PRIORITY_MULTIPLIER[input.priority];

  const distance = Math.round(input.distanceKm * b.perKm);
  const weight = Math.round(input.weightKg * b.perKg);
  const priority = Math.round((b.pickup + distance + weight) * (mult - 1));
  const insurance = Math.round(input.insuredValueKes * 0.008);
  const waiting = Math.round(input.waitingMinutes * 12);
  const fuel = Math.round(distance * 0.09);
  const congestion = Math.round(distance * twin.environment.trafficIndex * 0.12);

  const lines: PricingLine[] = [
    { label: "Base pickup", amountKes: b.pickup, note: `${module} network base fee` },
    { label: "Distance", amountKes: distance, note: `${input.distanceKm} km × KES ${b.perKm}/km` },
    { label: "Weight", amountKes: weight, note: `${input.weightKg} kg × KES ${b.perKg}/kg` },
    { label: "Priority", amountKes: priority, note: `${input.priority} tier ×${mult}` },
    { label: "Insurance", amountKes: insurance, note: `0.8% of KES ${input.insuredValueKes.toLocaleString()} declared value` },
    { label: "Waiting time", amountKes: waiting, note: `${input.waitingMinutes} min × KES 12/min` },
    { label: "Fuel adjustment", amountKes: fuel, note: "Indexed weekly to pump price" },
    { label: "Congestion adjustment", amountKes: congestion, note: `Traffic index ${Math.round(twin.environment.trafficIndex * 100)}%` },
  ];

  const subtotalKes = lines.reduce((s, l) => s + l.amountKes, 0);
  const discountRate = input.enterprise ? 0.12 : 0;
  const discountKes = Math.round(subtotalKes * discountRate);
  const consolidationSaving = Math.round(subtotalKes * 0.06);

  return {
    lines,
    subtotalKes,
    discountKes,
    totalKes: subtotalKes - discountKes,
    savingsNote: input.enterprise
      ? `Enterprise contract discount 12% applied · consolidated routing avoids a further ≈ KES ${consolidationSaving.toLocaleString()}`
      : `Enterprise contracts unlock 12% off and consolidated routing worth ≈ KES ${consolidationSaving.toLocaleString()}`,
  };
}

/* ---------------------------------------------------------- governance */

export type GovernanceState = "verified" | "pending" | "expiring" | "expired";

export interface GovernanceCheck {
  id: string;
  label: string;
  state: GovernanceState;
  coveragePct: number;
  detail: string;
}

export function governanceChecks(module: DeliveryModule): GovernanceCheck[] {
  const rows: Array<[string, string, GovernanceState, number, string]> = [
    ["kyc", "KYC status", "verified", 98, "Operator + director KYC complete"],
    ["identity", "Identity verification", "verified", 99, "ID/passport matched against IPRS"],
    ["conduct", "Criminal background check", module === "courier" ? "verified" : "pending", 94, "Good Conduct certificate ≤ 12 months"],
    ["licence", "Driving licence", "verified", 97, "NTSA validity checked nightly"],
    ["inspection", "Vehicle inspection", "expiring", 89, "12 vehicles due within 30 days"],
    ["insurance", "Insurance", "verified", 96, "Goods-in-transit + PSV cover active"],
    ["registration", "Business registration", "verified", 100, "BRS extract + CR12 on file"],
    ["tax", "Tax compliance", module === "logistics" ? "expiring" : "verified", 93, "KRA TCC renewal tracked"],
    ["permit", "Permit validity", "verified", 95, "County + TLB permits current"],
    ["contract", "Contract status", "verified", 100, "Framework agreement signed"],
    ["training", "Training certification", "pending", 87, "Handling + safety modules"],
    ["dataprotection", "Data protection", "verified", 100, "ODPC registration current"],
  ];
  return rows.map(([id, label, state, coveragePct, detail]) => ({ id, label, state, coveragePct, detail }));
}

/* ------------------------------------------------------- fleet & cargo */

export interface FleetAsset {
  id: string;
  type: string;
  capacity: string;
  payloadKg: number;
  refrigerated: boolean;
  hazmat: boolean;
  fuel: string;
  utilisationPct: number;
  maintenance: "ok" | "due" | "overdue";
  revenuePerAssetKes: number;
  costPerKmKes: number;
  assigned: number;
  available: number;
}

const FLEET_LIBRARY: Record<DeliveryModule, FleetAsset[]> = {
  package: [
    { id: "moto", type: "Motorbike", capacity: "≤ 30 kg", payloadKg: 30, refrigerated: false, hazmat: false, fuel: "Petrol", utilisationPct: 82, maintenance: "ok", revenuePerAssetKes: 8600, costPerKmKes: 14, assigned: 92, available: 18 },
    { id: "ebike", type: "E-bike", capacity: "≤ 25 kg", payloadKg: 25, refrigerated: false, hazmat: false, fuel: "Electric", utilisationPct: 74, maintenance: "ok", revenuePerAssetKes: 7100, costPerKmKes: 6, assigned: 41, available: 12 },
    { id: "compact", type: "Compact car", capacity: "≤ 100 kg", payloadKg: 100, refrigerated: false, hazmat: false, fuel: "Petrol", utilisationPct: 68, maintenance: "due", revenuePerAssetKes: 15400, costPerKmKes: 31, assigned: 26, available: 9 },
    { id: "pickup", type: "Pickup", capacity: "≤ 500 kg", payloadKg: 500, refrigerated: false, hazmat: false, fuel: "Diesel", utilisationPct: 63, maintenance: "ok", revenuePerAssetKes: 24800, costPerKmKes: 44, assigned: 9, available: 3 },
  ],
  courier: [
    { id: "bicycle", type: "Bicycle", capacity: "≤ 10 kg", payloadKg: 10, refrigerated: false, hazmat: false, fuel: "Human", utilisationPct: 58, maintenance: "ok", revenuePerAssetKes: 3200, costPerKmKes: 2, assigned: 18, available: 8 },
    { id: "ebike", type: "E-bike", capacity: "≤ 25 kg", payloadKg: 25, refrigerated: false, hazmat: false, fuel: "Electric", utilisationPct: 88, maintenance: "ok", revenuePerAssetKes: 7400, costPerKmKes: 6, assigned: 96, available: 14 },
    { id: "moto", type: "Motorbike 125–250cc", capacity: "≤ 30 kg", payloadKg: 30, refrigerated: false, hazmat: false, fuel: "Petrol", utilisationPct: 85, maintenance: "due", revenuePerAssetKes: 9100, costPerKmKes: 14, assigned: 84, available: 16 },
    { id: "cargobike", type: "Cargo bike", capacity: "≤ 60 kg", payloadKg: 60, refrigerated: true, hazmat: false, fuel: "Electric", utilisationPct: 71, maintenance: "ok", revenuePerAssetKes: 8800, costPerKmKes: 8, assigned: 14, available: 6 },
  ],
  fleet: [
    { id: "sedan", type: "Sedan (PSV)", capacity: "4 pax", payloadKg: 200, refrigerated: false, hazmat: false, fuel: "Petrol", utilisationPct: 72, maintenance: "ok", revenuePerAssetKes: 19800, costPerKmKes: 28, assigned: 32, available: 11 },
    { id: "van", type: "Van", capacity: "1.2 t", payloadKg: 1200, refrigerated: false, hazmat: false, fuel: "Diesel", utilisationPct: 79, maintenance: "due", revenuePerAssetKes: 34500, costPerKmKes: 48, assigned: 28, available: 7 },
    { id: "reefer", type: "Refrigerated van", capacity: "1 t", payloadKg: 1000, refrigerated: true, hazmat: false, fuel: "Diesel", utilisationPct: 84, maintenance: "ok", revenuePerAssetKes: 46200, costPerKmKes: 62, assigned: 12, available: 3 },
    { id: "truck", type: "Truck (5 t)", capacity: "5 t", payloadKg: 5000, refrigerated: false, hazmat: true, fuel: "Diesel", utilisationPct: 69, maintenance: "overdue", revenuePerAssetKes: 82000, costPerKmKes: 96, assigned: 18, available: 5 },
  ],
  logistics: [
    { id: "t3", type: "3-tonne truck", capacity: "3 t", payloadKg: 3000, refrigerated: false, hazmat: false, fuel: "Diesel", utilisationPct: 77, maintenance: "ok", revenuePerAssetKes: 58000, costPerKmKes: 74, assigned: 34, available: 9 },
    { id: "t10", type: "10-tonne truck", capacity: "10 t", payloadKg: 10000, refrigerated: false, hazmat: true, fuel: "Diesel", utilisationPct: 81, maintenance: "due", revenuePerAssetKes: 128000, costPerKmKes: 122, assigned: 22, available: 4 },
    { id: "reefer", type: "Refrigerated van", capacity: "1.5 t", payloadKg: 1500, refrigerated: true, hazmat: false, fuel: "Diesel", utilisationPct: 88, maintenance: "ok", revenuePerAssetKes: 51000, costPerKmKes: 66, assigned: 19, available: 2 },
    { id: "hauler", type: "Container hauler", capacity: "40 ft", payloadKg: 28000, refrigerated: false, hazmat: true, fuel: "Diesel", utilisationPct: 74, maintenance: "ok", revenuePerAssetKes: 214000, costPerKmKes: 168, assigned: 11, available: 3 },
  ],
};

export function fleetAssets(module: DeliveryModule): FleetAsset[] {
  return FLEET_LIBRARY[module];
}

export interface CargoCategory {
  id: string;
  label: string;
  handling: string;
  compliance: string;
  insuranceTier: "standard" | "premium" | "high_value" | "medical" | "confidential";
}

const SHARED_CATEGORIES: CargoCategory[] = [
  { id: "documents", label: "Documents", handling: "Tamper-evident envelope", compliance: "Chain-of-custody signature", insuranceTier: "standard" },
  { id: "legal", label: "Legal & government documents", handling: "Sealed pouch, named recipient", compliance: "OTP + ID capture", insuranceTier: "confidential" },
  { id: "medical", label: "Medical supplies", handling: "Shock-protected carrier", compliance: "PPB handling log", insuranceTier: "medical" },
  { id: "pharma", label: "Pharmaceuticals", handling: "Temperature-logged", compliance: "PPB + batch traceability", insuranceTier: "medical" },
  { id: "labs", label: "Laboratory specimens", handling: "Biohazard triple-pack", compliance: "UN3373 labelling", insuranceTier: "medical" },
  { id: "cold", label: "Cold chain", handling: `${Object.keys(COLD_CHAIN_LANES).length} lanes (frozen / chilled / controlled ambient)`, compliance: "Continuous temperature audit", insuranceTier: "premium" },
  { id: "fragile", label: "Fragile goods", handling: "Double-cushion, no stacking", compliance: "Photo evidence at each hop", insuranceTier: "premium" },
  { id: "highvalue", label: "High-value items", handling: "Two-person handover", compliance: "GPS geofence + panic button", insuranceTier: "high_value" },
  { id: "electronics", label: "Electronics", handling: "Anti-static, serialised", compliance: "IMEI/serial capture", insuranceTier: "premium" },
  { id: "retail", label: "Retail orders", handling: "Batch manifest", compliance: "Returns-ready packaging", insuranceTier: "standard" },
  { id: "food", label: "Food delivery", handling: "Insulated bag, 45-min cap", compliance: "Food handler certificate", insuranceTier: "standard" },
  { id: "banking", label: "Banking items", handling: "Sealed, escorted", compliance: "Dual authorisation", insuranceTier: "high_value" },
];

const HEAVY_CATEGORIES: CargoCategory[] = [
  { id: "furniture", label: "Furniture", handling: "Blanket-wrapped, two crew", compliance: "Damage waiver", insuranceTier: "premium" },
  { id: "heavy", label: "Heavy cargo", handling: "Tail-lift / forklift", compliance: "Axle-load compliance", insuranceTier: "premium" },
  { id: "pallets", label: "Pallets", handling: "Shrink-wrapped, ISPM-15", compliance: "Pallet exchange ledger", insuranceTier: "standard" },
];

export function cargoCategories(module: DeliveryModule): CargoCategory[] {
  return module === "fleet" || module === "logistics"
    ? [...SHARED_CATEGORIES, ...HEAVY_CATEGORIES]
    : SHARED_CATEGORIES;
}

/* ------------------------------------------------------------ analytics */

export interface TrendPoint {
  label: string;
  deliveries: number;
  onTimePct: number;
  revenueKes: number;
  failed: number;
}

export function deliveryTrend(module: DeliveryModule): TrendPoint[] {
  const o = moduleObservation(module);
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return days.map((label, i) => {
    const n = noise(module + "t", i);
    const deliveries = Math.round((o.parcelsDelivered ?? 0) * (0.72 + n * 0.5) / 5);
    return {
      label,
      deliveries,
      onTimePct: pct1(o.carrierOnTimePct - 2.5 + n * 5),
      revenueKes: Math.round(deliveries * o.costPerParcelKes * 1.42),
      failed: Math.round(deliveries * (o.failedRatePct / 100) * (0.6 + n)),
    };
  });
}

export interface HourlyDemand {
  hour: string;
  requests: number;
  capacity: number;
}

export function demandCurve(module: DeliveryModule): HourlyDemand[] {
  const o = moduleObservation(module);
  const hours = ["06", "08", "10", "12", "14", "16", "18", "20"];
  const shape = [0.35, 0.9, 0.78, 0.62, 0.7, 0.98, 0.84, 0.4];
  const peak = (o.parcelsInTransit ?? 0) / 4;
  return hours.map((hour, i) => ({
    hour: `${hour}:00`,
    requests: Math.round(peak * shape[i]),
    capacity: Math.round(peak * 0.85),
  }));
}

export interface ZonePerformance {
  zone: string;
  deliveries: number;
  onTimePct: number;
  costPerParcelKes: number;
  demandIndex: number;
}

export function zonePerformance(module: DeliveryModule): ZonePerformance[] {
  const o = moduleObservation(module);
  return liveMapModel(module).zones.map((z) => ({
    zone: z.name,
    deliveries: Math.round(((o.parcelsDelivered ?? 0) / 6) * (0.6 + z.demandIndex)),
    onTimePct: pct1(o.carrierOnTimePct + (0.5 - z.demandIndex) * 6),
    costPerParcelKes: Math.round(o.costPerParcelKes * (0.85 + z.demandIndex * 0.4)),
    demandIndex: z.demandIndex,
  }));
}

/* ---------------------------------------------------------- marketplace */

export interface MarketplaceSignal {
  id: string;
  label: string;
  value: string;
  detail: string;
  trend: "up" | "down" | "flat";
}

export function marketplaceSignals(module: DeliveryModule): MarketplaceSignal[] {
  const o = moduleObservation(module);
  const map = liveMapModel(module);
  const surging = map.zones.filter((z) => z.surge).length;
  const forecast = forecastCapacity(o);
  const next4 = forecast.find((f) => f.window === "next_4h");
  return [
    { id: "drivers", label: "Driver availability", value: `${o.couriersActive ?? 0} online`, detail: `${map.zones.reduce((s, z) => s + z.couriers, 0)} positioned across ${map.zones.length} zones`, trend: "up" },
    { id: "fleet", label: "Fleet availability", value: `${(o.vehiclesTotal ?? 0) - (o.vehiclesActive ?? 0)} idle units`, detail: `${o.vehiclesActive}/${o.vehiclesTotal} deployed`, trend: "flat" },
    { id: "demand", label: "Demand heatmap", value: `${surging} surge zones`, detail: surging ? "Dynamic pricing engaged where demand index > 0.75" : "Balanced demand across all zones", trend: surging ? "up" : "flat" },
    { id: "forecast", label: "Capacity forecast (4h)", value: `${Math.round((next4?.utilisation ?? 0) * 100)}% utilisation`, detail: next4?.recommendation ?? "", trend: (next4?.shortfall ?? 0) > 0 ? "up" : "flat" },
    { id: "vehicle", label: "Recommended vehicle", value: fleetAssets(module)[1].type, detail: "Best cost-per-km against today's mission mix", trend: "flat" },
    { id: "emptyleg", label: "Empty return opportunities", value: `${Math.round((o.vehiclesActive ?? 0) * 0.14)} legs`, detail: "Backhaul capacity listed to the marketplace at 35–60% off", trend: "down" },
    { id: "shared", label: "Shared delivery pooling", value: `${Math.round((o.parcelsAwaiting ?? 0) * 0.11)} parcels`, detail: "Eligible for consolidation into multi-stop runs", trend: "up" },
    { id: "carbon", label: "Carbon savings", value: `${o.co2SavedKg.toLocaleString()} kg CO₂e`, detail: `${o.evSharePct}% of trips on electric assets`, trend: "up" },
  ];
}

/* ---------------------------------------------------------- procurement */

export interface ProcurementCapability {
  id: string;
  label: string;
  status: "live" | "configurable" | "on_request";
  detail: string;
}

export const PROCUREMENT_CAPABILITIES: ProcurementCapability[] = [
  { id: "cost_centre", label: "Cost centre allocation", status: "live", detail: "Every job tagged to a cost centre at booking time" },
  { id: "department", label: "Department billing", status: "live", detail: "Split invoices per department, branch or project" },
  { id: "statements", label: "Monthly statements", status: "live", detail: "Consolidated statement with per-line evidence" },
  { id: "po", label: "Purchase orders", status: "live", detail: "PO number capture and matching before dispatch" },
  { id: "approvals", label: "Approval workflows", status: "live", detail: "Threshold-based multi-step approval with delegation" },
  { id: "budget", label: "Budget tracking", status: "live", detail: "Reserve, consume and release against period budgets" },
  { id: "contract", label: "Contract pricing", status: "configurable", detail: "Negotiated rate cards with versioned governance" },
  { id: "branches", label: "Multi-branch accounts", status: "live", detail: "Hierarchical org with per-branch policy" },
  { id: "rbac", label: "Role-based access", status: "live", detail: "Admin, approver, requester and finance roles" },
  { id: "api", label: "API & webhooks", status: "live", detail: "REST + signed webhooks for order and status events" },
  { id: "audit", label: "Audit logs", status: "live", detail: "Hash-chained, exportable evidence trail" },
  { id: "framework", label: "Framework agreements", status: "on_request", detail: "Government and NGO tender frameworks" },
];

/* ------------------------------------------------------------ compliance */

export interface RouteComplianceSignal {
  id: string;
  label: string;
  value: string;
  state: "ok" | "watch" | "breach";
}

export function routeCompliance(module: DeliveryModule): RouteComplianceSignal[] {
  const o = moduleObservation(module);
  return [
    { id: "geofence", label: "Geofence compliance", value: "99.2%", state: "ok" },
    { id: "stops", label: "Unauthorised stops", value: `${Math.round((o.vehiclesActive ?? 0) * 0.03)} today`, state: "watch" },
    { id: "deviation", label: "Route deviations", value: `${Math.round((o.vehiclesActive ?? 0) * 0.07)}`, state: "watch" },
    { id: "speed", label: "Speed violations", value: `${Math.round((o.vehiclesActive ?? 0) * 0.02)}`, state: "ok" },
    { id: "idle", label: "Idle time", value: `${Math.round(o.avgPickupMinutes * 0.4)} min avg`, state: "ok" },
    { id: "safety", label: "Safety events", value: "0 critical", state: "ok" },
    { id: "panic", label: "Panic alerts", value: "0 open", state: "ok" },
    { id: "fatigue", label: "Driver fatigue flags", value: `${Math.round((o.couriersActive ?? 0) * 0.015)}`, state: "watch" },
    { id: "battery", label: "E-bike battery health", value: `${100 - Math.round(o.evSharePct * 0.2)}% avg`, state: "ok" },
    { id: "incidents", label: "Incident reports", value: `${Math.round((o.parcelsFailed ?? 0) * 0.1)} filed`, state: (o.parcelsFailed ?? 0) > 70 ? "watch" : "ok" },
  ];
}

/* ---------------------------------------------------------- sustainability */

export interface SustainabilityMetric {
  id: string;
  label: string;
  value: string;
  detail: string;
}

export function sustainabilityMetrics(module: DeliveryModule): SustainabilityMetric[] {
  const o = moduleObservation(module);
  return [
    { id: "co2", label: "CO₂e avoided", value: `${o.co2SavedKg.toLocaleString()} kg`, detail: "Versus single-drop baseline routing" },
    { id: "ev", label: "Electric asset share", value: `${o.evSharePct}%`, detail: "E-bikes and EV vans in today's mix" },
    { id: "green", label: "Green deliveries", value: `${Math.round((o.parcelsDelivered ?? 0) * (o.evSharePct / 100)).toLocaleString()}`, detail: "Zero-tailpipe final-mile drops" },
    { id: "fuel", label: "Fuel consumed", value: `${Math.round((o.vehiclesActive ?? 0) * 6.4).toLocaleString()} L`, detail: "Fleet-wide, telematics-derived" },
    { id: "offset", label: "Carbon offsets", value: `${Math.round(o.co2SavedKg * 0.35).toLocaleString()} kg`, detail: "Retired against verified local projects" },
    { id: "score", label: "Sustainability score", value: `${Math.min(99, 55 + o.evSharePct)}/100`, detail: "ESG-reportable composite" },
  ];
}
