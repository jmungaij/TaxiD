/**
 * Shared factory for Supabase-backed workspace adapters (Turn 2).
 *
 * Responsibilities:
 *   - Keep a synchronous last-known snapshot for first paint.
 *   - Refresh via a lightweight async `compute()` on an interval + on Realtime
 *     notifications from any of the listed tables.
 *   - Degrade cleanly:
 *       compute error   → connectionState "degraded" (retain last KPIs)
 *       channel error   → connectionState "degraded" (polling continues)
 *   - Idempotent teardown so React StrictMode doesn't leak channels.
 *
 * Adapters MUST NOT bypass this — it is the single enforcement point for
 * the WorkspaceHealth contract when live data is wired.
 */
import { supabase } from "@/integrations/supabase/client";
import type {
  WorkspaceConnectionState,
  WorkspaceHealth,
  WorkspaceKey,
} from "../types";
import type { WorkspaceHealthAdapter } from "./types";

export type LiveMetrics = Omit<WorkspaceHealth, "key" | "source" | "lastUpdated" | "connectionState">;

export interface LiveAdapterOptions {
  key: WorkspaceKey;
  /** Async compute — must NOT throw silently; return null on soft-failure. */
  compute: () => Promise<LiveMetrics | null>;
  /** Public tables whose changes should trigger recompute. */
  realtimeTables?: string[];
  /** Polling cadence when Realtime is quiet. Default 30s. */
  pollMs?: number;
  /** Placeholder used until the first successful compute() resolves. */
  initial: LiveMetrics;
}

export function makeLiveAdapter(opts: LiveAdapterOptions): WorkspaceHealthAdapter {
  const { key, compute, realtimeTables = [], pollMs = 30_000, initial } = opts;

  let current: WorkspaceHealth = {
    ...initial,
    key,
    source: key,
    lastUpdated: new Date().toISOString(),
    connectionState: "offline",
  };
  const listeners = new Set<(h: WorkspaceHealth) => void>();
  let refCount = 0;
  let pollId: number | undefined;
  let channel: ReturnType<typeof supabase.channel> | null = null;
  let inFlight = false;

  const emit = () => listeners.forEach((cb) => cb(current));

  const setState = (state: WorkspaceConnectionState, next?: LiveMetrics) => {
    current = {
      ...(next ?? current),
      key,
      source: key,
      lastUpdated: new Date().toISOString(),
      connectionState: state,
    };
    emit();
  };

  const refresh = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      const next = await compute();
      if (next) {
        setState(channel ? "live" : "degraded", next);
      } else {
        setState("degraded");
      }
    } catch (err) {
       
      console.warn(`[YEOS] live adapter '${key}' compute failed`, err);
      setState("degraded");
    } finally {
      inFlight = false;
    }
  };

  const attach = () => {
    if (refCount++ > 0) return;
    // Kick off first compute immediately.
    void refresh();
    pollId = window.setInterval(() => { void refresh(); }, pollMs);
    if (realtimeTables.length > 0) {
      const ch = supabase.channel(`yeos:${key}`);
      for (const table of realtimeTables) {
        (ch as unknown as {
          on: (t: string, f: Record<string, string>, cb: () => void) => typeof ch;
        }).on(
          "postgres_changes",
          { event: "*", schema: "public", table },
          () => { void refresh(); },
        );
      }
      ch.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          channel = ch;
          // Promote to "live" without waiting for the next poll.
          setState("live");
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          channel = null;
          setState("degraded");
        }
      });
    }
  };

  const detach = () => {
    if (--refCount > 0) return;
    if (pollId !== undefined) { window.clearInterval(pollId); pollId = undefined; }
    if (channel) { void supabase.removeChannel(channel); channel = null; }
  };

  return {
    key,
    snapshot() { return current; },
    subscribe(onChange) {
      listeners.add(onChange);
      attach();
      // Prime the new subscriber synchronously.
      onChange(current);
      return () => {
        listeners.delete(onChange);
        detach();
      };
    },
  };
}

/** Classify a 0-100 health score into a status band. */
export function classifyStatus(score: number): WorkspaceHealth["status"] {
  if (score >= 96) return "healthy";
  if (score >= 90) return "attention";
  if (score >= 0)  return "critical";
  return "unknown";
}
