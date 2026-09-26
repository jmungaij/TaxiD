/**
 * Realtime channel health logger — writes status transitions to
 * public.event_subscription_health so admins can audit subscription failures.
 */
import { supabase } from "@/integrations/supabase/client";

export type ChannelStatus =
  | "connected"
  | "disconnected"
  | "error"
  | "timeout"
  | "reconnecting";

let sessionId: string | null = null;
function getSessionId() {
  if (sessionId) return sessionId;
  sessionId =
    (typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2));
  return sessionId;
}

export async function logSubscriptionHealth(params: {
  stream: string;
  channel: string;
  status: ChannelStatus;
  lastEventAt?: string | null;
  error?: string | null;
  latencyMs?: number | null;
}) {
  const { data: { user } } = await supabase.auth.getUser();
  await (supabase as any).from("event_subscription_health").insert({
    stream: params.stream,
    channel_name: params.channel,
    status: params.status,
    last_event_at: params.lastEventAt ?? null,
    last_error: params.error ?? null,
    latency_ms: params.latencyMs ?? null,
    user_id: user?.id ?? null,
    session_id: getSessionId(),
  });
}
