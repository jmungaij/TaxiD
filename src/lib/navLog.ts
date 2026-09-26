// Lightweight logger for navigation_logs and ui_events.
// Fire-and-forget; never throw into the UI.
import { supabase } from "@/integrations/supabase/client";
import { shouldUseYallaSessionKey } from "@/lib/renameFeatureFlag";

// Session-storage key rename (taxid_* → yalla_*) — backward compatible during
// the rollout window. Reads accept the legacy key so an already-open tab is
// not forced to sign out. Writes route to the yalla_ or taxid_ key according
// to `shouldUseYallaSessionKey()` (feature-flag / kill-switch controlled).
//
// After LEGACY_CUTOFF the legacy key is IGNORED on read — any tab still
// carrying only the old key will mint a fresh session id (a new nav_log
// session boundary, not a sign-out).
const SESSION_KEY = "yalla_session_id";
const LEGACY_SESSION_KEY = "taxid_session_id";
export const LEGACY_CUTOFF = Date.parse("2026-09-01T00:00:00Z");

export function isLegacyKeyExpired(now: number = Date.now()): boolean {
  return now >= LEGACY_CUTOFF;
}

/**
 * Exported for the dual-read regression test. Not part of the public API.
 * `overrides` lets tests inject deterministic values.
 */
export function _resolveSessionId(overrides?: {
  now?: number;
  useYalla?: boolean;
}): string {
  const now = overrides?.now ?? Date.now();
  const useYalla = overrides?.useYalla ?? shouldUseYallaSessionKey();
  const primaryKey = useYalla ? SESSION_KEY : LEGACY_SESSION_KEY;
  const secondaryKey = useYalla ? LEGACY_SESSION_KEY : SESSION_KEY;
  const legacyExpired = isLegacyKeyExpired(now);

  try {
    let id = sessionStorage.getItem(primaryKey);
    if (!id) {
      // Try the other key, but reject the legacy key entirely after cutoff.
      const isSecondaryLegacy = secondaryKey === LEGACY_SESSION_KEY;
      if (!(isSecondaryLegacy && legacyExpired)) {
        const secondary = sessionStorage.getItem(secondaryKey);
        if (secondary) {
          id = secondary;
          sessionStorage.setItem(primaryKey, secondary);
          sessionStorage.removeItem(secondaryKey);
        }
      } else if (sessionStorage.getItem(LEGACY_SESSION_KEY)) {
        // Post-cutoff: forcibly evict the abandoned legacy key so it can never
        // be adopted again on subsequent reads.
        sessionStorage.removeItem(LEGACY_SESSION_KEY);
      }
      if (!id) {
        id = crypto.randomUUID();
        sessionStorage.setItem(primaryKey, id);
      }
    }
    return id;
  } catch {
    return "no-session";
  }
}

function getSessionId(): string {
  return _resolveSessionId();
}

async function currentUserId(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.user.id ?? null;
  } catch {
    return null;
  }
}

export interface NavLogInput {
  route: string;
  fromRoute?: string | null;
  success?: boolean;
  errorMessage?: string | null;
  durationMs?: number | null;
}

export async function logNavigation(input: NavLogInput): Promise<void> {
  try {
    const user_id = await currentUserId();
    await supabase.from("navigation_logs").insert({
      user_id,
      session_id: getSessionId(),
      route: input.route,
      from_route: input.fromRoute ?? null,
      success: input.success ?? true,
      error_message: input.errorMessage ?? null,
      duration_ms: input.durationMs ?? null,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 500) : null,
    });
  } catch {
    /* swallow */
  }
}
export interface UiEventInput {
  elementId: string;
  elementLabel?: string;
  pageRoute?: string;
  action?: string;
  success?: boolean;
  errorMessage?: string | null;
  payload?: Record<string, unknown>;
}

export async function logUiEvent(input: UiEventInput): Promise<void> {
  try {
    const user_id = await currentUserId();
    await supabase.from("ui_events").insert({
      user_id,
      session_id: getSessionId(),
      page_route: input.pageRoute ?? (typeof window !== "undefined" ? window.location.pathname : null),
      element_id: input.elementId,
      element_label: input.elementLabel ?? null,
      action: input.action ?? "click",
      success: input.success ?? true,
      error_message: input.errorMessage ?? null,
      payload: (input.payload ?? {}) as never,
    });
  } catch {
    /* swallow */
  }
}

export interface AccessDenialInput {
  surface: "route" | "command_palette" | "api";
  requestedPath?: string | null;
  requestedCommand?: string | null;
  reason: string;
  requiredRoles?: string[];
  userRoles?: string[];
  riskScore?: number;
}

export async function logAccessDenial(input: AccessDenialInput): Promise<void> {
  try {
    const { data: sess } = await supabase.auth.getSession();
    const user = sess.session?.user;
    await supabase.from("access_denials").insert({
      user_id: user?.id ?? null,
      user_email: user?.email ?? null,
      user_roles: input.userRoles ?? [],
      surface: input.surface,
      requested_path: input.requestedPath ?? null,
      requested_command: input.requestedCommand ?? null,
      reason: input.reason,
      required_roles: input.requiredRoles ?? [],
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 500) : null,
      risk_score: input.riskScore ?? 0,
    });
  } catch {
    /* swallow */
  }
}

export interface AdminAuditInput {
  action: string;
  resourceType?: string;
  resourceId?: string;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export async function logAdminAudit(input: AdminAuditInput): Promise<void> {
  try {
    const { data: sess } = await supabase.auth.getSession();
    const user = sess.session?.user;
    await supabase.from("admin_audit_log").insert({
      actor_id: user?.id ?? null,
      actor_email: user?.email ?? null,
      action: input.action,
      resource_type: input.resourceType ?? null,
      resource_id: input.resourceId ?? null,
      old_value: (input.oldValue ?? null) as never,
      new_value: (input.newValue ?? null) as never,
      reason: input.reason ?? null,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 500) : null,
      metadata: (input.metadata ?? {}) as never,
    });
  } catch {
    /* swallow */
  }
}

