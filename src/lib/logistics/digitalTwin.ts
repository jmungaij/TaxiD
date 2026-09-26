/**
 * Phase 2 — Logistics Digital Twin.
 *
 * A deterministic in-memory model of the physical logistics network: hubs,
 * warehouses, distribution centers, vehicles, couriers, parcels, routes and
 * the environmental signals (weather, traffic) that perturb them.
 *
 * The twin is *derived* from the platform's own knowledge graph concepts —
 * it does not create a parallel model, it projects live counters onto the
 * capability registry so operations, prediction and the copilot all reason
 * against one state.
 */
import { ELOS_CAPABILITIES } from "./elos";

export const TWIN_VERSION = "1.0.0";

export type TwinEntityKind =
  | "hub" | "warehouse" | "distribution_center" | "vehicle" | "courier"
  | "parcel" | "route" | "order" | "customer" | "inventory_position";

export type TwinCondition = "nominal" | "strained" | "degraded" | "failed";

export interface TwinNode {
  id: string;
  kind: TwinEntityKind;
  label: string;
  /** Utilisation of the node's capacity, 0-1. */
  utilisation: number;
  capacity: number;
  load: number;
  condition: TwinCondition;
  /** Capability ids this node is governed by. */
  capabilities: string[];
  region: string;
}

export interface TwinEdge {
  from: string;
  to: string;
  /** Lane/route relation, e.g. "linehaul", "final_mile", "assigned_to". */
  relation: string;
  /** Transit minutes under current conditions. */
  transitMinutes: number;
}

export interface TwinEnvironment {
  /** 0-1, higher means worse traffic. */
  trafficIndex: number;
  /** 0-1, higher means worse weather. */
  weatherIndex: number;
  /** Minutes of accumulated network delay. */
  networkDelayMinutes: number;
}

/** Live counters the twin is hydrated from. Missing values fall back to zero. */
export interface TwinObservation {
  regions?: Array<{ id: string; name: string }>;
  parcelsInTransit?: number;
  parcelsAwaiting?: number;
  parcelsDelivered?: number;
  parcelsFailed?: number;
  coldChainParcels?: number;
  vehiclesActive?: number;
  vehiclesTotal?: number;
  couriersActive?: number;
  ordersOpen?: number;
  trafficIndex?: number;
  weatherIndex?: number;
}

export interface TwinSnapshot {
  version: string;
  generatedAt: string;
  nodes: TwinNode[];
  edges: TwinEdge[];
  environment: TwinEnvironment;
  /** Aggregate network health, 0-100. */
  health: number;
  bottlenecks: Array<{ nodeId: string; label: string; utilisation: number; reason: string }>;
  /** Nodes whose failure would cascade across the network. */
  criticalPath: string[];
}

function condition(utilisation: number): TwinCondition {
  if (utilisation >= 1) return "failed";
  if (utilisation >= 0.9) return "degraded";
  if (utilisation >= 0.75) return "strained";
  return "nominal";
}

function node(
  id: string, kind: TwinEntityKind, label: string, load: number, capacity: number,
  capabilities: string[], region: string,
): TwinNode {
  const safeCapacity = capacity > 0 ? capacity : 1;
  const utilisation = Math.round((load / safeCapacity) * 100) / 100;
  return { id, kind, label, capacity: safeCapacity, load, utilisation, condition: condition(utilisation), capabilities, region };
}

const CAP_IDS = new Set(ELOS_CAPABILITIES.map((c) => c.id));
const cap = (...ids: string[]) => ids.filter((id) => CAP_IDS.has(id));

/**
 * Build the twin from observed counters. Deterministic: the same observation
 * always produces the same snapshot (aside from `generatedAt`).
 */
export function buildTwin(obs: TwinObservation = {}, now: Date = new Date()): TwinSnapshot {
  const regions = obs.regions?.length ? obs.regions : [{ id: "default", name: "National" }];
  const inTransit = obs.parcelsInTransit ?? 0;
  const awaiting = obs.parcelsAwaiting ?? 0;
  const vehiclesActive = obs.vehiclesActive ?? 0;
  const vehiclesTotal = Math.max(obs.vehiclesTotal ?? 0, vehiclesActive);
  const couriers = obs.couriersActive ?? vehiclesActive;
  const ordersOpen = obs.ordersOpen ?? awaiting;
  const trafficIndex = Math.min(1, Math.max(0, obs.trafficIndex ?? 0.35));
  const weatherIndex = Math.min(1, Math.max(0, obs.weatherIndex ?? 0.2));

  const perRegion = Math.max(1, Math.round((inTransit + awaiting) / regions.length));
  const nodes: TwinNode[] = [];
  const edges: TwinEdge[] = [];

  for (const r of regions) {
    const hubId = `hub:${r.id}`;
    const whId = `wh:${r.id}`;
    const dcId = `dc:${r.id}`;
    nodes.push(node(hubId, "hub", `${r.name} Hub`, perRegion, Math.max(50, perRegion * 1.3), cap("national_hub_network", "cross_docking"), r.name));
    nodes.push(node(whId, "warehouse", `${r.name} Warehouse`, Math.round(awaiting / regions.length), Math.max(40, Math.round(awaiting / regions.length * 1.25)), cap("warehouses", "inventory", "warehouse_intelligence"), r.name));
    nodes.push(node(dcId, "distribution_center", `${r.name} DC`, Math.round(inTransit / regions.length), Math.max(40, Math.round(inTransit / regions.length * 1.4)), cap("distribution_centers", "route_optimization"), r.name));
    edges.push({ from: whId, to: hubId, relation: "linehaul", transitMinutes: Math.round(60 * (1 + trafficIndex)) });
    edges.push({ from: hubId, to: dcId, relation: "linehaul", transitMinutes: Math.round(45 * (1 + trafficIndex)) });
    edges.push({ from: dcId, to: `fleet:${r.id}`, relation: "final_mile", transitMinutes: Math.round(35 * (1 + trafficIndex + weatherIndex / 2)) });
    nodes.push(node(`fleet:${r.id}`, "vehicle", `${r.name} Fleet`, Math.round(inTransit / regions.length), Math.max(1, Math.round((vehiclesActive || 1) / regions.length) * 8), cap("vehicle_capacity", "fleet_dispatch"), r.name));
  }

  nodes.push(node("courier:network", "courier", "Courier Network", inTransit, Math.max(1, couriers * 10), cap("courier_network", "driver_logistics"), "National"));
  nodes.push(node("parcel:pipeline", "parcel", "Parcel Pipeline", inTransit + awaiting, Math.max(1, (vehiclesTotal || 1) * 30), cap("parcel_tracking", "eta_prediction"), "National"));
  nodes.push(node("route:plan", "route", "Active Route Plan", inTransit, Math.max(1, couriers * 12), cap("dynamic_routing", "route_optimization"), "National"));
  nodes.push(node("order:book", "order", "Open Order Book", ordersOpen, Math.max(1, (couriers || 1) * 14), cap("corporate_logistics", "marketplace_logistics"), "National"));
  nodes.push(node("cold:lane", "inventory_position", "Cold Chain Lane", obs.coldChainParcels ?? 0, Math.max(10, Math.round((obs.coldChainParcels ?? 0) * 1.2) || 10), cap("cold_chain"), "National"));

  const bottlenecks = nodes
    .filter((n) => n.utilisation >= 0.75)
    .sort((a, b) => b.utilisation - a.utilisation)
    .map((n) => ({
      nodeId: n.id,
      label: n.label,
      utilisation: n.utilisation,
      reason: n.condition === "failed"
        ? "Capacity exhausted — work is queuing with no headroom"
        : n.condition === "degraded"
          ? "Above 90% utilisation — SLA breach imminent"
          : "Above 75% utilisation — reduced absorption of demand spikes",
    }));

  const avgUtil = nodes.reduce((s, n) => s + Math.min(1, n.utilisation), 0) / (nodes.length || 1);
  const envPenalty = (trafficIndex * 12) + (weatherIndex * 8);
  const health = Math.max(0, Math.min(100, Math.round(100 - avgUtil * 45 - envPenalty - bottlenecks.length * 2)));

  return {
    version: TWIN_VERSION,
    generatedAt: now.toISOString(),
    nodes,
    edges,
    environment: {
      trafficIndex,
      weatherIndex,
      networkDelayMinutes: Math.round((trafficIndex * 45 + weatherIndex * 25) * (1 + avgUtil)),
    },
    health,
    bottlenecks,
    criticalPath: nodes
      .filter((n) => ["hub", "distribution_center", "courier"].includes(n.kind) && n.utilisation >= 0.7)
      .map((n) => n.id),
  };
}

/** What-if: apply a perturbation and report the delta against the base twin. */
export interface TwinScenario {
  label: string;
  demandMultiplier?: number;
  courierDelta?: number;
  trafficIndex?: number;
  weatherIndex?: number;
}

export interface TwinScenarioResult {
  scenario: string;
  baseHealth: number;
  projectedHealth: number;
  delta: number;
  newBottlenecks: string[];
  verdict: "absorbed" | "strained" | "breached";
}

export function simulateTwin(
  obs: TwinObservation,
  scenario: TwinScenario,
  now: Date = new Date(),
): TwinScenarioResult {
  const base = buildTwin(obs, now);
  const m = scenario.demandMultiplier ?? 1;
  const projectedObs: TwinObservation = {
    ...obs,
    parcelsInTransit: Math.round((obs.parcelsInTransit ?? 0) * m),
    parcelsAwaiting: Math.round((obs.parcelsAwaiting ?? 0) * m),
    ordersOpen: Math.round((obs.ordersOpen ?? 0) * m),
    couriersActive: Math.max(0, (obs.couriersActive ?? 0) + (scenario.courierDelta ?? 0)),
    trafficIndex: scenario.trafficIndex ?? obs.trafficIndex,
    weatherIndex: scenario.weatherIndex ?? obs.weatherIndex,
  };
  const projected = buildTwin(projectedObs, now);
  const baseIds = new Set(base.bottlenecks.map((b) => b.nodeId));
  const delta = projected.health - base.health;
  return {
    scenario: scenario.label,
    baseHealth: base.health,
    projectedHealth: projected.health,
    delta,
    newBottlenecks: projected.bottlenecks.filter((b) => !baseIds.has(b.nodeId)).map((b) => b.label),
    verdict: projected.health >= 70 ? "absorbed" : projected.health >= 50 ? "strained" : "breached",
  };
}
