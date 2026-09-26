import { useCallback, useEffect, useState } from "react";
import { charterApi } from "./api";
import { EMPTY_DATASET, type FlightHubDataset } from "./flightHub";

/**
 * Single fetch surface for every Flight Hub page. Loads the four charter
 * collections in parallel and degrades gracefully when a caller lacks the
 * role for one of them (e.g. pricing audit is admin-only).
 */
export function useFlightHub() {
  const [data, setData] = useState<FlightHubDataset>(EMPTY_DATASET);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => {
      try { return await p; } catch { return fallback; }
    };
    try {
      const [inventory, quotes, bookings, audit] = await Promise.all([
        safe(charterApi.inventory(), []),
        safe(charterApi.listQuotes(), []),
        safe(charterApi.listBookings(), []),
        safe(charterApi.auditTrail(), []),
      ]);
      setData({ inventory, quotes, bookings, audit });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load Flight Hub data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return { data, loading, error, reload: load };
}
