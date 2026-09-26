/**
 * Pricing 360 feature-flag state.
 *
 * Returns the resolved flag state plus an honest `source`:
 *   • "store"    — flags read from the governed table
 *   • "defaults" — the store was unreachable, registry defaults are in force
 * Surfaces must state which of the two they are rendering under, so a hidden
 * block is never mistaken for "no data".
 */
import { useCallback, useEffect, useState } from "react";
import {
  defaultFlagState, fetchPricingFlags, resolveFlagState,
  type PricingFlagKey, type PricingFlagRow, type PricingFlagState,
} from "@/lib/pricing360/featureFlags";

export interface PricingFlagsResult {
  flags: PricingFlagState;
  rows: PricingFlagRow[];
  loading: boolean;
  source: "store" | "defaults";
  error: string | null;
  reload: () => Promise<void>;
  isEnabled: (key: PricingFlagKey) => boolean;
}

export function usePricingFlags(): PricingFlagsResult {
  const [rows, setRows] = useState<PricingFlagRow[]>([]);
  const [flags, setFlags] = useState<PricingFlagState>(defaultFlagState);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<"store" | "defaults">("defaults");
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchPricingFlags();
      setRows(data);
      setFlags(resolveFlagState(data));
      setSource("store");
      setError(null);
    } catch (e) {
      setRows([]);
      setFlags(defaultFlagState());
      setSource("defaults");
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const isEnabled = useCallback((key: PricingFlagKey) => flags[key], [flags]);

  return { flags, rows, loading, source, error, reload, isEnabled };
}
