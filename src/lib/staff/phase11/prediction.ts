/**
 * Phase 11 §11.3 — Predictive Intelligence Engine.
 *
 * A prediction that does not declare its confidence, freshness, drivers and
 * uncertainty is an opinion. This engine refuses to forecast without enough
 * history, returns an UNAVAILABLE measure instead of a plausible number, and is
 * itself scored against actuals (§11.36 Gate B) so prediction performance is
 * measurable rather than assumed.
 */
import {
  clamp, modelledMeasure, unavailableMeasure, type Measure, type MeasureUnit,
} from "@/lib/staff/phase8/provenance";

export type PredictionKind =
  | "demand"
  | "supply"
  | "matching"
  | "eta"
  | "cancellation"
  | "revenue"
  | "contribution"
  | "churn"
  | "provider_attrition"
  | "capacity_shortage"
  | "exception";

export const PREDICTION_LABEL: Record<PredictionKind, string> = {
  demand: "Demand",
  supply: "Supply becoming available",
  matching: "Match probability",
  eta: "Fulfilment ETA",
  cancellation: "Cancellation",
  revenue: "Revenue",
  contribution: "Contribution",
  churn: "Customer churn",
  provider_attrition: "Provider attrition",
  capacity_shortage: "Capacity shortage",
  exception: "Mission exception",
};

export const MODEL_VERSION = "yalla-p11-baseline-1.0";

/** Minimum observations before a forecast may be stated at all. */
export const MIN_HISTORY = 3;

export interface PredictionInput {
  kind: PredictionKind;
  cellId: string;
  horizon: string;
  unit: MeasureUnit;
  /** Ordered oldest → newest observations from an authoritative source. */
  history: readonly number[];
  source: string;
  drivers: readonly string[];
  /** Hours since the newest observation. */
  freshnessHours: number | null;
}

export interface Prediction {
  kind: PredictionKind;
  cellId: string;
  horizon: string;
  forecast: Measure;
  confidence: number | null;
  freshnessHours: number | null;
  drivers: string[];
  /** 80% band. null when not forecastable. */
  uncertainty: { low: number; high: number } | null;
  method: string;
  sufficientEvidence: boolean;
  note: string;
}

function mean(v: readonly number[]): number {
  return v.reduce((a, n) => a + n, 0) / v.length;
}

function stdev(v: readonly number[]): number {
  if (v.length < 2) return 0;
  const m = mean(v);
  return Math.sqrt(v.reduce((a, n) => a + (n - m) ** 2, 0) / (v.length - 1));
}

/**
 * Damped-trend forecast over the observed history. Deliberately simple and
 * inspectable: the point of Phase 11 is that the method, drivers and uncertainty
 * are visible, not that the model is opaque and impressive.
 */
export function predict(input: PredictionInput): Prediction {
  const h = input.history;
  if (h.length < MIN_HISTORY) {
    return {
      kind: input.kind,
      cellId: input.cellId,
      horizon: input.horizon,
      forecast: unavailableMeasure(
        `${PREDICTION_LABEL[input.kind]} forecast`,
        input.unit,
        input.source,
        `Only ${h.length} observation(s) available; ${MIN_HISTORY} required before a forecast may be stated`,
      ),
      confidence: null,
      freshnessHours: input.freshnessHours,
      drivers: [...input.drivers],
      uncertainty: null,
      method: "withheld — insufficient history",
      sufficientEvidence: false,
      note: "Instrument this signal before the loop is allowed to act on it",
    };
  }

  const last = h[h.length - 1];
  const slope = (h[h.length - 1] - h[0]) / (h.length - 1);
  const damping = 0.6;
  const point = Math.max(0, last + slope * damping);
  const sd = stdev(h);
  const relVolatility = last === 0 ? 1 : clamp(sd / Math.abs(last), 0, 1);

  const stalePenalty = input.freshnessHours === null ? 25 : clamp(input.freshnessHours * 1.5, 0, 30);
  const confidence = Math.round(clamp(90 - relVolatility * 45 - stalePenalty - Math.max(0, 8 - h.length) * 3, 5, 92));

  return {
    kind: input.kind,
    cellId: input.cellId,
    horizon: input.horizon,
    forecast: modelledMeasure(
      `${PREDICTION_LABEL[input.kind]} forecast`,
      Math.round(point * 100) / 100,
      input.unit,
      input.source,
      `Damped trend on ${h.length} observations (last ${last}, slope ${slope.toFixed(2)}, damping ${damping})`,
      confidence,
      MODEL_VERSION,
    ),
    confidence,
    freshnessHours: input.freshnessHours,
    drivers: [...input.drivers],
    uncertainty: {
      low: Math.round(Math.max(0, point - 1.28 * sd) * 100) / 100,
      high: Math.round((point + 1.28 * sd) * 100) / 100,
    },
    method: `damped trend · ${MODEL_VERSION}`,
    sufficientEvidence: true,
    note:
      input.freshnessHours === null
        ? "Freshness unknown — confidence penalised"
        : `Newest observation is ${input.freshnessHours}h old`,
  };
}

export interface PredictionOutcome {
  kind: PredictionKind;
  predicted: number;
  actual: number;
  /** Confidence claimed at prediction time. */
  confidence: number | null;
}

export interface PredictionQuality {
  kind: PredictionKind;
  samples: number;
  /** Mean absolute percentage error. null when no outcomes recorded. */
  mape: number | null;
  /** Signed mean percentage error: positive means over-forecasting. */
  bias: number | null;
  /** Whether stated confidence matches observed accuracy within 15 points. */
  calibrated: boolean | null;
  verdict: "measured" | "unmeasured";
}

/** Gate B: prediction performance must be measurable, per kind. */
export function scorePredictions(outcomes: readonly PredictionOutcome[]): PredictionQuality[] {
  const kinds = Array.from(new Set(outcomes.map((o) => o.kind)));
  return kinds.map((kind) => {
    const rows = outcomes.filter((o) => o.kind === kind && o.actual !== 0);
    if (rows.length === 0) {
      return { kind, samples: 0, mape: null, bias: null, calibrated: null, verdict: "unmeasured" as const };
    }
    const errors = rows.map((r) => ((r.predicted - r.actual) / r.actual) * 100);
    const mape = Math.round(mean(errors.map(Math.abs)) * 10) / 10;
    const bias = Math.round(mean(errors) * 10) / 10;
    const claimed = rows.map((r) => r.confidence).filter((c): c is number => c !== null);
    const observedAccuracy = clamp(100 - mape, 0, 100);
    return {
      kind,
      samples: rows.length,
      mape,
      bias,
      calibrated: claimed.length === 0 ? null : Math.abs(mean(claimed) - observedAccuracy) <= 15,
      verdict: "measured" as const,
    };
  });
}

export interface PredictionCoverage {
  kinds: number;
  forecastable: number;
  withheld: number;
  measured: number;
  /** Gate B passes only when at least one kind has measured accuracy. */
  gateBReady: boolean;
}

export function assessPredictions(
  predictions: readonly Prediction[],
  quality: readonly PredictionQuality[],
): PredictionCoverage {
  const measured = quality.filter((q) => q.verdict === "measured");
  return {
    kinds: new Set(predictions.map((p) => p.kind)).size,
    forecastable: predictions.filter((p) => p.sufficientEvidence).length,
    withheld: predictions.filter((p) => !p.sufficientEvidence).length,
    measured: measured.length,
    gateBReady: measured.length > 0,
  };
}
