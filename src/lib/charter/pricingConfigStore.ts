/**
 * Versioned, auditable store for the SAFARID Air pricing configuration.
 *
 * Pricing rules are governance artefacts: every change is versioned with an
 * effective date, an actor and a field-level diff, so the Pricing Control
 * Center can show exactly who changed what and when.
 */
import {
  DEFAULT_AIRPORT_CHARGES, DEFAULT_GLOBAL_CONTROLS, AIRCRAFT_CATEGORIES,
  type AirportCharges, type GlobalPricingControls, type AircraftCategory,
} from "./aviationPricing";

export interface PricingConfig {
  controls: GlobalPricingControls;
  airports: AirportCharges[];
  aircraft: AircraftCategory[];
}

export interface PricingChange { field: string; from: unknown; to: unknown }

export interface PricingVersion {
  version: number;
  effectiveAt: string;
  actor: string;
  note: string;
  changes: PricingChange[];
  config: PricingConfig;
}

const KEY = "yalla.air.pricing.config.v1";

export const defaultPricingConfig = (): PricingConfig => ({
  controls: { ...DEFAULT_GLOBAL_CONTROLS },
  airports: DEFAULT_AIRPORT_CHARGES.map((a) => ({ ...a })),
  aircraft: AIRCRAFT_CATEGORIES.map((a) => ({ ...a })),
});

/** Field-level diff across controls, airports and aircraft rates. */
export function diffPricingConfig(before: PricingConfig, after: PricingConfig): PricingChange[] {
  const changes: PricingChange[] = [];
  for (const k of Object.keys(after.controls) as Array<keyof GlobalPricingControls>) {
    if (before.controls[k] !== after.controls[k]) {
      changes.push({ field: `controls.${k}`, from: before.controls[k], to: after.controls[k] });
    }
  }
  for (const a of after.airports) {
    const prev = before.airports.find((p) => p.code === a.code);
    if (!prev) { changes.push({ field: `airport.${a.code}`, from: null, to: "added" }); continue; }
    for (const k of Object.keys(a) as Array<keyof AirportCharges>) {
      if (prev[k] !== a[k]) changes.push({ field: `airport.${a.code}.${k}`, from: prev[k], to: a[k] });
    }
  }
  for (const a of after.aircraft) {
    const prev = before.aircraft.find((p) => p.key === a.key);
    if (!prev) continue;
    for (const k of Object.keys(a) as Array<keyof AircraftCategory>) {
      if (prev[k] !== a[k]) changes.push({ field: `aircraft.${a.key}.${k}`, from: prev[k], to: a[k] });
    }
  }
  return changes;
}

interface Persisted { versions: PricingVersion[] }

function read(): Persisted {
  if (typeof localStorage === "undefined") return { versions: [] };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { versions: [] };
    const parsed = JSON.parse(raw) as Persisted;
    return Array.isArray(parsed?.versions) ? parsed : { versions: [] };
  } catch {
    return { versions: [] };
  }
}

function write(state: Persisted) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage full or unavailable — pricing still works from defaults */
  }
}

export function loadPricingVersions(): PricingVersion[] {
  return read().versions;
}

/** The configuration in force at `at` (defaults to now). */
export function activePricingConfig(at: Date = new Date()): PricingConfig {
  const versions = loadPricingVersions()
    .filter((v) => new Date(v.effectiveAt).getTime() <= at.getTime())
    .sort((a, b) => a.version - b.version);
  return versions.length ? versions[versions.length - 1].config : defaultPricingConfig();
}

/** Persist a new version; returns null when nothing actually changed. */
export function savePricingConfig(
  next: PricingConfig,
  meta: { actor: string; note?: string; effectiveAt?: string },
): PricingVersion | null {
  const state = read();
  const current = state.versions.length
    ? state.versions[state.versions.length - 1].config
    : defaultPricingConfig();
  const changes = diffPricingConfig(current, next);
  if (changes.length === 0) return null;

  const version: PricingVersion = {
    version: (state.versions[state.versions.length - 1]?.version ?? 0) + 1,
    effectiveAt: meta.effectiveAt ?? new Date().toISOString(),
    actor: meta.actor,
    note: meta.note ?? "",
    changes,
    config: next,
  };
  state.versions = [...state.versions, version].slice(-50);
  write(state);
  return version;
}

/** CSV export of the pricing change audit trail. */
export function pricingAuditToCsv(versions: PricingVersion[]): string {
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [["version", "effective_at", "actor", "note", "field", "from", "to"].join(",")];
  for (const v of versions) {
    for (const c of v.changes) {
      rows.push([v.version, v.effectiveAt, v.actor, v.note, c.field, c.from, c.to].map(esc).join(","));
    }
  }
  return rows.join("\n");
}
