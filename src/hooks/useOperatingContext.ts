import { useEffect, useState } from "react";
import { resolveOperatingContexts, type ResolvedIdentity } from "@/lib/platform/operatingContextApi";

/**
 * Server-resolved identity envelope (contexts, organisation, resolved role).
 * Client role state is never trusted for authority — this is the authoritative
 * source for what the chrome may offer and display.
 */
export function useOperatingContext() {
  const [identity, setIdentity] = useState<ResolvedIdentity | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    void resolveOperatingContexts().then((r) => {
      if (!alive) return;
      setIdentity(r);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  return { identity, loading };
}
