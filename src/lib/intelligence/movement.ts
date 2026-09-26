/**
 * DEAL MOVEMENT — what changed, not just where the deal is.
 *
 * Reads the append-only `commercial_opportunity_changes` log written by the
 * database trigger, and turns it into the indicators a pipeline inspection view
 * needs: value up/down, stage moved, owner moved, close date moved, nothing
 * happened at all.
 *
 * Pure functions here; the read sits at the bottom.
 */
import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface OpportunityChange {
  id: string;
  opportunityId: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  deltaCents: number | null;
  changedAt: string;
  changedBy: string | null;
}

export type MovementIndicator =
  | "value_up"
  | "value_down"
  | "stage_advanced"
  | "stage_regressed"
  | "owner_changed"
  | "probability_up"
  | "probability_down"
  | "marked_lost"
  | "no_change";

export interface MovementSummary {
  opportunityId: string;
  windowDays: number;
  indicators: MovementIndicator[];
  netValueDeltaCents: number;
  stageFrom: string | null;
  stageTo: string | null;
  changeCount: number;
  /** Human lines, each traceable to one logged change. */
  lines: string[];
}

/** Ladder order used to tell an advance from a regression. */
const LADDER = ["new", "qualified", "quoted", "proposal", "negotiation", "won"];
const rank = (stage: string | null): number => (stage ? LADDER.indexOf(stage.toLowerCase()) : -1);

const kes = (cents: number): string =>
  `KES ${(Math.abs(cents) / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export function summariseMovement(
  opportunityId: string,
  changes: OpportunityChange[],
  windowDays = 7,
  now: Date = new Date(),
): MovementSummary {
  const cutoff = now.getTime() - windowDays * 86_400_000;
  const recent = changes
    .filter((c) => c.opportunityId === opportunityId && new Date(c.changedAt).getTime() >= cutoff)
    .sort((a, b) => a.changedAt.localeCompare(b.changedAt));

  const indicators: MovementIndicator[] = [];
  const lines: string[] = [];
  let netValueDeltaCents = 0;
  let stageFrom: string | null = null;
  let stageTo: string | null = null;

  for (const c of recent) {
    if (c.field === "expected_value_cents") {
      netValueDeltaCents += c.deltaCents ?? 0;
      continue;
    }
    if (c.field === "stage") {
      stageFrom = stageFrom ?? c.oldValue;
      stageTo = c.newValue;
      continue;
    }
    if (c.field === "owner_user_id") {
      indicators.push("owner_changed");
      lines.push("Owner changed.");
      continue;
    }
    if (c.field === "probability_pct") {
      const from = Number(c.oldValue ?? NaN);
      const to = Number(c.newValue ?? NaN);
      if (Number.isFinite(from) && Number.isFinite(to) && to !== from) {
        indicators.push(to > from ? "probability_up" : "probability_down");
        lines.push(`Confidence ${from}% → ${to}%.`);
      }
      continue;
    }
    if (c.field === "lost_reason" && c.newValue) {
      indicators.push("marked_lost");
      lines.push(`Loss reason recorded: ${c.newValue}.`);
    }
  }

  if (netValueDeltaCents !== 0) {
    indicators.push(netValueDeltaCents > 0 ? "value_up" : "value_down");
    lines.unshift(`Value ${netValueDeltaCents > 0 ? "increased" : "decreased"} by ${kes(netValueDeltaCents)}.`);
  }
  if (stageTo && stageTo !== stageFrom) {
    const advanced = rank(stageTo) > rank(stageFrom);
    indicators.push(advanced ? "stage_advanced" : "stage_regressed");
    lines.unshift(`Stage ${stageFrom ?? "unknown"} → ${stageTo}.`);
  }
  if (indicators.length === 0) {
    indicators.push("no_change");
    lines.push(`Nothing changed on this deal in ${windowDays} days.`);
  }

  return {
    opportunityId,
    windowDays,
    indicators,
    netValueDeltaCents,
    stageFrom,
    stageTo,
    changeCount: recent.length,
    lines,
  };
}

export const INDICATOR_LABEL: Record<MovementIndicator, string> = {
  value_up: "Value increased",
  value_down: "Value decreased",
  stage_advanced: "Stage advanced",
  stage_regressed: "Stage moved back",
  owner_changed: "Owner changed",
  probability_up: "Confidence up",
  probability_down: "Confidence down",
  marked_lost: "Loss reason recorded",
  no_change: "No change",
};

/** Group movement summaries into the one-line weekly narrative managers ask for. */
export function movementNarrative(summaries: MovementSummary[]): string[] {
  const up = summaries.filter((s) => s.indicators.includes("value_up"));
  const down = summaries.filter((s) => s.indicators.includes("value_down"));
  const advanced = summaries.filter((s) => s.indicators.includes("stage_advanced"));
  const still = summaries.filter((s) => s.indicators.includes("no_change"));
  const out: string[] = [];
  if (advanced.length) out.push(`${advanced.length} deal(s) advanced a stage.`);
  if (up.length) out.push(`${up.length} deal(s) grew in value.`);
  if (down.length) out.push(`${down.length} deal(s) shrank in value.`);
  if (still.length) out.push(`${still.length} deal(s) did not move at all.`);
  if (out.length === 0) out.push("No recorded pipeline movement in this window.");
  return out;
}

/* ------------------------------------------------------------------- reads */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fromRow = (r: any): OpportunityChange => ({
  id: String(r.id),
  opportunityId: String(r.opportunity_id),
  field: String(r.field),
  oldValue: (r.old_value as string) ?? null,
  newValue: (r.new_value as string) ?? null,
  deltaCents: (r.delta_cents as number) ?? null,
  changedAt: String(r.changed_at),
  changedBy: (r.changed_by as string) ?? null,
});

export async function fetchOpportunityChanges(opts: {
  opportunityIds?: string[];
  sinceDays?: number;
  limit?: number;
} = {}): Promise<OpportunityChange[]> {
  let q = db
    .from("commercial_opportunity_changes")
    .select("id, opportunity_id, field, old_value, new_value, delta_cents, changed_at, changed_by")
    .order("changed_at", { ascending: false });
  if (opts.opportunityIds?.length) q = q.in("opportunity_id", opts.opportunityIds);
  if (opts.sinceDays) {
    const since = new Date(Date.now() - opts.sinceDays * 86_400_000).toISOString();
    q = q.gte("changed_at", since);
  }
  const { data, error } = await q.limit(opts.limit ?? 1000);
  if (error) throw new Error(error.message);
  return (data ?? []).map(fromRow);
}
