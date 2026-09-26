/**
 * CTA analytics — fire-and-forget tracker through the validated server intake.
 * Used by <AppButton>. Failures are swallowed so they never break UX.
 */
// The Supabase client is imported lazily so build-time governance scripts can
// import navigation modules that reference trackCta without evaluating
// import.meta.env (undefined under plain Node).
async function client() {
  const { supabase } = await import("@/integrations/supabase/client");
  return supabase;
}

export type CtaActionType =
  | "navigate"
  | "external"
  | "submit"
  | "dialog"
  | "scroll"
  | "noop";

export interface CtaPayload {
  buttonName: string;
  actionType: CtaActionType;
  target?: string;
  pageSource?: string;
  metadata?: Record<string, unknown>;
}

function readUtm(): Record<string, string | undefined> {
  if (typeof window === "undefined") return {};
  const p = new URLSearchParams(window.location.search);
  return {
    utm_source: p.get("utm_source") ?? undefined,
    utm_medium: p.get("utm_medium") ?? undefined,
    utm_campaign: p.get("utm_campaign") ?? undefined,
    campaign_source: p.get("ref") ?? p.get("utm_source") ?? undefined,
  };
}

let sessionId: string | null = null;
export function getSessionId(): string {
  if (sessionId) return sessionId;
  if (typeof window === "undefined") return "ssr";
  const key = "yalla.session_id";
  const existing = sessionStorage.getItem(key);
  if (existing) { sessionId = existing; return existing; }
  const id = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  sessionStorage.setItem(key, id);
  sessionId = id;
  return id;
}

export async function trackCta(p: CtaPayload): Promise<void> {
  try {
    const supabase = await client();
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth?.user?.id ?? null;
    let userRole: string | null = null;
    if (userId) {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .limit(1)
        .maybeSingle();
      userRole = (roles as { role?: string } | null)?.role ?? null;
    }
    const utm = readUtm();
    await supabase.functions.invoke("cta-event", {
      body: {
        operation: "track",
        button_name: p.buttonName,
        action_type: p.actionType,
        target: p.target,
        page_source: p.pageSource ?? (typeof window !== "undefined" ? window.location.pathname : null),
        session_id: getSessionId(),
        campaign_source: utm.campaign_source,
        utm_source: utm.utm_source,
        utm_medium: utm.utm_medium,
        utm_campaign: utm.utm_campaign,
        metadata: p.metadata ?? {},
        // These are advisory only. The server derives identity and role from the JWT.
        client_authenticated: Boolean(userId),
        client_role_present: Boolean(userRole),
      },
    });
  } catch {
    /* swallow: tracking must never break the app */
  }
}

export async function markConversion(buttonName: string, value?: number): Promise<void> {
  try {
    const supabase = await client();
    const sid = getSessionId();
    await supabase.functions.invoke("cta-event", {
      body: { operation: "convert", session_id: sid, button_name: buttonName, value: value ?? null },
    });
  } catch { /* swallow */ }
}
