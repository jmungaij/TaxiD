import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { corporateControlFor, trackCorporateControlOpen } from "@/lib/navigation/corporateControls";

/**
 * Fires a single "open" analytics event whenever the user lands on one of the
 * Corporate Controls destinations (including `?tab=` deep links). Deduplicated
 * per href so tab re-renders never inflate the numbers.
 */
export function useCorporateControlAnalytics(): void {
  const location = useLocation();
  const lastTracked = useRef<string | null>(null);

  useEffect(() => {
    const href = `${location.pathname}${location.search}`;
    if (lastTracked.current === href) return;
    const control = corporateControlFor(href);
    if (!control) return;
    lastTracked.current = href;
    trackCorporateControlOpen(control, href);
  }, [location.pathname, location.search]);
}
