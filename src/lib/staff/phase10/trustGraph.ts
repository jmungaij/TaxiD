/**
 * Phase 10 §10.16 — the Yalla Trust & Safety Graph.
 *
 * For every mission Yalla must be able to state who the customer is, who the
 * provider is, which resource performed the work, that compliance was valid,
 * that payment is accounted for, and that completion is evidenced. As Yalla
 * moves into charter, aircraft and logistics this is not a nicety: without it,
 * the mission cannot be economically closed.
 */
import type { Mission, MissionType } from "./mission";

export const TRUST_FACETS = [
  "customer_identity",
  "provider_identity",
  "resource_identity",
  "compliance",
  "payment",
  "mission_status",
  "location_events",
  "communication",
  "incident_history",
  "completion_evidence",
] as const;
export type TrustFacet = (typeof TRUST_FACETS)[number];

export const TRUST_FACET_LABEL: Record<TrustFacet, string> = {
  customer_identity: "Customer identity",
  provider_identity: "Provider identity",
  resource_identity: "Resource identity",
  compliance: "Compliance",
  payment: "Payment",
  mission_status: "Mission status",
  location_events: "Location events",
  communication: "Communication",
  incident_history: "Incident history",
  completion_evidence: "Completion evidence",
};

/** Facets that must be evidenced before a mission may be financially closed. */
const CLOSURE_CRITICAL: TrustFacet[] = [
  "customer_identity",
  "provider_identity",
  "compliance",
  "payment",
  "completion_evidence",
];

/** Higher-consequence products demand resource identity too. */
const RESOURCE_CRITICAL: MissionType[] = ["air", "charter", "logistics", "rental", "leasing"];

export interface TrustEvidence {
  facet: TrustFacet;
  present: boolean;
  /** Where the evidence lives — table, document, event stream. */
  source: string;
  detail?: string;
}

export interface TrustRecord {
  missionId: string;
  missionType: MissionType;
  /** 0-100 share of applicable facets evidenced. */
  completeness: number;
  evidence: TrustEvidence[];
  missing: TrustFacet[];
  /** Missing facets that block financial closure. */
  blocking: TrustFacet[];
  closureAllowed: boolean;
  narrative: string;
}

export function buildTrustRecord(mission: Mission, evidence: readonly TrustEvidence[]): TrustRecord {
  const byFacet = new Map(evidence.map((e) => [e.facet, e]));
  const applicable = TRUST_FACETS.filter((f) => f !== "resource_identity" || RESOURCE_CRITICAL.includes(mission.type));

  const rows: TrustEvidence[] = applicable.map(
    (facet) => byFacet.get(facet) ?? { facet, present: false, source: "—", detail: "No evidence recorded" },
  );
  const missing = rows.filter((r) => !r.present).map((r) => r.facet);
  const critical = RESOURCE_CRITICAL.includes(mission.type)
    ? [...CLOSURE_CRITICAL, "resource_identity" as TrustFacet]
    : CLOSURE_CRITICAL;
  const blocking = missing.filter((f) => critical.includes(f));
  const completeness = Math.round(((rows.length - missing.length) / rows.length) * 100);

  return {
    missionId: mission.id,
    missionType: mission.type,
    completeness,
    evidence: rows,
    missing,
    blocking,
    closureAllowed: blocking.length === 0,
    narrative: blocking.length === 0
      ? `Trust graph complete for closure at ${completeness}% of applicable facets.`
      : `Closure blocked: ${blocking.map((f) => TRUST_FACET_LABEL[f]).join(", ")} ${blocking.length === 1 ? "is" : "are"} not evidenced.`,
  };
}

/** Marketplace-wide trust posture, used by the Control Tower. */
export interface TrustPosture {
  missions: number;
  meanCompleteness: number | null;
  blockedMissions: number;
  worstFacets: { facet: TrustFacet; missing: number }[];
}

export function trustPosture(records: readonly TrustRecord[]): TrustPosture {
  if (records.length === 0) return { missions: 0, meanCompleteness: null, blockedMissions: 0, worstFacets: [] };
  const counts = new Map<TrustFacet, number>();
  for (const r of records) for (const f of r.missing) counts.set(f, (counts.get(f) ?? 0) + 1);
  return {
    missions: records.length,
    meanCompleteness: Math.round(records.reduce((a, r) => a + r.completeness, 0) / records.length),
    blockedMissions: records.filter((r) => !r.closureAllowed).length,
    worstFacets: [...counts.entries()]
      .map(([facet, missing]) => ({ facet, missing }))
      .sort((a, b) => b.missing - a.missing)
      .slice(0, 5),
  };
}
