/**
 * Pricing 360 feature flags.
 *
 * Flags govern *presentation surfaces* of the Pricing Command Center — the KPI
 * intelligence band, the pricing intelligence blocks, dynamic pricing and the
 * simulator. They never gate the pricing engine itself: a disabled flag hides a
 * read surface, it can never change a price.
 *
 * Truthful-state law: when a flag is off the surface is NOT removed silently —
 * it renders a stated disabled panel naming the flag and who to ask. When the
 * flag store itself is unreachable the registry default applies and the surface
 * says so, so an operator is never shown a fabricated figure.
 */
import { supabase } from "@/integrations/supabase/client";
import { untypedDb } from "@/integrations/supabase/untyped";

export type PricingFlagKey =
  | "kpi_band"
  | "kpi_integrity"
  | "pricing_intelligence"
  | "dynamic_pricing"
  | "simulator"
  | "products_markets";

export interface PricingFlagDefinition {
  key: PricingFlagKey;
  label: string;
  /** What the operator loses when this is switched off. */
  surface: string;
  /** Default when no row exists yet, or the store is unreachable. */
  defaultEnabled: boolean;
  /** Owning team, shown in the disabled state so users know who to ask. */
  owner: string;
}

export const PRICING_FLAGS: ReadonlyArray<PricingFlagDefinition> = [
  {
    key: "kpi_band",
    label: "KPI intelligence band",
    surface: "The four headline KPIs above the Pricing 360 tabs.",
    defaultEnabled: true,
    owner: "Commercial & Pricing",
  },
  {
    key: "kpi_integrity",
    label: "Pricing integrity KPI",
    surface: "The integrity score card and its health drill-through.",
    defaultEnabled: true,
    owner: "Commercial & Pricing",
  },
  {
    key: "pricing_intelligence",
    label: "Pricing intelligence blocks",
    surface: "Coverage, margin and quote-behaviour intelligence on the Intelligence tab.",
    defaultEnabled: true,
    owner: "Commercial & Pricing",
  },
  {
    key: "dynamic_pricing",
    label: "Dynamic pricing surface",
    surface: "Demand-responsive multipliers and surge governance blocks.",
    defaultEnabled: true,
    owner: "Commercial & Pricing",
  },
  {
    key: "simulator",
    label: "Pricing simulator",
    surface: "Scenario pricing against the published rate cards.",
    defaultEnabled: true,
    owner: "Commercial & Pricing",
  },
  {
    key: "products_markets",
    label: "Products & Markets surfaces",
    surface: "Per-product and per-market rate coverage tabs.",
    defaultEnabled: true,
    owner: "Commercial & Pricing",
  },
];

export const PRICING_FLAG_KEYS = PRICING_FLAGS.map((f) => f.key);

export interface PricingFlagRow {
  key: string;
  enabled: boolean;
  note: string;
  updated_by: string | null;
  updated_at: string;
}

export type PricingFlagState = Record<PricingFlagKey, boolean>;

/** Registry defaults — used before the store resolves and if it is unreachable. */
export function defaultFlagState(): PricingFlagState {
  return PRICING_FLAGS.reduce((acc, f) => {
    acc[f.key] = f.defaultEnabled;
    return acc;
  }, {} as PricingFlagState);
}

/** Folds stored rows over the registry defaults. Unknown keys are ignored. */
export function resolveFlagState(rows: PricingFlagRow[] | null | undefined): PricingFlagState {
  const state = defaultFlagState();
  for (const row of rows ?? []) {
    if ((PRICING_FLAG_KEYS as string[]).includes(row.key)) {
      state[row.key as PricingFlagKey] = Boolean(row.enabled);
    }
  }
  return state;
}

export function flagDefinition(key: PricingFlagKey): PricingFlagDefinition {
  return PRICING_FLAGS.find((f) => f.key === key)!;
}

export async function fetchPricingFlags(): Promise<PricingFlagRow[]> {
  const { data, error } = await (untypedDb)
    .from("pricing360_feature_flags")
    .select("key,enabled,note,updated_by,updated_at")
    .order("key", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as PricingFlagRow[];
}

/** Admin-only (enforced by RLS). Upserts the flag and stamps the actor. */
export async function setPricingFlag(key: PricingFlagKey, enabled: boolean, note: string): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const { error } = await (untypedDb)
    .from("pricing360_feature_flags")
    .upsert(
      { key, enabled, note, updated_by: auth?.user?.id ?? null },
      { onConflict: "key" },
    );
  if (error) throw new Error(error.message);
}
