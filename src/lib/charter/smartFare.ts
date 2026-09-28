/**
 * TaxiD SmartFare™ v2.0 — mission-centric charter pricing engine.
 *
 * Replaces hourly-rate-first quoting with a deterministic, layered mission
 * price. Every layer is exposed to the customer, every saving is explained,
 * and the engine never prices below the sustainable operating floor: the
 * competitive advantage comes from utilisation and lean platform fees, not
 * from selling below cost.
 *
 * Pure functions + a versioned local config store. No React, no fetch, so the
 * marketplace, booking workflow and admin console price identically.
 */
import { airportByCode, toAirPoint, type AirportRecord, type AirportType } from "./airportRegistry";
import { distanceNm } from "./aviationPricing";
import { resolveOperatorInputs, type OperatorMissionInputs } from "./operatorRateCards";

/** Where a cost layer's value came from — surfaced in the provenance panel. */
export type FareSource =
  | "operator_rate_card"
  | "operator_confirmed"
  | "airport_tariff"
  | "platform_estimate"
  | "customer_selected";

export type CustomerSegment = "government" | "ngo" | "corporate" | "agency" | "retail";

export const CUSTOMER_SEGMENTS: { key: CustomerSegment; label: string; note: string }[] = [
  { key: "government", label: "Government", note: "Public procurement framework" },
  { key: "ngo", label: "NGO / UN", note: "Humanitarian & development missions" },
  { key: "corporate", label: "Corporate", note: "Framework contract accounts" },
  { key: "agency", label: "Travel agency", note: "Trade partner rate" },
  { key: "retail", label: "Retail", note: "Individual travellers" },
];

/* ------------------------------------------------------------------ */
/* Fleet — indicative "From" mission rates (KES per flight hour input) */
/* ------------------------------------------------------------------ */

export type AircraftClass = "piston" | "turboprop" | "jet" | "helicopter";

export interface SmartFareAircraft {
  key: string;
  label: string;
  /** Indicative starting rate, KES/flight-hour. Never shown as "per hour". */
  fromRateKes: number;
  cruiseKts: number;
  seats: number;
  taxiMinutes: number;
  aircraftClass: AircraftClass;
  /** Estimated CO₂e, kg per flight hour. */
  carbonKgPerHour: number;
  /** Typical repositioning ratio applied to block time when no empty leg matches. */
  positioningRatio: number;
  /** Minimum runway required, metres (0 = helipad capable). */
  runwayM: number;
  tier: "Entry" | "Value" | "Competitive" | "Premium Value" | "Premium" | "Ultra Premium";
}

export const SMARTFARE_FLEET: SmartFareAircraft[] = [
  { key: "cessna_206", label: "Cessna 206", fromRateKes: 70000, cruiseKts: 140, seats: 5, taxiMinutes: 12, aircraftClass: "piston", carbonKgPerHour: 190, positioningRatio: 0.3, runwayM: 700, tier: "Entry" },
  { key: "caravan_208b", label: "Cessna Caravan 208B", fromRateKes: 115000, cruiseKts: 175, seats: 12, taxiMinutes: 12, aircraftClass: "turboprop", carbonKgPerHour: 420, positioningRatio: 0.3, runwayM: 900, tier: "Value" },
  { key: "king_air_200", label: "King Air 200", fromRateKes: 170000, cruiseKts: 270, seats: 8, taxiMinutes: 14, aircraftClass: "turboprop", carbonKgPerHour: 620, positioningRatio: 0.32, runwayM: 1100, tier: "Value" },
  { key: "king_air_350", label: "King Air 350", fromRateKes: 220000, cruiseKts: 300, seats: 9, taxiMinutes: 14, aircraftClass: "turboprop", carbonKgPerHour: 690, positioningRatio: 0.32, runwayM: 1200, tier: "Competitive" },
  { key: "pc12", label: "Pilatus PC-12", fromRateKes: 250000, cruiseKts: 280, seats: 8, taxiMinutes: 13, aircraftClass: "turboprop", carbonKgPerHour: 560, positioningRatio: 0.3, runwayM: 800, tier: "Competitive" },
  { key: "hondajet", label: "HondaJet Elite II", fromRateKes: 300000, cruiseKts: 380, seats: 5, taxiMinutes: 15, aircraftClass: "jet", carbonKgPerHour: 780, positioningRatio: 0.35, runwayM: 1200, tier: "Competitive" },
  { key: "cj3", label: "Citation CJ3/CJ4", fromRateKes: 350000, cruiseKts: 415, seats: 7, taxiMinutes: 15, aircraftClass: "jet", carbonKgPerHour: 950, positioningRatio: 0.35, runwayM: 1300, tier: "Competitive" },
  { key: "latitude", label: "Citation Latitude", fromRateKes: 500000, cruiseKts: 440, seats: 9, taxiMinutes: 15, aircraftClass: "jet", carbonKgPerHour: 1250, positioningRatio: 0.35, runwayM: 1400, tier: "Premium Value" },
  { key: "challenger_350", label: "Challenger 350", fromRateKes: 600000, cruiseKts: 470, seats: 10, taxiMinutes: 16, aircraftClass: "jet", carbonKgPerHour: 1520, positioningRatio: 0.36, runwayM: 1500, tier: "Premium" },
  { key: "challenger_650", label: "Challenger 650", fromRateKes: 750000, cruiseKts: 480, seats: 12, taxiMinutes: 17, aircraftClass: "jet", carbonKgPerHour: 1780, positioningRatio: 0.36, runwayM: 1700, tier: "Premium" },
  { key: "g650", label: "Gulfstream G650", fromRateKes: 1200000, cruiseKts: 516, seats: 14, taxiMinutes: 18, aircraftClass: "jet", carbonKgPerHour: 2300, positioningRatio: 0.38, runwayM: 1800, tier: "Ultra Premium" },
  { key: "h125", label: "Airbus H125", fromRateKes: 150000, cruiseKts: 120, seats: 5, taxiMinutes: 8, aircraftClass: "helicopter", carbonKgPerHour: 430, positioningRatio: 0.25, runwayM: 0, tier: "Competitive" },
  { key: "bell_407", label: "Bell 407", fromRateKes: 180000, cruiseKts: 125, seats: 6, taxiMinutes: 8, aircraftClass: "helicopter", carbonKgPerHour: 460, positioningRatio: 0.25, runwayM: 0, tier: "Competitive" },
  { key: "bell_429", label: "Bell 429", fromRateKes: 200000, cruiseKts: 135, seats: 7, taxiMinutes: 8, aircraftClass: "helicopter", carbonKgPerHour: 520, positioningRatio: 0.25, runwayM: 0, tier: "Premium Value" },
  { key: "h145", label: "Airbus H145", fromRateKes: 250000, cruiseKts: 130, seats: 9, taxiMinutes: 9, aircraftClass: "helicopter", carbonKgPerHour: 640, positioningRatio: 0.25, runwayM: 0, tier: "Premium" },
];

export const smartFareAircraft = (key: string): SmartFareAircraft =>
  SMARTFARE_FLEET.find((a) => a.key === key) ?? SMARTFARE_FLEET[1];

/* ------------------------------------------------------------------ */
/* Configuration (admin-editable, no code changes required)            */
/* ------------------------------------------------------------------ */

export interface SmartFareConfig {
  /** Fixed mission handling / dispatch fee, KES. */
  missionBaseFee: number;
  /** Lean marketplace fee by segment, % of operator mission cost. */
  platformFeePct: Record<CustomerSegment, number>;
  /** Negotiated framework discount by segment, % of mission cost. */
  contractDiscountPct: Record<CustomerSegment, number>;
  /** Advance-booking tiers, applied on the earliest matching threshold. */
  advanceTiers: { minDaysAhead: number; pct: number }[];
  emptyLegDiscountPct: number;
  emptyLegMaxDiscountPct: number;
  sharedMissionDiscountPct: number;
  flexibleWindowDiscountPct: number;
  nearbyAirportDiscountPct: number;
  /** Fuel adjustment applied to flight-time cost, % (may be negative). */
  fuelAdjustmentPct: number;
  /** Navigation charge, KES per nautical mile flown. */
  navPerNm: number;
  /** Ground handling, KES per turn by airport class. */
  groundHandling: Record<AirportType, number>;
  /** Landing + parking, KES per movement by airport class. */
  landingFee: Record<AirportType, number>;
  passengerCharge: number;
  internationalClearance: number;
  crewDayRate: number;
  crewOvernight: number;
  /** Share of the flight-time cost that is unavoidable direct operating cost. */
  operatingFloorPct: number;
  vatPct: number;
}

const feeMap = (g: number, n: number, c: number, a: number, r: number): Record<CustomerSegment, number> =>
  ({ government: g, ngo: n, corporate: c, agency: a, retail: r });

export const DEFAULT_SMARTFARE_CONFIG: SmartFareConfig = {
  missionBaseFee: 18000,
  platformFeePct: feeMap(6, 6, 9, 9, 12),
  contractDiscountPct: feeMap(6, 6, 4, 3, 0),
  advanceTiers: [
    { minDaysAhead: 45, pct: 6 },
    { minDaysAhead: 21, pct: 4 },
    { minDaysAhead: 10, pct: 2 },
  ],
  emptyLegDiscountPct: 35,
  emptyLegMaxDiscountPct: 60,
  sharedMissionDiscountPct: 18,
  flexibleWindowDiscountPct: 7,
  nearbyAirportDiscountPct: 5,
  fuelAdjustmentPct: 0,
  navPerNm: 190,
  groundHandling: { international: 46000, domestic: 26000, private: 22000, airstrip: 18000, helipad: 12000 },
  landingFee: { international: 38000, domestic: 18000, private: 15000, airstrip: 12000, helipad: 7000 },
  passengerCharge: 2600,
  internationalClearance: 31000,
  crewDayRate: 34000,
  crewOvernight: 19000,
  operatingFloorPct: 72,
  vatPct: 16,
};

const CONFIG_KEY = "yalla.smartfare.config.v2";

export interface SmartFareConfigVersion {
  version: number;
  savedAt: string;
  actor: string;
  note: string;
  config: SmartFareConfig;
}

function readVersions(): SmartFareConfigVersion[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    const parsed = raw ? (JSON.parse(raw) as SmartFareConfigVersion[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export const loadSmartFareVersions = (): SmartFareConfigVersion[] => readVersions();

export function activeSmartFareConfig(): SmartFareConfig {
  const versions = readVersions();
  const latest = versions[versions.length - 1]?.config;
  return latest ? { ...DEFAULT_SMARTFARE_CONFIG, ...latest } : { ...DEFAULT_SMARTFARE_CONFIG };
}

export function saveSmartFareConfig(
  config: SmartFareConfig,
  meta: { actor: string; note?: string },
): SmartFareConfigVersion {
  const versions = readVersions();
  const entry: SmartFareConfigVersion = {
    version: (versions[versions.length - 1]?.version ?? 0) + 1,
    savedAt: new Date().toISOString(),
    actor: meta.actor,
    note: meta.note ?? "",
    config,
  };
  const next = [...versions, entry].slice(-30);
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable — pricing continues from defaults */
  }
  return entry;
}

export function resetSmartFareConfig() {
  try {
    localStorage.removeItem(CONFIG_KEY);
  } catch {
    /* noop */
  }
}

/* ------------------------------------------------------------------ */
/* Mission pricing                                                     */
/* ------------------------------------------------------------------ */

export interface MissionInput {
  aircraftKey: string;
  fromCode: string;
  toCode: string;
  passengers: number;
  roundTrip?: boolean;
  /** ISO date of departure — drives the advance-booking discount. */
  departureDate?: string | null;
  segment?: CustomerSegment;
  /** Customer accepts a ±2h departure window. */
  flexibleDeparture?: boolean;
  /** An operator repositioning leg matches this mission. */
  emptyLegMatch?: boolean;
  /** Mission is aggregated with another compatible booking. */
  sharedMission?: boolean;
  /** A nearby airfield removes positioning distance. */
  nearbyAirportOptimised?: boolean;
  /** Nights the aircraft and crew stay away from base. */
  overnights?: number;
  optionalServices?: { label: string; amount: number }[];
  /** Evaluate against a specific config (defaults to the active one). */
  config?: SmartFareConfig;
  /** Reference date for advance-booking tiers (tests inject this). */
  now?: Date;
  /**
   * Operator-submitted mission cost components. Every component supplied here
   * replaces the corresponding platform estimate, so a fully populated card
   * plus confirmed availability produces an operator-calculated mission price.
   * Pass `null` to force platform estimates.
   */
  operator?: OperatorMissionInputs | null;
  /** Resolve a rate card automatically from the store when none is passed. */
  autoResolveOperator?: boolean;
}

export interface FareLine {
  key: string;
  label: string;
  amount: number;
  detail?: string;
  /** Provenance of this layer. Defaults to a platform estimate. */
  source?: FareSource;
}

/**
 * Commercial status of an optimisation.
 *   `applied`   — evidence supports it, so it reduces the mission price.
 *   `potential` — modelled opportunity only; informational, never deducted.
 */
export type SavingStatus = "applied" | "potential";

export interface SavingLine {
  key: string;
  label: string;
  amount: number;
  explanation: string;
  status: SavingStatus;
  /** True when only operator confirmation can promote this to `applied`. */
  requiresOperatorConfirmation: boolean;
}

/**
 * Four independent evidence dimensions. One score must never imply another:
 * a mission can be perfectly feasible (operational) and completely
 * unconfirmed commercially.
 */
export interface EvidenceScores {
  /** 0–100 share of priced value sourced from an operator submission. */
  pricingCompleteness: number;
  /** 0–100 route/aircraft/airfield feasibility of the mission as specified. */
  operationalReadiness: number;
  /** 0–100 strength of operator commercial confirmation (card, route, availability). */
  commercialConfirmation: number;
  /** 0–100 overall evidence confidence behind the displayed price. */
  evidenceConfidence: number;
}

export interface MissionFare {
  indicative: true;
  currency: "KES";
  from: AirportRecord | null;
  to: AirportRecord | null;
  aircraft: SmartFareAircraft;
  segment: CustomerSegment;
  distanceNm: number;
  /** Estimated block hours (model-derived) unless the operator confirmed them. */
  blockHours: number;
  /** True when block time came from an operator-confirmed submission. */
  blockHoursConfirmed: boolean;
  positioningHours: number;
  sectors: number;
  carbonKg: number;
  costLines: FareLine[];
  /** Savings actually deducted from the price (evidence-backed only). */
  savings: SavingLine[];
  /** Modelled opportunities that are NOT deducted — informational only. */
  potentialSavings: SavingLine[];
  potentialSavingsTotal: number;
  grossMissionCost: number;
  totalSavings: number;
  /** Sustainable operating floor — the price never drops below this. */
  operatingFloor: number;
  floorApplied: boolean;
  operatorMissionCost: number;
  platformFeePct: number;
  platformFee: number;
  vat: number;
  total: number;
  perSeat: number;
  /** 0–100 evidence-derived readiness score (never hard-coded). */
  readinessScore: number;
  evidence: EvidenceScores;
  confidence: "indicative" | "high-confidence";
  /**
   * `operator_calculated` = every priced layer came from a submitted rate card
   * and availability was confirmed. Anything else is an indicative "From" price.
   */
  priceBasis: "operator_calculated" | "operator_partial" | "platform_indicative";
  /** The rate card used, when one applied. */
  operator: OperatorMissionInputs | null;
  notes: string[];
  /** Passengers priced. */
  passengers: number;
  /**
   * Serialisable copy of the mission inputs. Stored on the audit record so a
   * quote can be replayed byte-for-byte for support and verification.
   */
  replayInput: ReplayInput;
}


/** Mission inputs that fully determine a price, minus injected config/clock. */
export interface ReplayInput {
  aircraftKey: string;
  fromCode: string;
  toCode: string;
  passengers: number;
  roundTrip: boolean;
  departureDate: string | null;
  segment: CustomerSegment;
  flexibleDeparture: boolean;
  emptyLegMatch: boolean;
  sharedMission: boolean;
  nearbyAirportOptimised: boolean;
  overnights: number;
  optionalServices: { label: string; amount: number }[];
}

const round = (n: number) => Math.round(n);

function movementCost(cfg: SmartFareConfig, port: AirportRecord | null, pax: number, sectors: number) {
  const type: AirportType = port?.type ?? "domestic";
  const landing = cfg.landingFee[type] * sectors;
  const handling = cfg.groundHandling[type] * sectors;
  const paxCharge = cfg.passengerCharge * pax * sectors;
  return { landing, handling, paxCharge, international: port?.customs ? cfg.internationalClearance * sectors : 0 };
}

function advanceDiscountPct(cfg: SmartFareConfig, departure?: string | null, now = new Date()) {
  if (!departure) return 0;
  const days = (new Date(departure).getTime() - now.getTime()) / 86_400_000;
  if (!Number.isFinite(days)) return 0;
  const tier = cfg.advanceTiers.slice().sort((a, b) => b.minDaysAhead - a.minDaysAhead)
    .find((t) => days >= t.minDaysAhead);
  return tier?.pct ?? 0;
}

export function computeMissionFare(input: MissionInput): MissionFare {
  const cfg = input.config ?? activeSmartFareConfig();
  const aircraft = smartFareAircraft(input.aircraftKey);
  const from = airportByCode(input.fromCode);
  const to = airportByCode(input.toCode);
  const segment = input.segment ?? "retail";
  const pax = Math.max(1, input.passengers || 1);
  const sectors = input.roundTrip ? 2 : 1;

  const nm = from && to ? distanceNm(toAirPoint(from), toAirPoint(to)) : 0;
  const legHours = nm / aircraft.cruiseKts + aircraft.taxiMinutes / 60;
  const blockHours = legHours * sectors;

  const operator = input.operator !== undefined
    ? input.operator
    : input.autoResolveOperator
      ? resolveOperatorInputs({ aircraftKey: aircraft.key, fromCode: input.fromCode, toCode: input.toCode, now: input.now })
      : null;

  /** Operator commercially confirmed the asset for this mission window. */
  const operatorConfirmed = Boolean(operator?.availabilityConfirmed);
  /**
   * A customer-selected empty-leg match is only a *candidate* until the
   * operator declares the repositioning leg AND confirms availability. Until
   * then positioning cost stays in the price.
   */
  const emptyLegConfirmed = Boolean(input.emptyLegMatch && operator?.emptyLegAvailable && operatorConfirmed);
  const positioningHours = emptyLegConfirmed ? 0 : legHours * aircraft.positioningRatio;


  /** Prefer an operator-submitted component over the platform estimate. */
  const pick = (submitted: number | null | undefined, estimate: number): [number, FareSource] =>
    typeof submitted === "number" && submitted > 0
      ? [submitted, operator?.availabilityConfirmed ? "operator_confirmed" : "operator_rate_card"]
      : [estimate, "platform_estimate"];

  const [hourlyRate, flightSource] = pick(operator?.hourlyRateKes, aircraft.fromRateKes);
  const flightTimeCost = hourlyRate * blockHours * (1 + cfg.fuelAdjustmentPct / 100);
  const [positioningRate] = pick(operator?.positioningRateKes, hourlyRate);
  const estimatedPositioningCost = positioningRate * positioningHours;
  const dep = movementCost(cfg, from, pax, sectors);
  const arr = movementCost(cfg, to, pax, sectors);
  const estimatedAirportCharges = dep.landing + arr.landing + dep.paxCharge + arr.paxCharge + dep.international + arr.international;
  const estimatedHandling = dep.handling + arr.handling;
  const overnights = Math.max(0, input.overnights ?? 0);
  const estimatedCrew = cfg.crewDayRate * Math.max(1, Math.ceil(blockHours / 6)) + cfg.crewOvernight * overnights;

  const [baseFee, baseSource] = pick(operator?.missionBaseFeeKes, cfg.missionBaseFee);
  const [positioningCost, positioningSource] = pick(operator?.positioningRateKes ? operator.positioningRateKes * positioningHours : null, estimatedPositioningCost);
  const [airportCharges, airportSourceRaw] = pick(operator?.airportChargesKes, estimatedAirportCharges);
  const airportSource: FareSource = airportSourceRaw === "platform_estimate" ? "airport_tariff" : airportSourceRaw;
  const [handling, handlingSource] = pick(operator?.handlingKes, estimatedHandling);
  const [navigation, navigationSourceRaw] = pick(operator?.navigationKes, cfg.navPerNm * nm * sectors);
  const navigationSource: FareSource = navigationSourceRaw === "platform_estimate" ? "airport_tariff" : navigationSourceRaw;
  const [crew, crewSource] = pick(operator?.crewKes, estimatedCrew);
  const optional = (input.optionalServices ?? []).reduce((s, o) => s + Math.max(0, o.amount), 0);

  const costLines: FareLine[] = [
    { key: "base", label: "Mission base fee", amount: round(baseFee), detail: "Dispatch, flight planning, mission control", source: baseSource },
    {
      key: "flight",
      label: flightSource === "operator_confirmed" ? "Flight time (operator-confirmed block)" : "Flight time (estimated block)",
      amount: round(flightTimeCost),
      detail: `${blockHours.toFixed(2)} ${flightSource === "operator_confirmed" ? "confirmed" : "estimated"} block hours · ${aircraft.label}`,
      source: flightSource,
    },
    { key: "positioning", label: "Aircraft positioning", amount: round(positioningCost), detail: emptyLegConfirmed ? "Removed — operator-confirmed repositioning leg" : `${positioningHours.toFixed(2)} h${input.emptyLegMatch ? " · empty-leg match not operator-confirmed" : ""}`, source: positioningSource },
    { key: "airport", label: "Airport charges", amount: round(airportCharges), detail: "Landing, parking, passenger & clearance", source: airportSource },
    { key: "handling", label: "Ground handling", amount: round(handling), detail: `${sectors} turn${sectors > 1 ? "s" : ""}`, source: handlingSource },
    { key: "navigation", label: "Navigation charges", amount: round(navigation), detail: `${round(nm * sectors)} nm flown`, source: navigationSource },
    { key: "crew", label: "Crew costs", amount: round(crew), detail: overnights ? `${overnights} night(s) away from base` : "Single-day crew duty", source: crewSource },
    { key: "optional", label: "Optional services", amount: round(optional), detail: (input.optionalServices ?? []).map((o) => o.label).join(", ") || "None selected", source: "customer_selected" },
  ];

  const grossMissionCost = costLines.reduce((s, l) => s + l.amount, 0);
  const optimisable = round(flightTimeCost + positioningCost);

  const savings: SavingLine[] = [];
  const potentialSavings: SavingLine[] = [];
  /**
   * `confirmed` decides the commercial status. An optimisation that needs
   * operator evidence and does not have it is recorded as a potential
   * opportunity and is never deducted from the price.
   */
  const add = (
    key: string,
    label: string,
    pct: number,
    base: number,
    explanation: string,
    opts: { requiresOperatorConfirmation: boolean; confirmed: boolean } = { requiresOperatorConfirmation: false, confirmed: true },
  ) => {
    const amount = round((base * pct) / 100);
    if (amount <= 0) return;
    const applied = !opts.requiresOperatorConfirmation || opts.confirmed;
    const line: SavingLine = {
      key,
      label,
      amount,
      explanation: applied
        ? explanation
        : `${explanation} Potential only — not deducted until the operator confirms it.`,
      status: applied ? "applied" : "potential",
      requiresOperatorConfirmation: opts.requiresOperatorConfirmation,
    };
    (applied ? savings : potentialSavings).push(line);
  };

  if (input.emptyLegMatch) {
    const pct = Math.min(cfg.emptyLegDiscountPct, cfg.emptyLegMaxDiscountPct);
    add("empty_leg", "Empty-leg match discount", pct, optimisable,
      "Your booking matches an existing repositioning flight, so the operator no longer flies that sector empty.",
      { requiresOperatorConfirmation: true, confirmed: emptyLegConfirmed });
  }
  if (input.sharedMission) {
    add("shared", "Shared mission savings", cfg.sharedMissionDiscountPct, optimisable,
      "Compatible demand was aggregated onto the same aircraft rotation.",
      { requiresOperatorConfirmation: true, confirmed: operatorConfirmed });
  }
  if (input.flexibleDeparture) {
    add("flexible", "Flexible departure savings", cfg.flexibleWindowDiscountPct, optimisable,
      "A flexible departure window lets the operator slot this mission into an efficient rotation.",
      { requiresOperatorConfirmation: true, confirmed: operatorConfirmed });
  }
  if (input.nearbyAirportOptimised) {
    add("nearby", "Nearby airport optimisation", cfg.nearbyAirportDiscountPct, optimisable,
      "An alternative airfield closer to the aircraft's base reduces positioning cost.",
      { requiresOperatorConfirmation: true, confirmed: operatorConfirmed });
  }
  const contractPct = cfg.contractDiscountPct[segment] ?? 0;
  if (contractPct > 0) {
    add("contract", `${CUSTOMER_SEGMENTS.find((s) => s.key === segment)?.label} framework discount`, contractPct, grossMissionCost,
      "Negotiated framework rate applied automatically to this account type.");
  }
  const advPct = advanceDiscountPct(cfg, input.departureDate, input.now);
  if (advPct > 0) {
    add("advance", "Advance booking discount", advPct, grossMissionCost,
      "Booking ahead improves fleet planning; the efficiency is passed back to you.");
  }

  const totalSavings = savings.reduce((s, l) => s + l.amount, 0);
  const potentialSavingsTotal = potentialSavings.reduce((s, l) => s + l.amount, 0);
  const operatingFloor = round(
    (flightTimeCost * cfg.operatingFloorPct) / 100 + airportCharges + handling + navigation + crew + optional,
  );
  const discounted = grossMissionCost - totalSavings;
  const floorApplied = discounted < operatingFloor;
  const operatorMissionCost = round(Math.max(discounted, operatingFloor));

  const platformFeePct = cfg.platformFeePct[segment] ?? cfg.platformFeePct.retail;
  const platformFee = round((operatorMissionCost * platformFeePct) / 100);
  const vat = round(((operatorMissionCost + platformFee) * cfg.vatPct) / 100);
  const total = operatorMissionCost + platformFee + vat;

  const runwayOk = !to || to.runwayM >= aircraft.runwayM;
  const seatsOk = pax <= aircraft.seats;

  const pricedSources = costLines.filter((l) => l.amount > 0 && l.key !== "optional").map((l) => l.source);
  const operatorPriced = pricedSources.filter((s) => s === "operator_rate_card" || s === "operator_confirmed").length;
  const priceBasis: MissionFare["priceBasis"] =
    operatorConfirmed && operatorPriced === pricedSources.length && pricedSources.length > 0
      ? "operator_calculated"
      : operatorPriced > 0
        ? "operator_partial"
        : "platform_indicative";

  /* ---- evidence dimensions (derived, never hard-coded) ---- */
  const pricedLines = costLines.filter((l) => l.amount > 0 && l.key !== "optional");
  const pricedValue = pricedLines.reduce((s, l) => s + l.amount, 0);
  const operatorValue = pricedLines
    .filter((l) => l.source === "operator_rate_card" || l.source === "operator_confirmed")
    .reduce((s, l) => s + l.amount, 0);
  const pricingCompleteness = pricedValue > 0 ? Math.round((operatorValue / pricedValue) * 100) : 0;

  const operationalReadiness = Math.max(
    0,
    Math.min(100,
      55 + (from && to ? 15 : 0) + (seatsOk ? 12 : -25) + (runwayOk ? 10 : -30) +
      (to?.fuel ? 4 : 0) + (to?.nightOps ? 4 : 0)),
  );

  const routeScoped = Boolean(operator?.fromCode && operator?.toCode);
  const routeMatch = routeScoped && operator?.fromCode === from?.code && operator?.toCode === to?.code;
  const commercialConfirmation = Math.min(100, Math.max(0,
    (operator ? 35 : 0) + (operatorConfirmed ? 45 : 0) + (routeMatch ? 20 : 0)));

  const evidence: EvidenceScores = {
    pricingCompleteness,
    operationalReadiness,
    commercialConfirmation,
    evidenceConfidence: Math.round((pricingCompleteness + commercialConfirmation) / 2),
  };

  // Readiness is the evidence-weighted blend: operational feasibility alone can
  // never produce a high readiness score without commercial evidence.
  const readinessScore = Math.round(
    operationalReadiness * 0.4 + commercialConfirmation * 0.35 + pricingCompleteness * 0.25,
  );

  const notes: string[] = [
    priceBasis === "operator_calculated"
      ? "Calculated from the operator's submitted rate card and confirmed availability."
      : "TaxiD SmartFare™ indicative mission price — not a confirmed operator quotation.",
  ];
  if (!seatsOk) notes.push(`${aircraft.label} seats ${aircraft.seats}; ${pax} passengers requested.`);
  if (!runwayOk) notes.push(`${to?.name ?? "Destination"} runway is shorter than the ${aircraft.label} requirement.`);
  if (floorApplied) notes.push("Discounts were capped at the sustainable operating floor — TaxiD never prices below cost.");
  if (potentialSavings.length) {
    notes.push(
      `${potentialSavings.length} optimisation${potentialSavings.length === 1 ? "" : "s"} worth ${round(potentialSavingsTotal)} KES are potential only — operator confirmation is required before any of it is deducted.`,
    );
  }
  if (pricingCompleteness === 0) {
    notes.push("0% of this price is operator-sourced — every layer is a TaxiD estimate or published tariff.");
  }


  return {
    indicative: true,
    currency: "KES",
    from, to, aircraft, segment,
    distanceNm: round(nm),
    blockHours: Number(blockHours.toFixed(2)),
    blockHoursConfirmed: flightSource === "operator_confirmed",
    positioningHours: Number(positioningHours.toFixed(2)),
    sectors,
    carbonKg: round((blockHours + positioningHours) * aircraft.carbonKgPerHour),
    costLines,
    savings,
    potentialSavings,
    potentialSavingsTotal: round(potentialSavingsTotal),
    grossMissionCost,
    totalSavings,
    operatingFloor,
    floorApplied,
    operatorMissionCost,
    platformFeePct,
    platformFee,
    vat,
    total,
    perSeat: round(total / pax),
    readinessScore,
    evidence,
    // High confidence requires operator evidence, never feasibility alone.
    confidence: priceBasis === "operator_calculated" && evidence.evidenceConfidence >= 85
      ? "high-confidence"
      : "indicative",
    priceBasis,

    operator,
    notes,
    passengers: pax,
    replayInput: {
      aircraftKey: aircraft.key,
      fromCode: input.fromCode,
      toCode: input.toCode,
      passengers: pax,
      roundTrip: sectors === 2,
      departureDate: input.departureDate ?? null,
      segment,
      flexibleDeparture: Boolean(input.flexibleDeparture),
      emptyLegMatch: Boolean(input.emptyLegMatch),
      sharedMission: Boolean(input.sharedMission),
      nearbyAirportOptimised: Boolean(input.nearbyAirportOptimised),
      overnights: Math.max(0, input.overnights ?? 0),
      optionalServices: (input.optionalServices ?? []).map((o) => ({ ...o })),
    },
  };
}

/* ------------------------------------------------------------------ */
/* AI aircraft recommendation                                          */
/* ------------------------------------------------------------------ */

export type RecommendationTag =
  | "Best value" | "Fastest" | "Luxury" | "Executive" | "Largest capacity"
  | "Lowest cost" | "Shortest positioning" | "Lowest carbon";

export interface AircraftRecommendation {
  aircraft: SmartFareAircraft;
  fare: MissionFare;
  tags: RecommendationTag[];
  /** Savings against the most expensive suitable aircraft. */
  savingsVsPremium: number;
  suitable: boolean;
}

/** Deterministic recommendation set — cheapest suitable option leads. */
export function recommendAircraft(input: Omit<MissionInput, "aircraftKey">): AircraftRecommendation[] {
  const to = airportByCode(input.toCode);
  const pax = Math.max(1, input.passengers || 1);

  const priced = SMARTFARE_FLEET.map((aircraft) => {
    const fare = computeMissionFare({ ...input, aircraftKey: aircraft.key });
    const suitable = pax <= aircraft.seats && (!to || to.runwayM >= aircraft.runwayM);
    return { aircraft, fare, suitable, tags: [] as RecommendationTag[], savingsVsPremium: 0 };
  }).filter((r) => r.suitable);

  if (priced.length === 0) return [];

  const byPrice = [...priced].sort((a, b) => a.fare.total - b.fare.total);
  const mostExpensive = byPrice[byPrice.length - 1];
  const fastest = [...priced].sort((a, b) => a.fare.blockHours - b.fare.blockHours)[0];
  const largest = [...priced].sort((a, b) => b.aircraft.seats - a.aircraft.seats)[0];
  const greenest = [...priced].sort((a, b) => a.fare.carbonKg - b.fare.carbonKg)[0];
  const shortestPos = [...priced].sort((a, b) => a.fare.positioningHours - b.fare.positioningHours)[0];
  // Best value = lowest cost per seat-hour delivered.
  const bestValue = [...priced].sort(
    (a, b) => a.fare.total / (a.aircraft.seats * Math.max(0.1, a.fare.blockHours))
      - b.fare.total / (b.aircraft.seats * Math.max(0.1, b.fare.blockHours)),
  )[0];

  const tag = (r: AircraftRecommendation | undefined, t: RecommendationTag) => {
    if (r && !r.tags.includes(t)) r.tags.push(t);
  };
  tag(byPrice[0], "Lowest cost");
  tag(bestValue, "Best value");
  tag(fastest, "Fastest");
  tag(largest, "Largest capacity");
  tag(greenest, "Lowest carbon");
  tag(shortestPos, "Shortest positioning");
  for (const r of priced) {
    if (r.aircraft.tier === "Ultra Premium" || r.aircraft.tier === "Premium") tag(r, "Luxury");
    if (r.aircraft.aircraftClass === "jet" && r.aircraft.tier === "Competitive") tag(r, "Executive");
    r.savingsVsPremium = Math.max(0, mostExpensive.fare.total - r.fare.total);
  }

  return byPrice;
}

export const formatKes = (n: number) =>
  `KSh ${Math.round(n).toLocaleString("en-KE")}`;

export const SMARTFARE_DISCLAIMER =
  "Starting prices are indicative. Final mission pricing depends on route, operator availability, aircraft positioning, airport charges and selected services.";
