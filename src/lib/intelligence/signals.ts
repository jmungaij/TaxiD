/**
 * UNIVERSAL SIGNAL MODEL.
 *
 * One shape for every commercial signal, whatever produced it — deal movement,
 * idleness, a service exception, a payment state, a target gap. Signals are
 * persisted in `commercial_signals` so they can be tracked, acknowledged,
 * actioned, dismissed and explained later, instead of being recomputed and
 * forgotten on every screen.
 *
 * Laws:
 *  1. A signal always carries the evidence that produced it. No evidence, no signal.
 *  2. A signal never changes a record. It recommends; a person confirms; the
 *     existing engines execute.
 *  3. `signal_key` is deterministic, so re-deriving the same condition updates
 *     one row rather than flooding the register.
 */
import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export const SIGNAL_SEVERITIES = ["info", "low", "medium", "high", "critical"] as const;
export type SignalSeverity = (typeof SIGNAL_SEVERITIES)[number];

export const SIGNAL_URGENCIES = ["whenever", "normal", "today", "now"] as const;
export type SignalUrgency = (typeof SIGNAL_URGENCIES)[number];

export const SIGNAL_STATUSES = ["open", "acknowledged", "actioned", "dismissed", "expired"] as const;
export type SignalStatus = (typeof SIGNAL_STATUSES)[number];

/** Families kept deliberately small so every domain classifies the same way. */
export const SIGNAL_TYPES = [
  // customer
  "customer_replied",
  "customer_silent",
  "customer_requested_information",
  "customer_complaint",
  "customer_usage_up",
  "customer_usage_down",
  "renewal_approaching",
  // deal
  "deal_advancing",
  "deal_stalled",
  "deal_value_up",
  "deal_value_down",
  "close_date_moved",
  "proposal_unanswered",
  "contract_awaiting_signature",
  "decision_maker_missing",
  // operational
  "service_exception",
  "sla_risk",
  // commercial
  "payment_overdue",
  "credit_threshold",
  "expansion_opportunity",
  "account_underused",
  // performance
  "target_gap",
  "pipeline_gap",
  "opportunity_ageing",
  "coverage_gap",
  // hygiene
  "data_quality",
] as const;
export type SignalType = (typeof SIGNAL_TYPES)[number];

export type SignalEntityType = "opportunity" | "account" | "quotation" | "contract" | "lead" | "employee";

export interface SignalEvidence {
  label: string;
  value: string;
}

/** A signal before it is written — the shape every producer builds. */
export interface DerivedSignal {
  signalKey: string;
  type: SignalType;
  source: string;
  entityType: SignalEntityType;
  entityId: string | null;
  accountId?: string | null;
  customerLabel?: string | null;
  severity: SignalSeverity;
  urgency: SignalUrgency;
  commercialImpactCents?: number | null;
  customerImpact?: string | null;
  headline: string;
  evidence: SignalEvidence[];
  recommendedAction?: string | null;
  ownerUserId?: string | null;
  expiresAt?: string | null;
}

/** A signal as stored, with its lifecycle. */
export interface CommercialSignal extends DerivedSignal {
  id: string;
  status: SignalStatus;
  statusNote: string | null;
  createdAt: string;
  updatedAt: string;
}

const SEVERITY_WEIGHT: Record<SignalSeverity, number> = {
  critical: 100,
  high: 70,
  medium: 45,
  low: 25,
  info: 10,
};

const URGENCY_WEIGHT: Record<SignalUrgency, number> = { now: 40, today: 28, normal: 12, whenever: 0 };

/**
 * CUSTOMER FIRST, REVENUE SECOND, ADMIN LAST.
 *
 * What we owe the customer, and what the customer is waiting for, outrank
 * commercial upside — which outranks internal housekeeping.
 */
const TYPE_PRECEDENCE: Partial<Record<SignalType, number>> = {
  customer_complaint: 120,
  service_exception: 110,
  customer_requested_information: 100,
  sla_risk: 95,
  customer_replied: 90,
  contract_awaiting_signature: 80,
  renewal_approaching: 75,
  proposal_unanswered: 70,
  payment_overdue: 65,
  deal_stalled: 60,
  close_date_moved: 55,
  deal_value_down: 50,
  customer_silent: 48,
  decision_maker_missing: 45,
  customer_usage_down: 44,
  opportunity_ageing: 40,
  target_gap: 35,
  pipeline_gap: 33,
  expansion_opportunity: 30,
  customer_usage_up: 28,
  account_underused: 25,
  coverage_gap: 22,
  deal_value_up: 20,
  deal_advancing: 15,
  credit_threshold: 60,
  data_quality: 5,
};

/** Deterministic priority. Exposed so the UI can state why something is on top. */
export function signalPriority(signal: DerivedSignal): number {
  const impact = signal.commercialImpactCents ? Math.min(40, (signal.commercialImpactCents / 100) / 25_000) : 0;
  return (
    (TYPE_PRECEDENCE[signal.type] ?? 10) +
    SEVERITY_WEIGHT[signal.severity] * 0.4 +
    URGENCY_WEIGHT[signal.urgency] +
    impact
  );
}

export function sortSignals<T extends DerivedSignal>(signals: T[]): T[] {
  return [...signals].sort((a, b) => signalPriority(b) - signalPriority(a));
}

/** The one-line reason this sits where it sits in the queue. */
export function whyThisIsPriority(signal: DerivedSignal): string {
  const lead = signal.evidence[0];
  const owed = ["customer_complaint", "service_exception", "customer_requested_information", "customer_replied"];
  if (owed.includes(signal.type)) return `Priority because the customer is waiting on us — ${lead?.value ?? signal.headline}.`;
  if (signal.urgency === "now" || signal.urgency === "today")
    return `Priority because it is due ${signal.urgency === "now" ? "now" : "today"} — ${lead?.value ?? signal.headline}.`;
  if (signal.commercialImpactCents)
    return `Priority because ${(signal.commercialImpactCents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })} KES is exposed — ${lead?.value ?? signal.headline}.`;
  return `Priority because ${lead ? `${lead.label.toLowerCase()}: ${lead.value}` : signal.headline}.`;
}

/* ------------------------------------------------------------------ writes */

function toPayload(signal: DerivedSignal): Record<string, unknown> {
  return {
    signal_key: signal.signalKey,
    signal_type: signal.type,
    source: signal.source,
    entity_type: signal.entityType,
    entity_id: signal.entityId,
    account_id: signal.accountId ?? null,
    customer_label: signal.customerLabel ?? null,
    severity: signal.severity,
    urgency: signal.urgency,
    commercial_impact_cents: signal.commercialImpactCents ?? null,
    customer_impact: signal.customerImpact ?? null,
    headline: signal.headline,
    evidence: signal.evidence,
    recommended_action: signal.recommendedAction ?? null,
    owner_user_id: signal.ownerUserId ?? null,
    expires_at: signal.expiresAt ?? null,
  };
}

export async function emitSignal(signal: DerivedSignal): Promise<string | null> {
  const { data, error } = await db.rpc("commercial_signal_emit", { p: toPayload(signal) });
  if (error) return null;
  return (data as string) ?? null;
}

/** Persist a derived batch. Failures are counted, never silently claimed as success. */
export async function emitSignals(signals: DerivedSignal[]): Promise<{ written: number; failed: number }> {
  let written = 0;
  let failed = 0;
  for (const s of signals) {
    const id = await emitSignal(s);
    if (id) written += 1;
    else failed += 1;
  }
  return { written, failed };
}

export async function setSignalStatus(id: string, status: SignalStatus, note?: string): Promise<void> {
  const { error } = await db.rpc("commercial_signal_set_status", {
    p_signal_id: id,
    p_status: status,
    p_note: note ?? null,
  });
  if (error) throw new Error(error.message);
}

/* ------------------------------------------------------------------- reads */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fromRow(r: any): CommercialSignal {
  return {
    id: String(r.id),
    signalKey: String(r.signal_key),
    type: r.signal_type as SignalType,
    source: String(r.source),
    entityType: r.entity_type as SignalEntityType,
    entityId: (r.entity_id as string) ?? null,
    accountId: (r.account_id as string) ?? null,
    customerLabel: (r.customer_label as string) ?? null,
    severity: r.severity as SignalSeverity,
    urgency: r.urgency as SignalUrgency,
    commercialImpactCents: (r.commercial_impact_cents as number) ?? null,
    customerImpact: (r.customer_impact as string) ?? null,
    headline: String(r.headline),
    evidence: Array.isArray(r.evidence) ? (r.evidence as SignalEvidence[]) : [],
    recommendedAction: (r.recommended_action as string) ?? null,
    ownerUserId: (r.owner_user_id as string) ?? null,
    expiresAt: (r.expires_at as string) ?? null,
    status: r.status as SignalStatus,
    statusNote: (r.status_note as string) ?? null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

const COLUMNS =
  "id, signal_key, signal_type, source, entity_type, entity_id, account_id, customer_label, severity, urgency, commercial_impact_cents, customer_impact, headline, evidence, recommended_action, owner_user_id, status, status_note, created_at, updated_at, expires_at";

export async function listSignals(opts: {
  statuses?: SignalStatus[];
  entityType?: SignalEntityType;
  entityId?: string;
  accountId?: string;
  ownerUserId?: string;
  limit?: number;
} = {}): Promise<CommercialSignal[]> {
  let q = db.from("commercial_signals").select(COLUMNS).order("created_at", { ascending: false });
  q = q.in("status", opts.statuses ?? ["open", "acknowledged"]);
  if (opts.entityType) q = q.eq("entity_type", opts.entityType);
  if (opts.entityId) q = q.eq("entity_id", opts.entityId);
  if (opts.accountId) q = q.eq("account_id", opts.accountId);
  if (opts.ownerUserId) q = q.eq("owner_user_id", opts.ownerUserId);
  const { data, error } = await q.limit(opts.limit ?? 200);
  if (error) throw new Error(error.message);
  return sortSignals((data ?? []).map(fromRow));
}
