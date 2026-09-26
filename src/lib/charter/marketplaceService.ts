/**
 * Marketplace Service fee — the single customer-facing platform charge.
 *
 * Replaces the legacy "platform commission" wording. The rate is configurable
 * through the administration system: an admin-published value is cached in
 * `localStorage` by the pricing console and read here so documents, quotes and
 * the booking sidebar can never disagree about the rate in force.
 */
export const MARKETPLACE_SERVICE_DEFAULT_PCT = 15;

const STORAGE_KEY = "yalla.pricing.marketplaceServicePct";

/** The rate in force (admin-configurable, clamped to a sane 0–30% band). */
export function marketplaceServicePct(): number {
  if (typeof window === "undefined") return MARKETPLACE_SERVICE_DEFAULT_PCT;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const n = raw == null ? NaN : Number(raw);
    if (!Number.isFinite(n)) return MARKETPLACE_SERVICE_DEFAULT_PCT;
    return Math.min(30, Math.max(0, n));
  } catch {
    return MARKETPLACE_SERVICE_DEFAULT_PCT;
  }
}

/** Admin write path — used by the pricing administration panel. */
export function setMarketplaceServicePct(pct: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(Math.min(30, Math.max(0, pct))));
  } catch {
    /* storage denied — fall back to the default */
  }
}

/** What the Marketplace Service fee pays for — printed on every document. */
export const MARKETPLACE_SERVICE_INCLUSIONS = [
  "Booking platform",
  "Live GPS tracking",
  "Payment processing",
  "24/7 operations desk",
  "Fraud protection",
  "Customer support",
  "Operator management",
  "Digital documentation",
] as const;

export function marketplaceServiceLabel(pct = marketplaceServicePct()): string {
  return `Marketplace Service (${pct}%)`;
}

export function marketplaceServiceReason(): string {
  return `Includes ${MARKETPLACE_SERVICE_INCLUSIONS.join(", ").toLowerCase()}.`;
}
