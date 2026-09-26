/**
 * Bridge between the charter catalogue and the Asset Pricing 360 taxonomy.
 *
 * Booking surfaces know their fleet keys; the pricing authority knows asset
 * categories. This map is the only place the two vocabularies meet, so a new
 * aircraft or vehicle is priced by adding one line here rather than by adding a
 * second pricing rule anywhere in the product.
 */

/** Aircraft/helicopter fleet key → governed `ap360_categories.code`. */
const AIRCRAFT_TO_AP360: Record<string, string> = {
  helicopter: "heli_executive",
  cessna_172: "air_caravan",
  cessna_206: "air_caravan",
  caravan_208b: "air_caravan",
  twin_otter: "air_twin_turboprop",
  king_air_350: "air_kingair",
  light_jet: "air_light_jet",
  midsize_jet: "air_midsize_jet",
  heavy_jet: "air_heavy_jet",
};

/** Returns the governed pricing category for an aircraft key, or null when unmapped. */
export function ap360CategoryForAircraft(key: string | null | undefined): string | null {
  if (!key) return null;
  return AIRCRAFT_TO_AP360[key] ?? null;
}
