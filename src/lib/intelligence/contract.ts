/**
 * Yalla Intelligence OS — answer contract.
 *
 * Every claim the intelligence layer returns declares WHAT KIND of statement it
 * is, WHERE it came from, HOW FRESH the underlying data is and HOW CONFIDENT the
 * layer is. Nothing is filled in when the data does not exist: a missing field
 * is absent, never guessed.
 *
 * Two laws are encoded here rather than left to convention:
 *   1. A FACT is a value read from an authoritative record. Anything derived
 *      from an assumption is an ESTIMATE; anything about the future is a
 *      PREDICTION; anything proposing work is a RECOMMENDATION.
 *   2. Potential (pipeline / opportunity) value is never expressed as revenue.
 *      Revenue claims may only be built from the recognised lifecycle states.
 */

export type ClaimClass = "FACT" | "ESTIMATE" | "PREDICTION" | "RECOMMENDATION";

export const INTELLIGENCE_DOMAINS = [
  "commercial",
  "finance",
  "operations",
  "workforce",
  "decision_spine",
  "security",
] as const;

export type IntelligenceDomain = (typeof INTELLIGENCE_DOMAINS)[number];

export interface EvidenceRef {
  /** Human label, e.g. "12 lifecycle records in CONTRACTED". */
  label: string;
  /** Owning record surface, so a reader can go and check it. */
  path?: string;
  detail?: string;
}

export interface Claim {
  id: string;
  label: string;
  /** Presentation value. Formatting belongs to the producing service. */
  value: string;
  /** Raw number when the claim is numeric, for cross-checks. */
  numeric?: number;
  classification: ClaimClass;
  /** Authoritative source: table, view or named engine. Never a model. */
  source: string;
  /** ISO timestamp of the newest underlying row. Absent when unknown. */
  observedAt?: string;
  /** 0-100. Absent when the producing service cannot justify a number. */
  confidence?: number;
  evidence?: EvidenceRef[];
  /** Stated openly for every ESTIMATE and PREDICTION. */
  assumptions?: string[];
}

export interface DomainReading {
  domain: IntelligenceDomain;
  /** Staff permission the reading required. */
  permission: string;
  authorised: boolean;
  claims: Claim[];
  /** Newest observation across the reading. */
  freshestAt?: string;
  rowsInspected: number;
  /** Set when the domain could not be read; the answer must say so. */
  unavailableReason?: string;
}

export interface DataQuality {
  /** 0-100 composite of coverage, freshness and evidence density. */
  score: number;
  freshnessMinutes?: number;
  domainsRequested: number;
  domainsAuthorised: number;
  domainsWithData: number;
  rowsInspected: number;
}

/** Domains whose data is expected to move within minutes rather than days. */
export const DOMAIN_STALE_AFTER_MINUTES: Record<IntelligenceDomain, number> = {
  commercial: 60 * 24,
  finance: 60 * 24,
  operations: 60,
  workforce: 60 * 24 * 7,
  decision_spine: 60 * 12,
  security: 60 * 24,
};


export const CLAIM_CLASS_LABEL: Record<ClaimClass, string> = {
  FACT: "Fact",
  ESTIMATE: "Estimate",
  PREDICTION: "Prediction",
  RECOMMENDATION: "Recommendation",
};

export function emptyReading(
  domain: IntelligenceDomain,
  permission: string,
  unavailableReason?: string,
  authorised = true,
): DomainReading {
  return { domain, permission, authorised, claims: [], rowsInspected: 0, unavailableReason };
}

export function newestTimestamp(values: Array<string | null | undefined>): string | undefined {
  const times = values
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .map((v) => new Date(v).getTime())
    .filter((t) => Number.isFinite(t));
  if (times.length === 0) return undefined;
  return new Date(Math.max(...times)).toISOString();
}

export function minutesSince(iso: string | undefined, now: number = Date.now()): number | undefined {
  if (!iso) return undefined;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return undefined;
  return Math.max(0, Math.round((now - t) / 60000));
}

/** Kenyan shilling presentation used by every money claim. */
export function kes(amount: number): string {
  return `KSh ${Math.round(amount).toLocaleString("en-KE")}`;
}

export function computeDataQuality(
  readings: DomainReading[],
  now: number = Date.now(),
): DataQuality {
  const authorised = readings.filter((r) => r.authorised);
  const withData = authorised.filter((r) => r.claims.length > 0);
  const rowsInspected = readings.reduce((sum, r) => sum + r.rowsInspected, 0);
  const freshest = newestTimestamp(readings.map((r) => r.freshestAt));
  const freshnessMinutes = minutesSince(freshest, now);

  // Coverage: how much of what was asked for could actually be read.
  const coverage = readings.length === 0 ? 0 : withData.length / readings.length;

  // Freshness: measured against the strictest threshold among the domains read.
  const strictest = withData.length
    ? Math.min(...withData.map((r) => DOMAIN_STALE_AFTER_MINUTES[r.domain]))
    : undefined;
  let freshnessFactor = 0.5;
  if (freshnessMinutes !== undefined && strictest !== undefined) {
    freshnessFactor = freshnessMinutes <= strictest ? 1 : Math.max(0, 1 - (freshnessMinutes - strictest) / (strictest * 4));
  }

  // Evidence density: claims carrying at least one traceable evidence line.
  const claims = withData.flatMap((r) => r.claims);
  const evidenced = claims.filter((c) => (c.evidence?.length ?? 0) > 0).length;
  const evidenceFactor = claims.length === 0 ? 0 : evidenced / claims.length;

  const score = Math.round(100 * (0.5 * coverage + 0.25 * freshnessFactor + 0.25 * evidenceFactor));

  return {
    score,
    freshnessMinutes,
    domainsRequested: readings.length,
    domainsAuthorised: authorised.length,
    domainsWithData: withData.length,
    rowsInspected,
  };
}

/**
 * Answer confidence is bounded by data quality — the layer can never be more
 * confident than the data supports, and predictions cap it further.
 */
export function computeConfidence(readings: DomainReading[], quality: DataQuality): number {
  const claims = readings.filter((r) => r.authorised).flatMap((r) => r.claims);
  if (claims.length === 0) return 0;
  const scored = claims.filter((c) => typeof c.confidence === "number") as Array<Claim & { confidence: number }>;
  const claimConfidence = scored.length
    ? scored.reduce((s, c) => s + c.confidence, 0) / scored.length
    : 60;
  const predictionShare = claims.filter((c) => c.classification === "PREDICTION").length / claims.length;
  const raw = Math.min(claimConfidence, quality.score) * (1 - 0.25 * predictionShare);
  return Math.max(0, Math.min(100, Math.round(raw)));
}

export function countByClass(readings: DomainReading[]): Record<ClaimClass, number> {
  const out: Record<ClaimClass, number> = { FACT: 0, ESTIMATE: 0, PREDICTION: 0, RECOMMENDATION: 0 };
  for (const reading of readings) {
    for (const claim of reading.claims) out[claim.classification] += 1;
  }
  return out;
}
