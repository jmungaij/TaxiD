/**
 * Lightweight in-memory TTL cache for client dashboards.
 *
 * Supports stale-while-revalidate (SWR): callers can read stale values instantly
 * for a snappy tab-switch UX while a background refetch is scheduled. Also exposes
 * `invalidate()` so mutation callers (e.g. role changes, rider updates) can
 * force the next reader to refetch.
 */
export type TtlEntry<T> = { value: T; fresh: boolean };

export function createTtlCache<T>(ttlMs = 60_000, staleMs = 5 * 60_000) {
  let value: T | null = null;
  let expiresAt = 0;
  let staleUntil = 0;
  return {
    /** Fresh-only read: returns null once the TTL elapses. */
    get(): T | null {
      if (!value || Date.now() > expiresAt) return null;
      return value;
    },
    /**
     * SWR read: returns any value still within the stale window with a `fresh`
     * flag so callers can decide whether to trigger a background refresh.
     */
    getWithFreshness(): TtlEntry<T> | null {
      if (!value) return null;
      const now = Date.now();
      if (now > staleUntil) return null;
      return { value, fresh: now <= expiresAt };
    },
    set(v: T) {
      value = v;
      const now = Date.now();
      expiresAt = now + ttlMs;
      staleUntil = now + ttlMs + staleMs;
    },
    invalidate() {
      value = null;
      expiresAt = 0;
      staleUntil = 0;
    },
  };
}

export function createKeyedTtlCache<K extends string, T>(ttlMs = 60_000, staleMs = 5 * 60_000) {
  const store = new Map<K, { value: T; expiresAt: number; staleUntil: number }>();
  return {
    get(key: K): T | null {
      const hit = store.get(key);
      if (!hit) return null;
      if (Date.now() > hit.expiresAt) { return null; }
      return hit.value;
    },
    getWithFreshness(key: K): TtlEntry<T> | null {
      const hit = store.get(key);
      if (!hit) return null;
      const now = Date.now();
      if (now > hit.staleUntil) { store.delete(key); return null; }
      return { value: hit.value, fresh: now <= hit.expiresAt };
    },
    set(key: K, value: T) {
      const now = Date.now();
      store.set(key, { value, expiresAt: now + ttlMs, staleUntil: now + ttlMs + staleMs });
    },
    invalidate(key?: K) {
      if (key == null) store.clear();
      else store.delete(key);
    },
  };
}
