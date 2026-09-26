/**
 * Canonical SAFARID app store destinations.
 *
 * Rules enforced here (so no CTA can regress to a generic store homepage):
 *  1. Android links are always built from the real package id.
 *  2. iOS links are only built when a real numeric App Store id is configured.
 *     When it is missing we fall back to a branded on-site landing page
 *     instead of Apple's generic /app-store/ marketing page.
 *  3. Every outbound link carries UTM parameters describing the placement so
 *     installs can be attributed (header vs mega-menu, rider vs driver).
 */

export type AppAudience = "rider" | "driver";
export type AppPlatform = "android" | "ios";

/** Google Play package ids — verified SAFARID listings. */
const PLAY_PACKAGE_IDS: Record<AppAudience, string> = {
  rider: "com.safariride.rider",
  driver: "com.safariride.driver",
};

/**
 * Apple App Store numeric ids. Leave as `null` until the real id is known —
 * a placeholder id (e.g. id000000000) resolves to an Apple error page, so the
 * fallback below is always safer.
 */
const APP_STORE_IDS: Record<AppAudience, string | null> = {
  rider: null,
  driver: null,
};

/** Branded on-site landing pages used when a store listing is unavailable. */
const BRANDED_FALLBACKS: Record<AppAudience, string> = {
  rider: "/riders/individual",
  driver: "/drivers",
};

function playUrl(audience: AppAudience): string {
  return `https://play.google.com/store/apps/details?id=${PLAY_PACKAGE_IDS[audience]}`;
}

function appStoreUrl(audience: AppAudience): string | null {
  const id = APP_STORE_IDS[audience];
  if (!id || !/^\d{6,}$/.test(id)) return null;
  return `https://apps.apple.com/ke/app/yalla-${audience === "rider" ? "ride" : "driver"}/id${id}`;
}

/** Raw (UTM-free) canonical destinations. Falls back to a branded page. */
export const APP_LINKS = {
  rider: {
    android: playUrl("rider"),
    ios: appStoreUrl("rider") ?? BRANDED_FALLBACKS.rider,
  },
  driver: {
    android: playUrl("driver"),
    ios: appStoreUrl("driver") ?? BRANDED_FALLBACKS.driver,
  },
} as const;

/** True when the destination leaves our own site (needs target="_blank"). */
export function isExternalAppLink(url: string): boolean {
  return /^https?:\/\//.test(url);
}

export interface AppLinkOptions {
  audience: AppAudience;
  platform: AppPlatform;
  /** Where the CTA lives, e.g. "header", "mega_menu_ride", "riders_page". */
  placement: string;
}

/**
 * Resolve a store destination with UTM attribution.
 * Never returns a generic store homepage.
 */
export function appLink({ audience, platform, placement }: AppLinkOptions): string {
  const base = platform === "android" ? playUrl(audience) : (appStoreUrl(audience) ?? BRANDED_FALLBACKS[audience]);
  const isStore = isExternalAppLink(base);
  const params = new URLSearchParams({
    utm_source: "yalla_web",
    utm_medium: placement,
    utm_campaign: `${audience}_app_install`,
    utm_content: platform,
  });
  // Play Store honours UTM inside the `referrer` parameter; Apple uses `pt/ct`.
  if (isStore && platform === "android") {
    return `${base}&referrer=${encodeURIComponent(params.toString())}`;
  }
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}${params.toString()}`;
}

/** Exposed for tests / diagnostics. */
export const APP_LINK_CONFIG = { PLAY_PACKAGE_IDS, APP_STORE_IDS, BRANDED_FALLBACKS };
