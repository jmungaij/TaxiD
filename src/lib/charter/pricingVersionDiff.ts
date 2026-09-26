/**
 * SmartFare configuration version diff.
 *
 * Governance needs to see exactly what changed between two published SmartFare
 * v2.0 configurations, and what that change did to real RFQ quotes. Both halves
 * are derived deterministically: a flattened field diff, plus a re-computation
 * of representative missions against each configuration.
 */
import {
  computeMissionFare, type SmartFareConfig, type SmartFareConfigVersion, type CustomerSegment,
} from "./smartFare";
import { POPULAR_ROUTES } from "./smartRoutes";

export interface FieldDelta {
  key: string;
  label: string;
  before: number | string | null;
  after: number | string | null;
  deltaPct: number | null;
}

export interface QuoteImpact {
  routeId: string;
  route: string;
  aircraftKey: string;
  before: number;
  after: number;
  delta: number;
  deltaPct: number;
}

export interface ConfigDiff {
  fromVersion: number;
  toVersion: number;
  changed: FieldDelta[];
  impact: QuoteImpact[];
  /** Average signed % movement across the sampled RFQ quotes. */
  averageQuoteMovePct: number;
}

const HUMAN: Record<string, string> = {
  missionBaseFee: "Mission base fee",
  emptyLegDiscountPct: "Empty-leg discount",
  emptyLegMaxDiscountPct: "Empty-leg discount ceiling",
  sharedMissionDiscountPct: "Shared mission discount",
  flexibleWindowDiscountPct: "Flexible departure discount",
  nearbyAirportDiscountPct: "Nearby airport optimisation",
  fuelAdjustmentPct: "Fuel adjustment",
  navPerNm: "Navigation charge / nm",
  passengerCharge: "Passenger charge / pax",
  internationalClearance: "International clearance",
  crewDayRate: "Crew day rate",
  crewOvernight: "Crew overnight",
  operatingFloorPct: "Sustainable operating floor",
  vatPct: "VAT",
};

const humanise = (key: string) => {
  const [head, tail] = key.split(".");
  const base = HUMAN[head] ?? head.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
  return tail ? `${base} · ${tail}` : base;
};

/** Flatten a config one level deep into dotted keys. */
export function flattenConfig(config: SmartFareConfig): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  for (const [k, v] of Object.entries(config as unknown as Record<string, unknown>)) {
    if (v && typeof v === "object") {
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) {
        if (typeof v2 === "number" || typeof v2 === "string") out[`${k}.${k2}`] = v2;
      }
    } else if (typeof v === "number" || typeof v === "string") {
      out[k] = v;
    }
  }
  return out;
}

const SAMPLE_SEGMENT: CustomerSegment = "corporate";

function sampleQuotes(config: SmartFareConfig) {
  return POPULAR_ROUTES.slice(0, 5).map((r) => ({
    route: r,
    fare: computeMissionFare({
      fromCode: r.fromCode,
      toCode: r.toCode,
      aircraftKey: r.recommendedAircraftKey,
      passengers: 6,
      segment: SAMPLE_SEGMENT,
      config,
    }),
  }));
}

/** Diff two configurations and quantify the effect on representative quotes. */
export function diffConfigs(
  before: SmartFareConfig,
  after: SmartFareConfig,
  meta: { fromVersion?: number; toVersion?: number } = {},
): ConfigDiff {
  const a = flattenConfig(before);
  const b = flattenConfig(after);
  const keys = Array.from(new Set([...Object.keys(a), ...Object.keys(b)])).sort();

  const changed: FieldDelta[] = [];
  for (const k of keys) {
    const x = a[k] ?? null;
    const y = b[k] ?? null;
    if (x === y) continue;
    const pct = typeof x === "number" && typeof y === "number" && x !== 0
      ? Math.round(((y - x) / Math.abs(x)) * 1000) / 10
      : null;
    changed.push({ key: k, label: humanise(k), before: x, after: y, deltaPct: pct });
  }

  const beforeQuotes = sampleQuotes(before);
  const afterQuotes = sampleQuotes(after);
  const impact: QuoteImpact[] = beforeQuotes.map((q, i) => {
    const bTotal = q.fare.total;
    const aTotal = afterQuotes[i].fare.total;
    return {
      routeId: q.route.id,
      route: q.route.label,
      aircraftKey: q.fare.aircraft.key,
      before: bTotal,
      after: aTotal,
      delta: aTotal - bTotal,
      deltaPct: bTotal > 0 ? Math.round(((aTotal - bTotal) / bTotal) * 1000) / 10 : 0,
    };
  });

  const averageQuoteMovePct = impact.length
    ? Math.round((impact.reduce((s, i) => s + i.deltaPct, 0) / impact.length) * 10) / 10
    : 0;

  return {
    fromVersion: meta.fromVersion ?? 0,
    toVersion: meta.toVersion ?? 0,
    changed,
    impact,
    averageQuoteMovePct,
  };
}

/** Diff two stored versions. */
export function diffVersions(before: SmartFareConfigVersion, after: SmartFareConfigVersion): ConfigDiff {
  return diffConfigs(before.config, after.config, {
    fromVersion: before.version,
    toVersion: after.version,
  });
}
