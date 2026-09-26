import { useMemo } from "react";
import type { PictureSet } from "@/components/marketing/ResponsiveImage";

const FORMAT_ORDER = ["avif", "webp", "jpeg", "jpg", "png"];
const PRELOAD_ATTR = "data-hero-preload";

/**
 * Injects `<link rel="preload" as="image">` for the LCP hero photograph as
 * early as the SPA can — during render, before React commits the <picture>
 * element — so the browser starts the fetch in the same task instead of
 * waiting for layout. Matches the same srcset/sizes the <picture> resolves,
 * so no extra byte is downloaded.
 *
 * A single link element is kept in <head>; navigating to another hero swaps
 * the href rather than accumulating stale preloads (which Chrome warns about).
 */
export function useHeroImagePreload(picture?: PictureSet, sizes = "100vw") {
  useMemo(() => {
    if (typeof document === "undefined" || !picture) return;

    const formats = Object.keys(picture.sources).sort(
      (a, b) => FORMAT_ORDER.indexOf(a) - FORMAT_ORDER.indexOf(b),
    );
    const best = formats[0];
    if (!best) return;

    const existing = document.head.querySelector<HTMLLinkElement>(`link[${PRELOAD_ATTR}]`);
    const link = existing ?? document.createElement("link");
    link.setAttribute(PRELOAD_ATTR, "");
    link.rel = "preload";
    link.as = "image";
    link.type = `image/${best === "jpg" ? "jpeg" : best}`;
    link.setAttribute("imagesrcset", picture.sources[best]);
    link.setAttribute("imagesizes", sizes);
    link.setAttribute("fetchpriority", "high");
    link.href = picture.img.src;
    if (!existing) document.head.appendChild(link);
  }, [picture, sizes]);
}
