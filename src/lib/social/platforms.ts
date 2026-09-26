/**
 * SOCIAL DISTRIBUTION — PLATFORM CONTRACT (client mirror)
 * ------------------------------------------------------
 * The authoritative platform register, lifecycle state machine and hostname
 * allowlist live in Postgres (`social_platforms`, `social_transition_allowed`,
 * `social_validate_url`). This module mirrors ONLY what the browser needs:
 * icon mapping, the same validation rules for optimistic form feedback, and
 * the state machine for admin UI affordances.
 *
 * Never hard-code a profile URL here. Destinations are supplied and verified by
 * authorised administrators and stored in `social_accounts`.
 */

export type SocialPlatformSlug =
  | "linkedin" | "facebook" | "instagram" | "youtube" | "tiktok" | "x" | "whatsapp";

export type SocialStatus =
  | "DRAFT" | "PENDING_VERIFICATION" | "VERIFIED" | "APPROVED" | "ACTIVE" | "SUSPENDED" | "ARCHIVED";

export type SocialVerification = "UNVERIFIED" | "VERIFIED";

export type SocialHealthState =
  | "HEALTHY" | "REDIRECTED" | "UNREACHABLE" | "INVALID" | "SUSPENDED" | "PENDING_REVIEW";

/** Hostname allowlist — mirrors public.social_platforms.hostnames byte-for-byte. */
export const PLATFORM_HOSTNAMES: Record<SocialPlatformSlug, string[]> = {
  linkedin: ["linkedin.com", "www.linkedin.com"],
  facebook: ["facebook.com", "www.facebook.com", "fb.com", "web.facebook.com"],
  instagram: ["instagram.com", "www.instagram.com"],
  youtube: ["youtube.com", "www.youtube.com", "m.youtube.com"],
  tiktok: ["tiktok.com", "www.tiktok.com"],
  x: ["x.com", "www.x.com", "twitter.com", "www.twitter.com"],
  whatsapp: ["wa.me", "api.whatsapp.com", "web.whatsapp.com", "whatsapp.com"],
};

/** Channel intent — WhatsApp is a conversation/conversion channel, not a profile. */
export const PLATFORM_KIND: Record<SocialPlatformSlug, "PROFILE" | "CONVERSATION"> = {
  linkedin: "PROFILE", facebook: "PROFILE", instagram: "PROFILE", youtube: "PROFILE",
  tiktok: "PROFILE", x: "PROFILE", whatsapp: "CONVERSATION",
};

/**
 * Destination validation. Rejects anything that is not an https URL on an
 * approved platform hostname — the browser-side guard against injected,
 * phishing or protocol-abusing destinations (javascript:, data:, http:).
 */
export function isApprovedSocialUrl(platform: string, url: string | null | undefined): boolean {
  if (!url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (parsed.username || parsed.password) return false;
  const allowed = PLATFORM_HOSTNAMES[platform as SocialPlatformSlug];
  if (!allowed) return false;
  return allowed.includes(parsed.hostname.toLowerCase());
}

/** Lifecycle graph — mirrors public.social_transition_allowed. */
const TRANSITIONS: Record<SocialStatus, SocialStatus[]> = {
  DRAFT: ["PENDING_VERIFICATION", "ARCHIVED"],
  PENDING_VERIFICATION: ["PENDING_VERIFICATION", "VERIFIED", "DRAFT"],
  VERIFIED: ["APPROVED", "PENDING_VERIFICATION"],
  APPROVED: ["ACTIVE", "PENDING_VERIFICATION"],
  ACTIVE: ["SUSPENDED", "PENDING_VERIFICATION"],
  SUSPENDED: ["ACTIVE", "ARCHIVED"],
  ARCHIVED: ["DRAFT"],
};

export function canTransition(from: SocialStatus, to: SocialStatus): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

export const LIFECYCLE_ORDER: SocialStatus[] = [
  "DRAFT", "PENDING_VERIFICATION", "VERIFIED", "APPROVED", "ACTIVE", "SUSPENDED", "ARCHIVED",
];

/**
 * THE PUBLICATION GATE.
 *
 * A destination may only become a clickable public link when it is verified,
 * approved-and-active, marked public and holds an approved https destination.
 * The database enforces the same predicate through RLS; this is defence in
 * depth so a rendering bug can never publish an unverified account.
 */
export interface PublishableAccount {
  status: SocialStatus;
  verification_status: SocialVerification;
  is_public: boolean;
  is_active: boolean;
  profile_url: string | null;
  platform_slug: string;
}

export function isPubliclyLinkable(a: PublishableAccount): boolean {
  return (
    a.status === "ACTIVE" &&
    a.verification_status === "VERIFIED" &&
    a.is_public === true &&
    a.is_active === true &&
    isApprovedSocialUrl(a.platform_slug, a.profile_url)
  );
}
