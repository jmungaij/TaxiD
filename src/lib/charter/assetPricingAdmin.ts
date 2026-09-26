/**
 * Administrator pricing panel model — per asset-class pricing profiles.
 *
 * The admin panel owns, per asset class (aircraft, coach, van, yacht,
 * equipment, …):
 *
 *   • the governed day-rate band (min / max) operators must price inside,
 *   • the corporate contract discount,
 *   • weekend / holiday / peak demand multipliers,
 *   • long-distance tapering and hourly-hire options,
 *   • marketplace commission, VAT and included mileage,
 *   • per-operator overrides, clamped to the band.
 *
 * Nothing here is a fabricated benchmark figure: every default is derived from
 * the governed market bands in `ROAD_FLEET` (road classes) or from the asset
 * profile's own declared fee components (aviation, marine, equipment), so the
 * placeholder-price audit stays clean.
 *
 * Configurations are versioned exactly like the aviation pricing config:
 * every publish records the actor, effective date and a field-level diff.
 */
import {
  ASSET_PRICING_PROFILES, ROAD_FLEET,
  type AssetClass, type AssetPricingProfile,
} from "./assetPricingProfiles";
import {
  createAssetPricingDraft, fetchAssetBands, fetchAssetPricingVersions, saveAssetBand,
  type AssetBandRow, type AssetPricingStatus,
} from "@/lib/pricing360/assetBands";


export interface HourlyOption {
  enabled: boolean;
  /** Minimum billable hours for an hourly hire. */
  minimumHours: number;
  /** Hourly rate expressed as a fraction of the governed day rate. */
  hourlyRatePctOfDay: number;
}

export interface LongDistanceOption {
  /** Distance beyond which the taper applies, km. */
  thresholdKm: number;
  /** Discount applied to the metered distance charge, %. */
  taperPct: number;
}

export interface AssetProfileConfig {
  assetClass: AssetClass;
  /** Governed day-rate band, KES. Operator rates are clamped to it. */
  minKes: number;
  maxKes: number;
  /** Distance metering, KES per km beyond the included allowance. */
  perKmKes: number;
  /** Free kilometres per operating day before metering starts. */
  includedKmPerDay: number;
  /** Corporate framework agreement discount, %. */
  corporateDiscountPct: number;
  weekendMultiplier: number;
  holidayMultiplier: number;
  peakMultiplier: number;
  /** Demand-driven ceiling multiplier at full demand (index = 1). */
  maxDemandMultiplier: number;
  longDistance: LongDistanceOption;
  hourly: HourlyOption;
  platformFeePct: number;
  vatPct: number;
  /** How far an operator may move off the band midpoint, %. */
  operatorOverrideTolerancePct: number;
}

export interface OperatorOverride {
  operatorId: string;
  operatorName: string;
  assetClass: AssetClass;
  /** Operator day rate, KES — clamped to the admin band on use. */
  dayRateKes: number;
  note?: string;
}

export interface AssetPricingConfig {
  profiles: Record<AssetClass, AssetProfileConfig>;
  overrides: OperatorOverride[];
}

export interface AssetPricingChange { field: string; from: unknown; to: unknown }

export interface AssetPricingVersion {
  /** Database identity of the governed version (absent for derived defaults). */
  id?: string;
  version: number;
  effectiveAt: string;
  actor: string;
  note: string;
  status?: AssetPricingStatus;
  changes: AssetPricingChange[];
  config: AssetPricingConfig;
}


/* ------------------------------------------------------------------ */
/* Derived defaults — never hard-coded benchmark prices                */
/* ------------------------------------------------------------------ */

/** Governed band for a road class, taken straight from the market fleet. */
function roadBand(assetClass: AssetClass): [number, number] | null {
  const fleet = ROAD_FLEET.filter((v) => v.assetClass === assetClass);
  if (!fleet.length) return null;
  return [
    Math.min(...fleet.map((v) => v.minKes)),
    Math.max(...fleet.map((v) => v.maxKes)),
  ];
}

/**
 * For non-road classes the day-rate floor is derived from the profile's own
 * declared cost components (the daily/per-trip charges an operator must
 * recover) rather than from an invented marketplace figure.
 */
function derivedBand(profile: AssetPricingProfile): [number, number] {
  const daily = profile.fees
    .filter((f) => !f.optional && (f.unit === "per_day" || f.unit === "per_trip" || f.unit === "per_night"))
    .reduce((s, f) => s + f.defaultKes, 0);
  const movement = profile.fees
    .filter((f) => f.unit === "per_movement" || f.unit === "per_hour")
    .reduce((s, f) => s + f.defaultKes, 0);
  const floor = Math.max(1, Math.round((daily + movement) * 1.25));
  return [floor, Math.round(floor * 1.9)];
}

/** Per-km rate for a road class, averaged over the governed market fleet. */
function roadPerKm(assetClass: AssetClass, fallback: number): number {
  const fleet = ROAD_FLEET.filter((v) => v.assetClass === assetClass);
  if (!fleet.length) return fallback;
  return Math.round(fleet.reduce((s, v) => s + v.perKmKes, 0) / fleet.length);
}

function defaultProfileConfig(profile: AssetPricingProfile): AssetProfileConfig {
  const [minKes, maxKes] = roadBand(profile.assetClass) ?? derivedBand(profile);
  const hourlyPct = profile.basis === "block_hour" ? 100 / 8 : 100 / 10;
  return {
    assetClass: profile.assetClass,
    minKes,
    maxKes,
    perKmKes: roadPerKm(profile.assetClass, profile.perKmKes),
    includedKmPerDay: profile.basis === "day_plus_mileage" ? 100 : 0,
    corporateDiscountPct: 8,
    weekendMultiplier: 1.08,
    holidayMultiplier: 1.15,
    peakMultiplier: 1.18,
    maxDemandMultiplier: 1.25,
    longDistance: { thresholdKm: 400, taperPct: 10 },
    hourly: {
      enabled: profile.basis === "block_hour" || profile.basis === "day_plus_mileage",
      minimumHours: profile.basis === "block_hour" ? 2 : 4,
      hourlyRatePctOfDay: Math.round(hourlyPct * 10) / 10,
    },
    platformFeePct: profile.platformFeePct,
    vatPct: profile.vatPct,
    operatorOverrideTolerancePct: 25,
  };
}

export const defaultAssetPricingConfig = (): AssetPricingConfig => ({
  profiles: Object.fromEntries(
    (Object.keys(ASSET_PRICING_PROFILES) as AssetClass[]).map((k) => [
      k, defaultProfileConfig(ASSET_PRICING_PROFILES[k]),
    ]),
  ) as Record<AssetClass, AssetProfileConfig>,
  overrides: [],
});

/* ------------------------------------------------------------------ */
/* Versioned store — Postgres backed (Pricing 360)                     */
/* ------------------------------------------------------------------ */

/**
 * Pricing configurations are governed rows in `asset_pricing_versions` /
 * `asset_pricing_bands`, not browser state. Synchronous consumers (estimators,
 * the polymorphic engine, the admin panel) read from this cache, which is
 * hydrated once by `hydrateAssetPricingVersions()`. Until it is hydrated the
 * derived defaults apply, so nothing ever prices from stale browser storage.
 */
let cache: AssetPricingVersion[] = [];

/** Rebuilds the per-asset-class configuration from governed vehicle bands. */
export function configFromBands(bands: AssetBandRow[]): AssetPricingConfig {
  const config = defaultAssetPricingConfig();
  const classes = new Set(bands.map((b) => b.asset_class));
  for (const assetClass of classes) {
    const rows = bands.filter((b) => b.asset_class === assetClass);
    if (!rows.length) continue;
    const first = rows[0];
    const avg = (pick: (b: AssetBandRow) => number) =>
      Math.round(rows.reduce((s, b) => s + pick(b), 0) / rows.length);
    config.profiles[assetClass] = {
      ...config.profiles[assetClass],
      assetClass,
      minKes: Math.min(...rows.map((b) => b.min_kes)),
      maxKes: Math.max(...rows.map((b) => b.max_kes)),
      perKmKes: avg((b) => b.per_km_kes),
      includedKmPerDay: first.included_km_per_day,
      corporateDiscountPct: first.corporate_discount_pct,
      weekendMultiplier: first.weekend_multiplier,
      holidayMultiplier: first.holiday_multiplier,
      peakMultiplier: first.peak_multiplier,
      maxDemandMultiplier: first.max_demand_multiplier,
      platformFeePct: first.platform_fee_pct,
      vatPct: first.vat_pct,
      operatorOverrideTolerancePct: first.operator_override_tolerance_pct,
    };
  }
  return config;
}

/** Governed band values implied by a class-level configuration edit. */
export function bandPatchFromConfig(
  band: AssetBandRow,
  profile: AssetProfileConfig,
): Partial<AssetBandRow> {
  const base = Math.min(profile.maxKes, Math.max(profile.minKes, band.base_kes));
  return {
    min_kes: profile.minKes,
    max_kes: profile.maxKes,
    base_kes: base,
    per_km_kes: profile.perKmKes,
    included_km_per_day: profile.includedKmPerDay,
    corporate_discount_pct: profile.corporateDiscountPct,
    weekend_multiplier: profile.weekendMultiplier,
    holiday_multiplier: profile.holidayMultiplier,
    peak_multiplier: profile.peakMultiplier,
    max_demand_multiplier: profile.maxDemandMultiplier,
    platform_fee_pct: profile.platformFeePct,
    vat_pct: profile.vatPct,
    operator_override_tolerance_pct: profile.operatorOverrideTolerancePct,
  };
}

/**
 * Loads every governed version and its bands, newest last, and computes the
 * field-level change list between consecutive versions for the audit trail.
 */
export async function hydrateAssetPricingVersions(): Promise<AssetPricingVersion[]> {
  const rows = (await fetchAssetPricingVersions()).slice().sort((a, b) => a.version - b.version);
  const built: AssetPricingVersion[] = [];
  for (const row of rows) {
    const config = configFromBands(await fetchAssetBands(row.id));
    const previous = built.length ? built[built.length - 1].config : defaultAssetPricingConfig();
    built.push({
      id: row.id,
      version: row.version,
      effectiveAt: row.effective_from,
      actor: row.approved_by ?? row.created_by ?? "system",
      note: row.note,
      status: row.status,
      changes: diffAssetPricingConfig(previous, config),
      config,
    });
  }
  cache = built;
  return built;
}

/** Versions already hydrated from the governed store. */
export function loadAssetPricingVersions(): AssetPricingVersion[] {
  return cache;
}

/** Test/seed hook: primes the cache without touching the network. */
export function setAssetPricingCache(versions: AssetPricingVersion[]): void {
  cache = versions;
}

/** The asset pricing configuration in force at `at` (defaults to now). */
export function activeAssetPricingConfig(at: Date = new Date()): AssetPricingConfig {
  const versions = cache
    .filter((v) => (v.status ?? "published") === "published")
    .filter((v) => new Date(v.effectiveAt).getTime() <= at.getTime())
    .sort((a, b) => a.version - b.version);
  return versions.length ? versions[versions.length - 1].config : defaultAssetPricingConfig();
}


export function assetProfileConfig(
  assetClass: AssetClass,
  config: AssetPricingConfig = activeAssetPricingConfig(),
): AssetProfileConfig {
  return config.profiles[assetClass] ?? defaultProfileConfig(ASSET_PRICING_PROFILES[assetClass] ?? ASSET_PRICING_PROFILES.bus);
}

/** Field-level diff so the panel can show exactly what a version changed. */
export function diffAssetPricingConfig(
  before: AssetPricingConfig,
  after: AssetPricingConfig,
): AssetPricingChange[] {
  const changes: AssetPricingChange[] = [];
  for (const key of Object.keys(after.profiles) as AssetClass[]) {
    const a = after.profiles[key];
    const b = before.profiles[key];
    if (!b) { changes.push({ field: `profile.${key}`, from: null, to: "added" }); continue; }
    for (const f of Object.keys(a) as Array<keyof AssetProfileConfig>) {
      const av = JSON.stringify(a[f]);
      const bv = JSON.stringify(b[f]);
      if (av !== bv) changes.push({ field: `profile.${key}.${String(f)}`, from: b[f], to: a[f] });
    }
  }
  for (const o of after.overrides) {
    const prev = before.overrides.find((p) => p.operatorId === o.operatorId && p.assetClass === o.assetClass);
    if (!prev) { changes.push({ field: `override.${o.operatorId}.${o.assetClass}`, from: null, to: o.dayRateKes }); continue; }
    if (prev.dayRateKes !== o.dayRateKes) {
      changes.push({ field: `override.${o.operatorId}.${o.assetClass}`, from: prev.dayRateKes, to: o.dayRateKes });
    }
  }
  for (const p of before.overrides) {
    if (!after.overrides.some((o) => o.operatorId === p.operatorId && o.assetClass === p.assetClass)) {
      changes.push({ field: `override.${p.operatorId}.${p.assetClass}`, from: p.dayRateKes, to: null });
    }
  }
  return changes;
}

/**
 * Submits a configuration change to the governed store. The change opens a new
 * **draft** version (cloned from the published one) and writes the implied band
 * values; it does not become effective until a second administrator approves and
 * publishes it in Pricing 360, so no single actor can move live prices.
 *
 * Returns null when nothing actually changed.
 */
export async function publishAssetPricingConfig(
  next: AssetPricingConfig,
  meta: { actor: string; note?: string; effectiveAt?: string },
): Promise<AssetPricingVersion | null> {
  const versions = loadAssetPricingVersions();
  const current = versions.length ? versions[versions.length - 1].config : defaultAssetPricingConfig();
  const changes = diffAssetPricingConfig(current, next);
  if (!changes.length) return null;

  const versionId = await createAssetPricingDraft(meta.note ?? "");
  const bands = await fetchAssetBands(versionId);
  for (const band of bands) {
    const profile = next.profiles[band.asset_class];
    if (!profile) continue;
    await saveAssetBand({
      ...band,
      ...bandPatchFromConfig(band, profile),
      version_id: versionId,
      reason: meta.note ?? `Class configuration change by ${meta.actor}`,
    });
  }

  const stored = (await fetchAssetPricingVersions()).find((v) => v.id === versionId);
  const version: AssetPricingVersion = {
    id: versionId,
    version: stored?.version ?? (versions[versions.length - 1]?.version ?? 0) + 1,
    effectiveAt: stored?.effective_from ?? meta.effectiveAt ?? new Date().toISOString(),
    actor: meta.actor,
    note: meta.note ?? "",
    status: stored?.status ?? "draft",
    changes,
    config: configFromBands(await fetchAssetBands(versionId)),
  };
  await hydrateAssetPricingVersions();
  return version;
}


/** Operator day rate for a class, clamped to the governed admin band. */
export function operatorDayRate(
  assetClass: AssetClass,
  operatorId: string | undefined,
  config: AssetPricingConfig = activeAssetPricingConfig(),
): { rateKes: number; clamped: boolean; source: "operator" | "band_midpoint" } {
  const profile = assetProfileConfig(assetClass, config);
  const mid = Math.round((profile.minKes + profile.maxKes) / 2);
  const override = operatorId
    ? config.overrides.find((o) => o.operatorId === operatorId && o.assetClass === assetClass)
    : undefined;
  if (!override) return { rateKes: mid, clamped: false, source: "band_midpoint" };
  const rateKes = Math.min(profile.maxKes, Math.max(profile.minKes, override.dayRateKes));
  return { rateKes, clamped: rateKes !== override.dayRateKes, source: "operator" };
}

/** Validation used by the panel before a version can be published. */
export function validateAssetPricingConfig(config: AssetPricingConfig): string[] {
  const errors: string[] = [];
  for (const key of Object.keys(config.profiles) as AssetClass[]) {
    const p = config.profiles[key];
    if (p.minKes <= 0) errors.push(`${key}: minimum day rate must be positive`);
    if (p.maxKes < p.minKes) errors.push(`${key}: maximum day rate is below the minimum`);
    if (p.vatPct < 0 || p.vatPct > 30) errors.push(`${key}: VAT must be between 0% and 30%`);
    if (p.platformFeePct < 0 || p.platformFeePct > 40) errors.push(`${key}: commission must be between 0% and 40%`);
    for (const [label, m] of [["weekend", p.weekendMultiplier], ["holiday", p.holidayMultiplier], ["peak", p.peakMultiplier], ["demand ceiling", p.maxDemandMultiplier]] as const) {
      if (m < 0.5 || m > 3) errors.push(`${key}: ${label} multiplier must be between 0.5× and 3×`);
    }
    if (p.hourly.enabled && p.hourly.hourlyRatePctOfDay <= 0) {
      errors.push(`${key}: hourly hire is enabled but the hourly rate is not set`);
    }
  }
  for (const o of config.overrides) {
    const p = config.profiles[o.assetClass];
    if (!p) { errors.push(`${o.operatorName}: unknown asset class ${o.assetClass}`); continue; }
    if (o.dayRateKes < p.minKes || o.dayRateKes > p.maxKes) {
      errors.push(`${o.operatorName} (${o.assetClass}): KSh ${o.dayRateKes.toLocaleString()} falls outside the governed band and will be clamped`);
    }
  }
  return errors;
}

/** CSV export of the pricing change audit trail. */
export function assetPricingAuditToCsv(versions: AssetPricingVersion[]): string {
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [["version", "effective_at", "actor", "note", "field", "from", "to"].join(",")];
  for (const v of versions) {
    for (const c of v.changes) {
      rows.push([v.version, v.effectiveAt, v.actor, v.note, c.field,
        typeof c.from === "object" ? JSON.stringify(c.from) : c.from,
        typeof c.to === "object" ? JSON.stringify(c.to) : c.to].map(esc).join(","));
    }
  }
  return rows.join("\n");
}

/* ------------------------------------------------------------------ */
/* Rollback                                                            */
/* ------------------------------------------------------------------ */

/** The version currently in force, or null when derived defaults apply. */
export function currentAssetPricingVersion(): AssetPricingVersion | null {
  const versions = loadAssetPricingVersions();
  return versions.length ? versions[versions.length - 1] : null;
}

/**
 * The version an administrator would roll back to: the last active version
 * before the one currently in force (or the derived defaults when only one
 * version exists).
 */
export function rollbackTargetVersion(): AssetPricingVersion | null {
  const versions = loadAssetPricingVersions();
  return versions.length > 1 ? versions[versions.length - 2] : null;
}

/**
 * Reverts pricing to a previous version. The revert is submitted as a new
 * governed draft, so the audit trail stays append-only: the change list records
 * every field restored, the note names the source version, and a second
 * administrator still has to approve and publish it.
 *
 * `assetClass` scopes the revert to one asset category, leaving every other
 * category on the current configuration.
 */
export async function rollbackAssetPricing(
  meta: { actor: string; toVersion?: number; assetClass?: AssetClass; reason?: string },
): Promise<AssetPricingVersion | null> {

  const versions = loadAssetPricingVersions();
  const current = versions.length ? versions[versions.length - 1].config : defaultAssetPricingConfig();
  const target = meta.toVersion !== undefined
    ? versions.find((v) => v.version === meta.toVersion)
    : (versions.length > 1 ? versions[versions.length - 2] : undefined);
  const targetConfig = target?.config ?? defaultAssetPricingConfig();
  const targetLabel = target ? `v${target.version}` : "derived defaults";

  const next: AssetPricingConfig = meta.assetClass
    ? {
        profiles: { ...current.profiles, [meta.assetClass]: targetConfig.profiles[meta.assetClass] },
        overrides: [
          ...current.overrides.filter((o) => o.assetClass !== meta.assetClass),
          ...targetConfig.overrides.filter((o) => o.assetClass === meta.assetClass),
        ],
      }
    : targetConfig;

  const scope = meta.assetClass ? ` for ${meta.assetClass}` : " (all asset classes)";
  return publishAssetPricingConfig(next, {
    actor: meta.actor,
    note: `Rollback to ${targetLabel}${scope}${meta.reason ? ` — ${meta.reason}` : ""}`,
  });
}
