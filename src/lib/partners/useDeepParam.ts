/**
 * useDeepParam — shareable, restorable UI state in the URL.
 *
 * Interactive marketing state (which ecosystem tab, which maturity level, which
 * lifecycle stage) is written to the query string so a partner desk can send a
 * colleague the exact view they were looking at, and a reload restores it.
 * Unknown or tampered values fall back to the supplied default; history is
 * replaced rather than pushed so the back button still leaves the page.
 */
import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

export function useDeepParam(
  key: string,
  valid: readonly string[],
  fallback: string,
): [string, (value: string) => void] {
  const [params, setParams] = useSearchParams();

  const raw = params.get(key);
  const value = useMemo(
    () => (raw && valid.includes(raw) ? raw : fallback),
    [raw, valid, fallback],
  );

  const set = useCallback(
    (next: string) => {
      if (!valid.includes(next)) return;
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (next === fallback) p.delete(key);
          else p.set(key, next);
          return p;
        },
        { replace: true },
      );
    },
    [key, valid, fallback, setParams],
  );

  return [value, set];
}
