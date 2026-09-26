import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  actionToWork,
  createSelfWork,
  fetchAvailableActions,
  type AvailableAction,
} from "@/lib/workspace/workEngine";

/**
 * AVAILABLE CAPACITY.
 *
 * When the assigned queue is quiet the cockpit never says "nothing to do":
 * it surfaces the highest-value real records that need an owner — overdue
 * commitments, stalled opportunities, dormant accounts — and lets the employee
 * take one in a single click, which creates the work and starts it.
 */
export function AvailableCapacityPanel({
  onTaken,
  onCreateOwn,
}: {
  onTaken: (workItemId: string) => void;
  onCreateOwn: () => void;
}) {
  const [actions, setActions] = useState<AvailableAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetchAvailableActions(8)
      .then((rows) => {
        setActions(rows);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not load available work"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const take = async (action: AvailableAction) => {
    const key = `${action.kind}:${action.title}`;
    setBusyKey(key);
    const res = await createSelfWork(actionToWork(action));
    setBusyKey(null);
    if (res.ok !== true) {
      setError(res.error);
      return;
    }
    setActions((prev) => prev.filter((a) => `${a.kind}:${a.title}` !== key));
    onTaken(res.workItemId);
  };

  

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm">Available capacity</CardTitle>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Real records that need an owner — take one when you have room.
        </p>

        {loading && <div className="h-20 animate-pulse rounded-lg bg-muted" />}
        {error && <p className="text-xs text-destructive">{error}</p>}

        {!loading && !error && actions.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Nothing is unowned in your scope — your relationships are current.
          </p>
        )}

        <ul className="space-y-2">
          {actions.map((a) => {
            const key = `${a.kind}:${a.title}`;
            return (
              <li key={key} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{a.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{a.reason}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {a.accountName && (
                        <Badge variant="outline" className="text-[10px]">
                          {a.accountName}
                        </Badge>
                      )}
                      <Badge variant="secondary" className="text-[10px]">
                        {a.priority}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">{a.kind}</span>
                    </div>
                  </div>
                  <Button size="sm" onClick={() => take(a)} disabled={busyKey === key}>
                    {busyKey === key ? "Taking…" : "Take it"}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>

        <Button variant="outline" size="sm" className="w-full" onClick={onCreateOwn}>
          Create my own work
        </Button>
      </CardContent>
    </Card>
  );
}
