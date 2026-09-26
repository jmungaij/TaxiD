/**
 * Portal preference + transition audit.
 *
 * Remembers the LAST operating context the identity actually used, so the next
 * login lands there instead of the role-default. The preference is a UX hint
 * only — it can never widen authority: every read is intersected with the
 * server-resolved context list, and every jump is still re-authorised by
 * `switch_operating_context` before navigation.
 *
 * Persistence is written twice on purpose:
 *   • localStorage — survives tab restarts on the same browser profile
 *   • cookie       — survives storage clears in privacy modes / other tabs
 */
import { supabase } from "@/integrations/supabase/client";
import {
  OPERATING_CONTEXTS,
  activeOperatingContext,
  type OperatingContextKey,
} from "./operatingContexts";

export const PORTAL_PREF_KEY = "yalla.portal.last";
const COOKIE_MAX_AGE_DAYS = 180;

const isContextKey = (v: unknown): v is OperatingContextKey =>
  typeof v === "string" && OPERATING_CONTEXTS.some((c) => c.key === v);

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const hit = document.cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : null;
}

/** Persist the context the identity just entered. */
export function rememberPortal(key: OperatingContextKey): void {
  try {
    localStorage.setItem(PORTAL_PREF_KEY, key);
  } catch {
    /* storage denied — cookie still applies */
  }
  try {
    const maxAge = COOKIE_MAX_AGE_DAYS * 24 * 60 * 60;
    document.cookie = `${PORTAL_PREF_KEY}=${encodeURIComponent(key)};path=/;max-age=${maxAge};samesite=lax`;
  } catch {
    /* no document (SSR / tests) */
  }
}

/** The remembered context, or null when nothing valid is stored. */
export function readRememberedPortal(): OperatingContextKey | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(PORTAL_PREF_KEY);
  } catch {
    raw = null;
  }
  if (!isContextKey(raw)) raw = readCookie(PORTAL_PREF_KEY);
  return isContextKey(raw) ? raw : null;
}

export function clearRememberedPortal(): void {
  try {
    localStorage.removeItem(PORTAL_PREF_KEY);
  } catch {
    /* ignore */
  }
  try {
    document.cookie = `${PORTAL_PREF_KEY}=;path=/;max-age=0;samesite=lax`;
  } catch {
    /* ignore */
  }
}

/**
 * Landing route implied by the remembered portal, but ONLY when the
 * server-authorised context list still contains it.
 */
export function rememberedLandingFor(
  authorisedContexts: readonly string[],
): { context: OperatingContextKey; to: string } | null {
  const remembered = readRememberedPortal();
  if (!remembered || !authorisedContexts.includes(remembered)) return null;
  const ctx = OPERATING_CONTEXTS.find((c) => c.key === remembered);
  return ctx ? { context: ctx.key, to: ctx.to } : null;
}

/** Common landing pages inside each portal, for switcher deep links. */
export const PORTAL_DEEP_LINKS: Record<OperatingContextKey, { to: string; label: string }[]> = {
  staff_operations: [
    { to: "/staff/workspace", label: "My Workspace" },
    { to: "/staff/org/work", label: "My Work queue" },
    { to: "/staff/access", label: "Access gateway" },
    { to: "/staff/audit", label: "Security audit" },
  ],
  super_admin: [
    { to: "/dashboard/admin", label: "Control Centre" },
    { to: "/dashboard/admin/super", label: "Super Admin" },
    { to: "/dashboard/admin/pricing-360", label: "Pricing 360" },
    { to: "/dashboard/admin/email-delivery", label: "Email delivery" },
  ],
};

export type PortalTransitionKind = "login_redirect" | "portal_switch" | "deep_link";

/**
 * Writes an immutable audit row for a portal transition (user id, previous and
 * new route, contexts, timestamp — all stamped server-side). Failures are
 * swallowed: navigation must never depend on telemetry.
 */
export async function auditPortalTransition(params: {
  kind: PortalTransitionKind;
  newRoute: string;
  previousRoute?: string | null;
  newContext?: OperatingContextKey | null;
  previousContext?: OperatingContextKey | null;
  remembered?: boolean;
}): Promise<void> {
  try {
    const previousRoute =
      params.previousRoute ?? (typeof window !== "undefined" ? window.location.pathname : null);
    await supabase.rpc("record_portal_transition", {
      _kind: params.kind,
      _new_route: params.newRoute,
      _previous_route: previousRoute,
      _new_context: params.newContext ?? activeOperatingContext(params.newRoute),
      _previous_context: params.previousContext ?? (previousRoute ? activeOperatingContext(previousRoute) : null),
      _remembered: params.remembered ?? false,
      _user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
    });
  } catch {
    /* audit is best-effort on the client; the server trail is authoritative */
  }
}
