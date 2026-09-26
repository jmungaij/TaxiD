/**
 * AUTHENTICATION METHOD TRUTH.
 *
 * The sign-in surface must never offer a method the server does not actually
 * provide. This module asks the auth server what is configured and returns the
 * answer; the page renders from that answer only.
 *
 * Fail-closed: if the question cannot be answered we show email + password
 * (always required to sign in) and hide every optional method, rather than
 * advertising something that may not work.
 */

export interface AuthMethods {
  /** Email + password sign-in. */
  password: boolean;
  /** One-time email sign-in link (passwordless). */
  emailLink: boolean;
  /** Google sign-in. */
  google: boolean;
  /** Mobile-number sign-in. */
  phone: boolean;
  /** Organisation single sign-on (SAML). */
  sso: boolean;
  /** Whether new accounts may be created. */
  signupOpen: boolean;
  /** True when the answer came from the auth server rather than the fallback. */
  resolved: boolean;
}

export const FAIL_CLOSED: AuthMethods = {
  password: true,
  emailLink: false,
  google: false,
  phone: false,
  sso: false,
  signupOpen: false,
  resolved: false,
};

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

let cached: Promise<AuthMethods> | null = null;

/** Shape of the auth server's public settings document (subset we rely on). */
interface AuthSettings {
  external?: Record<string, boolean>;
  disable_signup?: boolean;
  saml_enabled?: boolean;
}

export function methodsFromSettings(s: AuthSettings | null | undefined): AuthMethods {
  if (!s || !s.external) return FAIL_CLOSED;
  const email = s.external.email === true;
  return {
    password: email,
    emailLink: email,
    google: s.external.google === true,
    phone: s.external.phone === true,
    sso: s.saml_enabled === true,
    signupOpen: s.disable_signup !== true,
    resolved: true,
  };
}

/** Resolves the configured methods once per page load. */
export function loadAuthMethods(): Promise<AuthMethods> {
  if (cached) return cached;
  if (!url || !key) return Promise.resolve(FAIL_CLOSED);
  cached = fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } })
    .then((r) => (r.ok ? (r.json() as Promise<AuthSettings>) : null))
    .then(methodsFromSettings)
    .catch(() => FAIL_CLOSED);
  return cached;
}
