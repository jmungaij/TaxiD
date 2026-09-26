/**
 * Shared aircraft resolution.
 *
 * Marketplace inventory carries free-text asset names ("Cessna Caravan 208B",
 * "Light Jet — Phenom 300"). Pricing and payout both need the canonical
 * aircraft key, and they must resolve it identically or an operator payout
 * would disagree with the customer price. One matcher, used by both.
 */
import { AIRCRAFT_CATEGORIES } from "./aviationPricing";

export function aircraftKeyFor(assetName: string): string {
  const n = (assetName ?? "").toLowerCase();
  const hit = AIRCRAFT_CATEGORIES.find((a) => n.includes(a.label.toLowerCase()));
  if (hit) return hit.key;
  if (n.includes("caravan")) return "caravan_208b";
  if (n.includes("king air")) return "king_air_350";
  if (n.includes("heli")) return "helicopter";
  if (n.includes("heavy")) return "heavy_jet";
  if (n.includes("midsize")) return "midsize_jet";
  if (n.includes("jet")) return "light_jet";
  return AIRCRAFT_CATEGORIES[0]?.key ?? "light_jet";
}
