/**
 * Domain-aware Workspace 360 deep-link helper (Phase D7.0).
 * Generalizes driver360Links.ts so every 360 workspace shares one
 * URL contract, tab validation path, and analytics envelope.
 */
import { logUiEvent } from "@/lib/navLog";
import {
  WORKSPACE360_DEFAULT_TAB,
  type Workspace360Tab,
  isWorkspace360Tab,
  normalizeWorkspace360Tab,
} from "./tabs";
import { workspace360BasePath, type Workspace360Domain } from "./domains";

export function workspace360Path(
  domain: Workspace360Domain,
  entityId: string,
  tab?: Workspace360Tab | null,
): string {
  const base = `${workspace360BasePath(domain)}/${entityId}`;
  if (!tab || tab === WORKSPACE360_DEFAULT_TAB) return base;
  return `${base}?tab=${tab}`;
}

export function trackWorkspace360QuickAction(
  domain: Workspace360Domain,
  entityId: string,
  tab: Workspace360Tab,
  source: string,
): void {
  void logUiEvent({
    elementId: `workspace360:${domain}:quick-action:${tab}`,
    elementLabel: tab,
    action: "navigate",
    payload: { domain, entityId, tab, source },
  });
}

export function trackWorkspace360TabLanding(
  domain: Workspace360Domain,
  entityId: string,
  tab: Workspace360Tab,
  requestedTab: string | null,
): void {
  void logUiEvent({
    elementId: `workspace360:${domain}:tab-landing:${tab}`,
    elementLabel: tab,
    action: "view",
    success: requestedTab === null || requestedTab === tab,
    errorMessage:
      requestedTab && requestedTab !== tab ? "INVALID_TAB_FALLBACK" : null,
    payload: { domain, entityId, tab, requestedTab },
  });
}

export { isWorkspace360Tab, normalizeWorkspace360Tab };
