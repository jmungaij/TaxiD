/**
 * Non-sensitive auth presence cookie.
 *
 * The Supabase session lives in localStorage, which a server cannot read. To let
 * the server-side charter portal guard (server/charterPortalGuard.ts) redirect
 * signed-out requests before the app boots, the client mirrors a boolean
 * "someone is signed in" flag into a cookie. It contains NO token, user id, or
 * any other identifying data.
 */
export const AUTH_PRESENCE_COOKIE = "yalla_auth";

export function setAuthPresence(present: boolean): void {
  if (typeof document === "undefined") return;
  try {
    document.cookie = present
      ? `${AUTH_PRESENCE_COOKIE}=1; Path=/; Max-Age=86400; SameSite=Lax`
      : `${AUTH_PRESENCE_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
  } catch {
    /* cookies unavailable (private mode / SSR) — client guard still applies */
  }
}
