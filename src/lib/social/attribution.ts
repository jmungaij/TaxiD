/**
 * ATTRIBUTION & UTM GOVERNANCE
 *
 * One canonical vocabulary so `linkedin`, `LinkedIn`, `Linked-In` and `LI`
 * cannot become four attribution dimensions. First-touch attribution is
 * preserved: an inbound campaign never overwrites the original source.
 */
import { PLATFORM_KIND, type SocialPlatformSlug } from "./platforms";

export type Channel =
  | "organic_search" | "direct" | "social" | "paid_social" | "referral" | "email" | "campaign" | "partner";

const FIRST_TOUCH_KEY = "yalla_attr_first_touch";
const LAST_TOUCH_KEY = "yalla_attr_last_touch";

export interface Attribution {
  channel: Channel;
  source: string | null;
  medium: string | null;
  campaign: string | null;
  landing_path: string;
  captured_at: string;
}

/** Canonical source token for a platform. Always lowercase, never abbreviated. */
export function canonicalSource(platform: string): string {
  return String(platform).trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Canonical medium: profile channels are `social`, WhatsApp is a conversation. */
export function canonicalMedium(platform: string): string {
  return PLATFORM_KIND[platform as SocialPlatformSlug] === "CONVERSATION" ? "conversation" : "social";
}

/** Governed campaign token, e.g. `yalla_brand`. */
export function canonicalCampaign(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export function classifyChannel(params: URLSearchParams, referrer: string): Channel {
  const medium = (params.get("utm_medium") ?? "").toLowerCase();
  const source = (params.get("utm_source") ?? "").toLowerCase();
  if (medium.includes("cpc") || medium.includes("paid")) return "paid_social";
  if (medium === "social" || medium === "conversation") return "social";
  if (medium === "email") return "email";
  if (medium === "partner") return "partner";
  if (source || params.get("utm_campaign")) return "campaign";
  if (!referrer) return "direct";
  try {
    const host = new URL(referrer).hostname;
    if (typeof window !== "undefined" && host === window.location.hostname) return "direct";
    if (/(google|bing|duckduckgo|yahoo|ecosia)\./i.test(host)) return "organic_search";
    if (/(linkedin|facebook|instagram|youtube|tiktok|x\.com|twitter|whatsapp)\./i.test(host)) return "social";
    return "referral";
  } catch {
    return "direct";
  }
}

function read(key: string): Attribution | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Attribution) : null;
  } catch {
    return null;
  }
}

/**
 * Captures the current visit. First touch is written once and never
 * overwritten; last touch is refreshed on every campaign visit.
 */
export function captureAttribution(): { firstTouch: Attribution | null; lastTouch: Attribution } {
  const search = typeof window === "undefined" ? "" : window.location.search;
  const params = new URLSearchParams(search);
  const current: Attribution = {
    channel: classifyChannel(params, typeof document === "undefined" ? "" : document.referrer),
    source: params.get("utm_source"),
    medium: params.get("utm_medium"),
    campaign: params.get("utm_campaign"),
    landing_path: typeof window === "undefined" ? "/" : window.location.pathname,
    captured_at: new Date().toISOString(),
  };
  try {
    if (!read(FIRST_TOUCH_KEY)) localStorage.setItem(FIRST_TOUCH_KEY, JSON.stringify(current));
    localStorage.setItem(LAST_TOUCH_KEY, JSON.stringify(current));
  } catch {
    // storage denied (private mode / consent) — attribution degrades, UX does not
  }
  return { firstTouch: read(FIRST_TOUCH_KEY), lastTouch: current };
}

export const firstTouch = () => read(FIRST_TOUCH_KEY);
export const lastTouch = () => read(LAST_TOUCH_KEY);

/**
 * Outbound social destinations are NOT decorated with our own UTMs (they are
 * inbound-only parameters for traffic arriving at yalla.africa). Campaign
 * landing URLs are built here instead, from the governed campaign record.
 */
export function campaignLandingUrl(origin: string, landingPath: string, platform: string, campaign: string): string {
  const url = new URL(landingPath.startsWith("/") ? landingPath : `/${landingPath}`, origin);
  url.searchParams.set("utm_source", canonicalSource(platform));
  url.searchParams.set("utm_medium", canonicalMedium(platform));
  url.searchParams.set("utm_campaign", canonicalCampaign(campaign));
  return url.toString();
}
