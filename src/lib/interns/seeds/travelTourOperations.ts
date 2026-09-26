/**
 * SPECIALIST PROGRAMME SEED — TTO-001
 * Travel & Tour Operations Internship: corporate mobility, air transfers,
 * itinerary management, logistics, fleet and tourism-commercial services.
 *
 * This seed replaces the generic "enterprise growth & mobility" starting point
 * with Yalla Mobility's actual travel and mobility operating model, expressed as
 * five connected engines: TRAVEL DESK → CORPORATE MOBILITY → OPERATIONS →
 * TOURISM PRODUCT → COMMERCIAL.
 *
 * Governance boundaries this seed deliberately respects:
 *  - It never fabricates a position, a staff identity, a cohort, revenue,
 *    bookings, customers or fleet records. Those are resolved from authoritative
 *    records by the builder, or reported as outstanding assignments.
 *  - Track and programme references are CODES, resolved against live records so
 *    no duplicate YMEITA programme or track is ever created.
 *  - Publication remains gated by `rec_internship_validate` on the server; the
 *    seed only supplies the design, never the verdict.
 */
import type { InternshipProgrammeDraft } from "@/lib/interns/programmeBuilder";
import { emptyDraft } from "@/lib/interns/programmeBuilder";

/** Codes the builder resolves against live `intern_tracks` / `intern_programmes`. */
export const TTO_SEED_REFERENCES = {
  programmeCode: "YMEITA",
  primaryTrackCode: "TRAVEL_OPS",
  secondaryTrackCode: "SALES",
  developmentTrackCode: "LOGISTICS",
  cohortName: "YMEITA-2026-Q4-TTO",
  programmeCodeTto: "TTO-001",
  positionCode: "INT-TTO-001",
} as const;

/** Assignments that must come from authoritative records before publication. */
export const TTO_SEED_OUTSTANDING = [
  "Approved org position (INT-TTO-001) or an authorised position exception",
  "Supervisor — Travel & Mobility Operations",
  "Mentor / learning owner — Travel & Tourism Operations",
  "Approving manager for the host function",
  `Cohort ${TTO_SEED_REFERENCES.cohortName} (create it in Cohorts, planned intake 8)`,
] as const;

/** The twelve learning domains of the specialist curriculum. */
export const TTO_LEARNING_DOMAINS = [
  "Yalla Mobility & Travel Ecosystem",
  "Corporate Mobility",
  "Ride-Hailing Operations",
  "Airport Transfers",
  "Itinerary Planning",
  "Travel Operations",
  "Logistics & Fleet",
  "Tourism Product Development",
  "Travel Sales",
  "Digital Travel Marketing",
  "Customer Experience",
  "Professional Capability",
] as const;

/**
 * Additional performance lenses this programme exposes on top of the standard
 * weighted model (learning 15, productivity 20, quality 15, commercial 25,
 * operational 15, conduct 10).
 */
export const TTO_PERFORMANCE_LENSES = [
  "Travel accuracy",
  "Itinerary quality",
  "Operational coordination",
  "Customer handling",
  "Commercial judgement",
  "Product knowledge",
  "Fleet & logistics understanding",
] as const;

/**
 * The seeded programme design. Dates follow the specialist intake calendar:
 * 10 Sep 2026 → 15 Mar 2027, applications close 7 Sep 2026 (deadline on or
 * before the start date, as the server also validates).
 */
export function travelTourOperationsSeed(): InternshipProgrammeDraft {
  const base = emptyDraft();
  return {
    ...base,
    title: "Travel & Tour Operations Internship — Corporate Mobility, Air Transfers & Tourism Services — Nairobi",
    location: "Nairobi, Kenya",
    position_id: "",
    position_exception_reason:
      "Yalla Mobility is establishing a specialist Travel & Tour Operations internship capability pipeline covering corporate mobility, airport transfers, itinerary management, logistics, fleet coordination and tourism-product sales. Production publication requires approval of the corresponding internship position (INT-TTO-001).",
    work_arrangement: "hybrid",
    priority: "high",
    headcount: 8,
    sla_days: 14,
    internship_type: "PROFESSIONAL",
    duration_weeks: 24,
    start_date: "2026-09-10",
    end_date: "2027-03-15",
    application_deadline: "2026-09-07",
    host_function: "Travel & Mobility Operations",
    department: "Travel, Corporate Mobility & Tourism Operations",
    business_unit: "Yalla Mobility",

    programme_purpose:
      "Develop practical Travel & Tour Operations capability by training interns to understand, plan, quote, sell, coordinate and support corporate mobility, ride-hailing, airport transfers, itineraries, fleet and logistics services, while developing the ability to market and sell travel and tourism products as commercially viable Yalla Mobility services. Yalla Mobility requires a scalable early-career talent pipeline capable of converting corporate and leisure travel requirements into well-planned, commercially viable and operationally deliverable mobility and tourism solutions.",

    learning_objectives: [
      {
        competency: "Corporate mobility requirement analysis",
        evidence: "Corporate Mobility Requirement Brief: passengers, locations, dates, times, vehicle class, service level, billing, approvals and special requirements",
        assessment: "Supervisor review of the approved requirement record",
      },
      {
        competency: "Ride-hailing operations coordination",
        evidence: "Operation record covering request, validation, allocation, monitoring, communication and exception escalation",
        assessment: "Supervised operations observation plus record accuracy check",
      },
      {
        competency: "Airport transfer planning",
        evidence: "Airport Transfer Operations Sheet: flight, arrival time, vehicle, driver, pickup point, destination, contingency and customer confirmation",
        assessment: "Scenario assessment including a flight-delay contingency",
      },
      {
        competency: "Professional itinerary construction",
        evidence: "Corporate traveller itinerary with traveller profile, transport, transfers, timings, suppliers, contingencies and estimated cost",
        assessment: "Rubric on accuracy, feasibility, timing, cost awareness and presentation quality",
      },
      {
        competency: "Travel operations lifecycle (request → research → quote → approve → book → confirm → operate → reconcile → close)",
        evidence: "Travel desk case file showing each stage with documents and confirmations",
        assessment: "Mentor case-file audit",
      },
      {
        competency: "Logistics movement planning",
        evidence: "Approved logistics movement plan: route, vehicle, driver, timing, load, documentation and exception handling",
        assessment: "Operations supervisor approval",
      },
      {
        competency: "Fleet matching and justification",
        evidence: "Requirement-to-fleet match explaining vehicle, driver, route, timing and service level",
        assessment: "Fleet allocation assessment (why this vehicle, driver, route, timing, service level)",
      },
      {
        competency: "Tourism product development",
        evidence: "Structured product concept: destination research, experience design, transport integration, suppliers and pricing support",
        assessment: "Product panel review; no commercial publication without approval",
      },
      {
        competency: "Travel sales and quotation under supervision",
        evidence: "CRM-recorded prospecting, qualification, needs analysis, quotation and follow-up trail",
        assessment: "Travel sales scenario with commercial-judgement rubric",
      },
      {
        competency: "Digital travel marketing",
        evidence: "Campaign brief for one approved product: audience, value proposition, creative concept, channel, CTA, lead capture and measurement",
        assessment: "Marketing exercise review",
      },
      {
        competency: "Customer experience and service recovery",
        evidence: "Case record for a service disruption: communication, alternative, escalation, documentation and closure",
        assessment: "Service-recovery scenario assessment",
      },
      {
        competency: "Professional capability and data discipline",
        evidence: "Accurate CRM and operational records, punctual reporting and documented handovers",
        assessment: "Conduct and record-integrity review",
      },
    ],

    learning_outcomes: [
      { action: "Analyse", competency: "Corporate mobility requirement analysis", context: "A corporate account requesting employee, executive and airport transport", evidence: "Approved requirement brief" },
      { action: "Prepare", competency: "Itinerary construction", context: "A corporate traveller with multi-leg movement", evidence: "Reviewed itinerary" },
      { action: "Plan", competency: "Airport transfer operations", context: "JKIA arrival with delay risk", evidence: "Transfer operations sheet" },
      { action: "Coordinate", competency: "Ride-hailing operations", context: "Supervised corporate ride request", evidence: "Operation record" },
      { action: "Match", competency: "Fleet allocation", context: "Customer requirement against available fleet and drivers", evidence: "Justified allocation" },
      { action: "Prepare", competency: "Logistics movement planning", context: "A multi-stop delivery movement", evidence: "Approved movement plan" },
      { action: "Structure", competency: "Tourism product development", context: "A Nairobi or safari transfer package", evidence: "Product concept pack" },
      { action: "Quote", competency: "Travel quotation under supervision", context: "A corporate or leisure travel requirement", evidence: "Issued quotation record" },
      { action: "Prospect and qualify", competency: "Travel sales", context: "Corporate and leisure travel buyers", evidence: "CRM pipeline entries" },
      { action: "Manage", competency: "Service exception handling", context: "Driver delay, vehicle substitution or booking amendment", evidence: "Closed case record" },
      { action: "Create", competency: "Digital travel marketing", context: "One approved Yalla travel or mobility product", evidence: "Approved campaign asset" },
      { action: "Maintain", competency: "Data and CRM discipline", context: "Daily travel desk operations", evidence: "Audited record accuracy" },
    ],

    productivity_mandate: [
      { output: "Travel desk: researched travel opportunities", cadence: "5 per week", system_of_record: "Travel desk / CRM" },
      { output: "Corporate prospecting contacts", cadence: "15 per week", system_of_record: "CRM" },
      { output: "Qualified prospects", cadence: "5 per week", system_of_record: "CRM" },
      { output: "Itinerary exercises", cadence: "3 per week", system_of_record: "Intern work items" },
      { output: "Airport transfer plans", cadence: "3 per week", system_of_record: "Operations records" },
      { output: "Travel quotations prepared under supervision", cadence: "3 per week", system_of_record: "Quotation engine" },
      { output: "Digital travel content pieces", cadence: "3 per week", system_of_record: "Marketing workspace" },
      { output: "Supervised customer or service cases", cadence: "5 per week", system_of_record: "Customer experience cases" },
      { output: "Fleet and logistics exercises", cadence: "2 per week", system_of_record: "Operations records" },
    ],

    kpis: [
      { kpi: "Requirement briefs accepted by a supervisor", target: "≥ 90% acceptance", evidence_source: "Intern work items" },
      { kpi: "Itinerary accuracy and feasibility", target: "≥ 80% rubric score", evidence_source: "Mentor assessment" },
      { kpi: "Airport transfer plans delivered without avoidable exception", target: "≥ 90%", evidence_source: "Operations records" },
      { kpi: "Quotation turnaround", target: "Within 24 working hours of a complete brief", evidence_source: "Quotation engine" },
      { kpi: "Qualified leads per week", target: "5", evidence_source: "CRM" },
      { kpi: "Verified commercial contribution", target: "Attributed only from authoritative Yalla systems", evidence_source: "Commercial transactions" },
      { kpi: "Service cases closed within SLA", target: "≥ 90%", evidence_source: "Customer experience cases" },
      { kpi: "Record and CRM accuracy", target: "≥ 95% audited accuracy", evidence_source: "Data integrity audit" },
    ],

    academic_eligibility: {
      qualification_level: "Diploma",
      programme_families: [
        "Tourism Management",
        "Travel & Tourism",
        "Hospitality Management",
        "Business Administration",
        "Commerce / Marketing",
        "Supply Chain & Logistics",
        "Procurement",
        "Communication",
        "Digital Marketing",
        "Information Technology",
      ],
      year_of_study: "Any year, including recent completers",
      minimum_grade: "No minimum grade — capability is assessed from mapped coursework, competencies and evidence",
      attachment_letter_required: false,
    },
    required_documents: [
      "University or college introduction letter",
      "Academic transcript",
      "Course unit list / curriculum outline",
      "National identification",
    ],

    curriculum_map: [
      { course: "Tourism / travel operations coursework", capability: "Travel operations lifecycle", application: "Travel desk: request → quote → booking → confirmation" },
      { course: "Hospitality operations", capability: "Service standards and guest handling", application: "Airport meet-and-greet and executive transfers" },
      { course: "Marketing and digital marketing units", capability: "Demand generation for travel products", application: "Campaigns for approved mobility and tourism products" },
      { course: "Sales / customer relationship units", capability: "Prospecting, qualification and closing support", application: "Corporate travel pipeline in CRM" },
      { course: "Supply chain, logistics and procurement units", capability: "Route, movement and supplier coordination", application: "Logistics movement plans and supplier records" },
      { course: "Business communication", capability: "Professional client communication", application: "Itinerary presentation and exception communication" },
      { course: "Information systems / data units", capability: "Operational data discipline", application: "CRM, quotation and operations record accuracy" },
      { course: "Accounting or costing units", capability: "Cost and margin awareness", application: "Quotation support and package pricing input" },
    ],

    competencies: [
      { competency: "Requirement gathering and analysis", evidence: "Approved requirement brief", level: "Working" },
      { competency: "Itinerary construction", evidence: "Reviewed itinerary", level: "Working" },
      { competency: "Airport transfer coordination", evidence: "Transfer operations sheet", level: "Working" },
      { competency: "Fleet and driver matching", evidence: "Justified allocation", level: "Awareness" },
      { competency: "Logistics movement planning", evidence: "Approved movement plan", level: "Awareness" },
      { competency: "Tourism product structuring", evidence: "Product concept pack", level: "Working" },
      { competency: "Travel sales and quotation support", evidence: "CRM pipeline and quotation trail", level: "Working" },
      { competency: "Customer experience and service recovery", evidence: "Closed case record", level: "Working" },
      { competency: "Digital travel marketing", evidence: "Approved campaign asset", level: "Awareness" },
      { competency: "Operational data and CRM discipline", evidence: "Audited record accuracy", level: "Working" },
    ],

    practical_capabilities: [
      "Corporate mobility",
      "Ride-hailing operations",
      "Airport transfers",
      "Itinerary planning",
      "Travel operations",
      "Logistics",
      "Fleet management",
      "Tourism product development",
      "Travel sales",
      "Customer experience",
      "Digital travel marketing",
      "Data, CRM and operations systems",
    ],

    experience_equivalency: [
      "Academic travel or tourism projects",
      "Industrial attachment or field attachment",
      "Events coordination",
      "Customer service or front-office work",
      "Sales or telesales experience",
      "Student leadership",
      "Digital marketing or content creation",
      "Entrepreneurship or small trading ventures",
      "Volunteer coordination work",
    ],

    assessment_design: [
      { stage: "Assessment 1 — Corporate mobility case", instrument: "Requirement brief from a corporate mobility scenario", weight: 15, passing: "Complete, feasible and correctly scoped requirement" },
      { stage: "Assessment 2 — Airport transfer scenario", instrument: "Transfer operations sheet with delay contingency", weight: 15, passing: "Workable plan with contingency and customer communication" },
      { stage: "Assessment 3 — Itinerary construction", instrument: "Corporate traveller itinerary", weight: 15, passing: "Accurate, feasible, costed and well presented" },
      { stage: "Assessment 4 — Fleet allocation", instrument: "Requirement-to-fleet match with justification", weight: 10, passing: "Defensible vehicle, driver, route, timing and service level" },
      { stage: "Assessment 5 — Tourism product design", instrument: "Product concept for an approved product family", weight: 10, passing: "Coherent product with transport and supplier integration" },
      { stage: "Assessment 6 — Travel sales scenario", instrument: "Three-day Nairobi / Maasai Mara requirement, sold as a solution", weight: 15, passing: "Needs-based solution with quotation and follow-up plan" },
      { stage: "Assessment 7 — Customer service recovery", instrument: "Delayed airport transfer driver scenario", weight: 10, passing: "Communicates, recovers, escalates, documents and closes" },
      { stage: "Assessment 8 — Digital travel marketing exercise", instrument: "Campaign brief for one approved product", weight: 10, passing: "Clear audience, proposition, channel, CTA and measurement" },
    ],

    interview_framework: [
      { question: "A corporate client has ten executives arriving in Nairobi at different times over two days. Explain how you would gather the requirements and construct the mobility plan.", rubric: "Requirement gathering, planning, vehicle logic, timing, airport coordination, communication, contingency and commercial awareness", max_marks: 5 },
      { question: "Walk through how a travel request becomes a confirmed booking at Yalla Mobility.", rubric: "Understands request → research → quote → approval → book → confirm → operate → reconcile → close", max_marks: 5 },
      { question: "A client's flight is delayed by three hours and the driver is already at JKIA. What do you do?", rubric: "Customer protection, alternative, cost awareness, escalation and documentation", max_marks: 5 },
      { question: "How would you decide which vehicle and driver to allocate to an executive airport transfer?", rubric: "Vehicle suitability, driver readiness, route, timing and service level reasoning", max_marks: 5 },
      { question: "Design a three-day travel experience for a family visiting Nairobi and the Maasai Mara. How would you price and sell it?", rubric: "Product thinking, transport integration, supplier logic, cost and margin awareness", max_marks: 5 },
      { question: "How would you find and qualify ten new corporate travel customers this month?", rubric: "Prospecting method, qualification discipline, CRM use and follow-through", max_marks: 5 },
      { question: "Describe a detail you caught that others missed, and what it prevented.", rubric: "Attention to detail with a concrete, verifiable example", max_marks: 5 },
      { question: "Tell us about something operational you taught yourself recently and how you applied it.", rubric: "Learning agility and evidence of application", max_marks: 5 },
    ],

    selection_weights: {
      academic_relevance: 10,
      curriculum_relevance: 15,
      competencies: 15,
      evidence: 15,
      assessment: 20,
      learning_agility: 10,
      communication: 5,
      problem_solving: 5,
      interview: 5,
    },

    talent_attributes: [
      "Commercial initiative",
      "Travel judgement",
      "Operational discipline",
      "Customer orientation",
      "Attention to detail",
      "Sales ability",
      "Communication",
      "Problem solving",
      "Digital fluency",
      "Learning velocity",
      "Ownership",
      "Reliability",
    ],

    commercial_objective: {
      objective: "Convert corporate and leisure travel requirements into quoted, booked and delivered Yalla mobility and tourism services",
      measure: "Prospects, qualified leads, opportunities, quotations, bookings assisted and attributed revenue — tracked as LEAD_CREATED, LEAD_QUALIFIED, QUOTE_PREPARED, OPPORTUNITY_CREATED, SALES_ASSIST, BOOKING_ASSIST and CUSTOMER_RETAINED events",
      attribution_source: "Authoritative Yalla systems only (commercial transactions, quotations, bookings). Self-declared revenue is never counted as verified revenue.",
    },

    success_profile: [
      "Can take a customer requirement and return a workable, costed travel solution",
      "Coordinates fleet, driver and route without supervision on routine movements",
      "Protects the customer experience when operations go wrong",
      "Builds and maintains an accurate pipeline of travel customers",
      "Explains commercial trade-offs behind a quotation",
      "Leaves records another operator can pick up cleanly",
    ],

    development_plan: [
      { phase: "Weeks 1–4", focus: "Yalla travel ecosystem, corporate mobility fundamentals, records and systems discipline", milestone: "First accepted corporate mobility requirement brief" },
      { phase: "Weeks 5–8", focus: "Airport transfers, ride-hailing coordination and itinerary construction", milestone: "Airport transfer plan and itinerary delivered to standard" },
      { phase: "Weeks 9–12", focus: "Travel desk lifecycle, quotations, suppliers and confirmations", milestone: "Supervised quotation issued and booked" },
      { phase: "Weeks 13–16", focus: "Logistics movement planning and fleet allocation reasoning", milestone: "Approved logistics movement plan" },
      { phase: "Weeks 17–20", focus: "Tourism product development and digital travel marketing", milestone: "Approved product concept and campaign asset" },
      { phase: "Weeks 21–24", focus: "Commercial ownership, customer retention and capstone assessment", milestone: "Capstone assessed; talent and conversion decision recorded from evidence" },
    ],

    public_preview: {
      summary:
        "Travel & Tour Operations Internship — build practical experience at the intersection of travel, mobility, corporate transportation, airport transfers, logistics, fleet operations and tourism commerce. Nairobi, hybrid and field, 24 weeks, 8 places.",
      what_you_will_do:
        "Research travel opportunities, plan itineraries and airport transfers, coordinate supervised corporate mobility and ride-hailing requirements, prepare movement plans, support quotations, market and sell approved travel products, handle customer cases and measure what you produce.",
      what_you_will_learn:
        "Corporate mobility, ride-hailing operations, airport transfers, itinerary planning, travel operations, fleet and logistics, tourism product development, travel sales, digital travel marketing and customer experience.",
      who_should_apply:
        "Students and recent completers from tourism, travel, hospitality, business, marketing, logistics, procurement, communication, digital marketing or IT programmes. A diploma is weighted equally with a degree — we assess mapped coursework, demonstrated competencies and verifiable evidence, including attachments, projects, events, customer service, sales and volunteer work.",
    },

    application_questions: [
      { question: "Describe a trip, event or movement you organised for other people. What did you plan, and what went wrong?", input: "Long text", required: true },
      { question: "A client needs an executive collected from JKIA at 06:40 and taken to a Westlands meeting at 08:00. List the information you would confirm before promising the service.", input: "Long text", required: true },
      { question: "Which coursework units are closest to travel operations, sales or logistics, and what did you actually do in them?", input: "Long text", required: true },
      { question: "Give one example of selling, persuading or recovering a customer relationship, with the outcome.", input: "Long text", required: true },
      { question: "Link to any evidence of your work: projects, content, campaigns, attachment reports or portfolios.", input: "Short text", required: false },
    ],
  };
}
