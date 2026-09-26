/**
 * Road / ground charter vehicle imagery.
 *
 * Every fleet category now carries a dedicated professional photograph so a
 * quoted or confirmed booking shows the actual vehicle class booked instead of
 * aviation imagery or a generic placeholder.
 */
import economyVan from "@/assets/vehicles/economy-van.jpg";
import executiveVan from "@/assets/vehicles/executive-van.jpg";
import luxuryVan from "@/assets/vehicles/luxury-van.jpg";
import vipSprinter from "@/assets/vehicles/vip-sprinter.jpg";
import shuttleVan from "@/assets/vehicles/shuttle-van.jpg";
import executiveShuttle from "@/assets/vehicles/executive-shuttle.jpg";
import minibus from "@/assets/vehicles/minibus.jpg";
import tourMinibus from "@/assets/vehicles/tour-minibus.jpg";
import executiveCoach from "@/assets/vehicles/executive-coach.jpg";
import doubleDecker from "@/assets/vehicles/double-decker.jpg";
import safariVan from "@/assets/vehicles/safari-van.jpg";
import safariLandCruiser from "@/assets/vehicles/safari-land-cruiser.jpg";
import safariBus from "@/assets/vehicles/safari-bus.jpg";
import schoolBus from "@/assets/vehicles/school-bus.jpg";

/** Keyed by the governed fleet key in `assetPricingProfiles.ROAD_FLEET`. */
export const VEHICLE_IMAGES: Record<string, string> = {
  economy_van_7: economyVan,
  executive_van_8: executiveVan,
  luxury_van_10: luxuryVan,
  vip_sprinter_12: vipSprinter,
  shuttle_14: shuttleVan,
  executive_shuttle_14: executiveShuttle,
  staff_shuttle_18: shuttleVan,
  staff_shuttle_25: executiveShuttle,
  minibus_25: minibus,
  executive_minibus_29: minibus,
  tour_minibus_33: tourMinibus,
  executive_coach_33: executiveCoach,
  executive_coach_49: executiveCoach,
  executive_coach_53: executiveCoach,
  executive_coach_62: executiveCoach,
  double_decker_67: doubleDecker,
  double_decker_vip_72: doubleDecker,
  safari_van_7: safariVan,
  safari_land_cruiser_5: safariLandCruiser,
  safari_bus_25: safariBus,
  school_van_14: shuttleVan,
  school_bus_33: schoolBus,
  school_bus_51: schoolBus,
  school_bus_62: schoolBus,
};

/**
 * Resolves the closest vehicle photograph for a booked asset name / spec.
 * Deterministic keyword match — no network lookup, no placeholder.
 */
export function vehicleImageFor(assetName: string, spec?: string | null): string {
  if (VEHICLE_IMAGES[assetName]) return VEHICLE_IMAGES[assetName];
  const t = `${assetName} ${spec ?? ""}`.toLowerCase();

  if (/(double ?deck|decker)/.test(t)) return doubleDecker;
  if (/school/.test(t)) return /van/.test(t) ? shuttleVan : schoolBus;
  if (/(safari|game drive|tour cruiser)/.test(t)) {
    if (/(land ?cruiser|4x4|prado|jeep)/.test(t)) return safariLandCruiser;
    if (/(bus|coach|25|33)/.test(t)) return safariBus;
    return safariVan;
  }
  if (/(coach|49|53|62|\bbus\b)/.test(t)) return executiveCoach;
  if (/(tour ?minibus|33|28)/.test(t)) return tourMinibus;
  if (/(minibus|matatu|coaster|25|29)/.test(t)) return minibus;
  if (/sprinter|vip/.test(t)) return vipSprinter;
  if (/(shuttle|hiace|14|18)/.test(t)) return /(executive|premier|business)/.test(t) ? executiveShuttle : shuttleVan;
  if (/(luxury|limousine|lexus|alphard)/.test(t)) return luxuryVan;
  if (/(executive|business|premier)/.test(t)) return executiveVan;
  if (/(economy|basic|standard|van)/.test(t)) return economyVan;
  return executiveVan;
}
