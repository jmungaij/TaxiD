/**
 * Enterprise CRM pipeline for Corporate Mobility.
 *
 * Models the full opportunity lifecycle from New Lead to Contract Won/Lost with
 * per-stage close probability, weighted revenue, sales-cycle time and
 * salesperson forecasting. Pure and deterministic — no network, no state — so
 * the same maths powers the admin console, exports and tests.
 */

export type CrmStage =
  | "new_lead" | "qualified" | "discovery" | "needs_analysis"
  | "proposal_draft" | "proposal_sent" | "clarifications" | "negotiation"
  | "commercial_review" | "legal_review" | "contract_approval" | "contract_signed"
  | "onboarding" | "first_booking" | "active_account" | "expansion" | "renewal"
  | "won" | "lost";

export interface CrmStageDef {
  stage: CrmStage;
  label: string;
  /** Pipeline phase used for board grouping. */
  phase: "acquire" | "qualify" | "propose" | "close" | "grow" | "closed";
  /** Default probability of eventually closing won, 0..1. */
  probability: number;
  /** Expected working days in this stage before it is considered stalled. */
  slaDays: number;
}

export const CRM_STAGES: CrmStageDef[] = [
  { stage: "new_lead",          label: "New lead",           phase: "acquire",  probability: 0.05, slaDays: 1 },
  { stage: "qualified",         label: "Qualified",          phase: "qualify",  probability: 0.10, slaDays: 2 },
  { stage: "discovery",         label: "Discovery",          phase: "qualify",  probability: 0.15, slaDays: 5 },
  { stage: "needs_analysis",    label: "Needs analysis",     phase: "qualify",  probability: 0.22, slaDays: 5 },
  { stage: "proposal_draft",    label: "Proposal draft",     phase: "propose",  probability: 0.30, slaDays: 3 },
  { stage: "proposal_sent",     label: "Proposal sent",      phase: "propose",  probability: 0.40, slaDays: 7 },
  { stage: "clarifications",    label: "Clarifications",     phase: "propose",  probability: 0.45, slaDays: 4 },
  { stage: "negotiation",       label: "Negotiation",        phase: "close",    probability: 0.55, slaDays: 7 },
  { stage: "commercial_review", label: "Commercial review",  phase: "close",    probability: 0.65, slaDays: 5 },
  { stage: "legal_review",      label: "Legal review",       phase: "close",    probability: 0.75, slaDays: 7 },
  { stage: "contract_approval", label: "Contract approval",  phase: "close",    probability: 0.85, slaDays: 5 },
  { stage: "contract_signed",   label: "Contract signed",    phase: "close",    probability: 0.95, slaDays: 3 },
  { stage: "onboarding",        label: "Customer onboarding",phase: "grow",     probability: 0.97, slaDays: 10 },
  { stage: "first_booking",     label: "First booking",      phase: "grow",     probability: 0.98, slaDays: 14 },
  { stage: "active_account",    label: "Active account",     phase: "grow",     probability: 1.00, slaDays: 30 },
  { stage: "expansion",         label: "Expansion",          phase: "grow",     probability: 1.00, slaDays: 60 },
  { stage: "renewal",           label: "Renewal",            phase: "grow",     probability: 1.00, slaDays: 45 },
  { stage: "won",               label: "Contract won",       phase: "closed",   probability: 1.00, slaDays: 0 },
  { stage: "lost",              label: "Contract lost",      phase: "closed",   probability: 0.00, slaDays: 0 },
];

const BY_STAGE = new Map(CRM_STAGES.map((s) => [s.stage, s]));

export const stageDef = (s: CrmStage): CrmStageDef => BY_STAGE.get(s) ?? CRM_STAGES[0];
export const stageLabel = (s: CrmStage): string => stageDef(s).label;
export const isClosed = (s: CrmStage): boolean => s === "won" || s === "lost";

export interface CrmActivity {
  at: string;
  kind: "note" | "meeting" | "email" | "quote" | "approval" | "signature" | "document";
  summary: string;
  actor?: string;
}

export interface CrmOpportunity {
  id: string;
  company: string;
  contactName: string;
  contactEmail: string;
  stage: CrmStage;
  /** Full contract value in KES. */
  contractValueKes: number;
  /** Optional override of the stage default probability, 0..1. */
  probability?: number;
  owner: string;
  createdAt: string;
  stageEnteredAt: string;
  expectedCloseDate: string | null;
  closedAt?: string | null;
  nextAction?: string | null;
  nextActionDueAt?: string | null;
  source?: string | null;
  lostReason?: string | null;
  activities?: CrmActivity[];
}

const DAY = 86_400_000;
const days = (from: string, to: number) => Math.max(0, Math.round((to - new Date(from).getTime()) / DAY));

export const probabilityOf = (o: CrmOpportunity): number =>
  typeof o.probability === "number" ? Math.min(1, Math.max(0, o.probability)) : stageDef(o.stage).probability;

export const weightedValue = (o: CrmOpportunity): number =>
  Math.round(o.contractValueKes * probabilityOf(o));

export const daysInStage = (o: CrmOpportunity, now = Date.now()): number => days(o.stageEnteredAt, now);

/** An opportunity is stalled when it has outlived its stage SLA and is still open. */
export const isStalled = (o: CrmOpportunity, now = Date.now()): boolean =>
  !isClosed(o.stage) && daysInStage(o, now) > stageDef(o.stage).slaDays;

export const isOverdueAction = (o: CrmOpportunity, now = Date.now()): boolean =>
  !!o.nextActionDueAt && !isClosed(o.stage) && new Date(o.nextActionDueAt).getTime() < now;

export interface StageColumn extends CrmStageDef {
  count: number;
  valueKes: number;
  weightedKes: number;
  stalled: number;
}

/** Board view: one column per stage, ordered by the canonical lifecycle. */
export function pipelineBoard(items: CrmOpportunity[], now = Date.now()): StageColumn[] {
  return CRM_STAGES.map((def) => {
    const rows = items.filter((o) => o.stage === def.stage);
    return {
      ...def,
      count: rows.length,
      valueKes: rows.reduce((s, o) => s + o.contractValueKes, 0),
      weightedKes: rows.reduce((s, o) => s + weightedValue(o), 0),
      stalled: rows.filter((o) => isStalled(o, now)).length,
    };
  });
}

export interface PipelineSummary {
  total: number;
  open: number;
  won: number;
  lost: number;
  /** Won / (won + lost), 0..100. */
  winRatePct: number;
  pipelineValueKes: number;
  weightedPipelineKes: number;
  wonValueKes: number;
  /** Mean days from creation to close across closed opportunities. */
  avgSalesCycleDays: number;
  /** Mean days from creation to close across won opportunities only. */
  avgWinCycleDays: number;
  avgContractValueKes: number;
  stalled: number;
  overdueActions: number;
}

export function summarisePipeline(items: CrmOpportunity[], now = Date.now()): PipelineSummary {
  const open = items.filter((o) => !isClosed(o.stage));
  const won = items.filter((o) => o.stage === "won");
  const lost = items.filter((o) => o.stage === "lost");
  const closed = [...won, ...lost];
  const cycle = (rows: CrmOpportunity[]) => {
    const withEnd = rows.filter((o) => o.closedAt);
    if (!withEnd.length) return 0;
    const total = withEnd.reduce(
      (s, o) => s + Math.max(0, (new Date(o.closedAt!).getTime() - new Date(o.createdAt).getTime()) / DAY),
      0,
    );
    return Math.round((total / withEnd.length) * 10) / 10;
  };
  const decided = won.length + lost.length;
  return {
    total: items.length,
    open: open.length,
    won: won.length,
    lost: lost.length,
    winRatePct: decided ? Math.round((won.length / decided) * 1000) / 10 : 0,
    pipelineValueKes: open.reduce((s, o) => s + o.contractValueKes, 0),
    weightedPipelineKes: open.reduce((s, o) => s + weightedValue(o), 0),
    wonValueKes: won.reduce((s, o) => s + o.contractValueKes, 0),
    avgSalesCycleDays: cycle(closed),
    avgWinCycleDays: cycle(won),
    avgContractValueKes: items.length
      ? Math.round(items.reduce((s, o) => s + o.contractValueKes, 0) / items.length)
      : 0,
    stalled: open.filter((o) => isStalled(o, now)).length,
    overdueActions: open.filter((o) => isOverdueAction(o, now)).length,
  };
}

export interface OwnerForecast {
  owner: string;
  open: number;
  won: number;
  lost: number;
  winRatePct: number;
  pipelineKes: number;
  /** Probability-weighted forecast for still-open opportunities. */
  forecastKes: number;
  /** Weighted forecast expected to land inside the horizon window. */
  commitKes: number;
  avgCycleDays: number;
  stalled: number;
}

/** Salesperson forecast, sorted by weighted forecast descending. */
export function forecastByOwner(
  items: CrmOpportunity[],
  opts: { horizonDays?: number; now?: number } = {},
): OwnerForecast[] {
  const now = opts.now ?? Date.now();
  const horizon = now + (opts.horizonDays ?? 90) * DAY;
  const owners = [...new Set(items.map((o) => o.owner || "Unassigned"))];
  return owners
    .map((owner) => {
      const rows = items.filter((o) => (o.owner || "Unassigned") === owner);
      const s = summarisePipeline(rows, now);
      const commit = rows
        .filter((o) => !isClosed(o.stage) && o.expectedCloseDate &&
          new Date(o.expectedCloseDate).getTime() <= horizon)
        .reduce((sum, o) => sum + weightedValue(o), 0);
      return {
        owner,
        open: s.open,
        won: s.won,
        lost: s.lost,
        winRatePct: s.winRatePct,
        pipelineKes: s.pipelineValueKes,
        forecastKes: s.weightedPipelineKes,
        commitKes: commit,
        avgCycleDays: s.avgWinCycleDays,
        stalled: s.stalled,
      };
    })
    .sort((a, b) => b.forecastKes - a.forecastKes);
}

/** Stage-to-stage conversion, useful for spotting where deals die. */
export function stageConversion(items: CrmOpportunity[]): Array<{ stage: CrmStage; label: string; reached: number; conversionPct: number }> {
  const order = CRM_STAGES.filter((s) => s.phase !== "closed");
  const rank = new Map(order.map((s, i) => [s.stage, i]));
  const reachedRank = (o: CrmOpportunity) =>
    o.stage === "won" ? order.length - 1 : o.stage === "lost" ? -1 : rank.get(o.stage) ?? -1;
  const wonRank = order.length - 1;
  return order.map((def, i) => {
    const reached = items.filter((o) => {
      const r = reachedRank(o);
      return o.stage === "won" ? wonRank >= i : r >= i;
    }).length;
    const prev = i === 0 ? items.length : items.filter((o) => {
      const r = reachedRank(o);
      return o.stage === "won" ? true : r >= i - 1;
    }).length;
    return {
      stage: def.stage,
      label: def.label,
      reached,
      conversionPct: prev ? Math.round((reached / prev) * 1000) / 10 : 0,
    };
  });
}

/** Advances a stage along the canonical lifecycle. */
export function advanceStage(stage: CrmStage): CrmStage {
  if (isClosed(stage)) return stage;
  const i = CRM_STAGES.findIndex((s) => s.stage === stage);
  const next = CRM_STAGES[i + 1];
  return next ? next.stage : "won";
}

export function moveOpportunity(
  o: CrmOpportunity,
  stage: CrmStage,
  patch: { note?: string; actor?: string; lostReason?: string; at?: string } = {},
): CrmOpportunity {
  const at = patch.at ?? new Date().toISOString();
  const activities = [...(o.activities ?? [])];
  activities.unshift({
    at, kind: "note", actor: patch.actor,
    summary: patch.note?.trim() || `Stage moved to ${stageLabel(stage)}`,
  });
  return {
    ...o,
    stage,
    stageEnteredAt: at,
    closedAt: isClosed(stage) ? at : null,
    lostReason: stage === "lost" ? patch.lostReason ?? o.lostReason ?? null : null,
    activities,
  };
}

/** Maps a contact_submissions row into an opportunity so existing leads flow in. */
export function opportunityFromEnquiry(row: {
  id: string;
  company?: string | null;
  name?: string | null;
  email?: string | null;
  status?: string | null;
  type?: string | null;
  employee_count?: number | null;
  handled_by?: string | null;
  created_at: string;
  updated_at?: string | null;
}): CrmOpportunity {
  const stage: CrmStage =
    row.status === "closed" ? "won"
    : row.status === "spam" ? "lost"
    : row.status === "in_progress" ? "discovery"
    : row.status === "contacted" ? "qualified"
    : "new_lead";
  const seats = Math.max(1, row.employee_count ?? 25);
  return {
    id: row.id,
    company: row.company?.trim() || row.name?.trim() || "Unnamed company",
    contactName: row.name?.trim() || "—",
    contactEmail: row.email?.trim() || "",
    stage,
    // Indicative annual value: seats x monthly mobility spend x 12.
    contractValueKes: seats * 9_000 * 12,
    owner: row.handled_by?.trim() || "Unassigned",
    createdAt: row.created_at,
    stageEnteredAt: row.updated_at ?? row.created_at,
    expectedCloseDate: new Date(new Date(row.created_at).getTime() + 45 * DAY).toISOString().slice(0, 10),
    closedAt: isClosed(stage) ? row.updated_at ?? row.created_at : null,
    source: row.type ?? null,
    nextAction: stage === "new_lead" ? "Qualify and book discovery call" : null,
  };
}
