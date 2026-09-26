/**
 * Pricing governance — single source of truth for *which* charter categories
 * are priced by the published `charter_pricing_config` version.
 *
 * Only aviation categories consume the published pricing configuration. Bus,
 * marine and heavy-machinery charters are priced from the static catalog, so
 * they must never be subjected to the `pricing_version_stale` guard (doing so
 * takes those categories offline the moment an admin publishes a new version).
 *
 * The edge function mirrors this list in
 * `supabase/functions/_shared/charter-pricing-governance.ts`; a parity test
 * keeps the two in lockstep.
 */

/** Categories governed by the published aviation pricing configuration. */
export const AVIATION_PRICED_SLUGS = ["aircraft-charter", "aircraft-leasing"] as const;

export type AviationPricedSlug = (typeof AVIATION_PRICED_SLUGS)[number];

/** True when the slug must wait for (and echo back) a published pricing version. */
export function requiresPublishedPricing(slug: string | null | undefined): boolean {
  return !!slug && (AVIATION_PRICED_SLUGS as readonly string[]).includes(slug);
}

export interface PricingVersionVerdict {
  /** Whether the quote must be rejected with `pricing_version_stale`. */
  stale: boolean;
  /** Version that should be persisted on the quote row. */
  effectiveVersion: number;
  /** Whether the staleness guard applies to this slug at all. */
  governed: boolean;
}

/**
 * Decides whether a quote submission is stale.
 * Non-governed slugs are *never* stale, whatever version they echo back.
 */
export function evaluatePricingVersion(input: {
  slug: string | null | undefined;
  quotedVersion: number | null | undefined;
  activeVersion: number | null | undefined;
}): PricingVersionVerdict {
  const governed = requiresPublishedPricing(input.slug);
  const active = Math.round(Number(input.activeVersion ?? 0)) || 0;
  const quoted = Math.round(Number(input.quotedVersion ?? 0)) || 0;
  if (!governed) return { stale: false, effectiveVersion: quoted, governed: false };
  return { stale: quoted !== active, effectiveVersion: active, governed: true };
}
