/**
 * TaxiD API PARTNERS — rate-limit simulator (deterministic, client-side).
 *
 * This is a *model* of the documented throttling contract, not a live probe of
 * production. It exists so a partner engineer can reason about burst behaviour,
 * 429 handling and Retry-After semantics before certification, without firing
 * real traffic at the gateway.
 *
 * Model: a token bucket per credential tier.
 *   capacity  = burst allowance
 *   refill    = sustained limit / 60, applied each simulated second
 *   overflow  = 429 with Retry-After = seconds until one token is available
 *
 * Every number here is derived from the published tier contract in
 * apiPlatform.ts. Nothing is measured, and the UI must label it as a model.
 */

import { COMMERCIAL_TIERS } from "./apiPlatform";

export interface RateLimitPolicy {
  tier: string;
  tierName: string;
  /** Sustained requests per minute. `null` = negotiated / dedicated capacity. */
  sustainedPerMin: number | null;
  /** Token-bucket capacity (instantaneous burst allowance). */
  burstCapacity: number;
  /** Tokens restored per simulated second. */
  refillPerSec: number;
  /** Whether the ceiling is contractual rather than a platform default. */
  negotiated: boolean;
}

/** Parse "10,000 req/min" → 10000; negotiated tiers return null. */
export function parseSustained(rateLimit: string): number | null {
  const m = /([\d,]+)\s*req\/min/i.exec(rateLimit);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Build the policy for a tier. `negotiatedPerMin` supplies the contracted
 * ceiling for the Infrastructure tier, where no platform default exists.
 */
export function policyForTier(tierKey: string, negotiatedPerMin = 20_000): RateLimitPolicy {
  const tier = COMMERCIAL_TIERS.find((t) => t.key === tierKey) ?? COMMERCIAL_TIERS[0];
  const parsed = parseSustained(tier.rateLimit);
  const sustained = parsed ?? Math.max(1, Math.round(negotiatedPerMin));
  return {
    tier: tier.key,
    tierName: tier.name,
    sustainedPerMin: parsed,
    // Burst allowance is two seconds of sustained capacity, floored at 1.
    burstCapacity: Math.max(1, Math.round((sustained / 60) * 2)),
    refillPerSec: sustained / 60,
    negotiated: parsed === null,
  };
}

export interface SimulationInput {
  policy: RateLimitPolicy;
  /** Steady offered load, requests per second. */
  arrivalPerSec: number;
  /** Simulated window length in seconds (1–300). */
  durationSeconds: number;
  /** Optional spike: extra requests offered in a single second. */
  burst?: { atSecond: number; requests: number };
}

export interface SimulationSecond {
  second: number;
  offered: number;
  allowed: number;
  throttled: number;
  tokensRemaining: number;
  /** Retry-After the gateway would return for a throttled call this second. */
  retryAfterSeconds: number | null;
}

export interface SimulationResult {
  seconds: SimulationSecond[];
  totals: { offered: number; allowed: number; throttled: number; throttleRate: number };
  peakThrottledSecond: number | null;
  /** Response headers the gateway sets, illustrated at the worst second. */
  headers: Record<string, string>;
  verdict: {
    level: "clear" | "burst" | "sustained";
    headline: string;
    guidance: string;
  };
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function simulate(input: SimulationInput): SimulationResult {
  const duration = clamp(Math.round(input.durationSeconds), 1, 300);
  const arrival = Math.max(0, Math.round(input.arrivalPerSec));
  const { burstCapacity, refillPerSec } = input.policy;

  let tokens = burstCapacity;
  const seconds: SimulationSecond[] = [];

  for (let s = 1; s <= duration; s++) {
    if (s > 1) tokens = Math.min(burstCapacity, tokens + refillPerSec);
    const spike = input.burst && input.burst.atSecond === s ? Math.max(0, Math.round(input.burst.requests)) : 0;
    const offered = arrival + spike;
    const allowed = Math.min(offered, Math.floor(tokens));
    tokens -= allowed;
    const throttled = offered - allowed;
    seconds.push({
      second: s,
      offered,
      allowed,
      throttled,
      tokensRemaining: Math.floor(tokens),
      retryAfterSeconds: throttled > 0 ? Math.max(1, Math.ceil(1 / Math.max(refillPerSec, 1e-6))) : null,
    });
  }

  const offered = seconds.reduce((a, s) => a + s.offered, 0);
  const allowed = seconds.reduce((a, s) => a + s.allowed, 0);
  const throttled = offered - allowed;
  const worst = seconds.reduce<SimulationSecond | null>(
    (w, s) => (s.throttled > (w?.throttled ?? 0) ? s : w),
    null,
  );

  const sustainedPerSec = refillPerSec;
  const level: SimulationResult["verdict"]["level"] =
    throttled === 0 ? "clear" : arrival > sustainedPerSec ? "sustained" : "burst";

  const limitLabel = input.policy.sustainedPerMin
    ? `${input.policy.sustainedPerMin}`
    : `${Math.round(refillPerSec * 60)}`;

  return {
    seconds,
    totals: { offered, allowed, throttled, throttleRate: offered > 0 ? throttled / offered : 0 },
    peakThrottledSecond: worst && worst.throttled > 0 ? worst.second : null,
    headers: {
      "X-RateLimit-Limit": limitLabel,
      "X-RateLimit-Remaining": String(worst ? worst.tokensRemaining : Math.floor(tokens)),
      "X-RateLimit-Reset": "1",
      ...(throttled > 0
        ? { "Retry-After": String(Math.max(1, Math.ceil(1 / Math.max(refillPerSec, 1e-6)))) }
        : {}),
    },
    verdict:
      level === "clear"
        ? {
            level,
            headline: "No throttling in this window",
            guidance:
              "Offered load stays inside the burst allowance and the sustained refill. Still implement 429 handling — limits are tier-dependent and may be lowered during an incident.",
          }
        : level === "burst"
          ? {
              level,
              headline: "Burst throttling only",
              guidance:
                "Steady load is inside the sustained limit but the spike exceeds the burst allowance. Queue the spike and retry on Retry-After; do not retry immediately in a tight loop.",
            }
          : {
              level,
              headline: "Sustained limit exceeded",
              guidance:
                "Offered load exceeds the sustained refill rate, so the bucket never recovers and throttling compounds. Shed or smooth load, or raise contracted capacity with the integration desk before go-live.",
            },
  };
}

/** Reference client behaviour for 429s — shown next to the simulator. */
export const RETRY_REFERENCE = `// 429 handling: honour Retry-After, then exponential backoff with jitter.
async function call(req: Request, attempt = 0): Promise<Response> {
  const res = await fetch(req);
  if (res.status !== 429 || attempt >= 5) return res;
  const retryAfter = Number(res.headers.get("Retry-After") ?? 1);
  const backoff = Math.min(30, retryAfter * 2 ** attempt);
  const jitter = Math.random() * backoff * 0.2;
  await new Promise((r) => setTimeout(r, (backoff + jitter) * 1000));
  return call(req.clone(), attempt + 1);
}`;
