/**
 * Phase 9.8 — Network density & network-effect intelligence.
 *
 * Density is the only honest proxy for a marketplace's defensibility: how many
 * active operators serve a zone, how fast a request finds one, and how much of
 * the network's value compounds as density rises. Every input is an observation
 * or the zone is reported as unmeasured.
 */
import { type Measure, clamp, liveMeasure, modelledMeasure, unavailableMeasure } from "../phase8/provenance";

export interface ZoneObservation {
  zoneId: string;
  zoneName: string;
  marketId: string;
  /** Distinct operators that completed at least one job in the window. */
  activeOperators: number | null;
  /** Completed jobs in the window. */
  completedJobs: number | null;
  /** Requests that received no operator. */
  unfulfilledRequests: number | null;
  /** Median seconds from request to acceptance. */
  medianAcceptSeconds: number | null;
  /** Square kilometres of the zone. */
  areaKm2: number | null;
  source: string;
  asOf: string | null;
}

export interface ZoneDensity {
  zoneId: string;
  zoneName: string;
  marketId: string;
  operatorsPerKm2: Measure;
  fulfilmentRate: Measure;
  acceptLatency: Measure;
  /** 0–100 composite: density × reliability × speed. */
  densityScore: Measure;
  regime: "critical_mass" | "emerging" | "sub_scale" | "unmeasured";
  /** The single action that raises this zone's density fastest. */
  nextAction: string;
}

const MODEL_VERSION = "yalla-density-1.0.0";

export function scoreZoneDensity(o: ZoneObservation): ZoneDensity {
  const src = o.source;
  const na = (label: string, unit: Measure["unit"], why: string) => unavailableMeasure(label, unit, src, why);

  const perKm2 = o.activeOperators !== null && o.areaKm2 !== null && o.areaKm2 > 0
    ? o.activeOperators / o.areaKm2 : null;

  const requests = o.completedJobs !== null && o.unfulfilledRequests !== null
    ? o.completedJobs + o.unfulfilledRequests : null;
  const fulfil = requests && requests > 0 && o.completedJobs !== null
    ? (o.completedJobs / requests) * 100 : null;

  const operatorsPerKm2 = perKm2 === null
    ? na("Operators per km²", "count", "Active operators or zone area is not observed")
    : liveMeasure("Operators per km²", perKm2, "count", src,
      "distinct operators with a completed job ÷ zone area", o.asOf ?? undefined);

  const fulfilmentRate = fulfil === null
    ? na("Fulfilment rate", "percent", "Requests or unfulfilled requests are not observed")
    : liveMeasure("Fulfilment rate", fulfil, "percent", src,
      "completed jobs ÷ (completed + unfulfilled requests)", o.asOf ?? undefined);

  const acceptLatency = o.medianAcceptSeconds === null
    ? na("Median accept latency", "count", "Acceptance timing is not observed")
    : liveMeasure("Median accept latency", o.medianAcceptSeconds, "count", src,
      "median seconds from request to operator acceptance", o.asOf ?? undefined);

  const parts: number[] = [];
  if (perKm2 !== null) parts.push(clamp((perKm2 / 6) * 100, 0, 100));
  if (fulfil !== null) parts.push(clamp(fulfil, 0, 100));
  if (o.medianAcceptSeconds !== null) parts.push(clamp(100 - (o.medianAcceptSeconds / 120) * 100, 0, 100));

  if (parts.length < 2) {
    return {
      zoneId: o.zoneId, zoneName: o.zoneName, marketId: o.marketId,
      operatorsPerKm2, fulfilmentRate, acceptLatency,
      densityScore: na("Density score", "score", "Fewer than two density inputs are observed"),
      regime: "unmeasured",
      nextAction: "Instrument this zone: without operator counts, request outcomes and accept latency its defensibility is unknown.",
    };
  }

  const score = Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);
  const regime = score >= 70 ? "critical_mass" : score >= 45 ? "emerging" : "sub_scale";
  const nextAction = fulfil !== null && fulfil < 85
    ? "Recruit operators in this zone — unfulfilled requests are the dominant leak."
    : o.medianAcceptSeconds !== null && o.medianAcceptSeconds > 60
      ? "Reposition supply toward request origins — jobs are being served too slowly."
      : "Hold density and convert reliability into premium pricing.";

  return {
    zoneId: o.zoneId, zoneName: o.zoneName, marketId: o.marketId,
    operatorsPerKm2, fulfilmentRate, acceptLatency,
    densityScore: modelledMeasure("Density score", score, "score", src,
      "mean of observed density, fulfilment and latency sub-scores", clamp(parts.length * 30, 30, 90), MODEL_VERSION),
    regime, nextAction,
  };
}

export interface NetworkEffectReading {
  marketId: string;
  zones: ZoneDensity[];
  /** Share of zones at critical mass. */
  criticalMassSharePct: number;
  /** Correlation between density score and fulfilment rate across zones, −1..1. */
  densityFulfilmentCorrelation: number | null;
  /** Zones that most constrain the market. */
  weakestZones: ZoneDensity[];
  interpretation: string;
}

function correlate(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

export function readNetworkEffect(marketId: string, observations: readonly ZoneObservation[]): NetworkEffectReading {
  const zones = observations.map(scoreZoneDensity);
  const measured = zones.filter((z) => z.regime !== "unmeasured");
  const criticalMassSharePct = zones.length === 0 ? 0
    : Math.round((zones.filter((z) => z.regime === "critical_mass").length / zones.length) * 100);

  const pairs = measured.filter((z) => z.densityScore.value !== null && z.fulfilmentRate.value !== null);
  const correlation = correlate(
    pairs.map((z) => z.densityScore.value as number),
    pairs.map((z) => z.fulfilmentRate.value as number),
  );

  const weakestZones = [...measured]
    .sort((a, b) => (a.densityScore.value ?? 0) - (b.densityScore.value ?? 0))
    .slice(0, 3);

  const unmeasured = zones.length - measured.length;
  const interpretation = measured.length === 0
    ? "No zone in this market is instrumented well enough to state a network effect."
    : `${criticalMassSharePct}% of zones are at critical mass${
        correlation === null ? "" : `; density and fulfilment correlate at ${correlation.toFixed(2)}`
      }${unmeasured > 0 ? `. ${unmeasured} zone${unmeasured > 1 ? "s" : ""} remain unmeasured and are excluded.` : "."}`;

  return { marketId, zones, criticalMassSharePct, densityFulfilmentCorrelation: correlation, weakestZones, interpretation };
}
