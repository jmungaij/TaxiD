/**
 * SOCIAL PUBLISHING — CONTROL-PLANE CLIENT
 *
 * Read paths are RLS-scoped (`social_can_edit()` → admin / super_admin /
 * operations_admin). Every mutation is a governed Postgres routine:
 *
 *   social_save_post / social_save_variant   authoring (revokes approval on edit)
 *   social_submit_post                        author → review
 *   social_review_post                        two-person approval / rejection
 *   social_schedule_post                      approved content → publication jobs
 *   social_cancel_jobs / social_requeue_job   queue control
 *   social_set_connection_state               account connection lifecycle
 *
 * The browser never holds a provider token: credentials live in a table with
 * no client policies and are read only by the service-role worker.
 */
import { supabase } from "@/integrations/supabase/client";
import { untypedDb } from "@/integrations/supabase/untyped";

const db = untypedDb;

export type PostStatus =
  | "DRAFT" | "IN_REVIEW" | "APPROVED" | "SCHEDULED" | "PUBLISHING"
  | "PARTIALLY_PUBLISHED" | "PUBLISHED" | "FAILED" | "CANCELLED" | "REJECTED";

export type VariantStatus =
  | "DRAFT" | "READY" | "SCHEDULED" | "PUBLISHING" | "PUBLISHED" | "FAILED" | "CANCELLED";

export type JobState =
  | "QUEUED" | "PUBLISHING" | "PLATFORM_ACCEPTED" | "PUBLISHED"
  | "RETRY_PENDING" | "FAILED_PERMANENTLY" | "DEAD_LETTER" | "CANCELLED";

export interface ProviderCapability {
  platform_slug: string;
  api_version: string | null;
  auth_kind: string | null;
  supports_text: boolean;
  supports_image: boolean;
  supports_video: boolean;
  supports_carousel: boolean;
  supports_document: boolean;
  supports_analytics: boolean;
  direct_publish: string | null;
  caption_max: number | null;
  media_max_mb: number | null;
  scheduling_owner: string | null;
  notes: string | null;
  docs_url: string | null;
}

export interface SocialConnection {
  id: string;
  account_id: string;
  platform_slug: string;
  state: string;
  external_account_id: string | null;
  external_account_name: string | null;
  granted_scopes: string[] | null;
  token_expires_at: string | null;
  last_publication_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  updated_at: string;
}

export interface SocialPost {
  id: string;
  campaign_id: string | null;
  title: string;
  master_caption: string | null;
  internal_notes: string | null;
  market: string;
  status: PostStatus;
  version: number;
  approved_version: number | null;
  approved_by: string | null;
  approved_at: string | null;
  scheduled_at: string | null;
  published_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SocialVariant {
  id: string;
  post_id: string;
  platform_slug: string;
  account_id: string | null;
  caption: string;
  headline: string | null;
  media_asset_ids: string[] | null;
  destination_url: string | null;
  platform_options: Record<string, unknown> | null;
  status: VariantStatus;
  content_hash: string | null;
  approved_hash: string | null;
  external_post_id: string | null;
  external_url: string | null;
  published_at: string | null;
  failure_code: string | null;
  failure_message: string | null;
}

export interface PublicationJob {
  id: string;
  post_id: string;
  variant_id: string;
  platform_slug: string;
  account_id: string;
  state: JobState;
  dry_run: boolean;
  attempt: number;
  max_attempts: number;
  scheduled_for: string | null;
  next_attempt_at: string | null;
  error_code: string | null;
  error_message: string | null;
  provider_ref: Record<string, unknown> | null;
  updated_at: string;
}

export interface ProviderHealth {
  platform_slug: string;
  configuration: "READY" | "NOT_CONFIGURED" | "BLOCKED";
  missing_secrets: string[];
  required_scopes: string[];
  required_secrets: string[];
}

export interface QueueBucket {
  state: JobState;
  count: number;
  oldest: string | null;
}

export interface WebhookHealth {
  platform_slug: string;
  deliveries: number;
  rejected: number;
  last_received: string | null;
}

export interface WebhookDelivery {
  id: string;
  provider: string;
  event_id: string;
  event_kind: string;
  signature_valid: boolean;
  external_post_id: string | null;
  result: string;
  received_at: string;
}

async function rows<T>(table: string, build: (q: any) => any): Promise<T[]> {
  const { data, error } = await build(db.from(table));
  if (error) throw new Error(error.message);
  return (data ?? []) as T[];
}

export const listCapabilities = () =>
  rows<ProviderCapability>("social_provider_capabilities", (q) => q.select("*").order("platform_slug"));

export const listConnections = () =>
  rows<SocialConnection>("social_connections", (q) => q.select("*").order("platform_slug"));

export const listPosts = (limit = 100) =>
  rows<SocialPost>("social_posts", (q) => q.select("*").order("updated_at", { ascending: false }).limit(limit));

export const listVariants = (postIds?: string[]) =>
  rows<SocialVariant>("social_post_variants", (q) => {
    const base = q.select("*").order("platform_slug");
    return postIds && postIds.length ? base.in("post_id", postIds) : base.limit(500);
  });

export const listJobs = (limit = 200) =>
  rows<PublicationJob>("social_publication_jobs", (q) =>
    q.select("*").order("updated_at", { ascending: false }).limit(limit),
  );

export const listWebhookDeliveries = (limit = 50) =>
  rows<WebhookDelivery>("social_webhook_events", (q) =>
    q
      .select("id, provider, event_id, event_kind, signature_valid, external_post_id, result, received_at")
      .order("received_at", { ascending: false })
      .limit(limit),
  );

export async function queueSummary(): Promise<QueueBucket[]> {
  const { data, error } = await db.rpc("social_queue_summary");
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    state: (r.state ?? Object.values(r)[0]) as JobState,
    count: Number(r.count ?? Object.values(r)[1] ?? 0),
    oldest: (r.min ?? r.oldest ?? Object.values(r)[2] ?? null) as string | null,
  }));
}

export async function webhookHealth(): Promise<WebhookHealth[]> {
  const { data, error } = await db.rpc("social_webhook_health");
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    platform_slug: String(r.platform_slug ?? ""),
    deliveries: Number(r.deliveries ?? 0),
    rejected: Number(r.rejected ?? 0),
    last_received: (r.last_received as string | null) ?? null,
  }));
}

/** Provider provisioning health — read from the worker, which owns the secrets. */
export async function providerHealth(): Promise<{ providers: ProviderHealth[]; queue: QueueBucket[] }> {
  const { data, error } = await supabase.functions.invoke("social-publish-worker", { body: { mode: "health" } });
  if (error) throw new Error(error.message);
  return {
    providers: (data?.providers ?? []) as ProviderHealth[],
    queue: (data?.queue ?? []) as QueueBucket[],
  };
}

export async function runWorker(limit = 5): Promise<{ claimed: number; results: Record<string, unknown>[] }> {
  const { data, error } = await supabase.functions.invoke("social-publish-worker", { body: { mode: "drain", limit } });
  if (error) throw new Error(error.message);
  return { claimed: Number(data?.claimed ?? 0), results: (data?.results ?? []) as Record<string, unknown>[] };
}

/* ---------------- governed mutations ---------------- */

async function call<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export const savePost = (input: {
  id?: string | null;
  title: string;
  masterCaption?: string | null;
  campaignId?: string | null;
  market?: string;
  notes?: string | null;
  aiAssisted?: boolean;
}) =>
  call<SocialPost>("social_save_post", {
    _id: input.id ?? null,
    _title: input.title,
    _master_caption: input.masterCaption ?? null,
    _campaign: input.campaignId ?? null,
    _market: input.market ?? "KE",
    _notes: input.notes ?? null,
    _ai_assisted: input.aiAssisted ?? false,
  });

export const saveVariant = (input: {
  id?: string | null;
  postId: string;
  platform: string;
  accountId?: string | null;
  caption: string;
  headline?: string | null;
  mediaAssetIds?: string[];
  destinationUrl?: string | null;
  options?: Record<string, unknown>;
}) =>
  call<SocialVariant>("social_save_variant", {
    _id: input.id ?? null,
    _post: input.postId,
    _platform: input.platform,
    _account: input.accountId ?? null,
    _caption: input.caption,
    _headline: input.headline ?? null,
    _media: input.mediaAssetIds ?? [],
    _destination: input.destinationUrl ?? null,
    _options: input.options ?? {},
  });

export const submitPost = (postId: string, note: string) =>
  call("social_submit_post", { _post: postId, _note: note });

export const reviewPost = (postId: string, decision: "APPROVE" | "REJECT", note: string) =>
  call("social_review_post", { _post: postId, _decision: decision, _note: note });

export const schedulePost = (postId: string, when: string, dryRun = false) =>
  call("social_schedule_post", { _post: postId, _when: when, _dry_run: dryRun });

export const cancelJobs = (postId: string, reason: string) =>
  call("social_cancel_jobs", { _post: postId, _reason: reason });

export const requeueJob = (jobId: string, reason: string) =>
  call("social_requeue_job", { _job: jobId, _reason: reason });

export const setConnectionState = (input: {
  accountId: string;
  state: string;
  externalId?: string | null;
  externalName?: string | null;
  scopes?: string[];
  expires?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}) =>
  call<SocialConnection>("social_set_connection_state", {
    _account: input.accountId,
    _state: input.state,
    _external_id: input.externalId ?? null,
    _external_name: input.externalName ?? null,
    _scopes: input.scopes ?? [],
    _expires: input.expires ?? null,
    _error_code: input.errorCode ?? null,
    _error_message: input.errorMessage ?? null,
  });

export const disconnectAccount = (accountId: string, reason: string) =>
  call("social_disconnect_account", { _account: accountId, _reason: reason });

/* ---------------- presentation helpers ---------------- */

export const JOB_TONE: Record<string, string> = {
  QUEUED: "bg-muted text-muted-foreground",
  PUBLISHING: "bg-info/15 text-info",
  PLATFORM_ACCEPTED: "bg-info/15 text-info",
  PUBLISHED: "bg-success/15 text-success",
  RETRY_PENDING: "bg-warning/15 text-warning",
  FAILED_PERMANENTLY: "bg-destructive/15 text-destructive",
  DEAD_LETTER: "bg-destructive/15 text-destructive",
  CANCELLED: "bg-muted text-muted-foreground",
};

export const POST_TONE: Record<string, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  IN_REVIEW: "bg-warning/15 text-warning",
  APPROVED: "bg-info/15 text-info",
  SCHEDULED: "bg-info/15 text-info",
  PUBLISHING: "bg-info/15 text-info",
  PARTIALLY_PUBLISHED: "bg-warning/15 text-warning",
  PUBLISHED: "bg-success/15 text-success",
  FAILED: "bg-destructive/15 text-destructive",
  REJECTED: "bg-destructive/15 text-destructive",
  CANCELLED: "bg-muted text-muted-foreground",
};

/** A variant edited after approval must not publish — surfaced in the console. */
export const approvalIsStale = (v: SocialVariant): boolean =>
  !!v.approved_hash && v.content_hash !== v.approved_hash;

/* ---------------- provisioning, diagnostics, forensics ---------------- *
 *
 * All of these are privileged service-role operations behind the
 * `social-provisioning` edge function: the browser may ask for a diagnosis or
 * hand over a token, but it can never read a token back.
 */

export interface DiagnosticCheck {
  id: string;
  label: string;
  state: "PASS" | "FAIL" | "WARN" | "NA";
  detail: string;
  action: string | null;
}

export interface ProviderGuide {
  app: string;
  console: string;
  docs: string;
  token: string;
  webhook: string;
}

export interface ProviderDiagnostic {
  platform_slug: string;
  configuration: "READY" | "BLOCKED" | "NOT_CONFIGURED";
  checks: DiagnosticCheck[];
  required_secrets: string[];
  missing_secrets: string[];
  required_scopes: string[];
  missing_scopes: string[];
  accounts: {
    account_id: string;
    handle: string | null;
    connection_state: string;
    external_account_id: string | null;
    has_credentials: boolean;
    token_expires_at: string | null;
    token_expired: boolean;
    granted_scopes: string[];
  }[];
  guide: ProviderGuide | null;
}

export interface JobTimeline {
  job: PublicationJob;
  variant: SocialVariant | null;
  events: {
    id: string;
    action: string;
    result: string | null;
    detail: Record<string, unknown> | null;
    created_at: string;
    actor_user_id: string | null;
  }[];
  deliveries: {
    id: string;
    provider: string;
    event_id: string;
    event_kind: string | null;
    signature_valid: boolean;
    result: string | null;
    received_at: string;
  }[];
}

async function provisioning<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke("social-provisioning", { body: { action, ...payload } });
  if (error) throw new Error(error.message);
  if (data && data.ok === false) throw new Error(String(data.error ?? "request refused"));
  return data as T;
}

export const diagnoseProviders = () =>
  provisioning<{ providers: ProviderDiagnostic[] }>("diagnose").then((r) => r.providers);

/** Hands a provider token to the backend. The value is never readable again. */
export const saveProviderCredentials = (input: {
  accountId: string;
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  expiresAt?: string | null;
  scopes?: string[];
  externalAccountId?: string | null;
  externalAccountName?: string | null;
}) =>
  provisioning<{ platform: string; scopes: string[] }>("save_credentials", {
    account_id: input.accountId,
    access_token: input.accessToken,
    refresh_token: input.refreshToken ?? null,
    token_type: input.tokenType ?? "Bearer",
    expires_at: input.expiresAt ?? null,
    scopes: input.scopes ?? [],
    external_account_id: input.externalAccountId ?? null,
    external_account_name: input.externalAccountName ?? null,
  });

export const revokeProviderCredentials = (accountId: string, reason: string) =>
  provisioning<{ ok: true }>("revoke_credentials", { account_id: accountId, reason });

export const sendSampleWebhook = (input: {
  provider: string;
  eventKind?: string;
  status?: string;
  externalPostId?: string | null;
  metrics?: Record<string, number>;
}) =>
  provisioning<{
    provider: string;
    event_key: string;
    external_post_id: string;
    matched_variant: boolean;
  }>("webhook_sample", {
    provider: input.provider,
    event_kind: input.eventKind ?? "PUBLICATION_STATUS",
    status: input.status ?? "PUBLISHED",
    external_post_id: input.externalPostId ?? null,
    metrics: input.metrics ?? {},
  });

export const replayWebhook = (eventId: string) =>
  provisioning<{ replayed: string; event_key: string }>("webhook_replay", { event_id: eventId });

export const fetchJobTimeline = (jobId: string) => provisioning<JobTimeline>("job_timeline", { job_id: jobId });

/** Canonical publication milestones, so a gap in the story is visible. */
export const JOB_MILESTONES: { id: string; label: string; matches: (a: string) => boolean }[] = [
  { id: "scheduled", label: "Scheduled", matches: (a) => a === "JOB_SCHEDULED" || a === "POST_SCHEDULED" },
  { id: "claimed", label: "Claimed by worker", matches: (a) => a === "JOB_CLAIMED" },
  { id: "readiness", label: "Readiness assessed", matches: (a) => a.startsWith("READINESS") || a === "JOB_BLOCKED" },
  { id: "provider", label: "Sent to provider", matches: (a) => a === "PROVIDER_CALL" || a === "MEDIA_RESOLVED" },
  { id: "published", label: "Published / external id stored", matches: (a) => a === "JOB_COMPLETED" || a === "VARIANT_PUBLISHED" },
  { id: "webhook", label: "Provider callback received", matches: (a) => a.startsWith("WEBHOOK") },
];
