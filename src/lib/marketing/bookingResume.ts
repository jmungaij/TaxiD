/**
 * Offline-friendly booking resume for the Employee Mobility funnel.
 *
 * Enterprise buyers frequently lose connectivity mid-request (lifts, campuses,
 * field sites). Rather than a service worker, this keeps the *commercial* state
 * recoverable: the in-progress enquiry is persisted locally on every change,
 * restored on return, and previous searches are saved so a visitor can resume
 * an abandoned funnel step after reconnecting.
 */

export interface BookingDraft {
  pickup: string;
  dropoff: string;
  date: string;
  time: string;
  passengers: string;
  frequency: string;
  /** Furthest funnel step reached before the draft was parked. */
  step?: string;
  updatedAt: string;
}

export interface SavedSearch extends BookingDraft {
  id: string;
  label: string;
}

const DRAFT_KEY = "yalla.em.booking_draft.v1";
const SEARCH_KEY = "yalla.em.saved_searches.v1";
const MAX_SAVED = 5;
/** Drafts older than this are treated as stale and ignored. */
export const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const store = (): Storage | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

const read = <T>(key: string, fallback: T): T => {
  try {
    const raw = store()?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

const write = (key: string, value: unknown) => {
  try {
    store()?.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / quota — resume simply degrades to in-memory */
  }
};

export const draftIsEmpty = (d: Pick<BookingDraft, "pickup" | "dropoff" | "date" | "time">): boolean =>
  !d.pickup.trim() && !d.dropoff.trim() && !d.date && !d.time;

export function saveDraft(draft: Omit<BookingDraft, "updatedAt">): void {
  if (draftIsEmpty(draft)) return;
  write(DRAFT_KEY, { ...draft, updatedAt: new Date().toISOString() } satisfies BookingDraft);
}

export function loadDraft(now = Date.now()): BookingDraft | null {
  const d = read<BookingDraft | null>(DRAFT_KEY, null);
  if (!d || typeof d.updatedAt !== "string") return null;
  const age = now - Date.parse(d.updatedAt);
  if (!Number.isFinite(age) || age > DRAFT_TTL_MS) {
    clearDraft();
    return null;
  }
  return d;
}

export function clearDraft(): void {
  try {
    store()?.removeItem(DRAFT_KEY);
  } catch {
    /* noop */
  }
}

/** Human label for a saved search: "Westlands → JKIA · 12 pax". */
export function describeSearch(d: Pick<BookingDraft, "pickup" | "dropoff" | "passengers">): string {
  const route = [d.pickup.trim() || "Pickup", d.dropoff.trim() || "Destination"].join(" → ");
  return `${route} · ${d.passengers || "?"} pax`;
}

export function savedSearches(): SavedSearch[] {
  return read<SavedSearch[]>(SEARCH_KEY, []).filter((s) => s && typeof s.id === "string");
}

/** Saves (de-duplicating by route + headcount) and returns the new list. */
export function saveSearch(draft: Omit<BookingDraft, "updatedAt">): SavedSearch[] {
  if (draftIsEmpty(draft)) return savedSearches();
  const label = describeSearch(draft);
  const entry: SavedSearch = {
    ...draft,
    id: `s_${Date.now().toString(36)}`,
    label,
    updatedAt: new Date().toISOString(),
  };
  const next = [entry, ...savedSearches().filter((s) => s.label !== label)].slice(0, MAX_SAVED);
  write(SEARCH_KEY, next);
  return next;
}

export function removeSearch(id: string): SavedSearch[] {
  const next = savedSearches().filter((s) => s.id !== id);
  write(SEARCH_KEY, next);
  return next;
}

/**
 * Subscribes to connectivity changes. Returns an unsubscribe function.
 * The callback fires immediately with the current state.
 */
export function watchConnectivity(cb: (online: boolean) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const emit = () => cb(navigator.onLine !== false);
  emit();
  window.addEventListener("online", emit);
  window.addEventListener("offline", emit);
  return () => {
    window.removeEventListener("online", emit);
    window.removeEventListener("offline", emit);
  };
}
