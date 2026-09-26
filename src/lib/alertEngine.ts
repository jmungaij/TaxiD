/**
 * Executive Alert Engine — evaluates configurable rules against live metric
 * snapshots, fires sonner toasts, dispatches to configured channels
 * (toast / email / Slack) routed by exec role, and writes immutable rows
 * to alerts_events.
 */
import { supabase } from "@/integrations/supabase/client";
import { untypedDb } from "@/integrations/supabase/untyped";
import { toast } from "sonner";

export type AlertStream = "trip" | "driver" | "finance";
export type AlertOp = "gt" | "gte" | "lt" | "lte" | "eq" | "anomaly";
export type AlertChannel = "toast" | "email" | "slack";

export interface AlertRule {
  id: string;
  name: string;
  stream: AlertStream;
  metric_key: string;
  operator: AlertOp;
  threshold: number | null;
  window_seconds: number;
  severity: "info" | "warning" | "critical";
  enabled: boolean;
  notify_toast: boolean;
  notify_email: boolean;
  notify_slack: boolean;
  cooldown_seconds: number;
  target_roles: string[];
  notification_channels: AlertChannel[];
  slack_webhook_url: string | null;
  email_recipients: string[];
  test_mode: boolean;
}

let cache: AlertRule[] = [];
const lastFired = new Map<string, number>();
let loaded = false;
let channelBound = false;

function normalise(row: any): AlertRule {
  return {
    ...row,
    target_roles: Array.isArray(row.target_roles) ? row.target_roles : [],
    notification_channels: Array.isArray(row.notification_channels)
      ? row.notification_channels
      : ["toast"],
    email_recipients: Array.isArray(row.email_recipients) ? row.email_recipients : [],
  };
}

export async function loadAlertRules(): Promise<AlertRule[]> {
  const { data } = await untypedDb
    .from("executive_alert_rules")
    .select("*")
    .eq("enabled", true);
  if (data) cache = (data as any[]).map(normalise);
  loaded = true;
  if (!channelBound) {
    channelBound = true;
    supabase
      .channel("alert-rules-sync")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "executive_alert_rules" },
        () => { void loadAlertRules(); }
      )
      .subscribe();
  }
  return cache;
}

function compare(op: AlertOp, value: number, threshold: number | null): boolean {
  if (op === "anomaly" || threshold == null) return false;
  switch (op) {
    case "gt": return value > threshold;
    case "gte": return value >= threshold;
    case "lt": return value < threshold;
    case "lte": return value <= threshold;
    case "eq": return value === threshold;
  }
  return false;
}

async function dispatchChannels(rule: AlertRule, message: string, isTest: boolean) {
  const dispatched: AlertChannel[] = [];
  const channels = new Set<AlertChannel>(rule.notification_channels);
  if (rule.notify_toast) channels.add("toast");
  if (rule.notify_email) channels.add("email");
  if (rule.notify_slack) channels.add("slack");

  if (channels.has("toast")) {
    const label = isTest ? `[TEST] ${message}` : message;
    if (rule.severity === "critical") toast.error(label);
    else if (rule.severity === "warning") toast.warning(label);
    else toast.info(label);
    dispatched.push("toast");
  }

  if (channels.has("email") || channels.has("slack")) {
    try {
      await supabase.functions.invoke("alert-dispatch", {
        body: {
          rule_id: rule.id,
          rule_name: rule.name,
          severity: rule.severity,
          message,
          is_test: isTest,
          channels: Array.from(channels).filter((c) => c !== "toast"),
          target_roles: rule.target_roles,
          email_recipients: rule.email_recipients,
          slack_webhook_url: rule.slack_webhook_url,
        },
      });
      if (channels.has("email")) dispatched.push("email");
      if (channels.has("slack")) dispatched.push("slack");
    } catch (e) {
      console.warn("alert-dispatch failed", e);
    }
  }
  return dispatched;
}

export interface MetricSnapshot {
  stream: AlertStream;
  metric_key: string;
  value: number;
  context?: Record<string, unknown>;
}

async function recordEvent(
  rule: AlertRule,
  snapshot: { value: number | null; context?: Record<string, unknown> },
  message: string,
  dispatched: AlertChannel[],
  isTest: boolean,
) {
  await untypedDb.from("alerts_events").insert({
    rule_id: rule.id,
    rule_name: rule.name,
    stream: rule.stream,
    metric_key: rule.metric_key,
    observed_value: snapshot.value,
    threshold: rule.threshold,
    operator: rule.operator,
    severity: rule.severity,
    message,
    context: snapshot.context ?? {},
    is_test: isTest,
    channels_dispatched: dispatched,
  });
}

export async function evaluateMetric(snapshot: MetricSnapshot) {
  if (!loaded) await loadAlertRules();
  const now = Date.now();
  for (const rule of cache) {
    if (!rule.enabled || rule.test_mode) continue;
    if (rule.stream !== snapshot.stream) continue;
    if (rule.metric_key !== snapshot.metric_key) continue;
    if (!compare(rule.operator, snapshot.value, rule.threshold)) continue;

    const last = lastFired.get(rule.id) ?? 0;
    if (now - last < rule.cooldown_seconds * 1000) continue;
    lastFired.set(rule.id, now);

    const message = `${rule.name}: ${snapshot.metric_key}=${snapshot.value} ${rule.operator} ${rule.threshold}`;
    const dispatched = await dispatchChannels(rule, message, false);
    void recordEvent(rule, snapshot, message, dispatched, false);
  }
}

/** Manually simulate a rule firing — used by the AlertRules test mode. */
export async function simulateRule(ruleId: string, simulatedValue?: number) {
  if (!loaded) await loadAlertRules();
  const rule = cache.find((r) => r.id === ruleId);
  if (!rule) {
    // try to refetch unconditionally (rule may be disabled)
    const { data } = await untypedDb
      .from("executive_alert_rules").select("*").eq("id", ruleId).maybeSingle();
    if (!data) throw new Error("Rule not found");
    const r = normalise(data) as AlertRule;
    return runSimulation(r, simulatedValue);
  }
  return runSimulation(rule, simulatedValue);
}

async function runSimulation(rule: AlertRule, simulatedValue?: number) {
  const value = simulatedValue ?? (rule.threshold != null ? rule.threshold + 1 : 1);
  const message = `[TEST] ${rule.name}: simulated ${rule.metric_key}=${value} ${rule.operator} ${rule.threshold}`;
  const dispatched = await dispatchChannels(rule, message, true);
  await recordEvent(
    rule,
    { value, context: { simulated: true } },
    message,
    dispatched,
    true,
  );
  return { dispatched, message };
}
