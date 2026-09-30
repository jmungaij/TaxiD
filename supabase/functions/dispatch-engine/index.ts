// dispatch-engine: runs one dispatch cycle for a dispatch_requests row.
// Owner domain: dispatch.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireInternalOrStaff } from "../_shared/internal-auth.ts";
import {
  DEFAULT_WEIGHTS,
  estimateEtaSeconds,
  haversineMeters,
  rankCandidates,
  scoreCandidate,
  type DriverContext,
} from "./scoring.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const RADII_M = [1500, 3000, 6000, 10000];
const MAX_CANDIDATES = 8;
const OFFER_TTL_SECONDS = 20;

interface DriverRow {
  driver_id: string;
  lat: number;
  lng: number;
  is_online: boolean;
  is_available: boolean;
  updated_at: string;
  vehicle_id: string | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Privileged worker: cron/service-role callers, or an admin "run now" button.
  try {
    await requireInternalOrStaff(req, ["admin", "super_admin"]);
  } catch (guardError) {
    const status = (guardError as { status?: number }).status ?? 401;
    return new Response(JSON.stringify({ error: (guardError as Error).message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  let payload: { request_id?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const requestId = payload.request_id;
  if (!requestId || typeof requestId !== "string") {
    return json({ error: "request_id required" }, 400);
  }

  const startedAt = Date.now();
  const { data: request, error: reqErr } = await supabase
    .from("dispatch_requests")
    .select("*")
    .eq("id", requestId)
    .maybeSingle();
  if (reqErr || !request) {
    return json({ error: "request_not_found" }, 404);
  }
  if (request.status !== "PENDING") {
    return json({ error: "request_not_pending", status: request.status }, 409);
  }

  // Insert engine-run row (we update it at the end).
  const { data: runRow } = await supabase
    .from("dispatch_engine_runs")
    .insert({
      request_id: requestId,
      rule_version: "v1",
      outcome: "ERROR",
      candidates_considered: 0,
      candidates_offered: 0,
    })
    .select("id")
    .single();
  const runId = runRow?.id as string | undefined;

  // 1) Candidate search with expanding radius.
  let drivers: DriverRow[] = [];
  let usedRadius = RADII_M[RADII_M.length - 1];
  for (const radius of RADII_M) {
    drivers = await findNearbyDrivers(
      supabase,
      request.pickup_lat,
      request.pickup_lng,
      radius,
    );
    if (drivers.length >= 3) {
      usedRadius = radius;
      break;
    }
  }

  if (drivers.length === 0) {
    await finishRun(supabase, runId, {
      outcome: "NO_SUPPLY",
      duration_ms: Date.now() - startedAt,
      notes: { radius_m: usedRadius },
    });
    return json({ outcome: "NO_SUPPLY", run: await fetchRun(supabase, runId) });
  }

  // 2) Score
  const enriched: Array<{
    driver: DriverRow;
    distance_m: number;
    eta_seconds: number;
    score: number;
    breakdown: ReturnType<typeof scoreCandidate>["breakdown"];
  }> = [];

  for (const d of drivers.slice(0, MAX_CANDIDATES)) {
    const dist = Math.round(
      haversineMeters(request.pickup_lat, request.pickup_lng, d.lat, d.lng),
    );
    const eta = estimateEtaSeconds(dist);
    const idle = Math.max(
      0,
      Math.floor((Date.now() - new Date(d.updated_at).getTime()) / 1000),
    );

    const driverCtx: DriverContext = {
      driver_id: d.driver_id,
      distance_m: dist,
      eta_seconds: eta,
      rating: 4.5,
      acceptance_rate: await getAcceptanceRate(supabase, d.driver_id),
      completion_rate: await getCompletionRate(supabase, d.driver_id),
      idle_seconds: idle,
      vehicle_category: request.vehicle_category ?? null,
    };

    const res = scoreCandidate(driverCtx, {
      vehicle_category: request.vehicle_category,
      surge_multiplier: Number(request.surge_multiplier ?? 1),
    });
    if (res.hard_filter_failed) continue;

    enriched.push({
      driver: d,
      distance_m: dist,
      eta_seconds: eta,
      score: res.score,
      breakdown: res.breakdown,
    });
  }

  const ranked = rankCandidates(enriched);
  if (ranked.length === 0) {
    await finishRun(supabase, runId, {
      outcome: "NO_SUPPLY",
      duration_ms: Date.now() - startedAt,
      notes: { reason: "all_filtered", radius_m: usedRadius },
    });
    return json({ outcome: "NO_SUPPLY", run: await fetchRun(supabase, runId) });
  }

  // 3) Persist candidates + scores + ETA snapshots
  const candRows = ranked.map((c, i) => ({
    request_id: requestId,
    driver_id: c.driver.driver_id,
    rank: i + 1,
    distance_m: c.distance_m,
    eta_seconds: c.eta_seconds,
    score: c.score,
    status: "SCORED" as const,
  }));
  const { data: inserted, error: insErr } = await supabase
    .from("dispatch_candidates")
    .insert(candRows)
    .select("id, driver_id, rank");
  if (insErr || !inserted) {
    await finishRun(supabase, runId, {
      outcome: "ERROR",
      duration_ms: Date.now() - startedAt,
      notes: { error: insErr?.message },
    });
    return json({ error: "candidate_insert_failed", detail: insErr?.message }, 500);
  }

  const idByRank = new Map(inserted.map((r) => [r.rank, r.id]));

  // score factor rows
  const scoreRows = ranked.flatMap((c, i) =>
    c.breakdown.map((b) => ({
      candidate_id: idByRank.get(i + 1)!,
      factor: b.factor,
      weight: b.weight,
      value: b.value,
      contribution: b.contribution,
      rule_version: "v1",
    }))
  );
  if (scoreRows.length) await supabase.from("dispatch_scores").insert(scoreRows);

  // eta snapshots
  await supabase.from("dispatch_eta_estimates").insert(
    ranked.map((c, i) => ({
      request_id: requestId,
      candidate_id: idByRank.get(i + 1)!,
      driver_id: c.driver.driver_id,
      distance_m: c.distance_m,
      eta_seconds: c.eta_seconds,
      confidence: 0.6,
      model_version: "haversine-v1",
    })),
  );

  // 4) Offer to top candidate (sequential offering happens via reaper)
  const winner = ranked[0];
  const winnerCandId = idByRank.get(1)!;
  const expiresAt = new Date(Date.now() + OFFER_TTL_SECONDS * 1000).toISOString();

  await supabase
    .from("dispatch_candidates")
    .update({ status: "OFFERED", offered_at: new Date().toISOString() })
    .eq("id", winnerCandId);

  await supabase.from("dispatch_offer_timeouts").insert({
    candidate_id: winnerCandId,
    request_id: requestId,
    driver_id: winner.driver.driver_id,
    expires_at: expiresAt,
  });

  await supabase.from("dispatch_events").insert({
    request_id: requestId,
    candidate_id: winnerCandId,
    event_type: "OFFER_SENT",
    payload: { driver_id: winner.driver.driver_id, score: winner.score },
  });

  await finishRun(supabase, runId, {
    outcome: "ASSIGNED",
    winner_driver_id: winner.driver.driver_id,
    duration_ms: Date.now() - startedAt,
    candidates_considered: ranked.length,
    candidates_offered: 1,
    notes: { radius_m: usedRadius, top_score: winner.score },
  });

  // --- Phase 5 wiring: ensure hex cell + log ML prediction ----------------
  try {
    const hexId = await upsertHexCell(supabase, request.pickup_lat, request.pickup_lng);
    await supabase.from("ml_predictions").insert({
      use_case: "dispatch_eta_prediction",
      entity_type: "dispatch_request",
      entity_id: requestId,
      input_payload: {
        pickup_lat: request.pickup_lat,
        pickup_lng: request.pickup_lng,
        vehicle_category: request.vehicle_category,
        hex_id: hexId,
        candidates: ranked.length,
      },
      output: {
        winner_driver_id: winner.driver.driver_id,
        eta_seconds: winner.eta_seconds,
        distance_m: winner.distance_m,
        score: winner.score,
      },
      confidence: 0.6,
      latency_ms: Date.now() - startedAt,
      served_environment: "production",
      request_id: requestId,
    });
  } catch (e) {
    console.warn("[dispatch-engine] phase5 telemetry failed", e);
  }

  return json({
    outcome: "OFFERED",
    winner: winner.driver.driver_id,
    candidates: ranked.length,
    run: await fetchRun(supabase, runId),
  });
});

// Coarse 0.01° grid (~1.1km) standing in for H3 until the real lib is wired.
async function upsertHexCell(
  supabase: ReturnType<typeof createClient>,
  lat: number,
  lng: number,
): Promise<string | null> {
  const cellLat = Math.round(lat * 100) / 100;
  const cellLng = Math.round(lng * 100) / 100;
  const h3Key = `grid-${cellLat.toFixed(2)}-${cellLng.toFixed(2)}`;
  const { data: existing } = await supabase
    .from("marketplace_hex_cells")
    .select("id")
    .eq("h3_index", h3Key)
    .maybeSingle();
  if (existing?.id) return existing.id as string;
  const { data: inserted } = await supabase
    .from("marketplace_hex_cells")
    .insert({
      h3_index: h3Key,
      resolution: 8,
      country_code: "KE",
      center_lat: cellLat,
      center_lng: cellLng,
      metadata: { source: "dispatch-engine", auto_created: true },
    })
    .select("id")
    .single();
  return inserted?.id ?? null;
}

// ---------------- helpers ----------------

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

async function findNearbyDrivers(
  supabase: ReturnType<typeof createClient>,
  lat: number,
  lng: number,
  radiusM: number,
): Promise<DriverRow[]> {
  // Bounding box prefilter (~1deg lat = 111km).
  const dLat = radiusM / 111000;
  const dLng = radiusM / (111000 * Math.cos((lat * Math.PI) / 180));
  const { data, error } = await supabase
    .from("driver_locations")
    .select("driver_id,lat,lng,is_online,is_available,updated_at,vehicle_id")
    .eq("is_online", true)
    .eq("is_available", true)
    .gte("lat", lat - dLat)
    .lte("lat", lat + dLat)
    .gte("lng", lng - dLng)
    .lte("lng", lng + dLng)
    .limit(50);
  if (error || !data) return [];
  // Exact circle filter.
  return (data as DriverRow[]).filter(
    (d) => haversineMeters(lat, lng, d.lat, d.lng) <= radiusM,
  );
}

async function getAcceptanceRate(
  supabase: ReturnType<typeof createClient>,
  driverId: string,
): Promise<number> {
  const { data } = await supabase
    .from("dispatch_acceptance_stats")
    .select("acceptance_rate")
    .eq("driver_id", driverId)
    .maybeSingle();
  return Number(data?.acceptance_rate ?? 0.7);
}

async function getCompletionRate(
  supabase: ReturnType<typeof createClient>,
  driverId: string,
): Promise<number> {
  const { data } = await supabase
    .from("dispatch_acceptance_stats")
    .select("completion_rate")
    .eq("driver_id", driverId)
    .maybeSingle();
  return Number(data?.completion_rate ?? 0.9);
}

async function finishRun(
  supabase: ReturnType<typeof createClient>,
  runId: string | undefined,
  patch: Record<string, unknown>,
) {
  if (!runId) return;
  await supabase
    .from("dispatch_engine_runs")
    .update({ ...patch, finished_at: new Date().toISOString() })
    .eq("id", runId);
}

async function fetchRun(
  supabase: ReturnType<typeof createClient>,
  runId: string | undefined,
) {
  if (!runId) return null;
  const { data } = await supabase
    .from("dispatch_engine_runs")
    .select("*")
    .eq("id", runId)
    .maybeSingle();
  return data;
}
