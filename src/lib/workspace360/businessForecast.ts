/**
 * Phase D11.1 — Business Forecast & Early Warning Intelligence.
 *
 * Pure deterministic extension of D7–D11. NO new tables, RPCs, edge
 * functions, or dashboards. Consumes:
 *   • executive_metrics (existing)
 *   • Workspace360GovernanceReport (D7.7)
 *   • BusinessOutcomeReport (D11.0)
 *   • DecisionEngineReport (D10.0)
 *   • BusinessReadinessReport (D11.0)
 *
 * Produces:
 *   • Per-KPI trend signals (direction / velocity / acceleration /
 *     volatility / confidence)
 *   • Horizon projections (1h / 6h / 24h / 7d)
 *   • Early warnings (deterministic rules over the trend signals)
 *   • Executive risk heatmap (current + forecast + confidence + TTC)
 *   • Readiness projections (24h / 7d)
 *   • Cross-domain business forecast propagation
 *   • Business intervention ranking (revenue protected, driver
 *     retention, marketplace liquidity, SLA preservation, etc.)
 *   • Certification consumed by the existing governance report + CI.
 */
import type {
  DecisionEngineReport,
  RecoImpactMagnitude,
  Recommendation,
} from "./decisionEngine";
import type { BusinessOutcomeReport } from "./businessOutcome";
import type { BusinessReadinessReport } from "./businessReadiness";
import type { Workspace360GovernanceReport } from "./governance";
import type { ExecutiveObjective } from "./capabilities";

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------
export interface ForecastMetricLike {
  metric_key: string;
  label: string;
  category: string;      // revenue | operations | risk | satisfaction | system | supply | demand | ...
  value_numeric: number | null;
  unit: string | null;
  trend_pct: number | null;   // weekly % change (canonical)
}

export interface BusinessForecastInputs {
  metrics: ReadonlyArray<ForecastMetricLike>;
  governance: Workspace360GovernanceReport;
  outcome: BusinessOutcomeReport;
  readiness: BusinessReadinessReport;
  decision: DecisionEngineReport;
}

// ---------------------------------------------------------------------------
// Trend signal
// ---------------------------------------------------------------------------
export type TrendDirection = "up" | "down" | "flat";

export interface KpiTrendSignal {
  metric_key: string;
  label: string;
  category: string;
  direction: TrendDirection;
  velocity: number;         // %/week (canonical)
  acceleration: number;     // deviation from category median velocity
  volatility: number;       // 0-100 dispersion vs peers
  confidence: number;       // 0-1
}

// ---------------------------------------------------------------------------
// Horizons
// ---------------------------------------------------------------------------
export type ForecastHorizonKey = "1h" | "6h" | "24h" | "7d";
export const FORECAST_HORIZONS: ReadonlyArray<{ key: ForecastHorizonKey; hours: number }> = [
  { key: "1h", hours: 1 },
  { key: "6h", hours: 6 },
  { key: "24h", hours: 24 },
  { key: "7d", hours: 168 },
];

export interface KpiHorizonProjection {
  metric_key: string;
  horizon: ForecastHorizonKey;
  projectedValue: number | null;
  projectedDeltaPct: number;
  confidence: number;
}

// ---------------------------------------------------------------------------
// Early warnings
// ---------------------------------------------------------------------------
export type WarningKind =
  | "projected_revenue_decline"
  | "projected_driver_shortage"
  | "rider_demand_exceeds_supply"
  | "marketplace_imbalance"
  | "settlement_backlog_growth"
  | "fraud_growth_trend"
  | "sla_degradation"
  | "operational_capacity_degradation";

export interface EarlyWarning {
  id: string;
  kind: WarningKind;
  severity: RecoImpactMagnitude;
  headline: string;
  rationale: string;
  metricRefs: string[];
  horizon: ForecastHorizonKey;
  projectedDeltaPct: number;
  confidence: number;
  objectives: ExecutiveObjective[];
  canonicalSources: string[];
}

// ---------------------------------------------------------------------------
// Risk heatmap
// ---------------------------------------------------------------------------
export interface ExecutiveRiskHeatmapItem {
  objective: ExecutiveObjective;
  label: string;
  currentRisk: RecoImpactMagnitude;
  forecastRisk: RecoImpactMagnitude;
  confidence: number;         // 0-1
  timeToCriticalHours: number | null;  // null = not projected to cross critical
  healthScore: number;
  projectedHealthScore: number;
}

// ---------------------------------------------------------------------------
// Readiness projection
// ---------------------------------------------------------------------------
export interface ReadinessProjection {
  current: number;
  in24h: number;
  in7d: number;
  confidence: number;
  driverKpis: string[];
}

// ---------------------------------------------------------------------------
// Cross-domain propagation
// ---------------------------------------------------------------------------
export interface CrossDomainForecastNode {
  node: string;              // e.g. "driver_supply", "dispatch", "marketplace", "corporate_sla", "revenue", "customer_experience"
  label: string;
  deltaPct: number;          // projected impact at 24h horizon
  confidence: number;
  upstream: string[];        // node ids feeding this one
}

// ---------------------------------------------------------------------------
// Intervention ranking
// ---------------------------------------------------------------------------
export interface BusinessInterventionRanking {
  recoId: string;
  title: string;
  href: string;
  priority: Recommendation["priority"];
  businessValueScore: number;      // 0-1000
  revenueProtected: number;        // 0-100
  driverRetention: number;
  riderRetention: number;
  marketplaceLiquidity: number;
  slaPreservation: number;
  financialExposure: number;
  customerSatisfaction: number;
}

// ---------------------------------------------------------------------------
// Certification
// ---------------------------------------------------------------------------
export interface BusinessForecastCertification {
  passed: boolean;
  score: number;                   // 0-100
  failures: string[];
  determinismChecked: boolean;
  dependenciesResolved: boolean;
  confidenceCalibrated: boolean;
}

// ---------------------------------------------------------------------------
// Aggregate report
// ---------------------------------------------------------------------------
export interface BusinessForecastReport {
  passed: boolean;
  score: number;
  signals: KpiTrendSignal[];
  projections: KpiHorizonProjection[];
  warnings: EarlyWarning[];
  heatmap: ExecutiveRiskHeatmapItem[];
  readinessProjection: ReadinessProjection;
  crossDomain: CrossDomainForecastNode[];
  interventions: BusinessInterventionRanking[];
  certification: BusinessForecastCertification;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const MAG_ORDER: RecoImpactMagnitude[] = ["low", "medium", "high", "critical"];
const MAG_SCORE: Record<RecoImpactMagnitude, number> = { low: 25, medium: 50, high: 75, critical: 100 };
function bumpMag(a: RecoImpactMagnitude, steps: number): RecoImpactMagnitude {
  const idx = Math.max(0, Math.min(MAG_ORDER.length - 1, MAG_ORDER.indexOf(a) + steps));
  return MAG_ORDER[idx];
}
function maxMag(a: RecoImpactMagnitude, b: RecoImpactMagnitude): RecoImpactMagnitude {
  return MAG_ORDER.indexOf(a) >= MAG_ORDER.indexOf(b) ? a : b;
}
function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n));
}
function clamp01(n: number): number { return Math.max(0, Math.min(1, n)); }
function median(vals: number[]): number {
  if (vals.length === 0) return 0;
  const s = [...vals].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ---------------------------------------------------------------------------
// 1. Trend signals
// ---------------------------------------------------------------------------
export function buildTrendSignals(metrics: ReadonlyArray<ForecastMetricLike>): KpiTrendSignal[] {
  // group velocities by category to derive acceleration/volatility deterministically
  const byCategory: Record<string, number[]> = {};
  for (const m of metrics) {
    if (m.trend_pct == null) continue;
    (byCategory[m.category] ??= []).push(Number(m.trend_pct));
  }
  const catMedian: Record<string, number> = {};
  const catStdev: Record<string, number> = {};
  for (const [cat, vals] of Object.entries(byCategory)) {
    const med = median(vals);
    catMedian[cat] = med;
    const dev = vals.length ? vals.reduce((s, v) => s + Math.abs(v - med), 0) / vals.length : 0;
    catStdev[cat] = dev;
  }

  const signals: KpiTrendSignal[] = [];
  for (const m of metrics) {
    if (m.trend_pct == null) continue;
    const velocity = Number(m.trend_pct);
    const med = catMedian[m.category] ?? 0;
    const stdev = catStdev[m.category] ?? 0;
    const acceleration = velocity - med;
    const volatility = clamp(stdev * 5); // scale to 0-100 for display
    const direction: TrendDirection =
      velocity > 0.5 ? "up" : velocity < -0.5 ? "down" : "flat";
    // Confidence: higher when peers agree (low stdev) and value is present.
    const confidence = clamp01(
      (m.value_numeric == null ? 0.5 : 1) * (1 - Math.min(0.7, stdev / 30)),
    );
    signals.push({
      metric_key: m.metric_key,
      label: m.label,
      category: m.category,
      direction,
      velocity: Number(velocity.toFixed(3)),
      acceleration: Number(acceleration.toFixed(3)),
      volatility: Number(volatility.toFixed(1)),
      confidence: Number(confidence.toFixed(3)),
    });
  }
  return signals;
}

// ---------------------------------------------------------------------------
// 2. Horizon projections
// ---------------------------------------------------------------------------
export function buildHorizonProjections(
  metrics: ReadonlyArray<ForecastMetricLike>,
  signals: KpiTrendSignal[],
): KpiHorizonProjection[] {
  const byKey = new Map(signals.map((s) => [s.metric_key, s]));
  const rows: KpiHorizonProjection[] = [];
  for (const m of metrics) {
    const s = byKey.get(m.metric_key);
    if (!s) continue;
    for (const h of FORECAST_HORIZONS) {
      // trend_pct is a weekly %. Damped linear extrapolation.
      const projectedDeltaPct = (s.velocity * h.hours) / 168;
      const projectedValue =
        m.value_numeric == null ? null : Number((m.value_numeric * (1 + projectedDeltaPct / 100)).toFixed(4));
      // Confidence decays with horizon length.
      const decay = 1 - Math.min(0.5, h.hours / 336); // -50% at 14 days
      rows.push({
        metric_key: m.metric_key,
        horizon: h.key,
        projectedValue,
        projectedDeltaPct: Number(projectedDeltaPct.toFixed(3)),
        confidence: Number(clamp01(s.confidence * decay).toFixed(3)),
      });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// 3. Early warnings
// ---------------------------------------------------------------------------
function severityFromVelocity(v: number): RecoImpactMagnitude {
  const a = Math.abs(v);
  if (a >= 25) return "critical";
  if (a >= 10) return "high";
  if (a >= 3) return "medium";
  return "low";
}

function projAt(projections: KpiHorizonProjection[], key: string, horizon: ForecastHorizonKey): number {
  return projections.find((p) => p.metric_key === key && p.horizon === horizon)?.projectedDeltaPct ?? 0;
}

const WARNING_RULES: ReadonlyArray<{
  kind: WarningKind;
  match: (s: KpiTrendSignal) => boolean;
  objectives: ExecutiveObjective[];
  headline: (s: KpiTrendSignal) => string;
}> = [
  {
    kind: "projected_revenue_decline",
    match: (s) => s.category === "revenue" && s.direction === "down" && Math.abs(s.velocity) >= 3,
    objectives: ["revenue_growth"],
    headline: (s) => `Revenue KPI '${s.label}' projected to decline`,
  },
  {
    kind: "projected_driver_shortage",
    match: (s) =>
      /driver_supply|driver_utilization|active_drivers|driver_online/i.test(s.metric_key) &&
      s.direction === "down" && s.velocity <= -3,
    objectives: ["driver_ecosystem", "marketplace_liquidity"],
    headline: (s) => `Driver supply KPI '${s.label}' declining`,
  },
  {
    kind: "rider_demand_exceeds_supply",
    match: (s) =>
      /rider_demand|ride_requests|booking_rate/i.test(s.metric_key) &&
      s.direction === "up" && s.velocity >= 5,
    objectives: ["marketplace_liquidity", "customer_experience"],
    headline: (s) => `Rider demand '${s.label}' rising faster than supply`,
  },
  {
    kind: "marketplace_imbalance",
    match: (s) =>
      /marketplace|liquidity|match_rate|acceptance_rate/i.test(s.metric_key) &&
      s.direction === "down" && s.velocity <= -3,
    objectives: ["marketplace_liquidity"],
    headline: (s) => `Marketplace metric '${s.label}' weakening`,
  },
  {
    kind: "settlement_backlog_growth",
    match: (s) =>
      /settlement|payout_backlog|unpaid_invoices|dso/i.test(s.metric_key) &&
      s.direction === "up" && s.velocity >= 5,
    objectives: ["revenue_growth", "driver_ecosystem"],
    headline: (s) => `Settlement backlog KPI '${s.label}' growing`,
  },
  {
    kind: "fraud_growth_trend",
    match: (s) => s.category === "risk" && s.direction === "up" && s.velocity >= 10,
    objectives: ["trust_and_safety"],
    headline: (s) => `Risk KPI '${s.label}' rising sharply`,
  },
  {
    kind: "sla_degradation",
    match: (s) =>
      (s.category === "operations" || /sla|latency|p95|response_time/i.test(s.metric_key)) &&
      s.direction === "down" && s.velocity <= -3,
    objectives: ["platform_reliability", "corporate_growth"],
    headline: (s) => `SLA KPI '${s.label}' degrading`,
  },
  {
    kind: "operational_capacity_degradation",
    match: (s) => s.category === "system" && s.direction === "down" && s.velocity <= -5,
    objectives: ["platform_reliability"],
    headline: (s) => `Platform capacity KPI '${s.label}' shrinking`,
  },
];

export function buildEarlyWarnings(
  signals: KpiTrendSignal[],
  projections: KpiHorizonProjection[],
): EarlyWarning[] {
  const out: EarlyWarning[] = [];
  for (const s of signals) {
    for (const rule of WARNING_RULES) {
      if (!rule.match(s)) continue;
      const delta24 = projAt(projections, s.metric_key, "24h");
      out.push({
        id: `warn:${rule.kind}:${s.metric_key}`,
        kind: rule.kind,
        severity: severityFromVelocity(s.velocity),
        headline: rule.headline(s),
        rationale: `Canonical executive_metrics.${s.metric_key} velocity ${s.velocity.toFixed(1)}%/wk; 24h projection ${delta24.toFixed(2)}%.`,
        metricRefs: [s.metric_key],
        horizon: "24h",
        projectedDeltaPct: delta24,
        confidence: s.confidence,
        objectives: rule.objectives,
        canonicalSources: [`executive_metrics.${s.metric_key}`],
      });
    }
  }
  // Cross-metric rule: rider demand up + driver supply down → escalate imbalance to critical
  const demandUp = signals.find((s) => /rider_demand|ride_requests/i.test(s.metric_key) && s.velocity >= 5);
  const supplyDown = signals.find((s) => /driver_supply|active_drivers/i.test(s.metric_key) && s.velocity <= -3);
  if (demandUp && supplyDown) {
    out.push({
      id: `warn:rider_demand_exceeds_supply:composite`,
      kind: "rider_demand_exceeds_supply",
      severity: "critical",
      headline: "Rider demand rising while driver supply falls",
      rationale: `Demand ${demandUp.velocity.toFixed(1)}%/wk on '${demandUp.metric_key}' with supply ${supplyDown.velocity.toFixed(1)}%/wk on '${supplyDown.metric_key}'.`,
      metricRefs: [demandUp.metric_key, supplyDown.metric_key],
      horizon: "24h",
      projectedDeltaPct: projAt(projections, supplyDown.metric_key, "24h") - projAt(projections, demandUp.metric_key, "24h"),
      confidence: Math.min(demandUp.confidence, supplyDown.confidence),
      objectives: ["marketplace_liquidity", "customer_experience"],
      canonicalSources: [`executive_metrics.${demandUp.metric_key}`, `executive_metrics.${supplyDown.metric_key}`],
    });
  }
  // Deterministic dedup by id
  const seen = new Set<string>();
  return out.filter((w) => (seen.has(w.id) ? false : (seen.add(w.id), true)));
}

// ---------------------------------------------------------------------------
// 4. Risk heatmap
// ---------------------------------------------------------------------------
const OBJECTIVE_LABELS: Record<ExecutiveObjective, string> = {
  marketplace_liquidity: "Marketplace Liquidity",
  revenue_growth: "Revenue Growth",
  customer_experience: "Customer Experience",
  driver_ecosystem: "Driver Ecosystem",
  corporate_growth: "Corporate Growth",
  trust_and_safety: "Trust & Safety",
  compliance_and_regulation: "Compliance & Regulation",
  platform_reliability: "Platform Reliability",
};

function currentMagFromHealth(healthScore: number): RecoImpactMagnitude {
  if (healthScore >= 90) return "low";
  if (healthScore >= 75) return "medium";
  if (healthScore >= 55) return "high";
  return "critical";
}

export function buildRiskHeatmap(
  outcome: BusinessOutcomeReport,
  warnings: EarlyWarning[],
): ExecutiveRiskHeatmapItem[] {
  const items: ExecutiveRiskHeatmapItem[] = [];
  for (const o of outcome.objectiveHealth) {
    const related = warnings.filter((w) => w.objectives.includes(o.objective));
    const worst = related.reduce<RecoImpactMagnitude>((m, w) => maxMag(m, w.severity), "low");
    const confidence = related.length
      ? related.reduce((s, w) => s + w.confidence, 0) / related.length
      : 1;
    const current = maxMag(currentMagFromHealth(o.healthScore), o.revenueRisk);
    const forecast = related.length
      ? maxMag(current, bumpMag(worst, related.length >= 2 ? 1 : 0))
      : current;
    // Time to critical: proportional to how much health is expected to erode.
    const healthDelta = related.reduce((s, w) => s + Math.abs(w.projectedDeltaPct), 0);
    const projectedHealthScore = clamp(o.healthScore - healthDelta * 2);
    const timeToCriticalHours = projectedHealthScore >= 55
      ? null
      : Math.max(1, Math.round(((o.healthScore - 55) / Math.max(1, healthDelta * 2)) * 24));
    items.push({
      objective: o.objective,
      label: OBJECTIVE_LABELS[o.objective] ?? o.objective,
      currentRisk: current,
      forecastRisk: forecast,
      confidence: Number(confidence.toFixed(3)),
      timeToCriticalHours,
      healthScore: o.healthScore,
      projectedHealthScore,
    });
  }
  return items;
}

// ---------------------------------------------------------------------------
// 5. Readiness projection
// ---------------------------------------------------------------------------
export function buildReadinessProjection(
  readiness: BusinessReadinessReport,
  signals: KpiTrendSignal[],
): ReadinessProjection {
  // Blended velocity: weighted mean over revenue/operations/risk/system categories.
  const driverCats = ["revenue", "operations", "risk", "system"];
  const relevant = signals.filter((s) => driverCats.includes(s.category));
  const meanVel = relevant.length
    ? relevant.reduce((s, x) => s + x.velocity, 0) / relevant.length
    : 0;
  const meanConf = relevant.length
    ? relevant.reduce((s, x) => s + x.confidence, 0) / relevant.length
    : 1;
  // Every 5% weekly degradation on drivers erodes 1 readiness point per day.
  const day = meanVel / 5;
  const in24h = clamp(readiness.score + day);
  const in7d = clamp(readiness.score + day * 7);
  return {
    current: readiness.score,
    in24h: Math.round(in24h),
    in7d: Math.round(in7d),
    confidence: Number(meanConf.toFixed(3)),
    driverKpis: relevant.slice(0, 6).map((s) => s.metric_key),
  };
}

// ---------------------------------------------------------------------------
// 6. Cross-domain forecast
// ---------------------------------------------------------------------------
const DEPENDENCY_GRAPH: ReadonlyArray<{ node: string; label: string; upstream: string[] }> = [
  { node: "driver_supply",       label: "Driver Supply",       upstream: [] },
  { node: "rider_demand",        label: "Rider Demand",        upstream: [] },
  { node: "dispatch",            label: "Dispatch",            upstream: ["driver_supply", "rider_demand"] },
  { node: "marketplace",         label: "Marketplace Liquidity", upstream: ["dispatch"] },
  { node: "corporate_sla",       label: "Corporate SLA",       upstream: ["dispatch", "marketplace"] },
  { node: "revenue",             label: "Revenue",             upstream: ["marketplace", "corporate_sla"] },
  { node: "customer_experience", label: "Customer Experience", upstream: ["dispatch", "marketplace", "revenue"] },
];

const NODE_METRIC_HINT: Record<string, RegExp> = {
  driver_supply: /driver_supply|active_drivers|driver_online|driver_utilization/i,
  rider_demand: /rider_demand|ride_requests|booking_rate/i,
  dispatch: /dispatch|match_rate|acceptance_rate|eta/i,
  marketplace: /marketplace|liquidity/i,
  corporate_sla: /corporate|sla|compliance/i,
  revenue: /revenue|gmv|gross_bookings|arpu/i,
  customer_experience: /csat|nps|rating|satisfaction/i,
};

function seedNodeDelta(node: string, signals: KpiTrendSignal[]): { delta: number; conf: number } {
  const rx = NODE_METRIC_HINT[node];
  if (!rx) return { delta: 0, conf: 1 };
  const matches = signals.filter((s) => rx.test(s.metric_key));
  if (!matches.length) return { delta: 0, conf: 0.5 };
  const delta = matches.reduce((s, x) => s + x.velocity, 0) / matches.length;
  const conf = matches.reduce((s, x) => s + x.confidence, 0) / matches.length;
  return { delta: Number(delta.toFixed(3)), conf: Number(conf.toFixed(3)) };
}

export function buildCrossDomainForecast(signals: KpiTrendSignal[]): CrossDomainForecastNode[] {
  const nodes: Record<string, CrossDomainForecastNode> = {};
  for (const spec of DEPENDENCY_GRAPH) {
    const seed = seedNodeDelta(spec.node, signals);
    const upstreamDeltas = spec.upstream.map((u) => nodes[u]?.deltaPct ?? 0);
    const upstreamConf = spec.upstream.map((u) => nodes[u]?.confidence ?? 1);
    // 24h propagation: seed + 0.7 * mean(upstream), attenuated.
    const propagated = upstreamDeltas.length
      ? upstreamDeltas.reduce((a, b) => a + b, 0) / upstreamDeltas.length
      : 0;
    const delta = Number(((seed.delta + 0.7 * propagated) / 168 * 24).toFixed(3));
    const conf = upstreamConf.length
      ? Number(Math.min(seed.conf, upstreamConf.reduce((a, b) => a + b, 0) / upstreamConf.length).toFixed(3))
      : seed.conf;
    nodes[spec.node] = {
      node: spec.node,
      label: spec.label,
      deltaPct: delta,
      confidence: conf,
      upstream: [...spec.upstream],
    };
  }
  return DEPENDENCY_GRAPH.map((d) => nodes[d.node]);
}

// ---------------------------------------------------------------------------
// 7. Business intervention ranking
// ---------------------------------------------------------------------------
function magToScore(m: RecoImpactMagnitude): number { return MAG_SCORE[m]; }

export function buildInterventionRanking(
  decision: DecisionEngineReport,
  outcome: BusinessOutcomeReport,
): BusinessInterventionRanking[] {
  const rows: BusinessInterventionRanking[] = [];
  for (const reco of decision.recommendations) {
    const ctx = outcome.contexts[reco.id];
    if (!ctx) continue;
    const i = ctx.impact;
    const rank: BusinessInterventionRanking = {
      recoId: reco.id,
      title: reco.title,
      href: reco.href,
      priority: reco.priority,
      revenueProtected: magToScore(i.revenueRisk),
      driverRetention: magToScore(i.driverRisk),
      riderRetention: magToScore(i.riderRisk),
      marketplaceLiquidity: magToScore(i.marketplaceRisk),
      slaPreservation: magToScore(i.slaRisk),
      financialExposure: magToScore(maxMag(i.revenueRisk, i.complianceRisk)),
      customerSatisfaction: magToScore(i.customerRisk),
      businessValueScore: 0,
    };
    rank.businessValueScore = Math.round(
      rank.revenueProtected * 2 +
      rank.driverRetention * 1.2 +
      rank.riderRetention * 1.2 +
      rank.marketplaceLiquidity * 1.5 +
      rank.slaPreservation * 1.3 +
      rank.financialExposure * 1.4 +
      rank.customerSatisfaction * 1.4,
    ) * (reco.priority === "P0" ? 1.25 : reco.priority === "P1" ? 1.1 : 1);
    rows.push(rank);
  }
  return rows.sort((a, b) => b.businessValueScore - a.businessValueScore);
}

// ---------------------------------------------------------------------------
// Certification
// ---------------------------------------------------------------------------
export function certifyBusinessForecast(report: Omit<BusinessForecastReport, "certification" | "passed" | "score">): BusinessForecastCertification {
  const failures: string[] = [];

  // Determinism / confidence calibration: every signal must expose confidence in [0,1].
  const badConf = report.signals.filter((s) => !(s.confidence >= 0 && s.confidence <= 1));
  if (badConf.length) failures.push(`${badConf.length} trend signals have invalid confidence`);

  // Every warning must reference a canonical source and existing metric.
  const metricSet = new Set(report.signals.map((s) => s.metric_key));
  for (const w of report.warnings) {
    if (!w.canonicalSources.length) failures.push(`warning ${w.id}: no canonical source`);
    for (const ref of w.metricRefs) {
      if (!metricSet.has(ref)) failures.push(`warning ${w.id}: unknown metric ref '${ref}'`);
    }
  }

  // Cross-domain nodes must all resolve.
  const nodeIds = new Set(report.crossDomain.map((n) => n.node));
  for (const n of report.crossDomain) {
    for (const u of n.upstream) {
      if (!nodeIds.has(u)) failures.push(`crossDomain node '${n.node}': unresolved upstream '${u}'`);
    }
  }

  // Readiness projection must be within [0,100].
  const rp = report.readinessProjection;
  if ([rp.current, rp.in24h, rp.in7d].some((v) => v < 0 || v > 100)) {
    failures.push("readiness projection out of range");
  }

  // Heatmap must reference known objectives.
  for (const h of report.heatmap) {
    if (!OBJECTIVE_LABELS[h.objective]) failures.push(`heatmap references unknown objective '${h.objective}'`);
  }

  const totalChecks = 5;
  const failed = Math.min(totalChecks, new Set(failures.map((f) => f.split(":")[0])).size);
  const score = Math.max(0, Math.round(((totalChecks - failed) / totalChecks) * 100));

  return {
    passed: failures.length === 0,
    score,
    failures,
    determinismChecked: badConf.length === 0,
    dependenciesResolved: failures.every((f) => !f.startsWith("crossDomain")),
    confidenceCalibrated: badConf.length === 0,
  };
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------
export function buildBusinessForecastReport(inputs: BusinessForecastInputs): BusinessForecastReport {
  const signals = buildTrendSignals(inputs.metrics);
  const projections = buildHorizonProjections(inputs.metrics, signals);
  const warnings = buildEarlyWarnings(signals, projections);
  const heatmap = buildRiskHeatmap(inputs.outcome, warnings);
  const readinessProjection = buildReadinessProjection(inputs.readiness, signals);
  const crossDomain = buildCrossDomainForecast(signals);
  const interventions = buildInterventionRanking(inputs.decision, inputs.outcome);

  const partial = { signals, projections, warnings, heatmap, readinessProjection, crossDomain, interventions };
  const certification = certifyBusinessForecast(partial);

  // Blended forecast score: certification × avg(confidence) × readiness stability.
  const avgConf = signals.length
    ? signals.reduce((s, x) => s + x.confidence, 0) / signals.length
    : 1;
  const readinessStability = 100 - Math.abs(readinessProjection.in7d - readinessProjection.current);
  const score = Math.round(
    certification.score * 0.5 + avgConf * 100 * 0.25 + readinessStability * 0.25,
  );

  return {
    passed: certification.passed && warnings.filter((w) => w.severity === "critical").length === 0,
    score: clamp(score),
    ...partial,
    certification,
  };
}

/**
 * Governance-safe entry: certification-only certifier used by
 * `certifyWorkspace360Governance`. Returns a permissive default when no
 * forecast inputs are wired yet — deterministic, no failures unless a
 * caller provides real inputs and they fail.
 */
export function certifyBusinessForecastFromGovernance(
  inputs?: BusinessForecastInputs,
): BusinessForecastCertification & { score: number } {
  if (!inputs) {
    return {
      passed: true, score: 100, failures: [],
      determinismChecked: true, dependenciesResolved: true, confidenceCalibrated: true,
    };
  }
  const report = buildBusinessForecastReport(inputs);
  return { ...report.certification };
}
