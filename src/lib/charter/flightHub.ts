/**
 * Flight Hub engine — pure derivations over charter inventory, quotes,
 * bookings and pricing-audit rows. No fetching, no React: every Flight Hub
 * surface (console, onboarding, lifecycle, payments, compliance, relations,
 * support) reads its numbers from here so the workspace stays deterministic
 * and testable.
 */
import type {
  CharterAuditRow, CharterBookingRow, CharterInventoryRow, CharterQuoteRow,
} from "./api";
import { FLIGHT_TRANSITIONS, statusLabel } from "./transitions";
import { resolvePoint, type AirPoint } from "./airports";

export interface FlightHubDataset {
  inventory: CharterInventoryRow[];
  quotes: CharterQuoteRow[];
  bookings: CharterBookingRow[];
  audit: CharterAuditRow[];
}

export const EMPTY_DATASET: FlightHubDataset = {
  inventory: [], quotes: [], bookings: [], audit: [],
};

/** Aviation-only slice of the wider charter catalogue. */
export const AIR_SLUGS = ["aircraft-charter", "helicopter-charter", "aircraft-leasing"] as const;

export const isAir = (slug: string | null | undefined) =>
  !!slug && (AIR_SLUGS as readonly string[]).includes(slug);

const IN_FLIGHT = new Set(["scheduled", "crew_assigned", "boarding", "departed", "en_route"]);
const CLOSED = new Set(["arrived", "landed", "completed", "cancelled"]);

export const lastEvent = (b: CharterBookingRow) => (b.flight_events ?? []).slice(-1)[0] ?? null;

export const money = (n: number, currency = "KES") =>
  new Intl.NumberFormat("en-KE", { style: "currency", currency, maximumFractionDigits: 0 }).format(n || 0);

export const pct = (num: number, den: number) => (den <= 0 ? 0 : Math.round((num / den) * 100));

/* ------------------------------------------------------------------ */
/* Hub overview                                                        */
/* ------------------------------------------------------------------ */

export interface HubPulse {
  activeFlights: number;
  scheduledToday: number;
  completed30d: number;
  fleetAvailable: number;
  fleetTotal: number;
  openQuotes: number;
  conversionPct: number;
  grossValue: number;
  currency: string;
  settledPct: number;
  onTimePct: number;
}

export function computePulse(d: FlightHubDataset): HubPulse {
  const bookings = d.bookings;
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  const activeFlights = bookings.filter((b) => IN_FLIGHT.has(b.flight_status)).length;
  const scheduledToday = bookings.filter(
    (b) => b.flight_status === "scheduled" && now - Date.parse(b.created_at) < day,
  ).length;
  const completed30d = bookings.filter(
    (b) => CLOSED.has(b.flight_status) && now - Date.parse(b.created_at) < 30 * day,
  ).length;

  const fleetTotal = d.inventory.length;
  const fleetAvailable = d.inventory.filter((i) => i.active && i.status === "available").length;

  const openQuotes = d.quotes.filter((q) => ["requested", "priced"].includes(q.status)).length;
  const converted = d.quotes.filter((q) => q.status === "converted" || q.status === "accepted").length;

  const grossValue = bookings.reduce((s, b) => s + (b.amount || 0), 0);
  const settled = bookings.filter((b) => b.payment_status === "paid" || b.payment_status === "settled").length;
  const onTime = bookings.filter((b) => !CLOSED.has(b.flight_status) || b.flight_status !== "cancelled").length;

  return {
    activeFlights,
    scheduledToday,
    completed30d,
    fleetAvailable,
    fleetTotal,
    openQuotes,
    conversionPct: pct(converted, d.quotes.length),
    grossValue,
    currency: bookings[0]?.currency ?? "KES",
    settledPct: pct(settled, bookings.length),
    onTimePct: pct(onTime, bookings.length),
  };
}

/* ------------------------------------------------------------------ */
/* Flights console                                                     */
/* ------------------------------------------------------------------ */

export interface FlightRow {
  booking: CharterBookingRow;
  phase: "pre-flight" | "airborne" | "closed";
  nextAllowed: readonly string[];
  lastNote: string | null;
  stale: boolean;
}

export function buildFlightRows(d: FlightHubDataset): FlightRow[] {
  const now = Date.now();
  return d.bookings
    .slice()
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .map((booking) => {
      const ev = lastEvent(booking);
      const phase: FlightRow["phase"] = IN_FLIGHT.has(booking.flight_status)
        ? (["departed", "en_route", "boarding"].includes(booking.flight_status) ? "airborne" : "pre-flight")
        : CLOSED.has(booking.flight_status) ? "closed" : "pre-flight";
      return {
        booking,
        phase,
        nextAllowed: FLIGHT_TRANSITIONS[booking.flight_status] ?? [],
        lastNote: ev?.note ?? null,
        stale: phase !== "closed" && !!ev && now - Date.parse(ev.at) > 6 * 60 * 60 * 1000,
      };
    });
}

/* ------------------------------------------------------------------ */
/* Partner onboarding                                                  */
/* ------------------------------------------------------------------ */

export interface OperatorRow {
  operator: string;
  assets: number;
  activeAssets: number;
  homeBases: string[];
  categories: string[];
  bookings: number;
  revenue: number;
  currency: string;
  readiness: number;
  stage: "prospect" | "documentation" | "activation" | "live";
}

export function buildOperators(d: FlightHubDataset): OperatorRow[] {
  const map = new Map<string, OperatorRow>();
  for (const i of d.inventory) {
    const key = i.operator_name?.trim() || "Unassigned operator";
    const row = map.get(key) ?? {
      operator: key, assets: 0, activeAssets: 0, homeBases: [], categories: [],
      bookings: 0, revenue: 0, currency: i.currency || "KES", readiness: 0, stage: "prospect" as const,
    };
    row.assets += 1;
    if (i.active) row.activeAssets += 1;
    if (i.home_base && !row.homeBases.includes(i.home_base)) row.homeBases.push(i.home_base);
    if (!row.categories.includes(i.category_slug)) row.categories.push(i.category_slug);
    map.set(key, row);
  }
  for (const b of d.bookings) {
    const owner = d.inventory.find((i) => i.name === b.asset_name)?.operator_name?.trim() || "Unassigned operator";
    const row = map.get(owner);
    if (!row) continue;
    row.bookings += 1;
    row.revenue += b.amount || 0;
  }
  return [...map.values()]
    .map((r) => {
      const readiness = Math.min(
        100,
        pct(r.activeAssets, r.assets) * 0.5 +
          (r.homeBases.length > 0 ? 20 : 0) +
          (r.bookings > 0 ? 30 : 0),
      );
      const stage: OperatorRow["stage"] =
        readiness >= 85 ? "live" : readiness >= 55 ? "activation" : readiness >= 25 ? "documentation" : "prospect";
      return { ...r, readiness: Math.round(readiness), stage };
    })
    .sort((a, b) => b.readiness - a.readiness);
}

/* ------------------------------------------------------------------ */
/* Lifecycle funnel                                                    */
/* ------------------------------------------------------------------ */

export interface LifecycleStage {
  key: string;
  label: string;
  count: number;
  share: number;
  dropOff: number;
}

export function buildLifecycle(d: FlightHubDataset): LifecycleStage[] {
  const enquiries = d.quotes.length;
  const priced = d.quotes.filter((q) => q.status !== "requested").length;
  const booked = d.bookings.length;
  const flown = d.bookings.filter((b) => CLOSED.has(b.flight_status) && b.flight_status !== "cancelled").length;
  const raw = [
    { key: "enquiry", label: "Enquiry", count: enquiries },
    { key: "quoted", label: "Quoted", count: priced },
    { key: "booked", label: "Booked", count: booked },
    { key: "flown", label: "Flown & closed", count: flown },
  ];
  const top = raw[0].count || 1;
  return raw.map((s, i) => ({
    ...s,
    share: pct(s.count, top),
    dropOff: i === 0 ? 0 : Math.max(0, raw[i - 1].count - s.count),
  }));
}

/* ------------------------------------------------------------------ */
/* Payments                                                            */
/* ------------------------------------------------------------------ */

export interface PaymentBucket {
  status: string;
  label: string;
  count: number;
  value: number;
  currency: string;
}

const PAYMENT_LABELS: Record<string, string> = {
  paid: "Settled", settled: "Settled", pending: "Awaiting settlement",
  authorized: "Authorized", failed: "Failed", refunded: "Refunded",
};

export function buildPayments(d: FlightHubDataset): PaymentBucket[] {
  const map = new Map<string, PaymentBucket>();
  for (const b of d.bookings) {
    const status = b.payment_status || "pending";
    const row = map.get(status) ?? {
      status, label: PAYMENT_LABELS[status] ?? statusLabel(status),
      count: 0, value: 0, currency: b.currency || "KES",
    };
    row.count += 1;
    row.value += b.amount || 0;
    map.set(status, row);
  }
  return [...map.values()].sort((a, b) => b.value - a.value);
}

/* ------------------------------------------------------------------ */
/* Compliance                                                          */
/* ------------------------------------------------------------------ */

export interface ComplianceCheck {
  id: string;
  title: string;
  detail: string;
  severity: "ok" | "watch" | "breach";
  count: number;
}

export function buildCompliance(d: FlightHubDataset): ComplianceCheck[] {
  const noEvidence = d.audit.filter((a) => !a.evidence_url).length;
  const noOperator = d.inventory.filter((i) => !i.operator_name).length;
  const expiring = d.inventory.filter(
    (i) => i.available_to && Date.parse(i.available_to) - Date.now() < 30 * 24 * 60 * 60 * 1000,
  ).length;
  const cancelled = d.bookings.filter((b) => b.flight_status === "cancelled").length;
  const unreasoned = d.bookings.filter((b) => {
    const e = lastEvent(b);
    return b.flight_status === "cancelled" && !e?.reason_code;
  }).length;

  const sev = (n: number, watch: number): ComplianceCheck["severity"] =>
    n === 0 ? "ok" : n <= watch ? "watch" : "breach";

  return [
    { id: "evidence", title: "Pricing changes without evidence", detail: "Every pricing audit entry should carry an attached evidence document.", severity: sev(noEvidence, 3), count: noEvidence },
    { id: "operator", title: "Assets with no accountable operator", detail: "Aircraft must map to a licensed, contracted operator before dispatch.", severity: sev(noOperator, 0), count: noOperator },
    { id: "availability", title: "Availability windows expiring in 30 days", detail: "Renew lease/availability windows to avoid inventory blackout.", severity: sev(expiring, 5), count: expiring },
    { id: "reason", title: "Cancellations missing a reason code", detail: "Regulator-facing cancellations require a coded justification.", severity: sev(unreasoned, 0), count: unreasoned },
    { id: "cancelled", title: "Cancelled flights in window", detail: "Monitored for disruption trend and passenger remediation.", severity: sev(cancelled, 4), count: cancelled },
  ];
}

export function complianceScore(checks: ComplianceCheck[]): number {
  if (checks.length === 0) return 100;
  const penalty = checks.reduce((s, c) => s + (c.severity === "breach" ? 20 : c.severity === "watch" ? 7 : 0), 0);
  return Math.max(0, 100 - penalty);
}

/* ------------------------------------------------------------------ */
/* Customer operations & relations                                     */
/* ------------------------------------------------------------------ */

export interface CustomerRow {
  key: string;
  name: string;
  email: string;
  bookings: number;
  value: number;
  currency: string;
  lastActivity: string | null;
  tier: "platinum" | "gold" | "emerging";
  disruptions: number;
}

const contactOf = (r: { contact?: Record<string, unknown>; trip?: Record<string, unknown> }) => {
  const c = (r.contact ?? {}) as Record<string, string>;
  return { name: c.name || c.full_name || "", email: (c.email || "").toLowerCase() };
};

export function buildCustomers(d: FlightHubDataset): CustomerRow[] {
  const map = new Map<string, CustomerRow>();
  const touch = (email: string, name: string, currency: string) => {
    const key = email || name || "unknown";
    const row = map.get(key) ?? {
      key, name: name || email || "Unknown traveller", email,
      bookings: 0, value: 0, currency, lastActivity: null,
      tier: "emerging" as const, disruptions: 0,
    };
    map.set(key, row);
    return row;
  };

  for (const q of d.quotes) {
    const { name, email } = contactOf(q);
    const row = touch(email, name, q.currency);
    if (!row.lastActivity || Date.parse(q.created_at) > Date.parse(row.lastActivity)) row.lastActivity = q.created_at;
  }
  for (const b of d.bookings) {
    const quote = d.quotes.find((q) => q.id === b.quote_id);
    const { name, email } = contactOf(quote ?? { contact: {} });
    const row = touch(email, name, b.currency);
    row.bookings += 1;
    row.value += b.amount || 0;
    if (b.flight_status === "cancelled") row.disruptions += 1;
    if (!row.lastActivity || Date.parse(b.created_at) > Date.parse(row.lastActivity)) row.lastActivity = b.created_at;
  }

  return [...map.values()]
    .map((r) => ({
      ...r,
      tier: r.value >= 2_000_000 ? "platinum" as const : r.value >= 500_000 ? "gold" as const : "emerging" as const,
    }))
    .sort((a, b) => b.value - a.value);
}

/* ------------------------------------------------------------------ */
/* Support desk                                                        */
/* ------------------------------------------------------------------ */

export interface SupportTicket {
  id: string;
  reference: string;
  subject: string;
  priority: "p1" | "p2" | "p3";
  openedAt: string;
  origin: "flight" | "payment" | "quote";
}

/** Support queue derived from operational exceptions — no separate table. */
export function buildSupportQueue(d: FlightHubDataset): SupportTicket[] {
  const tickets: SupportTicket[] = [];
  const now = Date.now();

  for (const b of d.bookings) {
    if (b.flight_status === "cancelled") {
      tickets.push({ id: `${b.id}:cancel`, reference: b.reference, subject: `Cancellation remediation — ${b.asset_name}`, priority: "p1", openedAt: b.created_at, origin: "flight" });
    }
    if (["failed", "pending"].includes(b.payment_status) && now - Date.parse(b.created_at) > 24 * 60 * 60 * 1000) {
      tickets.push({ id: `${b.id}:pay`, reference: b.reference, subject: `Unsettled payment — ${b.payment_method || "unknown method"}`, priority: b.payment_status === "failed" ? "p1" : "p2", origin: "payment", openedAt: b.created_at });
    }
    const ev = lastEvent(b);
    if (ev && !CLOSED.has(b.flight_status) && now - Date.parse(ev.at) > 12 * 60 * 60 * 1000) {
      tickets.push({ id: `${b.id}:stale`, reference: b.reference, subject: `Stale flight status — ${statusLabel(b.flight_status)}`, priority: "p2", origin: "flight", openedAt: ev.at });
    }
  }
  for (const q of d.quotes) {
    if (q.status === "requested" && now - Date.parse(q.created_at) > 4 * 60 * 60 * 1000) {
      tickets.push({ id: `${q.id}:quote`, reference: q.reference, subject: `Quote awaiting pricing — ${q.asset_name}`, priority: "p3", origin: "quote", openedAt: q.created_at });
    }
  }

  const rank = { p1: 0, p2: 1, p3: 2 };
  return tickets.sort((a, b) => rank[a.priority] - rank[b.priority] || Date.parse(a.openedAt) - Date.parse(b.openedAt));
}

/* ------------------------------------------------------------------ */
/* Route network (live flight map)                                     */
/* ------------------------------------------------------------------ */

export interface RouteLeg {
  key: string;
  originLabel: string;
  destinationLabel: string;
  origin: AirPoint | null;
  destination: AirPoint | null;
  flights: number;
  airborne: number;
  scheduled: number;
  closed: number;
  value: number;
  currency: string;
  lastUpdate: string | null;
  bookings: CharterBookingRow[];
}

/** Aggregates bookings into an origin→destination network for the live map. */
export function buildRoutes(d: FlightHubDataset): RouteLeg[] {
  const map = new Map<string, RouteLeg>();
  for (const b of d.bookings) {
    const trip = (b.trip ?? {}) as Record<string, string>;
    const o = (trip.origin || "").trim();
    const dest = (trip.destination || "").trim();
    if (!o && !dest) continue;
    const key = `${o.toLowerCase()}→${dest.toLowerCase()}`;
    const leg = map.get(key) ?? {
      key,
      originLabel: o || "Unspecified",
      destinationLabel: dest || "Unspecified",
      origin: resolvePoint(o),
      destination: resolvePoint(dest),
      flights: 0, airborne: 0, scheduled: 0, closed: 0,
      value: 0, currency: b.currency || "KES",
      lastUpdate: null, bookings: [],
    };
    leg.flights += 1;
    leg.value += b.amount || 0;
    leg.bookings.push(b);
    if (["departed", "en_route", "boarding"].includes(b.flight_status)) leg.airborne += 1;
    else if (IN_FLIGHT.has(b.flight_status) || b.flight_status === "requested") leg.scheduled += 1;
    else leg.closed += 1;
    const ev = lastEvent(b);
    const at = ev?.at ?? b.created_at;
    if (!leg.lastUpdate || Date.parse(at) > Date.parse(leg.lastUpdate)) leg.lastUpdate = at;
    map.set(key, leg);
  }
  return [...map.values()].sort((a, b) => b.airborne - a.airborne || b.flights - a.flights);
}

export interface NetworkSummary {
  routes: number;
  airborne: number;
  scheduled: number;
  destinations: number;
  topRoute: string | null;
  lastUpdate: string | null;
}

export function summariseNetwork(legs: RouteLeg[]): NetworkSummary {
  const dests = new Set<string>();
  let airborne = 0, scheduled = 0, lastUpdate: string | null = null;
  for (const l of legs) {
    dests.add(l.destinationLabel.toLowerCase());
    airborne += l.airborne;
    scheduled += l.scheduled;
    if (l.lastUpdate && (!lastUpdate || Date.parse(l.lastUpdate) > Date.parse(lastUpdate))) lastUpdate = l.lastUpdate;
  }
  return {
    routes: legs.length,
    airborne,
    scheduled,
    destinations: dests.size,
    topRoute: legs[0] ? `${legs[0].originLabel} → ${legs[0].destinationLabel}` : null,
    lastUpdate,
  };
}
