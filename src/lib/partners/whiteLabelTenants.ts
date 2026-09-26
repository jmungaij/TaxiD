/**
 * WHITE-LABEL TENANTS — provisioning, configuration and the operations record.
 *
 * Every read here is row-level-security scoped to the partner memberships of
 * the signed-in login (`partner_api_is_member`), and every write is restricted
 * to partner owners/admins (`partner_api_is_manager`) or platform admins. The
 * client never sends a partner id it was not granted — and if it tried, the
 * database would reject it, not the UI.
 *
 * Provisioning is one server-side transaction (`partner_wl_provision_tenant`):
 * tenant record → brand configuration → sandbox and production environments →
 * initial sandbox credential → hash-chained provisioning evidence.
 */
import { supabase } from "@/integrations/supabase/client";

/* eslint-disable @typescript-eslint/no-explicit-any */
const db = supabase as any;

export type TenantEnvironment = "sandbox" | "production";
export type TenantStatus = "draft" | "provisioning" | "certifying" | "live" | "suspended";
export type IncidentStatus = "open" | "mitigating" | "monitoring" | "resolved" | "closed";
export type ChangeStatus = "proposed" | "approved" | "applied" | "rolled_back" | "rejected";

export interface WlTenant {
  id: string;
  partner_id: string;
  tenant_code: string;
  display_name: string;
  environment: TenantEnvironment;
  status: TenantStatus;
  markets: string[];
  services: string[];
  certified_at: string | null;
  created_at: string;
}

export interface WlBrandConfig {
  id: string;
  tenant_id: string;
  logo_url: string | null;
  primary_color: string | null;
  accent_color: string | null;
  font_family: string | null;
  email_sender_name: string | null;
  support_email: string | null;
  legal_entity: string | null;
  policy_url: string | null;
  updated_at: string;
}

export interface WlEnvironment {
  id: string;
  tenant_id: string;
  environment: TenantEnvironment;
  base_url: string;
  webhook_url: string | null;
  webhook_secret_fingerprint: string | null;
  is_enabled: boolean;
}

export interface WlIncident {
  id: string;
  tenant_id: string;
  reference: string;
  severity: string;
  title: string;
  detail: string | null;
  status: IncidentStatus;
  correlation_id: string | null;
  assigned_to: string | null;
  assigned_at: string | null;
  resolution: string | null;
  opened_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
}

export interface WlChange {
  id: string;
  tenant_id: string;
  change_class: string;
  title: string;
  detail: string | null;
  rollback_plan: string | null;
  status: ChangeStatus;
  approved_at: string | null;
  applied_at: string | null;
  created_at: string;
}

export interface WlEvidence {
  id: string;
  tenant_id: string;
  kind: string;
  subject_ref: string | null;
  statement: string;
  payload: Record<string, unknown>;
  prev_hash: string | null;
  entry_hash: string;
  created_at: string;
}

export interface WlReadinessRow {
  id: string;
  tenant_id: string;
  item_key: string;
  status: string;
  evidence_ref: string | null;
  note: string | null;
  verified_at: string | null;
}

const rows = <T,>(data: unknown): T[] => (data ?? []) as T[];

export async function fetchTenants(partnerId?: string): Promise<WlTenant[]> {
  let q = db.from("partner_wl_tenants").select("*").order("created_at", { ascending: false });
  if (partnerId) q = q.eq("partner_id", partnerId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return rows<WlTenant>(data);
}

export async function fetchBrandConfig(tenantId: string): Promise<WlBrandConfig | null> {
  const { data, error } = await db
    .from("partner_wl_brand_config").select("*").eq("tenant_id", tenantId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? null) as WlBrandConfig | null;
}

export async function saveBrandConfig(
  tenantId: string,
  patch: Partial<Omit<WlBrandConfig, "id" | "tenant_id" | "updated_at">>,
): Promise<void> {
  const { error } = await db.from("partner_wl_brand_config").update(patch).eq("tenant_id", tenantId);
  if (error) throw new Error(error.message);
}

export async function fetchEnvironments(tenantId: string): Promise<WlEnvironment[]> {
  const { data, error } = await db
    .from("partner_wl_environments").select("*").eq("tenant_id", tenantId).order("environment");
  if (error) throw new Error(error.message);
  return rows<WlEnvironment>(data);
}

export async function fetchIncidents(tenantId: string, limit = 100): Promise<WlIncident[]> {
  const { data, error } = await db
    .from("partner_wl_incidents").select("*").eq("tenant_id", tenantId)
    .order("opened_at", { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return rows<WlIncident>(data);
}

export async function fetchChanges(tenantId: string, limit = 100): Promise<WlChange[]> {
  const { data, error } = await db
    .from("partner_wl_changes").select("*").eq("tenant_id", tenantId)
    .order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return rows<WlChange>(data);
}

export async function fetchEvidence(tenantId: string, limit = 200): Promise<WlEvidence[]> {
  const { data, error } = await db
    .from("partner_wl_evidence").select("*").eq("tenant_id", tenantId)
    .order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return rows<WlEvidence>(data);
}

export async function fetchReadiness(tenantId: string): Promise<WlReadinessRow[]> {
  const { data, error } = await db
    .from("partner_wl_readiness").select("*").eq("tenant_id", tenantId).order("item_key");
  if (error) throw new Error(error.message);
  return rows<WlReadinessRow>(data);
}

export interface ProvisionInput {
  partnerId: string;
  tenantCode: string;
  displayName: string;
  brand?: Record<string, string | undefined>;
  markets?: string[];
  services?: string[];
}

export interface ProvisionResult {
  tenant_id: string;
  tenant_code: string;
  status: TenantStatus;
  credential: { credential_id: string; client_id: string; client_secret: string } | null;
}

export async function provisionTenant(input: ProvisionInput): Promise<ProvisionResult> {
  const { data, error } = await db.rpc("partner_wl_provision_tenant", {
    _partner_id: input.partnerId,
    _tenant_code: input.tenantCode,
    _display_name: input.displayName,
    _brand: input.brand ?? {},
    _markets: input.markets ?? [],
    _services: input.services ?? [],
  });
  if (error) throw new Error(error.message);
  return data as ProvisionResult;
}

export async function recordEvidence(
  tenantId: string, kind: string, statement: string,
  subjectRef?: string, payload?: Record<string, unknown>,
): Promise<{ entry_hash: string; prev_hash: string | null }> {
  const { data, error } = await db.rpc("partner_wl_record_evidence", {
    _tenant_id: tenantId, _kind: kind, _statement: statement,
    _subject_ref: subjectRef ?? null, _payload: payload ?? {},
  });
  if (error) throw new Error(error.message);
  return data as { entry_hash: string; prev_hash: string | null };
}

export async function certifyTenant(tenantId: string): Promise<{ ok: boolean; reason?: string; pending?: number }> {
  const { data, error } = await db.rpc("partner_wl_certify_tenant", { _tenant_id: tenantId });
  if (error) throw new Error(error.message);
  return data as { ok: boolean; reason?: string; pending?: number };
}

export async function upsertReadiness(
  tenantId: string, partnerId: string, itemKey: string,
  status: string, evidenceRef?: string, note?: string,
): Promise<void> {
  const { error } = await db.from("partner_wl_readiness").upsert(
    {
      tenant_id: tenantId, partner_id: partnerId, item_key: itemKey, status,
      evidence_ref: evidenceRef ?? null, note: note ?? null,
      verified_at: status === "verified" ? new Date().toISOString() : null,
    },
    { onConflict: "tenant_id,item_key" },
  );
  if (error) throw new Error(error.message);
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/* ------------------------------------------------------------------ *
 * Certification-gated production readiness checklist
 * ------------------------------------------------------------------ */

export interface ReadinessItem {
  key: string;
  section: string;
  title: string;
  requirement: string;
  /** Who must satisfy it. */
  owner: "PARTNER" | "YALLA" | "SHARED";
  /** Blocking items must be verified before production exposure. */
  blocking: boolean;
}

export const READINESS_ITEMS: ReadinessItem[] = [
  { key: "brand.config", section: "Brand", title: "Brand configuration approved", requirement: "Logo, colours, typography, sender name and legal entity confirmed by the partner.", owner: "PARTNER", blocking: true },
  { key: "brand.immutables", section: "Brand", title: "Immutable surfaces acknowledged", requirement: "Partner acknowledges statutory, safety, privacy and security surfaces are not brandable in substance.", owner: "PARTNER", blocking: true },
  { key: "auth.credentials", section: "Authentication", title: "Production credential issued and stored", requirement: "Client credentials held in the partner's secret store; never in client-side code or a repository.", owner: "PARTNER", blocking: true },
  { key: "auth.rotation", section: "Authentication", title: "Rotation drill completed", requirement: "Partner has rotated a sandbox credential and continued serving traffic through the grace window.", owner: "PARTNER", blocking: true },
  { key: "auth.tenant_header", section: "Authentication", title: "Tenant header enforced", requirement: "Every call sends the tenant header matching the credential's tenant.", owner: "PARTNER", blocking: true },
  { key: "sandbox.happy_path", section: "Certification", title: "Happy-path scenarios pass", requirement: "Quote, order, assignment, completion and document retrieval executed end to end in sandbox.", owner: "PARTNER", blocking: true },
  { key: "sandbox.failure_path", section: "Certification", title: "Failure-path scenarios pass", requirement: "Rejected quote, cancellation, duplicate idempotency key and 429 backoff all handled.", owner: "PARTNER", blocking: true },
  { key: "webhook.signature", section: "Webhooks", title: "Signature verification proven", requirement: "Timestamped HMAC verified over the raw body, with out-of-tolerance deliveries rejected.", owner: "PARTNER", blocking: true },
  { key: "webhook.idempotency", section: "Webhooks", title: "Duplicate delivery handled", requirement: "A replayed delivery id is acknowledged without double-processing the order.", owner: "PARTNER", blocking: true },
  { key: "ops.contacts", section: "Operations", title: "Escalation contacts registered", requirement: "Named first-line and engineering contacts with hours of cover.", owner: "PARTNER", blocking: true },
  { key: "ops.incident_drill", section: "Operations", title: "Incident drill completed", requirement: "One simulated severity-2 incident run through the agreed escalation path.", owner: "SHARED", blocking: false },
  { key: "ops.change_control", section: "Operations", title: "Change control agreed", requirement: "Change classes, approval route and rollback plan recorded for the tenant.", owner: "YALLA", blocking: true },
  { key: "finance.settlement", section: "Finance", title: "Settlement details verified", requirement: "Settlement account confirmed and one sandbox statement reconciled.", owner: "PARTNER", blocking: true },
  { key: "finance.exceptions", section: "Finance", title: "Exception handling agreed", requirement: "Reconciliation exception ownership and response route recorded.", owner: "YALLA", blocking: false },
];

export interface ReadinessProgress {
  total: number;
  verified: number;
  blockingOutstanding: number;
  percent: number;
  certifiable: boolean;
}

/** Progress against the checklist. Certification requires every item verified. */
export function readinessProgress(rowsIn: WlReadinessRow[]): ReadinessProgress {
  const byKey = new Map(rowsIn.map((r) => [r.item_key, r.status]));
  const verified = READINESS_ITEMS.filter((i) => byKey.get(i.key) === "verified").length;
  const blockingOutstanding = READINESS_ITEMS.filter(
    (i) => i.blocking && byKey.get(i.key) !== "verified",
  ).length;
  const total = READINESS_ITEMS.length;
  return {
    total,
    verified,
    blockingOutstanding,
    percent: total === 0 ? 0 : Math.round((verified / total) * 100),
    certifiable: verified === total,
  };
}

/** Verify the evidence hash chain is unbroken (rows may arrive newest-first). */
export function verifyEvidenceChain(evidence: WlEvidence[]): { intact: boolean; brokenAt?: string } {
  const ordered = [...evidence].sort((a, b) => a.created_at.localeCompare(b.created_at));
  let prev: string | null = null;
  for (const row of ordered) {
    if ((row.prev_hash ?? null) !== prev) return { intact: false, brokenAt: row.id };
    prev = row.entry_hash;
  }
  return { intact: true };
}
