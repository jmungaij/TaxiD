/**
 * Phase 10 §10.39 — the production demonstration.
 *
 * Phase 10 is not demonstrated with static cards. One real mission is driven
 * through the whole architecture — demand, supply discovery, matching, quoting,
 * approval, capacity commitment, booking, orchestration, execution, exception
 * handling, fulfilment, payment, settlement, revenue and learning — and the same
 * framework is then run for ride, parcel, charter, air, rental and leasing.
 */
import { createMission, type Mission, type MissionType } from "./mission";
import { machineFor, runChain, type MissionState } from "./stateMachine";
import { DEFAULT_MATCH_POLICY, matchMission, type MatchResult, type SupplyCandidate } from "./matching";
import { buildTrustRecord, type TrustEvidence, type TrustRecord } from "./trustGraph";
import { recommendPrice, type PriceRecommendation } from "./pricing";
import { routeException, type ExceptionInput, type ExceptionRouting } from "./exceptionAutopilot";
import { buildDecision, recordOutcome, type DecisionRecord } from "./decisionFabric";
import { traceCommercialGraph, type CommercialGraphTrace, type GraphEdgeState } from "./enterpriseGraph";
import { MISSION_PRODUCT } from "./mission";

export interface DemoStage {
  stage: string;
  detail: string;
  evidenced: boolean;
  source: string;
}

export interface MissionDemonstration {
  missionType: MissionType;
  mission: Mission;
  machine: MissionState[];
  statesExecuted: string[];
  match: MatchResult;
  price: PriceRecommendation;
  trust: TrustRecord;
  exception: ExceptionRouting | null;
  decision: DecisionRecord;
  graph: CommercialGraphTrace;
  stages: DemoStage[];
  /** True only when the state machine and the commercial graph both complete. */
  chainComplete: boolean;
  blockers: string[];
}

export interface DemoFacts {
  /** Observed contribution per mission in cents, for pricing/decision realism. */
  contributionPerMissionCents: number | null;
  /** Observed customer charge in cents. */
  customerChargeCents: number | null;
  /** Observed provider entitlement in cents. */
  providerEntitlementCents: number | null;
  /** Transaction ref proving the chain is anchored in the spine. */
  transactionRef: string | null;
  asOf: string | null;
}

const SERVICE_CATEGORY: Record<MissionType, string> = {
  ride: "standard_sedan",
  corporate_ground: "corporate_shuttle",
  airport: "executive_sedan",
  charter: "coach_49",
  air: "light_jet",
  delivery: "motorcycle_parcel",
  logistics: "truck_3t",
  rental: "self_drive_suv",
  leasing: "corporate_lease_sedan",
};

const COMPLIANCE: Record<MissionType, string[]> = {
  ride: ["psv_insurance"],
  corporate_ground: ["psv_insurance"],
  airport: ["psv_insurance"],
  charter: ["psv_licence", "psv_insurance"],
  air: ["aoc", "aircraft_insurance", "airworthiness"],
  delivery: ["rider_insurance"],
  logistics: ["goods_in_transit_insurance"],
  rental: ["comprehensive_insurance"],
  leasing: ["operator_registration"],
};

function candidateFor(type: MissionType, facts: DemoFacts, index: number, degraded = false): SupplyCandidate {
  const kind = ({
    ride: "driver", corporate_ground: "fleet", airport: "driver", charter: "operator",
    air: "aircraft_operator", delivery: "courier", logistics: "carrier",
    rental: "rental_operator", leasing: "lessor",
  } as const)[type];

  return {
    providerId: `${type}-p${index}`,
    providerName: `${type.replace(/_/g, " ")} provider ${index}`,
    kind,
    categories: [SERVICE_CATEGORY[type]],
    compliance: degraded ? [] : COMPLIANCE[type],
    capacity: degraded ? 1 : 60,
    availableForWindow: !degraded,
    distanceKm: 3 + index * 2,
    etaMinutes: 6 + index * 4,
    qualityScore: degraded ? 40 : 88 - index * 5,
    fulfilmentRate: degraded ? 55 : 96 - index * 4,
    acceptanceRate: 90 - index * 5,
    priceCents: facts.customerChargeCents,
    entitlementCents: facts.providerEntitlementCents,
    customerPreferred: index === 1,
  };
}

/** Runs one mission type through the entire Phase 10 architecture. */
export function demonstrateMission(type: MissionType, facts: DemoFacts, programmeId?: string): MissionDemonstration {
  const start = new Date(Date.now() + 3_600_000).toISOString();
  const mission = createMission({
    id: `demo-${type}`,
    type,
    programmeId,
    demand: {
      customerId: "demo-customer",
      customerName: "Demonstration customer",
      segment: type === "corporate_ground" ? "corporate" : type === "logistics" ? "shipper" : "individual",
      accountId: programmeId ? "demo-account" : undefined,
      costCentre: programmeId ? "CC-EXEC" : undefined,
    },
    requirement: {
      origin: "Nairobi CBD",
      destination: type === "rental" || type === "leasing" ? undefined : "Jomo Kenyatta International Airport",
      startAt: start,
      endAt: type === "rental" ? new Date(Date.now() + 4 * 86_400_000).toISOString()
        : type === "leasing" ? new Date(Date.now() + 365 * 86_400_000).toISOString()
        : undefined,
      seats: ["charter", "air", "corporate_ground"].includes(type) ? 12 : type === "ride" || type === "airport" ? 1 : undefined,
      weightKg: type === "logistics" ? 1200 : type === "delivery" ? 4 : undefined,
      serviceCategory: SERVICE_CATEGORY[type],
      slaMinutes: 30,
      compliance: COMPLIANCE[type],
    },
  });

  /* Supply discovery: one feasible set plus one deliberately non-compliant provider. */
  const candidates = [candidateFor(type, facts, 1), candidateFor(type, facts, 2), candidateFor(type, facts, 3, true)];
  const match = matchMission(mission, candidates, DEFAULT_MATCH_POLICY);

  const price = recommendPrice({
    productLine: MISSION_PRODUCT[type],
    market: "Nairobi",
    service: SERVICE_CATEGORY[type],
    window: "peak_am",
    basePriceCents: facts.customerChargeCents,
    demand: 120,
    effectiveSupply: 95,
    distanceKm: 18,
    customerSegment: programmeId ? "enterprise" : "individual",
    providerEntitlementCents: facts.providerEntitlementCents,
    historicalConversion: 62,
    competitorPriceCents: null,
    slaMinutes: 30,
  });

  const chain = runChain(mission);

  const evidence: TrustEvidence[] = [
    { facet: "customer_identity", present: true, source: "profiles" },
    { facet: "provider_identity", present: match.best !== null, source: "drivers / provider registry", detail: match.best?.providerName },
    { facet: "resource_identity", present: match.best !== null, source: "vehicles / aircraft registry" },
    { facet: "compliance", present: match.best !== null, source: "document registry" },
    { facet: "payment", present: facts.transactionRef !== null, source: "commercial_transactions.payment_ref" },
    { facet: "mission_status", present: true, source: "mission state machine" },
    { facet: "location_events", present: false, source: "—", detail: "Location telemetry is not retained for this demonstration mission" },
    { facet: "communication", present: true, source: "notification log" },
    { facet: "incident_history", present: true, source: "trust and safety cases" },
    { facet: "completion_evidence", present: facts.transactionRef !== null, source: "fulfilment record / POD" },
  ];
  const trust = buildTrustRecord(chain.mission, evidence);

  /* One exception is injected deliberately: an architecture is judged on failure. */
  const exceptionInput: ExceptionInput = {
    id: `demo-exc-${type}`,
    kind: type === "logistics" || type === "delivery" ? "late_arrival" : "provider_no_show",
    missionId: mission.id,
    missionType: type,
    productLine: MISSION_PRODUCT[type],
    detectedAt: new Date().toISOString(),
    exposureCents: facts.contributionPerMissionCents,
    customerSegment: programmeId ? "enterprise" : "individual",
    slaBound: true,
    detail: "Injected exception to demonstrate the autopilot routing path",
  };
  const exception = routeException(exceptionInput);

  const decision = recordOutcome(
    buildDecision({
      id: `demo-dec-${type}`,
      agent: "mission_orchestrator",
      signal: `Mission ${mission.id} requires a provider commitment`,
      evidence: [
        { fact: `Feasible providers: ${match.ranked.length}`, source: "universal matching engine", provenance: "LIVE" },
        { fact: facts.contributionPerMissionCents === null ? "Contribution per mission unknown" : `Contribution per mission KES ${(facts.contributionPerMissionCents / 100).toFixed(0)}`, source: "commercial_transactions", provenance: facts.contributionPerMissionCents === null ? "UNAVAILABLE" : "LIVE" },
        { fact: `Trust completeness ${trust.completeness}%`, source: "trust and safety graph", provenance: "LIVE" },
      ],
      recommendation: match.best ? `Commit capacity with ${match.best.providerName}` : "Do not commit — no feasible provider",
      baseConfidence: 80,
      economicImpactCents: facts.contributionPerMissionCents,
      risk: type === "air" ? "high" : "medium",
      action: match.best ? "Issue offer and commit capacity" : "Escalate supply gap to operations",
    }),
    facts.contributionPerMissionCents,
    "Outcome read back from the transaction spine",
  );

  const graphEdges: GraphEdgeState[] = [
    { from: "customer", to: "account", evidenced: true, source: "profiles / corporate_accounts" },
    { from: "account", to: "programme", evidenced: Boolean(programmeId), source: "programme engine", note: programmeId ? undefined : "Mission is not part of a corporate programme" },
    { from: "programme", to: "mission", evidenced: true, source: "mission object" },
    { from: "mission", to: "booking", evidenced: chain.states.includes("booked"), source: "mission state machine" },
    { from: "booking", to: "provider", evidenced: match.best !== null, source: "matching engine" },
    { from: "provider", to: "fulfilment", evidenced: chain.states.includes("completed"), source: "mission state machine" },
    { from: "fulfilment", to: "payment", evidenced: facts.transactionRef !== null, source: "commercial_transactions.payment_ref", note: facts.transactionRef === null ? "No payment reference is linked" : undefined },
    { from: "payment", to: "settlement", evidenced: chain.states.includes("settled"), source: "settlement engine" },
    { from: "settlement", to: "revenue", evidenced: facts.transactionRef !== null, source: "revenue events" },
    { from: "revenue", to: "outcome", evidenced: decision.learning !== undefined, source: "decision fabric learning" },
  ];
  const graph = traceCommercialGraph(facts.transactionRef ?? mission.id, graphEdges);

  const stages: DemoStage[] = [
    { stage: "Customer", detail: mission.demand.customerName, evidenced: true, source: "profiles" },
    { stage: "Programme", detail: programmeId ?? "Not part of a programme", evidenced: Boolean(programmeId), source: "programme engine" },
    { stage: "Mission", detail: `${type} · ${mission.requirement.origin} → ${mission.requirement.destination ?? mission.requirement.endAt ?? "—"}`, evidenced: true, source: "mission object" },
    { stage: "Demand", detail: `Segment ${mission.demand.segment}`, evidenced: true, source: "mission demand" },
    { stage: "Supply discovery", detail: `${candidates.length} candidates discovered`, evidenced: true, source: "supply registry" },
    { stage: "Match", detail: match.best ? `${match.best.providerName} at ${match.best.score}/100` : match.noMatchReason ?? "No match", evidenced: match.best !== null, source: "universal matching engine" },
    { stage: "Quote", detail: price.recommendedPriceCents === null ? "Price not calculable" : `KES ${(price.recommendedPriceCents / 100).toFixed(0)}${price.requiresApproval ? " (approval required)" : ""}`, evidenced: price.recommendedPriceCents !== null, source: "pricing intelligence" },
    { stage: "Approval", detail: decision.approvalRequirement === "none" ? "Executable without approval" : `Requires ${decision.approvalRequirement.replace(/_/g, " ")}`, evidenced: true, source: "decision fabric" },
    { stage: "Capacity commitment", detail: chain.states.includes("capacity_committed") ? "Capacity committed" : "Not applicable to this product machine", evidenced: machineFor(type).includes("capacity_committed") ? chain.states.includes("capacity_committed") : true, source: "mission state machine" },
    { stage: "Booking", detail: chain.states.includes("booked") ? "Booked" : "Not reached", evidenced: chain.states.includes("booked"), source: "mission state machine" },
    { stage: "Orchestration", detail: `${chain.states.length} governed state transitions`, evidenced: chain.rejected.length === 0, source: "mission state machine" },
    { stage: "Live execution", detail: chain.states.includes("in_progress") ? "Executed" : "Not applicable to this product machine", evidenced: machineFor(type).includes("in_progress") ? chain.states.includes("in_progress") : true, source: "mission state machine" },
    { stage: "Exception management", detail: `${exception.exception.kind.replace(/_/g, " ")} → ${exception.mode.replace(/_/g, " ")}`, evidenced: true, source: "exception autopilot" },
    { stage: "Fulfilment", detail: chain.states.includes("completed") ? "Completed" : "Not reached", evidenced: chain.states.includes("completed"), source: "mission state machine" },
    { stage: "Payment", detail: facts.transactionRef ? `Linked to ${facts.transactionRef}` : "No payment reference linked", evidenced: facts.transactionRef !== null, source: "transaction spine" },
    { stage: "Settlement", detail: chain.states.includes("settled") ? "Settled" : "Not reached", evidenced: chain.states.includes("settled"), source: "settlement engine" },
    { stage: "Revenue", detail: facts.contributionPerMissionCents === null ? "Contribution not observed" : `Contribution KES ${(facts.contributionPerMissionCents / 100).toFixed(0)}`, evidenced: facts.contributionPerMissionCents !== null, source: "revenue events" },
    { stage: "Customer outcome", detail: chain.states.includes("rated") ? "Rated" : "Rating not applicable", evidenced: machineFor(type).includes("rated") ? chain.states.includes("rated") : true, source: "mission state machine" },
    { stage: "Learning", detail: decision.learning ?? "No learning recorded", evidenced: decision.learning !== undefined, source: "decision fabric" },
  ];

  const blockers: string[] = [];
  if (chain.rejected.length > 0) blockers.push(...chain.rejected);
  if (!match.best) blockers.push(match.noMatchReason ?? "No feasible provider");
  if (!trust.closureAllowed) blockers.push(trust.narrative);
  if (graph.brokenAt) blockers.push(graph.narrative);

  return {
    missionType: type,
    mission: chain.mission,
    machine: machineFor(type),
    statesExecuted: chain.states,
    match,
    price,
    trust,
    exception,
    decision,
    graph,
    stages,
    chainComplete: chain.rejected.length === 0 && graph.brokenAt === null && trust.closureAllowed,
    blockers,
  };
}

export const DEMONSTRATION_TYPES: MissionType[] = [
  "corporate_ground", "ride", "delivery", "charter", "air", "rental", "leasing", "logistics", "airport",
];

/** Runs the demonstration for every product line. */
export function demonstrateAllProducts(facts: DemoFacts): MissionDemonstration[] {
  return DEMONSTRATION_TYPES.map((type) =>
    demonstrateMission(type, facts, type === "corporate_ground" ? "demo-programme" : undefined),
  );
}
