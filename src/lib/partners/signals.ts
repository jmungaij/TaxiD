/**
 * PARTNER LIFECYCLE SIGNALS & INTENT PROFILES — client surface for the two
 * server-side routines that turn public partner interest into staff work.
 *
 * `partner_lifecycle_signal` raises (at most once per session and stage, and
 * rate-limited server-side) a partner-desk work item plus a notification that
 * records the stage the visitor moved into together with what they said they
 * bring, the category and the maturity level they selected, and which messaging
 * variant they were shown.
 *
 * `partner_profile_upsert` creates or updates the partner intent profile keyed
 * on the contact email, so the intent, category, maturity level and current
 * lifecycle stage are persisted rather than living only in the URL.
 *
 * Both are SECURITY DEFINER routines: validation, deduplication and rate
 * limiting are enforced in the database, not here. Failures are non-fatal for
 * the visitor — marketing interaction must never break on telemetry.
 */
import { untypedDb } from "@/integrations/supabase/untyped";
import { getSessionId } from "@/lib/cta";
import { currentFrameVariant } from "@/lib/partners/abTest";

 
const rpc = (name: string, args: Record<string, unknown>) =>
  untypedDb.rpc(name, args);

export interface LifecycleSignalInput {
  stage: string;
  level?: string | null;
  category?: string | null;
  bring?: string | null;
  page?: string | null;
}

export interface SignalResult {
  ok: boolean;
  deduped?: boolean;
  reason?: string;
  signalId?: string;
  workItemId?: string;
}

/** Sessions that already raised a stage this page-load — saves a round trip. */
const raised = new Set<string>();

export async function recordLifecycleSignal(input: LifecycleSignalInput): Promise<SignalResult> {
  const stage = input.stage?.trim();
  if (!stage) return { ok: false, reason: "stage_required" };
  if (raised.has(stage)) return { ok: true, deduped: true };
  raised.add(stage);

  try {
    const { data, error } = await rpc("partner_lifecycle_signal", {
      p_session_id: getSessionId(),
      p_stage: stage,
      p_level: input.level ?? null,
      p_category: input.category ?? null,
      p_bring: input.bring ?? null,
      p_variant: currentFrameVariant(),
      p_page: input.page ?? (typeof window !== "undefined" ? window.location.pathname : null),
    });
    if (error) return { ok: false, reason: error.message };
    const row = (data ?? {}) as Record<string, unknown>;
    return {
      ok: Boolean(row.ok),
      deduped: Boolean(row.deduped),
      reason: typeof row.reason === "string" ? row.reason : undefined,
      signalId: typeof row.signal_id === "string" ? row.signal_id : undefined,
      workItemId: typeof row.work_item_id === "string" ? row.work_item_id : undefined,
    };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "signal_failed" };
  }
}

export interface IntentProfileInput {
  contact_email: string;
  organisation_name?: string | null;
  contact_name?: string | null;
  contact_phone?: string | null;
  country?: string | null;
  city?: string | null;
  partner_type?: string | null;
  commercial_model?: string | null;
  intent_bring?: string | null;
  network_category?: string | null;
  maturity_level?: string | null;
  lifecycle_stage?: string | null;
  application_id?: string | null;
}

export interface ProfileResult {
  ok: boolean;
  created?: boolean;
  profileId?: string;
  reason?: string;
}

/** Create or update the partner intent profile behind an application. */
export async function upsertIntentProfile(input: IntentProfileInput): Promise<ProfileResult> {
  try {
    const { data, error } = await rpc("partner_profile_upsert", {
      p_payload: {
        ...input,
        ab_variant: currentFrameVariant(),
        session_id: getSessionId(),
      },
    });
    if (error) return { ok: false, reason: error.message };
    const row = (data ?? {}) as Record<string, unknown>;
    return {
      ok: Boolean(row.ok),
      created: Boolean(row.created),
      profileId: typeof row.profile_id === "string" ? row.profile_id : undefined,
      reason: typeof row.reason === "string" ? row.reason : undefined,
    };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "profile_upsert_failed" };
  }
}
 
