/**
 * Identity & Trust Plane — typed client access.
 *
 * Every value here comes from a server-side routine or a row-level-security
 * protected view. The browser never supplies an identity, tenant, membership or
 * role: those are resolved from the caller's session inside the database.
 *
 * Nothing in this module is authoritative on its own — it is a read surface
 * over the plane. Authorisation happens server-side.
 */
import { untypedDb } from "@/integrations/supabase/untyped";

/* ---------------------------------------------------------------- discovery */

export interface DiscoveredPolicy {
  outcome: "OK" | "RATE_LIMITED" | "INVALID_EMAIL";
  /** Never states whether an account exists. */
  policy_label: string | null;
  scope: "PLATFORM" | "ORGANISATION" | null;
  password: boolean;
  passwordless: boolean;
  google: boolean;
  sso: boolean;
  sso_provider: string | null;
  mfa_required: boolean;
  session_idle_minutes: number | null;
  session_absolute_hours: number | null;
}

/**
 * Email-based discovery. Returns the authentication methods that apply to the
 * address's organisation (or the platform default), with no account-existence
 * signal and a server-side hourly rate limit.
 */
export async function discoverIdentity(email: string): Promise<DiscoveredPolicy | null> {
  const { data, error } = await untypedDb.rpc("identity_discover", { _email: email });
  if (error) return null;
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!row) return null;

  const refused = (reason: DiscoveredPolicy["outcome"]): DiscoveredPolicy => ({
    outcome: reason,
    policy_label: null,
    scope: null,
    password: false,
    passwordless: false,
    google: false,
    sso: false,
    sso_provider: null,
    mfa_required: false,
    session_idle_minutes: null,
    session_absolute_hours: null,
  });

  if (row.ok !== true) {
    const reason = String(row.reason ?? "");
    return refused(reason === "RATE_LIMITED" ? "RATE_LIMITED" : "INVALID_EMAIL");
  }

  const methods = (row.methods ?? {}) as Record<string, unknown>;
  const policy = (row.policy ?? {}) as Record<string, unknown>;
  const session = (row.session ?? {}) as Record<string, unknown>;
  const organisation = (row.organisation ?? null) as Record<string, unknown> | null;

  return {
    outcome: "OK",
    policy_label:
      (organisation?.name as string) ?? (policy.label as string) ?? null,
    scope: row.outcome === "ORGANISATION_POLICY" ? "ORGANISATION" : "PLATFORM",
    password: Boolean(methods.password),
    passwordless: Boolean(methods.passwordless),
    google: Boolean(methods.google),
    sso: Boolean(methods.sso),
    sso_provider: (methods.sso_provider as string) ?? null,
    mfa_required: Boolean(row.mfa_required),
    session_idle_minutes: (session.idle_minutes as number) ?? null,
    session_absolute_hours: (session.absolute_hours as number) ?? null,
  };
}

/* ----------------------------------------------------------- tenant context */

export interface TenantContext {
  identity_id: string | null;
  email: string | null;
  organisation_id: string | null;
  organisation_name: string | null;
  membership_id: string | null;
  membership_role: string | null;
  membership_status: string | null;
  roles: string[];
  auth_strength: string | null;
  session_id: string | null;
}

export async function loadTenantContext(): Promise<TenantContext | null> {
  const { data, error } = await untypedDb.rpc("identity_tenant_context");
  if (error) return null;
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!row) return null;
  return {
    identity_id: (row.identity_id as string) ?? null,
    email: (row.email as string) ?? null,
    organisation_id: (row.organisation_id as string) ?? null,
    organisation_name: (row.organisation_name as string) ?? null,
    membership_id: (row.membership_id as string) ?? null,
    membership_role: (row.membership_role as string) ?? null,
    membership_status: (row.membership_status as string) ?? null,
    roles: Array.isArray(row.roles) ? (row.roles as string[]) : [],
    auth_strength: (row.auth_strength as string) ?? null,
    session_id: (row.session_id as string) ?? null,
  };
}

/* ------------------------------------------------------------ security centre */

export interface IdentitySession {
  session_id: string;
  created_at: string | null;
  refreshed_at: string | null;
  not_after: string | null;
  user_agent: string | null;
  approximate_location: string | null;
  auth_strength: string | null;
  is_current: boolean;
}

export interface IdentityDevice {
  fingerprint_hash: string | null;
  platform: string | null;
  os: string | null;
  app_version: string | null;
  user_agent: string | null;
  timezone: string | null;
  first_seen: string | null;
  last_seen: string | null;
}

export interface IdentityAuthEvent {
  occurred_at: string | null;
  event_type: string | null;
  method: string | null;
  outcome: string | null;
  approximate_location: string | null;
  user_agent: string | null;
}

async function rows<T>(fn: string, args?: Record<string, unknown>): Promise<T[]> {
  const { data, error } = await untypedDb.rpc(fn, args ?? {});
  if (error) throw new Error(error.message);
  return (Array.isArray(data) ? data : data ? [data] : []) as T[];
}

export const loadMySessions = () => rows<IdentitySession>("identity_my_sessions");
export const loadMyDevices = () => rows<IdentityDevice>("identity_my_devices");
export const loadMyAuthEvents = (limit = 25) =>
  rows<IdentityAuthEvent>("identity_my_auth_events", { _limit: limit });

/** Revokes every other session for this account, keeping the current one. */
export async function signOutOtherSessions(): Promise<void> {
  const { error } = await (
    await import("@/integrations/supabase/client")
  ).supabase.auth.signOut({ scope: "others" });
  if (error) throw new Error(error.message);
}

/* --------------------------------------------------------- claims register */

export interface PublicClaim {
  claim_code: string;
  surface: string | null;
  wording: string | null;
}

/** The only security statements any public surface may render. */
export async function loadDisplayableClaims(): Promise<PublicClaim[]> {
  const { data, error } = await untypedDb.rpc("security_claims_public");
  if (error) return [];
  return (Array.isArray(data) ? data : []) as PublicClaim[];
}

export interface ClaimRegisterRow extends PublicClaim {
  implementation: string | null;
  owner: string | null;
  audience: string | null;
  requested_display: boolean;
  withheld_reason: string | null;
  controls: number;
  latest_verdict: string | null;
  latest_observation: string | null;
  verified_at: string | null;
  environment: string | null;
  review_due: boolean | null;
  safe_to_display: boolean;
  display_state: string;
}

export async function loadClaimRegister(): Promise<ClaimRegisterRow[]> {
  const { data, error } = await untypedDb
    .from("v_security_claims")
    .select("*")
    .order("claim_code");
  if (error) throw new Error(error.message);
  return (data ?? []) as ClaimRegisterRow[];
}

/* ------------------------------------------------- certification (identity) */

export type Verdict =
  | "PASS"
  | "PARTIAL"
  | "FAIL"
  | "BLOCKED"
  | "NOT_TESTED"
  | "REQUIRES_EXTERNAL_ACTION";

export interface IdentityControlRow {
  control_code: string;
  domain: string;
  title: string;
  requirement: string | null;
  evidence_kind: string | null;
  severity: string | null;
  mandatory: boolean;
  note: string | null;
  verdict: Verdict;
  observation: string | null;
  blocked_reason: string | null;
  environment: string | null;
  executed_at: string | null;
}

export interface IdentitySummary {
  controls: number;
  passed: number;
  partial: number;
  failed: number;
  blocked: number;
  not_tested: number;
  requires_external_action: number;
  certification: string;
}

export async function loadIdentityCertification(): Promise<IdentityControlRow[]> {
  const { data, error } = await untypedDb
    .from("v_identity_certification")
    .select("*")
    .order("control_code");
  if (error) throw new Error(error.message);
  return (data ?? []) as IdentityControlRow[];
}

export async function loadIdentitySummary(): Promise<IdentitySummary | null> {
  const { data, error } = await untypedDb
    .from("v_identity_certification_summary")
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? null) as IdentitySummary | null;
}

/* Presentation helpers — wording customers and staff actually read. */
export const VERDICT_LABEL: Record<Verdict, string> = {
  PASS: "Proven",
  PARTIAL: "Partly proven",
  FAIL: "Failed",
  BLOCKED: "Blocked",
  NOT_TESTED: "Not tested",
  REQUIRES_EXTERNAL_ACTION: "Needs outside action",
};

export const VERDICT_TONE: Record<Verdict, string> = {
  PASS: "bg-primary/10 text-primary border-primary/30",
  PARTIAL: "bg-secondary text-secondary-foreground border-border",
  FAIL: "bg-destructive/10 text-destructive border-destructive/30",
  BLOCKED: "bg-muted text-muted-foreground border-border",
  NOT_TESTED: "bg-muted text-muted-foreground border-border",
  REQUIRES_EXTERNAL_ACTION: "bg-muted text-muted-foreground border-border",
};

export const DOMAIN_LABEL: Record<string, string> = {
  IDENTITY_MODEL: "Identity model",
  DISCOVERY: "Account discovery",
  AUTH_POLICY: "Sign-in policy",
  TENANT_ISOLATION: "Company data separation",
  SESSION: "Sessions",
  DEVICE: "Devices",
  AUDIT: "Activity records",
  CLAIM_GOVERNANCE: "Security statements",
  MFA: "Second factor",
  SSO: "Organisation sign-in",
  RISK: "Risk signals",
  RECOVERY: "Account recovery",
  SERVICE_IDENTITY: "Service access",
};

export function humanDomain(domain: string): string {
  return DOMAIN_LABEL[domain] ?? domain.split("_").join(" ").toLowerCase();
}
