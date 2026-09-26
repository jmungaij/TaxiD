/**
 * Certification Pipeline — one deterministic entrypoint that runs the platform
 * certifications and emits a signed-by-content snapshot.
 *
 * Consumed by: the read-only maturity certificate endpoint, the scheduled
 * lineage refresh job, the executive report and the CI smoke test.
 */
import { certifyKnowledgePlatform } from "./knowledgePlatform";
import { certifyAllCapabilities } from "./maturityGate";
import { fnv1a } from "./_shared";
import { validateAllContracts, unwiredConsumedEvents, CAPABILITY_CONTRACTS } from "../contracts";
import { certifyElos, ELOS_NAME, ELOS_VERSION } from "../logistics/elos";
import { runCapabilityIntelligence, LCIF_VERSION } from "../logistics/capabilityIntelligence";
import { certifyColdChain } from "../logistics/coldChain";
import { certifyCopilot } from "../logistics/logisticsCopilot";

export interface CertificationSnapshot {
  generatedAt: string;
  /** Content-derived id — identical platform state produces the same id. */
  snapshotId: string;
  knowledge: {
    score: number;
    passed: boolean;
    nodes: number;
    edges: number;
    traceabilityCoverage: number;
    orphanNodes: number;
    danglingDependencies: number;
  };
  capabilityMaturity: {
    score: number;
    passed: boolean;
    modules: Array<{ module: string; score: number; passed: boolean; aiReadinessLevel: number }>;
    blockers: number;
  };
  contracts: {
    total: number;
    invalid: string[];
    unwiredEvents: Array<{ consumer: string; event: string }>;
  };
  logisticsOs: {
    name: string;
    version: string;
    score: number;
    passed: boolean;
    capabilities: number;
    activationRate: number;
  };
  /** Phase 1 LCIF — capability-level explanation of the logistics score. */
  logisticsIntelligence: {
    version: string;
    score: number;
    band: string;
    capabilities: number;
    revenueAtRiskKes: number;
    slaBreaches: string[];
    weakestCapabilities: Array<{ id: string; label: string; score: number; limiting: string[] }>;
    coldChain: { score: number; passed: boolean };
    copilot: { score: number; passed: boolean; traceable: boolean };
    explanation: string[];
  };
  /** Weighted platform maturity across the four certifications. */
  maturityScore: number;
  releaseApproved: boolean;
  blockingReasons: string[];
}

const WEIGHTS = { knowledge: 0.3, capability: 0.35, contracts: 0.15, logistics: 0.2 };

export function runCertificationPipeline(now: Date = new Date()): CertificationSnapshot {
  const knowledge = certifyKnowledgePlatform();
  const maturity = certifyAllCapabilities();
  const validations = validateAllContracts();
  const invalid = validations.filter((v) => !v.ok).map((v) => v.module as string);
  const unwired = unwiredConsumedEvents();
  const elos = certifyElos();
  const lcif = runCapabilityIntelligence();
  const coldChain = certifyColdChain();
  const copilot = certifyCopilot();
  // The logistics contribution blends registry activation (ELOS) with
  // capability-level maturity (LCIF) so the score is explainable.
  const logisticsScore = Math.round((elos.score + lcif.score) / 2);

  const contractScore = Math.max(
    0,
    100 - invalid.length * 25 - Math.min(40, unwired.length * 5),
  );

  const maturityScore = Math.round(
    knowledge.score * WEIGHTS.knowledge +
      maturity.score * WEIGHTS.capability +
      contractScore * WEIGHTS.contracts +
      logisticsScore * WEIGHTS.logistics,
  );

  const blockingReasons: string[] = [];
  if (!knowledge.passed) blockingReasons.push(`Knowledge platform below floor (${knowledge.score})`);
  if (!maturity.passed) blockingReasons.push(`Capability maturity blockers: ${maturity.blockers.length}`);
  if (invalid.length) blockingReasons.push(`Invalid capability contracts: ${invalid.join(", ")}`);
  if (!elos.passed) blockingReasons.push(`${ELOS_NAME} not certified (${elos.score})`);
  if (!coldChain.passed) blockingReasons.push(`Cold chain capability not certified (${coldChain.score})`);
  if (!copilot.passed) blockingReasons.push(`AI logistics orchestrator not certified (${copilot.score})`);

  const body = {
    knowledge: {
      score: knowledge.score,
      passed: knowledge.passed,
      nodes: knowledge.nodes,
      edges: knowledge.edges,
      traceabilityCoverage: knowledge.traceabilityCoverage,
      orphanNodes: knowledge.orphanNodes.length,
      danglingDependencies: knowledge.danglingDependencies.length,
    },
    capabilityMaturity: {
      score: maturity.score,
      passed: maturity.passed,
      modules: maturity.capabilities.map((c) => ({
        module: c.module,
        score: c.score,
        passed: c.passed,
        aiReadinessLevel: c.aiReadinessLevel,
      })),
      blockers: maturity.blockers.length,
    },
    contracts: {
      total: CAPABILITY_CONTRACTS.length,
      invalid,
      unwiredEvents: unwired,
    },
    logisticsOs: {
      name: ELOS_NAME,
      version: ELOS_VERSION,
      score: elos.score,
      passed: elos.passed,
      capabilities: elos.capabilities,
      activationRate: elos.activationRate,
    },
    logisticsIntelligence: {
      version: LCIF_VERSION,
      score: lcif.score,
      band: lcif.band,
      capabilities: lcif.capabilities.length,
      revenueAtRiskKes: lcif.totalRevenueAtRiskKes,
      slaBreaches: lcif.slaBreaches,
      weakestCapabilities: [...lcif.capabilities]
        .sort((a, b) => a.score - b.score)
        .slice(0, 5)
        .map((c) => ({ id: c.id, label: c.label, score: c.score, limiting: c.limitingDimensions })),
      coldChain: { score: coldChain.score, passed: coldChain.passed },
      copilot: { score: copilot.score, passed: copilot.passed, traceable: copilot.traceable },
      explanation: lcif.explanation,
    },
    maturityScore,
    releaseApproved: blockingReasons.length === 0,
    blockingReasons,
  };

  return {
    generatedAt: now.toISOString(),
    snapshotId: fnv1a(JSON.stringify(body)),
    ...body,
  };
}
