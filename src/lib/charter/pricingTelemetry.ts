/**
 * Client-side pricing-recovery telemetry.
 *
 * When a booking submission is rejected with `pricing_version_stale`, the
 * booking page refetches the published version and retries once. Those three
 * moments (started / succeeded / failed) are recorded in `analytics_events`
 * and correlated with the *same* idempotency key the edge function uses, so a
 * stuck booking attempt can be traced end-to-end from the browser retry to the
 * server-side idempotency record.
 */
import { supabase } from "@/integrations/supabase/client";
import { untypedDb } from "@/integrations/supabase/untyped";

export type PricingRecoveryPhase = "retry_started" | "retry_succeeded" | "retry_failed";

export interface PricingRecoveryEvent {
  phase: PricingRecoveryPhase;
  slug: string;
  /** Backend idempotency key for the booking submission being recovered. */
  idempotencyKey: string;
  governed: boolean;
  quotedVersion?: number | null;
  activeVersion?: number | null;
  reference?: string | null;
  error?: string | null;
}

/** Best-effort — telemetry must never break a booking. */
export async function recordPricingRecovery(event: PricingRecoveryEvent): Promise<void> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    await (untypedDb)
      .from("analytics_events")
      .insert({
        event_name: `charter.pricing_recovery.${event.phase}`,
        user_id: auth?.user?.id ?? null,
        subject_type: "charter_booking",
        properties: {
          phase: event.phase,
          slug: event.slug,
          idempotency_key: event.idempotencyKey,
          governed: event.governed,
          quoted_version: event.quotedVersion ?? null,
          active_version: event.activeVersion ?? null,
          reference: event.reference ?? null,
          error: event.error ?? null,
          occurred_at: new Date().toISOString(),
        },
      });
  } catch (e) {
    console.warn("pricing recovery telemetry failed", e);
  }
}
