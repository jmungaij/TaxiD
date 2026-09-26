/**
 * Route head ownership.
 *
 * A page that renders <SeoHead> owns its route's head metadata. RouteSEO (the
 * marketing-layout fallback) checks this registry and stays silent on claimed
 * routes, so a route never emits two sets of title/og:* tags.
 */
import { useEffect, useSyncExternalStore } from "react";

const claimed = new Set<string>();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

/** Register that a page component manages the head for `path`. */
export function useClaimRouteHead(path: string) {
  useEffect(() => {
    if (!claimed.has(path)) {
      claimed.add(path);
      emit();
    }
  }, [path]);
}

/** True once a page component has claimed `path`. */
export function useRouteHeadClaimed(path: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => claimed.has(path),
  );
}
