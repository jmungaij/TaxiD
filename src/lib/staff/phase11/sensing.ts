/**
 * Phase 11 §11.1 — TaxiD Enterprise Sensing Layer.
 *
 * The adaptive loop starts with sensing, and sensing is only admissible when the
 * signal declares where it came from and under whose authority it was read. A
 * signal missing a timestamp, a source, a correlation id, an authorisation
 * context or a data-quality status is REJECTED rather than quietly averaged into
 * a marketplace figure. Blind spots are reported as blind spots.
 */

export type SignalDomain =
  | "demand"
  | "supply"
  | "marketplace"
  | "commercial"
  | "customer"
  | "external";

export const SIGNAL_DOMAIN_LABEL: Record<SignalDomain, string> = {
  demand: "Demand",
  supply: "Supply",
  marketplace: "Marketplace",
  commercial: "Commercial",
  customer: "Customer",
  external: "External intelligence",
};

export interface SignalDefinition {
  key: string;
  domain: SignalDomain;
  label: string;
  /** Authoritative table/stream, or null when nothing yet emits it. */
  systemOfRecord: string | null;
}

/** The signals Phase 11 expects. `systemOfRecord: null` is an honest blind spot. */
export const SIGNAL_CATALOGUE: readonly SignalDefinition[] = [
  { key: "ride_request", domain: "demand", label: "Ride requests", systemOfRecord: "trips" },
  { key: "corporate_request", domain: "demand", label: "Corporate mobility requests", systemOfRecord: "commercial_transactions" },
  { key: "charter_enquiry", domain: "demand", label: "Charter enquiries", systemOfRecord: "charter_bookings" },
  { key: "aircraft_enquiry", domain: "demand", label: "Aircraft enquiries", systemOfRecord: "charter_bookings" },
  { key: "parcel_request", domain: "demand", label: "Parcel requests", systemOfRecord: "delivery_orders" },
  { key: "logistics_request", domain: "demand", label: "Logistics requests", systemOfRecord: "delivery_orders" },
  { key: "rental_search", domain: "demand", label: "Rental searches", systemOfRecord: null },
  { key: "leasing_enquiry", domain: "demand", label: "Leasing enquiries", systemOfRecord: null },

  { key: "driver_availability", domain: "supply", label: "Driver availability", systemOfRecord: "drivers" },
  { key: "operator_availability", domain: "supply", label: "Operator availability", systemOfRecord: "charter_partner_applications" },
  { key: "vehicle_availability", domain: "supply", label: "Vehicle availability", systemOfRecord: "vehicles" },
  { key: "aircraft_availability", domain: "supply", label: "Aircraft availability", systemOfRecord: "charter_inventory" },
  { key: "courier_capacity", domain: "supply", label: "Courier capacity", systemOfRecord: null },
  { key: "logistics_capacity", domain: "supply", label: "Logistics capacity", systemOfRecord: null },
  { key: "rental_availability", domain: "supply", label: "Rental availability", systemOfRecord: null },

  { key: "search", domain: "marketplace", label: "Search", systemOfRecord: null },
  { key: "quote", domain: "marketplace", label: "Quotes", systemOfRecord: "charter_quotes" },
  { key: "match", domain: "marketplace", label: "Matches", systemOfRecord: "dispatch_events" },
  { key: "acceptance", domain: "marketplace", label: "Acceptance", systemOfRecord: "dispatch_events" },
  { key: "cancellation", domain: "marketplace", label: "Cancellation", systemOfRecord: "trips" },
  { key: "fulfilment", domain: "marketplace", label: "Fulfilment", systemOfRecord: "commercial_transactions" },
  { key: "eta", domain: "marketplace", label: "ETA", systemOfRecord: null },
  { key: "sla", domain: "marketplace", label: "SLA", systemOfRecord: "availability_metrics" },

  { key: "lead", domain: "commercial", label: "Leads", systemOfRecord: "marketing_leads" },
  { key: "opportunity", domain: "commercial", label: "Opportunities", systemOfRecord: null },
  { key: "proposal", domain: "commercial", label: "Proposals", systemOfRecord: "charter_quotes" },
  { key: "booking", domain: "commercial", label: "Bookings", systemOfRecord: "charter_bookings" },
  { key: "invoice", domain: "commercial", label: "Invoices", systemOfRecord: "corporate_invoices" },
  { key: "payment", domain: "commercial", label: "Payments", systemOfRecord: "commercial_transactions.payment_ref" },
  { key: "settlement", domain: "commercial", label: "Settlements", systemOfRecord: "commercial_transactions.settlement_id" },
  { key: "revenue", domain: "commercial", label: "Revenue", systemOfRecord: "commercial_transactions.platform_revenue_cents" },

  { key: "satisfaction", domain: "customer", label: "Satisfaction", systemOfRecord: null },
  { key: "complaint", domain: "customer", label: "Complaints", systemOfRecord: null },
  { key: "repeat_behaviour", domain: "customer", label: "Repeat behaviour", systemOfRecord: "commercial_transactions" },
  { key: "churn_signal", domain: "customer", label: "Churn signals", systemOfRecord: null },
  { key: "cross_service", domain: "customer", label: "Cross-service behaviour", systemOfRecord: "commercial_transactions" },

  { key: "weather", domain: "external", label: "Weather", systemOfRecord: null },
  { key: "traffic", domain: "external", label: "Traffic", systemOfRecord: null },
  { key: "regulatory", domain: "external", label: "Regulatory changes", systemOfRecord: null },
  { key: "market_conditions", domain: "external", label: "Market conditions", systemOfRecord: null },
  { key: "competitor", domain: "external", label: "Competitor signals (lawful only)", systemOfRecord: null },
];

export function signalDefinition(key: string): SignalDefinition | undefined {
  return SIGNAL_CATALOGUE.find((s) => s.key === key);
}

export type DataQuality = "authoritative" | "derived" | "unverified" | "missing";

export interface AuthorisationContext {
  role: string;
  scope: string;
}

export interface SignalEnvelope {
  signal: string;
  /** ISO timestamp of observation. Required. */
  observedAt: string | null;
  source: string;
  entity: string;
  entityId: string | null;
  eventType: string;
  /** 0-100. null is allowed only for authoritative facts. */
  confidence: number | null;
  correlationId: string;
  authorisation: AuthorisationContext | null;
  quality: DataQuality;
  value: number | null;
}

export interface AdmissionVerdict {
  admitted: boolean;
  reasons: string[];
}

/** A signal is admitted only when every mandatory envelope field is present. */
export function admitSignal(e: SignalEnvelope): AdmissionVerdict {
  const reasons: string[] = [];
  if (!signalDefinition(e.signal)) reasons.push(`Unknown signal type ${e.signal}`);
  if (!e.observedAt) reasons.push("No observation timestamp");
  if (!e.source.trim()) reasons.push("No declared source");
  if (!e.entity.trim()) reasons.push("No subject entity");
  if (!e.eventType.trim()) reasons.push("No event type");
  if (!e.correlationId.trim()) reasons.push("No correlation id — the signal cannot be traced through the loop");
  if (!e.authorisation) reasons.push("No authorisation context — the read cannot be proven lawful");
  if (e.quality === "missing") reasons.push("Data quality reported as missing");
  if (e.quality !== "authoritative" && e.confidence === null) reasons.push("Non-authoritative signal carries no confidence");
  return { admitted: reasons.length === 0, reasons };
}

export interface DomainCoverage {
  domain: SignalDomain;
  total: number;
  instrumented: number;
  observed: number;
}

export interface SensingCoverage {
  catalogued: number;
  instrumented: number;
  observed: number;
  admitted: number;
  rejected: number;
  rejectionReasons: string[];
  /** Instrumented share of the catalogue, 0-100. */
  coveragePct: number;
  /** Share of instrumented signals actually observed in this window. */
  observedPct: number;
  byDomain: DomainCoverage[];
  /** Catalogued signals with no system of record at all. */
  blindSpots: string[];
}

/** Assess what the platform can actually sense right now. */
export function assessSensing(signals: readonly SignalEnvelope[]): SensingCoverage {
  const verdicts = signals.map((s) => ({ signal: s, verdict: admitSignal(s) }));
  const admittedKeys = new Set(verdicts.filter((v) => v.verdict.admitted).map((v) => v.signal.signal));
  const instrumented = SIGNAL_CATALOGUE.filter((d) => d.systemOfRecord !== null);

  const domains = Array.from(new Set(SIGNAL_CATALOGUE.map((s) => s.domain)));
  const byDomain: DomainCoverage[] = domains.map((domain) => {
    const all = SIGNAL_CATALOGUE.filter((s) => s.domain === domain);
    return {
      domain,
      total: all.length,
      instrumented: all.filter((s) => s.systemOfRecord !== null).length,
      observed: all.filter((s) => admittedKeys.has(s.key)).length,
    };
  });

  const rejected = verdicts.filter((v) => !v.verdict.admitted);

  return {
    catalogued: SIGNAL_CATALOGUE.length,
    instrumented: instrumented.length,
    observed: admittedKeys.size,
    admitted: verdicts.length - rejected.length,
    rejected: rejected.length,
    rejectionReasons: Array.from(new Set(rejected.flatMap((r) => r.verdict.reasons))).slice(0, 8),
    coveragePct: Math.round((instrumented.length / SIGNAL_CATALOGUE.length) * 100),
    observedPct: instrumented.length === 0 ? 0 : Math.round((admittedKeys.size / instrumented.length) * 100),
    byDomain,
    blindSpots: SIGNAL_CATALOGUE.filter((s) => s.systemOfRecord === null).map((s) => s.label),
  };
}
