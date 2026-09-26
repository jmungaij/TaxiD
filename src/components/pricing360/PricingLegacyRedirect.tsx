/**
 * Controlled redirect for legacy Pricing 360 destinations.
 *
 * Deep links are preserved (query + hash carried across) and every redirect is
 * recorded in the Pricing 360 audit stream so the migration is provable.
 */
import { useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { canonicalPricingTarget, PRICING_360_CANONICAL } from "@/lib/pricing360/legacyRoutes";
import { logPricingAction } from "@/lib/pricing360/audit";

export function PricingLegacyRedirect() {
  const location = useLocation();
  const target =
    canonicalPricingTarget(location.pathname, location.search, location.hash) ?? PRICING_360_CANONICAL;

  useEffect(() => {
    void logPricingAction({
      action: "redirect",
      entity: "pricing360_route",
      reason: "legacy pricing route consolidated into Commercial & Pricing",
      before: { path: location.pathname + location.search + location.hash },
      after: { path: target },
    });
  }, [location.pathname, location.search, location.hash, target]);

  return <Navigate to={target} replace />;
}

export default PricingLegacyRedirect;
