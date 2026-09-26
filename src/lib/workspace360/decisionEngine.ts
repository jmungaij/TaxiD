/**
 * Phase D10.0 — Enterprise Decision Engine.
 * Phase D10.1 — Autonomous Governance & Closed-Loop Decision Execution.
 *
 * Pure-function layer that transforms certified canonical data into
 * prioritized, explainable, deduplicated, cross-domain-aware,
 * closed-loop operational recommendations.
 *
 * Every recommendation is:
 *   • uniquely traceable via a stable content hash (dedupKey)
 *   • linked to canonical certifiers / KPIs / alerts / ops signals
 *   • tagged with expected impact + affected domains
 *   • wired to an execution status ledger (Pending → Completed/etc.)
 *   • auto-verified against before/after canonical measurements
 *
 * The engine remains deterministic: same input → same output, same order.
 */
import type { Workspace360GovernanceReport } from "./governance";
import { workspace360BasePath, WORKSPACE360_DOMAINS, type Workspace360Domain } from "./domains";

export type RecoPriority = "P0" | "P1" | "P2" | "P3";
export type RecoImpactAxis =
  | "revenue"
  | "customer"
  | "operations"
  | "driver_utilization"
  | "fleet_utilization"
  | "corporate_sla"
  | "risk"
  | "platform_health"
  | "certification";

/** D10.1 — closed-loop execution status. */
export type RecoExecutionStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "deferred"
  | "rejected"
  | "expired";

export type RecoImpactMagnitude = "low" | "medium" | "high" | "critical";

export interface RecoExpectedImpact {
  axis: RecoImpactAxis;
  magnitude: RecoImpactMagnitude;
  /** target delta in the canonical KPI/score expected after completion. */
  targetDelta: number;
}

export interface RecoExecutionRecord {
  status: RecoExecutionStatus;
  updatedAt?: string;
  actor?: string;
  note?: string;
  /** Snapshot of the canonical metric that motivated the reco (before). */
  baseline?: number | null;
  /** Snapshot after completion (used by verification). */
  observed?: number | null;
}

export interface Recommendation {
  id: string;                        // stable, derived from inputs — reproducible
  version: number;                   // reco schema version (bump on breaking output change)
  dedupKey: string;                  // domain|axis|rootCause — used to merge duplicates
  priority: RecoPriority;
  impactAxes: RecoImpactAxis[];
  expectedImpact: RecoExpectedImpact;
  affectedDomains: (Workspace360Domain | "platform" | "finance" | "security")[];
  domain: Workspace360Domain | "platform" | "finance" | "security";
  title: string;
  rationale: string;                 // one-line explanation, references canonical source
  confidence: number;                // 0..1, derived from evidence strength
  canonicalSources: string[];        // list of source identifiers (must be non-empty)
  href: string;                      // deep-link into responsible Workspace360 module
  score: number;                     // derived ranking score, higher = more urgent
  execution: RecoExecutionRecord;    // D10.1 lifecycle state
  generatedAt: string;               // deterministic if input.now is provided
  mergedFrom?: string[];             // ids of recos merged into this one
  ineffective?: boolean;             // D10.1 — completion did not achieve expected impact
}

export const RECO_VERSION = 2;

export interface DecisionEngineInputs {
  governance: Workspace360GovernanceReport;
  metrics: ReadonlyArray<{
    metric_key: string; label: string; category: string;
    value_numeric: number | null; unit: string | null; trend_pct: number | null;
  }>;
  alerts: ReadonlyArray<{
    id: string; severity: string; category: string; title: string; body: string | null;
  }>;
  opsSignals: Record<string, number | null>;
  /** D10.1 — optional per-recommendation execution state (from audit_logs). */
  executionLedger?: Record<string, RecoExecutionRecord>;
  /** D10.1 — historical actual-vs-expected outcomes; deterministic confidence calibration. */
  learningHistory?: ReadonlyArray<{
    dedupKey: string;
    expectedDelta: number;
    actualDelta: number;
  }>;
  /** Deterministic clock (defaults to fixed epoch when omitted). */
  now?: string;
  /** Governance report version — captured in audit trail. */
  governanceVersion?: string;
}

export interface DecisionEngineReport {
  recommendations: Recommendation[];
  generatedFrom: string[];           // canonical sources referenced (deduped)
  passed: boolean;                   // traceable + no duplicates
  failures: string[];
  /** D10.1 — closed-loop / readiness metrics derived from executionLedger. */
  execution: {
    total: number;
    completed: number;
    inProgress: number;
    pending: number;
    ineffective: number;
    completionRate: number;          // completed / total
    successRate: number;             // (completed - ineffective) / completed
    avgResolutionMs: number | null;  // avg completedAt − generatedAt
    p0Unresolved: number;
    governanceImprovementScore: number; // 0-100 rollup
  };
  /** D10.1 — recommendation quality certification (fed into governance). */
  quality: RecommendationQualityCertification;
  duplicatesMerged: number;
  governanceVersion?: string;
}

const PRIORITY_WEIGHT: Record<RecoPriority, number> = { P0: 1000, P1: 500, P2: 200, P3: 50 };
const DEFAULT_NOW = "1970-01-01T00:00:00.000Z";

function priorityFrom(score: number): RecoPriority {
  if (score >= 900) return "P0";
  if (score >= 500) return "P1";
  if (score >= 200) return "P2";
  return "P3";
}

function domainHref(domain: Recommendation["domain"], fallback = "/dashboard/admin/ops-center"): string {
  if (domain === "platform") return "/dashboard/admin/ops-center";
  if (domain === "finance")  return "/dashboard/admin/payment-ops";
  if (domain === "security") return "/dashboard/admin/security-audit";
  try { return workspace360BasePath(domain); } catch { return fallback; }
}

/**
 * Cheap deterministic fingerprint (djb2). Not cryptographic — only used
 * for stable dedup keys and IDs derived from human-readable inputs.
 */
function fingerprint(...parts: (string | number)[]): string {
  let h = 5381;
  const s = parts.join("|");
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** Cross-domain impact map — deterministic, canonical. */
const CROSS_DOMAIN_IMPACT: Record<string, ReadonlyArray<Workspace360Domain>> = {
  finance:   ["driver", "rider", "corporate", "fleet", "courier", "logistics", "rental"],
  platform:  ["driver", "rider", "corporate", "fleet", "courier", "package", "logistics", "rental"],
  security:  ["rider", "corporate", "driver"],
  driver:    ["fleet", "corporate"],
  rider:     ["corporate"],
  corporate: ["rider", "driver"],
  courier:   ["logistics", "package"],
  package:   ["courier", "logistics"],
  logistics: ["courier", "package", "fleet"],
  fleet:     ["driver", "logistics"],
  rental:    ["fleet"],
};

function computeAffectedDomains(
  primary: Recommendation["domain"],
  axes: RecoImpactAxis[],
): Recommendation["affectedDomains"] {
  const set = new Set<Recommendation["affectedDomains"][number]>([primary]);
  for (const d of CROSS_DOMAIN_IMPACT[primary] ?? []) set.add(d);
  // Axis-driven amplifiers.
  if (axes.includes("revenue") || axes.includes("corporate_sla")) set.add("finance");
  if (axes.includes("risk")) set.add("security");
  if (axes.includes("platform_health") || axes.includes("certification")) set.add("platform");
  return Array.from(set).sort() as Recommendation["affectedDomains"];
}

function magnitudeFromScore(score: number): RecoImpactMagnitude {
  if (score >= 900) return "critical";
  if (score >= 500) return "high";
  if (score >= 200) return "medium";
  return "low";
}

interface RawReco {
  rootCause: string;                 // stable slug used for dedup
  baseScore: number;
  impactAxes: RecoImpactAxis[];
  primaryAxis: RecoImpactAxis;
  targetDelta: number;
  domain: Recommendation["domain"];
  title: string;
  rationale: string;
  confidence: number;
  canonicalSources: string[];
  href: string;
}

export function buildRecommendations(input: DecisionEngineInputs): DecisionEngineReport {
  const raw: RawReco[] = [];
  const gov = input.governance;
  const now = input.now ?? DEFAULT_NOW;

  const push = (r: RawReco) => raw.push(r);

  // 1) Governance / certification driven -----------------------------------
  if (!gov.passed) {
    push({
      rootCause: "governance:readiness",
      baseScore: 950 + (100 - gov.score),
      impactAxes: ["certification", "platform_health"],
      primaryAxis: "certification",
      targetDelta: Math.max(1, 100 - gov.score),
      domain: "platform",
      title: `Restore Production Readiness (${gov.score}/100)`,
      rationale: `Governance certifier failing: ${gov.failures.slice(0, 2).join("; ") || "see report"}.`,
      confidence: 1,
      canonicalSources: ["certifyWorkspace360Governance"],
      href: "/dashboard/admin/ops-center",
    });
  }
  if (gov.consistency && !gov.consistency.passed) {
    push({
      rootCause: "finance:consistency",
      baseScore: 850 + (100 - gov.consistency.score),
      impactAxes: ["revenue", "certification"],
      primaryAxis: "revenue",
      targetDelta: 100 - gov.consistency.score,
      domain: "finance",
      title: "Reconcile canonical financial chain",
      rationale: `Business consistency ${gov.consistency.score}/100 — wallet/ledger/journal drift detected.`,
      confidence: 0.95,
      canonicalSources: ["certifyBusinessConsistency"],
      href: "/dashboard/admin/payment-certification",
    });
  }
  if (gov.workflows && !gov.workflows.passed) {
    push({
      rootCause: "workflows:cross-domain",
      baseScore: 700 + (100 - gov.workflows.score),
      impactAxes: ["operations", "customer", "certification"],
      primaryAxis: "operations",
      targetDelta: 100 - gov.workflows.score,
      domain: "platform",
      title: "Repair failing cross-domain workflows",
      rationale: `Workflow certification ${gov.workflows.score}/100 — deterministic rider→trip→driver→ledger chain broken.`,
      confidence: 0.9,
      canonicalSources: ["certifyCrossDomainWorkflows"],
      href: "/dashboard/admin/ops-center",
    });
  }

  for (const d of gov.domains) {
    if (d.adopted && d.duplicatedFinancialTables.length > 0) {
      push({
        rootCause: `duplicate-finance:${d.domain}`,
        baseScore: 900,
        impactAxes: ["revenue", "certification"],
        primaryAxis: "revenue",
        targetDelta: d.duplicatedFinancialTables.length * 10,
        domain: d.domain,
        title: `Retire duplicated financial tables in ${d.domain} domain`,
        rationale: `Domain forked ${d.duplicatedFinancialTables.join(", ")} — must reuse canonical ledger.`,
        confidence: 1,
        canonicalSources: ["certifyWorkspace360Governance.domains"],
        href: domainHref(d.domain),
      });
    }
    if (d.adopted && d.workflowScore < 100) {
      push({
        rootCause: `workflow:${d.domain}`,
        baseScore: 400 + (100 - d.workflowScore) * 3,
        impactAxes: ["operations", "customer"],
        primaryAxis: "operations",
        targetDelta: 100 - d.workflowScore,
        domain: d.domain,
        title: `Fix workflow regressions in ${d.domain} 360`,
        rationale: `Workflow score ${d.workflowScore}/100 for ${d.domain}.`,
        confidence: 0.85,
        canonicalSources: ["certifyCrossDomainWorkflows"],
        href: domainHref(d.domain),
      });
    }
    if (!d.adopted) {
      push({
        rootCause: `adopt:${d.domain}`,
        baseScore: 250,
        impactAxes: ["platform_health", "certification"],
        primaryAxis: "platform_health",
        targetDelta: 100,
        domain: d.domain,
        title: `Adopt Workspace360 for ${d.domain}`,
        rationale: `${d.domain} not yet on the shared shell — governance ratchet blocks release.`,
        confidence: 0.7,
        canonicalSources: ["certifyWorkspace360Health"],
        href: domainHref(d.domain),
      });
    }
  }

  // 2) Operational signal driven -------------------------------------------
  const sig = input.opsSignals;
  const signalReco = (
    key: string, domain: Recommendation["domain"], axes: RecoImpactAxis[],
    primaryAxis: RecoImpactAxis, hrefKey: string, baseWeight: number,
  ) => {
    const v = sig[key];
    if (v == null || v <= 0) return;
    const score = baseWeight + Math.min(500, v * 5);
    push({
      rootCause: `ops:${key}`,
      baseScore: score,
      impactAxes: axes, primaryAxis,
      targetDelta: v,
      domain,
      title: `${key}: ${v.toLocaleString()} pending — investigate`,
      rationale: `Operations Center signal '${key}' = ${v} (threshold breached).`,
      confidence: Math.min(1, 0.5 + v / 200),
      canonicalSources: ["OperationsCenter.signals"],
      href: hrefKey,
    });
  };
  signalReco("Outbox DLQ",             "platform", ["platform_health"],               "platform_health", "/dashboard/admin/outbox-dlq",                 600);
  signalReco("Alert DLQ",              "platform", ["platform_health", "risk"],       "platform_health", "/dashboard/admin/alerts",                     550);
  signalReco("Payment DLQ",            "finance",  ["revenue", "platform_health"],    "revenue",         "/dashboard/admin/payment-dlq",                800);
  signalReco("Open circuit breakers",  "finance",  ["revenue"],                       "revenue",         "/dashboard/admin/payment-ops",                850);
  signalReco("Edge failures (24h)",    "platform", ["platform_health"],               "platform_health", "/dashboard/admin/observability",              300);
  signalReco("Open reconciliations",   "finance",  ["revenue", "corporate_sla"],      "revenue",         "/dashboard/admin/reconciliation-mismatches",  700);
  signalReco("Settlement failures",    "finance",  ["revenue", "driver_utilization"], "revenue",         "/dashboard/admin/payment-ops",                800);
  signalReco("Active wallet freezes",  "finance",  ["revenue", "risk"],               "revenue",         "/dashboard/admin/fraud-cases",                500);
  signalReco("Chargebacks",            "finance",  ["revenue", "risk"],               "revenue",         "/dashboard/admin/payment-ops",                750);
  signalReco("Open fraud cases",       "security", ["risk", "revenue"],               "risk",            "/dashboard/admin/fraud-cases",                650);
  signalReco("Forbidden updates (24h)","security", ["risk", "certification"],         "risk",            "/dashboard/admin/audit-log",                  900);

  // 3) Executive alerts ----------------------------------------------------
  for (const a of input.alerts) {
    const sev = a.severity.toLowerCase();
    const base = sev === "critical" ? 950 : sev === "high" ? 700 : sev === "medium" ? 400 : 200;
    const axes = alertAxes(a.category);
    push({
      rootCause: `alert:${a.category}:${a.id}`,
      baseScore: base,
      impactAxes: axes,
      primaryAxis: axes[0],
      targetDelta: sev === "critical" ? 100 : 50,
      domain: alertDomain(a.category),
      title: a.title,
      rationale: a.body ? a.body.slice(0, 160) : `Executive alert (${a.category}) requires acknowledgement.`,
      confidence: sev === "critical" ? 1 : 0.8,
      canonicalSources: ["executive_alerts"],
      href: alertHref(a.category),
    });
  }

  // 4) KPI trend driven ----------------------------------------------------
  for (const m of input.metrics) {
    const trend = m.trend_pct == null ? null : Number(m.trend_pct);
    if (trend == null) continue;
    if (m.category === "revenue" && trend <= -5) {
      push({
        rootCause: `kpi:revenue:${m.metric_key}`,
        baseScore: 500 + Math.min(300, Math.abs(trend) * 10),
        impactAxes: ["revenue"], primaryAxis: "revenue",
        targetDelta: Math.abs(trend),
        domain: "finance",
        title: `Revenue KPI '${m.label}' down ${Math.abs(trend).toFixed(1)}%`,
        rationale: `Canonical executive_metrics.${m.metric_key} trending ${trend.toFixed(1)}% vs prior period.`,
        confidence: Math.min(1, 0.5 + Math.abs(trend) / 50),
        canonicalSources: ["executive_metrics"],
        href: "/dashboard/admin/payment-ops",
      });
    }
    if (m.category === "operations" && trend <= -10) {
      push({
        rootCause: `kpi:ops:${m.metric_key}`,
        baseScore: 400 + Math.min(300, Math.abs(trend) * 5),
        impactAxes: ["operations", "driver_utilization"], primaryAxis: "operations",
        targetDelta: Math.abs(trend),
        domain: "platform",
        title: `Operational KPI '${m.label}' degrading (${trend.toFixed(1)}%)`,
        rationale: `executive_metrics.${m.metric_key} trending ${trend.toFixed(1)}%.`,
        confidence: 0.7,
        canonicalSources: ["executive_metrics"],
        href: "/dashboard/admin/ops-center",
      });
    }
    if (m.category === "risk" && trend >= 20) {
      push({
        rootCause: `kpi:risk:${m.metric_key}`,
        baseScore: 650 + Math.min(300, trend * 5),
        impactAxes: ["risk"], primaryAxis: "risk",
        targetDelta: trend,
        domain: "security",
        title: `Risk KPI '${m.label}' rising +${trend.toFixed(1)}%`,
        rationale: `executive_metrics.${m.metric_key} trending +${trend.toFixed(1)}%.`,
        confidence: 0.85,
        canonicalSources: ["executive_metrics"],
        href: "/dashboard/admin/fraud-center",
      });
    }
  }

  // ---- D10.1 dedup: group by (domain|primaryAxis|rootCause), keep max score.
  const byKey = new Map<string, { r: RawReco; ids: string[] }>();
  let duplicatesMerged = 0;
  for (const r of raw) {
    const dedupKey = `${r.domain}|${r.primaryAxis}|${r.rootCause}`;
    const id = `reco-${fingerprint(dedupKey, r.title)}`;
    const prior = byKey.get(dedupKey);
    if (!prior) {
      byKey.set(dedupKey, { r, ids: [id] });
    } else {
      duplicatesMerged++;
      prior.ids.push(id);
      if (r.baseScore > prior.r.baseScore) prior.r = r;
    }
  }

  // Calibrate confidence using deterministic learning history.
  const learningIndex = new Map<string, { expected: number; actual: number; n: number }>();
  for (const h of input.learningHistory ?? []) {
    const cur = learningIndex.get(h.dedupKey) ?? { expected: 0, actual: 0, n: 0 };
    cur.expected += h.expectedDelta;
    cur.actual += h.actualDelta;
    cur.n += 1;
    learningIndex.set(h.dedupKey, cur);
  }
  const calibrate = (dedupKey: string, base: number): number => {
    const l = learningIndex.get(dedupKey);
    if (!l || l.n === 0 || l.expected === 0) return base;
    const ratio = Math.max(0, Math.min(2, l.actual / l.expected));
    // ratio 1 → unchanged; 0 → halve; 2 → +25% (capped)
    const adj = ratio < 1 ? base * (0.5 + 0.5 * ratio) : Math.min(1, base * (1 + (ratio - 1) * 0.25));
    return Math.max(0, Math.min(1, adj));
  };

  // Materialize final Recommendation objects.
  const recos: Recommendation[] = [];
  for (const { r, ids } of byKey.values()) {
    const dedupKey = `${r.domain}|${r.primaryAxis}|${r.rootCause}`;
    const canonicalId = `reco-${fingerprint(dedupKey, r.title)}`;
    const score = Math.round(r.baseScore);
    const priority = priorityFrom(score);
    const affectedDomains = computeAffectedDomains(r.domain, r.impactAxes);
    const confidence = calibrate(dedupKey, r.confidence);
    const ledger = input.executionLedger?.[canonicalId];
    const execution: RecoExecutionRecord = ledger ?? { status: "pending" };
    const ineffective =
      execution.status === "completed" &&
      typeof execution.baseline === "number" &&
      typeof execution.observed === "number" &&
      Math.abs(execution.observed - execution.baseline) < r.targetDelta * 0.25;

    recos.push({
      id: canonicalId,
      version: RECO_VERSION,
      dedupKey,
      priority,
      score,
      impactAxes: r.impactAxes,
      expectedImpact: {
        axis: r.primaryAxis,
        magnitude: magnitudeFromScore(score),
        targetDelta: r.targetDelta,
      },
      affectedDomains,
      domain: r.domain,
      title: r.title,
      rationale: r.rationale,
      confidence,
      canonicalSources: r.canonicalSources,
      href: r.href,
      execution,
      generatedAt: now,
      mergedFrom: ids.length > 1 ? ids.filter((x) => x !== canonicalId) : undefined,
      ineffective: ineffective || undefined,
    });
  }

  // Deterministic ordering.
  recos.sort((a, b) =>
    b.score - a.score ||
    (PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority]) ||
    a.id.localeCompare(b.id));

  // ---- Traceability audit
  const failures: string[] = [];
  for (const r of recos) {
    if (r.canonicalSources.length === 0) failures.push(`${r.id}: missing canonical source`);
    if (r.confidence < 0 || r.confidence > 1) failures.push(`${r.id}: confidence out of range`);
    if (!r.href) failures.push(`${r.id}: missing deep link`);
    if (!r.href.startsWith("/dashboard/")) failures.push(`${r.id}: invalid route ${r.href}`);
    if (!r.affectedDomains.length) failures.push(`${r.id}: missing affected domains`);
    // Guard: any workspace360 domain reference must be canonical.
    for (const d of r.affectedDomains) {
      if (
        d !== "platform" && d !== "finance" && d !== "security" &&
        !(WORKSPACE360_DOMAINS as ReadonlyArray<string>).includes(d)
      ) {
        failures.push(`${r.id}: invalid affected domain ${d}`);
      }
    }
  }
  const generatedFrom = Array.from(new Set(recos.flatMap((r) => r.canonicalSources))).sort();

  // ---- Execution rollup (closed-loop readiness)
  const total = recos.length;
  const completed = recos.filter((r) => r.execution.status === "completed").length;
  const inProgress = recos.filter((r) => r.execution.status === "in_progress").length;
  const pending = recos.filter((r) => r.execution.status === "pending").length;
  const ineffective = recos.filter((r) => r.ineffective).length;
  const p0Unresolved = recos.filter(
    (r) => r.priority === "P0" &&
      r.execution.status !== "completed" && r.execution.status !== "rejected"
  ).length;
  let resSum = 0, resN = 0;
  for (const r of recos) {
    if (r.execution.status === "completed" && r.execution.updatedAt) {
      const dt = Date.parse(r.execution.updatedAt) - Date.parse(r.generatedAt);
      if (Number.isFinite(dt) && dt >= 0) { resSum += dt; resN++; }
    }
  }
  const completionRate = total === 0 ? 1 : completed / total;
  const successRate = completed === 0 ? 1 : (completed - ineffective) / completed;
  const governanceImprovementScore = Math.round(
    (completionRate * 0.5 + successRate * 0.5) * 100
  );

  const quality = certifyRecommendationQuality({
    recommendations: recos,
    duplicatesMerged,
    failures,
    total,
    ineffective,
  });

  return {
    recommendations: recos,
    generatedFrom,
    passed: failures.length === 0 && duplicatesMerged >= 0,
    failures,
    duplicatesMerged,
    governanceVersion: input.governanceVersion,
    execution: {
      total, completed, inProgress, pending, ineffective,
      completionRate, successRate,
      avgResolutionMs: resN === 0 ? null : Math.round(resSum / resN),
      p0Unresolved,
      governanceImprovementScore,
    },
    quality,
  };
}

function alertAxes(cat: string): RecoImpactAxis[] {
  switch (cat.toLowerCase()) {
    case "revenue":       return ["revenue"];
    case "operations":    return ["operations"];
    case "risk":          return ["risk"];
    case "satisfaction":  return ["customer"];
    case "system":        return ["platform_health"];
    default:              return ["operations"];
  }
}
function alertDomain(cat: string): Recommendation["domain"] {
  switch (cat.toLowerCase()) {
    case "revenue": return "finance";
    case "risk":    return "security";
    default:        return "platform";
  }
}
function alertHref(cat: string): string {
  switch (cat.toLowerCase()) {
    case "revenue": return "/dashboard/admin/payment-ops";
    case "risk":    return "/dashboard/admin/fraud-center";
    default:        return "/dashboard/admin/ops-center";
  }
}

// ============================================================================
// D10.1 — Recommendation Quality Certification (fed into Governance Report)
// ============================================================================

export interface RecommendationQualityCertification {
  passed: boolean;
  score: number;
  totalRecos: number;
  failures: string[];
  metrics: {
    traceability: number;   // 0-100
    determinism: number;    // 0-100 (structural — enforced by dedup + stable ids)
    calibration: number;    // 0-100 (confidence in [0,1] & consistent)
    dedup: number;          // 0-100 (100 = no duplicates left after merge)
    business_impact: number;// 0-100 (share of P0/P1 with defined expected impact)
    stale: number;          // 0-100 (100 - % ineffective)
  };
}

export function certifyRecommendationQuality(args: {
  recommendations: Recommendation[];
  duplicatesMerged: number;
  failures: string[];
  total: number;
  ineffective: number;
}): RecommendationQualityCertification {
  const { recommendations: recos, duplicatesMerged, failures, total, ineffective } = args;
  const failList: string[] = [];

  const traceability = total === 0 ? 100 : Math.max(0, Math.round(((total - failures.length) / total) * 100));
  if (traceability < 100) failList.push(`traceability ${traceability}/100`);

  // Structural determinism: every reco must expose a stable id, dedupKey, version.
  const structural = recos.every((r) => r.id && r.dedupKey && r.version === RECO_VERSION);
  const determinism = structural ? 100 : 0;
  if (!structural) failList.push("non-deterministic reco shape");

  // Calibration: confidence within [0,1].
  const badConf = recos.filter((r) => !(r.confidence >= 0 && r.confidence <= 1)).length;
  const calibration = total === 0 ? 100 : Math.max(0, Math.round(((total - badConf) / total) * 100));
  if (badConf > 0) failList.push(`${badConf} recos with invalid confidence`);

  // Dedup: any remaining duplicates by dedupKey are a hard failure.
  const seen = new Set<string>();
  let dupLeft = 0;
  for (const r of recos) {
    if (seen.has(r.dedupKey)) dupLeft++;
    seen.add(r.dedupKey);
  }
  const dedup = dupLeft === 0 ? 100 : 0;
  if (dupLeft > 0) failList.push(`${dupLeft} duplicate reco(s) survived merge`);

  // Business impact: P0/P1 must have a targetDelta > 0.
  const p01 = recos.filter((r) => r.priority === "P0" || r.priority === "P1");
  const withImpact = p01.filter((r) => (r.expectedImpact?.targetDelta ?? 0) > 0).length;
  const business_impact = p01.length === 0 ? 100 : Math.round((withImpact / p01.length) * 100);
  if (business_impact < 100) failList.push(`${p01.length - withImpact} P0/P1 without expected impact`);

  // Stale: proportion of ineffective completions.
  const stale = total === 0 ? 100 : Math.max(0, Math.round(((total - ineffective) / total) * 100));

  const score = Math.round(
    (traceability + determinism + calibration + dedup + business_impact + stale) / 6
  );
  const passed = failList.length === 0 && duplicatesMerged >= 0;
  return {
    passed, score, totalRecos: total, failures: failList,
    metrics: { traceability, determinism, calibration, dedup, business_impact, stale },
  };
}

// ============================================================================
// D10.1 — Closed-loop verification helper (pure function)
// ============================================================================

export interface VerificationInput {
  reco: Recommendation;
  baseline: number;
  observed: number;
}
export interface VerificationOutcome {
  status: "improved" | "unchanged" | "regressed";
  achievedDelta: number;
  expectedDelta: number;
  effective: boolean;
  adjustedConfidence: number;
}

/**
 * Verify closed-loop effectiveness after a recommendation is completed.
 * Deterministic. Reduces confidence when actual < expected.
 */
export function verifyRecommendationOutcome(v: VerificationInput): VerificationOutcome {
  const expectedDelta = Math.max(0, v.reco.expectedImpact.targetDelta);
  const achievedDelta = v.observed - v.baseline;
  const ratio = expectedDelta === 0 ? 1 : achievedDelta / expectedDelta;
  const effective = ratio >= 0.75;
  const status: VerificationOutcome["status"] =
    achievedDelta > 0 ? "improved" : achievedDelta < 0 ? "regressed" : "unchanged";
  let adjustedConfidence = v.reco.confidence;
  if (!effective) adjustedConfidence = Math.max(0, adjustedConfidence * 0.7);
  return { status, achievedDelta, expectedDelta, effective, adjustedConfidence };
}

// ============================================================================
// Legacy certifier — retained for existing tests / dashboards.
// ============================================================================

export interface DecisionEngineCertification {
  passed: boolean;
  score: number;
  totalRecos: number;
  failures: string[];
}
export function certifyDecisionEngine(report: {
  recommendations: unknown[]; passed: boolean; failures: string[];
}): DecisionEngineCertification {
  const total = report.recommendations.length;
  const bad = report.failures.length;
  const score = total === 0 ? 100 : Math.max(0, Math.round(((total - bad) / total) * 100));
  return { passed: report.passed, score, totalRecos: total, failures: report.failures };
}

/* ------------------------------------------------------------------ */
/* Lean P1 — Release Blocker Prioritizer (re-export)                   */
/*                                                                     */
/* Ranking lives in blockerInventory.ts so it can consume closure /    */
/* acceptance / execution / validation reports without pulling their   */
/* types into the decision engine's own signature. The engine simply   */
/* re-exports the ranker so callers can access it through the          */
/* existing @/lib/workspace360/decisionEngine module.                  */
/* ------------------------------------------------------------------ */
export { rankBlockers, composeBlockerInventory } from "./blockerInventory";
export type {
  Blocker,
  BlockerCategory,
  BlockerEffort,
  BlockerSeverity,
  BlockerInventory,
  BlockerInventoryInputs,
} from "./blockerInventory";
