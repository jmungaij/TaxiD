/**
 * Driver360 last-tab persistence (Phase D6.3).
 * Uses localStorage — no new preference table required.
 */
import type { Driver360Tab } from "./driver360Links";
import { DRIVER360_TABS, isDriver360Tab } from "./driver360Links";

const KEY = "yalla.driver360.lastTab";

export function readLastDriver360Tab(): Driver360Tab | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(KEY);
    return v && isDriver360Tab(v) ? (v as Driver360Tab) : null;
  } catch {
    return null;
  }
}

export function writeLastDriver360Tab(tab: string): void {
  if (typeof window === "undefined") return;
  if (!isDriver360Tab(tab)) return;
  try {
    window.localStorage.setItem(KEY, tab);
  } catch {
    /* storage denied — ignore */
  }
}

export { DRIVER360_TABS };
