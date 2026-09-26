/**
 * PARTNER FUNNEL ANALYTICS — comparison model for the /partners captured funnel.
 *
 * The public partner experience already writes every meaningful interaction to
 * `cta_events` with a `funnel_step` of view, interact or cta. This module turns
 * those raw events into a comparison across the dimensions the page is built
 * around:
 *   • messaging frame  — customer, service, no-asset fulfilment, margin
 *   • partner intent   — what the visitor said they bring
 *   • ecosystem        — distribution vs supply, and the category chosen
 *   • maturity level   — where they see themselves integrating
 *   • lifecycle stage  — which part of the workspace story held them
 *
 * Pure and dependency-free so it is unit-testable: the page fetches, this maps.
 */
import { BRING_OPTIONS, CATEGORY_LABEL, MATURITY_LEVELS } from "@/lib/partners/intent";
import { LIFECYCLE } from "@/lib/partners/workspaceLifecycle";

export type FunnelStep = "view" | "interact" | "cta";

export interface RawCtaEvent {
  button_name: string;
  action_type: string;
  target: string | null;
  page_source: string | null;
  session_id: string | null;
  clicked_at: string;
  metadata: Record<string, unknown> | null;
}

export interface FunnelRow {
  id: string;
  label: string;
  view: number;
  interact: number;
  cta: number;
  sessions: number;
  /** interact / view, as a percentage. 0 when there is nothing to divide. */
  interactRatePct: number;
  /** cta / interact, as a percentage. */
  ctaRatePct: number;
}

export interface FunnelDimension {
  key: string;
  label: string;
  /** What the dimension answers, for the dashboard subtitle. */
  question: string;
  rows: FunnelRow[];
}

export interface FunnelSummary {
  totals: Record<FunnelStep, number>;
  sessions: number;
  dimensions: FunnelDimension[];
  /** Most recent event timestamp in the window, if any. */
  lastEventAt: string | null;
}

/** The economics section's frames are the messaging frames under test. */
export const FRAME_LABEL: Record<string, string> = {
  acquire: "Customer — acquire customers",
  services: "Service — sell more mobility",
  network: "No assets — fulfil without owning",
  margin: "Margin — earn and manage margin",
};

const LEVEL_LABEL: Record<string, string> = Object.fromEntries(
  MATURITY_LEVELS.map((l, i) => [l.id, `Level ${i + 1} — ${l.label}`]),
);

const STAGE_LABEL: Record<string, string> = Object.fromEntries(
  LIFECYCLE.map((s) => [s.id, `${s.n} ${s.label}`]),
);

const BRING_LABEL: Record<string, string> = Object.fromEntries(
  BRING_OPTIONS.map((b) => [b.key, b.answer]),
);

const ECOSYSTEM_LABEL: Record<string, string> = {
  distribution: "Distribution — brings demand",
  supply: "Supply — brings capacity",
};

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;

export function stepOf(e: RawCtaEvent): FunnelStep {
  const declared = str(e.metadata?.funnel_step);
  if (declared === "view") return "view";
  if (declared === "cta") return "cta";
  if (declared === "interact" || declared === "first_interact") return "interact";
  if (e.action_type === "scroll") return "view";
  if (e.action_type === "navigate" || e.action_type === "submit" || e.action_type === "external") return "cta";
  return "interact";
}

/** Only events produced by the public partner experience are compared. */
export const isPartnerFunnelEvent = (e: RawCtaEvent): boolean =>
  (e.page_source ?? "").startsWith("/partners") || (e.page_source ?? "").startsWith("/partner/");

interface DimensionSpec {
  key: string;
  label: string;
  question: string;
  labels: Record<string, string>;
  /** Resolve the dimension value an event belongs to, if any. */
  pick: (e: RawCtaEvent) => string | undefined;
}

const byName = (e: RawCtaEvent, ...names: string[]) =>
  names.some((n) => e.button_name.includes(n)) ? str(e.target) : undefined;

const SPECS: DimensionSpec[] = [
  {
    key: "frame",
    label: "Messaging frame",
    question: "Which commercial argument earns attention: customer, service, no-asset fulfilment or margin?",
    labels: FRAME_LABEL,
    pick: (e) => str(e.metadata?.frame) ?? byName(e, "partner_economics"),
  },
  {
    key: "bring",
    label: "Partner intent",
    question: "What did the visitor say they bring to Yalla?",
    labels: BRING_LABEL,
    pick: (e) => str(e.metadata?.bring) ?? byName(e, "partner_bring"),
  },
  {
    key: "ecosystem",
    label: "Ecosystem",
    question: "Demand side or capacity side?",
    labels: ECOSYSTEM_LABEL,
    pick: (e) => str(e.metadata?.ecosystem) ?? byName(e, "partner_ecosystem_selected"),
  },
  {
    key: "category",
    label: "Partner category",
    question: "Which category of partner did they identify with?",
    labels: CATEGORY_LABEL,
    pick: (e) => str(e.metadata?.category) ?? byName(e, "category_selected"),
  },
  {
    key: "level",
    label: "Maturity level",
    question: "How deeply do they expect to integrate?",
    labels: LEVEL_LABEL,
    pick: (e) => str(e.metadata?.level) ?? byName(e, "maturity_level"),
  },
  {
    key: "stage",
    label: "Lifecycle stage",
    question: "Which part of the customer-to-settlement story held them?",
    labels: STAGE_LABEL,
    pick: (e) => str(e.metadata?.stage) ?? byName(e, "partner_workspace_stage"),
  },
];

const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 10 : 0);

export function summarisePartnerFunnel(events: RawCtaEvent[]): FunnelSummary {
  const rows = events.filter(isPartnerFunnelEvent);
  const totals: Record<FunnelStep, number> = { view: 0, interact: 0, cta: 0 };
  const allSessions = new Set<string>();
  let lastEventAt: string | null = null;

  const buckets = new Map<string, Map<string, { counts: Record<FunnelStep, number>; sessions: Set<string> }>>();
  for (const spec of SPECS) buckets.set(spec.key, new Map());

  for (const e of rows) {
    const step = stepOf(e);
    totals[step] += 1;
    if (e.session_id) allSessions.add(e.session_id);
    if (!lastEventAt || Date.parse(e.clicked_at) > Date.parse(lastEventAt)) lastEventAt = e.clicked_at;

    for (const spec of SPECS) {
      const value = spec.pick(e);
      if (!value || !spec.labels[value]) continue;
      const dim = buckets.get(spec.key)!;
      let cell = dim.get(value);
      if (!cell) {
        cell = { counts: { view: 0, interact: 0, cta: 0 }, sessions: new Set() };
        dim.set(value, cell);
      }
      cell.counts[step] += 1;
      if (e.session_id) cell.sessions.add(e.session_id);
    }
  }

  const dimensions: FunnelDimension[] = SPECS.map((spec) => {
    const dim = buckets.get(spec.key)!;
    const out: FunnelRow[] = Object.keys(spec.labels)
      .map((id) => {
        const cell = dim.get(id);
        const counts = cell?.counts ?? { view: 0, interact: 0, cta: 0 };
        return {
          id,
          label: spec.labels[id],
          view: counts.view,
          interact: counts.interact,
          cta: counts.cta,
          sessions: cell?.sessions.size ?? 0,
          interactRatePct: pct(counts.interact, counts.view),
          ctaRatePct: pct(counts.cta, counts.interact),
        };
      })
      .sort((a, b) => b.cta - a.cta || b.interact - a.interact || b.view - a.view || a.label.localeCompare(b.label));
    return { key: spec.key, label: spec.label, question: spec.question, rows: out };
  });

  return { totals, sessions: allSessions.size, dimensions, lastEventAt };
}

/** Flat comparison table for CSV / PDF export. */
export function funnelComparisonTable(summary: FunnelSummary, windowLabel: string) {
  return {
    id: "partner-funnel-comparison",
    title: "Yalla Partners - captured funnel comparison",
    subtitle: `View to interact to CTA, by dimension (${windowLabel})`,
    meta: [
      ["Views", String(summary.totals.view)],
      ["Interactions", String(summary.totals.interact)],
      ["CTA clicks", String(summary.totals.cta)],
      ["Distinct sessions", String(summary.sessions)],
      ["Last event", summary.lastEventAt ?? "none"],
    ] as Array<[string, string]>,
    columns: ["Dimension", "Value", "Views", "Interactions", "CTA clicks", "Sessions", "Interact %", "CTA %"],
    rows: summary.dimensions.flatMap((d) =>
      d.rows.map((r) => [
        d.label, r.label, r.view, r.interact, r.cta, r.sessions,
        r.interactRatePct.toFixed(1), r.ctaRatePct.toFixed(1),
      ]),
    ),
  };
}
