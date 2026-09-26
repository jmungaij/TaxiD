/**
 * PARTNER PROFILE HISTORY & LIFECYCLE AUDIT — staff-scoped read surface.
 *
 * `partner_profile_history` is written by a database trigger on
 * `partner_intent_profiles`, so every change to what a partner said they bring,
 * the category, the maturity level and the lifecycle stage is captured with the
 * fields that changed — whether the change came from the apply form, a staff
 * action, or a revert. `partner_profile_revert` restores an earlier captured
 * state; it is SECURITY DEFINER and staff-gated in the database.
 *
 * `partner_lifecycle_audit` is written by a trigger on
 * `partner_lifecycle_signals`, so each stage move records the stage it came
 * from, the selections behind it and the staff task it raised. The table is
 * append-only — rows can never be edited or deleted.
 *
 * Realtime keeps the staff funnel and journey views live: a visitor moving
 * stage, or a profile changing, pushes straight into the open dashboard.
 */
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/* eslint-disable @typescript-eslint/no-explicit-any */
const db = supabase as any;

export type ProfileChangeKind = "created" | "updated" | "reverted";

export interface PartnerProfileHistoryRow {
  id: string;
  profile_id: string;
  contact_email: string;
  change_kind: ProfileChangeKind;
  intent_bring: string | null;
  network_category: string | null;
  maturity_level: string | null;
  lifecycle_stage: string | null;
  commercial_model: string | null;
  partner_type: string | null;
  ab_variant: string | null;
  session_id: string | null;
  changed_fields: string[];
  changed_by: string | null;
  reverted_from_history_id: string | null;
  created_at: string;
}

export interface PartnerLifecycleAuditRow {
  id: string;
  signal_id: string | null;
  session_id: string;
  profile_id: string | null;
  work_item_id: string | null;
  previous_stage: string | null;
  lifecycle_stage: string;
  maturity_level: string | null;
  network_category: string | null;
  intent_bring: string | null;
  ab_variant: string | null;
  page_source: string | null;
  created_at: string;
}

export const CHANGE_KIND_LABEL: Record<ProfileChangeKind, string> = {
  created: "Profile created",
  updated: "Intent updated",
  reverted: "Reverted to earlier state",
};

export const HISTORY_FIELD_LABEL: Record<string, string> = {
  intent_bring: "What they bring",
  network_category: "Partner category",
  maturity_level: "Maturity level",
  lifecycle_stage: "Lifecycle stage",
  commercial_model: "Commercial model",
  partner_type: "Partner type",
};

/** Captured states of one partner intent profile, newest first. */
export async function listProfileHistory(profileId: string, limit = 50): Promise<PartnerProfileHistoryRow[]> {
  const { data, error } = await db
    .from("partner_profile_history")
    .select("*")
    .eq("profile_id", profileId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as PartnerProfileHistoryRow[];
}

/** Lifecycle stage audit trail for one visitor session, oldest first. */
export async function listLifecycleAudit(sessionId: string, limit = 100): Promise<PartnerLifecycleAuditRow[]> {
  const { data, error } = await db
    .from("partner_lifecycle_audit")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as PartnerLifecycleAuditRow[];
}

export interface RevertResult {
  ok: boolean;
  reason?: string;
  profileId?: string;
}

/** Restore a partner intent profile to a previously captured state. */
export async function revertProfileState(historyId: string): Promise<RevertResult> {
  try {
    const { data, error } = await db.rpc("partner_profile_revert", { p_history_id: historyId });
    if (error) return { ok: false, reason: error.message };
    const row = (data ?? {}) as Record<string, unknown>;
    return {
      ok: Boolean(row.ok),
      reason: typeof row.reason === "string" ? row.reason : undefined,
      profileId: typeof row.profile_id === "string" ? row.profile_id : undefined,
    };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "revert_failed" };
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Live partner funnel. Pushes in new lifecycle signals, audit rows and profile
 * changes so an open staff dashboard reflects visitor activity without a
 * refresh. The channel is created once per mount — the handler is held in a ref
 * so a new closure per render never re-subscribes.
 */
export function usePartnerFunnelRealtime(onChange: () => void, key = "all") {
  const [connected, setConnected] = useState(false);
  const handler = useRef(onChange);
  handler.current = onChange;

  useEffect(() => {
    const channel = supabase
      .channel(`yp-funnel-${key}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "partner_lifecycle_signals" }, () => handler.current())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "partner_lifecycle_audit" }, () => handler.current())
      .on("postgres_changes", { event: "*", schema: "public", table: "partner_profile_history" }, () => handler.current())
      .subscribe((status) => setConnected(status === "SUBSCRIBED"));

    return () => { void supabase.removeChannel(channel); };
  }, [key]);

  return { connected };
}
