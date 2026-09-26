/**
 * SIGN-IN METHOD RESOLUTION.
 *
 * Two authorities decide what the sign-in screen may offer:
 *   1. the auth server's actual configuration (what physically works), and
 *   2. the sign-in policy that applies to the address's organisation.
 *
 * The effective set is the intersection. A method the server does not provide is
 * never offered even if a policy allows it, and a method a policy forbids is
 * never offered even if the server provides it. Both sides fail closed.
 *
 * This module is pure: it makes no requests and holds no state, so it can be
 * reasoned about and tested directly.
 */
import type { AuthMethods } from "@/lib/auth/methodAvailability";
import type { DiscoveredPolicy } from "@/lib/identity/plane";

export interface EffectiveMethods {
  password: boolean;
  emailLink: boolean;
  google: boolean;
  sso: boolean;
  ssoProvider: string | null;
  /** True when an organisation policy (not the platform default) applied. */
  organisationPolicy: boolean;
  policyLabel: string | null;
  mfaRequired: boolean;
  /** Methods the policy allows but the server cannot deliver. */
  unavailable: string[];
  /** Set when the address's lookups were refused. */
  rateLimited: boolean;
}

const LABEL: Record<string, string> = {
  password: "password sign-in",
  emailLink: "email sign-in link",
  google: "Google sign-in",
  sso: "organisation sign-in",
};

/**
 * @param server what the auth server reports as configured
 * @param policy the discovered sign-in policy, or null before discovery runs
 */
export function resolveMethods(
  server: AuthMethods,
  policy: DiscoveredPolicy | null,
): EffectiveMethods {
  if (!policy || policy.outcome !== "OK") {
    return {
      password: server.password,
      emailLink: server.emailLink,
      google: server.google,
      sso: false,
      ssoProvider: null,
      organisationPolicy: false,
      policyLabel: null,
      mfaRequired: false,
      unavailable: [],
      rateLimited: policy?.outcome === "RATE_LIMITED",
    };
  }

  const pairs: [keyof typeof LABEL, boolean, boolean][] = [
    ["password", policy.password, server.password],
    ["emailLink", policy.passwordless, server.emailLink],
    ["google", policy.google, server.google],
    ["sso", policy.sso, server.sso],
  ];

  const unavailable = pairs
    .filter(([, allowed, provided]) => allowed && !provided)
    .map(([key]) => LABEL[key]);

  return {
    password: policy.password && server.password,
    emailLink: policy.passwordless && server.emailLink,
    google: policy.google && server.google,
    sso: policy.sso && server.sso,
    ssoProvider: policy.sso ? policy.sso_provider : null,
    organisationPolicy: policy.scope === "ORGANISATION",
    policyLabel: policy.policy_label,
    mfaRequired: policy.mfa_required,
    unavailable,
    rateLimited: false,
  };
}
