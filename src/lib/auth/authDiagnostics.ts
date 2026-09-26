/**
 * AUTH-GATE DIAGNOSTICS.
 *
 * When the application sends a user to a sign-in surface, the system must know
 * exactly why. Every redirect emits a canonical, environment-aware diagnostic
 * event and preserves the originally requested route so the user lands back
 * where they intended after authenticating.
 *
 * Identifiers are stored as opaque hashes. Tokens, cookies and secrets are
 * never captured.
 */
import { buildManifest } from "@/lib/runtime/buildManifest";
import { hashRef, newCorrelationId, recordDiagnostic } from "@/lib/runtime/diagnostics";

export type AuthRedirectReason =
  | "NO_SESSION"
  | "SESSION_EXPIRED"
  | "TOKEN_EXPIRED"
  | "TOKEN_REFRESH_FAILED"
  | "AUTH_PROVIDER_ERROR"
  | "USER_DISABLED"
  | "TENANT_INACTIVE"
  | "ROLE_REQUIRED"
  | "PERMISSION_REQUIRED"
  | "SESSION_INVALID"
  | "AUTH_CONFIGURATION_ERROR";

/** Customer-safe copy per reason. Never leaks internal state. */
export const AUTH_REASON_COPY: Record<AuthRedirectReason, string> = {
  NO_SESSION: "Please sign in to continue.",
  SESSION_EXPIRED: "Your session has expired. Please sign in again.",
  TOKEN_EXPIRED: "Your session has expired. Please sign in again.",
  TOKEN_REFRESH_FAILED: "We could not renew your session. Please sign in again.",
  AUTH_PROVIDER_ERROR: "Sign-in is temporarily unavailable. Please try again shortly.",
  USER_DISABLED: "This account is not active. Contact your administrator.",
  TENANT_INACTIVE: "Your organisation's account is not active. Contact your administrator.",
  ROLE_REQUIRED: "You do not have access to this area.",
  PERMISSION_REQUIRED: "You do not have permission for this area.",
  SESSION_INVALID: "Your sign-in could not be verified. Please sign in again.",
  AUTH_CONFIGURATION_ERROR: "Sign-in is misconfigured. Our team has been notified.",
};

/** Authentication failures go to sign-in; authorization failures never do. */
export const AUTHORIZATION_REASONS: AuthRedirectReason[] = [
  "ROLE_REQUIRED",
  "PERMISSION_REQUIRED",
  "TENANT_INACTIVE",
  "USER_DISABLED",
];

export interface AuthDiagnosticInput {
  route: string;
  requestedRoute: string;
  reason: AuthRedirectReason;
  redirectDestination: string;
  sessionExists: boolean;
  tokenPresent?: boolean;
  tokenExpired?: boolean;
  refreshAttempted?: boolean;
  refreshResult?: "SUCCESS" | "FAILED" | "NOT_ATTEMPTED";
  userId?: string | null;
  sessionId?: string | null;
  tenantId?: string | null;
  requiredRole?: string[];
  actualRole?: string[];
  correlationId?: string;
}

export interface AuthDiagnosticEvent extends Record<string, unknown> {
  event_id: string;
  timestamp: string;
  environment: string;
  route: string;
  requested_route: string;
  session_exists: boolean;
  session_id_hash: string | null;
  user_id_hash: string | null;
  tenant_id_hash: string | null;
  token_present: boolean;
  token_expired: boolean;
  refresh_attempted: boolean;
  refresh_result: string;
  authentication_state: "AUTHENTICATED" | "UNAUTHENTICATED";
  authorization_state: "GRANTED" | "DENIED" | "NOT_EVALUATED";
  required_role: string[];
  actual_role: string[];
  redirect_reason: AuthRedirectReason;
  redirect_destination: string;
  correlation_id: string;
  request_id: string;
}

const RETURN_PATH_KEY = "yalla.auth.returnPath";
const REASON_KEY = "yalla.auth.redirectReason";

/** Records the diagnostic and preserves the requested route for post-login return. */
export function recordAuthRedirect(input: AuthDiagnosticInput): AuthDiagnosticEvent {
  const correlationId = input.correlationId ?? newCorrelationId();
  const isAuthorizationFailure = AUTHORIZATION_REASONS.includes(input.reason);
  const event: AuthDiagnosticEvent = {
    event_id: newCorrelationId(),
    timestamp: new Date().toISOString(),
    environment: buildManifest().environment,
    route: input.route,
    requested_route: input.requestedRoute,
    session_exists: input.sessionExists,
    session_id_hash: hashRef(input.sessionId ?? null),
    user_id_hash: hashRef(input.userId ?? null),
    tenant_id_hash: hashRef(input.tenantId ?? null),
    token_present: input.tokenPresent ?? input.sessionExists,
    token_expired: input.tokenExpired ?? false,
    refresh_attempted: input.refreshAttempted ?? false,
    refresh_result: input.refreshResult ?? "NOT_ATTEMPTED",
    authentication_state: input.sessionExists ? "AUTHENTICATED" : "UNAUTHENTICATED",
    authorization_state: isAuthorizationFailure ? "DENIED" : "NOT_EVALUATED",
    required_role: input.requiredRole ?? [],
    actual_role: input.actualRole ?? [],
    redirect_reason: input.reason,
    redirect_destination: input.redirectDestination,
    correlation_id: correlationId,
    request_id: correlationId,
  };

  rememberReturnPath(input.requestedRoute, input.reason);

  recordDiagnostic({
    category: "AUTH",
    severity: isAuthorizationFailure ? "WARNING" : "INFO",
    operation: "auth_redirect",
    message: `${input.reason} → ${input.requestedRoute} → ${input.redirectDestination}`,
    route: input.route,
    correlationId,
    userRef: hashRef(input.userId ?? null),
    tenantRef: hashRef(input.tenantId ?? null),
    errorCode: input.reason,
    metadata: event,
    persist: true,
  });

  return event;
}

export function rememberReturnPath(path: string, reason: AuthRedirectReason): void {
  try {
    sessionStorage.setItem(RETURN_PATH_KEY, path);
    sessionStorage.setItem(REASON_KEY, reason);
  } catch {
    /* private mode — the ?redirect query param remains the fallback */
  }
}

export function consumeReturnPath(): { path: string | null; reason: AuthRedirectReason | null } {
  try {
    const path = sessionStorage.getItem(RETURN_PATH_KEY);
    const reason = sessionStorage.getItem(REASON_KEY) as AuthRedirectReason | null;
    sessionStorage.removeItem(RETURN_PATH_KEY);
    sessionStorage.removeItem(REASON_KEY);
    return { path, reason };
  } catch {
    return { path: null, reason: null };
  }
}

/** Builds the sign-in URL while preserving the requested path and the reason. */
export function signInUrl(requestedPath: string, reason: AuthRedirectReason, base = "/auth"): string {
  const params = new URLSearchParams({ redirect: requestedPath, reason });
  return `${base}?${params.toString()}`;
}
