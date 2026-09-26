/**
 * Partner portal.
 *
 * An approved partner reads their own records through a single random
 * 64-character link. The link is the credential: `partner_portal_open` returns
 * only the records belonging to the application the link was issued for,
 * records every open, and refuses withdrawn, expired, unknown and
 * not-yet-approved links. Issuing and withdrawing links requires the
 * sales/commercial permission and is decided in the database.
 */
import { untypedDb } from "@/integrations/supabase/untyped";
import type {
  PortalContract,
  PortalQuote,
  PortalRide,
} from "@/lib/commercial/customerPortal";

export interface PartnerPortalView {
  ok: true;
  partner: {
    organisation: string;
    reference: string | null;
    partner_type: string | null;
    commercial_model: string | null;
    city: string | null;
    country: string | null;
    status: string | null;
    applied_at: string | null;
    approved_at: string | null;
  };
  enquiry: {
    lead_ref: string | null;
    stage: string | null;
    service_interest: string | null;
    meeting_held_at: string | null;
    quote_shared_at: string | null;
    contract_shared_at: string | null;
    contract_signed_at: string | null;
    waiting_on: string | null;
    awaiting_item: string | null;
  } | null;
  recipient_name: string | null;
  recipient_email: string | null;
  expires_at: string;
  quotes: PortalQuote[];
  contracts: PortalContract[];
  rides: PortalRide[];
}

export interface PartnerPortalRefusal {
  ok: false;
  error: string;
}

export const PARTNER_PORTAL_REFUSAL_TEXT: Record<string, string> = {
  INVALID_LINK: "This link is not recognised. Please ask your Yalla contact for a new one.",
  LINK_REVOKED: "This link has been withdrawn. Please ask your Yalla contact for a new one.",
  LINK_EXPIRED: "This link has expired. Please ask your Yalla contact for a new one.",
  APPLICATION_NOT_FOUND: "Your partner record could not be read. Please contact your Yalla contact.",
  APPLICATION_NOT_APPROVED:
    "Your partner application is still under review, so this link is not active yet.",
};

export async function openPartnerPortal(
  token: string,
): Promise<PartnerPortalView | PartnerPortalRefusal> {
  const { data, error } = await untypedDb.rpc("partner_portal_open", { _token: token });
  if (error) throw new Error(error.message);
  return data as unknown as PartnerPortalView | PartnerPortalRefusal;
}

export interface PartnerPortalGrant {
  id: string;
  application_id: string;
  recipient_email: string | null;
  recipient_name: string | null;
  expires_at: string;
  revoked_at: string | null;
  first_opened_at: string | null;
  last_opened_at: string | null;
  opens: number;
  created_at: string;
}

export async function listPartnerPortalGrants(applicationId?: string) {
  let q = untypedDb
    .from("partner_portal_grants")
    .select("*")
    .order("created_at", { ascending: false });
  if (applicationId) q = q.eq("application_id", applicationId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as PartnerPortalGrant[];
}

export async function createPartnerPortalGrant(input: {
  applicationId: string;
  email?: string;
  name?: string;
  days?: number;
}) {
  const { data, error } = await untypedDb.rpc("partner_portal_grant_create", {
    _application: input.applicationId,
    _email: input.email ?? null,
    _name: input.name ?? null,
    _days: input.days ?? 60,
  });
  if (error) throw new Error(error.message);
  return data as unknown as {
    ok: boolean;
    error?: string;
    token?: string;
    path?: string;
    partner?: string;
  };
}

export async function revokePartnerPortalGrant(grantId: string) {
  const { data, error } = await untypedDb.rpc("partner_portal_grant_revoke", { _grant: grantId });
  if (error) throw new Error(error.message);
  return data as unknown as { ok: boolean; error?: string };
}

export interface ApprovedPartner {
  id: string;
  organisation_name: string;
  reference: string | null;
  partner_type: string | null;
  city: string | null;
  contact_email: string | null;
  contact_name: string | null;
}

/** Only approved applications may be issued a link, so only those are listed. */
export async function searchApprovedPartners(term: string): Promise<ApprovedPartner[]> {
  let q = untypedDb
    .from("partner_applications")
    .select("id,organisation_name,reference,partner_type,city,contact_email,contact_name")
    .eq("status", "approved")
    .order("organisation_name")
    .limit(20);
  if (term.trim()) q = q.ilike("organisation_name", `%${term.trim()}%`);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ApprovedPartner[];
}
