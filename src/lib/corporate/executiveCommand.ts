/**
 * Executive Command Centre aggregation.
 *
 * Pure functions only: the page fetches production rows and this module turns
 * them into the seven executive signals (revenue today, bookings today, active
 * vehicles, service-level compliance, conversion funnel, contract pipeline and
 * integration health). No network, no Date.now() without an injectable `now`.
 */
import { summarisePipeline, type CrmOpportunity, type PipelineSummary } from "./crmPipeline";
import { INTEGRATION_POLICIES, type IntegrationKey } from "@/lib/platform/integrationResilience";

export const dayKey = (iso: string | number | Date): string =>
  new Date(iso).toISOString().slice(0, 10);

export const isSameDay = (iso: string | null | undefined, now: number): boolean =>
  !!iso && dayKey(iso) === dayKey(now);

/* ------------------------------------------------------------------ revenue */

export interface RevenueRow {
  id: string;
  totalKes: number;
  paidKes?: number;
  status?: string | null;
  at: string;
}

export interface RevenueToday {
  invoicedKes: number;
  collectedKes: number;
  outstandingKes: number;
  invoiceCount: number;
  avgInvoiceKes: number;
  deltaVsYesterdayPct: number | null;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function revenueToday(rows: RevenueRow[], now = Date.now()): RevenueToday {
  const today = rows.filter((r) => isSameDay(r.at, now));
  const yesterday = rows.filter((r) => isSameDay(r.at, now - 86_400_000));
  const invoiced = sum(today.map((r) => r.totalKes));
  const collected = sum(today.map((r) => r.paidKes ?? 0));
  const prior = sum(yesterday.map((r) => r.totalKes));
  return {
    invoicedKes: invoiced,
    collectedKes: collected,
    outstandingKes: Math.max(0, invoiced - collected),
    invoiceCount: today.length,
    avgInvoiceKes: today.length ? invoiced / today.length : 0,
    deltaVsYesterdayPct: prior > 0 ? ((invoiced - prior) / prior) * 100 : null,
  };
}

/* ----------------------------------------------------------------- bookings */

export interface BookingRowLite {
  id: string;
  createdAt: string;
  scheduledFor?: string | null;
  status: string;
  fareKes: number;
  corporateId?: string | null;
}

export interface BookingsToday {
  created: number;
  scheduled: number;
  completed: number;
  cancelled: number;
  pending: number;
  grossValueKes: number;
  cancellationRatePct: number;
}

const COMPLETED = new Set(["approved", "completed", "fulfilled", "won"]);
const CANCELLED = new Set(["rejected", "cancelled", "canceled", "expired", "lost"]);

export function bookingsToday(rows: BookingRowLite[], now = Date.now()): BookingsToday {
  const today = rows.filter((r) => isSameDay(r.createdAt, now));
  const completed = today.filter((r) => COMPLETED.has(r.status)).length;
  const cancelled = today.filter((r) => CANCELLED.has(r.status)).length;
  return {
    created: today.length,
    scheduled: rows.filter((r) => isSameDay(r.scheduledFor ?? null, now)).length,
    completed,
    cancelled,
    pending: today.length - completed - cancelled,
    grossValueKes: sum(today.map((r) => r.fareKes)),
    cancellationRatePct: today.length ? (cancelled / today.length) * 100 : 0,
  };
}

/* ---------------------------------------------------------- active vehicles */

export interface VehicleStateRow {
  id: string;
  state: string;
  type?: string | null;
}

export interface ActiveVehicles {
  total: number;
  active: number;
  offline: number;
  maintenance: number;
  activePct: number;
  byType: Array<{ type: string; total: number; active: number }>;
}

const ACTIVE_STATES = new Set(["active", "available", "on_trip", "assigned", "en_route"]);
const MAINTENANCE_STATES = new Set(["maintenance", "servicing", "repair", "grounded"]);

export function activeVehicles(rows: VehicleStateRow[]): ActiveVehicles {
  const active = rows.filter((v) => ACTIVE_STATES.has(v.state)).length;
  const maintenance = rows.filter((v) => MAINTENANCE_STATES.has(v.state)).length;
  const byTypeMap = new Map<string, { type: string; total: number; active: number }>();
  for (const v of rows) {
    const type = v.type || "unclassified";
    const cur = byTypeMap.get(type) ?? { type, total: 0, active: 0 };
    cur.total += 1;
    if (ACTIVE_STATES.has(v.state)) cur.active += 1;
    byTypeMap.set(type, cur);
  }
  return {
    total: rows.length,
    active,
    maintenance,
    offline: Math.max(0, rows.length - active - maintenance),
    activePct: rows.length ? (active / rows.length) * 100 : 0,
    byType: [...byTypeMap.values()].sort((a, b) => b.total - a.total),
  };
}

/* -------------------------------------------------- service-level compliance */

export interface SlaSample {
  id: string;
  label?: string;
  openedAt: string;
  dueAt: string | null;
  closedAt: string | null;
}

export type SlaBand = "excellent" | "on_target" | "at_risk" | "breaching";

export interface SlaCompliance {
  total: number;
  onTime: number;
  breached: number;
  openOverdue: number;
  compliancePct: number;
  band: SlaBand;
  worst: Array<{ id: string; label: string; overdueHours: number }>;
}

export function slaBandOf(pct: number): SlaBand {
  if (pct >= 98) return "excellent";
  if (pct >= 95) return "on_target";
  if (pct >= 90) return "at_risk";
  return "breaching";
}

export function slaCompliance(samples: SlaSample[], now = Date.now()): SlaCompliance {
  let onTime = 0;
  let breached = 0;
  let openOverdue = 0;
  const worst: Array<{ id: string; label: string; overdueHours: number }> = [];
  for (const s of samples) {
    const due = s.dueAt ? new Date(s.dueAt).getTime() : null;
    if (due == null) {
      onTime += 1;
      continue;
    }
    const end = s.closedAt ? new Date(s.closedAt).getTime() : now;
    const over = end - due;
    if (over > 0) {
      breached += 1;
      if (!s.closedAt) openOverdue += 1;
      worst.push({ id: s.id, label: s.label ?? s.id, overdueHours: over / 3_600_000 });
    } else {
      onTime += 1;
    }
  }
  const total = samples.length;
  const pct = total ? (onTime / total) * 100 : 100;
  return {
    total,
    onTime,
    breached,
    openOverdue,
    compliancePct: pct,
    band: slaBandOf(pct),
    worst: worst.sort((a, b) => b.overdueHours - a.overdueHours).slice(0, 5),
  };
}

/* --------------------------------------------------------- conversion funnel */

export interface FunnelInput {
  enquiries: number;
  qualified: number;
  quoted: number;
  approved: number;
  booked: number;
  invoiced: number;
}

export interface FunnelStage {
  key: keyof FunnelInput;
  label: string;
  count: number;
  ofTopPct: number;
  stepConversionPct: number | null;
}

const FUNNEL_LABELS: Array<[keyof FunnelInput, string]> = [
  ["enquiries", "Enquiries"],
  ["qualified", "Qualified"],
  ["quoted", "Quoted"],
  ["approved", "Approved"],
  ["booked", "Booked"],
  ["invoiced", "Invoiced"],
];

export function conversionFunnel(input: FunnelInput): FunnelStage[] {
  const top = input.enquiries || 0;
  return FUNNEL_LABELS.map(([key, label], i) => {
    const count = input[key] ?? 0;
    const prev = i === 0 ? null : input[FUNNEL_LABELS[i - 1][0]] ?? 0;
    return {
      key,
      label,
      count,
      ofTopPct: top ? (count / top) * 100 : 0,
      stepConversionPct: prev == null ? null : prev ? (count / prev) * 100 : 0,
    };
  });
}

export const overallConversionPct = (input: FunnelInput): number =>
  input.enquiries ? (input.invoiced / input.enquiries) * 100 : 0;

/* ---------------------------------------------------------- contract pipeline */

export interface ContractPipeline extends PipelineSummary {
  contractedKes: number;
  contractsInLegal: number;
}

const LEGAL_STAGES = new Set<string>([
  "negotiation", "commercial_review", "legal_review", "contract_approval",
]);

export function contractPipeline(opportunities: CrmOpportunity[], now = Date.now()): ContractPipeline {
  const summary = summarisePipeline(opportunities, now);
  return {
    ...summary,
    contractedKes: opportunities
      .filter((o) => o.stage === "won" || o.stage === "contract_signed")
      .reduce((s, o) => s + (o.contractValueKes ?? 0), 0),
    contractsInLegal: opportunities.filter((o) => LEGAL_STAGES.has(String(o.stage))).length,
  };
}

/* -------------------------------------------------------- integration health */

export interface IntegrationSample {
  key: IntegrationKey;
  successes: number;
  failures: number;
  lastFailureAt?: string | null;
  p95LatencyMs?: number | null;
}

export type IntegrationStatus = "healthy" | "degraded" | "down" | "unknown";

export interface IntegrationHealthRow {
  key: IntegrationKey;
  label: string;
  status: IntegrationStatus;
  successRatePct: number | null;
  calls: number;
  p95LatencyMs: number | null;
  lastFailureAt: string | null;
  degradedMode: string;
}

export function integrationHealth(samples: IntegrationSample[]): IntegrationHealthRow[] {
  const byKey = new Map(samples.map((s) => [s.key, s]));
  return INTEGRATION_POLICIES.map((p) => {
    const s = byKey.get(p.key);
    const calls = s ? s.successes + s.failures : 0;
    const rate = calls ? (s!.successes / calls) * 100 : null;
    const status: IntegrationStatus =
      rate == null ? "unknown" : rate >= 99 ? "healthy" : rate >= 90 ? "degraded" : "down";
    return {
      key: p.key,
      label: p.label,
      status,
      successRatePct: rate,
      calls,
      p95LatencyMs: s?.p95LatencyMs ?? null,
      lastFailureAt: s?.lastFailureAt ?? null,
      degradedMode: p.degradedMode,
    };
  });
}

export const integrationPosture = (
  rows: IntegrationHealthRow[],
): { status: IntegrationStatus; healthy: number; degraded: number; down: number } => {
  const down = rows.filter((r) => r.status === "down").length;
  const degraded = rows.filter((r) => r.status === "degraded").length;
  return {
    down,
    degraded,
    healthy: rows.filter((r) => r.status === "healthy").length,
    status: down ? "down" : degraded ? "degraded" : "healthy",
  };
};

/* ----------------------------------------------------------------- snapshot */

export interface ExecutiveSnapshotInput {
  invoices: RevenueRow[];
  bookings: BookingRowLite[];
  vehicles: VehicleStateRow[];
  slaSamples: SlaSample[];
  funnel: FunnelInput;
  opportunities: CrmOpportunity[];
  integrations: IntegrationSample[];
}

export interface ExecutiveSnapshot {
  generatedAt: string;
  revenue: RevenueToday;
  bookings: BookingsToday;
  fleet: ActiveVehicles;
  sla: SlaCompliance;
  funnel: FunnelStage[];
  conversionPct: number;
  pipeline: ContractPipeline;
  integrations: IntegrationHealthRow[];
  posture: ReturnType<typeof integrationPosture>;
}

export function executiveSnapshot(
  input: ExecutiveSnapshotInput,
  now = Date.now(),
): ExecutiveSnapshot {
  const integrations = integrationHealth(input.integrations);
  return {
    generatedAt: new Date(now).toISOString(),
    revenue: revenueToday(input.invoices, now),
    bookings: bookingsToday(input.bookings, now),
    fleet: activeVehicles(input.vehicles),
    sla: slaCompliance(input.slaSamples, now),
    funnel: conversionFunnel(input.funnel),
    conversionPct: overallConversionPct(input.funnel),
    pipeline: contractPipeline(input.opportunities, now),
    integrations,
    posture: integrationPosture(integrations),
  };
}

export const formatKes = (n: number): string => `KES ${Math.round(n).toLocaleString("en-KE")}`;
export const formatPct = (n: number | null): string => (n == null ? "—" : `${n.toFixed(1)}%`);
