/**
 * Phase 2 / 2.5 / 3 / 4 — Evidence-driven Business Certification.
 *
 * Reuse-first: this module adds NO new registry, schema, route or scoring
 * domain. It joins two things that already exist:
 *
 *   • the BCRA certification engines (capability register, value streams,
 *     AI governance registries, enterprise readiness certificate), and
 *   • the Phase 1.5 automated evidence layer (`evidenceCollection`).
 *
 * Previously BCRA scored *design-time* governance only (contracts, processes,
 * policies, events). The evidence layer now supplies *run-time* proof. Here we
 * overlay the two deterministically so a capability cannot certify on paper
 * while its telemetry is missing, stale or breaching.
 *
 *   Phase 2   certifyBusinessCapabilities   — evidence-adjusted capability certification
 *   Phase 2.5 certifyBusinessValueStreams   — value stream certification (Ride-to-Cash, …)
 *   Phase 3   certifyAiGovernanceMaturity   — 5-level AI governance maturity model
 *   Phase 4   executiveBusinessReadiness    — single executive readiness view model
 */

import {
  bcraCapabilityRegister,
  bcraEvidence,
  bcraValueStreamRegister,
  enterpriseReadinessCertificate,
  type BcraCapabilityRegister,
  type BcraEvidenceBundle,
  type EnterpriseReadinessCertificate,
  type ValueStreamRegister,
} from "./bcra";
import {
  collectEvidence,
  certifyEvidenceCollection,
  type EvidenceBundle,
  type EvidenceClass,
  type EvidenceSample,
} from "./evidenceCollection";

export const BUSINESS_CERTIFICATION_VERSION = "1.0.0";

export type CertificationStatus = "certified" | "conditional" | "not_certified";

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function statusFor(score: number, blockers: number): CertificationStatus {
  if (score >= 85 && blockers === 0) return "certified";
  if (score >= 70) return "conditional";
  return "not_certified";
}

/**
 * Deterministic score for one evidence class: meeting readings score full,
 * breaching readings score partially, stale/missing readings score zero.
 * Classes with no catalogue metric fall back to `fallback` (never inflated).
 */
export function evidenceClassScore(
  bundle: EvidenceBundle,
  klass: EvidenceClass,
  fallback = 0,
): number {
  const readings = bundle.readings.filter((r) => r.metric.klass === klass);
  if (readings.length === 0) return fallback;
  const points = readings.reduce((sum, r) => {
    if (r.state === "meeting") return sum + 1;
    if (r.state === "breaching") return sum + 0.4;
    if (r.state === "stale") return sum + 0.15;
    return sum;
  }, 0);
  return clamp((points / readings.length) * 100);
}

export interface BusinessCertificationInputs {
  /** Raw telemetry samples; collected through the Phase 1.5 evidence layer. */
  samples?: ReadonlyArray<EvidenceSample>;
  /** Pre-collected bundle (wins over `samples`). */
  evidence?: EvidenceBundle;
  /** Pre-computed BCRA evidence bundle, so callers can share one run. */
  bcra?: BcraEvidenceBundle;
  /** Evaluation instant — injected to keep runs deterministic. */
  now?: Date | string;
}

function resolveEvidence(inputs: BusinessCertificationInputs): EvidenceBundle {
  return inputs.evidence ?? collectEvidence(inputs.samples ?? [], { now: inputs.now });
}

/* ------------------------------------------------------------------ *
 * Phase 2 — Business Capability Certification (evidence adjusted)
 * ------------------------------------------------------------------ */

export interface CertifiedCapability {
  module: string;
  title: string;
  /** Design-time BCRA readiness score. */
  governanceScore: number;
  /** Run-time evidence score applicable to this capability. */
  evidenceScore: number;
  /** Combined certification score (70% governance / 30% evidence). */
  score: number;
  decision: "release" | "conditional" | "blocked";
  status: CertificationStatus;
  limitingDimension: string;
  revenueAtRiskKes: number;
  blockers: string[];
  findings: string[];
}

export interface BusinessCapabilityCertification {
  version: string;
  capabilities: CertifiedCapability[];
  governanceScore: number;
  evidenceScore: number;
  score: number;
  certified: number;
  conditional: number;
  notCertified: number;
  revenueAtRiskKes: number;
  blockers: string[];
  status: CertificationStatus;
  digest: string;
}

export function certifyBusinessCapabilities(
  inputs: BusinessCertificationInputs = {},
  register: BcraCapabilityRegister = bcraCapabilityRegister(undefined, inputs.bcra ?? bcraEvidence()),
): BusinessCapabilityCertification {
  const evidence = resolveEvidence(inputs);

  // Operational proof applicable to every business capability.
  const perf = evidenceClassScore(evidence, "performance");
  const rel = evidenceClassScore(evidence, "reliability");
  const thr = evidenceClassScore(evidence, "throughput");
  const evidenceScore = clamp(perf * 0.4 + rel * 0.4 + thr * 0.2);

  const capabilities: CertifiedCapability[] = register.capabilities.map((c) => {
    const findings: string[] = [];
    if (evidence.coverage < 90) findings.push(`evidence coverage ${evidence.coverage}% below 90% target`);
    if (rel < 80) findings.push(`reliability evidence ${rel}/100 below 80 floor`);
    if (perf < 80) findings.push(`performance evidence ${perf}/100 below 80 floor`);
    const score = clamp(c.score * 0.7 + evidenceScore * 0.3);
    return {
      module: c.module as string,
      title: c.title,
      governanceScore: c.score,
      evidenceScore,
      score,
      decision: c.decision,
      status: statusFor(score, c.blockers.length),
      limitingDimension: c.limitingDimension as string,
      revenueAtRiskKes: c.revenueAtRiskKes,
      blockers: c.blockers,
      findings,
    };
  });

  const score = capabilities.length === 0
    ? 0
    : clamp(capabilities.reduce((s, c) => s + c.score, 0) / capabilities.length);
  const blockers = capabilities.flatMap((c) => c.blockers.map((b) => `${c.module} · ${b}`));

  return {
    version: BUSINESS_CERTIFICATION_VERSION,
    capabilities,
    governanceScore: register.score,
    evidenceScore,
    score,
    certified: capabilities.filter((c) => c.status === "certified").length,
    conditional: capabilities.filter((c) => c.status === "conditional").length,
    notCertified: capabilities.filter((c) => c.status === "not_certified").length,
    revenueAtRiskKes: register.totalRevenueAtRiskKes,
    blockers,
    status: statusFor(score, blockers.length),
    digest: fnv1a(capabilities.map((c) => `${c.module}:${c.score}:${c.status}`).join("|")),
  };
}

/* ------------------------------------------------------------------ *
 * Phase 2.5 — Business Value Stream Certification
 * ------------------------------------------------------------------ */

export interface CertifiedValueStream {
  id: string;
  name: string;
  classification: string;
  owner: string;
  governanceScore: number;
  evidenceScore: number;
  score: number;
  slaHonoured: boolean;
  weakestCapability: { module: string; score: number } | null;
  status: CertificationStatus;
  p0Risks: number;
  blockers: string[];
}

export interface BusinessValueStreamCertification {
  version: string;
  streams: CertifiedValueStream[];
  score: number;
  certified: number;
  conditional: number;
  notCertified: number;
  /** Weakest end-to-end stream — the enterprise ceiling. */
  weakestStream: CertifiedValueStream | null;
  blockers: string[];
  status: CertificationStatus;
  digest: string;
}

export function certifyBusinessValueStreams(
  inputs: BusinessCertificationInputs = {},
  registers?: { capability?: BcraCapabilityRegister; valueStreams?: ValueStreamRegister },
): BusinessValueStreamCertification {
  const bcra = inputs.bcra ?? bcraEvidence();
  const capabilityRegister = registers?.capability ?? bcraCapabilityRegister(undefined, bcra);
  const register = registers?.valueStreams ?? bcraValueStreamRegister(bcra, capabilityRegister);
  const evidence = resolveEvidence(inputs);

  const rel = evidenceClassScore(evidence, "reliability");
  const perf = evidenceClassScore(evidence, "performance");
  const fresh = evidenceClassScore(evidence, "data_freshness");
  const evidenceScore = clamp(rel * 0.45 + perf * 0.35 + fresh * 0.2);

  const streams: CertifiedValueStream[] = register.streams.map((s) => {
    const score = clamp(s.score * 0.7 + evidenceScore * 0.3);
    return {
      id: s.id as string,
      name: s.name,
      classification: String(s.classification),
      owner: s.owner,
      governanceScore: s.score,
      evidenceScore,
      score,
      slaHonoured: s.slaHonoured,
      weakestCapability: s.weakestCapability,
      status: statusFor(score, s.blockers.length),
      p0Risks: s.risks.filter((r) => r.severity === "p0").length,
      blockers: s.blockers,
    };
  });

  const weakestStream = streams.length === 0
    ? null
    : streams.reduce((m, s) => (s.score < m.score ? s : m));
  const blockers = streams.flatMap((s) => s.blockers.map((b) => `${s.id} · ${b}`));
  const score = streams.length === 0 ? 0 : clamp(streams.reduce((s, v) => s + v.score, 0) / streams.length);

  return {
    version: BUSINESS_CERTIFICATION_VERSION,
    streams,
    score,
    certified: streams.filter((s) => s.status === "certified").length,
    conditional: streams.filter((s) => s.status === "conditional").length,
    notCertified: streams.filter((s) => s.status === "not_certified").length,
    weakestStream,
    blockers,
    status: statusFor(score, blockers.length),
    digest: fnv1a(streams.map((s) => `${s.id}:${s.score}:${s.status}`).join("|")),
  };
}

/* ------------------------------------------------------------------ *
 * Phase 3 — AI Governance Maturity
 * ------------------------------------------------------------------ */

export const AI_MATURITY_LEVELS = [
  "initial",
  "governed",
  "measured",
  "assured",
  "autonomous",
] as const;
export type AiMaturityLevel = (typeof AI_MATURITY_LEVELS)[number];

export interface AiMaturityDimension {
  id: string;
  label: string;
  score: number;
  floor: number;
  passed: boolean;
  level: AiMaturityLevel;
  evidence: string;
  findings: string[];
}

export interface AiGovernanceMaturityReport {
  version: string;
  level: AiMaturityLevel;
  levelIndex: number;
  score: number;
  dimensions: AiMaturityDimension[];
  /** What must be true to reach the next maturity level. */
  nextLevelActions: string[];
  status: CertificationStatus;
  digest: string;
}

function levelFor(score: number): AiMaturityLevel {
  if (score >= 90) return "autonomous";
  if (score >= 80) return "assured";
  if (score >= 65) return "measured";
  if (score >= 50) return "governed";
  return "initial";
}

export function certifyAiGovernanceMaturity(
  inputs: BusinessCertificationInputs = {},
): AiGovernanceMaturityReport {
  const bcra = inputs.bcra ?? bcraEvidence();
  const ai = bcra.ai;
  const evidence = resolveEvidence(inputs);
  const intelligence = evidenceClassScore(evidence, "intelligence");

  /** Registry coverage percentages already produced by the BCRA AI report. */
  const AI_REGISTRY_PCT: Record<string, number> = {
    explainability: ai.explainablePct,
    override: ai.overridePct,
    model: ai.governedPct,
    prompt: ai.governedPct,
    replay: ai.replayablePct,
    audit: ai.governedPct,
    grounding: ai.groundedPct,
    confidence: ai.certification.score,
  };
  const registryScore = (id: string, fallback: number): number => {
    const v = AI_REGISTRY_PCT[id];
    return typeof v === "number" && Number.isFinite(v) ? clamp(v) : fallback;
  };

  const dims: Array<Omit<AiMaturityDimension, "passed" | "level">> = [
    {
      id: "transparency",
      label: "Decision transparency",
      score: registryScore("explainability", ai.score),
      floor: 80,
      evidence: "bcra.aiExplainabilityRegistry",
      findings: [],
    },
    {
      id: "accountability",
      label: "Human accountability & override",
      score: registryScore("override", ai.score),
      floor: 85,
      evidence: "bcra.aiHumanOverrideRegistry",
      findings: [],
    },
    {
      id: "traceability",
      label: "Model & prompt traceability",
      score: clamp((registryScore("model", ai.score) + registryScore("prompt", ai.score)) / 2),
      floor: 80,
      evidence: "bcra.aiModelRegistry, bcra.aiPromptRegistry",
      findings: [],
    },
    {
      id: "reproducibility",
      label: "Replay & inference audit",
      score: clamp((registryScore("replay", ai.score) + registryScore("audit", ai.score)) / 2),
      floor: 80,
      evidence: "bcra.aiReplayRegistry, bcra.aiInferenceAuditRegistry",
      findings: [],
    },
    {
      id: "grounding",
      label: "Grounding & confidence discipline",
      score: clamp((registryScore("grounding", ai.score) + registryScore("confidence", ai.score)) / 2),
      floor: 75,
      evidence: "bcra.aiGroundingRegistry, bcra.aiConfidenceRegistry",
      findings: [],
    },
    {
      id: "performance",
      label: "Operational AI evidence",
      score: intelligence,
      floor: 75,
      evidence: "evidenceCollection(intelligence)",
      findings: intelligence === 0 ? ["no AI runtime evidence recorded (latency / accuracy)"] : [],
    },
  ];

  const dimensions: AiMaturityDimension[] = dims.map((d) => ({
    ...d,
    passed: d.score >= d.floor && d.findings.length === 0,
    level: levelFor(d.score),
    findings: [
      ...d.findings,
      ...(d.score < d.floor ? [`${d.label} ${d.score}/${d.floor}`] : []),
    ],
  }));

  const score = clamp(dimensions.reduce((s, d) => s + d.score, 0) / dimensions.length);
  const level = levelFor(score);
  const idx = AI_MATURITY_LEVELS.indexOf(level);
  const nextLevelActions = dimensions.filter((d) => !d.passed).map((d) => `Raise ${d.label} to ${d.floor} (now ${d.score})`);

  return {
    version: BUSINESS_CERTIFICATION_VERSION,
    level,
    levelIndex: idx + 1,
    score,
    dimensions,
    nextLevelActions,
    status: statusFor(score, nextLevelActions.length > 2 ? 1 : 0),
    digest: fnv1a(dimensions.map((d) => `${d.id}:${d.score}`).join("|")),
  };
}

/* ------------------------------------------------------------------ *
 * Phase 4 — Executive Business Readiness view model
 * ------------------------------------------------------------------ */

export interface ReadinessPillar {
  id: string;
  label: string;
  score: number;
  floor: number;
  passed: boolean;
  detail: string;
}

export interface ExecutiveBusinessReadiness {
  version: string;
  generatedAt: string;
  pillars: ReadinessPillar[];
  score: number;
  decision: "go" | "conditional_go" | "no_go";
  operationalRisk: EnterpriseReadinessCertificate["operationalRisk"];
  revenueAtRiskKes: number;
  capabilities: BusinessCapabilityCertification;
  valueStreams: BusinessValueStreamCertification;
  aiMaturity: AiGovernanceMaturityReport;
  evidence: EvidenceBundle;
  evidenceCertification: ReturnType<typeof certifyEvidenceCollection>;
  certificate: EnterpriseReadinessCertificate;
  /** Highest-leverage executive actions, worst first. */
  topActions: Array<{ area: string; action: string; impact: number }>;
  blockers: string[];
  fingerprint: string;
}

export function executiveBusinessReadiness(
  inputs: BusinessCertificationInputs = {},
): ExecutiveBusinessReadiness {
  const bcra = inputs.bcra ?? bcraEvidence();
  const evidence = resolveEvidence(inputs);
  const shared: BusinessCertificationInputs = { ...inputs, bcra, evidence };

  const capabilityRegister = bcraCapabilityRegister(undefined, bcra);
  const valueStreamRegister = bcraValueStreamRegister(bcra, capabilityRegister);

  const capabilities = certifyBusinessCapabilities(shared, capabilityRegister);
  const valueStreams = certifyBusinessValueStreams(shared, {
    capability: capabilityRegister,
    valueStreams: valueStreamRegister,
  });
  const aiMaturity = certifyAiGovernanceMaturity(shared);
  const evidenceCertification = certifyEvidenceCollection(evidence);
  const certificate = enterpriseReadinessCertificate({ evidence: bcra });

  const pillars: ReadinessPillar[] = [
    {
      id: "capability",
      label: "Business capability certification",
      score: capabilities.score,
      floor: 80,
      passed: false,
      detail: `${capabilities.certified}/${capabilities.capabilities.length} certified`,
    },
    {
      id: "value_stream",
      label: "Value stream certification",
      score: valueStreams.score,
      floor: 80,
      passed: false,
      detail: `${valueStreams.certified}/${valueStreams.streams.length} certified`,
    },
    {
      id: "ai_governance",
      label: "AI governance maturity",
      score: aiMaturity.score,
      floor: 80,
      passed: false,
      detail: `level ${aiMaturity.levelIndex}/5 · ${aiMaturity.level}`,
    },
    {
      id: "evidence",
      label: "Automated evidence",
      score: evidenceCertification.score,
      floor: 80,
      passed: false,
      detail: `${evidence.coverage}% coverage · ${evidence.attainment}% attainment`,
    },
    {
      id: "enterprise_certificate",
      label: "Enterprise readiness certificate",
      score: certificate.enterpriseConfidenceScore,
      floor: 80,
      passed: false,
      detail: certificate.decision.toUpperCase().replace("_", " "),
    },
  ].map((p) => ({ ...p, passed: p.score >= p.floor }));

  const score = clamp(pillars.reduce((s, p) => s + p.score, 0) / pillars.length);
  const failing = pillars.filter((p) => !p.passed);
  const decision: ExecutiveBusinessReadiness["decision"] =
    certificate.decision === "no_go" || failing.some((p) => p.id === "capability" || p.id === "value_stream")
      ? failing.length === 0
        ? "conditional_go"
        : certificate.decision === "no_go"
          ? "no_go"
          : "conditional_go"
      : failing.length === 0
        ? "go"
        : "conditional_go";

  const topActions = [
    ...failing.map((p) => ({ area: p.label, action: `Close ${p.floor - p.score} point gap to floor ${p.floor}`, impact: p.floor - p.score })),
    ...(valueStreams.weakestStream && valueStreams.weakestStream.status !== "certified"
      ? [{
          area: valueStreams.weakestStream.name,
          action: `Weakest value stream — remediate ${valueStreams.weakestStream.weakestCapability?.module ?? "participating capabilities"}`,
          impact: 85 - valueStreams.weakestStream.score,
        }]
      : []),
    ...aiMaturity.nextLevelActions.map((a) => ({ area: "AI governance", action: a, impact: 10 })),
    ...capabilities.capabilities
      .filter((c) => c.status !== "certified")
      .slice(0, 5)
      .map((c) => ({ area: c.title, action: `Limiting dimension: ${c.limitingDimension}`, impact: 85 - c.score })),
  ]
    .filter((a) => a.impact > 0)
    .sort((a, b) => b.impact - a.impact)
    .slice(0, 8);

  const blockers = [
    ...capabilities.blockers,
    ...valueStreams.blockers,
    ...aiMaturity.nextLevelActions,
    ...evidenceCertification.gaps.slice(0, 5),
  ];

  return {
    version: BUSINESS_CERTIFICATION_VERSION,
    generatedAt: evidence.generatedAt,
    pillars,
    score,
    decision,
    operationalRisk: certificate.operationalRisk,
    revenueAtRiskKes: capabilities.revenueAtRiskKes,
    capabilities,
    valueStreams,
    aiMaturity,
    evidence,
    evidenceCertification,
    certificate,
    topActions,
    blockers,
    fingerprint: fnv1a(
      [capabilities.digest, valueStreams.digest, aiMaturity.digest, evidence.digest, certificate.fingerprint, String(score), decision].join("|"),
    ),
  };
}

/* ------------------------------------------------------------------ *
 * Enterprise Hardening — WS1 rolling certification, WS3 event-driven
 * recertification, WS6 dependency-aware value streams, WS7 outcomes.
 *
 * Extension only: every number below is produced by the engines already
 * imported above. No new registry, service, schema, route or scoring
 * domain is introduced — the samples are simply re-windowed and the
 * existing certifications re-run over each window.
 * ------------------------------------------------------------------ */

export const ROLLING_WINDOWS = ["24h", "7d", "30d", "quarter", "year"] as const;
export type RollingWindow = (typeof ROLLING_WINDOWS)[number];

const WINDOW_MINUTES: Record<RollingWindow, number> = {
  "24h": 60 * 24,
  "7d": 60 * 24 * 7,
  "30d": 60 * 24 * 30,
  quarter: 60 * 24 * 91,
  year: 60 * 24 * 365,
};

/** The seventeen certification facets every rolling window must expose. */
export interface RollingCertificationFacets {
  business: number;
  operational: number;
  financial: number;
  ai: number;
  security: number;
  compliance: number;
  integration: number;
  customerExperience: number;
  automation: number;
  prediction: number;
  resilience: number;
  governance: number;
  readiness: number;
}

export interface RollingCertification extends RollingCertificationFacets {
  window: RollingWindow;
  /** False when no telemetry falls inside the window — never scored as 100. */
  observed: boolean;
  status: CertificationStatus;
  trend: "improving" | "stable" | "degrading" | "unknown";
  /** 0-100 — how much of the score rests on fresh, sufficient evidence. */
  confidence: number;
  evidenceCount: number;
  revenueAtRiskKes: number;
  customerImpactPct: number;
  slaDriftPct: number;
  /** Delta against the next-longer window (the historical baseline). */
  historicalDeltaPct: number;
  digest: string;
}

export interface RollingCertificationReport {
  version: string;
  generatedAt: string;
  windows: RollingCertification[];
  /** Weakest observed window governs — longer windows never mask a bad day. */
  score: number;
  status: CertificationStatus;
  blindSpots: string[];
  digest: string;
}

function windowSamples(
  samples: ReadonlyArray<EvidenceSample>,
  window: RollingWindow,
  now: Date,
): EvidenceSample[] {
  const cutoff = now.getTime() - WINDOW_MINUTES[window] * 60_000;
  return samples.filter((s) => {
    const t = Date.parse(s.observedAt);
    return Number.isFinite(t) && t >= cutoff && t <= now.getTime();
  });
}

function facetsFor(
  bundle: EvidenceBundle,
  readiness: ExecutiveBusinessReadiness,
): RollingCertificationFacets {
  const cert = readiness.certificate;
  const dim = (id: string, fallback: number) =>
    clamp(cert.dimensions.find((d) => d.id === id)?.score ?? fallback);
  const ev = (klass: EvidenceClass, fallback: number) => evidenceClassScore(bundle, klass, fallback);

  return {
    business: readiness.capabilities.score,
    operational: ev("throughput", dim("operational_readiness", readiness.score)),
    financial: ev("data_freshness", dim("business_outcomes", readiness.score)),
    ai: readiness.aiMaturity.score,
    security: dim("security", readiness.score),
    compliance: dim("compliance", readiness.score),
    integration: ev("performance", dim("dependency_intelligence", readiness.score)),
    customerExperience: clamp(100 - cert.customerImpactPct),
    automation: dim("automation", readiness.aiMaturity.score),
    prediction: readiness.aiMaturity.score,
    resilience: ev("reliability", dim("resilience", readiness.score)),
    governance: cert.enterpriseConfidenceScore,
    readiness: readiness.score,
  };
}

function facetAverage(f: RollingCertificationFacets): number {
  const values = Object.values(f);
  return clamp(values.reduce((s, v) => s + v, 0) / values.length);
}

/**
 * WS1 — rolling business certification over 24h / 7d / 30d / quarter / year.
 *
 * Each window re-runs `executiveBusinessReadiness` against only the telemetry
 * observed inside that window, so the result is the existing certification,
 * time-sliced. Windows without telemetry report `observed: false`.
 */
export function certifyRollingBusiness(
  inputs: BusinessCertificationInputs & { samples?: ReadonlyArray<EvidenceSample> } = {},
): RollingCertificationReport {
  const now = inputs.now ? new Date(inputs.now) : new Date();
  const samples = inputs.samples ?? [];
  const bcra = inputs.bcra ?? bcraEvidence();

  const computed = ROLLING_WINDOWS.map((window) => {
    const scoped = windowSamples(samples, window, now);
    const evidence = collectEvidence(scoped, { now });
    const readiness = executiveBusinessReadiness({ ...inputs, bcra, evidence, samples: scoped });
    const facets = facetsFor(evidence, readiness);
    const observed = scoped.length > 0;
    const fresh = evidence.readings.filter((r) => r.state === "meeting" || r.state === "breaching").length;
    return { window, scoped, evidence, readiness, facets, observed, fresh };
  });

  const windows: RollingCertification[] = computed.map((c, index) => {
    const base = facetAverage(c.facets);
    const longer = computed[index + 1];
    const longerScore = longer ? facetAverage(longer.facets) : null;
    const delta = longerScore === null ? 0 : base - longerScore;
    const slaDrift = clamp(100 - c.facets.customerExperience);
    const digest = fnv1a(`${c.window}|${JSON.stringify(c.facets)}|${c.evidence.digest}`);

    return {
      window: c.window,
      ...c.facets,
      observed: c.observed,
      status: statusFor(base, c.readiness.blockers.length > 0 ? 1 : 0),
      trend: !c.observed || longerScore === null ? "unknown" : delta > 2 ? "improving" : delta < -2 ? "degrading" : "stable",
      confidence: clamp(c.evidence.coverage * 0.6 + c.evidence.attainment * 0.4),
      evidenceCount: c.scoped.length,
      revenueAtRiskKes: c.readiness.revenueAtRiskKes,
      customerImpactPct: clamp(c.readiness.certificate.customerImpactPct),
      slaDriftPct: slaDrift,
      historicalDeltaPct: Math.round(delta),
      digest,
    };
  });

  const observed = windows.filter((w) => w.observed);
  const score = observed.length === 0
    ? clamp(facetAverage(computed[0].facets))
    : clamp(Math.min(...observed.map((w) => facetAverage(w))));

  return {
    version: BUSINESS_CERTIFICATION_VERSION,
    generatedAt: now.toISOString(),
    windows,
    score,
    status: statusFor(score, windows.some((w) => w.status === "not_certified") ? 1 : 0),
    blindSpots: windows.filter((w) => !w.observed).map((w) => `no telemetry inside the ${w.window} window`),
    digest: fnv1a(windows.map((w) => w.digest).join("|")),
  };
}

/* ------------------------------------------------------------------ *
 * WS3 — event-driven continuous certification
 * ------------------------------------------------------------------ */

export const CERTIFICATION_TRIGGERS = [
  "capability",
  "policy",
  "process",
  "event",
  "contract",
  "evidence",
  "ai",
  "integration",
] as const;
export type CertificationTrigger = (typeof CERTIFICATION_TRIGGERS)[number];

export interface ContinuousRecertification {
  trigger: CertificationTrigger[];
  capabilityReadiness: number;
  businessReadiness: number;
  operationalReadiness: number;
  enterpriseReadiness: number;
  decision: ExecutiveBusinessReadiness["decision"];
  changed: boolean;
  previousFingerprint: string | null;
  fingerprint: string;
  readiness: ExecutiveBusinessReadiness;
}

/**
 * Recompute readiness whenever a governed artefact changes. Reuses the
 * existing engines end-to-end; the trigger list is recorded for audit only.
 */
export function recertifyOnChange(
  trigger: CertificationTrigger[] = [...CERTIFICATION_TRIGGERS],
  inputs: BusinessCertificationInputs = {},
  previousFingerprint: string | null = null,
): ContinuousRecertification {
  const readiness = executiveBusinessReadiness(inputs);
  const operational = clamp(
    readiness.certificate.dimensions
      .filter((d) => d.id === "operational_readiness" || d.id === "resilience" || d.id === "automation")
      .reduce((s, d, _i, arr) => s + d.score / Math.max(1, arr.length), 0) || readiness.score,
  );

  return {
    trigger: [...trigger].sort(),
    capabilityReadiness: readiness.capabilities.score,
    businessReadiness: readiness.score,
    operationalReadiness: operational,
    enterpriseReadiness: readiness.certificate.enterpriseConfidenceScore,
    decision: readiness.decision,
    changed: previousFingerprint !== null && previousFingerprint !== readiness.fingerprint,
    previousFingerprint,
    fingerprint: readiness.fingerprint,
    readiness,
  };
}

/* ------------------------------------------------------------------ *
 * WS7 — business outcome certification
 * ------------------------------------------------------------------ */

export interface BusinessOutcomeCertification {
  revenueProtectedKes: number;
  revenueAtRiskKes: number;
  expectedMarginPct: number;
  expectedSlaPct: number;
  customerSatisfactionImpactPct: number;
  predictedChurnPct: number;
  operationalCostIndex: number;
  riskReductionPct: number;
  businessConfidencePct: number;
  digest: string;
}

export function certifyBusinessOutcomes(
  readiness: ExecutiveBusinessReadiness = executiveBusinessReadiness(),
): BusinessOutcomeCertification {
  const outcomes = readiness.certificate.outcomes;
  const atRisk = outcomes.totalRevenueAtRiskKes;
  const exposure = atRisk === 0 ? 0 : Math.round(atRisk / Math.max(0.01, 1 - outcomes.revenueProtectedPct / 100));
  const protectedKes = Math.max(0, exposure - atRisk);
  const slaPct = clamp(outcomes.slaProtectedPct);
  const churn = Math.max(0, Math.round((100 - slaPct) * 0.35));

  const out: Omit<BusinessOutcomeCertification, "digest"> = {
    revenueProtectedKes: protectedKes,
    revenueAtRiskKes: atRisk,
    expectedMarginPct: clamp(readiness.score * 0.35),
    expectedSlaPct: slaPct,
    customerSatisfactionImpactPct: clamp(readiness.certificate.customerImpactPct),
    predictedChurnPct: churn,
    operationalCostIndex: clamp(100 - readiness.capabilities.score),
    riskReductionPct: clamp(readiness.certificate.enterpriseConfidenceScore - (100 - slaPct)),
    businessConfidencePct: clamp(readiness.score * 0.6 + readiness.certificate.enterpriseConfidenceScore * 0.4),
  };
  return { ...out, digest: fnv1a(JSON.stringify(out)) };
}
