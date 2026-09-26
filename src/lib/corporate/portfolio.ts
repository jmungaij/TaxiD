/**
 * Corporate portfolio aggregation — pure, testable functions that turn the
 * raw rows returned by the `corporate-admin-console` `portfolio` op into the
 * row model the Control Tower renders (spend, wallet, arrears, risk flags).
 *
 * Kept free of React and Supabase so the risk/segment logic can be unit
 * tested without a browser or a database.
 */

export interface PortfolioRaw {
  accounts: Array<{
    id: string;
    legal_name?: string | null;
    trading_name?: string | null;
    kra_pin?: string | null;
    billing_email?: string | null;
    status?: string | null;
    currency?: string | null;
    credit_limit_cents?: number | null;
    payment_terms_days?: number | null;
    created_at?: string | null;
  }>;
  ledger: Array<{
    corporate_id: string;
    amount_cents?: number | null;
    balance_after_cents?: number | null;
    entry_type?: string | null;
    occurred_at?: string | null;
    created_at?: string | null;
  }>;
  invoices: Array<{
    corporate_id: string;
    status?: string | null;
    total_cents?: number | null;
    balance_cents?: number | null;
    due_at?: string | null;
  }>;
  approvals: Array<{ corporate_id: string; status?: string | null; created_at?: string | null }>;
  documents: Array<{ corporate_id: string; status?: string | null; expiry_date?: string | null }>;
  employees: Array<{ corporate_id: string; status?: string | null }>;
  pending_kyb: Array<{ id: string; corporate_id?: string | null; status?: string | null }>;
}

export type RiskFlag =
  | "low_wallet"
  | "credit_breached"
  | "arrears"
  | "documents_expiring"
  | "documents_expired"
  | "kyb_pending"
  | "no_activity";

export const RISK_LABELS: Record<RiskFlag, string> = {
  low_wallet: "Low wallet",
  credit_breached: "Credit breached",
  arrears: "Arrears",
  documents_expiring: "Docs expiring",
  documents_expired: "Docs expired",
  kyb_pending: "KYB pending",
  no_activity: "No activity",
};

export interface PortfolioRow {
  id: string;
  name: string;
  legalName: string;
  kraPin: string | null;
  billingEmail: string | null;
  status: string;
  currency: string;
  creditLimitCents: number;
  paymentTermsDays: number;
  walletBalanceCents: number;
  spend30dCents: number;
  overdueCents: number;
  openInvoices: number;
  pendingApprovals: number;
  activeEmployees: number;
  expiringDocuments: number;
  expiredDocuments: number;
  kybPending: boolean;
  creditUtilisation: number;
  lastActivityAt: string | null;
  risks: RiskFlag[];
}

/** Wallet balances below this are flagged as operationally risky. */
export const LOW_WALLET_CENTS = 50_000_00;
/** Documents expiring within this window are surfaced as a risk. */
export const EXPIRY_WINDOW_DAYS = 30;

function ts(value?: string | null): number {
  if (!value) return 0;
  const n = Date.parse(value);
  return Number.isNaN(n) ? 0 : n;
}

function groupBy<T extends { corporate_id?: string | null }>(rows: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const key = row.corporate_id ?? "";
    if (!key) continue;
    const bucket = out.get(key);
    if (bucket) bucket.push(row);
    else out.set(key, [row]);
  }
  return out;
}

export function buildPortfolio(raw: PortfolioRaw, now: Date = new Date()): PortfolioRow[] {
  const nowMs = now.getTime();
  const spendWindow = nowMs - 30 * 24 * 3600 * 1000;
  const expiryWindow = nowMs + EXPIRY_WINDOW_DAYS * 24 * 3600 * 1000;

  const ledgerBy = groupBy(raw.ledger ?? []);
  const invoiceBy = groupBy(raw.invoices ?? []);
  const approvalBy = groupBy(raw.approvals ?? []);
  const documentBy = groupBy(raw.documents ?? []);
  const employeeBy = groupBy(raw.employees ?? []);
  const kybPendingIds = new Set(
    (raw.pending_kyb ?? []).map((d) => d.corporate_id ?? "").filter(Boolean),
  );

  return (raw.accounts ?? []).map((a) => {
    const ledger = [...(ledgerBy.get(a.id) ?? [])].sort(
      (x, y) => ts(y.occurred_at ?? y.created_at) - ts(x.occurred_at ?? x.created_at),
    );
    const invoices = invoiceBy.get(a.id) ?? [];
    const approvals = approvalBy.get(a.id) ?? [];
    const documents = documentBy.get(a.id) ?? [];
    const employees = employeeBy.get(a.id) ?? [];

    const walletBalanceCents = ledger[0]?.balance_after_cents ?? 0;
    const spend30dCents = ledger
      .filter((l) => ts(l.occurred_at ?? l.created_at) >= spendWindow)
      .filter((l) => (l.amount_cents ?? 0) < 0 || String(l.entry_type ?? "").includes("debit"))
      .reduce((sum, l) => sum + Math.abs(l.amount_cents ?? 0), 0);

    const openInvoices = invoices.filter((i) => (i.balance_cents ?? 0) > 0).length;
    const overdueCents = invoices
      .filter((i) => (i.balance_cents ?? 0) > 0 && ts(i.due_at) > 0 && ts(i.due_at) < nowMs)
      .reduce((sum, i) => sum + (i.balance_cents ?? 0), 0);

    const pendingApprovals = approvals.filter((r) => r.status === "pending").length;
    const activeEmployees = employees.filter((e) => (e.status ?? "active") === "active").length;

    const expiredDocuments = documents.filter(
      (d) => ts(d.expiry_date) > 0 && ts(d.expiry_date) < nowMs,
    ).length;
    const expiringDocuments = documents.filter((d) => {
      const t = ts(d.expiry_date);
      return t >= nowMs && t <= expiryWindow;
    }).length;

    const creditLimitCents = a.credit_limit_cents ?? 0;
    const creditUtilisation =
      creditLimitCents > 0 ? Math.min(2, overdueCents / creditLimitCents) : 0;
    const lastActivityMs = Math.max(
      ts(ledger[0]?.occurred_at ?? ledger[0]?.created_at),
      ...approvals.map((r) => ts(r.created_at)),
      0,
    );

    const kybPending = kybPendingIds.has(a.id);
    const risks: RiskFlag[] = [];
    if (walletBalanceCents < LOW_WALLET_CENTS) risks.push("low_wallet");
    if (creditLimitCents > 0 && overdueCents > creditLimitCents) risks.push("credit_breached");
    if (overdueCents > 0) risks.push("arrears");
    if (expiredDocuments > 0) risks.push("documents_expired");
    else if (expiringDocuments > 0) risks.push("documents_expiring");
    if (kybPending) risks.push("kyb_pending");
    if (lastActivityMs === 0) risks.push("no_activity");

    return {
      id: a.id,
      name: a.trading_name || a.legal_name || "Corporate",
      legalName: a.legal_name ?? "",
      kraPin: a.kra_pin ?? null,
      billingEmail: a.billing_email ?? null,
      status: a.status ?? "unknown",
      currency: a.currency ?? "KES",
      creditLimitCents,
      paymentTermsDays: a.payment_terms_days ?? 0,
      walletBalanceCents,
      spend30dCents,
      overdueCents,
      openInvoices,
      pendingApprovals,
      activeEmployees,
      expiringDocuments,
      expiredDocuments,
      kybPending,
      creditUtilisation,
      lastActivityAt: lastActivityMs ? new Date(lastActivityMs).toISOString() : null,
      risks,
    };
  });
}

export interface PortfolioTotals {
  corporates: number;
  active: number;
  suspended: number;
  pendingKyb: number;
  walletFloatCents: number;
  overdueCents: number;
  pendingApprovals: number;
  atRisk: number;
}

export function portfolioTotals(rows: PortfolioRow[]): PortfolioTotals {
  return {
    corporates: rows.length,
    active: rows.filter((r) => r.status.toUpperCase() === "ACTIVE").length,
    suspended: rows.filter((r) => r.status.toUpperCase() === "SUSPENDED").length,
    pendingKyb: rows.filter((r) => r.kybPending).length,
    walletFloatCents: rows.reduce((s, r) => s + Math.max(0, r.walletBalanceCents), 0),
    overdueCents: rows.reduce((s, r) => s + r.overdueCents, 0),
    pendingApprovals: rows.reduce((s, r) => s + r.pendingApprovals, 0),
    atRisk: rows.filter((r) => r.risks.length > 0).length,
  };
}

export type SavedViewKey =
  | "all"
  | "arrears"
  | "awaiting_kyb"
  | "low_wallet"
  | "doc_risk"
  | "suspended"
  | "approvals";

export const SAVED_VIEWS: Array<{ key: SavedViewKey; label: string; description: string }> = [
  { key: "all", label: "All corporates", description: "Every account in the book of business" },
  { key: "arrears", label: "Arrears", description: "Overdue invoice balances outstanding" },
  { key: "awaiting_kyb", label: "Awaiting KYB", description: "Submitted onboarding pending a decision" },
  { key: "low_wallet", label: "Low wallet", description: "Pre-funded balance below the safety floor" },
  { key: "doc_risk", label: "Document risk", description: "Compliance documents expired or expiring" },
  { key: "suspended", label: "Suspended", description: "Accounts currently blocked from booking" },
  { key: "approvals", label: "Open approvals", description: "Trips waiting on a corporate decision" },
];

export function applySavedView(rows: PortfolioRow[], view: SavedViewKey): PortfolioRow[] {
  switch (view) {
    case "arrears": return rows.filter((r) => r.overdueCents > 0);
    case "awaiting_kyb": return rows.filter((r) => r.kybPending);
    case "low_wallet": return rows.filter((r) => r.risks.includes("low_wallet"));
    case "doc_risk": return rows.filter((r) => r.expiredDocuments + r.expiringDocuments > 0);
    case "suspended": return rows.filter((r) => r.status.toUpperCase() === "SUSPENDED");
    case "approvals": return rows.filter((r) => r.pendingApprovals > 0);
    default: return rows;
  }
}

export type PortfolioSortKey =
  | "name" | "spend30d" | "wallet" | "overdue" | "approvals" | "employees" | "risk";

export function searchPortfolio(rows: PortfolioRow[], query: string): PortfolioRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) =>
    [r.name, r.legalName, r.kraPin, r.billingEmail]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(q)),
  );
}

export function sortPortfolio(
  rows: PortfolioRow[],
  key: PortfolioSortKey,
  direction: "asc" | "desc" = "desc",
): PortfolioRow[] {
  const value = (r: PortfolioRow): number | string => {
    switch (key) {
      case "name": return r.name.toLowerCase();
      case "spend30d": return r.spend30dCents;
      case "wallet": return r.walletBalanceCents;
      case "overdue": return r.overdueCents;
      case "approvals": return r.pendingApprovals;
      case "employees": return r.activeEmployees;
      case "risk": return r.risks.length;
    }
  };
  const sorted = [...rows].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (typeof va === "string" || typeof vb === "string") {
      return String(va).localeCompare(String(vb));
    }
    return va - vb;
  });
  return direction === "desc" ? sorted.reverse() : sorted;
}
