/**
 * Shared charter portal route resolver.
 *
 * Every charter-flow entry point (images, cards, buttons, links, guards, and the
 * server-side middleware) must compute its post-login destination through this
 * module so signed-out visitors always land on the CORPORATE login portal —
 * never the admin `/auth` portal.
 *
 * Rules:
 * - Targets are normalised to an app-relative path (leading slash, query AND
 *   hash fragment preserved so deep-linked wizard state survives login).
 * - Absolute/external URLs are rejected and fall back to the portal home.
 * - Entry points may tag themselves with a `source` so analytics can record
 *   which charter UI element initiated the login redirect.
 */

export const CORPORATE_LOGIN_PATH = "/corporate/login";
export const CHARTER_PORTAL_PATH = "/dashboard/charter/portal";
/** Corporate-entitlement upgrade / blocked screen for signed-in users. */
export const CORPORATE_ACCESS_REQUIRED_PATH = "/corporate/access-required";

/** Path prefixes that require a corporate session (client + server guard). */
export const CHARTER_GUARDED_PREFIXES = [
  "/dashboard/charter",
  "/dashboard/corporate-charter",
] as const;

/** Normalise any charter target into a safe, app-relative path + query + hash. */
export function normalizePortalTarget(target?: string | null): string {
  const raw = (target ?? "").trim();
  if (!raw) return CHARTER_PORTAL_PATH;
  // Reject protocol-relative and absolute URLs (open-redirect protection).
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("//")) return CHARTER_PORTAL_PATH;
  const path = raw.startsWith("/") ? raw : `/${raw}`;
  return path;
}

/** Split a normalised target into its path, search and hash parts. */
export function splitPortalTarget(target?: string | null): {
  pathname: string;
  search: string;
  hash: string;
} {
  const full = normalizePortalTarget(target);
  const hashIdx = full.indexOf("#");
  const hash = hashIdx >= 0 ? full.slice(hashIdx) : "";
  const withoutHash = hashIdx >= 0 ? full.slice(0, hashIdx) : full;
  const qIdx = withoutHash.indexOf("?");
  return {
    pathname: qIdx >= 0 ? withoutHash.slice(0, qIdx) : withoutHash,
    search: qIdx >= 0 ? withoutHash.slice(qIdx) : "",
    hash,
  };
}

/**
 * Corporate login URL that returns the user to `target` after signing in.
 * `source` identifies the charter UI element that triggered the redirect and is
 * echoed back as `from=` for analytics attribution.
 */
export function corporateLoginHref(target?: string | null, source?: string | null): string {
  const to = normalizePortalTarget(target);
  const from = source ? `&from=${encodeURIComponent(source)}` : "";
  return `${CORPORATE_LOGIN_PATH}?redirect=${encodeURIComponent(to)}${from}`;
}

/**
 * The canonical href for a charter portal entry point.
 * Signed-in users go straight through; signed-out users go to corporate login
 * with the requested portal page (path + query + hash) preserved.
 */
export function portalEntryHref(
  target: string | null | undefined,
  authenticated: boolean,
  source?: string | null,
): string {
  const to = normalizePortalTarget(target);
  return authenticated ? to : corporateLoginHref(to, source);
}

/** Charter planner deep link for a category slug, preserving query + hash. */
export function charterPlannerPath(slug: string, search = "", hash = ""): string {
  const q = search && !search.startsWith("?") ? `?${search}` : search;
  const h = hash && !hash.startsWith("#") ? `#${hash}` : hash;
  return `/dashboard/charter/book/${slug}${q}${h}`;
}

/** True when a path belongs to the charter portal surface. */
export function isCharterPortalPath(path: string): boolean {
  return normalizePortalTarget(path).startsWith("/dashboard/charter");
}

/** True when a request path must be gated behind a corporate session. */
export function isGuardedCharterPath(path: string): boolean {
  const { pathname } = splitPortalTarget(path);
  return CHARTER_GUARDED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

/** Read the post-login destination out of a `/corporate/login?...` URL. */
export function resolvePostLoginTarget(loginSearch: string): string {
  const params = new URLSearchParams(loginSearch.startsWith("?") ? loginSearch.slice(1) : loginSearch);
  return normalizePortalTarget(params.get("redirect"));
}

/** Read the analytics source tag out of a `/corporate/login?...` URL. */
export function resolveLoginSource(loginSearch: string): string | null {
  const params = new URLSearchParams(loginSearch.startsWith("?") ? loginSearch.slice(1) : loginSearch);
  return params.get("from");
}
