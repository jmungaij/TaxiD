/**
 * Executive alerting — pure evaluation of an `ExecutiveSnapshot` into
 * actionable alerts for service-level degradation, integration health
 * incidents and integrations that dropped into degraded (circuit-breaker)
 * mode.
 *
 * Pure: no toasts, no network. `src/lib/corporate/executiveAlertDispatch.ts`
 * performs the in-app + email dispatch so this file stays unit-testable.
 */
import type { ExecutiveSnapshot } from "@/lib/corporate/executiveCommand";

export type ExecAlertKind = "sla_degraded" | "integration_incident" | "circuit_degraded";
export type ExecAlertSeverity = "warning" | "critical";

export interface ExecAlert {
  /** Stable dedupe key — same condition produces the same key. */
  key: string;
  kind: ExecAlertKind;
  severity: ExecAlertSeverity;
  title: string;
  message: string;
  metricKey: string;
  value: number | null;
}

export interface ExecAlertThresholds {
  /** Compliance below this is a warning. */
  slaWarnPct: number;
  /** Compliance below this is critical. */
  slaCriticalPct: number;
}

export const DEFAULT_EXEC_THRESHOLDS: ExecAlertThresholds = {
  slaWarnPct: 95,
  slaCriticalPct: 85,
};

/** Evaluates a snapshot into the alerts that should fire right now. */
export function evaluateExecutiveAlerts(
  snapshot: ExecutiveSnapshot,
  thresholds: ExecAlertThresholds = DEFAULT_EXEC_THRESHOLDS,
): ExecAlert[] {
  const alerts: ExecAlert[] = [];
  const { sla, integrations, posture } = snapshot;

  if (sla.total > 0 && sla.compliancePct != null && sla.compliancePct < thresholds.slaWarnPct) {
    const critical = sla.compliancePct < thresholds.slaCriticalPct;
    alerts.push({
      key: `sla:${critical ? "critical" : "warning"}`,
      kind: "sla_degraded",
      severity: critical ? "critical" : "warning",
      metricKey: "corporate.sla.compliance_pct",
      value: sla.compliancePct,
      title: `Service-level compliance ${sla.compliancePct.toFixed(1)}%`,
      message:
        `Approval SLA compliance is ${sla.compliancePct.toFixed(1)}% ` +
        `(${sla.breached} breached, ${sla.openOverdue} open overdue of ${sla.total} tracked).`,
    });
  }

  for (const row of integrations) {
    if (row.status === "down") {
      alerts.push({
        key: `integration:down:${row.key}`,
        kind: "integration_incident",
        severity: "critical",
        metricKey: `integration.${row.key}.success_rate_pct`,
        value: row.successRatePct,
        title: `${row.label} integration incident`,
        message:
          `${row.label} success rate is ${row.successRatePct == null ? "unknown" : `${row.successRatePct.toFixed(1)}%`}` +
          ` across ${row.calls} calls. Fallback: ${row.degradedMode}.`,
      });
    } else if (row.status === "degraded") {
      alerts.push({
        key: `integration:degraded:${row.key}`,
        kind: "circuit_degraded",
        severity: "warning",
        metricKey: `integration.${row.key}.success_rate_pct`,
        value: row.successRatePct,
        title: `${row.label} entered degraded mode`,
        message:
          `${row.label} is degraded at ${row.successRatePct == null ? "unknown" : `${row.successRatePct.toFixed(1)}%`}` +
          ` success. Circuit-breaker fallback active: ${row.degradedMode}.`,
      });
    }
  }

  if (posture.down > 0) {
    alerts.push({
      key: "posture:down",
      kind: "circuit_degraded",
      severity: "critical",
      metricKey: "integration.posture.down_count",
      value: posture.down,
      title: `${posture.down} integration(s) down`,
      message: `Platform integration posture is ${posture.status}: ${posture.down} down, ${posture.degraded} degraded.`,
    });
  }

  return alerts;
}

export const EXEC_ALERT_COOLDOWN_MS = 15 * 60_000;

/**
 * Filters alerts that are outside their cooldown window and records the fire
 * time. `seen` is mutated so callers can hold it in a ref across renders.
 */
export function selectAlertsToFire(
  alerts: ExecAlert[],
  seen: Map<string, number>,
  now = Date.now(),
  cooldownMs = EXEC_ALERT_COOLDOWN_MS,
): ExecAlert[] {
  const fire: ExecAlert[] = [];
  for (const a of alerts) {
    const last = seen.get(a.key) ?? 0;
    if (now - last < cooldownMs) continue;
    seen.set(a.key, now);
    fire.push(a);
  }
  return fire;
}
