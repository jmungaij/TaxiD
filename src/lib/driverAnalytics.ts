import { supabase } from "@/integrations/supabase/client";

let sessionId: string | null = null;
function getSessionId() {
  if (sessionId) return sessionId;
  try {
    const k = "yr_driver_sid";
    let s = localStorage.getItem(k);
    if (!s) {
      s = crypto.randomUUID();
      localStorage.setItem(k, s);
    }
    sessionId = s;
    return s;
  } catch {
    return null;
  }
}

export async function trackDriverEvent(
  event_name: string,
  opts: { funnel_stage?: string; metadata?: Record<string, unknown> } = {},
) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from("driver_analytics_events").insert({
      user_id: user?.id ?? null,
      session_id: getSessionId(),
      event_name,
      page_route: typeof window !== "undefined" ? window.location.pathname : null,
      funnel_stage: opts.funnel_stage ?? null,
      metadata: (opts.metadata ?? {}) as never,
    });
  } catch {
    // analytics failures must never break UX
  }
}
