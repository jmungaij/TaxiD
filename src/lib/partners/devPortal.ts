/**
 * TaxiD API PARTNERS — developer portal data layer.
 *
 * Credential secrets are minted server-side by security-definer RPCs and shown
 * exactly once; the client only ever reads metadata (fingerprint, scopes,
 * status, quota) plus append-only audit history and usage telemetry.
 */

import { supabase } from "@/integrations/supabase/client";

export type ApiEnvironment = "sandbox" | "production";
export type CredentialStatus = "active" | "rotating" | "revoked";

export interface PartnerApiCredential {
  id: string;
  partner_id: string;
  environment: ApiEnvironment;
  label: string;
  client_id: string;
  secret_fingerprint: string;
  scopes: string[];
  tier: string;
  status: CredentialStatus;
  rate_limit_per_min: number;
  monthly_quota: number;
  last_used_at: string | null;
  rotated_at: string | null;
  rotated_from: string | null;
  grace_expires_at: string | null;
  revoked_at: string | null;
  revoke_reason: string | null;
  created_at: string;
}

export interface CredentialAuditRow {
  id: string;
  credential_id: string | null;
  action: string;
  environment: ApiEnvironment;
  actor_id: string | null;
  reason: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface UsageRow {
  id: string;
  credential_id: string | null;
  environment: ApiEnvironment;
  usage_date: string;
  domain_key: string;
  requests: number;
  errors: number;
  throttled: number;
  p95_latency_ms: number | null;
}

export interface IssuedSecret {
  credential_id: string;
  client_id: string;
  client_secret: string;
  environment: ApiEnvironment;
  replaces_client_id?: string;
  grace_expires_at?: string;
}

export async function fetchCredentials(partnerId: string): Promise<PartnerApiCredential[]> {
  // Reads the masked view: it omits the stored secret hash, which stays server-only.
  const { data, error } = await supabase
    .from("v_partner_api_credentials")
    .select("*")
    .eq("partner_id", partnerId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as PartnerApiCredential[];
}

export async function fetchCredentialAudit(partnerId: string, limit = 100): Promise<CredentialAuditRow[]> {
  const { data, error } = await supabase
    .from("partner_api_credential_audit")
    .select("*")
    .eq("partner_id", partnerId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as CredentialAuditRow[];
}

export async function fetchUsage(partnerId: string, sinceDays = 30): Promise<UsageRow[]> {
  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("partner_api_usage_daily")
    .select("*")
    .eq("partner_id", partnerId)
    .gte("usage_date", since)
    .order("usage_date", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as UsageRow[];
}

export async function issueCredential(input: {
  partnerId: string;
  environment: ApiEnvironment;
  label: string;
  scopes: string[];
  tier: string;
}): Promise<IssuedSecret> {
  const { data, error } = await supabase.rpc("partner_api_credential_issue", {
    _partner_id: input.partnerId,
    _environment: input.environment,
    _label: input.label,
    _scopes: input.scopes,
    _tier: input.tier,
  });
  if (error) throw error;
  return data as unknown as IssuedSecret;
}

export async function rotateCredential(
  credentialId: string,
  graceHours: number,
  reason?: string,
): Promise<IssuedSecret> {
  const { data, error } = await supabase.rpc("partner_api_credential_rotate", {
    _credential_id: credentialId,
    _grace_hours: graceHours,
    _reason: reason ?? null,
  });
  if (error) throw error;
  return data as unknown as IssuedSecret;
}

export async function revokeCredential(credentialId: string, reason?: string): Promise<void> {
  const { error } = await supabase.rpc("partner_api_credential_revoke", {
    _credential_id: credentialId,
    _reason: reason ?? null,
  });
  if (error) throw error;
}

/* --------------------------------------------------------------- analytics */

export interface UsageSummary {
  environment: ApiEnvironment;
  requests: number;
  errors: number;
  throttled: number;
  errorRate: number;
  p95LatencyMs: number | null;
  byDomain: { domain: string; requests: number; errors: number }[];
  series: { date: string; requests: number; errors: number }[];
}

export function summariseUsage(rows: UsageRow[], environment: ApiEnvironment): UsageSummary {
  const scoped = rows.filter((r) => r.environment === environment);
  const requests = scoped.reduce((s, r) => s + r.requests, 0);
  const errors = scoped.reduce((s, r) => s + r.errors, 0);
  const throttled = scoped.reduce((s, r) => s + r.throttled, 0);

  const domainMap = new Map<string, { requests: number; errors: number }>();
  for (const r of scoped) {
    const cur = domainMap.get(r.domain_key) ?? { requests: 0, errors: 0 };
    domainMap.set(r.domain_key, { requests: cur.requests + r.requests, errors: cur.errors + r.errors });
  }

  const dayMap = new Map<string, { requests: number; errors: number }>();
  for (const r of scoped) {
    const cur = dayMap.get(r.usage_date) ?? { requests: 0, errors: 0 };
    dayMap.set(r.usage_date, { requests: cur.requests + r.requests, errors: cur.errors + r.errors });
  }

  const latencies = scoped.map((r) => r.p95_latency_ms).filter((n): n is number => typeof n === "number");

  return {
    environment,
    requests,
    errors,
    throttled,
    errorRate: requests > 0 ? errors / requests : 0,
    p95LatencyMs: latencies.length ? Math.max(...latencies) : null,
    byDomain: [...domainMap.entries()]
      .map(([domain, v]) => ({ domain, ...v }))
      .sort((a, b) => b.requests - a.requests),
    series: [...dayMap.entries()]
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}

/** Month-to-date quota position for an environment. */
export function quotaPosition(
  rows: UsageRow[],
  credentials: PartnerApiCredential[],
  environment: ApiEnvironment,
) {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  const from = monthStart.toISOString().slice(0, 10);

  const used = rows
    .filter((r) => r.environment === environment && r.usage_date >= from)
    .reduce((s, r) => s + r.requests, 0);

  const live = credentials.filter((c) => c.environment === environment && c.status !== "revoked");
  const quota = live.reduce((s, c) => s + c.monthly_quota, 0);
  const rateLimit = live.reduce((max, c) => Math.max(max, c.rate_limit_per_min), 0);

  return {
    used,
    quota,
    remaining: Math.max(0, quota - used),
    utilisation: quota > 0 ? used / quota : 0,
    rateLimit,
    activeCredentials: live.length,
  };
}
