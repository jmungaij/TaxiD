/**
 * CUSTOMER PORTAL DATA — what a signed-in company contact may see about their
 * own relationship with Yalla.
 *
 * Everything is assembled by the database under the caller's own identity and
 * translated into plain language. Internal notes, win probability, ownership
 * intelligence and internal estimates are never returned here.
 */
import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface PortalAccount {
  id: string;
  reference: string | null;
  name: string;
  industry: string | null;
  city: string | null;
  country: string | null;
  relationship_stage: string;
  relationship_contact: string | null;
  relationship_email: string | null;
}

export interface PortalOpportunity {
  id: string;
  reference: string | null;
  title: string | null;
  status: string;
  updated_at: string;
}

export interface PortalProposal {
  id: string;
  reference: string | null;
  total_amount: number | null;
  currency: string;
  valid_until: string | null;
  status: string;
  updated_at: string;
}

export interface PortalServiceOrder {
  id: string;
  title: string | null;
  services: unknown;
  locations: unknown;
  validity: unknown;
  status: string;
  updated_at: string;
}

export interface PortalContract {
  id: string;
  name: string | null;
  term: unknown;
  effective_date: string | null;
  services: unknown;
  status: string;
  updated_at: string;
}

export interface PortalFeedEntry {
  at: string;
  kind: string;
  label: string;
  reference: string | null;
}

export interface CustomerPortalOverview {
  accounts: PortalAccount[];
  opportunities: PortalOpportunity[];
  proposals: PortalProposal[];
  service_orders: PortalServiceOrder[];
  contracts: PortalContract[];
  feed: PortalFeedEntry[];
}

export async function fetchCustomerPortal(): Promise<CustomerPortalOverview> {
  const { data, error } = await db.rpc("customer_portal_overview");
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as Partial<CustomerPortalOverview>;
  return {
    accounts: d.accounts ?? [],
    opportunities: d.opportunities ?? [],
    proposals: d.proposals ?? [],
    service_orders: d.service_orders ?? [],
    contracts: d.contracts ?? [],
    feed: d.feed ?? [],
  };
}

export const KES = (n: number, currency = "KES") =>
  new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(n);

/** Plain-language tone for a customer-facing status word. */
export function statusTone(status: string): string {
  const s = status.toLowerCase();
  if (s.includes("active") || s.includes("accepted") || s.includes("confirmed"))
    return "border-[hsl(var(--status-success)/0.45)] bg-[hsl(var(--status-success)/0.12)] text-[hsl(var(--status-success))]";
  if (s.includes("closed")) return "border-border bg-muted text-muted-foreground";
  if (s.includes("review") || s.includes("progress") || s.includes("onboarding"))
    return "border-primary/30 bg-primary/10 text-primary";
  return "border-border bg-muted text-muted-foreground";
}

/** Renders a jsonb value that may be a list, an object or plain text. */
export function summarise(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value))
    return value.length
      ? value
          .map((v) => (typeof v === "string" ? v : ((v as Record<string, unknown>)?.name as string) ?? null))
          .filter(Boolean)
          .join(", ") || null
      : null;
  if (typeof value === "object") {
    const parts = Object.values(value as Record<string, unknown>)
      .filter((v) => typeof v === "string" || typeof v === "number")
      .map(String);
    return parts.length ? parts.join(" · ") : null;
  }
  return String(value);
}
