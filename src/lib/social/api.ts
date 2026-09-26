/**
 * SOCIAL DISTRIBUTION — READ SERVICE + GOVERNED MUTATIONS
 *
 * The footer (and any other public surface) asks this service for "the
 * currently published social accounts". It never knows about administrators,
 * drafts or verification. Every mutation goes through a governed, audited
 * Postgres routine — the client cannot write to `social_accounts` directly
 * (no INSERT/UPDATE policy exists for authenticated users).
 */
import { untypedDb } from "@/integrations/supabase/untyped";
import {
  isPubliclyLinkable,
  type SocialHealthState,
  type SocialStatus,
  type SocialVerification,
} from "./platforms";

const db = untypedDb;

export interface SocialAccount {
  id: string;
  platform_slug: string;
  market: string;
  display_name: string;
  handle: string | null;
  profile_url: string | null;
  status: SocialStatus;
  verification_status: SocialVerification;
  ownership_evidence: string | null;
  is_public: boolean;
  is_active: boolean;
  aria_label: string | null;
  tracking_enabled: boolean;
  campaign_source: string | null;
  sort_order: number;
  verified_at: string | null;
  approved_at: string | null;
  activated_at: string | null;
  updated_at: string;
}

export interface SocialPlatform {
  slug: string;
  name: string;
  icon_key: string;
  hostnames: string[];
  purpose: string;
  channel_kind: "PROFILE" | "CONVERSATION";
  enabled: boolean;
  sort_order: number;
}

const ACCOUNT_COLUMNS =
  "id, platform_slug, market, display_name, handle, profile_url, status, verification_status, ownership_evidence, is_public, is_active, aria_label, tracking_enabled, campaign_source, sort_order, verified_at, approved_at, activated_at, updated_at";

export async function listPlatforms(): Promise<SocialPlatform[]> {
  const { data, error } = await db.from("social_platforms").select("*").order("sort_order");
  if (error) throw new Error(error.message);
  return (data ?? []) as SocialPlatform[];
}

/**
 * PUBLIC read path. RLS returns published rows only; the publication gate is
 * re-applied client-side as defence in depth. Never throws — a social outage
 * must not break the footer.
 */
export async function listPublishedAccounts(): Promise<SocialAccount[]> {
  try {
    const { data, error } = await db
      .from("social_accounts")
      .select(ACCOUNT_COLUMNS)
      .eq("status", "ACTIVE")
      .order("sort_order");
    if (error) return [];
    return ((data ?? []) as SocialAccount[]).filter(isPubliclyLinkable);
  } catch {
    return [];
  }
}

/** ADMIN read path — the full register (RLS: admin / super_admin only). */
export async function listAllAccounts(): Promise<SocialAccount[]> {
  const { data, error } = await db.from("social_accounts").select(ACCOUNT_COLUMNS).order("sort_order");
  if (error) throw new Error(error.message);
  return (data ?? []) as SocialAccount[];
}

export interface SocialAccountEvent {
  id: string;
  account_id: string | null;
  platform_slug: string | null;
  actor_user_id: string | null;
  action: string;
  reason: string | null;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  created_at: string;
}

export async function listAccountEvents(accountId?: string, limit = 100): Promise<SocialAccountEvent[]> {
  let q = db.from("social_account_events").select("*").order("created_at", { ascending: false }).limit(limit);
  if (accountId) q = q.eq("account_id", accountId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as SocialAccountEvent[];
}

export interface SocialHealthRow {
  id: string;
  account_id: string;
  checked_at: string;
  state: SocialHealthState;
  http_status: number | null;
  redirect_target: string | null;
  attempt: number;
  error_detail: string | null;
}

export async function listHealth(limit = 100): Promise<SocialHealthRow[]> {
  const { data, error } = await db
    .from("social_link_health")
    .select("*")
    .order("checked_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as SocialHealthRow[];
}

async function call(fn: string, args: Record<string, unknown>) {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as SocialAccount;
}

/** Supply / replace the official destination. Resets verification to UNVERIFIED. */
export const setAccountUrl = (id: string, url: string, handle: string | null, displayName: string | null, reason: string) =>
  call("social_set_url", { _account: id, _url: url, _handle: handle, _display_name: displayName, _reason: reason });

/** Record proven ownership. Evidence is mandatory (min 10 chars, server-enforced). */
export const verifyAccount = (id: string, evidence: string, reason: string) =>
  call("social_verify_account", { _account: id, _evidence: evidence, _reason: reason });

export const approveAccount = (id: string, reason: string) =>
  call("social_approve_account", { _account: id, _reason: reason });

export const activateAccount = (id: string, reason: string) =>
  call("social_activate_account", { _account: id, _reason: reason });

export const deactivateAccount = (id: string, reason: string) =>
  call("social_deactivate_account", { _account: id, _reason: reason });

export const archiveAccount = (id: string, reason: string) =>
  call("social_archive_account", { _account: id, _reason: reason });

export async function recordHealth(
  id: string,
  state: SocialHealthState,
  opts: { httpStatus?: number | null; redirect?: string | null; attempt?: number; error?: string | null } = {},
) {
  const { error } = await db.rpc("social_record_health", {
    _account: id,
    _state: state,
    _http_status: opts.httpStatus ?? null,
    _redirect: opts.redirect ?? null,
    _attempt: opts.attempt ?? 1,
    _error: opts.error ?? null,
  });
  if (error) throw new Error(error.message);
}

export interface SocialCampaign {
  id: string;
  name: string;
  slug: string;
  objective: string | null;
  platform_slug: string | null;
  market: string;
  landing_path: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  status: "DRAFT" | "ACTIVE" | "PAUSED" | "ENDED";
  start_date: string | null;
  end_date: string | null;
}

export async function listCampaigns(): Promise<SocialCampaign[]> {
  const { data, error } = await db.from("social_campaigns").select("*").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as SocialCampaign[];
}
