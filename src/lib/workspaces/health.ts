/**
 * Workspace Intelligence Layer — Live Foundation.
 *
 * Consumers call `useWorkspaceHealth(key)` and receive a canonical
 * WorkspaceHealth object. Under the hood this delegates to the adapter
 * registry, which is Turn-1 stubbed and Turn-2 swapped to Supabase-backed
 * adapters without touching this file or its consumers.
 *
 * Guarantees:
 *   - First paint is synchronous (adapter.snapshot()).
 *   - Subscriptions are set up in `useEffect` and torn down on unmount, so no
 *     Realtime subscription leaks (see /useful-context/cloud-realtime).
 *   - On adapter error, `connectionState` degrades to "degraded" and the last
 *     known snapshot is retained — the UI never fabricates a healthy status.
 */
import { useEffect, useState } from "react";
import { getAdapter } from "./adapters/registry";
import type { WorkspaceHealth, WorkspaceKey } from "./types";

export function useWorkspaceHealth(key: WorkspaceKey): WorkspaceHealth {
  const [health, setHealth] = useState<WorkspaceHealth>(() => getAdapter(key).snapshot());

  useEffect(() => {
    const adapter = getAdapter(key);
    // Prime with a fresh snapshot on mount / key change.
    setHealth(adapter.snapshot());
    let unsub: (() => void) | undefined;
    try {
      unsub = adapter.subscribe((next) => setHealth(next));
    } catch (err) {
      // Degrade: keep last snapshot but flag the connection as unreliable.
       
      console.warn(`[YEOS] Adapter subscription failed for ${key}`, err);
      setHealth((prev) => ({ ...prev, connectionState: "degraded" }));
    }
    return () => { unsub?.(); };
  }, [key]);

  return health;
}

/** Non-hook accessor for one-off reads (tests, SSR fallback, command palette). */
export function getWorkspaceHealthSnapshot(key: WorkspaceKey): WorkspaceHealth {
  return getAdapter(key).snapshot();
}

/** Human-readable "Last updated Xm ago" — used by the sidebar & hover previews. */
export function formatFreshness(iso: string, now: number = Date.now()): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "just now";
  const diffSec = Math.max(0, Math.round((now - t) / 1000));
  if (diffSec < 45) return "just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.round(diffHr / 24)}d ago`;
}
