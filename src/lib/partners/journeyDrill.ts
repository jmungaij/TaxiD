/**
 * PARTNER JOURNEY DRILL-DOWN — session-level view of the captured funnel.
 *
 * The comparison dashboard answers "which frame, intent or level performs?".
 * This module answers "what did one visitor actually do?": every `cta_events`
 * row belonging to the partner experience is grouped into a session journey
 * with the attributes that visitor declared (what they bring, the category, the
 * maturity level, the messaging frames they read, the lifecycle stages they
 * opened, the messaging variant they were shown) and an ordered timeline.
 *
 * Filters are applied to raw events before aggregation, so the same predicate
 * drives the comparison tables, the journey list and the drill-through page —
 * one definition, no drift. Pure and dependency-free.
 */
import { CATEGORY_LABEL, BRING_OPTIONS, MATURITY_LEVELS } from "@/lib/partners/intent";
import { LIFECYCLE } from "@/lib/partners/workspaceLifecycle";
import { VARIANT_LABEL } from "@/lib/partners/abTest";
import { FRAME_LABEL, isPartnerFunnelEvent, stepOf, type FunnelStep, type RawCtaEvent } from "@/lib/partners/funnelAnalytics";

/* ------------------------------------------------------------- attributes */

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;

export type DrillKey = "frame" | "bring" | "category" | "level" | "stage" | "variant";

export interface DrillFilterOption {
  key: DrillKey;
  label: string;
  /** Plain-language help for the staff user. */
  hint: string;
  values: Array<{ id: string; label: string }>;
}

const LEVEL_LABEL: Record<string, string> = Object.fromEntries(
  MATURITY_LEVELS.map((l, i) => [l.id, `Level ${i + 1} — ${l.label}`]),
);
const STAGE_LABEL: Record<string, string> = Object.fromEntries(
  LIFECYCLE.map((s) => [s.id, `${s.n} ${s.label}`]),
);
const BRING_LABEL: Record<string, string> = Object.fromEntries(
  BRING_OPTIONS.map((b) => [b.key, b.answer]),
);

export const DRILL_LABELS: Record<DrillKey, Record<string, string>> = {
  frame: FRAME_LABEL,
  bring: BRING_LABEL,
  category: CATEGORY_LABEL,
  level: LEVEL_LABEL,
  stage: STAGE_LABEL,
  variant: VARIANT_LABEL as Record<string, string>,
};

export const DRILL_FILTERS: DrillFilterOption[] = [
  {
    key: "frame",
    label: "Messaging frame",
    hint: "Customer, service, no-asset fulfilment or margin.",
    values: Object.entries(FRAME_LABEL).map(([id, label]) => ({ id, label })),
  },
  {
    key: "bring",
    label: "What they bring",
    hint: "Customers, capacity or technology reach.",
    values: Object.entries(BRING_LABEL).map(([id, label]) => ({ id, label })),
  },
  {
    key: "category",
    label: "Partner category",
    hint: "The ecosystem category they identified with.",
    values: Object.entries(CATEGORY_LABEL).map(([id, label]) => ({ id, label })),
  },
  {
    key: "level",
    label: "Maturity level",
    hint: "How deeply they expect to integrate.",
    values: Object.entries(LEVEL_LABEL).map(([id, label]) => ({ id, label })),
  },
  {
    key: "stage",
    label: "Lifecycle stage",
    hint: "The workspace stage they opened.",
    values: Object.entries(STAGE_LABEL).map(([id, label]) => ({ id, label })),
  },
  {
    key: "variant",
    label: "Messaging variant",
    hint: "Which arm of the messaging experiment they saw.",
    values: Object.entries(VARIANT_LABEL).map(([id, label]) => ({ id, label })),
  },
];

const PICKERS: Record<DrillKey, (e: RawCtaEvent) => string | undefined> = {
  frame: (e) => str(e.metadata?.frame) ?? (e.button_name.includes("partner_economics") ? str(e.target) : undefined),
  bring: (e) => str(e.metadata?.bring) ?? (e.button_name.includes("partner_bring") ? str(e.target) : undefined),
  category: (e) => str(e.metadata?.category) ?? (e.button_name.includes("category_selected") ? str(e.target) : undefined),
  level: (e) => str(e.metadata?.level) ?? (e.button_name.includes("maturity_level") ? str(e.target) : undefined),
  stage: (e) => str(e.metadata?.stage) ?? (e.button_name.includes("partner_workspace_stage") ? str(e.target) : undefined),
  variant: (e) => str(e.metadata?.variant),
};

export const attributeOf = (e: RawCtaEvent, key: DrillKey): string | undefined => {
  const raw = PICKERS[key](e);
  return raw && DRILL_LABELS[key][raw] ? raw : undefined;
};

/* ---------------------------------------------------------------- filters */

export type DrillFilters = Partial<Record<DrillKey, string>>;

export const activeFilterCount = (f: DrillFilters): number =>
  Object.values(f).filter(Boolean).length;

/**
 * Keep sessions whose journey matches every selected filter. Filtering is at
 * session level, not event level: a visitor who chose "I bring capacity" and
 * then read the margin frame is still one capacity journey.
 */
export function filterPartnerEvents(events: RawCtaEvent[], filters: DrillFilters): RawCtaEvent[] {
  const partnerEvents = events.filter(isPartnerFunnelEvent);
  const selected = (Object.entries(filters) as Array<[DrillKey, string | undefined]>)
    .filter((pair): pair is [DrillKey, string] => Boolean(pair[1]));
  if (selected.length === 0) return partnerEvents;

  const bySession = new Map<string, Set<string>>();
  for (const e of partnerEvents) {
    const sid = e.session_id ?? "unattributed";
    let set = bySession.get(sid);
    if (!set) { set = new Set(); bySession.set(sid, set); }
    for (const [key] of selected) {
      const value = attributeOf(e, key);
      if (value) set.add(`${key}:${value}`);
    }
  }

  const keep = new Set<string>();
  for (const [sid, set] of bySession) {
    if (selected.every(([key, value]) => set.has(`${key}:${value}`))) keep.add(sid);
  }
  return partnerEvents.filter((e) => keep.has(e.session_id ?? "unattributed"));
}

/* --------------------------------------------------------------- journeys */

export interface JourneyEvent {
  at: string;
  step: FunnelStep;
  buttonName: string;
  target: string | null;
  pageSource: string | null;
  attributes: Partial<Record<DrillKey, string>>;
}

export interface PartnerJourney {
  sessionId: string;
  firstSeen: string;
  lastSeen: string;
  counts: Record<FunnelStep, number>;
  /** Declared attributes, latest declaration winning. */
  bring?: string;
  category?: string;
  level?: string;
  variant?: string;
  frames: string[];
  stages: string[];
  /** True when the journey reached a CTA. */
  reachedCta: boolean;
  events: JourneyEvent[];
}

export function buildJourneys(events: RawCtaEvent[]): PartnerJourney[] {
  const bySession = new Map<string, RawCtaEvent[]>();
  for (const e of events.filter(isPartnerFunnelEvent)) {
    const sid = e.session_id ?? "unattributed";
    const list = bySession.get(sid);
    if (list) list.push(e); else bySession.set(sid, [e]);
  }

  const journeys: PartnerJourney[] = [];
  for (const [sessionId, rows] of bySession) {
    const ordered = [...rows].sort((a, b) => Date.parse(a.clicked_at) - Date.parse(b.clicked_at));
    const counts: Record<FunnelStep, number> = { view: 0, interact: 0, cta: 0 };
    const frames = new Set<string>();
    const stages = new Set<string>();
    let bring: string | undefined;
    let category: string | undefined;
    let level: string | undefined;
    let variant: string | undefined;

    const timeline: JourneyEvent[] = ordered.map((e) => {
      const step = stepOf(e);
      counts[step] += 1;
      const attributes: Partial<Record<DrillKey, string>> = {};
      for (const key of Object.keys(PICKERS) as DrillKey[]) {
        const value = attributeOf(e, key);
        if (value) attributes[key] = value;
      }
      if (attributes.frame) frames.add(attributes.frame);
      if (attributes.stage) stages.add(attributes.stage);
      if (attributes.bring) bring = attributes.bring;
      if (attributes.category) category = attributes.category;
      if (attributes.level) level = attributes.level;
      if (attributes.variant) variant = attributes.variant;
      return {
        at: e.clicked_at,
        step,
        buttonName: e.button_name,
        target: e.target,
        pageSource: e.page_source,
        attributes,
      };
    });

    journeys.push({
      sessionId,
      firstSeen: ordered[0]?.clicked_at ?? new Date(0).toISOString(),
      lastSeen: ordered[ordered.length - 1]?.clicked_at ?? new Date(0).toISOString(),
      counts,
      bring, category, level, variant,
      frames: Array.from(frames),
      stages: Array.from(stages),
      reachedCta: counts.cta > 0,
      events: timeline,
    });
  }

  return journeys.sort((a, b) => Date.parse(b.lastSeen) - Date.parse(a.lastSeen));
}

export const findJourney = (journeys: PartnerJourney[], sessionId: string): PartnerJourney | undefined =>
  journeys.find((j) => j.sessionId === sessionId);

export const labelOf = (key: DrillKey, id: string | undefined): string =>
  (id && DRILL_LABELS[key][id]) || "—";

/** Flat journey list for CSV / PDF export. */
export function journeyTable(journeys: PartnerJourney[], windowLabel: string) {
  return {
    id: "partner-journeys",
    title: "Yalla Partners - individual partner journeys",
    subtitle: `Session-level view → interact → CTA (${windowLabel})`,
    meta: [
      ["Journeys", String(journeys.length)],
      ["Reached a CTA", String(journeys.filter((j) => j.reachedCta).length)],
    ] as Array<[string, string]>,
    columns: ["Session", "First seen", "Last seen", "Brings", "Category", "Level", "Variant", "Frames", "Stages", "Views", "Interactions", "CTA"],
    rows: journeys.map((j) => [
      j.sessionId,
      new Date(j.firstSeen).toISOString(),
      new Date(j.lastSeen).toISOString(),
      labelOf("bring", j.bring),
      labelOf("category", j.category),
      labelOf("level", j.level),
      labelOf("variant", j.variant),
      j.frames.map((f) => labelOf("frame", f)).join("; ") || "—",
      j.stages.map((s) => labelOf("stage", s)).join("; ") || "—",
      j.counts.view,
      j.counts.interact,
      j.counts.cta,
    ]),
  };
}
