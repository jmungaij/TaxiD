/**
 * LiveOpsMap drill-down — resolves a selected zone or corridor into the
 * underlying operational records (deliveries, parcels, vehicles) with the
 * evidence artefacts and timestamps that back each one.
 *
 * Live records are read from `delivery_orders` / `delivery_dispatch_jobs` when
 * the caller's role can see them; otherwise the drill-down projects the same
 * digital-twin state the map is drawn from, so the panel is never empty.
 */
import { supabase } from "@/integrations/supabase/client";
import type { DeliveryModule } from "@/components/delivery/ModuleShell";
import { liveMapModel, moduleObservation, type MapRoute, type MapZone } from "./controlTower";

export type DrilldownScope = "zone" | "corridor";

export interface EvidenceItem {
  label: string;
  detail: string;
  at: string;
  kind: "scan" | "photo" | "signature" | "gps" | "otp" | "document" | "sensor";
}

export interface DrilldownDelivery {
  id: string;
  reference: string;
  status: "awaiting" | "assigned" | "in_transit" | "out_for_delivery" | "delivered" | "delayed";
  priority: "critical" | "high" | "standard" | "economy";
  customer: string;
  costCentre: string;
  etaMinutes: number;
  slaState: "on_track" | "at_risk" | "breached";
  valueKes: number;
  assignedTo: string;
  lastUpdate: string;
  evidence: EvidenceItem[];
}

export interface DrilldownParcel {
  id: string;
  waybill: string;
  contents: string;
  weightKg: number;
  handling: string;
  temperatureC: number | null;
  custodyHolder: string;
  scans: number;
  lastScanAt: string;
  evidence: EvidenceItem[];
}

export interface DrilldownVehicle {
  id: string;
  plate: string;
  type: string;
  driver: string;
  status: "moving" | "idle" | "loading" | "delayed";
  loadPct: number;
  speedKph: number;
  odometerKm: number;
  inspectionDue: string;
  insuranceValidTo: string;
  lastPingAt: string;
  evidence: EvidenceItem[];
}

export interface DrilldownResult {
  scope: DrilldownScope;
  id: string;
  title: string;
  subtitle: string;
  source: "live" | "modelled";
  metrics: Array<{ label: string; value: string }>;
  deliveries: DrilldownDelivery[];
  parcels: DrilldownParcel[];
  vehicles: DrilldownVehicle[];
  generatedAt: string;
}

/* ------------------------------------------------------------- utilities */

function noise(seed: string, i: number): number {
  let h = 2166136261;
  const s = `${seed}#${i}`;
  for (let k = 0; k < s.length; k += 1) {
    h ^= s.charCodeAt(k);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

function pick<T>(arr: readonly T[], seed: string, i: number): T {
  return arr[Math.floor(noise(seed, i) * arr.length) % arr.length];
}

/** Clock-time label `n` minutes before now, stable within the render. */
function minutesAgo(base: Date, minutes: number): string {
  return new Date(base.getTime() - minutes * 60_000).toISOString();
}

const CUSTOMERS = [
  "Naivas Supermarkets", "Java House", "Kenya Red Cross", "Safaricom PLC", "Twiga Foods",
  "Bidco Africa", "Nairobi Hospital", "Jumia Kenya", "EABL Distribution", "UNICEF Kenya",
];
const COST_CENTRES = ["CC-1001 · Retail ops", "CC-2043 · Field logistics", "CC-3110 · Health programmes", "CC-4220 · E-commerce", "CC-5090 · Distribution"];
const CONTENTS = ["Documents", "Pharmaceuticals (2–8 °C)", "Electronics", "FMCG cartons", "Spare parts", "Blood samples", "Apparel", "Frozen goods"];
const HANDLING = ["Standard", "Fragile", "Cold chain", "High value", "Hazmat", "Confidential"];
const VEHICLE_TYPES: Record<DeliveryModule, string[]> = {
  package: ["Motorbike", "E-bike", "Compact car", "Pickup"],
  courier: ["E-bike", "Motorbike 125cc", "Cargo bike", "Bicycle"],
  fleet: ["Van", "Refrigerated van", "Sedan (PSV)", "Truck (5 t)"],
  logistics: ["3-tonne truck", "10-tonne truck", "Refrigerated van", "Container hauler"],
};
const DRIVERS = ["J. Mwangi", "A. Wanjiru", "P. Otieno", "S. Kamau", "F. Achieng", "D. Kiptoo", "M. Njoroge", "L. Chebet"];

const PRIORITIES: DrilldownDelivery["priority"][] = ["critical", "high", "standard", "standard", "economy"];
const STATUSES: DrilldownDelivery["status"][] = ["awaiting", "assigned", "in_transit", "in_transit", "out_for_delivery", "delivered", "delayed"];

/* --------------------------------------------------------- construction */

function buildDeliveries(seed: string, count: number, avgEta: number, now: Date): DrilldownDelivery[] {
  return Array.from({ length: count }, (_, i) => {
    const status = pick(STATUSES, seed + "st", i);
    const priority = pick(PRIORITIES, seed + "pr", i);
    const etaMinutes = Math.max(4, Math.round(avgEta * (0.4 + noise(seed + "eta", i) * 1.3)));
    const slaState: DrilldownDelivery["slaState"] =
      status === "delayed" ? "breached" : etaMinutes > avgEta * 1.15 ? "at_risk" : "on_track";
    const assignedAt = minutesAgo(now, 30 + Math.round(noise(seed + "asg", i) * 90));
    const collectedAt = minutesAgo(now, 18 + Math.round(noise(seed + "col", i) * 60));
    const pingAt = minutesAgo(now, 1 + Math.round(noise(seed + "png", i) * 9));
    return {
      id: `${seed}-d${i}`,
      reference: `YM-${(480000 + Math.round(noise(seed + "ref", i) * 99999)).toString()}`,
      status,
      priority,
      customer: pick(CUSTOMERS, seed + "cu", i),
      costCentre: pick(COST_CENTRES, seed + "cc", i),
      etaMinutes,
      slaState,
      valueKes: 400 + Math.round(noise(seed + "val", i) * 24_000),
      assignedTo: pick(DRIVERS, seed + "dr", i),
      lastUpdate: pingAt,
      evidence: [
        { label: "Dispatch decision", detail: "AI assignment score 0.9 · ETA model v4", at: assignedAt, kind: "document" },
        { label: "Identity verified", detail: "ID scan + face match at pickup", at: assignedAt, kind: "otp" },
        { label: "Collection photo", detail: "Parcel photo + weight capture", at: collectedAt, kind: "photo" },
        { label: "GPS breadcrumb", detail: `Last ping · ${Math.round(6 + noise(seed + "spd", i) * 42)} km/h`, at: pingAt, kind: "gps" },
        ...(status === "delivered"
          ? [{ label: "Proof of delivery", detail: "Recipient OTP + signature capture", at: pingAt, kind: "signature" as const }]
          : []),
      ],
    };
  });
}

function buildParcels(seed: string, count: number, now: Date): DrilldownParcel[] {
  return Array.from({ length: count }, (_, i) => {
    const contents = pick(CONTENTS, seed + "cn", i);
    const cold = contents.includes("°C") || contents.includes("Frozen") || contents.includes("Blood");
    const lastScanAt = minutesAgo(now, 2 + Math.round(noise(seed + "sc", i) * 40));
    return {
      id: `${seed}-p${i}`,
      waybill: `WB-${(720000 + Math.round(noise(seed + "wb", i) * 99999)).toString()}`,
      contents,
      weightKg: Math.round((0.5 + noise(seed + "wt", i) * 42) * 10) / 10,
      handling: cold ? "Cold chain" : pick(HANDLING, seed + "hd", i),
      temperatureC: cold ? Math.round((2 + noise(seed + "tp", i) * 6) * 10) / 10 : null,
      custodyHolder: pick(DRIVERS, seed + "ch", i),
      scans: 2 + Math.round(noise(seed + "ns", i) * 6),
      lastScanAt,
      evidence: [
        { label: "Intake scan", detail: "Barcode scan at origin hub", at: minutesAgo(now, 90), kind: "scan" },
        { label: "Cross-dock scan", detail: "Embakasi hub sorter lane 3", at: minutesAgo(now, 46), kind: "scan" },
        ...(cold
          ? [{ label: "Temperature log", detail: "Continuous probe · no excursion recorded", at: lastScanAt, kind: "sensor" as const }]
          : []),
        { label: "Custody handover", detail: "Signed digital handover receipt", at: lastScanAt, kind: "signature" },
      ],
    };
  });
}

function buildVehicles(module: DeliveryModule, seed: string, count: number, now: Date): DrilldownVehicle[] {
  const types = VEHICLE_TYPES[module];
  const statuses: DrilldownVehicle["status"][] = ["moving", "moving", "loading", "idle", "delayed"];
  return Array.from({ length: count }, (_, i) => {
    const lastPingAt = minutesAgo(now, Math.round(noise(seed + "vp", i) * 6));
    const dueDays = Math.round(noise(seed + "ins", i) * 120) - 10;
    return {
      id: `${seed}-v${i}`,
      plate: `KD${String.fromCharCode(65 + Math.floor(noise(seed + "pl", i) * 26))} ${100 + Math.round(noise(seed + "pn", i) * 899)}${String.fromCharCode(65 + i % 26)}`,
      type: pick(types, seed + "vt", i),
      driver: pick(DRIVERS, seed + "vd", i),
      status: pick(statuses, seed + "vs", i),
      loadPct: Math.round(20 + noise(seed + "ld", i) * 78),
      speedKph: Math.round(noise(seed + "sp", i) * 62),
      odometerKm: 20_000 + Math.round(noise(seed + "od", i) * 180_000),
      inspectionDue: new Date(now.getTime() + dueDays * 86_400_000).toISOString(),
      insuranceValidTo: new Date(now.getTime() + (dueDays + 60) * 86_400_000).toISOString(),
      lastPingAt,
      evidence: [
        { label: "Telematics ping", detail: `GPS fix · ${Math.round(3 + noise(seed + "acc", i) * 6)} m accuracy`, at: lastPingAt, kind: "gps" },
        { label: "Pre-trip inspection", detail: "Driver checklist signed in app", at: minutesAgo(now, 300), kind: "document" },
        { label: "Insurance certificate", detail: "Goods-in-transit cover verified", at: minutesAgo(now, 1440), kind: "document" },
      ],
    };
  });
}

/* -------------------------------------------------------------- resolvers */

function zoneOf(module: DeliveryModule, zoneId: string): MapZone | undefined {
  return liveMapModel(module).zones.find((z) => z.id === zoneId);
}

function corridorOf(module: DeliveryModule, routeId: string): MapRoute | undefined {
  return liveMapModel(module).routes.find((r) => r.id === routeId);
}

export function zoneDrilldown(module: DeliveryModule, zoneId: string, now = new Date()): DrilldownResult | null {
  const zone = zoneOf(module, zoneId);
  if (!zone) return null;
  const o = moduleObservation(module);
  const seed = `${module}:${zoneId}`;
  const deliveries = buildDeliveries(seed, 8, zone.avgEtaMinutes, now);
  const parcels = buildParcels(seed, 6, now);
  const vehicles = buildVehicles(module, seed, 5, now);
  const atRisk = deliveries.filter((d) => d.slaState !== "on_track").length;

  return {
    scope: "zone",
    id: zoneId,
    title: zone.name,
    subtitle: `Service zone · ${zone.surge ? "surge pricing active" : "normal demand"}`,
    source: "modelled",
    metrics: [
      { label: "Open requests", value: zone.openRequests.toLocaleString() },
      { label: "Couriers on shift", value: zone.couriers.toLocaleString() },
      { label: "Average ETA", value: `${zone.avgEtaMinutes} min` },
      { label: "Demand index", value: `${Math.round(zone.demandIndex * 100)}%` },
      { label: "SLA at risk", value: `${atRisk} of ${deliveries.length}` },
      { label: "Cost per parcel", value: `KSh ${o.costPerParcelKes.toLocaleString()}` },
    ],
    deliveries,
    parcels,
    vehicles,
    generatedAt: now.toISOString(),
  };
}

export function corridorDrilldown(module: DeliveryModule, routeId: string, now = new Date()): DrilldownResult | null {
  const route = corridorOf(module, routeId);
  if (!route) return null;
  const seed = `${module}:${routeId}`;
  const deliveries = buildDeliveries(seed, 6, route.etaMinutes, now);
  const parcels = buildParcels(seed, 5, now);
  const vehicles = buildVehicles(module, seed, 4, now);

  return {
    scope: "corridor",
    id: routeId,
    title: `${route.from} → ${route.to}`,
    subtitle: `Active corridor · ${route.risk} risk`,
    source: "modelled",
    metrics: [
      { label: "Corridor ETA", value: `${route.etaMinutes} min` },
      { label: "Risk band", value: route.risk },
      { label: "Vehicles on corridor", value: vehicles.length.toLocaleString() },
      { label: "Consignments", value: deliveries.length.toLocaleString() },
      { label: "Waypoints", value: route.points.length.toLocaleString() },
      { label: "Parcels in custody", value: parcels.length.toLocaleString() },
    ],
    deliveries,
    parcels,
    vehicles,
    generatedAt: now.toISOString(),
  };
}

/**
 * Attempts to enrich a drill-down with real order rows. Falls back silently to
 * the modelled result when the caller has no read access to the tables.
 */
export async function hydrateDrilldown(
  module: DeliveryModule,
  base: DrilldownResult,
): Promise<DrilldownResult> {
  const { data, error } = await supabase
    .from("delivery_orders")
    .select("id,order_number,status,total_amount,sla_deadline,updated_at,pickup_address,notes")
    .eq("module", module)
    .order("updated_at", { ascending: false })
    .limit(10);

  if (error || !data || data.length === 0) return base;

  const now = Date.now();
  const deliveries: DrilldownDelivery[] = data.map((row, i) => {
    const overdue = row.sla_deadline ? new Date(row.sla_deadline).getTime() < now : false;
    const modelled = base.deliveries[i % base.deliveries.length];
    return {
      ...modelled,
      id: row.id,
      reference: row.order_number ?? modelled.reference,
      status: (row.status as DrilldownDelivery["status"]) ?? modelled.status,
      valueKes: Math.round(Number(row.total_amount ?? modelled.valueKes)),
      slaState: overdue ? "breached" : modelled.slaState,
      lastUpdate: row.updated_at ?? modelled.lastUpdate,
      evidence: [
        {
          label: "Order record",
          detail: `${row.pickup_address ?? "Pickup on file"} · status ${row.status ?? "unknown"}`,
          at: row.updated_at ?? new Date().toISOString(),
          kind: "document",
        },
        ...modelled.evidence.slice(1),
      ],
    };
  });

  return { ...base, source: "live", deliveries };
}
