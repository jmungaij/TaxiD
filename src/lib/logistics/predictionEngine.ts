/**
 * Phase 3 — Logistics Prediction Engine.
 *
 * Deterministic, explainable predictors wired into the routing and dispatch
 * flow: ETA prediction, capacity/demand forecasting and anomaly detection.
 * Every prediction carries features, confidence and a human-readable
 * rationale so the AI governance layer can certify it.
 */
import { buildTwin, type TwinObservation, type TwinSnapshot } from "./digitalTwin";

export const PREDICTION_ENGINE_VERSION = "1.0.0";
export const ETA_MODEL_ID = "eta.logistics.v1";

export interface EtaInput {
  /** Straight-line or planned distance in km. */
  distanceKm: number;
  /** Remaining stops on the route before this drop. */
  stopsRemaining: number;
  /** Service line: express compresses handling time. */
  serviceType?: "express" | "standard" | "economy" | "cold_chain";
  /** 0-1 traffic index; defaults to the twin environment. */
  trafficIndex?: number;
  /** 0-1 weather index; defaults to the twin environment. */
  weatherIndex?: number;
  /** Current hub/DC utilisation 0-1 — drives handling delay. */
  hubUtilisation?: number;
  /** Historical courier on-time rate, 0-1. */
  courierOnTimeRate?: number;
}

export interface EtaPrediction {
  modelId: string;
  /** Predicted minutes to delivery. */
  etaMinutes: number;
  /** p10/p90 confidence band in minutes. */
  lowerMinutes: number;
  upperMinutes: number;
  /** 0-1 model confidence. */
  confidence: number;
  features: Array<{ name: string; value: number; contributionMinutes: number }>;
  rationale: string;
}

const SERVICE_HANDLING: Record<NonNullable<EtaInput["serviceType"]>, number> = {
  express: 6,
  standard: 12,
  economy: 18,
  cold_chain: 15,
};

const BASE_SPEED_KMH = 26; // urban Kenyan corridor baseline

/** Predict arrival for a single drop. Pure and deterministic. */
export function predictEta(input: EtaInput): EtaPrediction {
  const traffic = Math.min(1, Math.max(0, input.trafficIndex ?? 0.35));
  const weather = Math.min(1, Math.max(0, input.weatherIndex ?? 0.2));
  const hubUtil = Math.min(1.2, Math.max(0, input.hubUtilisation ?? 0.6));
  const onTime = Math.min(1, Math.max(0.4, input.courierOnTimeRate ?? 0.9));
  const service = input.serviceType ?? "standard";

  const effectiveSpeed = BASE_SPEED_KMH * (1 - traffic * 0.45) * (1 - weather * 0.2);
  const travel = (Math.max(0, input.distanceKm) / Math.max(6, effectiveSpeed)) * 60;
  const stops = Math.max(0, input.stopsRemaining) * SERVICE_HANDLING[service] * 0.65;
  const handling = SERVICE_HANDLING[service];
  const hubDelay = hubUtil > 0.75 ? (hubUtil - 0.75) * 90 : 0;
  const courierDrag = (1 - onTime) * 40;

  const eta = travel + stops + handling + hubDelay + courierDrag;
  // Confidence degrades with environmental noise and queue depth.
  const noise = traffic * 0.25 + weather * 0.15 + Math.max(0, hubUtil - 0.75) * 0.4 + (1 - onTime) * 0.3;
  const confidence = Math.max(0.35, Math.min(0.97, 1 - noise));
  const spread = eta * (1 - confidence) * 1.4;

  return {
    modelId: ETA_MODEL_ID,
    etaMinutes: Math.round(eta),
    lowerMinutes: Math.max(1, Math.round(eta - spread)),
    upperMinutes: Math.round(eta + spread),
    confidence: Math.round(confidence * 100) / 100,
    features: [
      { name: "travel", value: Math.round(input.distanceKm * 10) / 10, contributionMinutes: Math.round(travel) },
      { name: "stops_remaining", value: input.stopsRemaining, contributionMinutes: Math.round(stops) },
      { name: "service_handling", value: handling, contributionMinutes: handling },
      { name: "hub_utilisation", value: Math.round(hubUtil * 100) / 100, contributionMinutes: Math.round(hubDelay) },
      { name: "courier_on_time_rate", value: Math.round(onTime * 100) / 100, contributionMinutes: Math.round(courierDrag) },
      { name: "traffic_index", value: Math.round(traffic * 100) / 100, contributionMinutes: 0 },
      { name: "weather_index", value: Math.round(weather * 100) / 100, contributionMinutes: 0 },
    ],
    rationale:
      `${Math.round(travel)} min travel at ${Math.round(effectiveSpeed)} km/h effective speed, ` +
      `${Math.round(stops)} min across ${input.stopsRemaining} preceding stops, ` +
      `${handling} min ${service} handling` +
      (hubDelay > 0 ? `, +${Math.round(hubDelay)} min hub congestion` : "") +
      (courierDrag > 1 ? `, +${Math.round(courierDrag)} min courier reliability drag` : "") + ".",
  };
}

/* ------------------------------------------------------------------ */
/* Evaluation — published metrics for enterprise certification         */
/* ------------------------------------------------------------------ */

export interface EtaObservationPair {
  predictedMinutes: number;
  actualMinutes: number;
  /** Promised SLA window in minutes, used for on-time attribution. */
  promisedMinutes?: number;
}

export interface EtaEvaluation {
  modelId: string;
  samples: number;
  /** Mean absolute error, minutes. */
  mae: number;
  /** 90th percentile absolute error, minutes. */
  p90AbsoluteError: number;
  /** Mean absolute percentage error. */
  mape: number;
  /** Share of predictions within ±10 minutes. */
  within10MinPct: number;
  /** Share of deliveries inside the promised window. */
  promiseAttainmentPct: number;
  /** Systematic optimism (negative) or pessimism (positive), minutes. */
  bias: number;
  /** Certification verdict against the published thresholds. */
  passed: boolean;
  thresholds: { maeMax: number; p90Max: number; within10MinPctMin: number };
  findings: string[];
}

export const ETA_THRESHOLDS = { maeMax: 12, p90Max: 30, within10MinPctMin: 70 };

export function evaluateEta(pairs: EtaObservationPair[]): EtaEvaluation {
  const findings: string[] = [];
  if (pairs.length === 0) {
    return {
      modelId: ETA_MODEL_ID, samples: 0, mae: 0, p90AbsoluteError: 0, mape: 0,
      within10MinPct: 0, promiseAttainmentPct: 0, bias: 0, passed: false,
      thresholds: ETA_THRESHOLDS, findings: ["No evaluation samples — model cannot be certified"],
    };
  }
  const errors = pairs.map((p) => p.predictedMinutes - p.actualMinutes);
  const abs = errors.map(Math.abs).sort((a, b) => a - b);
  const mae = abs.reduce((a, b) => a + b, 0) / abs.length;
  const p90 = abs[Math.min(abs.length - 1, Math.floor(abs.length * 0.9))];
  const mape =
    pairs.reduce((s, p) => s + Math.abs(p.predictedMinutes - p.actualMinutes) / Math.max(1, p.actualMinutes), 0) /
    pairs.length * 100;
  const within10 = (abs.filter((e) => e <= 10).length / abs.length) * 100;
  const promised = pairs.filter((p) => p.promisedMinutes != null);
  const promiseAttainment = promised.length
    ? (promised.filter((p) => p.actualMinutes <= (p.promisedMinutes as number)).length / promised.length) * 100
    : 100;
  const bias = errors.reduce((a, b) => a + b, 0) / errors.length;

  const round = (n: number) => Math.round(n * 10) / 10;
  if (mae > ETA_THRESHOLDS.maeMax) findings.push(`MAE ${round(mae)} min exceeds ${ETA_THRESHOLDS.maeMax} min threshold`);
  if (p90 > ETA_THRESHOLDS.p90Max) findings.push(`p90 error ${round(p90)} min exceeds ${ETA_THRESHOLDS.p90Max} min threshold`);
  if (within10 < ETA_THRESHOLDS.within10MinPctMin) findings.push(`Only ${round(within10)}% of predictions land within ±10 min`);
  if (Math.abs(bias) > 8) findings.push(`Systematic ${bias < 0 ? "optimism" : "pessimism"} of ${round(Math.abs(bias))} min`);

  return {
    modelId: ETA_MODEL_ID,
    samples: pairs.length,
    mae: round(mae),
    p90AbsoluteError: round(p90),
    mape: round(mape),
    within10MinPct: round(within10),
    promiseAttainmentPct: round(promiseAttainment),
    bias: round(bias),
    passed: findings.length === 0,
    thresholds: ETA_THRESHOLDS,
    findings,
  };
}

/* ------------------------------------------------------------------ */
/* Capacity / demand forecasting + anomaly detection                   */
/* ------------------------------------------------------------------ */

export interface CapacityForecast {
  window: "next_1h" | "next_4h" | "next_24h";
  projectedDemand: number;
  availableCapacity: number;
  utilisation: number;
  shortfall: number;
  recommendation: string;
  confidence: number;
}

/** Forecast capacity pressure per dispatch window from the twin state. */
export function forecastCapacity(obs: TwinObservation, twin: TwinSnapshot = buildTwin(obs)): CapacityForecast[] {
  const backlog = (obs.parcelsAwaiting ?? 0) + (obs.parcelsInTransit ?? 0);
  const couriers = Math.max(1, obs.couriersActive ?? obs.vehiclesActive ?? 1);
  const throughputPerHour = couriers * 3.2 * (1 - twin.environment.trafficIndex * 0.3);
  const windows: Array<{ w: CapacityForecast["window"]; hours: number; growth: number }> = [
    { w: "next_1h", hours: 1, growth: 1.05 },
    { w: "next_4h", hours: 4, growth: 1.2 },
    { w: "next_24h", hours: 24, growth: 1.45 },
  ];
  return windows.map(({ w, hours, growth }) => {
    const projectedDemand = Math.round(backlog * growth);
    const availableCapacity = Math.round(throughputPerHour * hours);
    const utilisation = availableCapacity ? Math.round((projectedDemand / availableCapacity) * 100) / 100 : 0;
    const shortfall = Math.max(0, projectedDemand - availableCapacity);
    return {
      window: w,
      projectedDemand,
      availableCapacity,
      utilisation,
      shortfall,
      confidence: Math.round(Math.max(0.4, 0.95 - hours * 0.015) * 100) / 100,
      recommendation: shortfall > 0
        ? `Add ~${Math.ceil(shortfall / (3.2 * hours))} couriers or defer ${shortfall} low-priority parcels`
        : utilisation > 0.85
          ? "Capacity adequate but with no absorption headroom — hold reserve couriers on standby"
          : "Capacity sufficient for projected demand",
    };
  });
}

export type AnomalyKind =
  | "late_delivery_risk" | "warehouse_overload" | "vehicle_failure_risk"
  | "route_congestion" | "carrier_underperformance" | "inventory_shortage"
  | "reverse_logistics_backlog" | "cross_dock_conflict" | "courier_imbalance"
  | "cold_chain_excursion_risk";

export interface LogisticsAnomaly {
  kind: AnomalyKind;
  severity: "low" | "medium" | "high" | "critical";
  subject: string;
  detail: string;
  /** 0-1 likelihood the anomaly materialises in the next dispatch window. */
  likelihood: number;
  recommendedAction: string;
}

export interface AnomalyInput extends TwinObservation {
  failedRatePct?: number;
  returnsBacklog?: number;
  vehiclesOverdueService?: number;
  carrierOnTimePct?: number;
  inventoryAccuracyPct?: number;
}

/** Detect predictive anomalies from the twin plus operational counters. */
export function detectAnomalies(input: AnomalyInput, twin: TwinSnapshot = buildTwin(input)): LogisticsAnomaly[] {
  const out: LogisticsAnomaly[] = [];
  const push = (a: LogisticsAnomaly) => out.push(a);

  for (const b of twin.bottlenecks) {
    if (b.nodeId.startsWith("wh:")) {
      push({
        kind: "warehouse_overload", severity: b.utilisation >= 1 ? "critical" : "high",
        subject: b.label, detail: `${Math.round(b.utilisation * 100)}% of storage/processing capacity consumed`,
        likelihood: Math.min(0.98, b.utilisation), recommendedAction: "Open an overflow wave and pull forward outbound cut-off",
      });
    } else if (b.nodeId.startsWith("hub:") || b.nodeId.startsWith("dc:")) {
      push({
        kind: "cross_dock_conflict", severity: b.utilisation >= 0.95 ? "high" : "medium",
        subject: b.label, detail: b.reason,
        likelihood: Math.min(0.95, b.utilisation), recommendedAction: "Stagger inbound arrivals and reassign dock slots",
      });
    }
  }

  if (twin.environment.trafficIndex >= 0.6) {
    push({
      kind: "route_congestion", severity: twin.environment.trafficIndex >= 0.8 ? "high" : "medium",
      subject: "Active route plan",
      detail: `Traffic index ${twin.environment.trafficIndex.toFixed(2)} adds ~${twin.environment.networkDelayMinutes} min network delay`,
      likelihood: twin.environment.trafficIndex, recommendedAction: "Trigger dynamic re-sequencing and refresh customer ETAs",
    });
  }

  const failedRate = input.failedRatePct ?? 0;
  if (failedRate > 5) {
    push({
      kind: "late_delivery_risk", severity: failedRate > 12 ? "critical" : "high",
      subject: "Delivery network", detail: `${failedRate.toFixed(1)}% of parcels failed or returned`,
      likelihood: Math.min(0.95, failedRate / 20), recommendedAction: "Run exception triage and re-dispatch affected parcels",
    });
  }

  const overdue = input.vehiclesOverdueService ?? 0;
  if (overdue > 0) {
    push({
      kind: "vehicle_failure_risk", severity: overdue > 5 ? "high" : "medium",
      subject: "Fleet", detail: `${overdue} vehicle(s) past their service interval`,
      likelihood: Math.min(0.9, 0.2 + overdue * 0.08), recommendedAction: "Block dispatch for overdue vehicles until inspection clears",
    });
  }

  const carrier = input.carrierOnTimePct;
  if (carrier != null && carrier < 90) {
    push({
      kind: "carrier_underperformance", severity: carrier < 80 ? "high" : "medium",
      subject: "Logistics partners", detail: `Partner on-time rate ${carrier.toFixed(1)}% below the 90% contractual floor`,
      likelihood: Math.min(0.95, (90 - carrier) / 20), recommendedAction: "Issue corrective action and throttle allocation for two cycles",
    });
  }

  const accuracy = input.inventoryAccuracyPct;
  if (accuracy != null && accuracy < 97) {
    push({
      kind: "inventory_shortage", severity: accuracy < 92 ? "high" : "medium",
      subject: "Inventory", detail: `Inventory accuracy ${accuracy.toFixed(1)}% below the 97% target`,
      likelihood: Math.min(0.9, (97 - accuracy) / 10), recommendedAction: "Schedule a cycle count on the highest-velocity SKUs",
    });
  }

  const returns = input.returnsBacklog ?? 0;
  if (returns > 25) {
    push({
      kind: "reverse_logistics_backlog", severity: returns > 100 ? "high" : "medium",
      subject: "Returns", detail: `${returns} returns awaiting disposition`,
      likelihood: Math.min(0.9, returns / 200), recommendedAction: "Allocate a dedicated returns wave and unblock refund linkage",
    });
  }

  const couriers = input.couriersActive ?? 0;
  const load = (input.parcelsAwaiting ?? 0) + (input.parcelsInTransit ?? 0);
  if (couriers > 0 && load / couriers > 25) {
    push({
      kind: "courier_imbalance", severity: load / couriers > 40 ? "high" : "medium",
      subject: "Courier network", detail: `${Math.round(load / couriers)} parcels per active courier`,
      likelihood: Math.min(0.95, load / couriers / 50), recommendedAction: "Rebalance couriers across zones and open surge incentives",
    });
  }

  const cold = input.coldChainParcels ?? 0;
  if (cold > 0 && twin.environment.weatherIndex > 0.5) {
    push({
      kind: "cold_chain_excursion_risk", severity: "high",
      subject: "Cold chain lane", detail: `${cold} temperature-controlled parcels exposed to elevated ambient conditions`,
      likelihood: Math.min(0.9, twin.environment.weatherIndex), recommendedAction: "Shorten dwell targets and verify reefer telemetry before dispatch",
    });
  }

  const rank = { critical: 0, high: 1, medium: 2, low: 3 } as const;
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || b.likelihood - a.likelihood);
}
