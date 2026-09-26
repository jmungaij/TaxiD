/**
 * Phase 9 — Yalla Market Expansion & Network Intelligence Engine.
 *
 * One chain, evidence first:
 *   market signals → attractiveness → digital twin → stressed scenarios →
 *   entry decision → seeding plan → network density → portfolio & capital →
 *   AI council.
 *
 * The engine is allowed to say "not assessable". That is the whole point: a
 * market that cannot evidence its economics defers, and no simulated figure is
 * ever presented as Yalla performance.
 */
import { scoreAttractiveness, type AttractivenessResult } from "./attractiveness";
import { buildMarketTwin, type MarketTwin } from "./marketTwin";
import { runScenarioMatrix, type ScenarioMatrix } from "./entrySimulator";
import { decideEntry, type DecisionThresholds, type EntryDecision } from "./entryDecision";
import { buildSeedingPlan, type SeedingPlan } from "./seeding";
import { convene, type CouncilVerdict } from "./aiCouncil";
import { buildPortfolio, type CapitalEnvelope, type ExpansionPortfolio, type PortfolioCandidate } from "./portfolio";
import { readNetworkEffect, type NetworkEffectReading, type ZoneObservation } from "./networkDensity";
import type { MarketRecord } from "./marketModel";

export * from "./marketModel";
export * from "./attractiveness";
export * from "./marketTwin";
export * from "./entrySimulator";
export * from "./entryDecision";
export * from "./seeding";
export * from "./networkDensity";
export * from "./portfolio";
export * from "./aiCouncil";
export * from "./dataSource";

export interface MarketAssessment {
  record: MarketRecord;
  attractiveness: AttractivenessResult;
  twin: MarketTwin;
  matrix: ScenarioMatrix;
  decision: EntryDecision;
  seeding: SeedingPlan;
  network: NetworkEffectReading | null;
  council: CouncilVerdict;
}

export function assessMarket(
  record: MarketRecord,
  options: { zones?: readonly ZoneObservation[]; thresholds?: DecisionThresholds } = {},
): MarketAssessment {
  const attractiveness = scoreAttractiveness(record);
  const twin = buildMarketTwin(record);
  const matrix = runScenarioMatrix(record);
  const decision = decideEntry(record, attractiveness, matrix, options.thresholds);
  const seeding = buildSeedingPlan(record);
  const network = options.zones && options.zones.length
    ? readNetworkEffect(record.definition.id, options.zones)
    : null;
  const council = convene({ attractiveness, decision, matrix, seeding, network: network ?? undefined });
  return { record, attractiveness, twin, matrix, decision, seeding, network, council };
}

export const DEFAULT_ENVELOPE: CapitalEnvelope = {
  totalCapitalKes: 250_000_000,
  launchTeams: 2,
  minReturnMultiple: 1.4,
};

export interface ExpansionProgramme {
  assessments: MarketAssessment[];
  portfolio: ExpansionPortfolio;
  /** Markets that cannot be decided at all, with the evidence they need. */
  evidenceBacklog: { marketName: string; missing: string[] }[];
}

export function buildExpansionProgramme(
  records: readonly MarketRecord[],
  envelope: CapitalEnvelope = DEFAULT_ENVELOPE,
  zonesByMarket: Record<string, ZoneObservation[]> = {},
): ExpansionProgramme {
  const assessments = records
    .map((r) => assessMarket(r, { zones: zonesByMarket[r.definition.id] }))
    .sort((a, b) => (b.attractiveness.score.value ?? -1) - (a.attractiveness.score.value ?? -1));

  const candidates: PortfolioCandidate[] = assessments.map((a) => ({
    marketId: a.record.definition.id,
    marketName: a.record.definition.name,
    attractiveness: a.attractiveness,
    decision: a.decision,
    matrix: a.matrix,
  }));

  return {
    assessments,
    portfolio: buildPortfolio(candidates, envelope),
    evidenceBacklog: assessments
      .filter((a) => a.decision.evidenceRequired.length > 0)
      .map((a) => ({ marketName: a.record.definition.name, missing: a.decision.evidenceRequired })),
  };
}
