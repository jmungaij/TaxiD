/**
 * Pricing 360 legacy route consolidation.
 *
 * One feature → one owner → one canonical location. Every historical pricing
 * destination now resolves to Admin → Commercial & Pricing → Pricing 360, on the
 * tab that owns the capability the legacy path used to render. Deep links keep
 * working: existing query parameters and hashes are carried across untouched and
 * only the `tab` parameter is (re)stamped.
 */
export const PRICING_360_CANONICAL = "/dashboard/admin/pricing-360";

/** Legacy path → canonical Pricing 360 tab that now owns that capability. */
export const LEGACY_PRICING_ROUTES: Record<string, string> = {
  "/dashboard/admin/pricing": "overview",
  "/dashboard/admin/pricing360": "overview",
  "/dashboard/admin/pricing-control": "overview",
  "/dashboard/admin/pricing-control-center": "overview",
  "/dashboard/admin/pricing-command-center": "overview",
  "/dashboard/admin/asset-pricing": "asset-bands",
  "/dashboard/admin/asset-pricing-profiles": "asset-bands",
  "/dashboard/admin/pricing-rules": "rules",
  "/dashboard/admin/rate-cards": "rates",
  "/dashboard/admin/pricing-audit": "audit",
  "/dashboard/admin/pricing-health": "health",
  "/dashboard/admin/pricing-simulator": "simulator",
};

/**
 * Builds the canonical destination for a legacy pricing URL, preserving every
 * other query parameter and the hash so shared deep links survive the move.
 */
export function canonicalPricingTarget(pathname: string, search = "", hash = ""): string | null {
  const key = pathname.replace(/\/+$/, "") || pathname;
  const tab = LEGACY_PRICING_ROUTES[key];
  if (!tab) return null;
  const params = new URLSearchParams(search);
  if (!params.get("tab")) params.set("tab", tab);
  const qs = params.toString();
  return `${PRICING_360_CANONICAL}${qs ? `?${qs}` : ""}${hash ?? ""}`;
}
