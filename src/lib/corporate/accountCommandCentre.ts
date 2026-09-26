/**
 * Per-corporate account command centre aggregation.
 *
 * Pure: the page loads rows for one `corporate_id` and this module derives
 * upcoming trips, pending approvals, monthly spend, department budget burn,
 * compliance status, invoice/receipt ledger and a downloadable statement.
 */

const DAY = 86_400_000;

/* ------------------------------------------------------------------- inputs */

export interface AccountApprovalRow {
  id: string;
  status: string;
  rideType: string | null;
  pickup: string | null;
  dropoff: string | null;
  estimatedFareKes: number;
  scheduledFor: string | null;
  createdAt: string;
  expiresAt: string | null;
  departmentId: string | null;
  requestedBy: string | null;
}

export interface AccountInvoiceRow {
  id: string;
  invoiceNumber: string | null;
  status: string;
  totalKes: number;
  paidKes: number;
  balanceKes: number;
  issuedAt: string | null;
  dueAt: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface AccountInvoiceItemRow {
  invoiceId: string;
  department: string | null;
  costCenter: string | null;
  employeeName: string | null;
  description: string | null;
  tripOrigin: string | null;
  tripDestination: string | null;
  tripStartedAt: string | null;
  totalKes: number;
}

export interface AccountDepartmentRow {
  id: string;
  name: string;
  code: string | null;
  costCenter: string | null;
  monthlyBudgetKes: number;
  active: boolean;
}

export interface AccountDocumentRow {
  id: string;
  docType: string;
  documentNumber: string | null;
  status: string;
  expiryDate: string | null;
  reviewedAt: string | null;
  uploadedAt: string;
}

/* ---------------------------------------------------------- upcoming trips */

export interface UpcomingTrip {
  id: string;
  when: string;
  hoursAway: number;
  rideType: string;
  route: string;
  estimatedFareKes: number;
  status: string;
  approved: boolean;
}

const APPROVED = new Set(["approved", "auto_approved"]);
const PENDING = new Set(["pending", "pending_approval", "escalated", "in_review"]);

export function upcomingTrips(
  rows: AccountApprovalRow[],
  now = Date.now(),
  horizonDays = 14,
): UpcomingTrip[] {
  return rows
    .filter((r) => {
      if (!r.scheduledFor) return false;
      const t = new Date(r.scheduledFor).getTime();
      return t >= now && t <= now + horizonDays * DAY;
    })
    .map((r) => ({
      id: r.id,
      when: r.scheduledFor as string,
      hoursAway: (new Date(r.scheduledFor as string).getTime() - now) / 3_600_000,
      rideType: r.rideType || "Corporate ride",
      route: [r.pickup || "Pickup TBC", r.dropoff || "Drop-off TBC"].join(" → "),
      estimatedFareKes: r.estimatedFareKes,
      status: r.status,
      approved: APPROVED.has(r.status),
    }))
    .sort((a, b) => a.hoursAway - b.hoursAway);
}

/* -------------------------------------------------------- pending approvals */

export interface PendingApproval {
  id: string;
  requestedAt: string;
  ageHours: number;
  expiresInHours: number | null;
  overdue: boolean;
  estimatedFareKes: number;
  route: string;
  departmentId: string | null;
}

export interface PendingApprovalsSummary {
  items: PendingApproval[];
  count: number;
  overdue: number;
  exposureKes: number;
  oldestAgeHours: number;
}

export function pendingApprovals(
  rows: AccountApprovalRow[],
  now = Date.now(),
  slaHours = 4,
): PendingApprovalsSummary {
  const items = rows
    .filter((r) => PENDING.has(r.status))
    .map((r) => {
      const ageHours = (now - new Date(r.createdAt).getTime()) / 3_600_000;
      const expiresInHours = r.expiresAt
        ? (new Date(r.expiresAt).getTime() - now) / 3_600_000
        : null;
      return {
        id: r.id,
        requestedAt: r.createdAt,
        ageHours,
        expiresInHours,
        overdue: ageHours > slaHours || (expiresInHours != null && expiresInHours < 0),
        estimatedFareKes: r.estimatedFareKes,
        route: [r.pickup || "Pickup TBC", r.dropoff || "Drop-off TBC"].join(" → "),
        departmentId: r.departmentId,
      };
    })
    .sort((a, b) => b.ageHours - a.ageHours);
  return {
    items,
    count: items.length,
    overdue: items.filter((i) => i.overdue).length,
    exposureKes: items.reduce((s, i) => s + i.estimatedFareKes, 0),
    oldestAgeHours: items.length ? items[0].ageHours : 0,
  };
}

/* ------------------------------------------------------------ monthly spend */

export interface MonthlySpend {
  monthKey: string;
  invoicedKes: number;
  paidKes: number;
  outstandingKes: number;
  tripCount: number;
  avgTripKes: number;
  deltaVsPrevPct: number | null;
}

const monthKey = (iso: string | number | Date) => new Date(iso).toISOString().slice(0, 7);

export function monthlySpend(
  invoices: AccountInvoiceRow[],
  items: AccountInvoiceItemRow[],
  now = Date.now(),
): MonthlySpend {
  const key = monthKey(now);
  const prevKey = monthKey(new Date(new Date(now).getFullYear(), new Date(now).getMonth() - 1, 15));
  const inMonth = invoices.filter((i) => monthKey(i.issuedAt ?? i.createdAt) === key);
  const inPrev = invoices.filter((i) => monthKey(i.issuedAt ?? i.createdAt) === prevKey);
  const ids = new Set(inMonth.map((i) => i.id));
  const trips = items.filter((it) => ids.has(it.invoiceId));
  const invoiced = inMonth.reduce((s, i) => s + i.totalKes, 0);
  const prev = inPrev.reduce((s, i) => s + i.totalKes, 0);
  return {
    monthKey: key,
    invoicedKes: invoiced,
    paidKes: inMonth.reduce((s, i) => s + i.paidKes, 0),
    outstandingKes: inMonth.reduce((s, i) => s + i.balanceKes, 0),
    tripCount: trips.length,
    avgTripKes: trips.length ? trips.reduce((s, t) => s + t.totalKes, 0) / trips.length : 0,
    deltaVsPrevPct: prev > 0 ? ((invoiced - prev) / prev) * 100 : null,
  };
}

export function spendTrend(
  invoices: AccountInvoiceRow[],
  months = 6,
  now = Date.now(),
): Array<{ monthKey: string; invoicedKes: number }> {
  const base = new Date(now);
  const keys: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    keys.push(monthKey(new Date(base.getFullYear(), base.getMonth() - i, 15)));
  }
  return keys.map((k) => ({
    monthKey: k,
    invoicedKes: invoices
      .filter((inv) => monthKey(inv.issuedAt ?? inv.createdAt) === k)
      .reduce((s, inv) => s + inv.totalKes, 0),
  }));
}

/* -------------------------------------------------------- department budgets */

export type BudgetBand = "healthy" | "watch" | "at_limit" | "over";

export interface DepartmentBudget {
  id: string;
  name: string;
  code: string | null;
  budgetKes: number;
  spentKes: number;
  remainingKes: number;
  utilisationPct: number;
  band: BudgetBand;
}

export function budgetBand(pct: number): BudgetBand {
  if (pct > 100) return "over";
  if (pct >= 90) return "at_limit";
  if (pct >= 70) return "watch";
  return "healthy";
}

export function departmentBudgets(
  departments: AccountDepartmentRow[],
  items: AccountInvoiceItemRow[],
  invoices: AccountInvoiceRow[],
  now = Date.now(),
): DepartmentBudget[] {
  const key = monthKey(now);
  const monthInvoiceIds = new Set(
    invoices.filter((i) => monthKey(i.issuedAt ?? i.createdAt) === key).map((i) => i.id),
  );
  const monthItems = items.filter((it) => monthInvoiceIds.has(it.invoiceId));
  const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
  return departments
    .filter((d) => d.active)
    .map((d) => {
      const spent = monthItems
        .filter(
          (it) =>
            norm(it.department) === norm(d.name) ||
            (!!d.code && norm(it.department) === norm(d.code)) ||
            (!!d.costCenter && norm(it.costCenter) === norm(d.costCenter)),
        )
        .reduce((s, it) => s + it.totalKes, 0);
      const pct = d.monthlyBudgetKes > 0 ? (spent / d.monthlyBudgetKes) * 100 : 0;
      return {
        id: d.id,
        name: d.name,
        code: d.code,
        budgetKes: d.monthlyBudgetKes,
        spentKes: spent,
        remainingKes: d.monthlyBudgetKes - spent,
        utilisationPct: pct,
        band: budgetBand(pct),
      };
    })
    .sort((a, b) => b.utilisationPct - a.utilisationPct);
}

/* ----------------------------------------------------------------- compliance */

export type ComplianceState = "compliant" | "expiring" | "expired" | "pending_review" | "rejected" | "missing";

export interface ComplianceItem {
  docType: string;
  label: string;
  state: ComplianceState;
  expiryDate: string | null;
  daysToExpiry: number | null;
  documentNumber: string | null;
}

export interface ComplianceStatus {
  items: ComplianceItem[];
  compliant: boolean;
  scorePct: number;
  blocking: ComplianceItem[];
}

export const REQUIRED_DOCS: Array<{ docType: string; label: string }> = [
  { docType: "cr12", label: "CR12 (Company officials)" },
  { docType: "certificate_of_incorporation", label: "Certificate of incorporation" },
  { docType: "kra_pin", label: "KRA PIN certificate" },
  { docType: "tax_compliance", label: "Tax compliance certificate" },
  { docType: "director_id", label: "Director identification" },
  { docType: "signed_contract", label: "Signed corporate agreement" },
];

export function complianceStatus(
  docs: AccountDocumentRow[],
  now = Date.now(),
  expiringWithinDays = 30,
): ComplianceStatus {
  const items: ComplianceItem[] = REQUIRED_DOCS.map(({ docType, label }) => {
    const matches = docs
      .filter((d) => d.docType.toLowerCase() === docType)
      .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
    const doc = matches[0];
    if (!doc) {
      return { docType, label, state: "missing", expiryDate: null, daysToExpiry: null, documentNumber: null };
    }
    const daysToExpiry = doc.expiryDate
      ? Math.round((new Date(doc.expiryDate).getTime() - now) / DAY)
      : null;
    let state: ComplianceState = "compliant";
    const status = doc.status.toLowerCase();
    if (status === "rejected") state = "rejected";
    else if (status !== "approved" && status !== "verified") state = "pending_review";
    else if (daysToExpiry != null && daysToExpiry < 0) state = "expired";
    else if (daysToExpiry != null && daysToExpiry <= expiringWithinDays) state = "expiring";
    return { docType, label, state, expiryDate: doc.expiryDate, daysToExpiry, documentNumber: doc.documentNumber };
  });
  const good = items.filter((i) => i.state === "compliant" || i.state === "expiring").length;
  const blocking = items.filter(
    (i) => i.state === "missing" || i.state === "expired" || i.state === "rejected",
  );
  return {
    items,
    blocking,
    compliant: blocking.length === 0,
    scorePct: items.length ? (good / items.length) * 100 : 0,
  };
}

/* ------------------------------------------------------- invoices & receipts */

export interface LedgerEntry {
  id: string;
  kind: "invoice" | "receipt";
  reference: string;
  date: string;
  amountKes: number;
  balanceKes: number;
  status: string;
  overdue: boolean;
}

export function invoiceLedger(invoices: AccountInvoiceRow[], now = Date.now()): LedgerEntry[] {
  const rows: LedgerEntry[] = [];
  for (const i of invoices) {
    const reference = i.invoiceNumber || `INV-${i.id.slice(0, 8).toUpperCase()}`;
    rows.push({
      id: i.id,
      kind: "invoice",
      reference,
      date: i.issuedAt ?? i.createdAt,
      amountKes: i.totalKes,
      balanceKes: i.balanceKes,
      status: i.status,
      overdue: !!i.dueAt && i.balanceKes > 0 && new Date(i.dueAt).getTime() < now,
    });
    if (i.paidKes > 0) {
      rows.push({
        id: `${i.id}-receipt`,
        kind: "receipt",
        reference: `RCT-${reference}`,
        date: i.paidAt ?? i.issuedAt ?? i.createdAt,
        amountKes: i.paidKes,
        balanceKes: 0,
        status: "paid",
        overdue: false,
      });
    }
  }
  return rows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

export interface StatementTotals {
  invoicedKes: number;
  paidKes: number;
  outstandingKes: number;
  overdueKes: number;
}

export function statementTotals(invoices: AccountInvoiceRow[], now = Date.now()): StatementTotals {
  return {
    invoicedKes: invoices.reduce((s, i) => s + i.totalKes, 0),
    paidKes: invoices.reduce((s, i) => s + i.paidKes, 0),
    outstandingKes: invoices.reduce((s, i) => s + i.balanceKes, 0),
    overdueKes: invoices
      .filter((i) => !!i.dueAt && i.balanceKes > 0 && new Date(i.dueAt).getTime() < now)
      .reduce((s, i) => s + i.balanceKes, 0),
  };
}

const csvCell = (v: string | number | null | undefined): string => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** RFC4180-safe statement CSV for download. */
export function buildStatementCsv(
  accountName: string,
  invoices: AccountInvoiceRow[],
  now = Date.now(),
): string {
  const totals = statementTotals(invoices, now);
  const header = [
    `Yalla Mobility corporate statement`,
    `Account,${csvCell(accountName)}`,
    `Generated,${new Date(now).toISOString()}`,
    `Invoiced,${totals.invoicedKes}`,
    `Paid,${totals.paidKes}`,
    `Outstanding,${totals.outstandingKes}`,
    `Overdue,${totals.overdueKes}`,
    "",
  ];
  const cols = ["Type", "Reference", "Date", "Amount KES", "Balance KES", "Status", "Overdue"];
  const rows = invoiceLedger(invoices, now).map((e) =>
    [e.kind, e.reference, e.date, e.amountKes, e.balanceKes, e.status, e.overdue ? "yes" : "no"]
      .map(csvCell)
      .join(","),
  );
  return [...header, cols.join(","), ...rows].join("\n");
}

export const formatKes = (n: number): string => `KES ${Math.round(n).toLocaleString("en-KE")}`;
