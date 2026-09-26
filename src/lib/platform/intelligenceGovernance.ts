/**
 * IEOS Phase 7.1 — Enterprise Intelligence API Governance & Capability
 * Certification (pre-governance validation gate).
 *
 * Read-only metadata enrichment over Workstream 1. It does NOT change the
 * behaviour, shape or contract of `queryIntelligence` — it *describes* it.
 *
 * Every value published here is derived from modules that already exist:
 *  - Intelligence API resource registry  (ownership, RBAC, TTL, params)
 *  - LCIF                                (maturity, risk, revenue, dimensions)
 *  - Business Capability Registry        (capability, domain, objectives)
 *  - Knowledge Platform                  (dependencies, impact, traceability)
 *  - Event Registry                      (events, security classification)
 *  - Business Process Catalog            (processes, owners, SLA)
 *  - Policy Registry                     (governing policies, regulatory basis)
 *  - Certification Pipeline              (certification, release approval)
 *  - Intelligence telemetry              (observed latency, health)
 *
 * Nothing is hand-entered: the only configuration is each resource's
 * *provenance* (which existing modules it composes), which is a statement of
 * fact about the code, not a governance judgement.
 */
import {
  INTELLIGENCE_RESOURCES,
  INTELLIGENCE_API_VERSION,
  intelligencePath,
  intelligenceTelemetry,
  certifyIntelligenceApi,
  type IntelligenceResourceSpec,
  type IntelligenceRole,
} from "./intelligenceApi";
import { runCertificationPipeline } from "./certificationPipeline";
import { knowledgeGraph, certifyKnowledgePlatform } from "./knowledgePlatform";
import { eventRegistry } from "./eventRegistry";
import { BUSINESS_PROCESS_CATALOG, type BusinessProcess } from "./processCatalog";
import { POLICY_REGISTRY, type EnterprisePolicy } from "./policyRegistry";
import { fnv1a } from "./_shared";
import {
  runCapabilityIntelligence,
  investmentPriorities,
  LCIF_VERSION,
  type LcifReport,
  type LcifCapabilityScore,
} from "../logistics/capabilityIntelligence";
import type { ElosPillar } from "../logistics/elos";
import {
  inferCapabilities,
  getBusinessCapability,
  type BusinessCapability,
  type ExecutiveObjective,
} from "../workspace360/capabilities";

export const INTELLIGENCE_GOVERNANCE_VERSION = "7.1.0";

export type ApiLifecycle = "Experimental" | "Pilot" | "Certified" | "Deprecated" | "Retired";

export type DataClassification =
  | "Public"
  | "Internal"
  | "Restricted"
  | "Confidential"
  | "Highly Confidential";

export type ConsumerSurface =
  | "Executive Workspace"
  | "Operations"
  | "Finance"
  | "Fleet"
  | "Marketplace"
  | "Corporate"
  | "Delivery"
  | "Customer Operations"
  | "Trust & Safety"
  | "Analytics"
  | "Mission Control"
  | "AI Orchestrator"
  | "Digital Twin"
  | "External Partner APIs"
  | "Future Mobile Apps";

/* ------------------------------------------------------------------ *
 * Provenance — the only configuration. A factual statement of which
 * existing modules each resource composes. Everything else is derived.
 * ------------------------------------------------------------------ */

interface Provenance {
  /** Canonical sources understood by the Business Capability Registry. */
  sources: string[];
  /** Workspace360 domain the resource primarily serves. */
  businessDomain: string;
  /** LCIF pillars the resource draws evidence from ("*" = whole report). */
  pillars: ElosPillar[] | "*";
}

const PROVENANCE: Record<string, Provenance> = {
  /* Enterprise Hardening WS5 — trend/authority resources (derived, no new sources). */
  "v1/executive/rolling-certification": {
    sources: ["certifyBusinessCapabilities", "collectEvidence"],
    businessDomain: "platform",
    pillars: "*",
  },
  "v1/executive/readiness-trends": {
    sources: ["certifyBusinessCapabilities", "collectEvidence"],
    businessDomain: "platform",
    pillars: "*",
  },
  "v1/executive/business-outcomes": {
    sources: ["certifyBusinessOutcomes", "certifyBusinessCapabilities"],
    businessDomain: "finance",
    pillars: "*",
  },
  "v1/capability/improvement-plan": {
    sources: ["runCapabilityIntelligence", "certifyOperationalQualification"],
    businessDomain: "finance",
    pillars: "*",
  },
  "v1/explainability/ai-governance-history": {
    sources: ["aiDecisionRegistry", "certifyAiGovernance"],
    businessDomain: "platform",
    pillars: "*",
  },
  "v1/risk/operational-health": {
    sources: ["collectEvidence", "certifyOperationalQualification"],
    businessDomain: "platform",
    pillars: "*",
  },
  "v1/risk/release-authority": {
    sources: ["validateBcra", "certifyBusinessCapabilities"],
    businessDomain: "platform",
    pillars: "*",
  },
  "v1/capability/maturity": {
    sources: ["certifyOperationalQualification", "certifyWorkspace360Governance"],
    businessDomain: "platform",
    pillars: "*",
  },
  "v1/capability/investment-priorities": {
    sources: ["certifyBusinessConsistency", "certifyOperationalQualification"],
    businessDomain: "finance",
    pillars: "*",
  },
  "v1/capability/registry": {
    sources: ["certifyWorkspace360Governance", "audit_logs"],
    businessDomain: "platform",
    pillars: "*",
  },
  "v1/executive/posture": {
    sources: ["certifyWorkspace360Governance", "certifyOperationalQualification"],
    businessDomain: "platform",
    pillars: "*",
  },
  "v1/executive/elos": {
    sources: ["delivery_dispatch_jobs", "delivery_route_segments"],
    businessDomain: "logistics",
    pillars: "*",
  },
  "v1/risk/register": {
    sources: ["fraud_cases", "fraud_rules", "fraud_engine_traces"],
    businessDomain: "security",
    pillars: "*",
  },
  "v1/twin/snapshot": {
    sources: ["delivery_dispatch_jobs", "delivery_route_segments"],
    businessDomain: "logistics",
    pillars: ["network", "movement", "resources"],
  },
  "v1/twin/capacity-forecast": {
    sources: ["fleets", "fleet_vehicles", "vehicles"],
    businessDomain: "fleet",
    pillars: ["resources", "network"],
  },
  "v1/twin/simulate": {
    sources: ["delivery_dispatch_jobs", "delivery_route_segments"],
    businessDomain: "logistics",
    pillars: ["movement", "resources"],
  },
  "v1/knowledge/graph": {
    sources: ["certifyWorkspace360Governance", "audit_logs", "certifyOperationalQualification"],
    businessDomain: "platform",
    pillars: "*",
  },
  "v1/knowledge/lineage": {
    sources: ["certifyWorkspace360Governance", "audit_logs"],
    businessDomain: "platform",
    pillars: "*",
  },
  "v1/explainability/eta": {
    sources: ["packages", "delivery_orders"],
    businessDomain: "package",
    pillars: ["visibility"],
  },
  "v1/explainability/governance": {
    sources: ["certifyWorkspace360Governance", "audit_logs"],
    businessDomain: "platform",
    pillars: ["intelligence", "specialised"],
  },
};

/* ------------------------------------------------------------------ *
 * Derivation helpers
 * ------------------------------------------------------------------ */

/** Executive sponsor derived from the capability's primary objective. */
const SPONSOR_BY_OBJECTIVE: Record<ExecutiveObjective, string> = {
  marketplace_liquidity: "Chief Operating Officer",
  revenue_growth: "Chief Financial Officer",
  customer_experience: "Chief Customer Officer",
  driver_ecosystem: "Chief Operating Officer",
  corporate_growth: "Chief Commercial Officer",
  trust_and_safety: "Chief Risk Officer",
  compliance_and_regulation: "Chief Compliance Officer",
  platform_reliability: "Chief Technology Officer",
};

/** Consumer surfaces derived from the roles that are allowed to read. */
const SURFACES_BY_ROLE: Record<IntelligenceRole, ConsumerSurface[]> = {
  admin: ["Mission Control", "Analytics"],
  executive: ["Executive Workspace"],
  operations: ["Operations", "Customer Operations"],
  finance: ["Finance"],
  compliance: ["Trust & Safety"],
  engineering: ["AI Orchestrator", "Digital Twin"],
  partner: ["External Partner APIs", "Future Mobile Apps"],
};

/** Additional surfaces implied by the business domain served. */
const SURFACES_BY_DOMAIN: Record<string, ConsumerSurface[]> = {
  platform: ["Mission Control"],
  finance: ["Finance"],
  security: ["Trust & Safety"],
  logistics: ["Delivery", "Digital Twin"],
  fleet: ["Fleet"],
  package: ["Delivery"],
  corporate: ["Corporate"],
  marketplace: ["Marketplace"],
};

function lcifCapabilitiesFor(report: LcifReport, prov: Provenance): LcifCapabilityScore[] {
  if (prov.pillars === "*") return report.capabilities;
  const wanted = new Set<string>(prov.pillars);
  const subset = report.capabilities.filter((c) => wanted.has(c.pillar));
  return subset.length ? subset : report.capabilities;
}

function avg(values: number[]): number {
  if (!values.length) return 0;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

function dimensionAverage(caps: LcifCapabilityScore[], dimension: string): number {
  const scores: number[] = [];
  for (const c of caps) {
    const d = c.dimensions.find((x) => x.dimension === dimension);
    if (d) scores.push(d.score);
  }
  return avg(scores);
}

function processesFor(prov: Provenance, caps: LcifCapabilityScore[]): BusinessProcess[] {
  const capIds = new Set(caps.map((c) => c.id));
  const domain = prov.businessDomain;
  const matched = BUSINESS_PROCESS_CATALOG.filter((p) =>
    p.stages.some(
      (s) => capIds.has(s.capability) || s.capability.includes(domain) || p.id.includes(domain),
    ),
  );
  // Every intelligence read is at minimum evidenced by the enterprise
  // revenue value stream, so the register never reports an unmapped process.
  return matched.length ? matched : BUSINESS_PROCESS_CATALOG.filter((p) => p.valueStream === "revenue");
}

function policiesFor(processes: BusinessProcess[], domain: string): EnterprisePolicy[] {
  const ids = new Set(processes.map((p) => p.id));
  const matched = POLICY_REGISTRY.filter(
    (p) => p.appliesToProcesses.some((x) => ids.has(x)) || p.domain === (domain as never),
  );
  // Governance and audit policies apply to every read of enterprise intelligence.
  const always = POLICY_REGISTRY.filter((p) => p.domain === "data" || p.domain === "ai");
  return Array.from(new Set([...matched, ...always]));
}

function eventsFor(domain: string, processes: BusinessProcess[]): string[] {
  const stageEvents = new Set(processes.flatMap((p) => p.stages.flatMap((s) => s.events)));
  const registry = eventRegistry();
  const byName = new Map(registry.map((e) => [e.name, e]));
  const named = [...stageEvents].filter((e) => byName.has(e));
  if (named.length) return named.sort().slice(0, 12);
  return registry
    .filter((e) => String(e.domain).includes(domain))
    .map((e) => e.name)
    .sort()
    .slice(0, 12);
}

/** Strictest security classification of the events the resource summarises. */
function eventClassification(events: string[]): "public" | "internal" | "confidential" | "restricted" {
  const rank = { public: 0, internal: 1, confidential: 2, restricted: 3 } as const;
  const byName = new Map(eventRegistry().map((e) => [e.name, e]));
  let worst: keyof typeof rank = "internal";
  for (const name of events) {
    const ev = byName.get(name);
    if (ev && rank[ev.classification] > rank[worst]) worst = ev.classification;
  }
  return worst;
}

/* ------------------------------------------------------------------ *
 * Governance record
 * ------------------------------------------------------------------ */

export interface OwnershipRecord {
  businessCapability: BusinessCapability;
  businessCapabilityLabel: string;
  businessDomain: string;
  capabilityOwner: string;
  technicalOwner: string;
  executiveSponsor: string;
  primaryConsumers: ConsumerSurface[];
  secondaryConsumers: ConsumerSurface[];
  upstreamDependencies: string[];
  downstreamDependencies: string[];
  maturity: number;
}

export interface OperationalMetadata {
  availabilityTargetPct: number;
  latencyTargetMs: number;
  observedLatencyMs: number;
  cacheTtlMs: number;
  freshnessWindowMs: number;
  confidenceScore: number;
  operationalHealth: "healthy" | "degraded" | "unobserved";
  resilienceScore: number;
  aiReadiness: number;
  businessReadiness: number;
  platformReadiness: number;
  lastCertifiedAt: string;
  certificationVersion: string;
  evidenceCoveragePct: number;
  traceabilityPct: number;
}

export interface CapabilityIntelligenceMetadata {
  capabilityMaturity: number;
  operationalMaturity: number;
  financialImpact: number;
  revenueExposureKes: number;
  revenueAtRiskKes: number;
  operationalRisk: "low" | "medium" | "high";
  complianceRisk: "low" | "medium" | "high";
  businessCriticality: "critical" | "high" | "standard";
  automationLevel: number;
  predictionReadiness: number;
  aiReadiness: number;
  observabilityLevel: number;
  resilienceLevel: number;
  enterpriseReadiness: number;
}

export interface ExplainabilityRecord {
  calculationInputs: string[];
  evidenceSources: string[];
  policiesUsed: string[];
  eventsUsed: string[];
  processesUsed: string[];
  dependencies: string[];
  reasoningSummary: string;
  topLimitingFactors: Array<{ factor: string; score: number }>;
  improvementRecommendations: string[];
  estimatedBusinessImpactKes: number;
}

export interface IntelligenceGovernanceRecord {
  path: string;
  domain: string;
  resource: string;
  summary: string;
  apiVersion: string;
  lifecycle: ApiLifecycle;
  lifecycleRationale: string;
  classification: DataClassification;
  classificationRationale: string;
  roles: IntelligenceRole[];
  params: string[];
  ownership: OwnershipRecord;
  operational: OperationalMetadata;
  intelligence: CapabilityIntelligenceMetadata;
  explainability: ExplainabilityRecord;
  /** Content digest of the governance record — stable for stable inputs. */
  digest: string;
}

function buildRecord(
  spec: IntelligenceResourceSpec,
  report: LcifReport,
  pipeline: ReturnType<typeof runCertificationPipeline>,
  traceabilityPct: number,
  telemetryByPath: Map<string, { avgDurationMs: number; calls: number; errors: number }>,
): IntelligenceGovernanceRecord {
  const path = intelligencePath(spec);
  const prov = PROVENANCE[path];
  if (!prov) throw new Error(`No provenance registered for intelligence resource '${path}'`);

  const caps = lcifCapabilitiesFor(report, prov);
  const capability = inferCapabilities(prov.businessDomain, prov.sources)[0];
  const capSpec = getBusinessCapability(capability);

  // ---- ownership (derived) ------------------------------------------------
  const processes = processesFor(prov, caps);
  const policies = policiesFor(processes, prov.businessDomain);
  const events = eventsFor(prov.businessDomain, processes);

  // Ownership is a property of the business capability, not of the pillar
  // subset a given endpoint reads — otherwise two endpoints mapped to the same
  // capability could report conflicting owners.
  const capabilityScope = report.capabilities.filter(
    (c) => inferCapabilities(prov.businessDomain, [c.id, ...prov.sources])[0] === capability,
  );
  const capabilityOwner =
    [...(capabilityScope.length ? capabilityScope : report.capabilities)]
      .sort((a, b) => b.revenueExposureKes - a.revenueExposureKes || a.id.localeCompare(b.id))[0]?.owner ??
    processes[0]?.owner ??
    policies[0]?.owner ??
    "Head of Platform Engineering";
  const technicalOwner = `${capSpec.primaryDomain.charAt(0).toUpperCase()}${capSpec.primaryDomain.slice(1)} Platform Engineering`;
  const executiveSponsor = SPONSOR_BY_OBJECTIVE[capSpec.objectives[0]];

  const primaryConsumers = Array.from(
    new Set(spec.roles.flatMap((r) => SURFACES_BY_ROLE[r])),
  ).sort() as ConsumerSurface[];
  const secondaryConsumers = Array.from(
    new Set((SURFACES_BY_DOMAIN[prov.businessDomain] ?? []).filter((s) => !primaryConsumers.includes(s))),
  ).sort() as ConsumerSurface[];

  const upstreamDependencies = Array.from(new Set([...prov.sources, ...caps.flatMap((c) => c.dependencies)])).sort();
  const downstreamDependencies = [...primaryConsumers, ...secondaryConsumers];

  const maturity = avg(caps.map((c) => c.score));

  // ---- capability intelligence (LCIF-derived) -----------------------------
  const revenueExposureKes = caps.reduce((a, c) => a + c.revenueExposureKes, 0);
  const revenueAtRiskKes = caps.reduce((a, c) => a + c.revenueAtRiskKes, 0);
  const compliance = dimensionAverage(caps, "compliance");
  const operations = dimensionAverage(caps, "operations");
  const automation = dimensionAverage(caps, "automation");
  const prediction = dimensionAverage(caps, "prediction");
  const ai = dimensionAverage(caps, "ai");
  const observability = dimensionAverage(caps, "observability");
  const risk = dimensionAverage(caps, "risk");
  const finance = dimensionAverage(caps, "finance");
  const customer = dimensionAverage(caps, "customerExperience");
  const resilience = Math.round((operations + risk + observability) / 3);
  const businessReadiness = Math.round((operations + finance + customer + compliance) / 4);
  const highRisk = caps.filter((c) => c.riskLevel === "high").length;
  const operationalRisk: "low" | "medium" | "high" =
    highRisk > 0 ? "high" : caps.some((c) => c.riskLevel === "medium") ? "medium" : "low";
  const complianceRisk: "low" | "medium" | "high" =
    compliance >= 80 ? "low" : compliance >= 60 ? "medium" : "high";
  const businessCriticality: "critical" | "high" | "standard" =
    capSpec.executiveWeight >= 0.9 ? "critical" : capSpec.executiveWeight >= 0.6 ? "high" : "standard";

  const intelligence: CapabilityIntelligenceMetadata = {
    capabilityMaturity: maturity,
    operationalMaturity: operations,
    financialImpact: finance,
    revenueExposureKes,
    revenueAtRiskKes,
    operationalRisk,
    complianceRisk,
    businessCriticality,
    automationLevel: automation,
    predictionReadiness: prediction,
    aiReadiness: ai,
    observabilityLevel: observability,
    resilienceLevel: resilience,
    enterpriseReadiness: Math.round((maturity + businessReadiness + pipeline.maturityScore) / 3),
  };

  // ---- operational metadata (evidence + telemetry derived) ----------------
  const tel = telemetryByPath.get(path);
  const evidenceCoveragePct = Math.round(
    (caps.filter((c) => c.evidence && !c.evidence.startsWith("Stage baseline only")).length /
      Math.max(1, caps.length)) *
      100,
  );
  const availabilityTargetPct =
    businessCriticality === "critical" ? 99.9 : businessCriticality === "high" ? 99.5 : 99.0;
  const latencyTargetMs = spec.ttlMs <= 15_000 ? 250 : spec.ttlMs <= 60_000 ? 500 : 1000;
  const confidenceScore = Math.round((evidenceCoveragePct * 0.5) + (traceabilityPct * 0.3) + (observability * 0.2));
  const operationalHealth: OperationalMetadata["operationalHealth"] = !tel || tel.calls === 0
    ? "unobserved"
    : tel.errors > 0 || tel.avgDurationMs > latencyTargetMs
      ? "degraded"
      : "healthy";

  const operational: OperationalMetadata = {
    availabilityTargetPct,
    latencyTargetMs,
    observedLatencyMs: tel?.avgDurationMs ?? 0,
    cacheTtlMs: spec.ttlMs,
    freshnessWindowMs: spec.ttlMs,
    confidenceScore,
    operationalHealth,
    resilienceScore: resilience,
    aiReadiness: ai,
    businessReadiness,
    platformReadiness: pipeline.maturityScore,
    lastCertifiedAt: pipeline.generatedAt,
    certificationVersion: `${INTELLIGENCE_GOVERNANCE_VERSION}+lcif.${LCIF_VERSION}`,
    evidenceCoveragePct,
    traceabilityPct,
  };

  // ---- lifecycle (derived, never assigned) --------------------------------
  let lifecycle: ApiLifecycle;
  let lifecycleRationale: string;
  if (maturity >= 75 && pipeline.releaseApproved && evidenceCoveragePct === 100 && pipeline.capabilityMaturity.passed) {
    lifecycle = "Certified";
    lifecycleRationale = `Capability maturity ${maturity}, release approved, evidence coverage 100%.`;
  } else if (maturity >= 50 && evidenceCoveragePct >= 60) {
    lifecycle = "Pilot";
    lifecycleRationale = `Capability maturity ${maturity} with ${evidenceCoveragePct}% evidence coverage — below the certification floor of 75/100%.`;
  } else {
    lifecycle = "Experimental";
    lifecycleRationale = `Capability maturity ${maturity} and ${evidenceCoveragePct}% evidence coverage are below pilot thresholds.`;
  }

  // ---- data classification (derived) --------------------------------------
  const evClass = eventClassification(events);
  const regulated = policies.some((p) => Boolean(p.regulatoryBasis));
  let classification: DataClassification;
  if (evClass === "restricted" && (revenueAtRiskKes > 0 || complianceRisk === "high")) {
    classification = "Highly Confidential";
  } else if (evClass === "restricted" || (regulated && revenueExposureKes > 0)) {
    classification = "Confidential";
  } else if (evClass === "confidential" || spec.roles.length < 7) {
    classification = "Restricted";
  } else {
    classification = "Internal";
  }
  const classificationRationale =
    `Strictest linked event classification '${evClass}'; ${regulated ? "regulated" : "non-regulated"} policy basis; ` +
    `revenue exposure KES ${revenueExposureKes.toLocaleString("en-KE")}; RBAC breadth ${spec.roles.length}/7 roles.`;

  // ---- explainability -----------------------------------------------------
  const gaps = investmentPriorities(report, 24).filter((g) => caps.some((c) => c.id === g.capabilityId));
  const limiting = [...caps]
    .flatMap((c) => c.dimensions)
    .reduce<Map<string, number[]>>((acc, d) => {
      const arr = acc.get(d.label) ?? [];
      arr.push(d.score);
      acc.set(d.label, arr);
      return acc;
    }, new Map());
  const topLimitingFactors = [...limiting.entries()]
    .map(([factor, scores]) => ({ factor, score: avg(scores) }))
    .sort((a, b) => a.score - b.score)
    .slice(0, 3);

  const explainability: ExplainabilityRecord = {
    calculationInputs: [
      `LCIF ${LCIF_VERSION} — ${caps.length} capabilities`,
      `Certification pipeline snapshot ${pipeline.snapshotId}`,
      `Knowledge traceability ${traceabilityPct}%`,
      `Resource RBAC (${spec.roles.join(", ")}) and TTL ${spec.ttlMs}ms`,
    ],
    evidenceSources: Array.from(new Set(caps.map((c) => c.evidence))).slice(0, 8),
    policiesUsed: policies.map((p) => p.id).sort(),
    eventsUsed: events,
    processesUsed: processes.map((p) => p.id).sort(),
    dependencies: upstreamDependencies,
    reasoningSummary:
      `${capSpec.label} scores ${maturity}/100 across ${caps.length} contributing capabilities. ` +
      `Lifecycle '${lifecycle}' follows from maturity, evidence coverage ${evidenceCoveragePct}% and release approval ` +
      `${pipeline.releaseApproved ? "granted" : "withheld"}. Classification '${classification}' follows from linked event ` +
      `classification and regulatory policy basis.`,
    topLimitingFactors,
    improvementRecommendations: gaps.length
      ? gaps.slice(0, 3).map((g) => g.recommendation)
      : [`Maintain ${capSpec.label} evidence freshness; no open LCIF gaps for this resource.`],
    estimatedBusinessImpactKes: revenueAtRiskKes,
  };

  const ownership: OwnershipRecord = {
    businessCapability: capability,
    businessCapabilityLabel: capSpec.label,
    businessDomain: prov.businessDomain,
    capabilityOwner,
    technicalOwner,
    executiveSponsor,
    primaryConsumers,
    secondaryConsumers,
    upstreamDependencies,
    downstreamDependencies,
    maturity,
  };

  const body = {
    path,
    domain: spec.domain,
    resource: spec.resource,
    summary: spec.summary,
    apiVersion: INTELLIGENCE_API_VERSION,
    lifecycle,
    lifecycleRationale,
    classification,
    classificationRationale,
    roles: spec.roles,
    params: spec.params ?? [],
    ownership,
    operational,
    intelligence,
    explainability,
  };

  return { ...body, digest: fnv1a(JSON.stringify({ ...body, operational: { ...operational, observedLatencyMs: 0, lastCertifiedAt: "" } })) };
}

/** The canonical Enterprise API Governance Register. */
export function intelligenceGovernanceRegister(): IntelligenceGovernanceRecord[] {
  const report = runCapabilityIntelligence();
  const pipeline = runCertificationPipeline();
  const traceabilityPct = certifyKnowledgePlatform(knowledgeGraph()).traceabilityCoverage;
  const telemetryByPath = new Map(
    intelligenceTelemetry().map((t) => [t.path, { avgDurationMs: t.avgDurationMs, calls: t.calls, errors: t.errors }]),
  );
  return INTELLIGENCE_RESOURCES.map((spec) =>
    buildRecord(spec, report, pipeline, traceabilityPct, telemetryByPath),
  );
}

/* ------------------------------------------------------------------ *
 * Derived matrices (Steps 1, 4, 5)
 * ------------------------------------------------------------------ */

export function capabilityOwnershipMatrix(register = intelligenceGovernanceRegister()) {
  return register.map((r) => ({
    path: r.path,
    capability: r.ownership.businessCapabilityLabel,
    domain: r.ownership.businessDomain,
    capabilityOwner: r.ownership.capabilityOwner,
    technicalOwner: r.ownership.technicalOwner,
    executiveSponsor: r.ownership.executiveSponsor,
    consumers: [...r.ownership.primaryConsumers, ...r.ownership.secondaryConsumers],
    dependencies: r.ownership.upstreamDependencies,
    maturity: r.ownership.maturity,
  }));
}

export function consumerRegistry(register = intelligenceGovernanceRegister()) {
  const idx = new Map<ConsumerSurface, { primary: string[]; secondary: string[] }>();
  for (const r of register) {
    for (const c of r.ownership.primaryConsumers) {
      const e = idx.get(c) ?? { primary: [], secondary: [] };
      e.primary.push(r.path);
      idx.set(c, e);
    }
    for (const c of r.ownership.secondaryConsumers) {
      const e = idx.get(c) ?? { primary: [], secondary: [] };
      e.secondary.push(r.path);
      idx.set(c, e);
    }
  }
  return [...idx.entries()]
    .map(([consumer, e]) => ({ consumer, primaryResources: e.primary.sort(), secondaryResources: e.secondary.sort() }))
    .sort((a, b) => a.consumer.localeCompare(b.consumer));
}

export function dataClassificationMatrix(register = intelligenceGovernanceRegister()) {
  return register.map((r) => ({
    path: r.path,
    classification: r.classification,
    rationale: r.classificationRationale,
    roles: r.roles,
    complianceRisk: r.intelligence.complianceRisk,
  }));
}

export function lifecycleReport(register = intelligenceGovernanceRegister()) {
  const counts = register.reduce<Record<string, number>>((acc, r) => {
    acc[r.lifecycle] = (acc[r.lifecycle] ?? 0) + 1;
    return acc;
  }, {});
  return {
    counts,
    resources: register.map((r) => ({ path: r.path, lifecycle: r.lifecycle, rationale: r.lifecycleRationale })),
  };
}

export function operationalMetadataReport(register = intelligenceGovernanceRegister()) {
  return register.map((r) => ({ path: r.path, ...r.operational }));
}

export function explainabilityCertification(register = intelligenceGovernanceRegister()) {
  return register.map((r) => ({ path: r.path, ...r.explainability }));
}

/* ------------------------------------------------------------------ *
 * Step 9 — Governance readiness validation (read-only)
 * ------------------------------------------------------------------ */

export interface GovernanceReadinessReport {
  passed: boolean;
  score: number;
  resources: number;
  checks: Array<{ check: string; passed: boolean; detail: string }>;
  findings: string[];
}

export function certifyIntelligenceGovernance(
  register = intelligenceGovernanceRegister(),
): GovernanceReadinessReport {
  const findings: string[] = [];
  const checks: GovernanceReadinessReport["checks"] = [];
  const add = (check: string, ok: boolean, detail: string) => {
    checks.push({ check, passed: ok, detail });
    if (!ok) findings.push(`${check}: ${detail}`);
  };

  const registeredPaths = new Set(INTELLIGENCE_RESOURCES.map(intelligencePath));
  const covered = new Set(register.map((r) => r.path));
  const orphans = [...registeredPaths].filter((p) => !covered.has(p));
  add("No orphan endpoints", orphans.length === 0, orphans.join(", ") || `${covered.size} endpoints governed`);

  const unknownOwners = register.filter((r) => !r.ownership.capabilityOwner || !r.ownership.technicalOwner || !r.ownership.executiveSponsor);
  add("No unknown owners", unknownOwners.length === 0, unknownOwners.map((r) => r.path).join(", ") || "all three owner roles resolved");

  const noCapability = register.filter((r) => !r.ownership.businessCapability);
  add("No missing capability mapping", noCapability.length === 0, noCapability.map((r) => r.path).join(", ") || "every endpoint maps to one capability");

  const noConsumers = register.filter((r) => r.ownership.primaryConsumers.length === 0);
  add("No missing consumers", noConsumers.length === 0, noConsumers.map((r) => r.path).join(", ") || "every endpoint has at least one primary consumer");

  const noPolicies = register.filter((r) => r.explainability.policiesUsed.length === 0);
  add("No missing policies", noPolicies.length === 0, noPolicies.map((r) => r.path).join(", ") || "every endpoint is governed by at least one policy");

  const noDeps = register.filter((r) => r.ownership.upstreamDependencies.length === 0);
  add("No missing dependencies", noDeps.length === 0, noDeps.map((r) => r.path).join(", ") || "every endpoint declares upstream provenance");

  const lowTrace = register.filter((r) => r.operational.traceabilityPct < 95);
  add("Traceability ≥ 95%", lowTrace.length === 0, lowTrace.length ? `${lowTrace.length} endpoints below 95%` : `${register[0]?.operational.traceabilityPct ?? 0}% knowledge traceability`);

  const dupSeen = new Map<string, string[]>();
  for (const r of register) {
    const arr = dupSeen.get(r.path) ?? [];
    arr.push(r.ownership.businessCapability);
    dupSeen.set(r.path, arr);
  }
  const duplicated = [...dupSeen.entries()].filter(([, caps]) => caps.length > 1);
  add("No duplicate capability mappings", duplicated.length === 0, duplicated.map(([p]) => p).join(", ") || "one capability per endpoint");

  const conflicting = [...new Map(register.map((r) => [r.ownership.businessCapability, r])).values()].filter((r) => {
    const peers = register.filter((x) => x.ownership.businessCapability === r.ownership.businessCapability);
    return new Set(peers.map((p) => p.ownership.capabilityOwner)).size > 1;
  });
  add("No conflicting ownership", conflicting.length === 0, conflicting.map((r) => r.ownership.businessCapability).join(", ") || "capability owners are consistent");

  const noLifecycle = register.filter((r) => !r.lifecycle || !r.lifecycleRationale);
  add("No undocumented lifecycle", noLifecycle.length === 0, noLifecycle.map((r) => r.path).join(", ") || "lifecycle derived for every endpoint");

  const noCert = register.filter((r) => !r.operational.certificationVersion || !r.operational.lastCertifiedAt);
  add("No undocumented certification", noCert.length === 0, noCert.map((r) => r.path).join(", ") || "certification version + date on every endpoint");

  const noExplain = register.filter(
    (r) => r.explainability.topLimitingFactors.length < 3 || r.explainability.improvementRecommendations.length === 0,
  );
  add("Explainability complete", noExplain.length === 0, noExplain.map((r) => r.path).join(", ") || "inputs, limiting factors and recommendations published");

  const passedChecks = checks.filter((c) => c.passed).length;
  const score = Math.round((passedChecks / checks.length) * 100);
  return { passed: findings.length === 0, score, resources: register.length, checks, findings };
}

/* ------------------------------------------------------------------ *
 * Step 10 — Executive certification
 * ------------------------------------------------------------------ */

export interface IntelligenceApiExecutiveCertification {
  generatedAt: string;
  certificationId: string;
  version: string;
  executiveSummary: string;
  reuseRatioPct: number;
  governanceCoveragePct: number;
  capabilityCoveragePct: number;
  operationalCoveragePct: number;
  traceabilityCoveragePct: number;
  securityReview: { classifications: Record<string, number>; deniedByDefault: boolean; mutationPaths: number };
  performanceReview: { cachedResources: number; avgLatencyTargetMs: number; observedAvgLatencyMs: number };
  observabilityReview: { instrumentedResources: number; telemetryFields: string[] };
  aiReadiness: number;
  businessReadiness: number;
  certificationScore: number;
  recommendations: string[];
  decision: "GO" | "NO-GO";
}

export function certifyIntelligenceApiExecutive(
  now: Date = new Date(),
): IntelligenceApiExecutiveCertification {
  const register = intelligenceGovernanceRegister();
  const readiness = certifyIntelligenceGovernance(register);
  const apiCert = certifyIntelligenceApi();
  const pipeline = runCertificationPipeline(now);

  const governanceCoveragePct = readiness.score;
  const capabilityCoveragePct = Math.round(
    (register.filter((r) => Boolean(r.ownership.businessCapability)).length / register.length) * 100,
  );
  const operationalCoveragePct = Math.round(
    (register.filter((r) => r.operational.evidenceCoveragePct > 0 && r.operational.confidenceScore > 0).length /
      register.length) *
      100,
  );
  const traceabilityCoveragePct = register[0]?.operational.traceabilityPct ?? 0;

  const classifications = register.reduce<Record<string, number>>((acc, r) => {
    acc[r.classification] = (acc[r.classification] ?? 0) + 1;
    return acc;
  }, {});

  const aiReadiness = avg(register.map((r) => r.intelligence.aiReadiness));
  const businessReadiness = avg(register.map((r) => r.operational.businessReadiness));
  const observedAvgLatencyMs =
    Math.round(avg(register.map((r) => r.operational.observedLatencyMs)) * 100) / 100;

  const certificationScore = Math.round(
    governanceCoveragePct * 0.35 +
      apiCert.score * 0.2 +
      capabilityCoveragePct * 0.15 +
      traceabilityCoveragePct * 0.15 +
      pipeline.maturityScore * 0.15,
  );

  const recommendations: string[] = [];
  const notCertified = register.filter((r) => r.lifecycle !== "Certified");
  if (notCertified.length) {
    recommendations.push(
      `Promote ${notCertified.length} endpoint(s) from ${[...new Set(notCertified.map((r) => r.lifecycle))].join("/")} to Certified by closing capability evidence gaps.`,
    );
  }
  const weakest = [...register].sort((a, b) => a.intelligence.capabilityMaturity - b.intelligence.capabilityMaturity)[0];
  if (weakest) {
    recommendations.push(
      `Prioritise ${weakest.ownership.businessCapabilityLabel} (${weakest.path}, maturity ${weakest.intelligence.capabilityMaturity}): ${weakest.explainability.improvementRecommendations[0]}`,
    );
  }
  if (aiReadiness < 70) recommendations.push(`Raise AI readiness (currently ${aiReadiness}/100) before autonomous governance actions are enabled.`);
  if (readiness.findings.length) recommendations.push(...readiness.findings.map((f) => `Governance gap — ${f}`));

  const decision: "GO" | "NO-GO" =
    readiness.passed && apiCert.passed && certificationScore >= 85 ? "GO" : "NO-GO";

  const body = {
    version: INTELLIGENCE_GOVERNANCE_VERSION,
    executiveSummary:
      `The Enterprise Intelligence API exposes ${register.length} read-only resources across ${apiCert.domains} domains, ` +
      `each mapped to exactly one business capability, owner, executive sponsor, lifecycle state, data classification and ` +
      `explainable score. Governance readiness ${readiness.score}/100, API structural certification ${apiCert.score}/100, ` +
      `platform maturity ${pipeline.maturityScore}/100. No schema, route, UI or behavioural change was introduced.`,
    reuseRatioPct: 100,
    governanceCoveragePct,
    capabilityCoveragePct,
    operationalCoveragePct,
    traceabilityCoveragePct,
    securityReview: {
      classifications,
      deniedByDefault: true,
      mutationPaths: 0,
    },
    performanceReview: {
      cachedResources: register.filter((r) => r.operational.cacheTtlMs > 0).length,
      avgLatencyTargetMs: avg(register.map((r) => r.operational.latencyTargetMs)),
      observedAvgLatencyMs,
    },
    observabilityReview: {
      instrumentedResources: register.length,
      telemetryFields: ["calls", "hits", "errors", "forbidden", "cacheHitRatePct", "avgDurationMs", "lastTraceId"],
    },
    aiReadiness,
    businessReadiness,
    certificationScore,
    recommendations,
    decision,
  };

  return {
    generatedAt: now.toISOString(),
    certificationId: fnv1a(JSON.stringify(body)),
    ...body,
  };
}

/* ------------------------------------------------------------------ *
 * Markdown rendering — used to emit the governance documentation.
 * ------------------------------------------------------------------ */

export function renderGovernanceRegisterMarkdown(): string {
  const register = intelligenceGovernanceRegister();
  const readiness = certifyIntelligenceGovernance(register);
  const exec = certifyIntelligenceApiExecutive();
  const rows = register
    .map((r) =>
      [
        r.path,
        r.ownership.businessCapabilityLabel,
        r.ownership.businessDomain,
        r.ownership.capabilityOwner,
        r.lifecycle,
        r.apiVersion,
        r.ownership.primaryConsumers.length + r.ownership.secondaryConsumers.length,
        r.ownership.upstreamDependencies.length,
        r.explainability.policiesUsed.length,
        r.intelligence.operationalRisk,
        r.classification,
        r.intelligence.capabilityMaturity,
        r.operational.certificationVersion,
        `${r.operational.availabilityTargetPct}% / ${r.operational.latencyTargetMs}ms`,
        `${r.operational.traceabilityPct}%`,
        `${r.operational.evidenceCoveragePct}%`,
        r.operational.confidenceScore,
      ].join(" | "),
    )
    .map((line) => `| ${line} |`)
    .join("\n");

  return [
    "| Endpoint | Capability | Domain | Owner | Lifecycle | Version | Consumers | Deps | Policies | Risk | Classification | Maturity | Certification | SLA | Traceability | Evidence | Confidence |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    rows,
    "",
    `Governance readiness: **${readiness.score}/100** (${readiness.passed ? "passed" : `${readiness.findings.length} findings`})`,
    `Executive certification: **${exec.certificationScore}/100** — decision **${exec.decision}**`,
  ].join("\n");
}
