/**
 * Per-user alert delivery preferences.
 *
 * `alert_notification_prefs` decides which *roles* receive alerts; this module
 * decides how the *signed-in person* receives them: toast only, email only,
 * both, or nothing — plus quiet hours during which non-critical alerts are
 * silenced.
 *
 * Pure resolution lives here so it is unit-testable; `executiveAlertDispatch`
 * loads the row and applies it.
 */
import { supabase } from "@/integrations/supabase/client";
import { untypedDb } from "@/integrations/supabase/untyped";
import type { ExecAlert, ExecAlertKind } from "@/lib/corporate/executiveAlerts";

export interface UserAlertPrefs {
  user_id: string;
  sla_toast: boolean;
  sla_email: boolean;
  integration_toast: boolean;
  integration_email: boolean;
  circuit_toast: boolean;
  circuit_email: boolean;
  /** Alerts below this severity are dropped entirely. */
  min_severity: "warning" | "critical";
  /** Integration keys the user muted (e.g. `mpesa`). */
  muted_integrations: string[];
  quiet_hours_enabled: boolean;
  /** Minutes past local midnight (0-1439). */
  quiet_start_minute: number;
  quiet_end_minute: number;
  /** Critical alerts still break through quiet hours when true. */
  quiet_allow_critical: boolean;
  /** Show decision requests on blocked work in the in-app notification inbox. */
  decision_request_portal: boolean;
  /** Also email the decision owner when a decision is requested. */
  decision_request_email: boolean;
}

export const DEFAULT_USER_ALERT_PREFS: Omit<UserAlertPrefs, "user_id"> = {
  sla_toast: true,
  sla_email: true,
  integration_toast: true,
  integration_email: true,
  circuit_toast: true,
  circuit_email: false,
  min_severity: "warning",
  muted_integrations: [],
  quiet_hours_enabled: false,
  quiet_start_minute: 21 * 60,
  quiet_end_minute: 7 * 60,
  quiet_allow_critical: true,
  decision_request_portal: true,
  decision_request_email: false,
};

const CHANNEL_KEYS: Record<ExecAlertKind, { toast: keyof UserAlertPrefs; email: keyof UserAlertPrefs }> = {
  sla_degraded: { toast: "sla_toast", email: "sla_email" },
  integration_incident: { toast: "integration_toast", email: "integration_email" },
  circuit_degraded: { toast: "circuit_toast", email: "circuit_email" },
};

export const ALERT_KIND_LABEL: Record<ExecAlertKind, string> = {
  sla_degraded: "Service-level degradation",
  integration_incident: "Integration incident",
  circuit_degraded: "Circuit-breaker degraded mode",
};

/** Extracts the affected integration key from an alert key, when present. */
export function alertIntegrationKey(alert: Pick<ExecAlert, "key" | "metricKey">): string | null {
  const fromKey = /^integration:(?:down|degraded):(.+)$/.exec(alert.key);
  if (fromKey) return fromKey[1];
  const fromMetric = /^integration\.([^.]+)\./.exec(alert.metricKey);
  if (fromMetric && fromMetric[1] !== "posture") return fromMetric[1];
  return null;
}

export function minutesOfDay(at: Date): number {
  return at.getHours() * 60 + at.getMinutes();
}

/** True when `at` falls inside the configured quiet window (wrap-around safe). */
export function inQuietHours(prefs: UserAlertPrefs, at: Date = new Date()): boolean {
  if (!prefs.quiet_hours_enabled) return false;
  const now = minutesOfDay(at);
  const { quiet_start_minute: start, quiet_end_minute: end } = prefs;
  if (start === end) return false;
  return start < end ? now >= start && now < end : now >= start || now < end;
}

export interface DeliveryDecision {
  toast: boolean;
  email: boolean;
  /** Set when nothing is delivered, for logging/UI transparency. */
  reason?: "below_min_severity" | "integration_muted" | "quiet_hours" | "channels_off";
}

/** Resolves how one alert should reach this user. */
export function resolveDelivery(
  alert: ExecAlert,
  prefs: UserAlertPrefs,
  at: Date = new Date(),
): DeliveryDecision {
  if (prefs.min_severity === "critical" && alert.severity !== "critical") {
    return { toast: false, email: false, reason: "below_min_severity" };
  }

  const integration = alertIntegrationKey(alert);
  if (integration && prefs.muted_integrations.includes(integration)) {
    return { toast: false, email: false, reason: "integration_muted" };
  }

  const quiet = inQuietHours(prefs, at);
  if (quiet && !(prefs.quiet_allow_critical && alert.severity === "critical")) {
    return { toast: false, email: false, reason: "quiet_hours" };
  }

  const keys = CHANNEL_KEYS[alert.kind];
  const toast = Boolean(prefs[keys.toast]);
  const email = Boolean(prefs[keys.email]);
  if (!toast && !email) return { toast: false, email: false, reason: "channels_off" };
  return { toast, email };
}

function normalise(row: Record<string, unknown>, userId: string): UserAlertPrefs {
  const muted = row.muted_integrations;
  return {
    ...DEFAULT_USER_ALERT_PREFS,
    ...(row as Partial<UserAlertPrefs>),
    user_id: userId,
    muted_integrations: Array.isArray(muted) ? muted.map(String) : [],
  } as UserAlertPrefs;
}

/** Loads the signed-in user's preferences, falling back to the defaults. */
export async function loadUserAlertPrefs(): Promise<UserAlertPrefs | null> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth?.user?.id;
  if (!userId) return null;
  const { data } = await untypedDb
    .from("user_alert_prefs")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  return data ? normalise(data as Record<string, unknown>, userId) : { ...DEFAULT_USER_ALERT_PREFS, user_id: userId };
}

export async function saveUserAlertPrefs(prefs: UserAlertPrefs): Promise<{ error?: string }> {
  const { error } = await untypedDb
    .from("user_alert_prefs")
    .upsert({ ...prefs, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  return error ? { error: error.message } : {};
}

/** `13:45` style label for a minute-of-day value. */
export function formatMinuteOfDay(minute: number): string {
  const m = ((minute % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function parseMinuteOfDay(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}
