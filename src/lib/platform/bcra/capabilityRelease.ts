/**
 * BCRA Phase 1 — Business Capability Release Authority.
 *
 * Extends (never replaces) the existing Capability Registry, Capability
 * Contracts, Capability Maturity Gate, LCIF, Process Catalog, Policy Registry,
 * Event Registry and Knowledge Graph into eight evidence-derived readiness
 * dimensions. Nothing here is manually entered — every score traces to an
 * existing registry.
 */
import {
  CAPABILITY_CONTRACTS,
  validateContract,
  type CapabilityContract,
  type ContractValidation,
} from "@/lib/contracts";
import { certifyCapabilityMaturity, type CapabilityMaturityReport, type MaturityDimension } from "../maturityGate";
import { BUSINESS_PROCESS_CATALOG, certifyProcess, processesForCapability } from "../processCatalog";
import { POLICY_REGISTRY } from "../policyRegistry";
import { eventRegistry, type RegisteredEvent } from "../eventRegistry";
import { capabilityLineage, knowledgeGraph, type KnowledgeGraph } from "../knowledgePlatform";
import { ELOS_CAPABILITIES, type ElosCapability } from "@/lib/logistics/elos";
import { runCapabilityIntelligence, type LcifCapabilityScore, type LcifDimension, type LcifReport } from "@/lib/logistics/capabilityIntelligence";
import { certifyBcraAiGovernance, type BcraAiGovernanceReport } from "./aiGovernanceRegistries";

export const BCRA_VERSION = "1.0.0";

export const BCRA_READINESS_DIMENSIONS = [
  "business",
  "operational",
  "financial",
  "commercial",
  "ai",
  "governance",
  "compliance",
  "customer",
] as const;

export type BcraReadinessDimension = (typeof BCRA_READINESS_DIMENSIONS)[number];

export const BCRA_DIMENSION_LABEL: Record<BcraReadinessDimension, string> = {
  business: "Business Readiness",
  operational: "Operational Readiness",
  financial: "Financial Readiness",
  commercial: "Commercial Readiness",
  ai: "AI Readiness",
  governance: "Governance Readiness",
  compliance: "Compliance Readiness",
  customer: "Customer Readiness",
};

/** Independent pass floor per dimension — aggregate scores can never mask these. */
export const BCRA_DIMENSION_FLOOR: Record<BcraReadinessDimension, number> = {
  business: 80,
  operational: 80,
  financial: 80,
  commercial: 70,
  ai: 60,
  governance: 85,
  compliance: 85,
  customer: 75,
};

export interface BcraDimensionScore {
  dimension: BcraReadinessDimension;
  label: string;
  score: number;
  floor: number;
  passed: boolean;
  /** Registries the score was derived from. */
  evidence: string[];
  findings: string[];
}

export type BcraReleaseDecision = "release" | "conditional" | "blocked";

export interface BcraCapabilityRelease {
  module: string;
  title: string;
  owner: string;
  version: string;
  dimensions: BcraDimensionScore[];
  /** Unweighted mean, published for reporting only — never used to mask a floor. */
  score: number;
  decision: BcraReleaseDecision;
  passed: boolean;
  blockers: string[];
  /** Weakest dimension, drives investment priority. */
  limitingDimension: BcraReadinessDimension;
  revenueAtRiskKes: number;
  processes: string[];
  policies: string[];
  events: string[];
  elosCapabilities: string[];
  aiReadinessLevel: number;
}

export interface BcraEvidenceBundle {
  lcif: LcifReport;
  ai: BcraAiGovernanceReport;
  graph: KnowledgeGraph;
  events: RegisteredEvent[];
}

export function bcraEvidence(): BcraEvidenceBundle {
  return { lcif: runCapabilityIntelligence(), ai: certifyBcraAiGovernance(), graph: knowledgeGraph(), events: eventRegistry() };
}

function clamp(n: number): number { return Math.max(0, Math.min(100, Math.round(n))); }

function tokens(contract: CapabilityContract): string[] {
  return `${contract.module} ${contract.title}`.toLowerCase().split(/[^a-z]+/).filter((t) => t.length > 3);
}

/** Derived (not hardcoded) mapping of a capability contract onto ELOS capabilities. */
export function elosCapabilitiesFor(contract: CapabilityContract): ElosCapability[] {
  const toks = tokens(contract);
  return ELOS_CAPABILITIES.filter((cap) => {
    const hay = `${cap.id} ${cap.label} ${cap.description} ${cap.owner}`.toLowerCase();
    return toks.some((t) => hay.includes(t));
  });
}

function lcifDim(scores: LcifCapabilityScore[], dimension: LcifDimension, fallback: number): number {
  const vals = scores.flatMap((s) => s.dimensions.filter((d) => d.dimension === dimension).map((d) => d.score));
  return vals.length === 0 ? fallback : clamp(vals.reduce((a, b) => a + b, 0) / vals.length);
}

function maturityDim(report: CapabilityMaturityReport, dimension: MaturityDimension): number {
  return report.dimensions.find((d) => d.dimension === dimension)?.score ?? 0;
}

function dim(
  dimension: BcraReadinessDimension,
  score: number,
  evidence: string[],
  findings: string[],
): BcraDimensionScore {
  const floor = BCRA_DIMENSION_FLOOR[dimension];
  const s = clamp(score);
  return { dimension, label: BCRA_DIMENSION_LABEL[dimension], score: s, floor, passed: s >= floor, evidence, findings };
}

export function certifyCapabilityRelease(
  contract: CapabilityContract,
  evidence: BcraEvidenceBundle = bcraEvidence(),
): BcraCapabilityRelease {
  const maturity = certifyCapabilityMaturity(contract);
  const validation: ContractValidation = validateContract(contract);
  const processes = processesForCapability(contract.module);
  const processCerts = processes.map(certifyProcess);
  const policies = POLICY_REGISTRY.filter((p) => p.appliesToProcesses.some((pid) => processes.some((pr) => pr.id === pid)));
  const published = contract.publishes.map((e) => e.name);
  const consumed = contract.consumes.map((e) => e.name);
  const ownEvents = evidence.events.filter((e) => published.includes(e.name) || consumed.includes(e.name));
  const elos = elosCapabilitiesFor(contract);
  const lcifScores = evidence.lcif.capabilities.filter((c) => elos.some((e) => e.id === c.id));
  const lineage = capabilityLineage(contract.module, evidence.graph);
  const aiGovScore = evidence.ai.byOwner[contract.module] ?? 0;

  const processScore = processCerts.length === 0 ? 60 : clamp(processCerts.reduce((s, p) => s + p.score, 0) / processCerts.length);
  const kpiScore = clamp(Math.min(100, contract.kpis.length * 25));
  const businessFindings: string[] = [];
  if (processes.length === 0) businessFindings.push("capability participates in no catalogued business process");
  if (contract.kpis.length < 4) businessFindings.push(`only ${contract.kpis.length} operational KPIs declared (target 4)`);
  const business = dim("business", validation.completeness * 0.35 + processScore * 0.4 + kpiScore * 0.25,
    ["capabilityContract.validateContract", "processCatalog.certifyProcess", "contract.kpis"], businessFindings);

  const operationalFindings: string[] = [];
  if (contract.failureModes.length < 3) operationalFindings.push("fewer than 3 failure modes registered");
  if (contract.escalationPaths.length === 0) operationalFindings.push("no escalation path registered");
  const operational = dim("operational",
    maturityDim(maturity, "operational_kpis") * 0.3 + maturityDim(maturity, "failure_modes") * 0.25 +
    maturityDim(maturity, "production_readiness") * 0.25 + lcifDim(lcifScores, "operations", processScore) * 0.2,
    ["maturityGate.dimensions", "lcif.operations"], operationalFindings);

  const financeExposure = lcifScores.reduce((s, c) => s + c.revenueAtRiskKes, 0);
  const financePolicies = policies.filter((p) => p.domain === "finance").length;
  const financialFindings: string[] = [];
  if (financePolicies === 0) financialFindings.push("no finance policy governs this capability's processes");
  const financial = dim("financial",
    lcifDim(lcifScores, "finance", 70) * 0.5 + (financePolicies > 0 ? 100 : 55) * 0.25 + processScore * 0.25,
    ["lcif.finance", "policyRegistry", "processCatalog"], financialFindings);

  const commercialFindings: string[] = [];
  if (contract.publishes.length === 0) commercialFindings.push("capability publishes no event — cannot be commercially integrated");
  const commercial = dim("commercial",
    lcifDim(lcifScores, "partnerExperience", 70) * 0.4 + lcifDim(lcifScores, "executiveReadiness", 70) * 0.3 +
    clamp(Math.min(100, contract.publishes.length * 20)) * 0.3,
    ["lcif.partnerExperience", "lcif.executiveReadiness", "contract.publishes"], commercialFindings);

  const aiFindings: string[] = [];
  if (aiGovScore === 0) aiFindings.push("no governed AI decision registered for this capability");
  if (maturity.aiReadinessLevel < 2) aiFindings.push(`AI readiness level ${maturity.aiReadinessLevel} — no service beyond planned`);
  const ai = dim("ai",
    aiGovScore * 0.55 + maturity.aiReadinessLevel * 20 * 0.25 + lcifDim(lcifScores, "ai", 55) * 0.2,
    ["bcra.aiDecisionRegistry", "maturityGate.aiReadinessLevel", "lcif.ai"], aiFindings);

  const govFindings: string[] = [];
  if (!contract.owner.trim()) govFindings.push("capability has no accountable owner");
  if (policies.length === 0) govFindings.push("no enterprise policy governs this capability");
  if (!lineage) govFindings.push("capability is absent from the knowledge graph lineage");
  const governance = dim("governance",
    (contract.owner.trim() ? 100 : 0) * 0.25 + (policies.length > 0 ? 100 : 40) * 0.25 +
    (lineage ? 100 : 40) * 0.2 + maturityDim(maturity, "capability_contract") * 0.3,
    ["policyRegistry", "knowledgePlatform.capabilityLineage", "maturityGate.capability_contract"], govFindings);

  const regulated = ownEvents.filter((e) => e.classification === "restricted");
  const auditable = ownEvents.filter((e) => e.retention === "7y" || e.retention === "1y");
  const compFindings: string[] = [];
  const unretained = regulated.filter((e) => e.retention !== "7y").map((e) => e.name);
  if (unretained.length > 0) compFindings.push(`restricted events without 7y retention: ${unretained.join(", ")}`);
  const compliance = dim("compliance",
    maturityDim(maturity, "audit_coverage") * 0.35 + maturityDim(maturity, "security_boundaries") * 0.25 +
    lcifDim(lcifScores, "compliance", 75) * 0.2 +
    (ownEvents.length === 0 ? 60 : (auditable.length / ownEvents.length) * 100) * 0.2,
    ["maturityGate.audit_coverage", "eventRegistry.retention", "lcif.compliance"], compFindings);

  const custFindings: string[] = [];
  const slaWorkflows = contract.workflows.filter((w) => w.targetMinutes > 0).length;
  if (slaWorkflows === 0) custFindings.push("no workflow declares a customer-facing SLA target");
  const customer = dim("customer",
    lcifDim(lcifScores, "customerExperience", 70) * 0.45 +
    clamp((slaWorkflows / Math.max(1, contract.workflows.length)) * 100) * 0.3 +
    clamp(Math.min(100, contract.escalationPaths.length * 34)) * 0.25,
    ["lcif.customerExperience", "contract.workflows", "contract.escalationPaths"], custFindings);

  const dimensions = [business, operational, financial, commercial, ai, governance, compliance, customer];
  const failed = dimensions.filter((d) => !d.passed);
  const blockers = failed.map((d) => `${d.label} ${d.score}/${d.floor}${d.findings.length ? ` — ${d.findings.join("; ")}` : ""}`);
  const score = clamp(dimensions.reduce((s, d) => s + d.score, 0) / dimensions.length);
  const limiting = dimensions.reduce((m, d) => (d.score - d.floor < m.score - m.floor ? d : m), dimensions[0]);
  const criticalFail = failed.some((d) => d.dimension === "governance" || d.dimension === "compliance" || d.dimension === "financial");

  return {
    module: contract.module,
    title: contract.title,
    owner: contract.owner,
    version: contract.version,
    dimensions,
    score,
    decision: failed.length === 0 ? "release" : criticalFail ? "blocked" : "conditional",
    passed: failed.length === 0,
    blockers,
    limitingDimension: limiting.dimension,
    revenueAtRiskKes: Math.round(financeExposure),
    processes: processes.map((p) => p.id),
    policies: policies.map((p) => p.id),
    events: ownEvents.map((e) => e.name),
    elosCapabilities: elos.map((e) => e.id),
    aiReadinessLevel: maturity.aiReadinessLevel,
  };
}

export interface BcraCapabilityRegister {
  version: string;
  generatedAt: null;
  capabilities: BcraCapabilityRelease[];
  /** Dimension averages across the estate. */
  dimensionAverages: Array<{ dimension: BcraReadinessDimension; label: string; score: number; passingCapabilities: number }>;
  score: number;
  passed: boolean;
  released: number;
  conditional: number;
  blocked: number;
  totalRevenueAtRiskKes: number;
  blockers: string[];
}

export function bcraCapabilityRegister(
  contracts: CapabilityContract[] = CAPABILITY_CONTRACTS,
  evidence: BcraEvidenceBundle = bcraEvidence(),
): BcraCapabilityRegister {
  const capabilities = contracts.map((c) => certifyCapabilityRelease(c, evidence));
  const dimensionAverages = BCRA_READINESS_DIMENSIONS.map((dimension) => {
    const scores = capabilities.map((c) => c.dimensions.find((d) => d.dimension === dimension)!);
    return {
      dimension,
      label: BCRA_DIMENSION_LABEL[dimension],
      score: scores.length === 0 ? 0 : clamp(scores.reduce((s, d) => s + d.score, 0) / scores.length),
      passingCapabilities: scores.filter((d) => d.passed).length,
    };
  });
  return {
    version: BCRA_VERSION,
    generatedAt: null,
    capabilities,
    dimensionAverages,
    score: capabilities.length === 0 ? 0 : clamp(capabilities.reduce((s, c) => s + c.score, 0) / capabilities.length),
    passed: capabilities.every((c) => c.passed),
    released: capabilities.filter((c) => c.decision === "release").length,
    conditional: capabilities.filter((c) => c.decision === "conditional").length,
    blocked: capabilities.filter((c) => c.decision === "blocked").length,
    totalRevenueAtRiskKes: capabilities.reduce((s, c) => s + c.revenueAtRiskKes, 0),
    blockers: capabilities.flatMap((c) => c.blockers.map((b) => `${c.module} · ${b}`)),
  };
}

/** Investment priority — weakest capability first, weighted by revenue exposure. */
export function bcraInvestmentPriority(register: BcraCapabilityRegister = bcraCapabilityRegister()) {
  return [...register.capabilities]
    .map((c) => ({
      module: c.module,
      title: c.title,
      score: c.score,
      limitingDimension: c.limitingDimension,
      revenueAtRiskKes: c.revenueAtRiskKes,
      priority: Math.round((100 - c.score) * 10 + c.revenueAtRiskKes / 10_000),
    }))
    .sort((a, b) => b.priority - a.priority);
}

export { BUSINESS_PROCESS_CATALOG };
