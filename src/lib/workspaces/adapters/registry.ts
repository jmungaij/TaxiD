/**
 * Workspace Health Adapter Registry.
 *
 * Single lookup that returns the adapter for a given workspace. Turn-1 wires
 * every workspace to the deterministic stub adapter; Turn-2 replaces
 * individual entries with Supabase-backed adapters (e.g. `operations.ts`,
 * `finance.ts`) without touching consumers.
 *
 * Design notes:
 *   - Adapters are memoised — one instance per workspace for the app lifetime,
 *     so React Fast Refresh doesn't leak subscriptions.
 *   - Downstream code MUST use `getAdapter()` and never import adapters
 *     directly, so the registry remains the enforcement point for the health
 *     contract.
 */
import type { WorkspaceKey } from "../types";
import type { WorkspaceHealthAdapter } from "./types";
import { makeStubAdapter } from "./stub";
import { makeOperationsAdapter } from "./operations";
import { makeFinanceAdapter } from "./finance";
import { makePlatformAdapter } from "./platform";

const CACHE = new Map<WorkspaceKey, WorkspaceHealthAdapter>();

// Turn-2: three workspaces are now live-wired to Supabase. Remaining
// workspaces stay on the deterministic stub until their adapters ship.
const OVERRIDES: Partial<Record<WorkspaceKey, () => WorkspaceHealthAdapter>> = {
  operations: makeOperationsAdapter,
  finance: makeFinanceAdapter,
  platform: makePlatformAdapter,
};

export function getAdapter(key: WorkspaceKey): WorkspaceHealthAdapter {
  const cached = CACHE.get(key);
  if (cached) return cached;
  const factory = OVERRIDES[key];
  const adapter = factory ? factory() : makeStubAdapter(key);
  CACHE.set(key, adapter);
  return adapter;
}
