import { ReactNode, useEffect, useRef, useState } from "react";

/**
 * Defers rendering (and therefore image/asset fetching) of a non-critical page
 * section until it is close to the viewport, then mounts it permanently.
 *
 * Safety rules — this must never hide content from users or crawlers:
 *   - when IntersectionObserver is unavailable (jsdom, old Safari, crawlers
 *     without IO) the section renders immediately;
 *   - a requestIdleCallback / timeout fallback mounts the section even if the
 *     user never scrolls, so in-page anchors and Ctrl+F still find the text;
 *   - a min-height placeholder reserves space so deferred mounting cannot
 *     shift layout above it (CLS-neutral).
 */
export function LazySection({
  children,
  minHeight = 320,
  rootMargin = "400px",
  idleDelayMs = 2500,
  className,
}: {
  children: ReactNode;
  /** Reserved height in px while the section is not yet mounted. */
  minHeight?: number;
  rootMargin?: string;
  idleDelayMs?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(
    () => typeof IntersectionObserver === "undefined",
  );

  useEffect(() => {
    if (shown) return;
    const el = ref.current;
    let observer: IntersectionObserver | undefined;
    if (el) {
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            setShown(true);
            observer?.disconnect();
          }
        },
        { rootMargin },
      );
      observer.observe(el);
    }

    // Never leave content permanently unmounted for non-scrolling agents.
    const idle = window.setTimeout(() => setShown(true), idleDelayMs);

    return () => {
      observer?.disconnect();
      window.clearTimeout(idle);
    };
  }, [shown, rootMargin, idleDelayMs]);

  return (
    <div ref={ref} className={className} style={shown ? undefined : { minHeight }}>
      {shown ? children : null}
    </div>
  );
}

export default LazySection;
