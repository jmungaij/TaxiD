/**
 * Enterprise Capability Maturity Gate.
 *
 * Mandatory pre-implementation and pre-release gate. Every capability must
 * certify eleven dimensions before code is written and again before release.
 * Reads capability contracts, the canonical event catalog and the business
 * rules inventory — no module source inspection required.
 */
import {
  CAPABILITY_CONTRACTS,
  validateContract,
  type CapabilityContract,
} from "@/lib/contracts";
import { certifyEventConformance, canonicalEvent } from "./eventCatalog";
import { ruleInventory, BUSINESS_RULES, type RuleDomain } from "./rulesEngine";
import { aiImplementation } from "./aiServiceRegistry";

export type MaturityDimension =
  | "capability_contract"
  | "canonical_events"
  | "publish_consume_matrix"
  | "business_rules"
  | "ai_readiness"
  | "operational_kpis"
  | "failure_modes"
  | "security_boundaries"
  | "audit_coverage"
  | "wave_gate"
  | "production_readiness";

/** AI Readiness Level 0-5 (0 = none, 5 = autonomous with human oversight). */
export type AiReadinessLevel = 0 | 1 | 2 | 3 | 4 | 5;

export interface DimensionResult {
  dimension: MaturityDimension;
  passed: boolean;
  score: number;          // 0-100
  findings: string[];
}

export interface CapabilityMaturityReport {
  module: string;
  title: string;
  passed: boolean;
  score: number;
  aiReadinessLevel: AiReadinessLevel;
  dimensions: DimensionResult[];
  blockers: string[];
}

export interface MaturityGateReport {
  passed: boolean;
  score: number;
  capabilities: CapabilityMaturityReport[];
  blockers: string[];
}

/** Domains whose rule inventory backs a capability. Every module must map. */
const RULE_DOMAIN_FOR_MODULE: Record<string, RuleDomain[]> = {
  customer_operations: ["customer_operations", "finance"],
  delivery_logistics: ["delivery"],
  finance_refunds: ["finance"],
  trust_safety: ["trust_safety"],
  fleet: ["fleet"],
  mobility: ["mobility", "trust_safety"],
  corporate: ["corporate", "finance"],
  marketplace: ["marketplace", "finance"],
};

/**
 * AI readiness ladder derived from the contract's declared roadmap, gated on
 * registered implementation evidence:
 *   0 none · 1 planned · 2 preview · 3 live single service ·
 *   4 live multi-service with evaluation · 5 live + closed-loop automation
 *
 * A `live` service only counts when the AI service registry can evidence an
 * engine, entrypoint and evaluation harness for it.
 */
export function aiReadinessLevel(contract: CapabilityContract): AiReadinessLevel {
  const roadmap = contract.aiRoadmap ?? [];
  if (roadmap.length === 0) return 0;
  const live = roadmap.filter(
    (a) => a.status === "live" && aiImplementation(contract.module, a.service) !== undefined,
  );
  const preview = roadmap.filter((a) => a.status === "preview");
  const evaluated = roadmap.every((a) => a.evaluation.trim().length > 0);

  if (live.length === 0 && preview.length === 0) return 1;
  if (live.length === 0) return 2;
  if (live.length === 1) return 3;
  if (live.length >= 2 && evaluated) {
    const hasClosedLoop = live.some(
      (a) => aiImplementation(contract.module, a.service)?.closedLoop !== undefined,
    );
    return hasClosedLoop ? 5 : 4;
  }
  return 3;
}


function dim(dimension: MaturityDimension, findings: string[], score: number): DimensionResult {
  return { dimension, passed: findings.length === 0, score, findings };
}

export function certifyCapabilityMaturity(contract: CapabilityContract): CapabilityMaturityReport {
  const dimensions: DimensionResult[] = [];

  // 1. Business Capability Contract
  const validation = validateContract(contract);
  dimensions.push(dim(
    "capability_contract",
    validation.missing.map((m) => `contract section '${m}' is empty`),
    validation.completeness,
  ));

  // 2 + 3. Canonical events & publish/consume matrix
  const conformance = certifyEventConformance([...contract.publishes, ...contract.consumes]);
  dimensions.push(dim(
    "canonical_events",
    conformance.issues.map((i) => `${i.event}: ${i.message}`),
    conformance.score,
  ));

  const matrixFindings: string[] = [];
  if (contract.publishes.length === 0) matrixFindings.push("capability publishes no events");
  if (contract.consumes.length === 0) matrixFindings.push("capability consumes no events");
  const unowned = contract.publishes.filter((e) => {
    const c = canonicalEvent(e.name);
    return c && c.owner !== contract.module;
  });
  for (const e of unowned) {
    matrixFindings.push(`publishes '${e.name}' owned by '${canonicalEvent(e.name)?.owner}' — confirm single-writer`);
  }
  dimensions.push(dim("publish_consume_matrix", matrixFindings, matrixFindings.length === 0 ? 100 : 70));

  // 4. Business rule inventory — every module must map to a policy domain
  const inventory = ruleInventory();
  const domains = RULE_DOMAIN_FOR_MODULE[contract.module] ?? [];
  const ruleCount = domains.reduce((n, d) => n + inventory[d], 0);
  const ruleFindings: string[] = [];
  if (domains.length === 0) ruleFindings.push("module maps to no business rule domain");
  else if (ruleCount === 0) ruleFindings.push(`no business rules registered for domains: ${domains.join(", ")}`);
  dimensions.push(dim("business_rules", ruleFindings, ruleFindings.length === 0 ? 100 : 60));

  // 5. AI readiness — `live` services must carry registered implementation evidence
  const level = aiReadinessLevel(contract);
  const aiFindings: string[] = [];
  for (const spec of contract.aiRoadmap ?? []) {
    if (spec.status !== "live") continue;
    const impl = aiImplementation(contract.module, spec.service);
    if (!impl) aiFindings.push(`AI service '${spec.service}' is declared live with no registered implementation`);
    else if (!impl.harness.trim()) aiFindings.push(`AI service '${spec.service}' has no evaluation harness`);
  }
  if (level < 4) aiFindings.push(`AI readiness level ${level} is below the level-4 certification floor`);
  dimensions.push(dim("ai_readiness", aiFindings, Math.round((level / 5) * 100)));


  // 6. Operational KPIs
  const kpiFindings = contract.kpis.filter((k) => !k.source.trim()).map((k) => `KPI '${k.id}' has no data source`);
  if (contract.kpis.length < 3) kpiFindings.push("fewer than 3 operational KPIs declared");
  dimensions.push(dim("operational_kpis", kpiFindings, kpiFindings.length === 0 ? 100 : 75));

  // 7. Failure modes & recovery
  const fmFindings = contract.failureModes
    .filter((f) => !f.detection.trim() || !f.mitigation.trim())
    .map((f) => `failure mode '${f.id}' lacks detection or mitigation`);
  if (contract.failureModes.length < 3) fmFindings.push("fewer than 3 failure modes documented");
  dimensions.push(dim("failure_modes", fmFindings, fmFindings.length === 0 ? 100 : 70));

  // 8. Security boundaries — every workflow must declare an approval gate
  const secFindings = contract.workflows
    .filter((w) => w.approvals.length === 0)
    .map((w) => `workflow '${w.id}' declares no approval/authorisation gate`);
  dimensions.push(dim("security_boundaries", secFindings, secFindings.length === 0 ? 100 : 65));

  // 9. Audit coverage — critical events must have escalation ownership
  const auditFindings: string[] = [];
  if (contract.escalationPaths.length === 0) auditFindings.push("no escalation paths declared");
  const criticalUnescalated = contract.publishes
    .filter((e) => e.criticality === "critical")
    .filter(() => contract.escalationPaths.length === 0);
  if (criticalUnescalated.length > 0) auditFindings.push("critical events published without escalation ownership");
  dimensions.push(dim("audit_coverage", auditFindings, auditFindings.length === 0 ? 100 : 60));

  // 10. Wave Gate compliance — capability must be routed and owned
  const waveFindings: string[] = [];
  if (!contract.route.startsWith("/")) waveFindings.push("capability declares no dashboard route");
  if (!contract.owner.trim()) waveFindings.push("capability declares no owning team");
  dimensions.push(dim("wave_gate", waveFindings, waveFindings.length === 0 ? 100 : 70));

  // 11. Production readiness — dependencies must declare degraded behaviour
  const prodFindings = contract.dependencies
    .filter((d) => !d.degradedBehaviour.trim())
    .map((d) => `dependency '${d.module}' has no degraded-mode behaviour`);
  if (contract.dependencies.length === 0) prodFindings.push("no dependencies declared — verify isolation is real");
  dimensions.push(dim("production_readiness", prodFindings, prodFindings.length === 0 ? 100 : 75));

  const score = Math.round(dimensions.reduce((s, d) => s + d.score, 0) / dimensions.length);
  const blockers = dimensions.filter((d) => !d.passed).flatMap((d) => d.findings.map((f) => `${d.dimension}: ${f}`));

  return {
    module: contract.module,
    title: contract.title,
    passed: dimensions.every((d) => d.passed),
    score,
    aiReadinessLevel: level,
    dimensions,
    blockers,
  };
}

export function certifyAllCapabilities(
  contracts: CapabilityContract[] = CAPABILITY_CONTRACTS,
): MaturityGateReport {
  const capabilities = contracts.map(certifyCapabilityMaturity);
  const score = capabilities.length === 0
    ? 0
    : Math.round(capabilities.reduce((s, c) => s + c.score, 0) / capabilities.length);
  return {
    passed: capabilities.every((c) => c.passed),
    score,
    capabilities,
    blockers: capabilities.flatMap((c) => c.blockers.map((b) => `${c.module} · ${b}`)),
  };
}

/** Total registered policies — surfaced on the governance card. */
export const REGISTERED_RULE_COUNT = BUSINESS_RULES.length;
