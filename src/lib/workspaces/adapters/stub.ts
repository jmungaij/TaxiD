/**
 * Deterministic stub adapter — default for every workspace until its
 * dedicated Supabase-backed adapter ships in Turn 2.
 *
 * Behaviour:
 *   - Same input (key + hour) → same output (stable across renders).
 *   - Ticks once per minute so the UI feels alive without DB traffic.
 *   - `connectionState: "stub"` so the sidebar can badge sample data.
 */
import type { WorkspaceHealth, WorkspaceKey, WorkspaceKpi, WorkspaceStatus } from "../types";
import type { WorkspaceHealthAdapter } from "./types";

// FNV-1a → 0..1
function seed(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

function currentBucket(): number {
  return Math.floor(Date.now() / (60 * 60 * 1000));
}

function primaryKpiFor(key: WorkspaceKey, s: number): WorkspaceKpi {
  switch (key) {
    case "executive":          return { label: "Revenue",       value: `KES ${(3 + s * 3).toFixed(1)}M` };
    case "operations":         return { label: "Active trips",  value: `${Math.round(120 + s * 100)}` };
    case "people_partners":    return { label: "Online now",    value: `${Math.round(3800 + s * 1200)}` };
    case "marketplace":        return { label: "Demand idx",    value: `${(1 + s).toFixed(2)}x` };
    case "delivery_logistics": return { label: "Packages live", value: `${Math.round(180 + s * 220)}` };
    case "fleet":              return { label: "Vehicles up",   value: `${Math.round(420 + s * 180)}` };
    case "finance":            return { label: "Success rate",  value: `${(97 + s * 2.5).toFixed(1)}%` };
    case "trust_safety":       return { label: "Open cases",    value: `${Math.floor(s * 12)}` };
    case "analytics_ai":       return { label: "Models live",   value: `${Math.round(4 + s * 6)}` };
    case "administration":     return { label: "Approvals",     value: `${Math.floor(s * 24)}` };
    case "platform":           return { label: "Uptime",        value: `${(99.8 + s * 0.2).toFixed(2)}%` };
    case "super_admin":        return { label: "Tenants",       value: `${Math.round(3 + s * 4)}` };
  }
}

function secondaryKpiFor(key: WorkspaceKey, s: number): WorkspaceKpi {
  switch (key) {
    case "executive":          return { label: "Trips today",   value: `${Math.round(4200 + s * 1800)}` };
    case "operations":         return { label: "Dispatch queue",value: `${Math.round(s * 40)}` };
    case "people_partners":    return { label: "Drivers online",value: `${Math.round(1200 + s * 400)}` };
    case "marketplace":        return { label: "Surge zones",   value: `${Math.round(s * 8)}` };
    case "delivery_logistics": return { label: "POD pending",   value: `${Math.round(s * 30)}` };
    case "fleet":              return { label: "Maintenance",   value: `${Math.round(s * 24)}` };
    case "finance":            return { label: "Settlement q",  value: `${Math.round(s * 60)}` };
    case "trust_safety":       return { label: "KYC pending",   value: `${Math.round(s * 40)}` };
    case "analytics_ai":       return { label: "Reports ready", value: `${Math.round(s * 24)}` };
    case "administration":     return { label: "Users",         value: `${Math.round(240 + s * 60)}` };
    case "platform":           return { label: "Queue depth",   value: `${Math.round(s * 500)}` };
    case "super_admin":        return { label: "Env flags",     value: `${Math.round(s * 6)}` };
  }
}

function build(key: WorkspaceKey, bucket: number): WorkspaceHealth {
  const s1 = seed(`${key}:${bucket}:health`);
  const s2 = seed(`${key}:${bucket}:alerts`);
  const s3 = seed(`${key}:${bucket}:trend`);
  const s4 = seed(`${key}:${bucket}:kpi`);
  const s5 = seed(`${key}:${bucket}:ai`);

  const healthScore = Math.round(88 + s1 * 12);
  const activeAlerts = Math.floor(s2 * 5);
  const trend = Math.round((s3 * 24 - 8) * 10) / 10;
  const aiConfidence = Math.round(90 + s5 * 10);

  const status: WorkspaceStatus =
    healthScore >= 96 ? "healthy" :
    healthScore >= 90 ? "attention" :
    "critical";

  return {
    key,
    healthScore,
    status,
    activeAlerts,
    trend,
    primaryKpi: primaryKpiFor(key, s4),
    secondaryKpi: secondaryKpiFor(key, s4),
    aiConfidence,
    lastUpdated: new Date().toISOString(),
    connectionState: "stub",
    source: key,
  };
}

export function makeStubAdapter(key: WorkspaceKey): WorkspaceHealthAdapter {
  return {
    key,
    snapshot() {
      return build(key, currentBucket());
    },
    subscribe(onChange) {
      // Emit an immediate value and tick once per minute.
      onChange(build(key, currentBucket()));
      const id = window.setInterval(() => {
        onChange(build(key, currentBucket()));
      }, 60_000);
      return () => window.clearInterval(id);
    },
  };
}
