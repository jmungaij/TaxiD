/**
 * Login/security telemetry writer.
 *
 * Clients may no longer insert into `admin_login_events` directly — the table's
 * INSERT policy was removed. All events go through the server-side
 * `record_login_event` routine, which stamps the caller's identity and derives
 * the risk score and allow/deny decision itself, so forged telemetry (fake
 * user_id, fake risk score, arbitrary metadata) is impossible.
 */
import { untypedDb } from "@/integrations/supabase/untyped";
import { getSessionContext } from "@/lib/sessionContext";

export type LoginEventType =
  | "login_success"
  | "login_failure"
  | "mfa_failure"
  | "device_mismatch";

export async function recordLoginEvent(args: {
  email: string;
  event_type: LoginEventType;
  reason?: string | null;
  surface?: string;
}): Promise<void> {
  try {
    const ctx = getSessionContext();
    await (untypedDb).rpc("record_login_event", {
      _email: args.email,
      _event_type: args.event_type,
      _reason: args.reason ?? null,
      _device_id: ctx.device_id,
      _browser: ctx.browser,
      _operating_system: ctx.os,
      _surface: args.surface ?? null,
      _user_agent: ctx.user_agent,
    });
  } catch {
    /* never break login */
  }
}
