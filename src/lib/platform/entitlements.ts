/**
 * Platform tier entitlements — Elite Premium gating.
 *
 * Tiers are derived from the roles granted to the signed-in user in
 * `user_roles` (never from client storage), so a tampered localStorage value
 * cannot unlock a premium surface. This module is the single source of truth
 * for which dashboard paths require which tier; the sidebar, the route guard
 * and the tier dashboard all read from it.
 *
 * NOTE: this is presentation-level gating. The authoritative boundary remains
 * RLS + SECURITY DEFINER RPCs, which re-check the caller server-side.
 */

export type PlatformTier = "standard" | "premium" | "elite";

export const TIER_RANK: Record<PlatformTier, number> = {
  standard: 0,
  premium: 1,
  elite: 2,
};

export const TIER_LABEL: Record<PlatformTier, string> = {
  standard: "Standard",
  premium: "Premium",
  elite: "Elite Premium",
};

export const TIER_BLURB: Record<PlatformTier, string> = {
  standard: "Core booking, wallet and reporting surfaces.",
  premium: "Enterprise procurement, approval chains and settlement controls.",
  elite: "Full governance: tier cockpit, operations centre, pricing authority.",
};

/** Roles that carry the Elite Premium entitlement. */
export const ELITE_ROLES = [
  "super_admin",
  "admin",
  "finance_admin",
  "compliance_admin",
  "corporate_admin",
] as const;

/** Roles that carry the Premium entitlement. */
export const PREMIUM_ROLES = [
  "operations_admin",
  "operations_manager",
  "pricing_manager",
  "fleet_manager",
  "charter_operator",
  "corporate_finance",
  "corporate_approver",
  "corporate_manager",
  "approving_officer",
] as const;

/** Highest tier implied by the granted role set. */
export function tierFromRoles(roles: readonly string[] | undefined): PlatformTier {
  const set = new Set(roles ?? []);
  if ((ELITE_ROLES as readonly string[]).some((r) => set.has(r))) return "elite";
  if ((PREMIUM_ROLES as readonly string[]).some((r) => set.has(r))) return "premium";
  return "standard";
}

export const meetsTier = (userTier: PlatformTier, required: PlatformTier) =>
  TIER_RANK[userTier] >= TIER_RANK[required];

/**
 * Paths (or path prefixes) that require a tier above `standard`.
 * Longest match wins so a child can be stricter than its parent.
 */
export const TIER_GATED_PATHS: Array<{ prefix: string; tier: PlatformTier; reason: string }> = [
  { prefix: "/dashboard/premium", tier: "elite", reason: "Elite Premium tier cockpit" },
  { prefix: "/dashboard/admin/ccb-operations", tier: "elite", reason: "Corporate Charter Business Operations Centre" },
  { prefix: "/dashboard/corporate-charter", tier: "premium", reason: "Corporate Charter Business workspace" },
  { prefix: "/dashboard/charter/portal", tier: "premium", reason: "Charter commercial desk" },
  { prefix: "/dashboard/admin/asset-pricing", tier: "premium", reason: "Pricing authority" },
  { prefix: "/dashboard/admin/smartfare", tier: "premium", reason: "SmartFare governance" },
];

/** Tier required to open a path — `standard` when the path is not gated. */
export function requiredTierFor(path: string): PlatformTier {
  const clean = path.split("?")[0];
  let best: { prefix: string; tier: PlatformTier } | null = null;
  for (const entry of TIER_GATED_PATHS) {
    if (clean === entry.prefix || clean.startsWith(`${entry.prefix}/`)) {
      if (!best || entry.prefix.length > best.prefix.length) best = entry;
    }
  }
  return best?.tier ?? "standard";
}

export function gateReasonFor(path: string): string | null {
  const clean = path.split("?")[0];
  const hit = TIER_GATED_PATHS.filter((e) => clean === e.prefix || clean.startsWith(`${e.prefix}/`))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0];
  return hit?.reason ?? null;
}

/** Entitlement check used by the sidebar and the RequireTier guard. */
export function isEntitled(path: string, tier: PlatformTier): boolean {
  return meetsTier(tier, requiredTierFor(path));
}

export interface Entitlements {
  tier: PlatformTier;
  label: string;
  blurb: string;
  isPremium: boolean;
  isElite: boolean;
  can: (path: string) => boolean;
  requiredTierFor: (path: string) => PlatformTier;
}

export function entitlementsFromRoles(roles: readonly string[] | undefined): Entitlements {
  const tier = tierFromRoles(roles);
  return {
    tier,
    label: TIER_LABEL[tier],
    blurb: TIER_BLURB[tier],
    isPremium: meetsTier(tier, "premium"),
    isElite: tier === "elite",
    can: (path: string) => isEntitled(path, tier),
    requiredTierFor,
  };
}
