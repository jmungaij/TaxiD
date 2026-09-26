/**
 * Audited reads of role-restricted resources.
 *
 * `driver_reputation` and `mpesa_rate_limit_buckets` are RLS-restricted. These
 * helpers go through SECURITY DEFINER RPCs that enforce the role check *and*
 * append a `sensitive_read_audit` row (user id, roles, row count, timestamp),
 * so every privileged read of that data is attributable.
 */
import { untypedDb } from "@/integrations/supabase/untyped";

const rpc = (name: string, args?: Record<string, unknown>) =>
  (untypedDb)
    .rpc(name, args);

export interface DriverReputationRow {
  driver_id: string;
  rating: number | null;
  trips_total: number | null;
  reviews_count: number | null;
  badges: unknown;
  achievements: unknown;
  updated_at: string;
}

export interface MpesaRateLimitRow {
  shortcode: string;
  tokens: number;
  capacity: number;
  refill_rate_per_sec: number;
  last_refill_at: string | null;
  updated_at: string;
}

export interface SensitiveReadAuditRow {
  id: string;
  user_id: string | null;
  user_roles: string[];
  resource: string;
  action: string;
  row_count: number;
  allowed: boolean;
  context: Record<string, unknown> | null;
  created_at: string;
}

/** Authenticated-only. Logs the read. */
export async function fetchDriverReputationAudited(limit = 100): Promise<DriverReputationRow[]> {
  const { data, error } = await rpc("get_driver_reputation_audited", { _limit: limit });
  if (error) throw new Error(error.message);
  return (data ?? []) as DriverReputationRow[];
}

/** admin / super_admin / finance_admin only. Logs allowed *and* denied reads. */
export async function fetchMpesaRateLimitStateAudited(): Promise<MpesaRateLimitRow[]> {
  const { data, error } = await rpc("get_mpesa_rate_limit_state_audited");
  if (error) throw new Error(error.message);
  return (data ?? []) as MpesaRateLimitRow[];
}

export async function fetchSensitiveReadAudit(opts?: {
  resource?: string;
  limit?: number;
}): Promise<SensitiveReadAuditRow[]> {
  let q = (untypedDb)
    .from("sensitive_read_audit")
    .select("id,user_id,user_roles,resource,action,row_count,allowed,context,created_at")
    .order("created_at", { ascending: false })
    .limit(opts?.limit ?? 200);
  if (opts?.resource && opts.resource !== "all") q = q.eq("resource", opts.resource);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as SensitiveReadAuditRow[];
}

export const AUDITED_RESOURCES = ["driver_reputation", "mpesa_rate_limit_buckets"] as const;
