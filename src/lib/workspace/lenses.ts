/**
 * MY WORKSPACE — COMMERCIAL LENSES.
 *
 * A lens is a PERSONAL PROJECTION of an authoritative commercial record: it
 * reads the same rows the Sales Portal / Commercial engines own (RLS-scoped),
 * derives execution signals (stalled, awaiting customer, awaiting approval,
 * missing next action) and always keeps the source id so every item deep-links
 * back to its system of record. No lens creates, caches or duplicates records.
 *
 * When row-level security withholds a domain the lens returns an empty list and
 * `authorised: false` — it never substitutes demonstration data.
 */
import { supabase } from "@/integrations/supabase/client";

// Commercial tables are newer than the generated types snapshot.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface LensResult<T> {
  items: T[];
  /** False when the read was refused/withheld for this employee. */
  authorised: boolean;
  error: string | null;
}

const empty = <T,>(authorised: boolean, error: string | null = null): LensResult<T> => ({
  items: [],
  authorised,
  error,
});

const daysSince = (iso: string | null): number | null => {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 86_400_000) : null;
};

/** Money is stored in minor units; never invent a currency. */
export const formatMinor = (cents: number | null, currency: string | null): string | null =>
  cents == null
    ? null
    : `${currency ?? ""} ${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`.trim();

/* ------------------------------------------------------------------ signals */

export type LensSignal = {
  kind: "stalled" | "awaiting_customer" | "awaiting_approval" | "no_next_action" | "expiring" | "healthy";
  label: string;
  severity: "critical" | "high" | "medium" | "info";
};

const STALL_DAYS = 5;

/* ------------------------------------------------------------ opportunities */

export interface MyOpportunity {
  id: string;
  ref: string | null;
  title: string;
  customer: string | null;
  stage: string;
  probability: number | null;
  value: string | null;
  idleDays: number | null;
  signals: LensSignal[];
  sourcePath: string;
}

export async function fetchMyOpportunities(userId: string): Promise<LensResult<MyOpportunity>> {
  const { data, error } = await db
    .from("commercial_opportunities")
    .select(
      "id, opportunity_ref, title, stage, customer_label, expected_value_cents, currency, probability_pct, updated_at, quote_id",
    )
    .eq("owner_user_id", userId)
    .order("updated_at", { ascending: true })
    .limit(100);

  if (error) return empty<MyOpportunity>(false, error.message);

  const items: MyOpportunity[] = (data ?? []).map((row: Record<string, unknown>) => {
    const idle = daysSince(row.updated_at as string | null);
    const signals: LensSignal[] = [];
    if (idle != null && idle >= STALL_DAYS)
      signals.push({
        kind: "stalled",
        label: `No movement for ${idle} days`,
        severity: idle >= 14 ? "critical" : "high",
      });
    if (String(row.stage) === "quoted" && !row.quote_id)
      signals.push({ kind: "no_next_action", label: "Stage is Quoted but no quote is linked", severity: "high" });
    if (signals.length === 0) signals.push({ kind: "healthy", label: "Progressing normally", severity: "info" });

    return {
      id: String(row.id),
      ref: (row.opportunity_ref as string) ?? null,
      title: (row.title as string) ?? "Untitled opportunity",
      customer: (row.customer_label as string) ?? null,
      stage: String(row.stage ?? "unknown"),
      probability: (row.probability_pct as number) ?? null,
      value: formatMinor((row.expected_value_cents as number) ?? null, (row.currency as string) ?? null),
      idleDays: idle,
      signals,
      sourcePath: `/staff/sales?opportunity=${row.id}`,
    };
  });

  return { items, authorised: true, error: null };
}

/* -------------------------------------------------------------------- quotes */

export interface MyQuote {
  id: string;
  number: string | null;
  status: string;
  approvalStatus: string | null;
  value: string | null;
  validUntil: string | null;
  signals: LensSignal[];
  sourcePath: string;
}

export async function fetchMyQuotes(staffId: string): Promise<LensResult<MyQuote>> {
  const { data, error } = await db
    .from("commercial_quotations")
    .select("id, quote_number, status, approval_status, total_amount, currency, valid_until, updated_at, opportunity_id")
    .eq("owner_staff_id", staffId)
    .order("updated_at", { ascending: false })
    .limit(100);

  if (error) return empty<MyQuote>(false, error.message);

  const items: MyQuote[] = (data ?? []).map((row: Record<string, unknown>) => {
    const signals: LensSignal[] = [];
    const approval = (row.approval_status as string) ?? null;
    if (approval && approval !== "approved")
      signals.push({ kind: "awaiting_approval", label: `Approval: ${approval}`, severity: "high" });
    if (String(row.status) === "sent")
      signals.push({ kind: "awaiting_customer", label: "Sent — awaiting customer response", severity: "medium" });
    const validDays = row.valid_until ? -Number(daysSince(row.valid_until as string)) : null;
    if (validDays != null && validDays <= 7)
      signals.push({
        kind: "expiring",
        label: validDays < 0 ? "Validity expired" : `Valid for ${validDays} more days`,
        severity: validDays < 0 ? "critical" : "high",
      });
    if (signals.length === 0) signals.push({ kind: "healthy", label: "No action outstanding", severity: "info" });

    return {
      id: String(row.id),
      number: (row.quote_number as string) ?? null,
      status: String(row.status ?? "unknown"),
      approvalStatus: approval,
      value:
        row.total_amount == null
          ? null
          : `${(row.currency as string) ?? ""} ${Number(row.total_amount).toLocaleString()}`.trim(),
      validUntil: (row.valid_until as string) ?? null,
      signals,
      sourcePath: `/staff/commercial/charter?quote=${row.id}`,
    };
  });

  return { items, authorised: true, error: null };
}

/* ----------------------------------------------------------------- contracts */

export interface MyContract {
  id: string;
  customer: string | null;
  status: string;
  effectiveDate: string | null;
  term: string | null;
  signals: LensSignal[];
  sourcePath: string;
}

export async function fetchMyContracts(staffId: string): Promise<LensResult<MyContract>> {
  const { data, error } = await db
    .from("commercial_contract_instances")
    .select("id, customer_legal_name, status, effective_date, contract_term, updated_at, account_id, opportunity_id")
    .eq("owner_staff_id", staffId)
    .order("updated_at", { ascending: false })
    .limit(100);

  if (error) return empty<MyContract>(false, error.message);

  const items: MyContract[] = (data ?? []).map((row: Record<string, unknown>) => {
    const status = String(row.status ?? "unknown");
    const signals: LensSignal[] = [];
    if (["shared", "sent", "awaiting_signature"].includes(status))
      signals.push({ kind: "awaiting_customer", label: "Awaiting customer signature", severity: "high" });
    if (["draft", "legal_review_required"].includes(status))
      signals.push({ kind: "awaiting_approval", label: "Internal review outstanding", severity: "medium" });
    if (signals.length === 0) signals.push({ kind: "healthy", label: "Executed / in force", severity: "info" });

    return {
      id: String(row.id),
      customer: (row.customer_legal_name as string) ?? null,
      status,
      effectiveDate: (row.effective_date as string) ?? null,
      term: (row.contract_term as string) ?? null,
      signals,
      sourcePath: `/staff/commercial/documents?contract=${row.id}`,
    };
  });

  return { items, authorised: true, error: null };
}

/* ------------------------------------------------------------------ accounts */

export interface MyAccount {
  key: string;
  name: string;
  openOpportunities: number;
  pipelineLabel: string | null;
  openQuotes: number;
  contracts: number;
  attention: LensSignal[];
}

/**
 * My Accounts is a DERIVED grouping of the employee's own opportunity, quote and
 * contract rows — not a second customer database. The authoritative account
 * record stays in the Sales Portal / Account 360.
 */
export function deriveMyAccounts(
  opportunities: MyOpportunity[],
  quotes: MyQuote[],
  contracts: MyContract[],
): MyAccount[] {
  const map = new Map<string, MyAccount>();
  const upsert = (name: string): MyAccount => {
    const key = name.toLowerCase();
    const existing = map.get(key);
    if (existing) return existing;
    const created: MyAccount = {
      key,
      name,
      openOpportunities: 0,
      pipelineLabel: null,
      openQuotes: 0,
      contracts: 0,
      attention: [],
    };
    map.set(key, created);
    return created;
  };

  for (const o of opportunities) {
    const acc = upsert(o.customer ?? o.title);
    acc.openOpportunities += 1;
    if (o.value) acc.pipelineLabel = acc.pipelineLabel ? `${acc.pipelineLabel} + ${o.value}` : o.value;
    for (const s of o.signals) if (s.kind !== "healthy") acc.attention.push(s);
  }
  for (const q of quotes) {
    if (!["accepted", "rejected", "expired"].includes(q.status)) {
      const acc = upsert(q.number ? `Quote ${q.number}` : "Unassigned quote");
      acc.openQuotes += 1;
      for (const s of q.signals) if (s.kind !== "healthy") acc.attention.push(s);
    }
  }
  for (const c of contracts) {
    const acc = upsert(c.customer ?? "Unnamed counterparty");
    acc.contracts += 1;
    for (const s of c.signals) if (s.kind !== "healthy") acc.attention.push(s);
  }

  return [...map.values()].sort(
    (a, b) => b.attention.length - a.attention.length || b.openOpportunities - a.openOpportunities,
  );
}
