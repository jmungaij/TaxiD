/**
 * PUBLIC SECURITY CLAIM REGISTER.
 *
 * Every security or compliance statement shown to a visitor is declared here
 * with the control that backs it and the evidence that proves the control runs.
 * A claim with no evidence is NOT displayed — the page reads this register, so
 * marketing wording can never outrun the implementation.
 *
 * Certification and audit claims (SOC 2, ISO 27001) stay non-displayable until
 * an actual audit report exists; alignment wording is not a certification.
 */

export interface PublicSecurityClaim {
  id: string;
  /** Exact customer-facing wording, or null when nothing may be shown. */
  wording: string | null;
  /** What is actually built. */
  implementation: string;
  /** Where the proof lives. Empty string means none exists. */
  evidence: string;
  /** Only true when implementation AND evidence exist and the wording is accurate. */
  safeToDisplay: boolean;
  /** Why a claim is withheld, for the internal register. */
  withheldReason?: string;
}

export const PUBLIC_SECURITY_CLAIMS: readonly PublicSecurityClaim[] = [
  {
    id: "sign_in_activity_recorded",
    wording: "Sign-in activity is recorded on your account",
    implementation:
      "Every sign-in, failed sign-in and passwordless request is written server-side to the authentication event log (recordLoginEvent → login telemetry, authentication_events).",
    evidence: "authentication_events / admin_login_events rows written on each attempt; append-only enforcement in the database.",
    safeToDisplay: true,
  },
  {
    id: "session_protection",
    wording: "Protected sessions with sign-out on every device",
    implementation:
      "Sessions are issued and refreshed by the managed auth service; sign-out revokes the local session and global sign-out revokes all of them.",
    evidence: "Supabase-managed session issuance/refresh/revocation used by the app's auth client.",
    safeToDisplay: true,
  },
  {
    id: "server_side_authorisation",
    wording: "Your access is decided on our servers, never in your browser",
    implementation:
      "Roles live in user_roles and are checked by has_role / has_staff_permission inside database policies and privileged routines; the client cannot widen them.",
    evidence: "Row-level security policies and the role-helper contract gate (rls-helper-gate, execute-grant-gate) run in CI.",
    safeToDisplay: true,
  },
  {
    id: "device_recognition",
    wording: null,
    implementation:
      "Device fingerprints and risk scores exist for administrator sign-ins; personal columns are readable only by the owner, scoring only by admins.",
    evidence: "device_fingerprints table with owner-scoped read policy; risk scoring on admin logins.",
    safeToDisplay: false,
    withheldReason:
      "Applies to administrator sign-ins only, so it cannot be stated as a general customer promise. Detail belongs in the authenticated security area.",
  },
  {
    id: "forensic_audit_logging",
    wording: null,
    implementation:
      "Hash-chained audit records exist for administrator logins and document custody, not for all customer activity.",
    evidence: "audit_hash_chain / admin_login_events chains.",
    safeToDisplay: false,
    withheldReason:
      "\"Forensic\" implies tamper-evident coverage of all activity with a defined retention and access policy. Coverage and retention are not established for customer accounts.",
  },
  {
    id: "mfa",
    wording: null,
    implementation: "Multi-factor devices are registered for administrators (admin_mfa_devices, backup codes).",
    evidence: "admin_mfa_devices, admin_backup_codes.",
    safeToDisplay: false,
    withheldReason: "Not available to ordinary customers, so it must not be promised on the public sign-in page.",
  },
  {
    id: "organisation_sso",
    wording: null,
    implementation: "No organisation single sign-on connection is configured on the auth server.",
    evidence: "",
    safeToDisplay: false,
    withheldReason: "SAML is disabled on the auth server. The option is hidden until a connection exists.",
  },
  {
    id: "soc2",
    wording: null,
    implementation: "No SOC 2 examination has been performed.",
    evidence: "",
    safeToDisplay: false,
    withheldReason: "No audit report exists. \"Aligned\" wording still reads as certification and is removed.",
  },
  {
    id: "iso_27001",
    wording: null,
    implementation: "No ISO/IEC 27001 certification has been obtained.",
    evidence: "",
    safeToDisplay: false,
    withheldReason: "No certificate and no certification body engagement exists.",
  },
] as const;

/** The only statements the sign-in page may render. */
export const DISPLAYABLE_SECURITY_CLAIMS = PUBLIC_SECURITY_CLAIMS.filter(
  (c) => c.safeToDisplay && c.wording,
).map((c) => ({ id: c.id, wording: c.wording as string }));

/** Short trust line assembled from displayable claims only. */
export const TRUST_LINE = "Secure authentication · Account and session protection";
