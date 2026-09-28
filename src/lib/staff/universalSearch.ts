/**
 * TaxiD Universal Search — one query across every authorised entity class.
 *
 * Each entity class declares the table it reads, the columns it matches, the
 * sensitivity scope required to see it, the facets it can be narrowed by, the
 * actions it supports and the marketplace workflow stage it belongs to. Access
 * is enforced server-side by RLS; the scope check here only decides what the UI
 * offers, so no surface implies access it cannot obtain. Nothing is fabricated:
 * a class with no resolvable source, or one the employee lacks scope for,
 * reports that state explicitly.
 */

import { supabase } from "@/integrations/supabase/client";
import { sanitizeOrFilterTerm } from "@/lib/security/postgrestFilter";
import { hasScope, type StaffScope } from "@/lib/staff/access";
import type { WorkflowStageId } from "@/lib/staff/marketplaceWorkflow";

export type SearchEntityId =
  | "customers"
  | "leads"
  | "contracts"
  | "bookings"
  | "transactions"
  | "partners"
  | "documents"
  | "tasks"
  | "projects"
  | "policies"
  | "knowledge"
  | "people";

/** Actions a result can offer, subject to the reader's scopes. */
export type SearchActionId = "open" | "trace" | "assign" | "approve" | "follow_up";

export interface SearchHit {
  id: string;
  title: string;
  subtitle?: string;
  meta?: string;
  href?: string;
  /** Status as read from the record, used for the status facet and actions. */
  status?: string;
}

/** Per-class outcome. `unavailable` = no wired source; never a fake empty win. */
export type SearchClassState = "ok" | "empty" | "out_of_scope" | "unavailable" | "error";

export interface SearchClassResult {
  entity: SearchEntityId;
  label: string;
  scope: StaffScope;
  state: SearchClassState;
  source?: string;
  hits: SearchHit[];
  note?: string;
  /** Workflow stage this class evidences, for the Demand → CLV trace. */
  stage: WorkflowStageId;
  /** Facets this class could actually apply to the query. */
  appliedFacets: string[];
  /** Facets requested but not supported by the underlying table. */
  ignoredFacets: string[];
}

interface EntityAdapter {
  id: SearchEntityId;
  label: string;
  scope: StaffScope;
  /** Workflow stage evidenced by this class. */
  stage: WorkflowStageId;
  /** Table backing the class, when one exists. */
  table?: string;
  /** Columns matched with ilike, joined into a PostgREST `or` expression. */
  columns?: string[];
  select?: string;
  map?: (row: Record<string, unknown>) => SearchHit;
  /** Column holding the lifecycle status, when the class has one. */
  statusColumn?: string;
  /** Column used for date-range narrowing. */
  dateColumn?: string;
  /** Column holding the owning organisation unit (corporate account). */
  orgColumn?: string;
  /** Actions offered for hits in this class, before permission filtering. */
  actions?: SearchActionId[];
  /** Scope required to approve/record a decision on this class. */
  approvalScope?: StaffScope;
  /** Explanation shown when the class has no wired source yet. */
  unavailableNote?: string;
}

const sel = (v: string): string => v;

const s = (v: unknown) => (v == null ? "" : String(v));

export const SEARCH_ADAPTERS: EntityAdapter[] = [
  {
    id: "customers",
    label: "Customers",
    scope: "commercial",
    stage: "customer",
    table: "corporate_accounts",
    columns: ["legal_name", "trading_name", "registration_number", "billing_email"],
    select: "id, legal_name, trading_name, status, billing_email, created_at",
    statusColumn: "status",
    dateColumn: "created_at",
    orgColumn: "id",
    actions: ["open", "trace", "assign", "follow_up"],
    map: (r) => ({
      id: s(r.id),
      title: s(r.legal_name) || s(r.trading_name) || "Corporate account",
      subtitle: s(r.trading_name) || s(r.billing_email),
      meta: s(r.status),
      status: s(r.status),
      href: `/dashboard/admin/corporate/${s(r.id)}`,
    }),
  },
  {
    id: "leads",
    label: "Leads",
    scope: "commercial",
    stage: "demand",
    table: "contact_submissions",
    columns: ["name", "email", "company", "subject"],
    select: "id, name, company, email, type, status, created_at",
    statusColumn: "status",
    dateColumn: "created_at",
    actions: ["trace", "assign", "follow_up"],
    map: (r) => ({
      id: s(r.id),
      title: s(r.company) || s(r.name) || "Enquiry",
      subtitle: [s(r.name), s(r.email)].filter(Boolean).join(" · "),
      meta: [s(r.type), s(r.status)].filter(Boolean).join(" · "),
      status: s(r.status),
    }),
  },
  {
    id: "contracts",
    label: "Contracts",
    scope: "commercial",
    stage: "matching",
    table: "charter_quotes",
    columns: ["reference", "asset_name", "category_slug"],
    select: "id, reference, asset_name, category_slug, status, total, currency, created_at",
    statusColumn: "status",
    dateColumn: "created_at",
    actions: ["trace", "approve", "follow_up"],
    approvalScope: "commercial",
    map: (r) => ({
      id: s(r.id),
      title: s(r.reference) || "Quotation",
      subtitle: [s(r.asset_name), s(r.category_slug)].filter(Boolean).join(" · "),
      meta: [s(r.status), s(r.currency) && `${s(r.currency)} ${s(r.total)}`].filter(Boolean).join(" · "),
      status: s(r.status),
    }),
  },
  {
    id: "bookings",
    label: "Bookings",
    scope: "department",
    stage: "fulfilment",
    table: "charter_bookings",
    columns: ["reference", "asset_name", "category_slug"],
    select: "id, reference, asset_name, category_slug, status, payment_status, created_at",
    statusColumn: "status",
    dateColumn: "created_at",
    actions: ["trace", "assign", "follow_up"],
    map: (r) => ({
      id: s(r.id),
      title: s(r.reference) || "Booking",
      subtitle: [s(r.asset_name), s(r.category_slug)].filter(Boolean).join(" · "),
      meta: [s(r.status), s(r.payment_status)].filter(Boolean).join(" · "),
      status: s(r.status),
    }),
  },
  {
    id: "transactions",
    label: "Transactions",
    scope: "financial",
    stage: "payment",
    table: "corporate_invoices",
    columns: ["invoice_number", "etims_invoice_id"],
    select: "id, invoice_number, status, total_cents, balance_cents, currency, issued_at, corporate_id",
    statusColumn: "status",
    dateColumn: "issued_at",
    orgColumn: "corporate_id",
    actions: ["trace", "approve", "follow_up"],
    approvalScope: "financial",
    map: (r) => ({
      id: s(r.id),
      title: s(r.invoice_number) || "Invoice",
      subtitle: `${s(r.currency) || "KES"} ${(Number(r.total_cents ?? 0) / 100).toLocaleString()}`,
      meta: s(r.status),
      status: s(r.status),
    }),
  },
  {
    id: "partners",
    label: "Marketplace partners & operators",
    scope: "department",
    stage: "supply",
    table: "charter_partner_applications",
    columns: ["operator_name", "contact_name", "contact_email", "home_base"],
    select: "id, operator_name, contact_name, country, status, fleet_size, created_at",
    statusColumn: "status",
    dateColumn: "created_at",
    actions: ["trace", "approve", "follow_up"],
    approvalScope: "department",
    map: (r) => ({
      id: s(r.id),
      title: s(r.operator_name) || "Operator",
      subtitle: [s(r.contact_name), s(r.country)].filter(Boolean).join(" · "),
      meta: s(r.status),
      status: s(r.status),
    }),
  },
  {
    id: "documents",
    label: "Documents",
    scope: "department",
    stage: "supply",
    table: "corporate_documents",
    columns: ["original_name", "document_number", "doc_type"],
    select: "id, original_name, doc_type, document_number, status, expiry_date, created_at, corporate_id",
    statusColumn: "status",
    dateColumn: "created_at",
    orgColumn: "corporate_id",
    actions: ["trace", "approve", "follow_up"],
    approvalScope: "department",
    map: (r) => ({
      id: s(r.id),
      title: s(r.original_name) || s(r.doc_type) || "Document",
      subtitle: [s(r.doc_type), s(r.document_number)].filter(Boolean).join(" · "),
      meta: [s(r.status), s(r.expiry_date) && `expires ${s(r.expiry_date)}`].filter(Boolean).join(" · "),
      status: s(r.status),
    }),
  },
  {
    id: "people",
    label: "People",
    scope: "department",
    stage: "customer",
    table: "corporate_employees",
    columns: ["full_name", "email", "employee_code"],
    select: "id, full_name, email, role, status, employee_code, created_at, corporate_id",
    statusColumn: "status",
    dateColumn: "created_at",
    orgColumn: "corporate_id",
    actions: ["trace", "follow_up"],
    map: (r) => ({
      id: s(r.id),
      title: s(r.full_name) || s(r.email) || "Person",
      subtitle: s(r.email),
      meta: [s(r.role), s(r.status)].filter(Boolean).join(" · "),
      status: s(r.status),
    }),
  },
  {
    id: "policies",
    label: "Policies",
    scope: "department",
    stage: "customer",
    table: "corporate_policy_rules",
    columns: ["rule_kind", "severity"],
    select: "id, rule_kind, severity, max_fare_cents, created_at, corporate_id",
    dateColumn: "created_at",
    orgColumn: "corporate_id",
    actions: ["trace", "follow_up"],
    map: (r) => ({
      id: s(r.id),
      title: s(r.rule_kind) || "Policy rule",
      meta: s(r.severity),
    }),
  },
  {
    id: "tasks",
    label: "Tasks",
    scope: "self",
    stage: "fulfilment",
    unavailableNote:
      "Platform-wide task assignment is not yet bound to staff positions. Follow-up tasks you create from search results are held in the staff follow-up register.",
  },
  {
    id: "projects",
    label: "Projects",
    scope: "team",
    stage: "lifetime_value",
    unavailableNote: "Project records are not yet held in the platform; nothing is inferred from adjacent data.",
  },
  {
    id: "knowledge",
    label: "Knowledge",
    scope: "self",
    stage: "lifetime_value",
    unavailableNote: "The knowledge base is defined but not yet populated with searchable, version-controlled articles.",
  },
];

/* --------------------------------------------------------------- facets */

/** Faceted narrowing. Every facet states which classes could honour it. */
export interface SearchFacets {
  entities?: SearchEntityId[];
  /** Free-form statuses matched case-insensitively against the class status column. */
  statuses?: string[];
  /** Inclusive ISO dates. */
  from?: string;
  to?: string;
  /** Corporate account id acting as the organisation unit. */
  orgUnit?: string;
  /** Restrict to classes evidencing one workflow stage. */
  stage?: WorkflowStageId;
}

/** Status vocabulary offered per class, derived from platform conventions. */
export const STATUS_FACET_OPTIONS = [
  "draft",
  "pending",
  "submitted",
  "under_review",
  "approved",
  "active",
  "rejected",
  "expired",
  "paid",
  "cancelled",
  "completed",
] as const;

export interface UniversalSearchOptions extends SearchFacets {
  limitPerEntity?: number;
}

/**
 * Run the search across every class the employee's roles permit. Each class
 * resolves independently — one failure never removes the others' honesty.
 */
export async function runUniversalSearch(
  term: string,
  roles: readonly string[],
  options: UniversalSearchOptions = {},
): Promise<SearchClassResult[]> {
  const { entities, statuses, from, to, orgUnit, stage, limitPerEntity = 5 } = options;
  const safe = sanitizeOrFilterTerm(term);
  const selected = SEARCH_ADAPTERS.filter(
    (a) => (!entities || entities.includes(a.id)) && (!stage || a.stage === stage),
  );

  return Promise.all(
    selected.map(async (a): Promise<SearchClassResult> => {
      const applied: string[] = [];
      const ignored: string[] = [];
      const base = {
        entity: a.id,
        label: a.label,
        scope: a.scope,
        stage: a.stage,
        hits: [] as SearchHit[],
        appliedFacets: applied,
        ignoredFacets: ignored,
      };

      if (!hasScope(roles, a.scope)) {
        return { ...base, state: "out_of_scope", note: `Requires the ${a.scope} data scope.` };
      }
      if (!a.table || !a.columns || !a.map) {
        return { ...base, state: "unavailable", note: a.unavailableNote };
      }
      if (!safe) return { ...base, state: "empty", source: a.table };

      const or = a.columns.map((c) => `${c}.ilike.%${safe}%`).join(",");
      let q = supabase
        .from(a.table as never)
        .select(sel(a.select ?? "*"))
        .or(or);

      if (statuses?.length) {
        if (a.statusColumn) {
          q = q.in(a.statusColumn as never, statuses as never);
          applied.push("Status");
        } else ignored.push("Status");
      }
      if (from) {
        if (a.dateColumn) {
          q = q.gte(a.dateColumn as never, from as never);
          applied.push("From date");
        } else ignored.push("From date");
      }
      if (to) {
        if (a.dateColumn) {
          q = q.lte(a.dateColumn as never, `${to}T23:59:59.999Z` as never);
          applied.push("To date");
        } else ignored.push("To date");
      }
      if (orgUnit) {
        if (a.orgColumn) {
          q = q.eq(a.orgColumn as never, orgUnit as never);
          applied.push("Organisation unit");
        } else ignored.push("Organisation unit");
      }

      const { data, error } = await q.limit(limitPerEntity);

      if (error) {
        return {
          ...base,
          state: "error",
          source: a.table,
          note: "This class is governed server-side and did not return results for your access.",
        };
      }
      const rows = (data ?? []) as unknown as Record<string, unknown>[];
      return {
        ...base,
        state: rows.length ? "ok" : "empty",
        source: a.table,
        hits: rows.map(a.map),
      };
    }),
  );
}

export const SEARCH_CLASS_STATE_LABEL: Record<SearchClassState, string> = {
  ok: "RESULTS",
  empty: "NO MATCHES",
  out_of_scope: "NOT IN YOUR SCOPE",
  unavailable: "DATA NOT AVAILABLE",
  error: "RESTRICTED",
};

export function adapterFor(entity: SearchEntityId): EntityAdapter | undefined {
  return SEARCH_ADAPTERS.find((a) => a.id === entity);
}

/** Actions the reader may actually perform on a class, given their scopes. */
export function permittedActions(entity: SearchEntityId, roles: readonly string[]): SearchActionId[] {
  const a = adapterFor(entity);
  if (!a?.actions) return [];
  return a.actions.filter((action) => {
    if (action === "approve") return a.approvalScope ? hasScope(roles, a.approvalScope) : false;
    return true;
  });
}
