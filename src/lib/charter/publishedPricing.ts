/**
 * Published pricing binding.
 *
 * The Pricing Control Center publishes a versioned configuration; every
 * customer-facing surface (marketplace, booking workflow) reads *that* version
 * so the price a customer sees is the price governance approved. The local
 * version store remains the drafting surface and offline fallback.
 */
import { charterApi } from "./api";
import { activePricingConfig, defaultPricingConfig, type PricingChange, type PricingConfig } from "./pricingConfigStore";
import { DEFAULT_GLOBAL_CONTROLS, DEFAULT_AIRPORT_CHARGES, AIRCRAFT_CATEGORIES } from "./aviationPricing";

export interface PublishedPricing {
  version: number;
  effectiveAt: string;
  actorEmail: string | null;
  note: string;
  config: PricingConfig;
  /** True when no server version exists yet and defaults are in force. */
  fallback: boolean;
}

/** Coerces a stored config, filling any gap with engine defaults. */
export function normalizeConfig(raw: unknown): PricingConfig {
  const c = (raw ?? {}) as Partial<PricingConfig>;
  return {
    controls: { ...DEFAULT_GLOBAL_CONTROLS, ...(c.controls ?? {}) },
    airports: Array.isArray(c.airports) && c.airports.length ? c.airports : DEFAULT_AIRPORT_CHARGES.map((a) => ({ ...a })),
    aircraft: Array.isArray(c.aircraft) && c.aircraft.length ? c.aircraft : AIRCRAFT_CATEGORIES.map((a) => ({ ...a })),
  };
}

const FALLBACK = (): PublishedPricing => ({
  version: 0,
  effectiveAt: new Date(0).toISOString(),
  actorEmail: null,
  note: "Platform defaults",
  config: (() => {
    try { return activePricingConfig(); } catch { return defaultPricingConfig(); }
  })(),
  fallback: true,
});

/** Fetches the pricing version currently in force (public, cached per call site). */
export async function fetchPublishedPricing(): Promise<PublishedPricing> {
  try {
    const row = await charterApi.activePricing();
    if (!row) return FALLBACK();
    return {
      version: Number(row.version ?? 0),
      effectiveAt: String(row.effective_at ?? new Date().toISOString()),
      actorEmail: (row.actor_email as string | null) ?? null,
      note: String(row.note ?? ""),
      config: normalizeConfig(row.config),
      fallback: false,
    };
  } catch {
    return FALLBACK();
  }
}

/** Publishes a new governed version and returns its version number. */
export async function publishPricing(
  config: PricingConfig,
  meta: { note?: string; effectiveAt?: string; changes: PricingChange[] },
): Promise<number> {
  const row = await charterApi.publishPricing({
    config,
    note: meta.note ?? "",
    effective_at: meta.effectiveAt,
    changes: meta.changes,
  });
  return Number(row.version ?? 0);
}
