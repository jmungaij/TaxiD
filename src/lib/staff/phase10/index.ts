/**
 * Phase 10 — Platform Orchestration Engine, public API.
 *
 * One entry point assembles the orchestration state from the systems of record so
 * the Control Tower renders evidence, never assertions.
 */
export * from "./mission";
export * from "./stateMachine";
export * from "./matching";
export * from "./provider360";
export * from "./liquidityBrain";
export * from "./pricing";
export * from "./trustGraph";
export * from "./programme";
export * from "./exceptionAutopilot";
export * from "./decisionFabric";
export * from "./product360";
export * from "./networkValue";
export * from "./enterpriseGraph";
export * from "./staffModel";
export * from "./orchestrationDemo";
export * from "./certification";
export * from "./dataSource";

import { PRODUCT_CATALOGUE, buildProduct360, buildRevenueTree, buildKpiTree, type Product360, type RevenueNode, type KpiNode } from "./product360";
import { assessLiquidity, liquidityPriorities, type LiquidityAssessment } from "./liquidityBrain";
import { buildProvider360, type Provider360 } from "./provider360";
import { assessNetworkEffects, type NetworkEffects } from "./networkValue";
import { assessKnowledgeGraph, type KnowledgeGraphHealth } from "./enterpriseGraph";
import { summariseAutopilot, type AutopilotSummary } from "./exceptionAutopilot";
import { trustPosture, type TrustPosture } from "./trustGraph";
import { buildStaffWorkspace, type StaffWorkspaceModel } from "./staffModel";
import { demonstrateAllProducts, type MissionDemonstration } from "./orchestrationDemo";
import { certifyPhase10, type Phase10Certification } from "./certification";
import {
  buildFlywheelObservation, buildKnowledgeNodes, buildLiquidityObservations,
  loadOrchestrationFacts, loadProviders, type OrchestrationFacts,
} from "./dataSource";

export interface OrchestrationState {
  facts: OrchestrationFacts;
  products: Product360[];
  revenueTree: RevenueNode;
  kpiTree: KpiNode;
  liquidity: LiquidityAssessment[];
  providers: Provider360[];
  demonstrations: MissionDemonstration[];
  trust: TrustPosture;
  exceptions: AutopilotSummary;
  network: NetworkEffects;
  knowledge: KnowledgeGraphHealth;
  workspace: StaffWorkspaceModel;
  certification: Phase10Certification;
  gaps: string[];
}

/** Loads every system of record and runs the full orchestration assessment. */
export async function loadOrchestrationState(): Promise<OrchestrationState> {
  const [facts, providerResult] = await Promise.all([loadOrchestrationFacts(), loadProviders()]);

  const products = PRODUCT_CATALOGUE.map((entry) =>
    buildProduct360(entry, facts.productObservations.get(entry.productLine) ?? {
      missions: null, bookings: null, customers: null, providers: null,
      grossValueCents: null, revenueCents: null, contributionCents: null,
      slaComplianceRate: null, customerSatisfaction: null, providerQualityMean: null,
      openExceptions: null, liquidityState: null, asOf: facts.asOf,
    }),
  );

  const liquidity = liquidityPriorities(
    buildLiquidityObservations(facts).map((c) =>
      assessLiquidity({ id: c.cellId, market: c.market, zone: c.zone, window: c.window, service: c.service }, c.observation),
    ),
  );

  const providers = providerResult.providers.map((p) => buildProvider360(p.identity, p.observations));
  const demonstrations = demonstrateAllProducts(facts.demoFacts);
  const network = assessNetworkEffects(buildFlywheelObservation(facts));
  const knowledge = assessKnowledgeGraph(buildKnowledgeNodes(facts));

  const certification = certifyPhase10({
    demonstrations,
    liquidity,
    products,
    network,
    knowledge,
    recognisedRevenueCents: facts.recognisedRevenueCents,
    settledCents: facts.settledCents,
    auditEntries: facts.rows.length || null,
  });

  const contributionCents = products.reduce<number | null>(
    (a, p) => (p.contribution.value === null ? a : (a ?? 0) + p.contribution.value * 100),
    null,
  );

  const workspace = buildStaffWorkspace({
    role: "Commercial Orchestration Lead",
    department: "Marketplace Operations",
    products: products.filter((p) => p.revenue.value !== null).map((p) => p.entry.productLine),
    customers: facts.customers || null,
    missions: facts.transactions || null,
    exceptions: demonstrations.filter((d) => d.exception.mode !== "autopilot").length,
    decisionsPending: demonstrations.filter((d) => d.decision.approvalRequirement !== "none").length,
    revenueContributionCents: contributionCents,
    aiRecommendations: products.flatMap((p) => p.recommendations).slice(0, 6),
    learning: demonstrations.map((d) => d.decision.learning).filter((v): v is string => Boolean(v)).slice(0, 5),
    kpis: [
      { label: "Certification score", value: `${certification.score}/100`, feeds: "Phase 10 verdict" },
      { label: "Recognised revenue", value: facts.recognisedRevenueCents === null ? "Not observed" : `KES ${Math.round(facts.recognisedRevenueCents / 100).toLocaleString()}`, feeds: "Contribution" },
      { label: "Liquidity cells measured", value: `${liquidity.filter((l) => l.state !== "unmeasured").length}/${liquidity.length}`, feeds: "Match rate" },
    ],
  });

  return {
    facts,
    products,
    revenueTree: buildRevenueTree(products),
    kpiTree: buildKpiTree({
      demandMissions: facts.transactions || null,
      liquidityMatchRate: null,
      transactions: facts.rows.filter((r) => r.recognised_at).length || null,
      revenueCents: facts.recognisedRevenueCents,
      contributionCents,
      retentionRate: null,
      networkEffectScore: network.score.value,
      asOf: facts.asOf,
    }),
    liquidity,
    providers,
    demonstrations,
    trust: trustPosture(demonstrations.map((d) => d.trust)),
    exceptions: summariseAutopilot(demonstrations.map((d) => d.exception)),
    network,
    knowledge,
    workspace,
    certification,
    gaps: [...facts.gaps, ...providerResult.gaps],
  };
}
