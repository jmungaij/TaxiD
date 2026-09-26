import { useLayoutEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight, Crosshair, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  addMinutes, formatOpsClock, isOnOpsDay, opsToday, shiftDateKey, slotToInstant, toOpsSlot,
} from "@/lib/logistics/orders/schedule";
import { activityErrorCopy } from "@/lib/logistics/orders/activityModel";

export interface PlannerOrder {
  id: string;
  order_number: string;
  status: string;
  pickup_address: string;
  pickup_window_start: string | null;
  pickup_window_end: string | null;
}

const HOURS = Array.from({ length: 18 }, (_, i) => i + 5); // 05:00 – 22:00 EAT
const ROW_HEIGHT = 56;

/**
 * Order planning board.
 *
 * The calendar and the order share ONE time model (`schedule.ts`): a drop on an
 * hour row is converted to an absolute instant in Nairobi time and persisted by
 * `logistics_order_reschedule`. The UI applies the change optimistically, then
 * reconciles with the server's returned instant — and it never recentres the
 * viewport: scroll position and visible day are preserved across drags and
 * reconciliation, unless the operator presses "Now".
 */
export function DispatchPlanner({ orders, onChanged }: { orders: PlannerOrder[]; onChanged: () => void }) {
  const [dateKey, setDateKey] = useState(() => opsToday());
  const [optimistic, setOptimistic] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const keepScroll = useRef<number | null>(null);

  // Preserve the operator's viewport across every re-render caused by a drag,
  // an optimistic update or a server reconciliation.
  useLayoutEffect(() => {
    if (keepScroll.current != null && gridRef.current) {
      gridRef.current.scrollTop = keepScroll.current;
    }
  }, [orders, optimistic, busy]);

  const scheduleOf = (o: PlannerOrder) => optimistic[o.id] ?? o.pickup_window_start;

  const commit = async (order: PlannerOrder, hour: number) => {
    if (gridRef.current) keepScroll.current = gridRef.current.scrollTop;
    const previous = scheduleOf(order);
    const start = slotToInstant({ dateKey, hour, minute: 0 });
    setOptimistic((m) => ({ ...m, [order.id]: start }));
    setBusy(order.id);
    const { data, error } = await supabase.rpc("logistics_order_reschedule", {
      _order_id: order.id,
      _pickup_window_start: start,
      _pickup_window_end: addMinutes(start, 60),
      _correlation_id: `planner-${order.id}-${Date.now()}`,
    });
    setBusy(null);
    const env = (data ?? {}) as { ok?: boolean; code?: string; message?: string; pickup_window_start?: string };
    if (error || env.ok === false) {
      setOptimistic((m) => ({ ...m, [order.id]: previous ?? "" }));
      toast.error(env.message ?? activityErrorCopy(env.code, error?.message));
      return;
    }
    // Reconcile against the authoritative instant the server stored.
    if (env.pickup_window_start) {
      setOptimistic((m) => ({ ...m, [order.id]: new Date(env.pickup_window_start!).toISOString() }));
    }
    toast.success(`${order.order_number} scheduled for ${formatOpsClock(env.pickup_window_start ?? start)} EAT`);
    onChanged();
  };

  const unscheduled = orders.filter((o) => !scheduleOf(o));
  const onDay = (hour: number) =>
    orders.filter((o) => {
      const iso = scheduleOf(o);
      return iso && isOnOpsDay(iso, dateKey) && toOpsSlot(iso).hour === hour;
    });

  return (
    <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
      <Card className="border-border/70 p-4">
        <h3 className="text-sm font-semibold">Unscheduled ({unscheduled.length})</h3>
        <p className="mb-3 text-xs text-muted-foreground">Drag an order onto an hour to set its pickup window.</p>
        <div className="space-y-2">
          {unscheduled.length === 0 && <p className="text-xs text-muted-foreground">Everything is scheduled.</p>}
          {unscheduled.map((o) => (
            <div
              key={o.id}
              draggable
              onDragStart={(e) => e.dataTransfer.setData("text/plain", o.id)}
              tabIndex={0}
              className="cursor-grab rounded-md border border-border p-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="font-mono">{o.order_number}</div>
              <div className="truncate text-muted-foreground">{o.pickup_address}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="border-border/70">
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <Button size="sm" variant="outline" onClick={() => setDateKey((d) => shiftDateKey(d, -1))} aria-label="Previous day">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-semibold">{dateKey}</span>
          <Button size="sm" variant="outline" onClick={() => setDateKey((d) => shiftDateKey(d, 1))} aria-label="Next day">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Badge variant="outline" className="text-[11px]">Africa/Nairobi (EAT)</Badge>
          <Button
            size="sm"
            variant="ghost"
            className="ms-auto"
            onClick={() => {
              // Explicit recentre — the only action that moves the viewport.
              setDateKey(opsToday());
              const nowHour = toOpsSlot(new Date().toISOString()).hour;
              const offset = Math.max(0, (nowHour - HOURS[0]) * ROW_HEIGHT);
              keepScroll.current = offset;
              if (gridRef.current) gridRef.current.scrollTop = offset;
            }}
          >
            <Crosshair className="mr-1 h-3.5 w-3.5" /> Now
          </Button>
        </div>

        <div ref={gridRef} className="max-h-[28rem] overflow-y-auto" onScroll={(e) => { keepScroll.current = e.currentTarget.scrollTop; }}>
          {HOURS.map((hour) => (
            <div
              key={hour}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData("text/plain");
                const order = orders.find((o) => o.id === id);
                if (order) commit(order, hour);
              }}
              style={{ minHeight: ROW_HEIGHT }}
              className="flex gap-3 border-b border-border/60 px-3 py-2"
            >
              <span className="w-14 shrink-0 pt-1 font-mono text-xs text-muted-foreground">
                {String(hour).padStart(2, "0")}:00
              </span>
              <div className="flex flex-1 flex-wrap gap-2">
                {onDay(hour).map((o) => (
                  <div
                    key={o.id}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData("text/plain", o.id)}
                    className="flex cursor-grab items-center gap-2 rounded-md border border-primary/40 bg-primary/5 px-2 py-1 text-xs"
                  >
                    {busy === o.id && <Loader2 className="h-3 w-3 animate-spin" />}
                    <span className="font-mono">{o.order_number}</span>
                    <span className="text-muted-foreground">{formatOpsClock(scheduleOf(o))}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

export default DispatchPlanner;
