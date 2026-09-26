/**
 * Configurable SLA escalation for the Flight Hub Operations Center.
 *
 * Targets are per priority (hours). When a queue item consumes more than
 * `escalateAtPct` of its target it is automatically bumped one priority level
 * (P3 → P2 → P1) so near-breach work surfaces before it breaches.
 */
export type Priority = "p1" | "p2" | "p3";

export interface SlaConfig {
  p1: number;
  p2: number;
  p3: number;
  /** Percentage of the target consumed before auto-escalation kicks in. */
  escalateAtPct: number;
}

export const DEFAULT_SLA_CONFIG: SlaConfig = { p1: 2, p2: 8, p3: 24, escalateAtPct: 75 };

const STORAGE_KEY = "yalla.flighthub.sla";

export function loadSlaConfig(): SlaConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SLA_CONFIG;
    const parsed = JSON.parse(raw) as Partial<SlaConfig>;
    return sanitiseSlaConfig({ ...DEFAULT_SLA_CONFIG, ...parsed });
  } catch {
    return DEFAULT_SLA_CONFIG;
  }
}

export function saveSlaConfig(config: SlaConfig) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitiseSlaConfig(config))); } catch { /* non-fatal */ }
}

const clamp = (v: number, min: number, max: number, fallback: number) =>
  Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

export function sanitiseSlaConfig(config: SlaConfig): SlaConfig {
  return {
    p1: clamp(config.p1, 0.25, 168, DEFAULT_SLA_CONFIG.p1),
    p2: clamp(config.p2, 0.25, 168, DEFAULT_SLA_CONFIG.p2),
    p3: clamp(config.p3, 0.25, 336, DEFAULT_SLA_CONFIG.p3),
    escalateAtPct: clamp(config.escalateAtPct, 10, 100, DEFAULT_SLA_CONFIG.escalateAtPct),
  };
}

const BUMP: Record<Priority, Priority> = { p3: "p2", p2: "p1", p1: "p1" };

export interface SlaTicketInput {
  priority: Priority;
  openedAt: string;
}

export interface SlaAssessment<T> {
  item: T;
  /** Priority the item was raised at. */
  basePriority: Priority;
  /** Priority after automatic escalation. */
  priority: Priority;
  escalated: boolean;
  ageHours: number;
  targetHours: number;
  consumedPct: number;
  nearBreach: boolean;
  breached: boolean;
  /** 100 = fresh, 0 = target fully consumed. */
  health: number;
}

export function assessSla<T extends SlaTicketInput>(
  item: T,
  config: SlaConfig,
  now = Date.now(),
): SlaAssessment<T> {
  const base = item.priority;
  const baseTarget = config[base];
  const age = Math.max(0, (now - Date.parse(item.openedAt)) / 3_600_000);
  const consumedPct = baseTarget > 0 ? (age / baseTarget) * 100 : 100;
  const breached = consumedPct >= 100;
  const nearBreach = !breached && consumedPct >= config.escalateAtPct;
  const priority = nearBreach || breached ? BUMP[base] : base;
  return {
    item,
    basePriority: base,
    priority,
    escalated: priority !== base,
    ageHours: age,
    targetHours: baseTarget,
    consumedPct: Math.round(consumedPct),
    nearBreach,
    breached,
    health: Math.max(0, 100 - Math.round(consumedPct)),
  };
}

/** Assess a queue and sort it most-urgent first. */
export function escalateQueue<T extends SlaTicketInput>(
  items: T[],
  config: SlaConfig,
  now = Date.now(),
): SlaAssessment<T>[] {
  const order: Record<Priority, number> = { p1: 0, p2: 1, p3: 2 };
  return items
    .map((i) => assessSla(i, config, now))
    .sort((a, b) => order[a.priority] - order[b.priority] || b.consumedPct - a.consumedPct);
}
