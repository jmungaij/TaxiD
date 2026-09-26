/**
 * OpsHub Intelligence — Phase 8.1.
 *
 * Deterministic, dependency-light layer that lets the Delivery Operations
 * console (`/delivery/ops`) stay consistent with the Dashboard 360 surfaces:
 *
 *   1. Threshold evaluation for real-time workspace health alerts
 *      (`evaluateOpsThresholds`) with an idempotency key per breach so the
 *      auditable event log never double-writes the same crossing.
 *   2. Capability drilldowns (`opsMetricDrilldown`) mapping every headline
 *      indicator back to the ELOS capabilities and governance artifacts that
 *      produce it.
 *   3. A readiness certificate snapshot (`buildReadinessSnapshot`) bundling the
 *      maturity certificate, value streams, AI governance and the latest gap
 *      matrix as exportable evidence.
 *
 * Pure functions only — no React, no Supabase. Persistence lives in
 * `opsHubAlertLog.ts` so this module stays unit-testable.
 */
import {
  ELOS_CAPABILITIES,
  ELOS_SHORT_NAME,
  certifyElos,
  type ElosCertification,
} from "./elos";
import {
  certifyLogisticsReadiness,
  logisticsGapMatrix,
  LOGISTICS_READINESS_VERSION,
  type LogisticsGapRow,
  type LogisticsReadinessCertificate,
} from "./logisticsReadiness";
import type { WorkspaceHealth } from "@/lib/workspaces/types";

export const OPS_HUB_INTELLIGENCE_VERSION = "1.0.0";
/** Audit stream written to `alerts_events.stream`. */
export const OPS_ALERT_STREAM = "logistics";

/* ------------------------------------------------------------------ */
/* 1 — Threshold evaluation                                            */
/* ------------------------------------------------------------------ */

export type OpsAlertSeverity = "info" | "warning" | "critical";

export interface OpsThresholdRule {
  /** Stable metric key — also the drilldown key. */
  metricKey: string;
  label: string;
  /** Breach when the observed value is below this threshold. */
  floor?: number;
  /** Breach when the observed value is above this threshold. */
  ceiling?: number;
  severity: OpsAlertSeverity;
}

export interface OpsAlert {
  metricKey: string;
  label: string;
  severity: OpsAlertSeverity;
  observed: number;
  threshold: number;
  operator: "lt" | "gt";
  message: string;
  /** Deterministic dedupe key — one row per metric/threshold/observed bucket. */
  idempotencyKey: string;
}

export const OPS_THRESHOLD_RULES: readonly OpsThresholdRule[] = [
  { metricKey: "workspace_health", label: "Workspace health", floor: 80, severity: "critical" },
  { metricKey: "elos_maturity", label: "ELOS maturity", floor: 85, severity: "warning" },
  { metricKey: "capability_activation", label: "Capability activation", floor: 90, severity: "warning" },
  { metricKey: "active_alerts", label: "Active operational alerts", ceiling: 0, severity: "warning" },
  { metricKey: "ai_confidence", label: "AI confidence", floor: 75, severity: "warning" },
  { metricKey: "logistics_readiness", label: "Logistics readiness", floor: 85, severity: "critical" },
  { metricKey: "value_stream_score", label: "Value stream certification", floor: 85, severity: "warning" },
  { metricKey: "ai_governance", label: "Logistics AI governance", floor: 85, severity: "warning" },
] as const;

export interface OpsMetricReading {
  metricKey: string;
  value: number;
}

/** Canonical readings shared by OpsHub tiles, the sidebar and the 360 surfaces. */
export function collectOpsReadings(
  health: Pick<WorkspaceHealth, "healthScore" | "activeAlerts" | "aiConfidence">,
  elos: ElosCertification = certifyElos(),
  readiness: LogisticsReadinessCertificate = certifyLogisticsReadiness(),
): OpsMetricReading[] {
  return [
    { metricKey: "workspace_health", value: health.healthScore },
    { metricKey: "elos_maturity", value: elos.score },
    { metricKey: "capability_activation", value: elos.activationRate },
    { metricKey: "active_alerts", value: health.activeAlerts },
    { metricKey: "ai_confidence", value: health.aiConfidence },
    { metricKey: "logistics_readiness", value: readiness.score },
    { metricKey: "value_stream_score", value: readiness.valueStreams.score },
    { metricKey: "ai_governance", value: readiness.aiGovernance.score },
  ];
}

export function evaluateOpsThresholds(readings: OpsMetricReading[]): OpsAlert[] {
  const byKey = new Map(readings.map((r) => [r.metricKey, r.value]));
  const alerts: OpsAlert[] = [];
  for (const rule of OPS_THRESHOLD_RULES) {
    const observed = byKey.get(rule.metricKey);
    if (observed === undefined || !Number.isFinite(observed)) continue;
    if (rule.floor !== undefined && observed < rule.floor) {
      alerts.push(makeAlert(rule, observed, rule.floor, "lt"));
    } else if (rule.ceiling !== undefined && observed > rule.ceiling) {
      alerts.push(makeAlert(rule, observed, rule.ceiling, "gt"));
    }
  }
  return alerts.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
}

function makeAlert(
  rule: OpsThresholdRule,
  observed: number,
  threshold: number,
  operator: "lt" | "gt",
): OpsAlert {
  const rounded = Math.round(observed);
  return {
    metricKey: rule.metricKey,
    label: rule.label,
    severity: rule.severity,
    observed,
    threshold,
    operator,
    message:
      operator === "lt"
        ? `${rule.label} at ${rounded} is below the ${threshold} threshold.`
        : `${rule.label} at ${rounded} exceeds the ${threshold} threshold.`,
    idempotencyKey: `ops-hub:${rule.metricKey}:${operator}:${threshold}:${rounded}`,
  };
}

function severityRank(s: OpsAlertSeverity): number {
  return s === "critical" ? 3 : s === "warning" ? 2 : 1;
}

/* ------------------------------------------------------------------ */
/* 2 — Capability registry drilldowns                                  */
/* ------------------------------------------------------------------ */

export interface OpsMetricDrilldown {
  metricKey: string;
  label: string;
  /** ELOS capabilities that produce the indicator. */
  capabilities: Array<{ id: string; label: string; stage: string; owner: string; kpi: string; surface: string }>;
  /** Governance artifacts backing the number. */
  artifacts: Array<{ label: string; href: string }>;
}

/** Capability ids (or pillar keys) each headline indicator resolves to. */
const METRIC_CAPABILITY_MAP: Record<string, { pillars?: string[]; ids?: string[] }> = {
  workspace_health: { pillars: ["movement", "visibility"] },
  elos_maturity: {},
  capability_activation: {},
  active_alerts: { pillars: ["visibility"] },
  ai_confidence: { pillars: ["intelligence"] },
  logistics_readiness: {},
  value_stream_score: { pillars: ["network", "movement", "specialised"] },
  ai_governance: { pillars: ["intelligence"] },
};

const REGISTRY_HREF = "/dashboard/admin/logistics-capabilities";

export function opsMetricDrilldown(metricKey: string): OpsMetricDrilldown | null {
  const rule = OPS_THRESHOLD_RULES.find((r) => r.metricKey === metricKey);
  if (!rule) return null;
  const spec = METRIC_CAPABILITY_MAP[metricKey] ?? {};
  const matched = ELOS_CAPABILITIES.filter((c) => {
    if (spec.ids?.includes(c.id)) return true;
    if (spec.pillars?.includes(c.pillar)) return true;
    return !spec.ids && !spec.pillars; // registry-wide indicators
  });
  return {
    metricKey,
    label: rule.label,
    capabilities: matched.slice(0, 8).map((c) => ({
      id: c.id,
      label: c.label,
      stage: c.stage,
      owner: c.owner,
      kpi: c.kpi,
      surface: c.surface,
    })),
    artifacts: [
      { label: `${ELOS_SHORT_NAME} capability registry`, href: REGISTRY_HREF },
      { label: "Logistics readiness certificate", href: "/dashboard/admin/logistics-center" },
      { label: "Onboarding & partner governance", href: "/dashboard/admin/logistics-onboarding" },
    ],
  };
}

/* ------------------------------------------------------------------ */
/* 3 — Readiness certificate snapshot export                           */
/* ------------------------------------------------------------------ */

export interface ReadinessSnapshot {
  version: string;
  readinessVersion: string;
  generatedAt: string;
  decision: LogisticsReadinessCertificate["decision"];
  score: number;
  fingerprint: string;
  elos: { score: number; capabilities: number; activationRate: number; passed: boolean };
  pillars: Array<{ dimension: string; label: string; score: number; gap: number; source: string }>;
  valueStreams: Array<{ id: string; name: string; owner: string; score: number; status: string; weakestCapability: string | null }>;
  aiGovernance: { score: number; services: number };
  gapMatrix: LogisticsGapRow[];
  blockers: string[];
  priorityActions: LogisticsReadinessCertificate["priorityActions"];
  readings: OpsMetricReading[];
  alerts: OpsAlert[];
}

export function buildReadinessSnapshot(input: {
  health: Pick<WorkspaceHealth, "healthScore" | "activeAlerts" | "aiConfidence">;
  elos?: ElosCertification;
  readiness?: LogisticsReadinessCertificate;
  generatedAt?: string;
}): ReadinessSnapshot {
  const elos = input.elos ?? certifyElos();
  const readiness = input.readiness ?? certifyLogisticsReadiness();
  const readings = collectOpsReadings(input.health, elos, readiness);
  return {
    version: OPS_HUB_INTELLIGENCE_VERSION,
    readinessVersion: LOGISTICS_READINESS_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    decision: readiness.decision,
    score: readiness.score,
    fingerprint: readiness.fingerprint,
    elos: {
      score: elos.score,
      capabilities: elos.capabilities,
      activationRate: elos.activationRate,
      passed: elos.passed,
    },
    pillars: readiness.pillars.map((p) => ({
      dimension: p.dimension,
      label: p.label,
      score: p.score,
      gap: p.gap,
      source: p.source,
    })),
    valueStreams: readiness.valueStreams.streams.map((s) => ({
      id: s.id,
      name: s.name,
      owner: s.owner,
      score: s.score,
      status: s.status,
      weakestCapability: s.weakestCapability?.label ?? null,
    })),
    aiGovernance: { score: readiness.aiGovernance.score, services: readiness.aiGovernance.services.length },
    gapMatrix: logisticsGapMatrix(readiness),
    blockers: readiness.blockers,
    priorityActions: readiness.priorityActions,
    readings,
    alerts: evaluateOpsThresholds(readings),
  };
}

/** Flat rows for the CSV evidence export (gap matrix + pillars + readings). */
export function snapshotEvidenceRows(snapshot: ReadinessSnapshot): Array<{
  section: string;
  area: string;
  owner: string;
  score: number;
  gap: number;
  detail: string;
}> {
  return [
    ...snapshot.pillars.map((p) => ({
      section: "readiness_pillar",
      area: p.label,
      owner: "Enterprise Platform",
      score: p.score,
      gap: p.gap,
      detail: p.source,
    })),
    ...snapshot.valueStreams.map((s) => ({
      section: "value_stream",
      area: s.name,
      owner: s.owner,
      score: s.score,
      gap: 100 - s.score,
      detail: `${s.status}${s.weakestCapability ? ` · constraint: ${s.weakestCapability}` : ""}`,
    })),
    ...snapshot.gapMatrix.map((g) => ({
      section: `gap_${g.kind}`,
      area: g.area,
      owner: g.owner,
      score: g.score,
      gap: g.gap,
      detail: g.finding,
    })),
    ...snapshot.readings.map((r) => ({
      section: "metric_reading",
      area: r.metricKey,
      owner: "Delivery Operations",
      score: r.value,
      gap: 0,
      detail: `Observed ${r.value}`,
    })),
  ];
}
