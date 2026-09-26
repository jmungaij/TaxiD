/**
 * Phase 1.5 — Enterprise Evidence Collection & Continuous Certification.
 *
 * Certification engines (BCRA, LCIF, Capability Maturity, Convergence) all
 * consume *evidence*. Until now some evidence — notably performance baselines —
 * had to be supplied manually, which is why the convergence performance axis
 * reported "no recorded latency evidence".
 *
 * This module is the single, headless evidence layer. It:
 *  - declares the canonical metric catalogue (what evidence must exist),
 *  - normalises raw samples coming from existing telemetry,
 *  - scores freshness / coverage deterministically,
 *  - projects the collected evidence into the shapes the existing engines
 *    already accept (e.g. convergence `performanceBaseline`).
 *
 * No UI, no new registries, no duplicated business logic.
 */

import { PERFORMANCE_BASELINE_SLOTS, type PerformanceBaselineSlot } from "@/lib/workspace360/convergence";

export const EVIDENCE_VERSION = "1.0.0";

export type EvidenceUnit = "ms" | "count" | "ratio" | "percent" | "seconds";

export type EvidenceClass =
  | "performance"
  | "reliability"
  | "throughput"
  | "intelligence"
  | "data_freshness";

export interface EvidenceMetric {
  id: string;
  label: string;
  unit: EvidenceUnit;
  klass: EvidenceClass;
  /** Existing telemetry surface the sample is derived from. */
  source: string;
  /** Max age (minutes) before a reading is considered stale. */
  freshnessMinutes: number;
  /** Objective: readings at or better than this satisfy the metric. */
  target: number;
  /** Direction of "better". */
  direction: "lower_is_better" | "higher_is_better";
  /** Convergence performance-baseline slot this metric feeds, if any. */
  baselineSlot?: PerformanceBaselineSlot;
}

/** Canonical evidence catalogue. Order is stable — digests depend on it. */
export const EVIDENCE_METRICS: ReadonlyArray<EvidenceMetric> = [
  { id: "api_latency_ms", label: "API latency (p95)", unit: "ms", klass: "performance", source: "supabase_rpc_telemetry", freshnessMinutes: 60, target: 400, direction: "lower_is_better", baselineSlot: "rpc_latency_ms" },
  { id: "page_render_ms", label: "Page render (p75)", unit: "ms", klass: "performance", source: "web_vitals", freshnessMinutes: 1440, target: 2500, direction: "lower_is_better", baselineSlot: "page_load_ms" },
  { id: "edge_function_latency_ms", label: "Edge function latency (p95)", unit: "ms", klass: "performance", source: "edge_function_logs", freshnessMinutes: 60, target: 1200, direction: "lower_is_better", baselineSlot: "edge_function_latency_ms" },
  { id: "db_query_ms", label: "Database query time (p95)", unit: "ms", klass: "performance", source: "slow_queries", freshnessMinutes: 1440, target: 250, direction: "lower_is_better", baselineSlot: "db_query_ms" },
  { id: "timeline_render_ms", label: "Timeline render", unit: "ms", klass: "performance", source: "web_vitals", freshnessMinutes: 1440, target: 900, direction: "lower_is_better", baselineSlot: "timeline_render_ms" },
  { id: "workspace_switch_ms", label: "Workspace switch", unit: "ms", klass: "performance", source: "web_vitals", freshnessMinutes: 1440, target: 600, direction: "lower_is_better", baselineSlot: "workspace_switch_ms" },
  { id: "executive_refresh_ms", label: "Executive refresh", unit: "ms", klass: "performance", source: "dashboard_metrics", freshnessMinutes: 1440, target: 1500, direction: "lower_is_better", baselineSlot: "executive_refresh_ms" },
  { id: "ops_center_refresh_ms", label: "Ops center refresh", unit: "ms", klass: "performance", source: "dashboard_metrics", freshnessMinutes: 1440, target: 1500, direction: "lower_is_better", baselineSlot: "ops_center_refresh_ms" },
  { id: "workflow_execution_ms", label: "Workflow execution time", unit: "ms", klass: "performance", source: "process_intelligence", freshnessMinutes: 1440, target: 5000, direction: "lower_is_better" },
  { id: "queue_depth", label: "Outbox queue depth", unit: "count", klass: "throughput", source: "analytics_export_outbox", freshnessMinutes: 30, target: 50, direction: "lower_is_better" },
  { id: "retry_count", label: "Retry count (24h)", unit: "count", klass: "reliability", source: "alert_dispatch_dlq", freshnessMinutes: 1440, target: 25, direction: "lower_is_better" },
  { id: "reconciliation_lag_minutes", label: "Reconciliation lag", unit: "seconds", klass: "reliability", source: "corporate_financial_reconciliation", freshnessMinutes: 1440, target: 3600, direction: "lower_is_better" },
  { id: "sla_attainment", label: "SLA attainment", unit: "percent", klass: "reliability", source: "availability_metrics", freshnessMinutes: 1440, target: 99, direction: "higher_is_better" },
  { id: "event_propagation_ms", label: "Event propagation latency", unit: "ms", klass: "performance", source: "event_store", freshnessMinutes: 60, target: 2000, direction: "lower_is_better" },
  { id: "cache_hit_ratio", label: "Cache hit ratio", unit: "ratio", klass: "throughput", source: "ttlCache", freshnessMinutes: 60, target: 0.8, direction: "higher_is_better" },
  { id: "digital_twin_freshness_minutes", label: "Digital Twin freshness", unit: "seconds", klass: "data_freshness", source: "digital_twin_runs", freshnessMinutes: 1440, target: 3600, direction: "lower_is_better" },
  { id: "knowledge_graph_age_minutes", label: "Knowledge graph refresh age", unit: "seconds", klass: "data_freshness", source: "knowledgePlatform", freshnessMinutes: 1440, target: 86400, direction: "lower_is_better" },
  { id: "intelligence_api_ms", label: "Intelligence API response", unit: "ms", klass: "performance", source: "intelligenceApi", freshnessMinutes: 60, target: 500, direction: "lower_is_better" },
  { id: "ai_decision_ms", label: "AI decision latency", unit: "ms", klass: "intelligence", source: "ai_gateway_logs", freshnessMinutes: 1440, target: 4000, direction: "lower_is_better" },
  { id: "prediction_accuracy", label: "Prediction accuracy", unit: "ratio", klass: "intelligence", source: "delivery_eta_predictions", freshnessMinutes: 1440, target: 0.85, direction: "higher_is_better" },
  { id: "uptime", label: "Uptime", unit: "percent", klass: "reliability", source: "availability_metrics", freshnessMinutes: 1440, target: 99.5, direction: "higher_is_better" },
  { id: "availability", label: "Availability (30d)", unit: "percent", klass: "reliability", source: "availability_metrics", freshnessMinutes: 1440, target: 99.5, direction: "higher_is_better" },
  { id: "error_budget_remaining", label: "Error budget remaining", unit: "ratio", klass: "reliability", source: "payment_slos", freshnessMinutes: 1440, target: 0.2, direction: "higher_is_better" },
];

export function evidenceMetric(id: string): EvidenceMetric | undefined {
  return EVIDENCE_METRICS.find((m) => m.id === id);
}

/** A raw observation handed in by an existing telemetry collector. */
export interface EvidenceSample {
  metricId: string;
  value: number;
  /** ISO timestamp of the observation. */
  observedAt: string;
  /** Number of underlying observations aggregated into `value`. */
  sampleSize?: number;
  source?: string;
}

export type ReadingState = "meeting" | "breaching" | "stale" | "missing";

export interface EvidenceReading {
  metric: EvidenceMetric;
  value: number | null;
  observedAt: string | null;
  ageMinutes: number | null;
  sampleSize: number;
  state: ReadingState;
}

export interface EvidenceBundleOptions {
  /** Evaluation instant — injected so certification runs are deterministic. */
  now?: Date | string;
  /** Minimum observations required before a reading counts as evidence. */
  minSampleSize?: number;
}

export interface EvidenceBundle {
  version: string;
  generatedAt: string;
  readings: EvidenceReading[];
  /** % of catalogue metrics with a fresh, sufficient reading. */
  coverage: number;
  /** % of covered readings meeting their target. */
  attainment: number;
  counts: Record<ReadingState, number>;
  digest: string;
  status: "certified" | "conditional" | "not_certified";
}

function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function meetsTarget(m: EvidenceMetric, v: number): boolean {
  return m.direction === "lower_is_better" ? v <= m.target : v >= m.target;
}

/**
 * Collect evidence from raw telemetry samples. Latest sample per metric wins;
 * ties resolve to the higher sample size so aggregated windows beat spot reads.
 */
export function collectEvidence(
  samples: ReadonlyArray<EvidenceSample> = [],
  options: EvidenceBundleOptions = {},
): EvidenceBundle {
  const now = options.now ? new Date(options.now) : new Date();
  const minSampleSize = options.minSampleSize ?? 1;

  const latest = new Map<string, EvidenceSample>();
  for (const s of samples) {
    if (!evidenceMetric(s.metricId)) continue;
    if (!Number.isFinite(s.value)) continue;
    const prev = latest.get(s.metricId);
    if (
      !prev ||
      new Date(s.observedAt).getTime() > new Date(prev.observedAt).getTime() ||
      (s.observedAt === prev.observedAt && (s.sampleSize ?? 1) > (prev.sampleSize ?? 1))
    ) {
      latest.set(s.metricId, s);
    }
  }

  const counts: Record<ReadingState, number> = { meeting: 0, breaching: 0, stale: 0, missing: 0 };
  const readings: EvidenceReading[] = EVIDENCE_METRICS.map((metric) => {
    const s = latest.get(metric.id);
    if (!s || (s.sampleSize ?? 1) < minSampleSize) {
      counts.missing += 1;
      return { metric, value: null, observedAt: null, ageMinutes: null, sampleSize: 0, state: "missing" };
    }
    const ageMinutes = Math.max(0, (now.getTime() - new Date(s.observedAt).getTime()) / 60000);
    const state: ReadingState =
      ageMinutes > metric.freshnessMinutes ? "stale" : meetsTarget(metric, s.value) ? "meeting" : "breaching";
    counts[state] += 1;
    return {
      metric,
      value: s.value,
      observedAt: s.observedAt,
      ageMinutes: Math.round(ageMinutes),
      sampleSize: s.sampleSize ?? 1,
      state,
    };
  });

  const total = EVIDENCE_METRICS.length;
  const covered = counts.meeting + counts.breaching;
  const coverage = Math.round((covered / total) * 100);
  const attainment = covered === 0 ? 0 : Math.round((counts.meeting / covered) * 100);
  const digest = fnv1a(
    readings.map((r) => `${r.metric.id}:${r.value ?? "-"}:${r.state}`).join("|"),
  );

  return {
    version: EVIDENCE_VERSION,
    generatedAt: now.toISOString(),
    readings,
    coverage,
    attainment,
    counts,
    digest,
    status: coverage >= 90 && attainment >= 90 ? "certified" : coverage >= 60 ? "conditional" : "not_certified",
  };
}

/**
 * Project collected evidence into the convergence engine's
 * `performanceBaseline` shape so the performance axis is fed automatically
 * instead of requiring hand-supplied latency numbers.
 */
export function toPerformanceBaseline(
  bundle: EvidenceBundle,
): Partial<Record<PerformanceBaselineSlot, number>> {
  const out: Partial<Record<PerformanceBaselineSlot, number>> = {};
  for (const r of bundle.readings) {
    const slot = r.metric.baselineSlot;
    if (!slot) continue;
    if (r.value === null || r.state === "missing" || r.state === "stale") continue;
    out[slot] = r.value;
  }
  return out;
}

/** Baseline slots the evidence catalogue can never satisfy — a real coverage gap. */
export function unmappedBaselineSlots(): PerformanceBaselineSlot[] {
  const mapped = new Set(EVIDENCE_METRICS.map((m) => m.baselineSlot).filter(Boolean));
  return PERFORMANCE_BASELINE_SLOTS.filter((s) => !mapped.has(s));
}

export interface EvidenceCertification {
  version: string;
  coverage: number;
  attainment: number;
  baselineSlotsCovered: number;
  baselineSlotsTotal: number;
  gaps: string[];
  score: number;
  status: "certified" | "conditional" | "not_certified";
}

/** Continuous certification of the evidence layer itself. */
export function certifyEvidenceCollection(bundle: EvidenceBundle): EvidenceCertification {
  const baseline = toPerformanceBaseline(bundle);
  const baselineSlotsCovered = Object.keys(baseline).length;
  const gaps: string[] = [];
  for (const r of bundle.readings) {
    if (r.state === "missing") gaps.push(`${r.metric.id}: no reading from ${r.metric.source}`);
    else if (r.state === "stale") gaps.push(`${r.metric.id}: reading is stale (${r.ageMinutes}m)`);
  }
  for (const slot of unmappedBaselineSlots()) gaps.push(`baseline slot "${slot}" has no evidence metric`);

  const slotScore = (baselineSlotsCovered / PERFORMANCE_BASELINE_SLOTS.length) * 100;
  const score = Math.round(bundle.coverage * 0.5 + bundle.attainment * 0.2 + slotScore * 0.3);

  return {
    version: EVIDENCE_VERSION,
    coverage: bundle.coverage,
    attainment: bundle.attainment,
    baselineSlotsCovered,
    baselineSlotsTotal: PERFORMANCE_BASELINE_SLOTS.length,
    gaps,
    score,
    status: score >= 90 ? "certified" : score >= 70 ? "conditional" : "not_certified",
  };
}

/* ------------------------------------------------------------------ *
 * Enterprise Hardening WS9 — Evidence integrity.
 *
 * Extends the existing collector with integrity attributes. No additional
 * storage: everything is derived from the bundle already in memory.
 * ------------------------------------------------------------------ */

export interface EvidenceIntegrityRecord {
  metricId: string;
  source: string;
  freshnessPct: number;
  complete: boolean;
  confidencePct: number;
  /** source → metric → baseline slot provenance chain. */
  lineage: string[];
  provenance: string;
  replayable: boolean;
  checksum: string;
  valid: boolean;
  issues: string[];
}

export interface EvidenceIntegrityReport {
  version: string;
  records: EvidenceIntegrityRecord[];
  freshnessPct: number;
  completenessPct: number;
  confidencePct: number;
  replayablePct: number;
  validPct: number;
  score: number;
  passed: boolean;
  checksum: string;
}

export function certifyEvidenceIntegrity(bundle: EvidenceBundle): EvidenceIntegrityReport {
  const records: EvidenceIntegrityRecord[] = bundle.readings.map((r) => {
    const budget = r.metric.freshnessMinutes;
    const freshnessPct =
      r.ageMinutes === null ? 0 : Math.max(0, Math.min(100, Math.round((1 - r.ageMinutes / Math.max(1, budget)) * 100)));
    const complete = r.state === "meeting" || r.state === "breaching";
    const confidencePct = Math.round(freshnessPct * 0.6 + Math.min(100, r.sampleSize * 10) * 0.4);
    const issues: string[] = [];
    if (r.state === "missing") issues.push("no reading");
    if (r.state === "stale") issues.push(`stale by ${(r.ageMinutes ?? 0) - budget}m`);
    if (complete && r.sampleSize < 1) issues.push("insufficient sample size");
    return {
      metricId: r.metric.id,
      source: r.metric.source,
      freshnessPct,
      complete,
      confidencePct,
      lineage: [r.metric.source, r.metric.id, r.metric.klass],
      provenance: `${r.metric.source}@${r.observedAt ?? "never"}`,
      replayable: complete && r.observedAt !== null,
      checksum: fnv1a(`${r.metric.id}|${r.value ?? "null"}|${r.observedAt ?? "null"}|${r.sampleSize}`),
      valid: issues.length === 0,
      issues,
    };
  });

  const n = Math.max(1, records.length);
  const avg = (pick: (r: EvidenceIntegrityRecord) => number) =>
    Math.round(records.reduce((s, r) => s + pick(r), 0) / n);
  const share = (pick: (r: EvidenceIntegrityRecord) => boolean) =>
    Math.round((records.filter(pick).length / n) * 100);

  const freshnessPct = avg((r) => r.freshnessPct);
  const completenessPct = share((r) => r.complete);
  const confidencePct = avg((r) => r.confidencePct);
  const replayablePct = share((r) => r.replayable);
  const validPct = share((r) => r.valid);
  const score = Math.round(freshnessPct * 0.25 + completenessPct * 0.3 + confidencePct * 0.2 + replayablePct * 0.15 + validPct * 0.1);

  return {
    version: EVIDENCE_VERSION,
    records,
    freshnessPct,
    completenessPct,
    confidencePct,
    replayablePct,
    validPct,
    score,
    passed: score >= 85,
    checksum: fnv1a(records.map((r) => r.checksum).join("|")),
  };
}
