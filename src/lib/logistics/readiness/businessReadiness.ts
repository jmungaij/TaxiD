/**
 * BUSINESS READINESS ORCHESTRATOR.
 *
 * The DF-10 certification gate answers one question: "is this authoritatively
 * proven in production conditions?". That is NOT the same question as "does the
 * business have everything it needs in place to begin?".
 *
 * This module publishes those states separately and never collapses them:
 *
 *   ENGINEERED            — the capability exists in code and is proven at the
 *                           level it has actually been executed.
 *   CONFIGURED            — no configuration blocker remains.
 *   INTEGRATED            — no integration blocker remains.
 *   PREPARED              — environment / fixture / execution machinery exists.
 *   BUSINESS_READY        — zero system-clearable blockers: every remaining item
 *                           is a human decision, an external action or an
 *                           authorised execution.
 *   CERTIFICATION_READY   — business-ready AND every human input has been
 *                           supplied, so authorised execution can begin.
 *   PILOT_EXECUTED        — the controlled pilot scenarios have actually run.
 *   PRODUCTION_CERTIFIED  — the DF-10 gate itself is satisfied.
 *
 * Nothing here can mark a control PASS. It only measures and routes.
 */
import type { CommandCenterControl } from "./execution";
import type { ReadinessTrack } from "./controlPlane";
import { buildBlockerRegister, type BlockerRegister, type ClearanceFamily } from "./blockerContract";
import { SERVICE_OFFERINGS, publicExposure, type ServiceOffering } from "../domain/serviceCatalogue";

/* ------------------------------- dimensions -------------------------------- */

export type ReadinessDimension =
  | "ENGINEERING"
  | "BUSINESS"
  | "INTEGRATION"
  | "OPERATIONAL"
  | "FINANCIAL"
  | "COMPLIANCE"
  | "CERTIFICATION"
  | "PRODUCTION";

export interface DimensionScore {
  dimension: ReadinessDimension;
  label: string;
  score: number;
  total: number;
  passed: number;
  verdict: "READY" | "PARTIAL" | "HOLD";
  outstanding: string[];
  meaning: string;
}

const DIMENSION_TRACKS: Record<Exclude<ReadinessDimension, "CERTIFICATION" | "PRODUCTION" | "INTEGRATION" | "BUSINESS">, ReadinessTrack[]> = {
  ENGINEERING: ["ARCHITECTURE_DOMAIN", "APPLICATION_SECURITY", "DATA_INTEGRITY"],
  OPERATIONAL: ["OPERATIONS", "CUSTOMER_SUPPORT", "INCIDENT_RECOVERY"],
  FINANCIAL: ["FINANCIAL_CONTROLS", "COMMERCIAL"],
  COMPLIANCE: ["LEGAL_REGULATORY", "PARTNER_COMPLIANCE"],
};

const pct = (passed: number, total: number) => (total === 0 ? 100 : Math.round((passed / total) * 100));

function scoreTracks(
  dimension: ReadinessDimension,
  label: string,
  meaning: string,
  controls: CommandCenterControl[],
  tracks: ReadinessTrack[],
): DimensionScore {
  const members = controls.filter((c) => tracks.includes(c.track) && c.blocking);
  const passed = members.filter((c) => c.status === "PASS").length;
  const score = pct(passed, members.length);
  return {
    dimension,
    label,
    score,
    total: members.length,
    passed,
    verdict: score === 100 ? "READY" : score >= 50 ? "PARTIAL" : "HOLD",
    outstanding: members.filter((c) => c.status !== "PASS").map((c) => c.control_id),
    meaning,
  };
}

/* ---------------------------- separated states ------------------------------ */

export type BusinessReadinessState =
  | "ENGINEERING_IN_PROGRESS"
  | "ENGINEERED"
  | "BUSINESS_READY"
  | "CERTIFICATION_READY"
  | "PILOT_EXECUTED"
  | "PRODUCTION_CERTIFIED";

export interface StateLadderRung {
  state: BusinessReadinessState | "CONFIGURED" | "INTEGRATED" | "PREPARED";
  satisfied: boolean;
  definition: string;
  outstanding: string[];
}

export interface BusinessReadinessReport {
  register: BlockerRegister;
  dimensions: DimensionScore[];
  state: BusinessReadinessState;
  ladder: StateLadderRung[];
  /** Counts per clearance family — the honest picture of what remains. */
  familyCounts: { family: ClearanceFamily; count: number }[];
  systemClearableRemaining: number;
  humanQueue: number;
  externalQueue: number;
  executionQueue: number;
  noDeadEnds: boolean;
  services: ServiceReadiness[];
}

/* --------------------------- service-level readiness ------------------------ */

export type ServiceBookability = "BOOKABLE" | "PILOT_ONLY" | "ENQUIRY_ONLY" | "NOT_BOOKABLE";

export interface ActivationCheck {
  requirement: string;
  satisfied: boolean;
  detail: string;
}

export interface ServiceReadiness {
  code: string;
  name: string;
  family: string;
  bookability: ServiceBookability;
  bookingMode: string;
  quoteMode: string;
  checklist: ActivationCheck[];
  satisfied: number;
  total: number;
  blockingDependency: string;
  nextAction: string;
}

/** Bookability is read from the catalogue's capability truth — never from a UI flag. */
export function serviceBookability(o: ServiceOffering): ServiceBookability {
  const exposure = publicExposure(o);
  if (o.status === "PILOT") return "PILOT_ONLY";
  if (o.bookingMode === "RFQ") return "ENQUIRY_ONLY";
  if (exposure === "BOOKABLE" && o.status === "ACTIVE") return "BOOKABLE";
  if (exposure === "ENQUIRY_ONLY") return "ENQUIRY_ONLY";
  return "NOT_BOOKABLE";
}

function trackReady(controls: CommandCenterControl[], track: ReadinessTrack): boolean {
  const members = controls.filter((c) => c.track === track && c.blocking);
  return members.length > 0 && members.every((c) => c.status === "PASS");
}

function trackOutstanding(controls: CommandCenterControl[], track: ReadinessTrack): number {
  return controls.filter((c) => c.track === track && c.blocking && c.status !== "PASS").length;
}

export function buildServiceReadiness(o: ServiceOffering, controls: CommandCenterControl[]): ServiceReadiness {
  const checklist: ActivationCheck[] = [
    { requirement: "Service configured", satisfied: o.capability.implemented && o.capability.configured, detail: `Catalogue record v${o.version}, status ${o.status}.` },
    { requirement: "Serviceability", satisfied: o.coverage.length > 0 && !!o.operatingHours, detail: o.coverage.length > 0 ? `${o.coverage.join(", ")} · ${o.operatingHours.days} ${o.operatingHours.open}–${o.operatingHours.close}` : "No coverage zone configured." },
    { requirement: "Pricing", satisfied: o.ratePlans.length > 0, detail: o.ratePlans.length > 0 ? o.ratePlans.map((r) => `${r.name} (${r.model})`).join(", ") : "No effective rate plan." },
    { requirement: "Commercial approval", satisfied: trackReady(controls, "COMMERCIAL"), detail: `${trackOutstanding(controls, "COMMERCIAL")} commercial acceptance controls outstanding.` },
    { requirement: "Legal determination", satisfied: trackReady(controls, "LEGAL_REGULATORY"), detail: `${trackOutstanding(controls, "LEGAL_REGULATORY")} legal determinations outstanding.` },
    { requirement: "Partner capability", satisfied: trackReady(controls, "PARTNER_COMPLIANCE"), detail: o.compliance.requiresPartnerLicence ? "Partner licence, courier identity and vehicle inspection required." : "No partner licence dependency." },
    { requirement: "Capacity", satisfied: o.fulfilmentMethods.length > 0, detail: o.fulfilmentMethods.join(", ") || "No fulfilment method configured." },
    { requirement: "SLA", satisfied: !!o.sla.code, detail: o.sla.qualifier },
    { requirement: "Operations", satisfied: trackReady(controls, "OPERATIONS"), detail: `${trackOutstanding(controls, "OPERATIONS")} operating procedures unapproved.` },
    { requirement: "Finance", satisfied: trackReady(controls, "FINANCIAL_CONTROLS"), detail: `${trackOutstanding(controls, "FINANCIAL_CONTROLS")} financial controls outstanding.` },
    { requirement: "Support", satisfied: trackReady(controls, "CUSTOMER_SUPPORT"), detail: `${trackOutstanding(controls, "CUSTOMER_SUPPORT")} support controls outstanding.` },
    { requirement: "Pilot evidence", satisfied: trackReady(controls, "OPERATIONAL_PILOT"), detail: `${trackOutstanding(controls, "OPERATIONAL_PILOT")} pilot scenarios not executed.` },
    { requirement: "Activation approval", satisfied: o.capability.verified, detail: o.capability.verified ? "Verified activation record present." : "No verified activation record — activation approval outstanding." },
  ];

  const failing = checklist.filter((c) => !c.satisfied);
  const bookability = serviceBookability(o);

  return {
    code: o.code,
    name: o.name,
    family: o.family,
    bookability,
    bookingMode: o.bookingMode,
    quoteMode: o.quoteMode,
    checklist,
    satisfied: checklist.length - failing.length,
    total: checklist.length,
    blockingDependency: failing.length === 0 ? "None — all activation dependencies satisfied." : failing.map((f) => f.requirement).join(", "),
    nextAction:
      failing.length === 0
        ? bookability === "BOOKABLE"
          ? "Operate. Keep evidence fresh before the freshness window closes."
          : "Submit the activation transition for approval."
        : `Clear ${failing[0].requirement}: ${failing[0].detail}`,
  };
}

/* --------------------------------- report ---------------------------------- */

export function buildBusinessReadiness(controls: CommandCenterControl[], infraReady: boolean): BusinessReadinessReport {
  const register = buildBlockerRegister(controls, infraReady);

  const familyCount = (f: ClearanceFamily) => register.blockers.filter((b) => b.clearance_family === f).length;
  const systemClearableRemaining = familyCount("SYSTEM_CLEARABLE");
  const humanQueue = familyCount("HUMAN_CLEARABLE");
  const externalQueue = familyCount("EXTERNAL_CLEARABLE");
  const executionQueue = familyCount("EXECUTION_CLEARABLE");

  const integrationOutstanding = register.blockers.filter((b) => b.blocker_type === "INTEGRATION_BLOCKER");
  const configOutstanding = register.blockers.filter((b) => b.blocker_type === "CONFIGURATION_BLOCKER");
  const buildOutstanding = register.blockers.filter((b) => b.blocker_type === "BUILD_BLOCKER");
  const envOutstanding = register.blockers.filter((b) => b.blocker_type === "ENVIRONMENT_BLOCKER");

  const dimensions: DimensionScore[] = [
    scoreTracks("ENGINEERING", "Engineering readiness", "Code, domain model, security and data integrity proven at the level executed.", controls, DIMENSION_TRACKS.ENGINEERING),
    {
      dimension: "BUSINESS",
      label: "Business readiness",
      score: pct(register.blockers.length - systemClearableRemaining, Math.max(register.blockers.length, 1)),
      total: register.blockers.length,
      passed: register.blockers.length - systemClearableRemaining,
      verdict: systemClearableRemaining === 0 ? "READY" : "PARTIAL",
      outstanding: buildOutstanding.concat(configOutstanding).map((b) => b.control_id),
      meaning: "Zero build, configuration or integration work remains; only human decisions and authorised execution do.",
    },
    {
      dimension: "INTEGRATION",
      label: "Integration readiness",
      score: integrationOutstanding.length === 0 ? 100 : 0,
      total: integrationOutstanding.length,
      passed: 0,
      verdict: integrationOutstanding.length === 0 ? "READY" : "HOLD",
      outstanding: integrationOutstanding.map((b) => b.control_id),
      meaning: "Every provider integration is wired and either connected or explicitly awaiting credentials.",
    },
    scoreTracks("OPERATIONAL", "Operational readiness", "SOPs, SLAs, escalation, support and incident response accepted by their owners.", controls, DIMENSION_TRACKS.OPERATIONAL),
    scoreTracks("FINANCIAL", "Financial readiness", "Collection, invoicing, reconciliation, payable and settlement controls accepted by Finance.", controls, DIMENSION_TRACKS.FINANCIAL),
    scoreTracks("COMPLIANCE", "Compliance readiness", "Legal determinations and partner compliance evidence recorded and unexpired.", controls, DIMENSION_TRACKS.COMPLIANCE),
    {
      dimension: "CERTIFICATION",
      label: "Certification readiness",
      score: systemClearableRemaining === 0 && humanQueue === 0 && externalQueue === 0 ? 100 : 0,
      total: humanQueue + externalQueue + systemClearableRemaining,
      passed: 0,
      verdict: systemClearableRemaining === 0 && humanQueue === 0 && externalQueue === 0 ? "READY" : "HOLD",
      outstanding: register.blockers.filter((b) => b.clearance_family !== "EXECUTION_CLEARABLE" && b.clearance_family !== "CERTIFICATION_CLEARABLE").map((b) => b.control_id),
      meaning: "Everything needed to BEGIN authorised execution exists. It does not mean execution has happened.",
    },
    {
      dimension: "PRODUCTION",
      label: "Production certification",
      score: register.blockers.length === 0 ? 100 : 0,
      total: register.blockers.length,
      passed: 0,
      verdict: register.blockers.length === 0 ? "READY" : "HOLD",
      outstanding: register.blockers.map((b) => b.control_id),
      meaning: "Never inferred. Satisfied only when every mandatory control holds authoritative evidence.",
    },
  ];

  const engineeringReady = dimensions[0].verdict === "READY";
  const businessReady = systemClearableRemaining === 0;
  const certificationReady = businessReady && humanQueue === 0 && externalQueue === 0;
  const pilotExecuted = trackReady(controls, "OPERATIONAL_PILOT");
  const certified = register.blockers.length === 0;

  const ladder: StateLadderRung[] = [
    { state: "ENGINEERED", satisfied: engineeringReady, definition: "Architecture, security and data-integrity controls hold application-level evidence.", outstanding: dimensions[0].outstanding },
    { state: "CONFIGURED", satisfied: configOutstanding.length === 0, definition: "Every configurable dependency has an owner-supplied, versioned configuration record.", outstanding: configOutstanding.map((b) => b.control_id) },
    { state: "INTEGRATED", satisfied: integrationOutstanding.length === 0, definition: "Every provider integration is wired, with credential and health state exposed.", outstanding: integrationOutstanding.map((b) => b.control_id) },
    { state: "PREPARED", satisfied: envOutstanding.length === 0, definition: "Environment, fixture, identity and restore machinery exists for authorised execution.", outstanding: envOutstanding.map((b) => b.control_id) },
    { state: "BUSINESS_READY", satisfied: businessReady, definition: "No build, configuration, integration or preparation blocker remains.", outstanding: register.blockers.filter((b) => b.clearance_family === "SYSTEM_CLEARABLE").map((b) => b.control_id) },
    { state: "CERTIFICATION_READY", satisfied: certificationReady, definition: "Human and external inputs supplied; authorised execution can begin.", outstanding: register.blockers.filter((b) => b.clearance_family === "HUMAN_CLEARABLE" || b.clearance_family === "EXTERNAL_CLEARABLE").map((b) => b.control_id) },
    { state: "PILOT_EXECUTED", satisfied: pilotExecuted, definition: "Every controlled pilot scenario has actually been executed and recorded.", outstanding: controls.filter((c) => c.track === "OPERATIONAL_PILOT" && c.status !== "PASS").map((c) => c.control_id) },
    { state: "PRODUCTION_CERTIFIED", satisfied: certified, definition: "Every mandatory control holds authoritative, unexpired evidence.", outstanding: register.blockers.map((b) => b.control_id) },
  ];

  const state: BusinessReadinessState = certified
    ? "PRODUCTION_CERTIFIED"
    : pilotExecuted
      ? "PILOT_EXECUTED"
      : certificationReady
        ? "CERTIFICATION_READY"
        : businessReady
          ? "BUSINESS_READY"
          : engineeringReady
            ? "ENGINEERED"
            : "ENGINEERING_IN_PROGRESS";

  return {
    register,
    dimensions,
    state,
    ladder,
    familyCounts: register.byFamily.map((f) => ({ family: f.family, count: f.count })),
    systemClearableRemaining,
    humanQueue,
    externalQueue,
    executionQueue,
    noDeadEnds: register.deadEnds.length === 0,
    services: SERVICE_OFFERINGS.filter((o) => o.status !== "RETIRED").map((o) => buildServiceReadiness(o, controls)),
  };
}
