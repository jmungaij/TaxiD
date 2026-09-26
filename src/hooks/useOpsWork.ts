import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import {
  decorateWork, fetchOpsWork, type DecoratedWork,
} from "@/lib/orchestration/api";
import { queuesForRoles, type OpsQueue } from "@/lib/orchestration/rules";
import type { WorkFilter } from "@/lib/orchestration/api";

/**
 * Role-adaptive work feed. The navigation stays consistent for every employee,
 * but the queues, work and actions they see are derived from granted roles —
 * server-side RLS enforces the same boundary.
 */
export function useOpsWork(filter: Omit<WorkFilter, "queues"> & { queues?: OpsQueue[] } = {}) {
  const { roles } = useAuth();
  const myQueues = useMemo(() => queuesForRoles(roles), [roles]);
  const scope = useMemo(
    () => (filter.queues?.length ? filter.queues.filter((q) => myQueues.includes(q) || myQueues.length === 0) : undefined),
    [filter.queues, myQueues],
  );

  const [items, setItems] = useState<DecoratedWork[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const key = JSON.stringify({ ...filter, queues: scope });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await fetchOpsWork({ ...filter, queues: scope });
      setItems(decorateWork(rows));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load work");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => { void load(); }, [load]);

  return { items, loading, error, reload: load, myQueues };
}
