/**
 * PIPELINE INSPECTION.
 *
 * The existing opportunity list answers "where is this deal". This answers the
 * three questions it cannot: what changed, whether it is still moving, and
 * whether it is genuinely ready for its next stage.
 *
 * It composes existing reads — it owns no records of its own:
 *   commercial_opportunities          (the deal, unchanged)
 *   commercial_opportunity_changes    (what changed, trigger-written)
 *   commercial_quotations             (whether a priced proposal exists)
 *   commercial_deal_stakeholders      (whether a decision maker is known)
 */
import { listBookOpportunities, listBookQuotations, type BookOpportunity, type BookQuotation } from "@/lib/workspace/commercialBook";
import { opportunityHealth, type Reading } from "@/lib/workspace/commercialIntelligence";
import { dealMomentum, type MomentumReading } from "./momentum";
import {
  fetchOpportunityChanges,
  summariseMovement,
  type MovementSummary,
  type OpportunityChange,
} from "./movement";
import { dealReadiness, nextReadinessStage, type ReadinessReading } from "./readiness";
import type { DerivedSignal } from "./signals";

export interface InspectionRow {
  opportunity: BookOpportunity;
  movement: MovementSummary;
  momentum: MomentumReading;
  health: Reading;
  readiness: ReadinessReading | null;
  hasProposal: boolean;
  proposals: BookQuotation[];
  /** Named stakeholder roles recorded on this deal. */
  stakeholderRoles: string[];
}

export interface InspectionInputs {
  opportunities: BookOpportunity[];
  quotations: BookQuotation[];
  changes: OpportunityChange[];
  stakeholderRolesByOpportunity: Record<string, string[]>;
  windowDays?: number;
  now?: Date;
}

const OPEN_STAGES = new Set(["new", "qualified", "quoted", "proposal", "negotiation"]);

export function buildInspection(input: InspectionInputs): InspectionRow[] {
  const now = input.now ?? new Date();
  const windowDays = input.windowDays ?? 7;

  return input.opportunities.map((opportunity) => {
    const proposals = input.quotations.filter((q) => q.opportunity_id === opportunity.id);
    const hasProposal = proposals.length > 0;
    const movement = summariseMovement(opportunity.id, input.changes, windowDays, now);
    const momentum = dealMomentum(
      {
        stage: opportunity.stage,
        valueCents: opportunity.expected_value_cents,
        updatedAt: opportunity.updated_at,
        hasProposal,
        movement,
      },
      now,
    );
    const health = opportunityHealth(
      {
        stage: opportunity.stage,
        updatedAt: opportunity.updated_at,
        valueCents: opportunity.expected_value_cents,
        probabilityPct: opportunity.probability_pct,
        hasProposal,
      },
      now,
    );
    const roles = input.stakeholderRolesByOpportunity[opportunity.id] ?? [];
    const target = nextReadinessStage(opportunity.stage);
    const readiness = target
      ? dealReadiness(target, {
          hasRecordedNeed: Boolean(opportunity.title?.trim()),
          hasNamedContact: roles.length > 0,
          hasExpectedValue: opportunity.expected_value_cents != null,
          hasNextAction: movement.changeCount > 0,
          hasPricedProposal: hasProposal,
          hasDecisionDate: proposals.some((p) => Boolean(p.valid_until)),
          hasDecisionMaker: roles.includes("decision_maker") || roles.includes("economic_buyer"),
          hasOpenObjectionRecorded: roles.includes("detractor"),
          hasApprovedCommercialTerms: proposals.some((p) => (p.approval_status ?? "").toLowerCase() === "approved"),
          hasLegalStatus: false,
          hasAuthorisedSignatory: false,
          hasOperationalRequirements: false,
        })
      : null;

    return { opportunity, movement, momentum, health, readiness, hasProposal, proposals, stakeholderRoles: roles };
  });
}

export const openRows = (rows: InspectionRow[]): InspectionRow[] =>
  rows.filter((r) => OPEN_STAGES.has(r.opportunity.stage.toLowerCase()));

/** Weighted pipeline from recorded value and recorded confidence only. */
export function inspectionTotals(rows: InspectionRow[]): {
  openCount: number;
  openValueCents: number;
  weightedValueCents: number;
  valuelessCount: number;
  idleCount: number;
  stalledCount: number;
  movedCount: number;
} {
  const open = openRows(rows);
  return {
    openCount: open.length,
    openValueCents: open.reduce((s, r) => s + (r.opportunity.expected_value_cents ?? 0), 0),
    weightedValueCents: open.reduce(
      (s, r) => s + ((r.opportunity.expected_value_cents ?? 0) * (r.opportunity.probability_pct ?? 0)) / 100,
      0,
    ),
    valuelessCount: open.filter((r) => r.opportunity.expected_value_cents == null).length,
    idleCount: open.filter((r) => r.momentum.idle).length,
    stalledCount: open.filter((r) => r.momentum.band === "stalled").length,
    movedCount: open.filter((r) => !r.movement.indicators.includes("no_change")).length,
  };
}

/* ---------------------------------------------------------------- producers */

/**
 * Turn inspection rows into signals for the register. Deterministic keys, so
 * re-running this updates rather than duplicates.
 */
export function deriveDealSignals(rows: InspectionRow[]): DerivedSignal[] {
  const out: DerivedSignal[] = [];

  for (const row of openRows(rows)) {
    const o = row.opportunity;
    const base = {
      source: "pipeline_inspection",
      entityType: "opportunity" as const,
      entityId: o.id,
      customerLabel: o.customer_label,
      commercialImpactCents: o.expected_value_cents,
    };

    if (row.momentum.band === "stalled" || row.momentum.idle) {
      out.push({
        ...base,
        signalKey: `deal_stalled:${o.id}`,
        type: "deal_stalled",
        severity: row.momentum.band === "stalled" ? "high" : "medium",
        urgency: row.momentum.band === "stalled" ? "today" : "normal",
        headline: `${o.title} — ${row.momentum.headline.toLowerCase()}`,
        evidence: [
          { label: "Idle", value: `${row.momentum.idleDays ?? "unknown"} day(s) against a ${row.momentum.idleThresholdDays}-day allowance` },
          { label: "Stage", value: o.stage },
          ...row.movement.lines.slice(0, 2).map((l) => ({ label: "Change", value: l })),
        ],
        recommendedAction: "Contact the customer and record the outcome.",
      });
    }

    if (row.movement.indicators.includes("value_down")) {
      out.push({
        ...base,
        signalKey: `deal_value_down:${o.id}`,
        type: "deal_value_down",
        severity: "medium",
        urgency: "normal",
        headline: `${o.title} — value reduced`,
        evidence: row.movement.lines.map((l) => ({ label: "Change", value: l })),
        recommendedAction: "Confirm what the customer removed from scope and reforecast.",
      });
    }

    if (row.movement.indicators.includes("value_up")) {
      out.push({
        ...base,
        signalKey: `deal_value_up:${o.id}`,
        type: "deal_value_up",
        severity: "info",
        urgency: "whenever",
        headline: `${o.title} — value increased`,
        evidence: row.movement.lines.map((l) => ({ label: "Change", value: l })),
        recommendedAction: "Check the larger scope is operationally feasible before committing.",
      });
    }

    if (row.readiness && !row.readiness.ready && ["proposal", "negotiation"].includes(row.readiness.stage)) {
      out.push({
        ...base,
        signalKey: `deal_not_ready:${o.id}:${row.readiness.stage}`,
        type: row.readiness.missing.some((m) => m.key === "hasDecisionMaker")
          ? "decision_maker_missing"
          : "data_quality",
        severity: "medium",
        urgency: "normal",
        headline: `${o.title} — ${row.readiness.headline.toLowerCase()}`,
        evidence: row.readiness.missing.map((m) => ({ label: m.label, value: m.why })),
        recommendedAction: `Establish: ${row.readiness.missing.map((m) => m.label.toLowerCase()).join(", ")}.`,
      });
    }

    const unanswered = row.proposals.filter((p) => (p.status ?? "").toLowerCase() === "sent");
    if (unanswered.length > 0) {
      const oldest = unanswered.reduce((a, b) => (a.created_at < b.created_at ? a : b));
      const days = Math.floor((Date.now() - new Date(oldest.created_at).getTime()) / 86_400_000);
      if (days >= 3) {
        out.push({
          ...base,
          signalKey: `proposal_unanswered:${oldest.id}`,
          type: "proposal_unanswered",
          severity: days >= 10 ? "high" : "medium",
          urgency: days >= 10 ? "today" : "normal",
          headline: `${o.title} — proposal unanswered for ${days} day(s)`,
          evidence: [
            { label: "Proposal", value: oldest.quote_number },
            { label: "Sent", value: `${days} day(s) ago` },
            { label: "Validity", value: oldest.valid_until ?? "no validity date recorded" },
          ],
          recommendedAction: "Call the recipient and record what they say.",
        });
      }
    }
  }

  return out;
}

/* -------------------------------------------------------------------- read */

export async function loadInspection(windowDays = 7): Promise<{
  rows: InspectionRow[];
  changesAvailable: boolean;
}> {
  const [opportunities, quotations] = await Promise.all([listBookOpportunities(), listBookQuotations()]);
  const ids = opportunities.map((o) => o.id);

  let changes: OpportunityChange[] = [];
  let changesAvailable = true;
  try {
    changes = await fetchOpportunityChanges({ opportunityIds: ids, sinceDays: Math.max(windowDays, 30) });
  } catch {
    changesAvailable = false;
  }

  const rows = buildInspection({
    opportunities,
    quotations,
    changes,
    stakeholderRolesByOpportunity: await loadStakeholderRoles(ids),
    windowDays,
  });
  return { rows, changesAvailable };
}

async function loadStakeholderRoles(opportunityIds: string[]): Promise<Record<string, string[]>> {
  if (opportunityIds.length === 0) return {};
  const { supabase } = await import("@/integrations/supabase/client");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("commercial_deal_stakeholders")
    .select("opportunity_id, committee_role")
    .in("opportunity_id", opportunityIds);
  if (error) return {};
  const out: Record<string, string[]> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of data ?? []) (out[String((r as any).opportunity_id)] ??= []).push(String((r as any).committee_role));
  return out;
}
