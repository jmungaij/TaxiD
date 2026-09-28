/**
 * Rentals & Leasing visual storytelling map.
 *
 * Each rental / leasing surface resolves a category-distinct editorial
 * photograph so the service is recognisable within 2–3 seconds without
 * reading the supporting copy. Images are natural (never brand-tinted) —
 * the Executive Blue identity is carried by the surrounding chrome.
 *
 * Every asset is imported through vite-imagetools `?as=picture`, producing
 * AVIF + WebP + JPEG variants at retina-capable widths. Intrinsic dimensions
 * travel with the picture object, so nothing shifts while loading and no
 * opacity fade, blur-up or gradient is ever applied.
 */
import selfDrive from "@/assets/rentals/self-drive-hero.jpg?w=768;1280;1920;2560&format=avif;webp;jpg&as=picture";
import chauffeur from "@/assets/rentals/chauffeur-hero.jpg?w=768;1280;1920;2560&format=avif;webp;jpg&as=picture";
import corporateLeasing from "@/assets/rentals/corporate-leasing-hero.jpg?w=768;1280;1920;2560&format=avif;webp;jpg&as=picture";
import marketplace from "@/assets/rentals/marketplace-hero.jpg?w=768;1280;1920;2560&format=avif;webp;jpg&as=picture";
import busCoach from "@/assets/vehicles/executive-coach.jpg?w=768;1280;1920;2560&format=avif;webp;jpg&as=picture";
import rentalsHub from "@/assets/rentals.jpg?w=768;1280;1920;2560&format=avif;webp;jpg&as=picture";

import catEconomy from "@/assets/rentals/cat-economy.jpg?w=320;480;640;960&format=avif;webp;jpg&as=picture";
import catExecutive from "@/assets/rentals/cat-executive.jpg?w=320;480;640;960&format=avif;webp;jpg&as=picture";
import catLuxury from "@/assets/rentals/cat-luxury.jpg?w=320;480;640;960&format=avif;webp;jpg&as=picture";
import catSuv from "@/assets/rentals/cat-suv.jpg?w=320;480;640;960&format=avif;webp;jpg&as=picture";
import catVan from "@/assets/vehicles/executive-van.jpg?w=320;480;640;960&format=avif;webp;jpg&as=picture";

import type { PictureSet } from "@/components/marketing/ResponsiveImage";

export interface RentalImage {
  picture: PictureSet;
  alt: string;
}

/** Hero images span the viewport; category cards sit in a 5-up grid. */
export const RENTAL_HERO_SIZES = "100vw";
export const RENTAL_CATEGORY_SIZES =
  "(min-width: 1024px) 20vw, (min-width: 640px) 50vw, 100vw";

/** Keyed by marketing route pathname. */
export const RENTAL_HERO_IMAGES: Record<string, RentalImage> = {
  "/rentals": {
    picture: rentalsHub,
    alt: "Premium TaxiD rental fleet lined up on a depot forecourt",
  },
  "/rentals/self-drive": {
    picture: selfDrive,
    alt: "TaxiD agent handing keys to a professional collecting a self-drive rental car",
  },
  "/rentals/chauffeur": {
    picture: chauffeur,
    alt: "Uniformed chauffeur opening the door of an executive sedan for a business traveller",
  },
  "/rentals/bus-coach": {
    picture: busCoach,
    alt: "Executive coach ready for corporate group and staff transport",
  },
  "/rentals/corporate-leasing": {
    picture: corporateLeasing,
    alt: "Fleet manager inspecting a row of leased corporate vehicles at a depot",
  },
  "/rentals/marketplace": {
    picture: marketplace,
    alt: "Fleet owners agreeing terms in front of a mixed commercial vehicle fleet",
  },
};

/** Keyed by the rental tier label rendered on /rentals. */
export const RENTAL_CATEGORY_IMAGES: Record<string, RentalImage> = {
  Economy: { picture: catEconomy, alt: "Economy hatchback rental car on a city forecourt" },
  Executive: { picture: catExecutive, alt: "Executive business sedan outside a corporate headquarters" },
  Luxury: { picture: catLuxury, alt: "Luxury flagship sedan at a five-star hotel portico" },
  SUVs: { picture: catSuv, alt: "Premium SUV loaded for an out-of-town journey on an open highway" },
  Vans: { picture: catVan, alt: "Executive passenger van for group and staff transfers" },
};

export function rentalHeroImage(pathname: string): RentalImage | undefined {
  return RENTAL_HERO_IMAGES[pathname];
}
