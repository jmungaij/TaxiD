/**
 * Executive alert dispatch — in-app toast + email/Slack fan-out for the
 * alerts produced by `executiveAlerts.ts`.
 *
 * Reuses the existing `alert-dispatch` edge function (same contract as
 * `src/lib/alertEngine.ts`) so routing, notification preferences and DLQ
 * handling stay in one place. Per-user preferences (`user_alert_prefs`)
 * decide toast vs email and silence non-critical alerts during quiet hours,
 * and every dispatch is recorded in `executive_alert_history` so the
 * Executive Command Centre can render an alert timeline.
 */
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { untypedDb } from "@/integrations/supabase/untyped";
import type { ExecAlert } from "@/lib/corporate/executiveAlerts";
import {
  alertIntegrationKey, loadUserAlertPrefs, resolveDelivery,
  type UserAlertPrefs,
} from "@/lib/corporate/userAlertPrefs";

const EXEC_ROLES = ["super_admin", "admin", "operations_admin", "finance_admin"];

async function recordHistory(
  alert: ExecAlert,
  channels: string[],
  userId: string | null,
): Promise<void> {
  try {
    await untypedDb.from("executive_alert_history").insert({
      alert_key: alert.key,
      kind: alert.kind,
      severity: alert.severity,
      title: alert.title,
      message: alert.message,
      metric_key: alert.metricKey,
      value: alert.value,
      integration_key: alertIntegrationKey(alert),
      channels,
      incident_ref: alert.key,
      created_by: userId,
    });
  } catch (e) {
    console.warn("executive alert history insert failed", e);
  }
}

export async function dispatchExecutiveAlert(
  alert: ExecAlert,
  prefs?: UserAlertPrefs | null,
): Promise<void> {
  const resolved = prefs === undefined ? await loadUserAlertPrefs() : prefs;
  const decision = resolved
    ? resolveDelivery(alert, resolved, new Date())
    : { toast: true, email: true as boolean };

  const label = `${alert.title} — ${alert.message}`;
  const channels: string[] = [];

  if (decision.toast) {
    channels.push("toast");
    if (alert.severity === "critical") toast.error(label);
    else toast.warning(label);
  }

  if (decision.email) {
    channels.push("email");
    try {
      await supabase.functions.invoke("alert-dispatch", {
        body: {
          rule_name: `executive.${alert.kind}`,
          severity: alert.severity,
          message: label,
          is_test: false,
          channels: ["email"],
          target_roles: EXEC_ROLES,
          email_recipients: [],
          metadata: { metric_key: alert.metricKey, value: alert.value, alert_key: alert.key },
        },
      });
    } catch (e) {
      console.warn("executive alert-dispatch failed", e);
    }
  }

  await recordHistory(alert, channels, resolved?.user_id ?? null);
}

export async function dispatchExecutiveAlerts(alerts: ExecAlert[]): Promise<void> {
  if (alerts.length === 0) return;
  const prefs = await loadUserAlertPrefs();
  for (const a of alerts) await dispatchExecutiveAlert(a, prefs);
}
