/**
 * IEOS Phase 7 · Workstream 1 — Enterprise Intelligence API Layer.
 *
 * A governed, versioned, read-only façade over the existing enterprise
 * capability services. It exposes **capabilities**, never tables: every
 * resource is composed from modules that already exist (LCIF, ELOS, the
 * certification pipeline, the knowledge platform, the digital twin and the
 * prediction/copilot engines). No schema, no network, no mutation.
 *
 * Guarantees provided by this layer:
 *  - versioned      — every resource is addressed as `v1/<domain>/<resource>`
 *  - read-only      — handlers are pure functions of their input
 *  - RBAC           — each resource declares the roles allowed to read it
 *  - caching        — per-resource TTL with deterministic cache keys
 *  - observability   — per-resource call/hit/error counters and latency
 *  - traceability   — every response carries a trace id + content digest
 */
import { fnv1a } from "./_shared";
import { runCertificationPipeline } from "./certificationPipeline";
import { certifyAllCapabilities } from "./maturityGate";
import {
  certifyKnowledgePlatform,
  knowledgeGraph,
  dependenciesOf,
  impactOf,
  capabilityLineage,
  eventLineage,
  processLineage,
} from "./knowledgePlatform";
import {
  runCapabilityIntelligence,
  investmentPriorities,
  LCIF_VERSION,
  type LcifReport,
} from "../logistics/capabilityIntelligence";
import { ELOS_CAPABILITIES, ELOS_NAME, ELOS_VERSION, certifyElos } from "../logistics/elos";
import { buildTwin, simulateTwin, type TwinObservation, type TwinScenario, TWIN_VERSION } from "../logistics/digitalTwin";
import { predictEta, detectAnomalies, forecastCapacity, PREDICTION_ENGINE_VERSION, type EtaInput } from "../logistics/predictionEngine";
import { COPILOT_COMMANDS, certifyCopilot, ORCHESTRATOR_VERSION } from "../logistics/logisticsCopilot";
import { certifyColdChain } from "../logistics/coldChain";
import { capabilityImprovementPlans } from "../logistics/capabilityIntelligence";
import {
  certifyRollingBusiness,
  certifyBusinessOutcomes,
  recertifyOnChange,
} from "./businessCertification";
import { certifyEvidenceIntegrity, collectEvidence, type EvidenceSample } from "./evidenceCollection";
import { aiDecisionLineageLedger, certifyAiDecisionLineage, strictReleaseAuthority } from "./bcra";

export const INTELLIGENCE_API_VERSION = "v1";

export type IntelligenceRole =
  | "admin"
  | "executive"
  | "operations"
  | "finance"
  | "compliance"
  | "engineering"
  | "partner";

export interface IntelligenceContext {
  /** Roles held by the caller. Empty means unauthenticated. */
  roles: IntelligenceRole[];
  /** Caller-supplied correlation id; a deterministic one is derived if absent. */
  correlationId?: string;
  /** Resource-specific, read-only parameters. */
  params?: Record<string, unknown>;
  /** Live counters used to hydrate the digital twin resources. */
  observation?: TwinObservation;
  /** Bypass the cache for this call (does not clear other entries). */
  noCache?: boolean;
}

export type IntelligenceDomain =
  | "capability"
  | "executive"
  | "risk"
  | "twin"
  | "knowledge"
  | "explainability";

export interface IntelligenceResourceSpec {
  /** Addressed as `v1/<domain>/<resource>`. */
  domain: IntelligenceDomain;
  resource: string;
  summary: string;
  roles: IntelligenceRole[];
  ttlMs: number;
  /** Parameters the resource reads from `ctx.params`. */
  params?: string[];
  handler: (ctx: IntelligenceContext) => unknown;
}

export interface IntelligenceEnvelope<T = unknown> {
  ok: boolean;
  apiVersion: string;
  path: string;
  traceId: string;
  correlationId: string;
  generatedAt: string;
  /** Content digest — identical state yields an identical digest. */
  digest: string;
  cached: boolean;
  durationMs: number;
  error?: { code: "forbidden" | "not_found" | "invalid_params" | "handler_error"; message: string };
  data?: T;
}

/* ------------------------------------------------------------------ *
 * Derivation helpers — all scores come from existing evidence.
 * ------------------------------------------------------------------ */

function lcif(): LcifReport {
  return runCapabilityIntelligence();
}

/** The thirteen per-capability scores mandated by the operating model. */
function capabilityScorecard(report: LcifReport) {
  return report.capabilities.map((c) => {
    const by = new Map(c.dimensions.map((d) => [d.dimension, d.score]));
    const get = (d: string) => by.get(d as never) ?? 0;
    const resilience = Math.round((get("operations") + get("risk") + get("observability")) / 3);
    const businessReadiness = Math.round(
      (get("operations") + get("finance") + get("customerExperience") + get("compliance")) / 4,
    );
    return {
      id: c.id,
      label: c.label,
      pillar: c.pillar,
      owner: c.owner,
      kpi: c.kpi,
      evidence: c.evidence,
      stage: c.stage,
      slaTarget: c.slaTarget,
      slaAttainment: c.slaAttainment,
      slaMet: c.slaMet,
      revenueExposureKes: c.revenueExposureKes,
      revenueAtRiskKes: c.revenueAtRiskKes,
      riskLevel: c.riskLevel,
      weakestDimensions: c.limitingDimensions,
      dependencies: c.dependencies,
      scores: {
        operational: get("operations"),
        risk: get("risk"),
        financial: get("finance"),
        customer: get("customerExperience"),
        compliance: get("compliance"),
        automation: get("automation"),
        prediction: get("prediction"),
        ai: get("ai"),
        observability: get("observability"),
        resilience,
        security: get("security"),
        businessReadiness,
        enterpriseMaturity: c.score,
      },
    };
  });
}

function riskRegister(report: LcifReport) {
  const rows: Array<{
    id: string;
    category: "enterprise" | "operational" | "logistics" | "financial" | "fraud" | "sla" | "compliance";
    subject: string;
    severity: "high" | "medium" | "low";
    exposureKes: number;
    evidence: string;
    mitigation: string;
  }> = [];
  for (const c of report.capabilities) {
    if (c.riskLevel !== "low") {
      rows.push({
        id: `logistics:${c.id}`,
        category: "logistics",
        subject: `${c.label} maturity ${c.score}/100`,
        severity: c.riskLevel,
        exposureKes: c.revenueAtRiskKes,
        evidence: c.evidence,
        mitigation: `Close ${c.limitingDimensions.join(", ")} for ${c.label}`,
      });
    }
    if (!c.slaMet) {
      rows.push({
        id: `sla:${c.id}`,
        category: "sla",
        subject: `${c.label} SLA ${c.slaAttainment}% vs ${c.slaTarget}% target`,
        severity: c.slaTarget - c.slaAttainment >= 10 ? "high" : "medium",
        exposureKes: c.revenueAtRiskKes,
        evidence: c.evidence,
        mitigation: `Restore ${c.kpi} to target before the next release gate`,
      });
    }
    const dims = new Map(c.dimensions.map((d) => [d.dimension, d.score]));
    if ((dims.get("compliance") ?? 100) < 70) {
      rows.push({
        id: `compliance:${c.id}`,
        category: "compliance",
        subject: `${c.label} compliance evidence incomplete`,
        severity: "high",
        exposureKes: c.revenueExposureKes,
        evidence: c.evidence,
        mitigation: `Attach immutable evidence to ${c.label} state transitions`,
      });
    }
    if ((dims.get("finance") ?? 100) < 70) {
      rows.push({
        id: `financial:${c.id}`,
        category: "financial",
        subject: `${c.label} unit economics unattributed`,
        severity: "medium",
        exposureKes: c.revenueExposureKes,
        evidence: c.evidence,
        mitigation: `Attribute cost and margin to ${c.label}`,
      });
    }
    if ((dims.get("security") ?? 100) < 70) {
      rows.push({
        id: `fraud:${c.id}`,
        category: "fraud",
        subject: `${c.label} lacks zero-trust controls on mutating actions`,
        severity: "high",
        exposureKes: c.revenueAtRiskKes,
        evidence: c.evidence,
        mitigation: `Apply zero-trust authorisation to ${c.label} actions`,
      });
    }
  }
  return rows.sort((a, b) =>
    a.severity === b.severity ? b.exposureKes - a.exposureKes : a.severity === "high" ? -1 : b.severity === "high" ? 1 : a.severity === "medium" ? -1 : 1,
  );
}

const SIMULATIONS: Record<string, TwinScenario> = {
  demand_surge: { label: "Demand surge +60%", demandMultiplier: 1.6 },
  courier_shortage: { label: "Courier shortage -30%", courierDelta: -30 },
  traffic_congestion: { label: "Severe traffic congestion", trafficIndex: 0.85 },
  weather_disruption: { label: "Weather disruption", weatherIndex: 0.8 },
  fleet_reduction: { label: "Fleet reduction", courierDelta: -15, demandMultiplier: 1.1 },
};

/* ------------------------------------------------------------------ *
 * Resource registry
 * ------------------------------------------------------------------ */

const ALL: IntelligenceRole[] = ["admin", "executive", "operations", "finance", "compliance", "engineering"];

export const INTELLIGENCE_RESOURCES: IntelligenceResourceSpec[] = [
  {
    domain: "capability",
    resource: "maturity",
    summary: "Per-capability maturity, owner, KPI, SLA attainment, evidence and the thirteen operational scores.",
    roles: ALL,
    ttlMs: 60_000,
    handler: () => {
      const report = lcif();
      return {
        lcifVersion: LCIF_VERSION,
        score: report.score,
        band: report.band,
        capabilities: capabilityScorecard(report),
        pillars: report.pillars,
        dimensionAverages: report.dimensionAverages,
        explanation: report.explanation,
      };
    },
  },
  {
    domain: "capability",
    resource: "investment-priorities",
    summary: "Ranked, evidence-derived investment priorities with revenue at risk and recommendations.",
    roles: ["admin", "executive", "finance", "operations"],
    ttlMs: 60_000,
    params: ["limit"],
    handler: (ctx) => {
      const limit = Number(ctx.params?.limit ?? 8);
      const report = lcif();
      return {
        totalRevenueAtRiskKes: report.totalRevenueAtRiskKes,
        priorities: investmentPriorities(report, Number.isFinite(limit) ? limit : 8),
      };
    },
  },
  {
    domain: "capability",
    resource: "registry",
    summary: "The ELOS capability registry with pillar, stage and ownership.",
    roles: ALL,
    ttlMs: 300_000,
    handler: () => ({ name: ELOS_NAME, version: ELOS_VERSION, capabilities: ELOS_CAPABILITIES }),
  },
  {
    domain: "executive",
    resource: "posture",
    summary: "Enterprise, logistics, financial, AI and platform readiness with certification and governance status.",
    roles: ALL,
    ttlMs: 60_000,
    handler: () => {
      const snapshot = runCertificationPipeline();
      const maturity = certifyAllCapabilities();
      const report = lcif();
      const dim = (d: string) => report.dimensionAverages.find((x) => x.dimension === d)?.score ?? 0;
      return {
        enterpriseMaturity: snapshot.maturityScore,
        logisticsMaturity: snapshot.logisticsIntelligence.score,
        financialMaturity: dim("finance"),
        operationalReadiness: dim("operations"),
        aiReadiness: Math.round((dim("ai") + dim("prediction")) / 2),
        platformReadiness: snapshot.capabilityMaturity.score,
        knowledgeScore: snapshot.knowledge.score,
        certification: {
          snapshotId: snapshot.snapshotId,
          releaseApproved: snapshot.releaseApproved,
          blockingReasons: snapshot.blockingReasons,
          coldChain: snapshot.logisticsIntelligence.coldChain,
          copilot: snapshot.logisticsIntelligence.copilot,
        },
        governance: {
          capabilityBlockers: maturity.blockers.length,
          invalidContracts: snapshot.contracts.invalid,
          unwiredEvents: snapshot.contracts.unwiredEvents.length,
          traceabilityCoverage: snapshot.knowledge.traceabilityCoverage,
        },
      };
    },
  },
  {
    domain: "risk",
    resource: "register",
    summary: "Enterprise, operational, logistics, financial, fraud, SLA and compliance risks derived from evidence.",
    roles: ALL,
    ttlMs: 60_000,
    params: ["category"],
    handler: (ctx) => {
      const category = ctx.params?.category as string | undefined;
      const rows = riskRegister(lcif());
      const filtered = category ? rows.filter((r) => r.category === category) : rows;
      return {
        total: filtered.length,
        highSeverity: filtered.filter((r) => r.severity === "high").length,
        exposureKes: filtered.reduce((s, r) => s + r.exposureKes, 0),
        risks: filtered,
      };
    },
  },
  {
    domain: "twin",
    resource: "snapshot",
    summary: "Digital twin nodes, edges, utilisation, bottlenecks, congestion and environment.",
    roles: ALL,
    ttlMs: 15_000,
    handler: (ctx) => buildTwin(ctx.observation ?? {}),
  },
  {
    domain: "twin",
    resource: "capacity-forecast",
    summary: "Capacity/demand forecast and anomaly detection for the current twin state.",
    roles: ALL,
    ttlMs: 30_000,
    handler: (ctx) => {
      const obs = ctx.observation ?? {};
      return {
        engineVersion: PREDICTION_ENGINE_VERSION,
        forecast: forecastCapacity(obs),
        anomalies: detectAnomalies(obs),
      };
    },
  },
  {
    domain: "twin",
    resource: "simulate",
    summary: "Deterministic what-if simulation against the twin (demand surge, shortages, weather, traffic).",
    roles: ["admin", "executive", "operations", "engineering"],
    ttlMs: 15_000,
    params: ["scenario"],
    handler: (ctx) => {
      const key = String(ctx.params?.scenario ?? "demand_surge");
      const scenario = SIMULATIONS[key];
      if (!scenario) throw new Error(`unknown scenario '${key}' — expected one of ${Object.keys(SIMULATIONS).join(", ")}`);
      return { twinVersion: TWIN_VERSION, ...simulateTwin(ctx.observation ?? {}, scenario) };
    },
  },
  {
    domain: "knowledge",
    resource: "graph",
    summary: "Capability, event, policy and process graph with traceability certification.",
    roles: ALL,
    ttlMs: 300_000,
    handler: () => {
      const graph = knowledgeGraph();
      const cert = certifyKnowledgePlatform(graph);
      return {
        nodes: graph.nodes.length,
        edges: graph.edges.length,
        byKind: graph.nodes.reduce<Record<string, number>>((acc, n) => {
          acc[n.kind] = (acc[n.kind] ?? 0) + 1;
          return acc;
        }, {}),
        traceabilityCoverage: cert.traceabilityCoverage,
        orphanNodes: cert.orphanNodes,
        danglingDependencies: cert.danglingDependencies,
        score: cert.score,
        passed: cert.passed,
      };
    },
  },
  {
    domain: "knowledge",
    resource: "lineage",
    summary: "Dependency, impact and lineage traversal for a capability, event or process node.",
    roles: ALL,
    ttlMs: 300_000,
    params: ["nodeId", "module", "event", "process"],
    handler: (ctx) => {
      const p = ctx.params ?? {};
      const nodeId = p.nodeId as string | undefined;
      if (!nodeId && !p.module && !p.event && !p.process) {
        throw new Error("one of nodeId, module, event or process is required");
      }
      return {
        dependencies: nodeId ? dependenciesOf(nodeId) : [],
        impact: nodeId ? impactOf(nodeId) : null,
        capability: p.module ? capabilityLineage(String(p.module)) ?? null : null,
        event: p.event ? eventLineage(String(p.event)) ?? null : null,
        process: p.process ? processLineage(String(p.process)) ?? null : null,
      };
    },
  },
  {
    domain: "explainability",
    resource: "eta",
    summary: "Explainable ETA prediction: confidence band, contributing features and rationale.",
    roles: ALL,
    ttlMs: 15_000,
    params: ["distanceKm", "stopsRemaining", "serviceType", "trafficIndex", "weatherIndex"],
    handler: (ctx) => {
      const p = ctx.params ?? {};
      const distanceKm = Number(p.distanceKm);
      if (!Number.isFinite(distanceKm) || distanceKm <= 0) throw new Error("distanceKm must be a positive number");
      const input: EtaInput = {
        distanceKm,
        stopsRemaining: Number(p.stopsRemaining ?? 0) || 0,
        serviceType: p.serviceType as EtaInput["serviceType"],
        trafficIndex: p.trafficIndex === undefined ? undefined : Number(p.trafficIndex),
        weatherIndex: p.weatherIndex === undefined ? undefined : Number(p.weatherIndex),
      };
      const prediction = predictEta(input);
      return {
        ...prediction,
        approvalRequired: false,
        contributingFactors: prediction.features,
      };
    },
  },
  {
    domain: "explainability",
    resource: "governance",
    summary: "AI governance posture: grounded commands, approval requirements and traceability certification.",
    roles: ALL,
    ttlMs: 300_000,
    handler: () => {
      const copilot = certifyCopilot();
      return {
        orchestratorVersion: ORCHESTRATOR_VERSION,
        traceable: copilot.traceable,
        score: copilot.score,
        passed: copilot.passed,
        coldChain: certifyColdChain(),
        commands: COPILOT_COMMANDS.map((c) => ({
          id: c.id,
          label: c.label,
          summary: c.description,
          autonomy: c.autonomy,
          grounding: c.grounding,
          mutating: c.autonomy === "act_with_approval",
          approvalRequired: c.autonomy === "act_with_approval",
        })),
      };
    },
  },
  {
    domain: "executive",
    resource: "elos",
    summary: "ELOS registry certification — activation rate and pillar coverage.",
    roles: ALL,
    ttlMs: 300_000,
    handler: () => certifyElos(),
  },
  /* -------- Enterprise Hardening WS5 — read-only trend resources -------- */
  {
    domain: "executive",
    resource: "rolling-certification",
    summary: "Rolling 24h/7d/30d/quarter/year business certification with trend, confidence and SLA drift.",
    roles: ALL,
    ttlMs: 60_000,
    params: ["samples"],
    handler: (ctx) =>
      certifyRollingBusiness({ samples: (ctx.params?.samples as EvidenceSample[]) ?? [] }),
  },
  {
    domain: "executive",
    resource: "readiness-trends",
    summary: "Readiness, revenue-at-risk and business-outcome trends derived from the rolling certification windows.",
    roles: ALL,
    ttlMs: 60_000,
    params: ["samples"],
    handler: (ctx) => {
      const rolling = certifyRollingBusiness({ samples: (ctx.params?.samples as EvidenceSample[]) ?? [] });
      return {
        score: rolling.score,
        status: rolling.status,
        blindSpots: rolling.blindSpots,
        readiness: rolling.windows.map((w) => ({ window: w.window, score: w.readiness, trend: w.trend, delta: w.historicalDeltaPct, observed: w.observed })),
        revenueAtRisk: rolling.windows.map((w) => ({ window: w.window, revenueAtRiskKes: w.revenueAtRiskKes })),
        businessOutcome: rolling.windows.map((w) => ({ window: w.window, business: w.business, financial: w.financial, customerExperience: w.customerExperience })),
        slaDrift: rolling.windows.map((w) => ({ window: w.window, slaDriftPct: w.slaDriftPct })),
      };
    },
  },
  {
    domain: "capability",
    resource: "improvement-plan",
    summary: "Per-capability current/target maturity with recommended investment, ROI and implementation priority.",
    roles: ["admin", "executive", "finance", "operations"],
    ttlMs: 60_000,
    handler: () => ({ lcifVersion: LCIF_VERSION, plans: capabilityImprovementPlans(lcif()) }),
  },
  {
    domain: "executive",
    resource: "business-outcomes",
    summary: "Revenue protected/at risk, margin, SLA, churn, cost and business confidence derived from existing evidence.",
    roles: ["admin", "executive", "finance"],
    ttlMs: 60_000,
    handler: () => certifyBusinessOutcomes(),
  },
  {
    domain: "explainability",
    resource: "ai-governance-history",
    summary: "AI decision lineage, prompt fingerprints, replay hashes, approval chains and outcome attribution.",
    roles: ALL,
    ttlMs: 300_000,
    handler: () => {
      const ledger = aiDecisionLineageLedger();
      return { certification: certifyAiDecisionLineage(ledger), ledger };
    },
  },
  {
    domain: "risk",
    resource: "operational-health",
    summary: "Operational health and evidence integrity — freshness, completeness, provenance and checksum validation.",
    roles: ALL,
    ttlMs: 60_000,
    params: ["samples"],
    handler: (ctx) => {
      const evidence = collectEvidence((ctx.params?.samples as EvidenceSample[]) ?? []);
      const recert = recertifyOnChange(undefined, { evidence });
      return {
        operationalReadiness: recert.operationalReadiness,
        businessReadiness: recert.businessReadiness,
        enterpriseReadiness: recert.enterpriseReadiness,
        decision: recert.decision,
        integrity: certifyEvidenceIntegrity(evidence),
      };
    },
  },
  {
    domain: "risk",
    resource: "release-authority",
    summary: "Strict BCRA release authority — every dimension, dependency, value stream, AI rule and contract must pass.",
    roles: ALL,
    ttlMs: 120_000,
    handler: () => {
      const authority = strictReleaseAuthority();
      return {
        decision: authority.decision,
        approved: authority.approved,
        aggregateScore: authority.aggregateScore,
        failedGates: authority.failedGates,
        gates: authority.gates.map((g) => ({ id: g.id, label: g.label, kind: g.kind, passed: g.passed, score: g.score, reasons: g.reasons.slice(0, 3) })),
        fingerprint: authority.fingerprint,
      };
    },
  },
];

export function intelligencePath(spec: IntelligenceResourceSpec): string {
  return `${INTELLIGENCE_API_VERSION}/${spec.domain}/${spec.resource}`;
}

const REGISTRY = new Map(INTELLIGENCE_RESOURCES.map((r) => [intelligencePath(r), r]));

/** Machine-readable catalogue of the API — used by docs and the console. */
export function describeIntelligenceApi() {
  return INTELLIGENCE_RESOURCES.map((r) => ({
    path: intelligencePath(r),
    domain: r.domain,
    resource: r.resource,
    summary: r.summary,
    roles: r.roles,
    ttlMs: r.ttlMs,
    params: r.params ?? [],
    readOnly: true as const,
  }));
}

/* ------------------------------------------------------------------ *
 * Caching + observability
 * ------------------------------------------------------------------ */

interface CacheEntry {
  value: unknown;
  digest: string;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export interface ResourceTelemetry {
  path: string;
  calls: number;
  hits: number;
  errors: number;
  forbidden: number;
  totalDurationMs: number;
  lastTraceId: string | null;
}

const telemetry = new Map<string, ResourceTelemetry>();

function track(path: string): ResourceTelemetry {
  let t = telemetry.get(path);
  if (!t) {
    t = { path, calls: 0, hits: 0, errors: 0, forbidden: 0, totalDurationMs: 0, lastTraceId: null };
    telemetry.set(path, t);
  }
  return t;
}

/** Observability snapshot for the intelligence layer. */
export function intelligenceTelemetry(): Array<ResourceTelemetry & { cacheHitRatePct: number; avgDurationMs: number }> {
  return [...telemetry.values()].map((t) => ({
    ...t,
    cacheHitRatePct: t.calls ? Math.round((t.hits / t.calls) * 100) : 0,
    avgDurationMs: t.calls ? Math.round((t.totalDurationMs / t.calls) * 100) / 100 : 0,
  }));
}

/** Clears caches and counters. Test/ops utility only. */
export function resetIntelligenceApi(): void {
  cache.clear();
  telemetry.clear();
}

function cacheKey(path: string, ctx: IntelligenceContext): string {
  return `${path}|${fnv1a(JSON.stringify({ p: ctx.params ?? null, o: ctx.observation ?? null }))}`;
}

function envelope<T>(
  path: string,
  ctx: IntelligenceContext,
  partial: Partial<IntelligenceEnvelope<T>>,
  startedAt: number,
): IntelligenceEnvelope<T> {
  const correlationId = ctx.correlationId ?? fnv1a(`${path}:${JSON.stringify(ctx.params ?? {})}`);
  return {
    ok: false,
    apiVersion: INTELLIGENCE_API_VERSION,
    path,
    traceId: fnv1a(`${correlationId}:${path}:${startedAt}`),
    correlationId,
    generatedAt: new Date().toISOString(),
    digest: "",
    cached: false,
    durationMs: Math.max(0, Math.round((Date.now() - startedAt) * 100) / 100),
    ...partial,
  } as IntelligenceEnvelope<T>;
}

/**
 * Single read entrypoint. Never throws — failures are returned as an
 * error envelope so callers always have a trace id to correlate on.
 */
export function queryIntelligence<T = unknown>(path: string, ctx: IntelligenceContext): IntelligenceEnvelope<T> {
  const startedAt = Date.now();
  const spec = REGISTRY.get(path);
  if (!spec) {
    return envelope<T>(path, ctx, { error: { code: "not_found", message: `Unknown resource '${path}'` } }, startedAt);
  }

  const t = track(path);
  t.calls += 1;

  const allowed = ctx.roles?.some((r) => spec.roles.includes(r)) ?? false;
  if (!allowed) {
    t.forbidden += 1;
    const env = envelope<T>(path, ctx, {
      error: { code: "forbidden", message: `Requires one of: ${spec.roles.join(", ")}` },
    }, startedAt);
    t.lastTraceId = env.traceId;
    return env;
  }

  const key = cacheKey(path, ctx);
  if (!ctx.noCache) {
    const hit = cache.get(key);
    if (hit && hit.expiresAt > Date.now()) {
      t.hits += 1;
      const env = envelope<T>(path, ctx, { ok: true, cached: true, digest: hit.digest, data: hit.value as T }, startedAt);
      t.totalDurationMs += env.durationMs;
      t.lastTraceId = env.traceId;
      return env;
    }
  }

  try {
    const value = spec.handler(ctx);
    const digest = fnv1a(JSON.stringify(value ?? null));
    cache.set(key, { value, digest, expiresAt: Date.now() + spec.ttlMs });
    const env = envelope<T>(path, ctx, { ok: true, digest, data: value as T }, startedAt);
    t.totalDurationMs += env.durationMs;
    t.lastTraceId = env.traceId;
    return env;
  } catch (error) {
    t.errors += 1;
    const message = error instanceof Error ? error.message : String(error);
    const code = /required|must be|unknown scenario/i.test(message) ? "invalid_params" : "handler_error";
    const env = envelope<T>(path, ctx, { error: { code, message } }, startedAt);
    t.lastTraceId = env.traceId;
    return env;
  }
}

export interface IntelligenceApiCertification {
  version: string;
  resources: number;
  domains: number;
  score: number;
  passed: boolean;
  findings: string[];
}

/** Certifies that every resource is versioned, RBAC-scoped, cached and documented. */
export function certifyIntelligenceApi(): IntelligenceApiCertification {
  const findings: string[] = [];
  const seen = new Set<string>();
  for (const spec of INTELLIGENCE_RESOURCES) {
    const path = intelligencePath(spec);
    if (seen.has(path)) findings.push(`Duplicate resource path ${path}`);
    seen.add(path);
    if (!path.startsWith(`${INTELLIGENCE_API_VERSION}/`)) findings.push(`${path} is not versioned`);
    if (!spec.roles.length) findings.push(`${path} has no RBAC roles`);
    if (spec.ttlMs <= 0) findings.push(`${path} has no cache TTL`);
    if (!spec.summary.trim()) findings.push(`${path} has no summary`);
  }
  const domains = new Set(INTELLIGENCE_RESOURCES.map((r) => r.domain)).size;
  if (domains < 6) findings.push(`Only ${domains}/6 intelligence domains are exposed`);
  const score = Math.max(0, 100 - findings.length * 10);
  return {
    version: INTELLIGENCE_API_VERSION,
    resources: INTELLIGENCE_RESOURCES.length,
    domains,
    score,
    passed: findings.length === 0,
    findings,
  };
}
