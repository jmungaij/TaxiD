import { lazy, type ComponentType } from "react";

/**
 * Route-level lazy loader that survives stale chunk hashes after a redeploy.
 *
 * When a new build is published, the previously loaded index bundle still points
 * at old hashed chunk filenames which no longer exist on the host — the dynamic
 * import then rejects with "Failed to fetch dynamically imported module" and the
 * route renders a blank screen. We retry once (transient network), then force a
 * single hard reload to pick up the fresh manifest.
 */
const RELOAD_FLAG = "yalla:chunk-reload";

export function lazyWithRetry<T extends ComponentType<never>>(
  factory: () => Promise<{ default: T }>,
) {
  return lazy(async () => {
    try {
      const mod = await factory();
      sessionStorage.removeItem(RELOAD_FLAG);
      return mod;
    } catch (error) {
      // One transient retry (cache-busted by the browser re-requesting).
      try {
        return await factory();
      } catch {
        const alreadyReloaded = sessionStorage.getItem(RELOAD_FLAG) === "1";
        if (!alreadyReloaded) {
          sessionStorage.setItem(RELOAD_FLAG, "1");
          window.location.reload();
          // Never resolves — the page is being replaced.
          return await new Promise<{ default: T }>(() => {});
        }
        throw error;
      }
    }
  });
}
