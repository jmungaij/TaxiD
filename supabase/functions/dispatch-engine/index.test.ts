// Pure-logic tests for the dispatch scoring engine.
// No network calls; safe to run in CI without Supabase credentials.

import { assert, assertEquals, assertAlmostEquals } from
  "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  DEFAULT_WEIGHTS,
  estimateEtaSeconds,
  haversineMeters,
  proximityValue,
  rankCandidates,
  scoreCandidate,
  validateWeights,
  type DriverContext,
} from "./scoring.ts";

const baseDriver = (over: Partial<DriverContext> = {}): DriverContext => ({
  driver_id: "d1",
  distance_m: 1000,
  eta_seconds: 120,
  rating: 4.5,
  acceptance_rate: 0.9,
  completion_rate: 0.95,
  idle_seconds: 300,
  vehicle_category: "economy",
  ...over,
});

Deno.test("DEFAULT_WEIGHTS sum to 1", () => {
  assert(validateWeights(DEFAULT_WEIGHTS));
});

Deno.test("proximity decays with distance", () => {
  assert(proximityValue(0) > proximityValue(1000));
  assert(proximityValue(1000) > proximityValue(5000));
});

Deno.test("haversine: Nairobi CBD ~ JKIA ≈ 15km", () => {
  const m = haversineMeters(-1.2864, 36.8172, -1.3192, 36.9278);
  assert(m > 12_000 && m < 18_000, `expected ~15km, got ${m}`);
});

Deno.test("estimateEtaSeconds: 5km @ 30kph ≈ 600s", () => {
  assertAlmostEquals(estimateEtaSeconds(5000), 600, 5);
});

Deno.test("scoreCandidate: closer driver outranks farther driver", () => {
  const close = scoreCandidate(baseDriver({ distance_m: 500, eta_seconds: 60 }),
    { vehicle_category: "economy", surge_multiplier: 1 });
  const far = scoreCandidate(baseDriver({ distance_m: 8000, eta_seconds: 900 }),
    { vehicle_category: "economy", surge_multiplier: 1 });
  assert(close.score > far.score, `${close.score} should beat ${far.score}`);
});

Deno.test("scoreCandidate: vehicle mismatch is a hard filter", () => {
  const r = scoreCandidate(baseDriver({ vehicle_category: "economy" }),
    { vehicle_category: "xl", surge_multiplier: 1 });
  assertEquals(r.hard_filter_failed, "vehicle_category");
  assertEquals(r.score, 0);
});

Deno.test("scoreCandidate: breakdown contributions sum to score", () => {
  const r = scoreCandidate(baseDriver(),
    { vehicle_category: "economy", surge_multiplier: 1 });
  const sum = r.breakdown.reduce((s, b) => s + b.contribution, 0);
  assertAlmostEquals(sum, r.score, 0.001);
});

Deno.test("scoreCandidate: high acceptance beats low acceptance, all else equal", () => {
  const hi = scoreCandidate(baseDriver({ acceptance_rate: 0.95 }),
    { vehicle_category: "economy", surge_multiplier: 1 });
  const lo = scoreCandidate(baseDriver({ acceptance_rate: 0.3 }),
    { vehicle_category: "economy", surge_multiplier: 1 });
  assert(hi.score > lo.score);
});

Deno.test("scoreCandidate: idle driver gets fairness boost", () => {
  const idle = scoreCandidate(baseDriver({ idle_seconds: 1800 }),
    { vehicle_category: "economy", surge_multiplier: 1.5 });
  const fresh = scoreCandidate(baseDriver({ idle_seconds: 10 }),
    { vehicle_category: "economy", surge_multiplier: 1.5 });
  assert(idle.score > fresh.score);
});

Deno.test("rankCandidates: deterministic descending order by score", () => {
  const cands = [
    { id: "a", score: 0.5 },
    { id: "b", score: 0.9 },
    { id: "c", score: 0.7 },
  ];
  const ranked = rankCandidates(cands);
  assertEquals(ranked.map((c) => c.id), ["b", "c", "a"]);
});

Deno.test("no candidates path: empty input ranks to empty", () => {
  assertEquals(rankCandidates([]), []);
});

Deno.test("scoring determinism: same input → same score", () => {
  const a = scoreCandidate(baseDriver(),
    { vehicle_category: "economy", surge_multiplier: 1 });
  const b = scoreCandidate(baseDriver(),
    { vehicle_category: "economy", surge_multiplier: 1 });
  assertEquals(a.score, b.score);
});
