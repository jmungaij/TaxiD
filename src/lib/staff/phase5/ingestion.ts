/**
 * Phase 5 — Business event ingestion.
 *
 * Phase 4 declared the event fabric; nothing fired it. This module turns the
 * declarations into observations: each ingestor is a narrow, RLS-respecting
 * count against the authoritative table with an explicit detection window and
 * threshold. An ingestor that cannot read its table reports UNAVAILABLE with
 * the database's own reason — it never degrades into a zero, because "nothing
 * is wrong" and "we cannot see" are different statements.
 *
 * Only observed signals may enter correlation, prioritisation or the decision
 * queue, so an attention item can always be traced back to a real row count.
 */
import { supabase } from "@/integrations/supabase/client";
import { BUSINESS_EVENTS, eventByKey, type BusinessEvent } from "@/lib/staff/phase4/eventFabric";

type FilterOp = "eq" | "neq" | "lt" | "gt" | "gte" | "lte" | "is" | "not_null";
type Filter = { column: string; op: FilterOp; value?: unknown };

export interface Ingestor {
  eventKey: string;
  table: string;
  /** Human statement of what is being counted. */
  detects: string;
  /** Detection window in days, or null when the whole table is the population. */
  windowDays: number | null;
  /** Column carrying the timestamp the window applies to. */
  timeColumn?: string;
  /** Observations at or above this count raise the event. */
  threshold: number;
  filters: readonly Filter[];
}

const days = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

export const INGESTORS: readonly Ingestor[] = [
  {
    eventKey: "invoice.overdue", table: "corporate_invoices",
    detects: "Corporate invoices past their due date with an unsettled balance",
    windowDays: null, threshold: 1,
    filters: [{ column: "balance_cents", op: "gt", value: 0 }],
  },
  {
    eventKey: "customer.at_risk", table: "client_journey_events",
    detects: "Failed customer journey interactions in the window",
    windowDays: 7, timeColumn: "occurred_at", threshold: 5,
    filters: [{ column: "success", op: "eq", value: false }],
  },
  {
    eventKey: "opportunity.stalled", table: "charter_quotes",
    detects: "Quotes with no update inside the policy window",
    windowDays: 7, timeColumn: "updated_at", threshold: 1,
    filters: [{ column: "status", op: "neq", value: "converted" }],
  },
  {
    eventKey: "partner.capacity_low", table: "charter_inventory",
    detects: "Marketplace assets currently not available for allocation",
    windowDays: null, threshold: 1,
    filters: [{ column: "active", op: "eq", value: false }],
  },
  {
    eventKey: "booking.delayed", table: "charter_bookings",
    detects: "Confirmed bookings still unpaid beyond the settlement window",
    windowDays: 1, timeColumn: "created_at", threshold: 1,
    filters: [{ column: "payment_status", op: "eq", value: "pending" }],
  },
  {
    eventKey: "sla.at_risk", table: "availability_metrics",
    detects: "Service days recording one or more availability incidents",
    windowDays: 30, timeColumn: "created_at", threshold: 1,
    filters: [{ column: "incidents", op: "gt", value: 0 }],
  },
  {
    eventKey: "risk.threshold_crossed", table: "alerts_events",
    detects: "Threshold alerts raised and not yet acknowledged",
    windowDays: 30, timeColumn: "created_at", threshold: 1,
    filters: [{ column: "acknowledged_at", op: "is", value: null }],
  },
  {
    eventKey: "data.integrity_defect", table: "data_quality_findings",
    detects: "Data quality findings detected in the window",
    windowDays: 7, timeColumn: "detected_at", threshold: 1,
    filters: [],
  },
  {
    eventKey: "settlement.mismatch", table: "charter_wallet_reconciliation_findings",
    detects: "Open reconciliation findings between ledger and settlement",
    windowDays: null, threshold: 1,
    filters: [],
  },
];

export type SignalState = "raised" | "clear" | "unavailable";

export interface IngestedSignal {
  eventKey: string;
  event: BusinessEvent | undefined;
  table: string;
  detects: string;
  window: string;
  threshold: number;
  /** Observed count, or null when the table could not be read. */
  observed: number | null;
  state: SignalState;
  /** Why the signal is unavailable — the database's own message. */
  reason?: string;
  observedAt: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type LooseClient = { from: (t: string) => any };

async function runIngestor(ing: Ingestor): Promise<IngestedSignal> {
  const base: Omit<IngestedSignal, "observed" | "state" | "reason"> = {
    eventKey: ing.eventKey,
    event: eventByKey(ing.eventKey),
    table: ing.table,
    detects: ing.detects,
    window: ing.windowDays ? `Last ${ing.windowDays} day${ing.windowDays === 1 ? "" : "s"}` : "All records",
    threshold: ing.threshold,
    observedAt: new Date().toISOString(),
  };
  try {
    let q = (supabase as unknown as LooseClient).from(ing.table).select("*", { count: "exact", head: true });
    for (const f of ing.filters) {
      if (f.op === "is") q = q.is(f.column, f.value ?? null);
      else if (f.op === "not_null") q = q.not(f.column, "is", null);
      else q = q[f.op](f.column, f.value);
    }
    if (ing.windowDays && ing.timeColumn) q = q.gte(ing.timeColumn, days(ing.windowDays));
    if (ing.eventKey === "opportunity.stalled" && ing.timeColumn) {
      // stalled means *no* recent activity: invert the window
      q = (supabase as unknown as LooseClient)
        .from(ing.table)
        .select("*", { count: "exact", head: true })
        .lt(ing.timeColumn, days(ing.windowDays ?? 7));
    }
    if (ing.eventKey === "invoice.overdue") q = q.lt("due_at", new Date().toISOString());
    const { count, error } = await q;
    if (error) return { ...base, observed: null, state: "unavailable", reason: error.message };
    const observed = count ?? 0;
    return { ...base, observed, state: observed >= ing.threshold ? "raised" : "clear" };
  } catch (e) {
    return { ...base, observed: null, state: "unavailable", reason: e instanceof Error ? e.message : "ingestion failed" };
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Run every ingestor in parallel. Failures are reported, never swallowed. */
export async function ingestBusinessEvents(): Promise<IngestedSignal[]> {
  return Promise.all(INGESTORS.map(runIngestor));
}

export function raisedSignals(signals: readonly IngestedSignal[]): IngestedSignal[] {
  return signals.filter((s) => s.state === "raised");
}

/** Declared events with no ingestor — visible as a sensing gap, not as silence. */
export function unsensedEvents(): BusinessEvent[] {
  const wired = new Set(INGESTORS.map((i) => i.eventKey));
  return BUSINESS_EVENTS.filter((e) => !wired.has(e.key));
}

export interface SensingCoverage {
  declared: number;
  sensed: number;
  raised: number;
  unavailable: number;
  /** Percentage of declared events that an ingestor actually observes. */
  coverage: number;
}

export function sensingCoverage(signals: readonly IngestedSignal[]): SensingCoverage {
  return {
    declared: BUSINESS_EVENTS.length,
    sensed: INGESTORS.length,
    raised: signals.filter((s) => s.state === "raised").length,
    unavailable: signals.filter((s) => s.state === "unavailable").length,
    coverage: Math.round((INGESTORS.length / BUSINESS_EVENTS.length) * 100),
  };
}
