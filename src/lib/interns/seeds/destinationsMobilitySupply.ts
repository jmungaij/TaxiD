/**
 * SPECIALIST PROGRAMME SEED — DMFD-INT-2608
 * Destinations Management, Mobility Supply & Fleet Development
 * Professional Internship (24 weeks, Nairobi, hybrid / field).
 *
 * This is not a tourism internship. It is a supply-side capability programme:
 * CUSTOMER DEMAND → DESTINATION → MOBILITY REQUIREMENT → VEHICLE / DRIVER /
 * FLEET → SUPPLY IDENTIFICATION → VERIFICATION → ONBOARDING → ACTIVATION →
 * BOOKABLE CAPACITY → SERVICE DELIVERY.
 *
 * Governance boundaries this seed respects:
 *  - No staff, position, cohort, driver, supplier, customer, booking or revenue
 *    record is fabricated. Programme and track references are CODES resolved
 *    against live records.
 *  - Demand is UNVERIFIED until evidence exists; compliance is VERIFIED /
 *    PENDING / EXPIRED / NOT PROVIDED / NOT APPLICABLE — never inferred.
 *  - Interns never verify, activate, approve or declare revenue. Verified
 *    revenue requires an authoritative financial record.
 *  - Publication readiness is decided server-side by `rec_internship_validate`.
 */
import type { InternshipProgrammeDraft } from "@/lib/interns/programmeBuilder";
import { emptyDraft } from "@/lib/interns/programmeBuilder";

/** Codes resolved against live `intern_programmes` / `intern_tracks`. */
export const DMFD_SEED_REFERENCES = {
  programmeCode: "YMEITA",
  primaryTrackCode: "DEST_SUPPLY",
  secondaryTrackCode: "DRIVER_FLEET",
  developmentTrackCode: "LOGISTICS",
  cohortName: "YMEITA-DMFD-2026-A",
  programmeCodeDmfd: "DMFD-INT-2608",
  positionCode: "INT-DMFD-001",
} as const;

/** Assignments that must come from authoritative records before publication. */
export const DMFD_SEED_OUTSTANDING = [
  "Approved org position (INT-DMFD-001) or an authorised position exception",
  "Supervisor — Mobility Operations / Supply Lead",
  "Mentor — Destination & Mobility Operations Manager",
  "Approving manager — Director or authorised senior manager",
  `Cohort ${DMFD_SEED_REFERENCES.cohortName} (planned intake 5 for live recruitment; the demonstration cohort carries 8 DEMO interns)`,
] as const;

/** Supply-side learning domains. */
export const DMFD_LEARNING_DOMAINS = [
  "Yalla Mobility marketplace & product surface",
  "Destination intelligence & mobility demand mapping",
  "Driver acquisition & qualification",
  "Fleet & supplier development",
  "Vehicle categories & capacity planning",
  "Documentation & compliance verification discipline",
  "Driver onboarding & activation support",
  "Corporate & executive mobility",
  "Airport transfer operations",
  "Charter, rentals & leasing supply",
  "Logistics & courier supply",
  "Commercial opportunity qualification",
  "Data integrity & anti-gaming controls",
  "Supply planning, dispatch principles & service quality",
] as const;

/** Product surface interns must be commercially competent in. */
export const DMFD_PRODUCT_SURFACE = [
  "Drivers",
  "Business & corporate mobility",
  "Charter",
  "Rentals & leasing",
  "Logistics",
] as const;

/** Published performance weights for this programme (server-authoritative). */
export const DMFD_PERFORMANCE_WEIGHTS = {
  learning: 15,
  productivity: 20,
  supply_development: 25,
  quality: 15,
  commercial: 15,
  conduct: 10,
} as const;

/** Supply Development Score weighting — mirrored by `intern_supply_score`. */
export const DMFD_SUPPLY_SCORE_WEIGHTS = [
  { dimension: "Qualified driver prospects", weight: 10 },
  { dimension: "Verified driver applications", weight: 15 },
  { dimension: "Drivers entering onboarding", weight: 15 },
  { dimension: "Activated drivers", weight: 20 },
  { dimension: "Qualified fleet suppliers", weight: 10 },
  { dimension: "Verified fleet capacity", weight: 15 },
  { dimension: "Destination mobility opportunities", weight: 10 },
  { dimension: "Data quality", weight: 5 },
] as const;

/** Driver supply state machine. */
export const DMFD_DRIVER_STAGES = [
  "LEAD", "CONTACTED", "INTERESTED", "QUALIFIED", "DOCUMENTS_REQUESTED",
  "DOCUMENTS_SUBMITTED", "VERIFIED", "ONBOARDING", "APPROVED", "ACTIVATED", "PRODUCTIVE",
] as const;

/** Commercial attribution chain — verified revenue only from finance records. */
export const DMFD_COMMERCIAL_STAGES = [
  "LEAD", "QUALIFIED", "OPPORTUNITY", "CUSTOMER", "BOOKING", "COMPLETED_SERVICE", "VERIFIED_REVENUE",
] as const;

/** Destination categories interns may profile. */
export const DMFD_DESTINATION_TYPES = [
  "airports", "hotels", "business districts", "tourism destinations", "conference venues",
  "universities", "hospitals", "industrial zones", "residential clusters", "shopping centres",
  "transport hubs", "event venues", "safari destinations", "coastal destinations",
  "corporate campuses", "logistics hubs",
] as const;

/** Fleet categories captured in supplier and vehicle records. */
export const DMFD_FLEET_CATEGORIES = [
  "sedan", "SUV", "executive vehicle", "van", "minibus", "bus", "coach",
  "truck", "cargo vehicle", "specialised equipment", "charter aircraft", "helicopter", "marine vessel",
] as const;

/** Talent classifications — every one evidence-based. */
export const DMFD_TALENT_CLASSIFICATIONS = [
  "DEVELOPING", "PRODUCER", "HIGH POTENTIAL", "PROMOTION CANDIDATE",
] as const;

/** Field assignment types in the fieldwork engine. */
export const DMFD_FIELD_ASSIGNMENTS = [
  "Driver acquisition field day",
  "Fleet mapping exercise",
  "Airport mobility mapping",
  "Hotel mobility mapping",
  "Corporate district mapping",
  "Destination supplier mapping",
  "Bus / coach operator mapping",
  "Logistics supplier mapping",
] as const;

/** The seeded programme design (24 weeks, 7 phases). */
export function destinationsMobilitySupplySeed(): InternshipProgrammeDraft {
  const base = emptyDraft();
  return {
    ...base,
    title:
      "Destinations Management, Mobility Supply & Fleet Development Professional Internship — Nairobi",
    location: "Nairobi, Kenya",
    position_id: "",
    position_exception_reason:
      "Yalla Mobility requires a supply-side talent pipeline able to discover, qualify, organise and activate mobility supply (drivers, vehicles, fleet suppliers and destination capacity) across corporate mobility, airport transfers, charter, rentals & leasing and logistics. Production publication requires approval of the corresponding internship position (INT-DMFD-001) or an authorised exception.",
    work_arrangement: "hybrid",
    priority: "high",
    headcount: 5,
    sla_days: 15,
    internship_type: "PROFESSIONAL",
    duration_weeks: 24,
    start_date: "2026-10-05",
    end_date: "2027-03-19",
    application_deadline: "2026-09-18",
    host_function: "Mobility Supply & Destination Operations",
    department: "Operations & Commercial Development",
    business_unit: "Yalla Mobility",

    programme_purpose:
      "Develop commercially productive mobility professionals capable of identifying destinations, mobility demand, drivers, vehicles and fleet capacity; recruiting and qualifying mobility supply; maintaining accurate supply records; supporting driver onboarding; developing destination mobility opportunities; and converting verified supply into operational and commercial capacity for Yalla Mobility. Interns do not observe or shadow — every intern carries a measurable, evidence-backed operational production mandate.",

    learning_objectives: [
      {
        competency: "Yalla Mobility marketplace and product surface competence",
        evidence:
          "Product map covering drivers, business & corporate mobility, charter, rentals & leasing and logistics, each with the supply required to fulfil it",
        assessment: "Product & supply knowledge assessment (gate at week 2)",
      },
      {
        competency: "Destination intelligence and mobility demand mapping",
        evidence:
          "Destination profiles carrying destination, type, customer segments, demand hypothesis, evidence, mobility requirements, vehicle categories, driver requirements, fleet requirements and Yalla product mapping — demand recorded as UNVERIFIED where evidence is absent",
        assessment: "Supervisor review of destination reasoning and evidence quality",
      },
      {
        competency: "Driver acquisition and qualification",
        evidence:
          "Driver prospect records progressing LEAD → CONTACTED → INTERESTED → QUALIFIED → DOCUMENTS REQUESTED → DOCUMENTS SUBMITTED → VERIFIED → ONBOARDING → APPROVED → ACTIVATED → PRODUCTIVE, with operating area, vehicle category, service category and availability captured",
        assessment: "Driver acquisition assessment (gate at week 8); duplicates and unverifiable records score zero",
      },
      {
        competency: "Fleet and supplier development",
        evidence:
          "Supplier records with owner, fleet type, vehicle count, capacity, location, operating area, service category, availability, documentation / insurance / inspection status, driver availability and commercial terms",
        assessment: "Fleet capacity review (gate at week 14)",
      },
      {
        competency: "Compliance and documentation discipline",
        evidence:
          "Every compliance field recorded as VERIFIED, PENDING, EXPIRED, NOT PROVIDED or NOT APPLICABLE — never inferred, never assumed",
        assessment: "Mentor audit; inferred compliance is a quality failure",
      },
      {
        competency: "Driver onboarding and activation support",
        evidence:
          "Onboarding support trail against the authoritative driver record — interns never duplicate driver profiles and never approve activation",
        assessment: "Supervisor verification of onboarding progression",
      },
      {
        competency: "Commercial mobility opportunity qualification",
        evidence:
          "Opportunities progressing LEAD → QUALIFIED → OPPORTUNITY, with product line, customer segment and requirement; conversion to CUSTOMER, BOOKING, COMPLETED SERVICE and VERIFIED REVENUE is performed only by authorised records",
        assessment: "Commercial review (gate at week 18)",
      },
      {
        competency: "Field production discipline",
        evidence:
          "Field assignments carrying assignment, location, date, objective, contacts, records created, evidence, outcomes, follow-up and supervisor verification",
        assessment: "Supervisor accompaniment and field record verification",
      },
      {
        competency: "Supply planning, dispatch principles and service quality",
        evidence: "Supply plan mapping destination demand to available verified capacity, with exception handling",
        assessment: "Advanced operations review (week 21)",
      },
      {
        competency: "Data integrity and anti-gaming conduct",
        evidence:
          "Clean records: no duplicate drivers, suppliers, phone numbers or vehicle registrations; no fabricated contacts; no unsupported revenue claims",
        assessment: "Integrity scan plus mandatory human review — flags read INTEGRITY REVIEW REQUIRED, never an accusation",
      },
      {
        competency: "Destination mobility development planning",
        evidence:
          "Capstone Destination Mobility Development Plan: destination, demand hypothesis, evidence, target customers, vehicle / driver / fleet requirements, supplier pipeline, activation strategy, commercial opportunity, operational risks, implementation plan and KPIs",
        assessment: "Capstone panel and final assessment (week 24)",
      },
    ],

    learning_outcomes: [
      { action: "Map", competency: "Destination intelligence", context: "A Nairobi or upcountry destination", evidence: "Accepted destination profile" },
      { action: "Prospect", competency: "Driver acquisition", context: "Ride-hailing, transfer, courier and chauffeur supply", evidence: "Accepted driver prospect records" },
      { action: "Qualify", competency: "Supply qualification", context: "Drivers and fleet suppliers", evidence: "Qualified records with documentation status" },
      { action: "Develop", competency: "Fleet supply", context: "Owner-operators, fleets, bus, coach, truck and rental operators", evidence: "Verified supplier and vehicle records" },
      { action: "Support", competency: "Onboarding & activation", context: "Authoritative driver system", evidence: "Progression trail on the driver record" },
      { action: "Identify", competency: "Commercial contribution", context: "Corporate, charter, rental, logistics and tourism mobility", evidence: "Qualified opportunity records" },
      { action: "Plan", competency: "Destination mobility development", context: "One assigned destination", evidence: "Approved capstone plan" },
    ],

    productivity_mandate: [
      { output: "Qualified driver prospects", cadence: "25 per week (phase 4 onward)", system_of_record: "intern_supply_driver_prospects" },
      { output: "Driver onboarding progressions", cadence: "8 per week", system_of_record: "intern_supply_driver_prospects + authoritative driver record" },
      { output: "Qualified fleet suppliers", cadence: "5 per week", system_of_record: "intern_supply_fleet_suppliers" },
      { output: "Vehicles mapped", cadence: "20 per week", system_of_record: "intern_supply_vehicles" },
      { output: "Destination profiles completed", cadence: "1 per week", system_of_record: "intern_supply_destinations" },
      { output: "Commercial mobility opportunities", cadence: "3 per week", system_of_record: "intern_supply_opportunities" },
      { output: "Verified field assignments", cadence: "1 per fortnight", system_of_record: "intern_supply_field_assignments" },
    ],

    kpis: [
      { kpi: "Qualified driver prospects", target: "40 across the programme", evidence_source: "intern_supply_driver_prospects (accepted)" },
      { kpi: "Drivers entering onboarding", target: "15", evidence_source: "Driver onboarding stage, supervisor verified" },
      { kpi: "Activated drivers", target: "10", evidence_source: "Activation performed by authorised staff only" },
      { kpi: "Verified fleet capacity", target: "60 vehicles", evidence_source: "Verified supplier records" },
      { kpi: "Destination profiles", target: "8 accepted", evidence_source: "intern_supply_destinations (accepted / complete)" },
      { kpi: "Commercial opportunities", target: "12 qualified", evidence_source: "intern_supply_opportunities" },
      { kpi: "Verified revenue", target: "Attributed only from authoritative financial records", evidence_source: "Finance records — never self-declared" },
    ],

    academic_eligibility: {
      ...base.academic_eligibility,
      qualification_level: "Undergraduate degree",
      programme_families: [
        "Transport & logistics",
        "Supply chain management",
        "Business & commerce",
        "Tourism & travel management",
        "Operations management",
        "Geography / urban planning",
        "Marketing & sales",
      ],
      year_of_study: "Third year, final year or recent graduate",
      minimum_grade: "Second class / credit or equivalent demonstrated capability",
      attachment_letter_required: true,
    },

    required_documents: [
      "University or college introduction letter",
      "Academic transcript",
      "National identification",
      "Supervisor or faculty contact",
    ],

    curriculum_map: [
      { course: "Transport operations", capability: "Supply planning & dispatch principles", application: "Matching destination demand to verified capacity" },
      { course: "Supply chain management", capability: "Supplier development & qualification", application: "Fleet supplier pipeline" },
      { course: "Marketing & sales", capability: "Prospecting & opportunity qualification", application: "Driver acquisition and commercial mobility opportunities" },
      { course: "Tourism & destination management", capability: "Destination intelligence", application: "Destination mobility profiles" },
      { course: "Data & information management", capability: "Record integrity", application: "Clean, non-duplicated supply data" },
    ],

    competencies: [
      { competency: "Field prospecting", evidence: "Verified field assignments with contacts and records created", level: "Working" },
      { competency: "Qualification judgement", evidence: "Accepted qualified records with documented rationale", level: "Working" },
      { competency: "Data accuracy", evidence: "Quality score and low return / rejection rate", level: "Proficient" },
      { competency: "Commercial awareness", evidence: "Qualified mobility opportunities mapped to Yalla products", level: "Working" },
      { competency: "Integrity", evidence: "No open integrity flags after human review", level: "Proficient" },
    ],

    practical_capabilities: [
      "Identify and profile a destination and its mobility requirement",
      "Prospect, contact and qualify drivers and vehicle owners",
      "Map fleet suppliers, vehicle counts and capacity",
      "Capture compliance status truthfully without inference",
      "Support driver onboarding against authoritative records",
      "Qualify commercial mobility opportunities and hand them over",
    ],

    experience_equivalency: [
      "Documented field sales, market research or logistics coordination experience",
      "Verified community, campus or SME transport coordination work",
    ],

    assessment_design: [
      { stage: "Product & supply knowledge", instrument: "Structured written assessment", weight: 15, passing: "70%" },
      { stage: "Driver acquisition assessment", instrument: "Evidence portfolio review", weight: 25, passing: "Accepted records with quality ≥ 85%" },
      { stage: "Fleet capacity review", instrument: "Supplier portfolio review", weight: 20, passing: "Verified capacity with complete documentation status" },
      { stage: "Commercial review", instrument: "Opportunity panel", weight: 15, passing: "Qualified opportunities with evidence" },
      { stage: "Capstone", instrument: "Destination Mobility Development Plan defence", weight: 25, passing: "Panel approval" },
    ],

    interview_framework: [
      { question: "Walk us through how you would map the mobility demand of a destination you know well.", rubric: "Structure, evidence discipline, willingness to mark demand unverified", max_marks: 10 },
      { question: "How would you qualify a driver who says they are ready to work today?", rubric: "Documentation, vehicle, availability, operating area, integrity", max_marks: 10 },
      { question: "A fleet owner claims 20 vehicles but shows papers for 6. What do you record?", rubric: "Records 6 verified, 14 not provided; escalates rather than assumes", max_marks: 10 },
      { question: "Describe a time you gathered field information under pressure.", rubric: "Field resilience, accuracy under pressure", max_marks: 10 },
    ],

    selection_weights: {
      academic_relevance: 10,
      curriculum_relevance: 10,
      competencies: 15,
      evidence: 15,
      assessment: 20,
      learning_agility: 10,
      communication: 5,
      problem_solving: 10,
      interview: 5,
    },

    talent_attributes: [
      "Field resilience",
      "Commercial judgement",
      "Operational reliability",
      "Data integrity",
      "Initiative and ownership",
      "Learning agility",
    ],

    commercial_objective: {
      objective:
        "Contribute verified mobility supply and qualified commercial opportunities across corporate mobility, airport transfers, charter, rentals & leasing, logistics and tourism mobility",
      measure:
        "Supply Development Score (activated drivers, verified fleet capacity, destination profiles) plus qualified opportunities — never self-declared revenue",
      attribution_source:
        "Authoritative driver, fleet and financial records. LEAD → QUALIFIED → OPPORTUNITY → CUSTOMER → BOOKING → COMPLETED SERVICE → VERIFIED REVENUE",
    },

    success_profile: [
      "Produces accepted supply records every week",
      "Never inflates volume at the cost of quality",
      "Escalates rather than assumes compliance",
      "Understands which Yalla product each supply unit serves",
      "Leaves behind a supply pipeline another operator can pick up",
    ],

    development_plan: [
      { phase: "Phase 1 · Weeks 1–2 · Orientation", focus: "Yalla marketplace, products, driver & fleet ecosystems, destination management, conduct, data integrity, safety", milestone: "Product & supply knowledge assessment passed" },
      { phase: "Phase 2 · Weeks 3–6 · Mobility supply", focus: "Driver acquisition and qualification, vehicle categories, fleet mapping, supplier development, document verification, onboarding", milestone: "First qualified drivers and suppliers accepted" },
      { phase: "Phase 3 · Weeks 7–10 · Destination intelligence", focus: "Destination research, demand mapping, airport transfers, corporate and tourism destinations, event mobility, route analysis, supplier mapping", milestone: "Three accepted destination profiles" },
      { phase: "Phase 4 · Weeks 11–14 · Field production", focus: "Driver and fleet prospecting, supplier outreach, field verification, data capture, activation support", milestone: "Fleet capacity review passed" },
      { phase: "Phase 5 · Weeks 15–18 · Commercial mobility", focus: "Corporate mobility, executive travel, airport transfers, charter, rentals, logistics, tourism mobility, opportunity qualification", milestone: "Commercial review passed" },
      { phase: "Phase 6 · Weeks 19–21 · Advanced operations", focus: "Supply planning, fleet capacity, dispatch principles, service quality, exception management, supplier performance", milestone: "Supply plan accepted" },
      { phase: "Phase 7 · Weeks 22–24 · Capstone", focus: "Destination Mobility Development Plan and final assessment", milestone: "Capstone approved; talent determination recorded" },
    ],

    public_preview: {
      summary:
        "Join Yalla Mobility's supply-side team in Nairobi and help build the driver, vehicle, fleet and destination capacity that moves people and goods across Kenya. A 24-week professional internship with real operational production, structured learning and evidence-based performance.",
      what_you_will_do:
        "Map destinations and their mobility demand, prospect and qualify drivers and vehicle owners, develop fleet suppliers, map vehicles and capacity, support driver onboarding, and identify commercial mobility opportunities across corporate mobility, airport transfers, charter, rentals and logistics.",
      what_you_will_learn:
        "How a mobility marketplace is actually built: destination intelligence, driver acquisition, fleet development, compliance discipline, supply planning, dispatch principles and commercial opportunity qualification.",
      who_should_apply:
        "Third-year, final-year or recently graduated students in transport, logistics, supply chain, business, tourism, operations or marketing who are comfortable working in the field, keeping accurate records and being measured on evidence.",
    },

    application_questions: [
      { question: "Describe a destination in Kenya and the mobility demand you believe it generates. State clearly what you know and what is unverified.", input: "long_text", required: true },
      { question: "How would you find and qualify ten drivers in a week?", input: "long_text", required: true },
      { question: "Are you available for hybrid and field work in Nairobi for 24 weeks?", input: "short_text", required: true },
    ],
  };
}
