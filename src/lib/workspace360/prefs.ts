/**
 * Per-domain last-tab persistence for Workspace 360 (Phase D7.0).
 * Mirrors driver360Prefs but keyed by domain so each 360 workspace
 * restores its own state independently.
 */
import { isWorkspace360Tab, type Workspace360Tab } from "./tabs";
import type { Workspace360Domain } from "./domains";

const KEY_PREFIX = "yalla.workspace360.lastTab.";

export function readLastWorkspace360Tab(
  domain: Workspace360Domain,
): Workspace360Tab | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(KEY_PREFIX + domain);
    return v && isWorkspace360Tab(v) ? (v as Workspace360Tab) : null;
  } catch {
    return null;
  }
}

export function writeLastWorkspace360Tab(
  domain: Workspace360Domain,
  tab: string,
): void {
  if (typeof window === "undefined") return;
  if (!isWorkspace360Tab(tab)) return;
  try {
    window.localStorage.setItem(KEY_PREFIX + domain, tab);
  } catch {
    /* storage denied — ignore */
  }
}
