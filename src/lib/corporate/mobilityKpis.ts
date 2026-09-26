/**
 * Corporate Mobility commercial KPIs — pure aggregation only.
 *
 * The admin analytics surface reads existing production tables
 * (`contact_submissions`, `charter_quotes`, `charter_bookings`,
 * `corporate_invoices`, `corporate_invoice_items`, `ui_events`) and passes the
 * rows here. No business logic is duplicated: this module only counts, groups
 * and averages what the operational systems already recorded.
 */

export interface EnquiryRow {
  id: string;
  type: string | null;
  status: string | null;
  company: string | null;
  source_page: string | null;
  employee_count: string | null;
  handled_by: string | null;
  is_spam: boolean | null;
  created_at: string;
  updated_at: string | null;
}

export interface QuoteRow {
  id: string;
  reference: string | null;
  category_slug: string | null;
  total: number | null;
  status: string | null;
  contact: unknown;
  created_at: string;
}

export interface BookingRow {
  id: string;
  reference: string | null;
  category_slug: string | null;
  amount: number | null;
  status: string | null;
  payment_status: string | null;
  contact: unknown;
  created_at: string;
  paid_at: string | null;
}

export interface InvoiceItemRow {
  department: string | null;
  cost_center: string | null;
  employee_name: string | null;
  total_cents: number | null;
  trip_started_at: string | null;
  trip_ended_at: string | null;
}

export interface InvoiceRow {
  corporate_id: string | null;
  status: string | null;
  total_cents: number | null;
  paid_cents: number | null;
  balance_cents: number | null;
  issued_at: string | null;
  paid_at: string | null;
}

const hours = (fromISO?: string | null, toISO?: string | null): number | null => {
  if (!fromISO || !toISO) return null;
  const a = Date.parse(fromISO);
  const b = Date.parse(toISO);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  return (b - a) / 3_600_000;
};

const mean = (values: number[]): number | null =>
  values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;

/** A qualified enquiry is one an operator has picked up or progressed. */
export const isQualifiedEnquiry = (e: EnquiryRow): boolean =>
  !e.is_spam && (!!e.handled_by || ["in_progress", "resolved"].includes(e.status ?? ""));

export interface EnquirySummary {
  total: number;
  spam: number;
  qualified: number;
  open: number;
  resolved: number;
  qualifiedRate: number;
  /** Mean hours between submission and first operator touch. */
  avgResponseHours: number | null;
  /** Mean hours from submission to resolution. */
  avgResolutionHours: number | null;
  /** Enquiries answered inside one business day. */
  withinSlaPct: number;
  byType: Array<{ key: string; count: number }>;
  bySource: Array<{ key: string; count: number }>;
}

export const SLA_RESPONSE_HOURS = 24;

export function summariseEnquiries(rows: EnquiryRow[]): EnquirySummary {
  const clean = rows.filter((r) => !r.is_spam);
  const qualified = clean.filter(isQualifiedEnquiry);
  const responses = qualified
    .map((r) => hours(r.created_at, r.updated_at))
    .filter((v): v is number => v !== null);
  const resolutions = clean
    .filter((r) => r.status === "resolved")
    .map((r) => hours(r.created_at, r.updated_at))
    .filter((v): v is number => v !== null);
  const withinSla = responses.filter((h) => h <= SLA_RESPONSE_HOURS).length;

  return {
    total: rows.length,
    spam: rows.length - clean.length,
    qualified: qualified.length,
    open: clean.filter((r) => (r.status ?? "new") === "new").length,
    resolved: clean.filter((r) => r.status === "resolved").length,
    qualifiedRate: clean.length ? qualified.length / clean.length : 0,
    avgResponseHours: mean(responses),
    avgResolutionHours: mean(resolutions),
    withinSlaPct: responses.length ? (withinSla / responses.length) * 100 : 0,
    byType: rank(clean.map((r) => r.type ?? "contact")),
    bySource: rank(clean.map((r) => r.source_page ?? "(direct)")),
  };
}

function rank(keys: string[]): Array<{ key: string; count: number }> {
  const map = new Map<string, number>();
  for (const k of keys) map.set(k, (map.get(k) ?? 0) + 1);
  return Array.from(map, ([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
}

export interface QuoteConversion {
  quotesIssued: number;
  pipelineValueKes: number;
  bookingsCreated: number;
  bookingsPaid: number;
  /** Quotes that turned into a booking. */
  conversionPct: number;
  /** Bookings that reached a settled payment. */
  paymentCompletionPct: number;
  wonValueKes: number;
  avgQuoteValueKes: number;
  /** Mean hours between the quote and the booking it produced. */
  avgQuoteToBookingHours: number | null;
}

const isPaid = (b: BookingRow) =>
  b.payment_status === "paid" || b.payment_status === "settled" || !!b.paid_at;

export function summariseQuoteConversion(
  quotes: QuoteRow[],
  bookings: BookingRow[],
): QuoteConversion {
  const pipeline = quotes.reduce((s, q) => s + Number(q.total ?? 0), 0);
  const paid = bookings.filter(isPaid);
  const byRef = new Map(quotes.map((q) => [q.reference ?? q.id, q.created_at]));
  const lags = bookings
    .map((b) => hours(byRef.get(b.reference ?? ""), b.created_at))
    .filter((v): v is number => v !== null);

  return {
    quotesIssued: quotes.length,
    pipelineValueKes: pipeline,
    bookingsCreated: bookings.length,
    bookingsPaid: paid.length,
    conversionPct: quotes.length ? (bookings.length / quotes.length) * 100 : 0,
    paymentCompletionPct: bookings.length ? (paid.length / bookings.length) * 100 : 0,
    wonValueKes: paid.reduce((s, b) => s + Number(b.amount ?? 0), 0),
    avgQuoteValueKes: quotes.length ? Math.round(pipeline / quotes.length) : 0,
    avgQuoteToBookingHours: mean(lags),
  };
}

/** Company name from the free-form contact payload stored on quotes/bookings. */
export function contactCompany(contact: unknown): string {
  if (contact && typeof contact === "object") {
    const c = contact as Record<string, unknown>;
    const company = typeof c.company === "string" ? c.company.trim() : "";
    if (company) return company;
    const email = typeof c.email === "string" ? c.email : "";
    const domain = email.split("@")[1];
    if (domain) return domain.toLowerCase();
  }
  return "(unattributed)";
}

export interface SpendGroup {
  key: string;
  bookings: number;
  amountKes: number;
  sharePct: number;
}

/** Revenue grouped by the company on the booking contact record. */
export function bookingsByCompany(bookings: BookingRow[]): SpendGroup[] {
  return group(
    bookings.map((b) => ({ key: contactCompany(b.contact), amount: Number(b.amount ?? 0) })),
  );
}

/** Corporate invoiced spend grouped by department (or cost centre fallback). */
export function spendByDepartment(items: InvoiceItemRow[]): SpendGroup[] {
  return group(
    items.map((i) => ({
      key: i.department?.trim() || i.cost_center?.trim() || "(unallocated)",
      amount: Number(i.total_cents ?? 0) / 100,
    })),
  );
}

function group(rows: Array<{ key: string; amount: number }>): SpendGroup[] {
  const map = new Map<string, SpendGroup>();
  for (const r of rows) {
    const g = map.get(r.key) ?? { key: r.key, bookings: 0, amountKes: 0, sharePct: 0 };
    g.bookings += 1;
    g.amountKes += r.amount;
    map.set(r.key, g);
  }
  const total = Array.from(map.values()).reduce((s, g) => s + g.amountKes, 0);
  return Array.from(map.values())
    .map((g) => ({ ...g, amountKes: Math.round(g.amountKes), sharePct: total ? (g.amountKes / total) * 100 : 0 }))
    .sort((a, b) => b.amountKes - a.amountKes);
}

export interface RevenueSummary {
  invoicedKes: number;
  collectedKes: number;
  outstandingKes: number;
  collectionPct: number;
  invoices: number;
  overdueInvoices: number;
  /** Mean days between issue and payment. */
  avgSettlementDays: number | null;
}

export function summariseRevenue(invoices: InvoiceRow[]): RevenueSummary {
  const invoiced = invoices.reduce((s, i) => s + Number(i.total_cents ?? 0), 0) / 100;
  const collected = invoices.reduce((s, i) => s + Number(i.paid_cents ?? 0), 0) / 100;
  const outstanding = invoices.reduce((s, i) => s + Number(i.balance_cents ?? 0), 0) / 100;
  const settle = invoices
    .map((i) => hours(i.issued_at, i.paid_at))
    .filter((v): v is number => v !== null)
    .map((h) => h / 24);
  return {
    invoicedKes: Math.round(invoiced),
    collectedKes: Math.round(collected),
    outstandingKes: Math.round(outstanding),
    collectionPct: invoiced ? (collected / invoiced) * 100 : 0,
    invoices: invoices.length,
    overdueInvoices: invoices.filter((i) => Number(i.balance_cents ?? 0) > 0 && i.status === "overdue").length,
    avgSettlementDays: mean(settle),
  };
}

export interface FunnelStepCount {
  step: string;
  count: number;
  /** Share of the first (impression) step. */
  retentionPct: number;
}

/**
 * Employee Mobility funnel retention from `ui_events` element ids
 * (`employee_mobility.<step>`), in the order supplied.
 */
export function summariseFunnel(
  events: Array<{ element_id: string | null }>,
  orderedSteps: readonly string[],
  prefix = "employee_mobility.",
): { steps: FunnelStepCount[]; abandoned: number } {
  const counts = new Map<string, number>();
  for (const e of events) {
    const id = e.element_id ?? "";
    if (!id.startsWith(prefix)) continue;
    const step = id.slice(prefix.length);
    counts.set(step, (counts.get(step) ?? 0) + 1);
  }
  const base = counts.get(orderedSteps[0] ?? "") ?? 0;
  return {
    steps: orderedSteps.map((step) => {
      const count = counts.get(step) ?? 0;
      return { step, count, retentionPct: base ? (count / base) * 100 : 0 };
    }),
    abandoned: counts.get("funnel_abandoned") ?? 0,
  };
}

export const formatKes = (n: number): string => `KSh ${Math.round(n).toLocaleString("en-KE")}`;
export const formatHours = (h: number | null): string =>
  h === null ? "—" : h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} d`;
