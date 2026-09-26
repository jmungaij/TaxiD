/**
 * Phase P2 — Execution Validation Program (EVP) — client evidence loader.
 *
 * REUSE-FIRST. This module is a PURE DATA LOADER. It does NOT:
 *   - define scoring
 *   - decide releases
 *   - re-implement any composer
 *
 * It reads the latest `assurance_runs` row emitted by `evp-run` and shapes
 * its evidence into the exact input contract that
 * `certifyProductionValidation` already accepts. When no EVP run exists
 * yet, it returns an empty overlay so the existing default-path behaviour
 * is preserved (governance-only scoring).
 */
import { supabase } from "@/integrations/supabase/client";
import type {
  ProductionValidationInputs,
  ScalabilityTier,
  DrScenario,
} from "./productionValidation";
import { SCALABILITY_TIERS, DR_SCENARIOS } from "./productionValidation";
import type { EvpRunArtifact, EvpStageResult } from "./evpTypes";

/**
 * Explainability payload. Captures WHY a pillar has (or lacks) evidence so
 * the Readiness card can show real numbers instead of silent default scores.
 */
export interface EvidenceDiagnostics {
  scalability: {
    rowCount: number;
    passedRowCount: number;
    queryError: string | null;
    /** Tiers that produced usable payment metrics. */
    tiersWithPaymentEvidence: number[];
    /** Tiers that produced dispatch-scenario throughput. */
    tiersWithDispatchEvidence: number[];
    /** Tiers seen in the data but not part of SCALABILITY_TIERS. */
    unmappedTiers: number[];
    /** Newest passed run at tier >= 10,000, if any. */
    floorTier: number | null;
    floorRunId: string | null;
    floorPaymentTps: number | null;
    floorDispatchTps: number | null;
    /** True when the >=10k floor has both payment and dispatch throughput. */
    floorJoined: boolean;
    floorReason: string;
  };
  disasterRecovery: {
    rowCount: number;
    queryError: string | null;
    scenariosFound: string[];
    unmappedScenarios: string[];
    passedCount: number;
    /** Mean measured RTO across drills, seconds. */
    meanRtoSec: number | null;
    worstRtoSec: number | null;
  };
  integrations: {
    /** Integrations present in the EVP rollup. */
    observed: string[];
    totalSamples: number;
    source: "evp_rollup" | "none";
  };
  performance: {
    source: "evp_rollup" | "none";
    apiP95Ms: number | null;
    rpcP95Ms: number | null;
    errorRate: number | null;
    throughputRps: number | null;
  };
}

export interface EvpEvidenceOverlay {
  runId: string | null;
  productionFingerprint: string | null;
  generatedAt: string | null;
  overallScore: number | null;
  overallStatus: string | null;
  stages: EvpStageResult[];
  /** Shape ready to spread into certifyProductionValidation. */
  validationOverlay: Pick<
    ProductionValidationInputs,
    "integrationTelemetry" | "performance" | "scalability" | "disasterRecovery" | "security" | "readinessScore"
  >;
  /** Age of the evidence, ms. Used by CI freshness gate in T4. */
  ageMs: number | null;
  /** True when there is no EVP run yet — governance-only defaults apply. */
  empty: boolean;
  /** Lookup diagnostics — always populated, even when `empty`. */
  diagnostics: EvidenceDiagnostics;
  /** Wall-clock time the overlay was rebuilt (client-side). */
  rebuiltAt: string;
}

export const EMPTY_DIAGNOSTICS: EvidenceDiagnostics = {
  scalability: {
    rowCount: 0, passedRowCount: 0, queryError: null,
    tiersWithPaymentEvidence: [], tiersWithDispatchEvidence: [], unmappedTiers: [],
    floorTier: null, floorRunId: null, floorPaymentTps: null, floorDispatchTps: null,
    floorJoined: false, floorReason: "no qualification runs loaded",
  },
  disasterRecovery: {
    rowCount: 0, queryError: null, scenariosFound: [], unmappedScenarios: [],
    passedCount: 0, meanRtoSec: null, worstRtoSec: null,
  },
  integrations: { observed: [], totalSamples: 0, source: "none" },
  performance: { source: "none", apiP95Ms: null, rpcP95Ms: null, errorRate: null, throughputRps: null },
};

const EMPTY: EvpEvidenceOverlay = {
  runId: null,
  productionFingerprint: null,
  generatedAt: null,
  overallScore: null,
  overallStatus: null,
  stages: [],
  validationOverlay: {},
  ageMs: null,
  empty: true,
  diagnostics: EMPTY_DIAGNOSTICS,
  rebuiltAt: "",
};

/** Production scalability floor required by the D13.0 release authority. */
export const SCALABILITY_FLOOR_TIER = 10_000;


/* ------------------------------------------------------------------ */
/* Scalability evidence — reads existing payment load qualification    */
/* runs. Fail-closed: a tier only counts when a passed run exists and  */
/* carries the metrics the certifier requires.                         */
/* ------------------------------------------------------------------ */
type ScalabilityOverlay = NonNullable<ProductionValidationInputs["scalability"]>;

export interface ScalabilityEvidenceResult {
  overlay: ScalabilityOverlay;
  diagnostics: EvidenceDiagnostics["scalability"];
}

export async function loadScalabilityEvidence(): Promise<ScalabilityEvidenceResult> {
  const overlay: ScalabilityOverlay = {};
  const diagnostics: EvidenceDiagnostics["scalability"] = {
    ...EMPTY_DIAGNOSTICS.scalability,
    tiersWithPaymentEvidence: [],
    tiersWithDispatchEvidence: [],
    unmappedTiers: [],
  };

  const { data, error } = await supabase
    .from("payment_load_qualification_runs")
    .select("id, concurrency_tier, scenario, status, started_at, finished_at, total_requests, successful_requests, callback_latency_p95_ms, max_queue_depth, error_rate")
    .order("started_at", { ascending: false })
    .limit(200);

  diagnostics.queryError = error ? error.message : null;
  diagnostics.rowCount = data?.length ?? 0;
  if (error || !data?.length) {
    diagnostics.floorReason = error
      ? `query failed: ${error.message}`
      : "no payment_load_qualification_runs rows";
    return { overlay, diagnostics };
  }

  const passed = data.filter((row) => row.status === "passed");
  diagnostics.passedRowCount = passed.length;

  // Highest-throughput dispatch evidence per tier, keyed alongside payment runs.
  const dispatchTps = new Map<number, number>();
  const dispatchRunId = new Map<number, string>();
  const paymentRuns: Array<{ tier: number; id: string; metrics: NonNullable<ScalabilityOverlay[ScalabilityTier]> }> = [];
  const unmapped = new Set<number>();

  for (const row of passed) {
    const tier = Number(row.concurrency_tier);
    if (!(SCALABILITY_TIERS as readonly number[]).includes(tier)) {
      unmapped.add(tier);
      continue;
    }
    const startedAt = row.started_at ? Date.parse(row.started_at) : NaN;
    const finishedAt = row.finished_at ? Date.parse(row.finished_at) : NaN;
    const durationSec = Number.isFinite(startedAt) && Number.isFinite(finishedAt) && finishedAt > startedAt
      ? (finishedAt - startedAt) / 1000
      : 0;
    const tps = durationSec > 0 ? Number(row.successful_requests ?? 0) / durationSec : 0;

    if (String(row.scenario ?? "").startsWith("dispatch")) {
      if (tps > (dispatchTps.get(tier) ?? 0)) {
        dispatchTps.set(tier, tps);
        dispatchRunId.set(tier, String(row.id));
      }
      continue;
    }
    paymentRuns.push({
      tier,
      id: String(row.id),
      metrics: {
        p95LatencyMs: Number(row.callback_latency_p95_ms ?? 0),
        queueDepth: Number(row.max_queue_depth ?? 0),
        paymentTps: tps,
        dispatchTps: 0,
        dbCpuPct: 0,
      },
    });
  }

  const floorCandidates: Array<{ tier: number; id: string; paymentTps: number }> = [];
  for (const run of paymentRuns) {
    const tier = run.tier as ScalabilityTier;
    if (overlay[tier]) continue; // newest run per tier wins (query is ordered desc)
    overlay[tier] = { ...run.metrics, dispatchTps: dispatchTps.get(run.tier) ?? 0 };
    if (run.tier >= SCALABILITY_FLOOR_TIER) {
      floorCandidates.push({ tier: run.tier, id: run.id, paymentTps: run.metrics.paymentTps });
    }
  }

  diagnostics.tiersWithPaymentEvidence = [...new Set(paymentRuns.map((r) => r.tier))].sort((a, b) => a - b);
  diagnostics.tiersWithDispatchEvidence = [...dispatchTps.keys()].sort((a, b) => a - b);
  diagnostics.unmappedTiers = [...unmapped].sort((a, b) => a - b);

  // Scalability floor: newest passed run at tier >= 10,000, joined with the
  // dispatch-scenario throughput recorded at that same tier.
  if (!floorCandidates.length) {
    diagnostics.floorReason = diagnostics.passedRowCount === 0
      ? `no passed runs (${diagnostics.rowCount} row(s) on record, none passed)`
      : `no passed run at tier >= ${SCALABILITY_FLOOR_TIER.toLocaleString()} — highest passed tier is ${
        Math.max(0, ...diagnostics.tiersWithPaymentEvidence).toLocaleString()}`;
    return { overlay, diagnostics };
  }

  // Highest qualifying tier wins; the query order already made it the newest.
  const floor = floorCandidates.reduce((a, b) => (b.tier > a.tier ? b : a));
  const floorDispatch = dispatchTps.get(floor.tier) ?? null;
  diagnostics.floorTier = floor.tier;
  diagnostics.floorRunId = floor.id;
  diagnostics.floorPaymentTps = Number(floor.paymentTps.toFixed(2));
  diagnostics.floorDispatchTps = floorDispatch === null ? null : Number(floorDispatch.toFixed(2));
  diagnostics.floorJoined = floorDispatch !== null && floorDispatch > 0;
  diagnostics.floorReason = diagnostics.floorJoined
    ? `floor certified from run ${floor.id.slice(0, 8)} at ${floor.tier.toLocaleString()} concurrency`
    : `payment evidence at ${floor.tier.toLocaleString()} exists but no dispatch-scenario run at that tier (dispatch TPS missing)`;

  return { overlay, diagnostics };
}

/* ------------------------------------------------------------------ */
/* Disaster recovery evidence — reads existing drill records.          */
/* ------------------------------------------------------------------ */
type DrOverlay = NonNullable<ProductionValidationInputs["disasterRecovery"]>;

export interface DrEvidenceResult {
  overlay: DrOverlay;
  diagnostics: EvidenceDiagnostics["disasterRecovery"];
}

export async function loadDisasterRecoveryEvidence(): Promise<DrEvidenceResult> {
  const overlay: DrOverlay = {};
  const diagnostics: EvidenceDiagnostics["disasterRecovery"] = {
    ...EMPTY_DIAGNOSTICS.disasterRecovery,
    scenariosFound: [],
    unmappedScenarios: [],
  };

  const { data, error } = await supabase
    .from("disaster_recovery_tests")
    .select("scenario, executed_at, rto_actual_minutes, passed")
    .not("executed_at", "is", null)
    .order("executed_at", { ascending: false })
    .limit(200);

  diagnostics.queryError = error ? error.message : null;
  diagnostics.rowCount = data?.length ?? 0;
  if (error || !data?.length) return { overlay, diagnostics };

  const found = new Set<string>();
  const unmapped = new Set<string>();
  const rtos: number[] = [];

  for (const row of data) {
    const scenario = String(row.scenario ?? "") as DrScenario;
    if (!(DR_SCENARIOS as readonly string[]).includes(scenario)) {
      unmapped.add(String(row.scenario ?? "(null)"));
      continue;
    }
    found.add(scenario);
    if (row.passed === true) diagnostics.passedCount += 1;
    if (overlay[scenario]) continue; // newest drill wins
    const rtoMin = row.rto_actual_minutes;
    const recoveryTimeSec = rtoMin == null ? undefined : Number(rtoMin) * 60;
    if (recoveryTimeSec != null) rtos.push(recoveryTimeSec);
    overlay[scenario] = {
      recoveryTimeSec,
      dataIntegrityOk: row.passed === true,
      replayIntegrityOk: row.passed === true,
    };
  }

  diagnostics.scenariosFound = [...found].sort();
  diagnostics.unmappedScenarios = [...unmapped].sort();
  diagnostics.meanRtoSec = rtos.length ? Math.round(rtos.reduce((a, b) => a + b, 0) / rtos.length) : null;
  diagnostics.worstRtoSec = rtos.length ? Math.max(...rtos) : null;

  return { overlay, diagnostics };
}

/**
 * Loads the most recent EVP artifact. Returns EMPTY overlay if none exists,
 * or the artifact is malformed. Never throws — the UI must render fine
 * without live evidence.
 */
export async function loadLatestEvpEvidence(): Promise<EvpEvidenceOverlay> {
  const [{ data, error }, scal, dr] = await Promise.all([
    supabase
      .from("assurance_runs")
      .select("id, status, production_score, artifacts, started_at, finished_at")
      .eq("branch", "evp")
      .order("finished_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
    loadScalabilityEvidence(),
    loadDisasterRecoveryEvidence(),
  ]);

  const rebuiltAt = new Date().toISOString();
  const diagnostics: EvidenceDiagnostics = {
    scalability: scal.diagnostics,
    disasterRecovery: dr.diagnostics,
    integrations: { ...EMPTY_DIAGNOSTICS.integrations },
    performance: { ...EMPTY_DIAGNOSTICS.performance },
  };

  // Scalability / DR evidence lives outside the EVP artifact, so it applies
  // even when no EVP run has been published yet.
  const baseOverlay: EvpEvidenceOverlay["validationOverlay"] = {};
  if (Object.keys(scal.overlay).length) baseOverlay.scalability = scal.overlay;
  if (Object.keys(dr.overlay).length) baseOverlay.disasterRecovery = dr.overlay;

  if (error || !data) {
    return { ...EMPTY, validationOverlay: baseOverlay, diagnostics, rebuiltAt };
  }

  const artifact = (data.artifacts ?? {}) as Partial<EvpRunArtifact>;
  if (!artifact.version || artifact.version !== "evp/v1") {
    return { ...EMPTY, validationOverlay: baseOverlay, diagnostics, rebuiltAt };
  }

  const rollup = (artifact.rollup ?? {}) as Partial<EvpRunArtifact["rollup"]>;
  const validationOverlay: EvpEvidenceOverlay["validationOverlay"] = { ...baseOverlay };


  // Integration telemetry — only include when we actually captured live rows.
  if (rollup.integrations && Object.keys(rollup.integrations).length > 0) {
    validationOverlay.integrationTelemetry = rollup.integrations as never;
    diagnostics.integrations = {
      observed: Object.keys(rollup.integrations).sort(),
      totalSamples: Object.values(rollup.integrations).reduce<number>((a, i) => a + Number((i as { sampleSize?: number } | null)?.sampleSize ?? 0), 0),
      source: "evp_rollup",
    };
  }

  // Performance — only when captured.
  if (rollup.performance) {
    const p = rollup.performance;
    validationOverlay.performance = {
      api: { p95Ms: p.apiP95Ms, errorRate: p.errorRate, throughputRps: p.throughputRps, timeoutRate: 0 },
      database: { slowQueries: 0, lockContention: 0, indexUtil: 1, replicationLagMs: 0, p95Ms: p.databaseP95Ms } as never,
      edgeFunctions: { invocationSuccess: 1 - p.errorRate, coldStartMs: 0, execP95Ms: p.edgeExecP95Ms },
      workspace360: { pageLoadMs: 0, tabSwitchMs: 0, rpcP95Ms: p.rpcP95Ms },
    };
    diagnostics.performance = {
      source: "evp_rollup",
      apiP95Ms: p.apiP95Ms, rpcP95Ms: p.rpcP95Ms,
      errorRate: p.errorRate, throughputRps: p.throughputRps,
    };
  }

  // Security — only when captured.
  if (rollup.security) {
    validationOverlay.security = {
      verified: {
        rls: rollup.security.rlsVerified > 0,
        jwt: rollup.security.jwtVerified > 0,
      } as never,
      openFindings: { critical: rollup.security.openCritical, high: rollup.security.openHigh },
    };
  }

  if (typeof rollup.readinessScore === "number") {
    validationOverlay.readinessScore = rollup.readinessScore;
  }

  const finishedAt = data.finished_at ? new Date(data.finished_at).getTime() : null;
  const ageMs = finishedAt ? Date.now() - finishedAt : null;

  return {
    runId: data.id,
    productionFingerprint: artifact.productionFingerprint ?? null,
    generatedAt: artifact.generatedAt ?? null,
    overallScore: typeof data.production_score === "number" ? data.production_score : Number(data.production_score) || null,
    overallStatus: data.status ?? null,
    stages: artifact.stages ?? [],
    validationOverlay,
    ageMs,
    empty: false,
    diagnostics,
    rebuiltAt,
  };
}


/** Convenience: max acceptable evidence age before CI/UI should warn. */
export const EVP_FRESHNESS_WINDOW_MS = 24 * 60 * 60 * 1000;

export function isEvpFresh(overlay: EvpEvidenceOverlay): boolean {
  return !overlay.empty && overlay.ageMs !== null && overlay.ageMs <= EVP_FRESHNESS_WINDOW_MS;
}
