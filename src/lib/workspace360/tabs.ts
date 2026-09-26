/**
 * Canonical Workspace 360 tab registry (Phase D7.0).
 * Every 360 workspace exposes the same 11-tab surface. Domains may
 * hide tabs they do not yet back with data, but no domain may
 * invent new tab identifiers.
 */
export const WORKSPACE360_TABS = [
  "overview",
  "financial",
  "timeline",
  "documents",
  "compliance",
  "performance",
  "support",
  "analytics",
  "twin",
  "audit",
  "settings",
] as const;

export type Workspace360Tab = (typeof WORKSPACE360_TABS)[number];

export const WORKSPACE360_DEFAULT_TAB: Workspace360Tab = "overview";

const TAB_SET: ReadonlySet<string> = new Set(WORKSPACE360_TABS);

export function isWorkspace360Tab(value: unknown): value is Workspace360Tab {
  return typeof value === "string" && TAB_SET.has(value);
}

export function normalizeWorkspace360Tab(value: unknown): Workspace360Tab {
  return isWorkspace360Tab(value) ? value : WORKSPACE360_DEFAULT_TAB;
}

export const WORKSPACE360_TAB_LABELS: Record<Workspace360Tab, string> = {
  overview: "Overview",
  financial: "Financial",
  timeline: "Timeline",
  documents: "Documents",
  compliance: "Compliance",
  performance: "Performance",
  support: "Support",
  analytics: "Analytics",
  twin: "Digital Twin",
  audit: "Audit",
  settings: "Settings",
};
