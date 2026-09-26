/**
 * ExecutiveMetricsProvider
 *
 * Subscribes to Supabase Realtime on `public.event_store` and aggregates
 * `trip.*`, `driver.*`, and `finance.*` events into rolling counters that
 * power the Executive Command Center widgets. NO POLLING, NO setInterval.
 *
 * On (re)connect the provider performs a one-shot replay of events since the
 * last seen `occurred_at` cursor, then resumes the live channel. Missed
 * events while disconnected are reconciled automatically.
 */
import * as React from "react";
import { supabase } from "@/integrations/supabase/client";
import { untypedDb } from "@/integrations/supabase/untyped";
import { evaluateMetric, loadAlertRules } from "@/lib/alertEngine";

export type EventCategory = "trip" | "driver" | "finance" | "other";

export interface LiveEvent {
  id: string;
  event_type: string;
  category: EventCategory;
  payload: Record<string, unknown>;
  occurred_at: string;
}

export interface ExecMetricsState {
  connected: boolean;
  lastEventAt: string | null;
  totals: Record<string, number>;        // by event_type
  byCategory: Record<EventCategory, number>;
  recent: LiveEvent[];                    // ring buffer (max 50)
}

const initial: ExecMetricsState = {
  connected: false,
  lastEventAt: null,
  totals: {},
  byCategory: { trip: 0, driver: 0, finance: 0, other: 0 },
  recent: [],
};

function categorize(t: string): EventCategory {
  if (t.startsWith("trip.")) return "trip";
  if (t.startsWith("driver.")) return "driver";
  if (t.startsWith("finance.")) return "finance";
  return "other";
}

type Row = {
  id: string;
  event_type: string;
  payload: Record<string, unknown> | null;
  occurred_at: string;
};

const TRACKED_PREFIXES = ["trip.", "driver.", "finance."];

const Ctx = React.createContext<ExecMetricsState>(initial);

export function useExecMetrics() {
  return React.useContext(Ctx);
}

export function ExecutiveMetricsProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<ExecMetricsState>(initial);
  // Keep a ref of the cursor + de-dup set so replay logic does not depend on render state.
  const cursorRef = React.useRef<string | null>(null);
  const seenRef = React.useRef<Set<string>>(new Set());

  const applyEvent = React.useCallback((row: Row) => {
    if (seenRef.current.has(row.id)) return;
    if (!TRACKED_PREFIXES.some((p) => row.event_type.startsWith(p))) return;
    seenRef.current.add(row.id);
    // keep memory bounded
    if (seenRef.current.size > 5000) seenRef.current = new Set(Array.from(seenRef.current).slice(-2500));
    cursorRef.current = row.occurred_at;

    const cat = categorize(row.event_type);
    const evt: LiveEvent = {
      id: row.id,
      event_type: row.event_type,
      category: cat,
      payload: row.payload ?? {},
      occurred_at: row.occurred_at,
    };
    setState((prev) => {
      const nextTotal = (prev.totals[row.event_type] ?? 0) + 1;
      // Fire-and-forget alert evaluation against rolling counter
      if (cat !== "other") {
        void evaluateMetric({
          stream: cat,
          metric_key: row.event_type,
          value: nextTotal,
          context: { occurred_at: row.occurred_at },
        });
      }
      return {
        ...prev,
        lastEventAt: row.occurred_at,
        totals: { ...prev.totals, [row.event_type]: nextTotal },
        byCategory: { ...prev.byCategory, [cat]: prev.byCategory[cat] + 1 },
        recent: [evt, ...prev.recent].slice(0, 50),
      };
    });
  }, []);

  React.useEffect(() => { void loadAlertRules(); }, []);

  const replayMissed = React.useCallback(async () => {
    const since = cursorRef.current ?? new Date(Date.now() - 1000 * 60 * 60).toISOString();
    // event_store may not exist in non-admin sessions; ignore RLS errors silently.
    const { data, error } = await (untypedDb)
      .from("event_store")
      .select("id,event_type,payload,occurred_at")
      .gt("occurred_at", since)
      .order("occurred_at", { ascending: true })
      .limit(500);
    if (error || !data) return;
    for (const row of data) applyEvent(row);
  }, [applyEvent]);

  React.useEffect(() => {
    let cancelled = false;

    const channel = supabase
      .channel("yalla-events")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "event_store" },
        (payload) => {
          const row = payload.new as Row | undefined;
          if (row) applyEvent(row);
        }
      )
      .subscribe((status) => {
        if (cancelled) return;
        const connected = status === "SUBSCRIBED";
        setState((p) => ({ ...p, connected }));
        if (connected) void replayMissed();
      });

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [applyEvent, replayMissed]);

  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}
