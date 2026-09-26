import { useEffect, useRef } from "react";

/**
 * Fires `onVisible` exactly once, the first time the element is at least
 * `threshold` visible in the viewport. Used for impression / visibility
 * telemetry so scroll-depth analytics never double-count a surface.
 *
 * Falls back to firing immediately when IntersectionObserver is unavailable
 * (older Safari, jsdom in unit tests) so impressions are never silently lost.
 */
export function useInViewOnce<T extends HTMLElement = HTMLDivElement>(
  onVisible: () => void,
  threshold = 0.5,
) {
  const ref = useRef<T | null>(null);
  const fired = useRef(false);
  const cb = useRef(onVisible);
  cb.current = onVisible;

  useEffect(() => {
    const el = ref.current;
    if (fired.current) return;
    if (typeof IntersectionObserver === "undefined") {
      fired.current = true;
      cb.current();
      return;
    }
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !fired.current) {
            fired.current = true;
            cb.current();
            observer.disconnect();
          }
        }
      },
      { threshold },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);

  return ref;
}
