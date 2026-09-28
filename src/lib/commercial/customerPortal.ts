/**
 * Customer portal.
 *
 * A client reads their own records through a single random 64-character link.
 * The link is the credential: `client_portal_open` returns only the records of
 * the account the link was issued for, records every open, and refuses
 * withdrawn, expired and unknown links. Issuing and withdrawing links requires
 * the sales/commercial permission and is decided in the database.
 */
import { untypedDb } from "@/integrations/supabase/untyped";

export interface PortalQuote {
  quote_number: string;
  total_amount: number | null;
  currency: string | null;
  status: string | null;
  valid_until: string | null;
  created_at: string;
}

export interface PortalContract {
  contract_number: string;
  title: string | null;
  status: string | null;
  value_amount: number | null;
  currency: string | null;
  value_type: string | null;
  term_start: string | null;
  term_end: string | null;
  signature_date: string | null;
  payment_terms: string | null;
  created_at: string;
}

export interface PortalRide {
  booking_number: string;
  pickup: string | null;
  dropoff: string | null;
  scheduled_for: string | null;
  status: string | null;
  total_fare: number | null;
  currency: string | null;
  payment_status: string | null;
  created_at: string;
}

export interface PortalView {
  ok: true;
  account: { name: string; account_ref: string | null; city: string | null; country: string | null };
  recipient_name: string | null;
  recipient_email: string | null;
  expires_at: string;
  quotes: PortalQuote[];
  contracts: PortalContract[];
  rides: PortalRide[];
}

export interface PortalRefusal {
  ok: false;
  error: string;
}

export const PORTAL_REFUSAL_TEXT: Record<string, string> = {
  INVALID_LINK: "This link is not recognised. Please ask your TaxiD contact for a new one.",
  LINK_REVOKED: "This link has been withdrawn. Please ask your TaxiD contact for a new one.",
  LINK_EXPIRED: "This link has expired. Please ask your TaxiD contact for a new one.",
  ACCOUNT_NOT_FOUND: "Your account record could not be read. Please contact your TaxiD contact.",
};

export async function openCustomerPortal(token: string): Promise<PortalView | PortalRefusal> {
  const { data, error } = await untypedDb.rpc("client_portal_open", { _token: token });
  if (error) throw new Error(error.message);
  return data as unknown as PortalView | PortalRefusal;
}

export interface PortalGrant {
  id: string;
  account_id: string;
  recipient_email: string | null;
  recipient_name: string | null;
  expires_at: string;
  revoked_at: string | null;
  first_opened_at: string | null;
  last_opened_at: string | null;
  opens: number;
  created_at: string;
}

export async function listPortalGrants(accountId?: string): Promise<PortalGrant[]> {
  let q = untypedDb
    .from("client_portal_grants")
    .select("*")
    .order("created_at", { ascending: false });
  if (accountId) q = q.eq("account_id", accountId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as PortalGrant[];
}

export async function createPortalGrant(input: {
  accountId: string;
  email?: string;
  name?: string;
  days?: number;
}): Promise<{ ok: boolean; error?: string; token?: string; path?: string; account?: string }> {
  const { data, error } = await untypedDb.rpc("client_portal_grant_create", {
    _account: input.accountId,
    _email: input.email ?? null,
    _name: input.name ?? null,
    _days: input.days ?? 60,
  });
  if (error) throw new Error(error.message);
  return data as unknown as { ok: boolean; error?: string; token?: string; path?: string; account?: string };
}

export async function revokePortalGrant(grantId: string) {
  const { data, error } = await untypedDb.rpc("client_portal_grant_revoke", { _grant: grantId });
  if (error) throw new Error(error.message);
  return data as unknown as { ok: boolean; error?: string };
}

export interface PortalAccount {
  id: string;
  name: string;
  account_ref: string | null;
  city: string | null;
}

export async function searchPortalAccounts(term: string): Promise<PortalAccount[]> {
  let q = untypedDb
    .from("crm_accounts")
    .select("id,name,account_ref,city")
    .order("name")
    .limit(20);
  if (term.trim()) q = q.ilike("name", `%${term.trim()}%`);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as PortalAccount[];
}
