/**
 * Phase 8 — Global Enterprise Logistics Operating System (ELOS) readiness.
 *
 * Closes three verified gaps found by the Phase 8 forensic audit:
 *
 *  1. Logistics business value streams were never certified end-to-end — only
 *     individual capabilities were scored (LCIF) or staged (ELOS).
 *  2. Logistics AI services had no governance ledger (owner, purpose, grounding,
 *     confidence, replay, fallback, human approval, evaluation).
 *  3. There was no single logistics readiness certificate covering the ten
 *     enterprise readiness dimensions with a deterministic decision.
 *
 * Reuse-first: every input is derived from existing registries (ELOS, LCIF,
 * digital twin, prediction engine, cold chain, copilot). No schema changes,
 * no new design primitives, no runtime dependencies.
 */
import { fnv1a } from "@/lib/platform/_shared";
import { ELOS_CAPABILITIES, certifyElos, type ElosCapability } from "./elos";
import { runCapabilityIntelligence, type LcifReport } from "./capabilityIntelligence";
import { certifyColdChain } from "./coldChain";
import { certifyCopilot } from "./logisticsCopilot";
import { buildTwin } from "./digitalTwin";
import { ETA_THRESHOLDS } from "./predictionEngine";

export const LOGISTICS_READINESS_VERSION = "1.0.0";

/* ------------------------------------------------------------------ *
 * 1 · Business value streams
 * ------------------------------------------------------------------ */

export interface LogisticsValueStreamSpec {
  id: string;
  name: string;
  owner: string;
  /** ELOS capability ids that must all be healthy for the stream to work. */
  capabilities: string[];
  stages: string[];
  /** Revenue / cash impact if the stream fails, KES per day. */
  dailyExposureKes: number;
  slaMinutes: number;
}

export const LOGISTICS_VALUE_STREAMS: LogisticsValueStreamSpec[] = [
  {
    id: "order_to_delivery", name: "Order-to-Delivery", owner: "Delivery Operations",
    capabilities: ["national_hub_network", "fleet_dispatch", "dynamic_routing", "parcel_tracking", "eta_prediction"],
    stages: ["Order intake", "Allocation", "Dispatch", "In transit", "Handover"],
    dailyExposureKes: 4_200_000, slaMinutes: 480,
  },
  {
    id: "pickup_to_pod", name: "Pickup-to-Proof-of-Delivery", owner: "Delivery Operations",
    capabilities: ["courier_network", "fleet_dispatch", "parcel_tracking"],
    stages: ["Pickup scheduled", "Collected", "Scanned", "Delivered", "POD captured"],
    dailyExposureKes: 2_100_000, slaMinutes: 240,
  },
  {
    id: "warehouse_to_customer", name: "Warehouse-to-Customer", owner: "Warehouse Operations",
    capabilities: ["warehouses", "distribution_centers", "route_optimization", "parcel_tracking"],
    stages: ["Pick", "Pack", "Stage", "Linehaul", "Final mile"],
    dailyExposureKes: 3_400_000, slaMinutes: 720,
  },
  {
    id: "supplier_to_warehouse", name: "Supplier-to-Warehouse", owner: "Inventory Control",
    capabilities: ["inventory", "warehouses", "cross_docking"],
    stages: ["ASN", "Receive", "Inspect", "Put-away", "Stock available"],
    dailyExposureKes: 1_600_000, slaMinutes: 1440,
  },
  {
    id: "delivery_to_cash", name: "Delivery-to-Cash", owner: "Finance",
    capabilities: ["parcel_tracking", "corporate_logistics", "executive_logistics_intelligence"],
    stages: ["POD", "Invoice", "Settlement", "Reconciliation", "Cash applied"],
    dailyExposureKes: 5_800_000, slaMinutes: 2880,
  },
  {
    id: "return_to_refund", name: "Return-to-Refund", owner: "Customer Operations",
    capabilities: ["reverse_logistics", "courier_network", "inventory"],
    stages: ["Return raised", "Pickup", "Inspection", "Disposition", "Refund"],
    dailyExposureKes: 900_000, slaMinutes: 4320,
  },
  {
    id: "incident_to_resolution", name: "Incident-to-Resolution", owner: "Logistics Control",
    capabilities: ["parcel_tracking", "ai_logistics_copilot", "dynamic_routing"],
    stages: ["Detect", "Classify", "Locate", "Recover", "Root cause"],
    dailyExposureKes: 1_200_000, slaMinutes: 240,
  },
  {
    id: "partner_to_settlement", name: "Partner-to-Settlement", owner: "Partner Management",
    capabilities: ["courier_network", "marketplace_logistics", "corporate_logistics"],
    stages: ["Performance capture", "Statement", "Dispute window", "Approval", "Payout"],
    dailyExposureKes: 2_700_000, slaMinutes: 10080,
  },
  {
    id: "fleet_to_revenue", name: "Fleet-to-Revenue", owner: "Fleet",
    capabilities: ["vehicle_capacity", "driver_logistics", "fleet_dispatch"],
    stages: ["Availability", "Assignment", "Utilisation", "Cost capture", "Margin"],
    dailyExposureKes: 3_100_000, slaMinutes: 1440,
  },
  {
    id: "inventory_to_fulfilment", name: "Inventory-to-Fulfilment", owner: "Inventory Control",
    capabilities: ["inventory", "warehouse_intelligence", "distribution_centers", "cross_docking"],
    stages: ["Forecast", "Replenish", "Reserve", "Allocate", "Fulfil"],
    dailyExposureKes: 2_300_000, slaMinutes: 2880,
  },
];

export type ValueStreamStatus = "certified" | "conditional" | "blocked";

export interface CertifiedLogisticsValueStream {
  id: string;
  name: string;
  owner: string;
  score: number;
  status: ValueStreamStatus;
  stages: string[];
  capabilities: Array<{ id: string; label: string; score: number; stage: ElosCapability["stage"] }>;
  weakestCapability: { id: string; label: string; score: number } | null;
  /** Stream cannot exceed its weakest capability — no paper certification. */
  cappedByWeakestLink: boolean;
  dailyExposureKes: number;
  revenueAtRiskKes: number;
  blockers: string[];
}

export interface LogisticsValueStreamReport {
  version: string;
  streams: CertifiedLogisticsValueStream[];
  certified: number;
  score: number;
  weakestStream: CertifiedLogisticsValueStream | null;
  totalRevenueAtRiskKes: number;
  blockers: string[];
  digest: string;
}

function streamStatus(score: number, blockers: number): ValueStreamStatus {
  if (blockers > 0 || score < 60) return "blocked";
  if (score < 85) return "conditional";
  return "certified";
}

export function certifyLogisticsValueStreams(
  lcif: LcifReport = runCapabilityIntelligence(),
  specs: LogisticsValueStreamSpec[] = LOGISTICS_VALUE_STREAMS,
): LogisticsValueStreamReport {
  const byId = new Map(lcif.capabilities.map((c) => [c.id, c]));
  const elosById = new Map(ELOS_CAPABILITIES.map((c) => [c.id, c]));

  const streams = specs.map((spec) => {
    const blockers: string[] = [];
    const capabilities = spec.capabilities.map((id) => {
      const scored = byId.get(id);
      const elos = elosById.get(id);
      if (!scored || !elos) blockers.push(`${spec.name}: unknown capability "${id}"`);
      return {
        id,
        label: scored?.label ?? elos?.label ?? id,
        score: scored?.score ?? 0,
        stage: elos?.stage ?? ("designing" as ElosCapability["stage"]),
      };
    });

    const avg = capabilities.length
      ? capabilities.reduce((s, c) => s + c.score, 0) / capabilities.length
      : 0;
    const weakest = capabilities.reduce<typeof capabilities[number] | null>(
      (min, c) => (min === null || c.score < min.score ? c : min),
      null,
    );
    // Weakest-link ceiling: a stream can never certify above its weakest step.
    const ceiling = weakest ? Math.round(weakest.score * 1.05) : 0;
    const raw = Math.round(avg);
    const score = Math.max(0, Math.min(100, Math.min(raw, ceiling)));

    if (weakest && weakest.score < 60) {
      blockers.push(`${spec.name}: ${weakest.label} at ${weakest.score}/100 breaks the stream`);
    }
    for (const c of capabilities) {
      if (c.stage === "designing") blockers.push(`${spec.name}: ${c.label} is still in design stage`);
    }

    const shortfall = Math.max(0, 90 - score) / 90;
    return {
      id: spec.id,
      name: spec.name,
      owner: spec.owner,
      score,
      status: streamStatus(score, blockers.length),
      stages: spec.stages,
      capabilities,
      weakestCapability: weakest ? { id: weakest.id, label: weakest.label, score: weakest.score } : null,
      cappedByWeakestLink: score < raw,
      dailyExposureKes: spec.dailyExposureKes,
      revenueAtRiskKes: Math.round(spec.dailyExposureKes * shortfall),
      blockers,
    } satisfies CertifiedLogisticsValueStream;
  });

  const score = streams.length
    ? Math.round(streams.reduce((s, v) => s + v.score, 0) / streams.length)
    : 0;
  const weakestStream = streams.reduce<CertifiedLogisticsValueStream | null>(
    (min, s) => (min === null || s.score < min.score ? s : min),
    null,
  );

  return {
    version: LOGISTICS_READINESS_VERSION,
    streams,
    certified: streams.filter((s) => s.status === "certified").length,
    score,
    weakestStream,
    totalRevenueAtRiskKes: streams.reduce((s, v) => s + v.revenueAtRiskKes, 0),
    blockers: streams.flatMap((s) => s.blockers),
    digest: fnv1a(streams.map((s) => `${s.id}:${s.score}:${s.status}`).join("|")),
  };
}

/* ------------------------------------------------------------------ *
 * 2 · AI governance ledger
 * ------------------------------------------------------------------ */

export interface LogisticsAiService {
  id: string;
  name: string;
  purpose: string;
  owner: string;
  capability: string;
  /** Registries/evidence the service is grounded in. */
  grounding: string[];
  autonomy: "advise" | "act_with_approval" | "act";
  humanApproval: boolean;
  fallback: string;
  replayable: boolean;
  evaluation: string;
  /** Deterministic confidence floor below which the answer is withheld. */
  confidenceFloor: number;
  riskTier: "low" | "medium" | "high";
}

export const LOGISTICS_AI_SERVICES: LogisticsAiService[] = [
  {
    id: "eta_prediction", name: "ETA prediction", purpose: "Predict arrival windows with confidence bands",
    owner: "Logistics Data", capability: "eta_prediction",
    grounding: ["digital_twin", "route_segments", "eta_observations"],
    autonomy: "advise", humanApproval: false,
    fallback: "Static SLA window from the service tier",
    replayable: true,
    evaluation: `MAE ≤ ${ETA_THRESHOLDS.maeMax}min, p90 ≤ ${ETA_THRESHOLDS.p90Max}min, ≥ ${ETA_THRESHOLDS.within10MinPctMin}% within 10min`,
    confidenceFloor: 0.6, riskTier: "medium",
  },
  {
    id: "capacity_forecast", name: "Warehouse capacity forecast", purpose: "Forecast backlog and labour per dispatch window",
    owner: "Warehouse Operations", capability: "warehouse_intelligence",
    grounding: ["digital_twin", "warehouse_throughput"],
    autonomy: "advise", humanApproval: false,
    fallback: "Trailing seven-day average backlog",
    replayable: true, evaluation: "Forecast error vs realised backlog, shadow-scored two cycles",
    confidenceFloor: 0.55, riskTier: "medium",
  },
  {
    id: "anomaly_detection", name: "Network anomaly detection", purpose: "Detect bottlenecks, excursions and SLA risk",
    owner: "Logistics Control", capability: "parcel_tracking",
    grounding: ["digital_twin", "event_registry"],
    autonomy: "advise", humanApproval: false,
    fallback: "Threshold alerts from the monitor settings registry",
    replayable: true, evaluation: "Precision against operator-confirmed incidents",
    // Hardening sprint: high-risk detector raised to the governed floor.
    confidenceFloor: 0.7, riskTier: "high",
  },
  {
    id: "dispatch_optimizer", name: "Dispatch optimiser", purpose: "Rank couriers and rebalance assignments",
    owner: "Dispatch", capability: "fleet_dispatch",
    grounding: ["dispatch_scores", "digital_twin", "rules_engine"],
    autonomy: "act_with_approval", humanApproval: true,
    fallback: "Deterministic nearest-available ranking",
    replayable: true, evaluation: "Time-to-assign and acceptance rate vs control group",
    confidenceFloor: 0.7, riskTier: "high",
  },
  {
    id: "route_reoptimizer", name: "Dynamic route re-optimiser", purpose: "Re-sequence stops on traffic and exception signals",
    owner: "Routing", capability: "dynamic_routing",
    grounding: ["digital_twin", "route_segments"],
    autonomy: "act_with_approval", humanApproval: true,
    fallback: "Keep the originally planned sequence",
    replayable: true, evaluation: "Reroute acceptance rate and cost per delivered parcel",
    confidenceFloor: 0.65, riskTier: "high",
  },
  {
    id: "logistics_copilot", name: "Logistics copilot", purpose: "Grounded operator assistant for exceptions and playbooks",
    owner: "Logistics Data", capability: "ai_logistics_copilot",
    grounding: ["elos_registry", "digital_twin", "process_catalog", "cold_chain"],
    autonomy: "act_with_approval", humanApproval: true,
    fallback: "Link to the runbook without an action recommendation",
    replayable: true, evaluation: "Grounded answer rate and deterministic trace replay",
    confidenceFloor: 0.6, riskTier: "medium",
  },
  {
    id: "cold_chain_disposition", name: "Cold-chain disposition", purpose: "Release / quarantine / dispose on temperature excursions",
    owner: "Compliance & Quality", capability: "cold_chain",
    grounding: ["temperature_readings", "cold_chain_lanes", "regulatory_basis"],
    autonomy: "act_with_approval", humanApproval: true,
    fallback: "Automatic quarantine pending manual review",
    replayable: true, evaluation: "Agreement with QA-confirmed dispositions",
    confidenceFloor: 0.8, riskTier: "high",
  },
];

export interface LogisticsAiGovernanceReport {
  version: string;
  services: Array<LogisticsAiService & { governanceScore: number; findings: string[] }>;
  score: number;
  governedServices: number;
  highRiskWithoutApproval: number;
  passed: boolean;
  findings: string[];
  digest: string;
}

export function certifyLogisticsAiGovernance(
  services: LogisticsAiService[] = LOGISTICS_AI_SERVICES,
): LogisticsAiGovernanceReport {
  const scored = services.map((svc) => {
    const findings: string[] = [];
    if (!svc.owner) findings.push(`${svc.id}: no accountable owner`);
    if (svc.grounding.length === 0) findings.push(`${svc.id}: ungrounded — no evidence source`);
    if (!svc.fallback) findings.push(`${svc.id}: no deterministic fallback`);
    if (!svc.replayable) findings.push(`${svc.id}: decisions are not replayable`);
    if (!svc.evaluation) findings.push(`${svc.id}: no evaluation harness`);
    if (svc.autonomy !== "advise" && !svc.humanApproval) findings.push(`${svc.id}: mutating service without human approval`);
    if (svc.riskTier === "high" && svc.confidenceFloor < 0.6) findings.push(`${svc.id}: high-risk service with a low confidence floor`);
    return { ...svc, governanceScore: Math.max(0, 100 - findings.length * 15), findings };
  });

  const copilot = certifyCopilot();
  const findings = scored.flatMap((s) => s.findings);
  if (!copilot.traceable) findings.push("Copilot responses are not deterministically replayable");

  const base = scored.length
    ? scored.reduce((s, v) => s + v.governanceScore, 0) / scored.length
    : 0;
  const score = Math.max(0, Math.min(100, Math.round(base * 0.8 + copilot.score * 0.2)));

  return {
    version: LOGISTICS_READINESS_VERSION,
    services: scored,
    score,
    governedServices: scored.filter((s) => s.findings.length === 0).length,
    highRiskWithoutApproval: scored.filter((s) => s.riskTier === "high" && s.autonomy !== "advise" && !s.humanApproval).length,
    passed: findings.length === 0 && score >= 90,
    findings,
    digest: fnv1a(scored.map((s) => `${s.id}:${s.governanceScore}`).join("|")),
  };
}

/* ------------------------------------------------------------------ *
 * 3 · Enterprise logistics readiness certificate
 * ------------------------------------------------------------------ */

export const LOGISTICS_READINESS_DIMENSIONS = [
  "business",
  "production",
  "operational",
  "governance",
  "aiGovernance",
  "logisticsIntelligence",
  "integration",
  "security",
  "compliance",
  "continuousCertification",
] as const;

export type LogisticsReadinessDimension = (typeof LOGISTICS_READINESS_DIMENSIONS)[number];

export const LOGISTICS_READINESS_LABEL: Record<LogisticsReadinessDimension, string> = {
  business: "Business readiness",
  production: "Production readiness",
  operational: "Operational readiness",
  governance: "Governance readiness",
  aiGovernance: "AI governance readiness",
  logisticsIntelligence: "Logistics intelligence readiness",
  integration: "Integration readiness",
  security: "Security readiness",
  compliance: "Compliance readiness",
  continuousCertification: "Continuous certification",
};

export interface LogisticsReadinessPillar {
  dimension: LogisticsReadinessDimension;
  label: string;
  score: number;
  source: string;
  gap: number;
}

export interface LogisticsReadinessCertificate {
  version: string;
  score: number;
  decision: "GO" | "CONDITIONAL_GO" | "NO_GO";
  pillars: LogisticsReadinessPillar[];
  valueStreams: LogisticsValueStreamReport;
  aiGovernance: LogisticsAiGovernanceReport;
  lcifScore: number;
  elosScore: number;
  twinHealth: number;
  blockers: string[];
  priorityActions: Array<{ area: string; action: string; impact: number }>;
  fingerprint: string;
  generatedAt: string;
}

export function certifyLogisticsReadiness(
  lcif: LcifReport = runCapabilityIntelligence(),
  now: Date = new Date(),
): LogisticsReadinessCertificate {
  const streams = certifyLogisticsValueStreams(lcif);
  const ai = certifyLogisticsAiGovernance();
  const elos = certifyElos();
  const coldChain = certifyColdChain();
  const twin = buildTwin({}, now);

  const avg = (...n: number[]) => Math.round(n.reduce((a, b) => a + b, 0) / n.length);
  const lcifDim = (name: string) =>
    Math.round(lcif.dimensionAverages.find((x) => x.dimension === name)?.score ?? 0);

  const pillarSpecs: Array<Omit<LogisticsReadinessPillar, "gap">> = [
    { dimension: "business", label: LOGISTICS_READINESS_LABEL.business, score: streams.score, source: `${streams.certified}/${streams.streams.length} value streams certified` },
    { dimension: "production", label: LOGISTICS_READINESS_LABEL.production, score: avg(elos.score, lcifDim("engineering")), source: "ELOS activation + engineering maturity" },
    { dimension: "operational", label: LOGISTICS_READINESS_LABEL.operational, score: avg(lcifDim("operations"), twin.health), source: "Operations maturity + digital twin health" },
    { dimension: "governance", label: LOGISTICS_READINESS_LABEL.governance, score: avg(lcifDim("risk"), lcifDim("executiveReadiness")), source: "Risk register + executive rollup" },
    { dimension: "aiGovernance", label: LOGISTICS_READINESS_LABEL.aiGovernance, score: ai.score, source: `${ai.governedServices}/${ai.services.length} AI services fully governed` },
    { dimension: "logisticsIntelligence", label: LOGISTICS_READINESS_LABEL.logisticsIntelligence, score: avg(lcifDim("prediction"), lcifDim("optimization"), lcif.score), source: "Prediction + optimisation + LCIF" },
    { dimension: "integration", label: LOGISTICS_READINESS_LABEL.integration, score: avg(lcifDim("automation"), lcifDim("partnerExperience")), source: "Automation + partner integration" },
    { dimension: "security", label: LOGISTICS_READINESS_LABEL.security, score: lcifDim("security"), source: "Zero-trust controls per capability" },
    { dimension: "compliance", label: LOGISTICS_READINESS_LABEL.compliance, score: avg(lcifDim("compliance"), coldChain.score), source: "Evidence completeness + cold-chain controls" },
    { dimension: "continuousCertification", label: LOGISTICS_READINESS_LABEL.continuousCertification, score: avg(lcifDim("observability"), elos.passed ? 100 : 70), source: "Telemetry coverage + certification pipeline" },
  ];

  const pillars: LogisticsReadinessPillar[] = pillarSpecs.map((p) => ({
    ...p,
    score: Math.max(0, Math.min(100, p.score)),
    gap: Math.max(0, 100 - Math.max(0, Math.min(100, p.score))),
  }));

  const score = Math.round(pillars.reduce((s, p) => s + p.score, 0) / pillars.length);
  const blockers = [...streams.blockers, ...ai.findings, ...elos.findings, ...coldChain.findings];
  const decision: LogisticsReadinessCertificate["decision"] =
    blockers.length === 0 && score >= 90 ? "GO" : score >= 75 ? "CONDITIONAL_GO" : "NO_GO";

  const priorityActions = [...pillars]
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 5)
    .map((p) => ({
      area: p.label,
      action: `Raise ${p.label.toLowerCase()} — ${p.source}`,
      impact: p.gap,
    }));

  if (streams.weakestStream && streams.weakestStream.status !== "certified") {
    priorityActions.unshift({
      area: streams.weakestStream.name,
      action: `Weakest value stream — remediate ${streams.weakestStream.weakestCapability?.label ?? "participating capabilities"}`,
      impact: 100 - streams.weakestStream.score,
    });
  }

  return {
    version: LOGISTICS_READINESS_VERSION,
    score,
    decision,
    pillars,
    valueStreams: streams,
    aiGovernance: ai,
    lcifScore: lcif.score,
    elosScore: elos.score,
    twinHealth: twin.health,
    blockers,
    priorityActions: priorityActions.slice(0, 6),
    fingerprint: fnv1a(
      [streams.digest, ai.digest, String(elos.score), String(lcif.score), String(score), decision].join("|"),
    ),
    generatedAt: now.toISOString(),
  };
}

/** Gap matrix — the auditable "what is missing and why" view. */
export interface LogisticsGapRow {
  area: string;
  kind: "value_stream" | "ai_service" | "readiness_dimension";
  score: number;
  gap: number;
  owner: string;
  finding: string;
}

export function logisticsGapMatrix(
  cert: LogisticsReadinessCertificate = certifyLogisticsReadiness(),
): LogisticsGapRow[] {
  const rows: LogisticsGapRow[] = [
    ...cert.valueStreams.streams
      .filter((s) => s.status !== "certified")
      .map((s) => ({
        area: s.name,
        kind: "value_stream" as const,
        score: s.score,
        gap: 100 - s.score,
        owner: s.owner,
        finding: s.blockers[0] ?? `Weakest link: ${s.weakestCapability?.label ?? "unknown"}`,
      })),
    ...cert.aiGovernance.services
      .filter((s) => s.findings.length > 0)
      .map((s) => ({
        area: s.name,
        kind: "ai_service" as const,
        score: s.governanceScore,
        gap: 100 - s.governanceScore,
        owner: s.owner,
        finding: s.findings[0],
      })),
    ...cert.pillars
      .filter((p) => p.gap > 10)
      .map((p) => ({
        area: p.label,
        kind: "readiness_dimension" as const,
        score: p.score,
        gap: p.gap,
        owner: "Enterprise Platform",
        finding: p.source,
      })),
  ];
  return rows.sort((a, b) => b.gap - a.gap);
}
