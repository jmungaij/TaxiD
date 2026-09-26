/**
 * PARTNER MESSAGING EXPERIMENT — reporting.
 *
 * Compares the two messaging arms (`outcome` vs `operational`) across the
 * captured funnel — view → interact → CTA — overall and segmented by what the
 * visitor said they bring (intent) and by the maturity level they selected.
 *
 * Honesty rules applied here, not in the UI:
 *  • an arm with no captured views is reported as having no data, never as 0%;
 *  • a comparison is only called a winner once both arms clear a minimum
 *    exposure, otherwise it is reported as "not yet conclusive";
 *  • no statistical significance is claimed — the report states counted rates,
 *    the difference between them, and whether exposure is sufficient to read.
 */
import { BRING_OPTIONS, MATURITY_LEVELS } from "@/lib/partners/intent";
import { FRAME_VARIANTS, VARIANT_LABEL, type FrameVariant } from "@/lib/partners/abTest";
import { attributeOf } from "@/lib/partners/journeyDrill";
import { isPartnerFunnelEvent, stepOf, type FunnelStep, type RawCtaEvent } from "@/lib/partners/funnelAnalytics";

/** Minimum views per arm before a comparison may be read as a result. */
export const MIN_VIEWS_PER_ARM = 30;

export interface ArmStats {
  variant: FrameVariant;
  label: string;
  view: number;
  interact: number;
  cta: number;
  sessions: number;
  /** interact / view as a percentage, or null when there is nothing to divide. */
  interactRatePct: number | null;
  /** cta / view as a percentage, or null when there is nothing to divide. */
  ctaRatePct: number | null;
}

export interface AbComparison {
  /** Segment key: "overall", a bring key or a maturity level id. */
  key: string;
  label: string;
  segment: "overall" | "intent" | "maturity";
  arms: ArmStats[];
  /** Best arm on CTA rate, only when both arms clear MIN_VIEWS_PER_ARM. */
  leader: FrameVariant | null;
  /** Percentage-point difference in CTA rate between the arms. */
  ctaRateGapPp: number | null;
  conclusive: boolean;
  /** Plain-language reading of the comparison. */
  verdict: string;
}

export interface AbReport {
  comparisons: AbComparison[];
  overall: AbComparison;
  /** Total events attributed to a variant. */
  attributed: number;
  /** Events with no variant recorded (captured before the experiment shipped). */
  unattributed: number;
}

const pct = (num: number, den: number): number | null =>
  den > 0 ? Math.round((num / den) * 1000) / 10 : null;

interface Cell {
  counts: Record<FunnelStep, number>;
  sessions: Set<string>;
}

const emptyCell = (): Cell => ({ counts: { view: 0, interact: 0, cta: 0 }, sessions: new Set() });

function arm(variant: FrameVariant, cell: Cell | undefined): ArmStats {
  const counts = cell?.counts ?? { view: 0, interact: 0, cta: 0 };
  return {
    variant,
    label: VARIANT_LABEL[variant],
    view: counts.view,
    interact: counts.interact,
    cta: counts.cta,
    sessions: cell?.sessions.size ?? 0,
    interactRatePct: pct(counts.interact, counts.view),
    ctaRatePct: pct(counts.cta, counts.view),
  };
}

function compare(key: string, label: string, segment: AbComparison["segment"], cells: Map<string, Cell>): AbComparison {
  const arms = FRAME_VARIANTS.map((v) => arm(v, cells.get(v)));
  const enough = arms.every((a) => a.view >= MIN_VIEWS_PER_ARM);
  const withRates = arms.filter((a) => a.ctaRatePct !== null);
  const sorted = [...withRates].sort((a, b) => (b.ctaRatePct ?? 0) - (a.ctaRatePct ?? 0));
  const gap =
    sorted.length === 2 ? Math.round(((sorted[0].ctaRatePct ?? 0) - (sorted[1].ctaRatePct ?? 0)) * 10) / 10 : null;

  let verdict: string;
  if (arms.every((a) => a.view === 0)) {
    verdict = "No exposure captured for this segment yet.";
  } else if (!enough) {
    const short = arms
      .filter((a) => a.view < MIN_VIEWS_PER_ARM)
      .map((a) => `${a.label} has ${a.view} of ${MIN_VIEWS_PER_ARM} views`)
      .join("; ");
    verdict = `Not yet conclusive — ${short}.`;
  } else if (gap === 0 || gap === null) {
    verdict = "Both arms convert at the same counted rate.";
  } else {
    verdict = `${sorted[0].label} leads on CTA rate by ${gap.toFixed(1)} percentage points (${sorted[0].ctaRatePct?.toFixed(1)}% vs ${sorted[1].ctaRatePct?.toFixed(1)}%).`;
  }

  return {
    key,
    label,
    segment,
    arms,
    leader: enough && gap !== null && gap > 0 ? sorted[0].variant : null,
    ctaRateGapPp: gap,
    conclusive: enough && gap !== null && gap > 0,
    verdict,
  };
}

export function buildAbReport(events: RawCtaEvent[]): AbReport {
  const overall = new Map<string, Cell>();
  const byIntent = new Map<string, Map<string, Cell>>();
  const byLevel = new Map<string, Map<string, Cell>>();
  let attributed = 0;
  let unattributed = 0;

  const bump = (cells: Map<string, Cell>, variant: string, step: FunnelStep, session: string | null) => {
    let cell = cells.get(variant);
    if (!cell) { cell = emptyCell(); cells.set(variant, cell); }
    cell.counts[step] += 1;
    if (session) cell.sessions.add(session);
  };

  // Attributes declared anywhere in a session apply to that session's events,
  // so a visitor who answers the intent router is compared under that intent.
  const partnerEvents = events.filter(isPartnerFunnelEvent);
  const sessionIntent = new Map<string, string>();
  const sessionLevel = new Map<string, string>();
  const sessionVariant = new Map<string, string>();
  for (const e of partnerEvents) {
    const sid = e.session_id;
    if (!sid) continue;
    const bring = attributeOf(e, "bring");
    if (bring) sessionIntent.set(sid, bring);
    const level = attributeOf(e, "level");
    if (level) sessionLevel.set(sid, level);
    const variant = attributeOf(e, "variant");
    if (variant) sessionVariant.set(sid, variant);
  }

  for (const e of partnerEvents) {
    const sid = e.session_id;
    const variant = attributeOf(e, "variant") ?? (sid ? sessionVariant.get(sid) : undefined);
    if (!variant) { unattributed += 1; continue; }
    attributed += 1;
    const step = stepOf(e);
    bump(overall, variant, step, sid ?? null);

    const intent = attributeOf(e, "bring") ?? (sid ? sessionIntent.get(sid) : undefined);
    if (intent) {
      let cells = byIntent.get(intent);
      if (!cells) { cells = new Map(); byIntent.set(intent, cells); }
      bump(cells, variant, step, sid ?? null);
    }

    const level = attributeOf(e, "level") ?? (sid ? sessionLevel.get(sid) : undefined);
    if (level) {
      let cells = byLevel.get(level);
      if (!cells) { cells = new Map(); byLevel.set(level, cells); }
      bump(cells, variant, step, sid ?? null);
    }
  }

  const overallComparison = compare("overall", "All partner traffic", "overall", overall);
  const comparisons: AbComparison[] = [overallComparison];

  for (const option of BRING_OPTIONS) {
    comparisons.push(compare(option.key, option.answer, "intent", byIntent.get(option.key) ?? new Map()));
  }
  MATURITY_LEVELS.forEach((level, i) => {
    comparisons.push(
      compare(level.id, `Level ${i + 1} — ${level.label}`, "maturity", byLevel.get(level.id) ?? new Map()),
    );
  });

  return { comparisons, overall: overallComparison, attributed, unattributed };
}

/** Flat experiment table for CSV / PDF export. */
export function abReportTable(report: AbReport, windowLabel: string) {
  return {
    id: "partner-messaging-experiment",
    title: "Yalla Partners - messaging experiment report",
    subtitle: `Messaging frames A/B, by intent and maturity (${windowLabel})`,
    meta: [
      ["Attributed events", String(report.attributed)],
      ["Events without a variant", String(report.unattributed)],
      ["Minimum views per arm", String(MIN_VIEWS_PER_ARM)],
      ["Overall reading", report.overall.verdict],
    ] as Array<[string, string]>,
    columns: ["Segment type", "Segment", "Variant", "Views", "Interactions", "CTA clicks", "Sessions", "Interact %", "CTA %", "Reading"],
    rows: report.comparisons.flatMap((c) =>
      c.arms.map((a) => [
        c.segment, c.label, a.label, a.view, a.interact, a.cta, a.sessions,
        a.interactRatePct === null ? "—" : a.interactRatePct.toFixed(1),
        a.ctaRatePct === null ? "—" : a.ctaRatePct.toFixed(1),
        c.verdict,
      ]),
    ),
  };
}
