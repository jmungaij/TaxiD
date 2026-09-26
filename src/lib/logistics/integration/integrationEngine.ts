/**
 * PHASE 4 — integration platform client API.
 *
 * Every function here is a call into an authoritative backend operation. The
 * console owns no logic: it cannot create an event, cannot mark a delivery
 * delivered, and never sees a signing secret except in the one-time response to
 * an explicit create/rotate action.
 */
import { supabase } from "@/integrations/supabase/client";
import type { IntegrationHealth } from "./eventCatalogue";

export type ApiEnvironment = "sandbox" | "production";

export interface WebhookEndpointRow {
  id: string;
  partner_id: string;
  partner_code: string | null;
  partner_name: string | null;
  tenant_id: string | null;
  environment: ApiEnvironment;
  label: string;
  url: string;
  api_version: string;
  signature_version: string;
  secret_fingerprint: string;
  secret_rotated_at: string;
  subscribed_events: string[];
  status: IntegrationHealth;
  status_reason: string | null;
  max_attempts: number;
  timeout_ms: number;
  backoff_base_ms: number;
  last_success_at: string | null;
  last_failure_at: string | null;
  failure_count: number;
  consecutive_failures: number;
  delivered_count: number;
  created_at: string;
  updated_at: string;
}

export interface DeliveryRow {
  id: string;
  endpoint_id: string;
  event_id: string;
  partner_id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  sequence: number;
  environment: ApiEnvironment;
  status: "pending" | "processing" | "delivered" | "retrying" | "failed" | "dead_letter";
  attempt: number;
  max_attempts: number;
  http_status: number | null;
  response_class: string | null;
  latency_ms: number | null;
  failure_reason: string | null;
  next_retry_at: string;
  delivered_at: string | null;
  replay_of: string | null;
  correlation_id: string;
  created_at: string;
  request_payload: Record<string, unknown>;
}

export interface IntegrationEventRow {
  event_id: string;
  event_type: string;
  event_version: string;
  schema_version: string;
  aggregate_type: string;
  aggregate_id: string;
  sequence: number;
  tenant_id: string | null;
  environment: ApiEnvironment;
  is_synthetic: boolean;
  occurred_at: string;
  correlation_id: string;
  causation_id: string | null;
  actor_type: string;
  source: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface ApiRequestRow {
  id: string;
  request_id: string;
  correlation_id: string;
  partner_id: string | null;
  environment: ApiEnvironment | null;
  method: string;
  path: string;
  operation: string;
  scope_required: string | null;
  outcome: string;
  http_status: number;
  error_code: string | null;
  latency_ms: number;
  idempotent_replay: boolean;
  created_at: string;
}

export interface IntegrationOverview {
  events_24h: number;
  events_total: number;
  endpoints: Record<string, number> | null;
  deliveries: Record<string, number> | null;
  dead_letters: number;
  delivery_success_rate_24h: number | null;
  api_requests_24h: number;
  api_error_rate_24h: number | null;
  api_p95_latency_ms: number | null;
}

const unwrap = <T,>(data: unknown, error: { message: string } | null): T => {
  if (error) throw new Error(error.message);
  return data as T;
};

export async function fetchOverview(): Promise<IntegrationOverview> {
  const { data, error } = await supabase.rpc("logistics_integration_overview");
  return unwrap<IntegrationOverview>(data, error);
}

export async function fetchEndpoints(): Promise<WebhookEndpointRow[]> {
  const { data, error } = await supabase.rpc("logistics_integration_endpoints");
  return unwrap<WebhookEndpointRow[]>(data ?? [], error);
}

export async function fetchDeliveries(filters: {
  status?: string;
  endpointId?: string;
  eventType?: string;
  limit?: number;
} = {}): Promise<DeliveryRow[]> {
  let q = supabase
    .from("logistics_webhook_deliveries")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(Math.min(500, filters.limit ?? 100));
  if (filters.status) q = q.eq("status", filters.status);
  if (filters.endpointId) q = q.eq("endpoint_id", filters.endpointId);
  if (filters.eventType) q = q.eq("event_type", filters.eventType);
  const { data, error } = await q;
  return unwrap<DeliveryRow[]>(data ?? [], error);
}

export async function fetchEvents(filters: { eventType?: string; aggregateId?: string; limit?: number } = {}): Promise<IntegrationEventRow[]> {
  let q = supabase
    .from("logistics_integration_events")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(Math.min(500, filters.limit ?? 100));
  if (filters.eventType) q = q.eq("event_type", filters.eventType);
  if (filters.aggregateId) q = q.eq("aggregate_id", filters.aggregateId);
  const { data, error } = await q;
  return unwrap<IntegrationEventRow[]>(data ?? [], error);
}

export async function fetchApiRequests(limit = 100): Promise<ApiRequestRow[]> {
  const { data, error } = await supabase
    .from("logistics_api_requests")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(Math.min(500, limit));
  return unwrap<ApiRequestRow[]>(data ?? [], error);
}

export async function fetchPartners(): Promise<{ id: string; partner_code: string; legal_name: string; status: string }[]> {
  const { data, error } = await supabase
    .from("partners")
    .select("id, partner_code, legal_name, status")
    .order("legal_name");
  return unwrap<{ id: string; partner_code: string; legal_name: string; status: string }[]>(data ?? [], error);
}

export async function fetchTenantGrants(): Promise<
  { id: string; partner_id: string; tenant_id: string; tenant_label: string | null; environment: ApiEnvironment; scopes: string[]; status: string }[]
> {
  const { data, error } = await supabase
    .from("logistics_partner_tenants")
    .select("id, partner_id, tenant_id, tenant_label, environment, scopes, status")
    .order("created_at", { ascending: false });
  return unwrap(data ?? [], error);
}

export async function fetchRateLimits(): Promise<
  { id: string; scope_kind: string; scope_value: string; environment: ApiEnvironment; limit_per_minute: number; burst: number }[]
> {
  const { data, error } = await supabase
    .from("logistics_api_rate_limits")
    .select("id, scope_kind, scope_value, environment, limit_per_minute, burst")
    .order("scope_kind");
  return unwrap(data ?? [], error);
}

export interface RpcResult {
  ok: boolean;
  code?: string;
  message?: string;
  [key: string]: unknown;
}

async function callRpc(fn: string, args: Record<string, unknown>): Promise<RpcResult> {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) return { ok: false, code: "RPC_FAILED", message: error.message };
  return (data ?? { ok: false, code: "EMPTY_RESPONSE" }) as RpcResult;
}

export const saveEndpoint = (input: {
  id?: string | null;
  partnerId: string;
  label: string;
  url: string;
  environment: ApiEnvironment;
  events: string[];
  tenantId?: string | null;
  maxAttempts?: number;
  timeoutMs?: number;
  backoffBaseMs?: number;
}) =>
  callRpc("logistics_webhook_endpoint_upsert", {
    _id: input.id ?? null,
    _partner_id: input.partnerId,
    _label: input.label,
    _url: input.url,
    _environment: input.environment,
    _subscribed_events: input.events,
    _tenant_id: input.tenantId ?? null,
    _max_attempts: input.maxAttempts ?? 8,
    _timeout_ms: input.timeoutMs ?? 10000,
    _backoff_base_ms: input.backoffBaseMs ?? 2000,
  });

export const setEndpointStatus = (id: string, status: "CONFIGURED" | "ACTIVE" | "SUSPENDED" | "REVOKED", reason?: string) =>
  callRpc("logistics_webhook_endpoint_set_status", { _id: id, _status: status, _reason: reason ?? null });

export const rotateEndpointSecret = (id: string) =>
  callRpc("logistics_webhook_endpoint_rotate_secret", { _id: id });

export const replayDelivery = (deliveryId: string) =>
  callRpc("logistics_webhook_replay", { _delivery_id: deliveryId });

export const grantTenant = (input: { partnerId: string; tenantId: string; environment: ApiEnvironment; scopes: string[]; label?: string }) =>
  callRpc("logistics_partner_tenant_grant", {
    _partner_id: input.partnerId,
    _tenant_id: input.tenantId,
    _environment: input.environment,
    _scopes: input.scopes,
    _tenant_label: input.label ?? null,
  });

export const revokeTenant = (grantId: string) => callRpc("logistics_partner_tenant_revoke", { _grant_id: grantId });

/** Runs the delivery worker now (staff-triggered drain of the retry queue). */
export async function runDispatcher(limit = 25): Promise<{ ok: boolean; claimed?: number; message?: string }> {
  const { data, error } = await supabase.functions.invoke("logistics-webhook-dispatch", { body: { limit } });
  if (error) return { ok: false, message: error.message };
  return (data ?? { ok: false }) as { ok: boolean; claimed?: number };
}
