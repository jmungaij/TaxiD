/**
 * STAGE 8 — ACCOUNT 360.
 *
 * One read per account across the authoritative systems of record:
 *   relationship state → crm_accounts / crm_contacts / crm_next_actions
 *   pipeline           → commercial_opportunities (via crm_opportunity_links)
 *   proposals+contracts→ commercial_account_pack (server-side, staff-gated)
 *   money + orders     → commercial_transactions
 *   issues             → commercial_exceptions
 *
 * Nothing is estimated. Where a domain is withheld by access control or the
 * account carries no billing entity, the section reports that explicitly so the
 * page can say "not available" instead of showing a zero as if it were revenue.
 */
import { supabase } from "@/integrations/supabase/client";
import { getAccount, listAccountOpportunities, listContacts, listNextActions } from "@/lib/crm/api";
import type { CrmAccount, CrmContact, CrmNextAction } from "@/lib/crm/types";

// Commercial tables are newer than the generated types snapshot.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface Section<T> {
  data: T;
  /** False when the read was refused for this employee. */
  authorised: boolean;
  /** Set when the account simply has no record of this kind. */
  reason: string | null;
}

const ok = <T,>(data: T): Section<T> => ({ data, authorised: true, reason: null });
const denied = <T,>(data: T, reason: string): Section<T> => ({ data, authorised: false, reason });
const none = <T,>(data: T, reason: string): Section<T> => ({ data, authorised: true, reason });

export interface AccountOpportunity {
  id: string;
  ref: string | null;
  title: string;
  stage: string;
  valueCents: number | null;
  currency: string | null;
  probability: number | null;
}

export interface AccountQuotation {
  id: string;
  quote_number: string;
  total_amount: number | null;
  currency: string | null;
  status: string;
  approval_status: string | null;
  valid_until: string | null;
  created_at: string;
}

export interface AccountSchedule {
  id: string;
  title: string;
  services: string[];
  locations: string[];
  vehicle_categories: string[];
  validity: string | null;
  approval_status: string;
}

export interface AccountContract {
  id: string;
  template: string;
  template_version: string;
  status: string;
  effective_date: string | null;
  contract_term: string | null;
  selected_services: string[];
  customer_legal_name: string | null;
  schedules: AccountSchedule[];
}

export interface AccountOrder {
  id: string;
  ref: string;
  serviceLine: string;
  status: string;
  currency: string;
  customerChargeCents: number | null;
  platformRevenueCents: number | null;
  paymentStatus: string | null;
  createdAt: string;
  fulfilledAt: string | null;
}

export interface AccountIssue {
  id: string;
  ref: string | null;
  kind: string;
  stage: string;
  status: string;
  severity: string;
  slaDueAt: string | null;
  recommendedAction: string | null;
  valueAtRiskCents: number | null;
  currency: string;
  createdAt: string;
}

export interface AccountRevenue {
  currency: string | null;
  /** Money the customer was charged on settled service events. */
  billedCents: number;
  /** Platform revenue recognised on those events. */
  platformRevenueCents: number;
  settledOrders: number;
  openOrders: number;
  /** Orders whose economics the finance engine has not completed. */
  incompleteEconomics: number;
}

export interface Account360 {
  account: CrmAccount | null;
  contacts: Section<CrmContact[]>;
  nextActions: Section<CrmNextAction[]>;
  opportunities: Section<AccountOpportunity[]>;
  quotations: Section<AccountQuotation[]>;
  contracts: Section<AccountContract[]>;
  orders: Section<AccountOrder[]>;
  issues: Section<AccountIssue[]>;
  revenue: Section<AccountRevenue | null>;
  /** Services the signed contracts and approved schedules actually cover. */
  activeServices: string[];
  error: string | null;
}

const OPEN_OPPORTUNITY_STAGES = new Set(["won", "lost", "closed", "closed_won", "closed_lost"]);

export function isOpenOpportunity(stage: string): boolean {
  return !OPEN_OPPORTUNITY_STAGES.has(stage.toLowerCase());
}

const SETTLED = new Set(["settled", "recognised", "paid", "closed", "fulfilled"]);

export function summariseRevenue(orders: AccountOrder[]): AccountRevenue {
  const settled = orders.filter((o) => SETTLED.has(o.status.toLowerCase()));
  return {
    currency: orders[0]?.currency ?? null,
    billedCents: settled.reduce((s, o) => s + (o.customerChargeCents ?? 0), 0),
    platformRevenueCents: settled.reduce((s, o) => s + (o.platformRevenueCents ?? 0), 0),
    settledOrders: settled.length,
    openOrders: orders.length - settled.length,
    incompleteEconomics: orders.filter((o) => o.customerChargeCents == null).length,
  };
}

export function deriveActiveServices(contracts: AccountContract[]): string[] {
  const services = new Set<string>();
  for (const contract of contracts) {
    if (!["active", "signed", "executed"].includes(contract.status.toLowerCase())) continue;
    for (const s of contract.selected_services ?? []) services.add(s);
    for (const schedule of contract.schedules ?? []) {
      if (schedule.approval_status?.toLowerCase() === "approved") for (const s of schedule.services ?? []) services.add(s);
    }
  }
  return [...services].sort();
}

export function formatKes(cents: number | null, currency: string | null): string | null {
  if (cents == null) return null;
  return `${currency ?? ""} ${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`.trim();
}

async function fetchOrders(corporateId: string | null): Promise<Section<AccountOrder[]>> {
  if (!corporateId)
    return none<AccountOrder[]>(
      [],
      "This account has no billing entity linked yet, so no service orders or revenue can be attributed to it.",
    );
  const { data, error } = await db
    .from("commercial_transactions")
    .select(
      "id, transaction_ref, service_line, status, currency, customer_charge_cents, platform_revenue_cents, payment_status, created_at, fulfilled_at",
    )
    .eq("corporate_id", corporateId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return denied<AccountOrder[]>([], "Service orders and revenue are not released to your account.");
  const orders: AccountOrder[] = (data ?? []).map((r: Record<string, unknown>) => ({
    id: String(r.id),
    ref: String(r.transaction_ref ?? r.id),
    serviceLine: String(r.service_line ?? "unknown"),
    status: String(r.status ?? "unknown"),
    currency: String(r.currency ?? "KES"),
    customerChargeCents: (r.customer_charge_cents as number) ?? null,
    platformRevenueCents: (r.platform_revenue_cents as number) ?? null,
    paymentStatus: (r.payment_status as string) ?? null,
    createdAt: String(r.created_at),
    fulfilledAt: (r.fulfilled_at as string) ?? null,
  }));
  return orders.length === 0 ? none(orders, "No service order has been recorded for this account yet.") : ok(orders);
}

async function fetchIssues(transactionIds: string[]): Promise<Section<AccountIssue[]>> {
  if (transactionIds.length === 0) return none<AccountIssue[]>([], "No issue has been raised against this account.");
  const { data, error } = await db
    .from("commercial_exceptions")
    .select(
      "id, exception_ref, kind, stage, status, severity, sla_due_at, recommended_action, value_at_risk_cents, currency, created_at",
    )
    .in("transaction_id", transactionIds.slice(0, 100))
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return denied<AccountIssue[]>([], "Issues are not released to your account.");
  const issues: AccountIssue[] = (data ?? []).map((r: Record<string, unknown>) => ({
    id: String(r.id),
    ref: (r.exception_ref as string) ?? null,
    kind: String(r.kind),
    stage: String(r.stage),
    status: String(r.status),
    severity: String(r.severity),
    slaDueAt: (r.sla_due_at as string) ?? null,
    recommendedAction: (r.recommended_action as string) ?? null,
    valueAtRiskCents: (r.value_at_risk_cents as number) ?? null,
    currency: String(r.currency ?? "KES"),
    createdAt: String(r.created_at),
  }));
  return issues.length === 0 ? none(issues, "No issue has been raised against this account.") : ok(issues);
}

export async function fetchAccount360(accountId: string): Promise<Account360> {
  let account: CrmAccount | null = null;
  let error: string | null = null;
  try {
    account = await getAccount(accountId);
  } catch (e) {
    error = e instanceof Error ? e.message : "This account could not be read.";
  }

  const [contacts, nextActions, links, pack] = await Promise.all([
    listContacts(accountId).then(ok).catch(() => denied<CrmContact[]>([], "Contacts are not released to your account.")),
    listNextActions(accountId)
      .then(ok)
      .catch(() => denied<CrmNextAction[]>([], "Next actions are not released to your account.")),
    listAccountOpportunities(accountId).catch(() => null),
    db.rpc("commercial_account_pack", { p_account_id: accountId }).then(
      (r: { data: unknown; error: { message: string } | null }) => (r.error ? null : (r.data as Record<string, unknown>)),
    ),
  ]);

  const opportunities: Section<AccountOpportunity[]> = !links
    ? denied<AccountOpportunity[]>([], "Opportunities are not released to your account.")
    : (() => {
        const mapped = links
          .map((l) => l.opportunity)
          .filter((o): o is NonNullable<typeof o> => !!o)
          .map((o) => ({
            id: o.id,
            ref: o.opportunity_ref ?? null,
            title: o.title,
            stage: o.stage,
            valueCents: o.expected_value_cents ?? null,
            currency: o.currency ?? null,
            probability: o.probability_pct ?? null,
          }));
        return mapped.length === 0 ? none(mapped, "No opportunity is linked to this account yet.") : ok(mapped);
      })();

  const quotations: Section<AccountQuotation[]> = !pack
    ? denied<AccountQuotation[]>([], "Proposals are not released to your account.")
    : (() => {
        const list = ((pack.quotations as AccountQuotation[]) ?? []) as AccountQuotation[];
        return list.length === 0 ? none(list, "No proposal has been issued for this account yet.") : ok(list);
      })();

  const contracts: Section<AccountContract[]> = !pack
    ? denied<AccountContract[]>([], "Contracts are not released to your account.")
    : (() => {
        const list = (((pack.contracts as AccountContract[]) ?? []) as AccountContract[]).map((c) => ({
          ...c,
          selected_services: c.selected_services ?? [],
          schedules: c.schedules ?? [],
        }));
        return list.length === 0 ? none(list, "No contract exists for this account yet.") : ok(list);
      })();

  const orders = await fetchOrders(account?.corporate_id ?? null);
  const issues = await fetchIssues(orders.data.map((o) => o.id));

  const revenue: Section<AccountRevenue | null> = !orders.authorised
    ? denied<AccountRevenue | null>(null, orders.reason ?? "Revenue is not released to your account.")
    : orders.data.length === 0
      ? none<AccountRevenue | null>(null, orders.reason ?? "No billed service event exists for this account yet.")
      : ok(summariseRevenue(orders.data));

  return {
    account,
    contacts,
    nextActions,
    opportunities,
    quotations,
    contracts,
    orders,
    issues,
    revenue,
    activeServices: deriveActiveServices(contracts.data),
    error,
  };
}
