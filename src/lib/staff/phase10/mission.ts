/**
 * Phase 10 §10.1–10.2 — the Yalla Platform Operating Model and the universal
 * Mission Object.
 *
 * Yalla is modelled as a platform that coordinates independent demand and
 * independent supply — never as a transport company owning the underlying
 * asset. The Mission is the customer's intended mobility or logistics outcome,
 * and it is the single object every product line shares. Nine services, one
 * object; the state machine and matching rules vary, the spine does not.
 */

export const MISSION_TYPES = [
  "ride",
  "corporate_ground",
  "airport",
  "charter",
  "air",
  "delivery",
  "logistics",
  "rental",
  "leasing",
] as const;
export type MissionType = (typeof MISSION_TYPES)[number];

export const PRODUCT_LINES = [
  "individual_mobility",
  "corporate_mobility",
  "charter",
  "yalla_air",
  "delivery_logistics",
  "rentals",
  "leasing",
] as const;
export type ProductLine = (typeof PRODUCT_LINES)[number];

export const MISSION_PRODUCT: Record<MissionType, ProductLine> = {
  ride: "individual_mobility",
  corporate_ground: "corporate_mobility",
  airport: "individual_mobility",
  charter: "charter",
  air: "yalla_air",
  delivery: "delivery_logistics",
  logistics: "delivery_logistics",
  rental: "rentals",
  leasing: "leasing",
};

export const MISSION_LABEL: Record<MissionType, string> = {
  ride: "Ride mission",
  corporate_ground: "Corporate ground mission",
  airport: "Airport mission",
  charter: "Charter mission",
  air: "Yalla Air mission",
  delivery: "Delivery mission",
  logistics: "Logistics mission",
  rental: "Rental mission",
  leasing: "Leasing mission",
};

/** Who the demand is. The platform never assumes a segment. */
export type DemandSegment = "individual" | "employee" | "corporate" | "business" | "traveller" | "shipper";

/** What supply must be to be feasible. Platform-side, not asset-side. */
export type SupplyKind =
  | "driver"
  | "operator"
  | "fleet"
  | "courier"
  | "carrier"
  | "aircraft_operator"
  | "rental_operator"
  | "lessor";

export const MISSION_SUPPLY: Record<MissionType, SupplyKind[]> = {
  ride: ["driver", "fleet"],
  corporate_ground: ["driver", "fleet", "operator"],
  airport: ["driver", "fleet", "operator"],
  charter: ["operator", "fleet"],
  air: ["aircraft_operator"],
  delivery: ["courier", "driver"],
  logistics: ["carrier", "fleet"],
  rental: ["rental_operator", "fleet"],
  leasing: ["lessor", "operator"],
};

export interface MissionDemand {
  customerId: string;
  customerName: string;
  segment: DemandSegment;
  /** Corporate account, when the demand is enterprise. */
  accountId?: string;
  costCentre?: string;
}

export interface MissionRequirement {
  origin: string;
  destination?: string;
  /** ISO start of the service window. */
  startAt: string;
  /** ISO end — required for rental, leasing and multi-day charter. */
  endAt?: string;
  seats?: number;
  weightKg?: number;
  /** Free-form service category used by matching, e.g. "executive_sedan". */
  serviceCategory: string;
  slaMinutes?: number;
  /** Compliance credentials supply must hold, e.g. "psv_licence", "aoc". */
  compliance: string[];
  notes?: string;
}

export interface MissionEconomics {
  currency: string;
  customerChargeCents: number | null;
  partnerEntitlementCents: number | null;
  platformRevenueCents: number | null;
  contributionCents: number | null;
}

export interface MissionEvent {
  at: string;
  state: string;
  actor: string;
  note?: string;
}

export interface Mission {
  id: string;
  type: MissionType;
  product: ProductLine;
  supplyKinds: SupplyKind[];
  state: string;
  demand: MissionDemand;
  requirement: MissionRequirement;
  /** Programme this mission belongs to, when part of a corporate programme. */
  programmeId?: string;
  providerId?: string;
  economics?: MissionEconomics;
  /** Transaction spine reference — the mission never holds its own money truth. */
  transactionRef?: string;
  events: MissionEvent[];
}

export interface MissionInput {
  id: string;
  type: MissionType;
  demand: MissionDemand;
  requirement: MissionRequirement;
  programmeId?: string;
  actor?: string;
  at?: string;
}

export function createMission(input: MissionInput): Mission {
  const at = input.at ?? new Date().toISOString();
  return {
    id: input.id,
    type: input.type,
    product: MISSION_PRODUCT[input.type],
    supplyKinds: MISSION_SUPPLY[input.type],
    state: "intent",
    demand: input.demand,
    requirement: input.requirement,
    programmeId: input.programmeId,
    events: [{ at, state: "intent", actor: input.actor ?? "platform", note: "Mission intent captured" }],
  };
}

/** Requirements a mission type cannot be orchestrated without. */
const REQUIRED_FIELDS: Record<MissionType, (keyof MissionRequirement)[]> = {
  ride: ["origin", "destination", "startAt"],
  corporate_ground: ["origin", "destination", "startAt", "seats"],
  airport: ["origin", "destination", "startAt"],
  charter: ["origin", "destination", "startAt", "seats"],
  air: ["origin", "destination", "startAt", "seats"],
  delivery: ["origin", "destination", "startAt"],
  logistics: ["origin", "destination", "startAt", "weightKg"],
  rental: ["origin", "startAt", "endAt"],
  leasing: ["origin", "startAt", "endAt"],
};

/** Compliance credentials Yalla will not orchestrate a mission without. */
const REQUIRED_COMPLIANCE: Partial<Record<MissionType, string[]>> = {
  charter: ["psv_licence", "psv_insurance"],
  air: ["aoc", "aircraft_insurance", "airworthiness"],
  corporate_ground: ["psv_insurance"],
  logistics: ["goods_in_transit_insurance"],
  leasing: ["operator_registration"],
};

export interface MissionGap {
  field: string;
  reason: string;
}

/** Everything preventing this mission from entering the orchestration pathway. */
export function missionGaps(mission: Mission): MissionGap[] {
  const gaps: MissionGap[] = [];
  for (const field of REQUIRED_FIELDS[mission.type]) {
    const value = mission.requirement[field];
    if (value === undefined || value === null || value === "") {
      gaps.push({ field, reason: `${MISSION_LABEL[mission.type]} cannot be matched without ${String(field)}` });
    }
  }
  for (const credential of REQUIRED_COMPLIANCE[mission.type] ?? []) {
    if (!mission.requirement.compliance.includes(credential)) {
      gaps.push({ field: `compliance.${credential}`, reason: `${credential} must be demanded of supply for this mission type` });
    }
  }
  return gaps;
}

export function isOrchestratable(mission: Mission): boolean {
  return missionGaps(mission).length === 0;
}

export function appendMissionEvent(mission: Mission, event: MissionEvent): Mission {
  return { ...mission, state: event.state, events: [...mission.events, event] };
}
