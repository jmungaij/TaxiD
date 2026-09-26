/**
 * Per-role alert notification preferences.
 *
 * `alert_notification_prefs` holds one row per role: which channels that role
 * receives (email / Slack) and which severities are enabled. `alert-dispatch`
 * mirrors this module in `supabase/functions/_shared/notification-prefs.ts`
 * and applies it before resolving recipients, so muting a role in the admin
 * dashboard actually stops the notification.
 */

export type AlertSeverity = "info" | "warning" | "critical";

export const ALERT_SEVERITIES: AlertSeverity[] = ["info", "warning", "critical"];

export interface NotificationPref {
  role: string;
  email_enabled: boolean;
  slack_enabled: boolean;
  severity_info: boolean;
  severity_warning: boolean;
  severity_critical: boolean;
  slack_webhook_url?: string | null;
}

export interface PrefResolution {
  /** Roles that should receive an email for this severity. */
  emailRoles: string[];
  /** Roles that should receive a Slack ping for this severity. */
  slackRoles: string[];
  /** Channels left after applying preferences. */
  channels: string[];
  /** Extra Slack webhooks configured per role. */
  slackWebhooks: string[];
  /** True when every requested role/channel was muted. */
  suppressed: boolean;
}

export function severityEnabled(pref: NotificationPref, severity: string): boolean {
  switch (severity) {
    case "critical": return pref.severity_critical;
    case "warning": return pref.severity_warning;
    case "info": return pref.severity_info;
    // Unknown severities are treated as at least warning-grade.
    default: return pref.severity_warning;
  }
}

/**
 * Applies per-role preferences to a dispatch request.
 * Roles with no stored preference row keep the caller's requested behaviour
 * (fail-open) — a missing row must never silently drop a critical alert.
 */
export function applyNotificationPrefs(input: {
  requestedRoles: string[];
  requestedChannels: string[];
  severity: string;
  prefs: NotificationPref[];
}): PrefResolution {
  const byRole = new Map(input.prefs.map((p) => [p.role, p]));
  const wantsEmail = input.requestedChannels.includes("email");
  const wantsSlack = input.requestedChannels.includes("slack");

  const emailRoles: string[] = [];
  const slackRoles: string[] = [];
  const slackWebhooks = new Set<string>();

  for (const role of input.requestedRoles) {
    const pref = byRole.get(role);
    if (!pref) {
      if (wantsEmail) emailRoles.push(role);
      if (wantsSlack) slackRoles.push(role);
      continue;
    }
    if (!severityEnabled(pref, input.severity)) continue;
    if (wantsEmail && pref.email_enabled) emailRoles.push(role);
    if (wantsSlack && pref.slack_enabled) {
      slackRoles.push(role);
      if (pref.slack_webhook_url) slackWebhooks.add(pref.slack_webhook_url);
    }
  }

  const channels: string[] = [];
  if (wantsEmail && emailRoles.length) channels.push("email");
  if (wantsSlack && slackRoles.length) channels.push("slack");

  return {
    emailRoles,
    slackRoles,
    channels,
    slackWebhooks: Array.from(slackWebhooks),
    suppressed: channels.length === 0,
  };
}
