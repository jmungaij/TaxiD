/**
 * SPECIALIST PROGRAMME SEED — YMEITA-SM-001
 * Sales & Marketing Professional Internship (24 weeks, Nairobi).
 *
 * A supervised commercial programme, not an observational internship:
 * LEARN → PROSPECT → QUALIFY → ENGAGE → MARKET → QUOTE → CONVERT → SERVE →
 * RETAIN → ANALYSE → IMPROVE → DEVELOP.
 *
 * Governance boundaries this seed deliberately respects:
 *  - It never fabricates a position, staff identity, cohort, customer, booking
 *    or revenue figure. Those are resolved from authoritative records by the
 *    builder, or reported as outstanding assignments.
 *  - Programme and track references are CODES resolved against live records so
 *    no duplicate YMEITA programme or track is created.
 *  - Publication readiness is decided server-side by `rec_internship_validate`;
 *    the seed supplies the design only, never the verdict.
 *  - Commercial attribution is defined as SOURCE RECORD → ATTRIBUTION →
 *    VALIDATION → VERIFIED VALUE. Self-reported revenue is never verified.
 */
import type { InternshipProgrammeDraft } from "@/lib/interns/programmeBuilder";
import { emptyDraft } from "@/lib/interns/programmeBuilder";

/** Codes the builder resolves against live `intern_tracks` / `intern_programmes`. */
export const SM_SEED_REFERENCES = {
  programmeCode: "YMEITA",
  primaryTrackCode: "SALES",
  secondaryTrackCode: "MARKETING",
  developmentTrackCode: "CORPORATE",
  cohortName: "YMEITA-2026-SM-24W",
  programmeCodeSm: "YMEITA-SM-001",
  positionCode: "INT-SM-001",
} as const;

/** Assignments that must come from authoritative records before publication. */
export const SM_SEED_OUTSTANDING = [
  "Approved org position (INT-SM-001) or an authorised position exception",
  "Supervisor — Sales / Commercial",
  "Mentor — Sales & Marketing learning owner",
  "Approving manager — authorised Commercial / Sales manager",
  `Cohort ${SM_SEED_REFERENCES.cohortName} (create it in Cohorts, planned intake 12)`,
] as const;

/** The twelve learning domains of the specialist commercial curriculum. */
export const SM_LEARNING_DOMAINS = [
  "TaxiD Product Portfolio",
  "Customer Segmentation",
  "Prospecting & Lead Generation",
  "Lead Qualification & Discovery",
  "Telesales",
  "Field Sales",
  "Corporate & Enterprise Sales",
  "Quotations & Proposal Support",
  "Digital Marketing & SEO",
  "Content & Social Media",
  "CRM & Pipeline Discipline",
  "Sales Analytics & Commercial Judgement",
] as const;

/** The seven approved product families interns must be commercially competent in. */
export const SM_PRODUCT_FAMILIES = [
  "Ride-hailing",
  "Corporate mobility",
  "Airport transfers",
  "Charter",
  "Rentals & leasing",
  "Logistics",
  "Marketplace",
] as const;

/**
 * Performance weighting for this programme. Commercial contribution is weighted
 * highest because this is a commercial internship — but commercial score is
 * never raw revenue: it blends lead quality, conversion contribution, pipeline
 * discipline, process compliance, campaign performance and CRM discipline.
 */
export const SM_PERFORMANCE_WEIGHTS = {
  learning: 15,
  productivity: 20,
  quality: 15,
  commercial: 30,
  customer_operational: 10,
  conduct: 10,
} as const;

/** Additional scorecard lenses this programme exposes. */
export const SM_PERFORMANCE_LENSES = [
  "Lead quality",
  "Conversion contribution",
  "Pipeline discipline",
  "Sales process compliance",
  "Campaign performance",
  "CRM discipline",
  "Commercial judgement",
] as const;

/** Configurable DEMO productivity targets by phase — never production targets. */
export const SM_DEMO_TARGETS = [
  { phase: "Weeks 1–4", targets: "20 prospect records/week · 10 product-learning activities/week · 5 supervised customer simulations/week" },
  { phase: "Weeks 5–8", targets: "30 prospect records/week · 15 qualified conversations/week · 5 appointments/week" },
  { phase: "Weeks 9–12", targets: "20 qualified prospects/week · 5 proposals/week · 5 structured follow-ups/week" },
  { phase: "Weeks 13–16", targets: "1 campaign/week · 20 campaign-generated leads/month · 10 qualified digital leads/month" },
  { phase: "Weeks 17–20", targets: "20 active opportunities · 5 corporate accounts under development · 10 cross-sell opportunities" },
  { phase: "Weeks 21–24", targets: "Capstone pipeline · capstone campaign · commercial presentation · talent assessment" },
] as const;

/** Talent classifications — every one evidence-based. */
export const SM_TALENT_CLASSIFICATIONS = [
  "OBSERVING",
  "DEVELOPING",
  "PRODUCER",
  "HIGH POTENTIAL",
  "TALENT POOL",
  "CONVERSION REVIEW",
] as const;

/**
 * The seeded programme design. Intake calendar: 5 Oct 2026 → 19 Mar 2027,
 * applications close 18 Sep 2026 (deadline on or before start, as the server
 * also validates).
 */
export function salesMarketingSeed(): InternshipProgrammeDraft {
  const base = emptyDraft();
  return {
    ...base,
    title: "Sales & Marketing Professional Internship — Corporate Mobility, Digital Acquisition & Commercial Growth — Nairobi",
    location: "Nairobi, Kenya",
    position_id: "",
    position_exception_reason:
      "TaxiD is establishing a structured professional commercial-talent pipeline to support customer acquisition, corporate-business development, digital marketing and product activation. Production publication requires approval of the corresponding internship position (INT-SM-001) or an authorised exception.",
    work_arrangement: "hybrid",
    priority: "critical",
    headcount: 12,
    sla_days: 30,
    internship_type: "PROFESSIONAL",
    duration_weeks: 24,
    start_date: "2026-10-05",
    end_date: "2027-03-19",
    application_deadline: "2026-09-18",
    host_function: "Sales & Marketing",
    department: "Commercial Growth & Marketing",
    business_unit: "TaxiD",

    programme_purpose:
      "Develop commercially capable sales and marketing professionals who can identify market opportunities, generate qualified demand, acquire customers, develop corporate accounts, market TaxiD products and services, support quotations and bookings, maintain disciplined CRM records and contribute measurable commercial value under supervised operating controls. TaxiD requires a scalable commercial talent pipeline capable of professionally developing markets, generating qualified leads, converting customers, supporting corporate mobility acquisition, activating mobility products and building repeat demand across its ride-hailing, travel, logistics, rental, charter and mobility ecosystem.",

    learning_objectives: [
      {
        competency: "TaxiD product portfolio competence across the seven approved product families",
        evidence: "Product knowledge pack covering ride-hailing, corporate mobility, airport transfers, charter, rentals & leasing, logistics and marketplace, each with customer, problem, value proposition and commercial objective",
        assessment: "TaxiD Product Knowledge Assessment (gate at week 4)",
      },
      {
        competency: "Customer segmentation and value-proposition fit",
        evidence: "Segmentation map distinguishing B2C, SME, corporate, institutions, hotels, travel agencies, tour operators, schools, universities, NGOs, events, government and fleet/logistics buyers with channel, decision-maker and sales-cycle differences",
        assessment: "Supervisor review of segmentation reasoning",
      },
      {
        competency: "Prospecting and lead generation",
        evidence: "CRM prospect records with organisation, industry, location, decision-maker role, contact channel, mobility problem, candidate product, estimated opportunity, stage, next action and follow-up date",
        assessment: "Qualified Lead Generation Assessment (gate at week 8)",
      },
      {
        competency: "Lead qualification and customer discovery",
        evidence: "Qualification notes evidencing need, authority, budget indication, timeframe and product match",
        assessment: "Mentor audit of qualification quality, not volume",
      },
      {
        competency: "Telesales capability",
        evidence: "Call records: opening, permission, discovery, needs analysis, product match, objection handling, CTA, follow-up and CRM entry",
        assessment: "Call review rubric on quality and outcomes — call volume alone is never rewarded",
      },
      {
        competency: "Supervised field sales",
        evidence: "Field visit records for business, hotel, corporate, tour operator, event organiser, institutional or partner visits with need, product, outcome and next action",
        assessment: "Supervisor accompaniment and record audit",
      },
      {
        competency: "Corporate and enterprise account development",
        evidence: "Corporate target list plus a mobility needs assessment, transport-spend view, travel patterns and a corporate mobility proposal outline",
        assessment: "Commercial Portfolio Review (gate at week 20)",
      },
      {
        competency: "Quotation and proposal support",
        evidence: "Quotation requests prepared under supervision with requirement, product path, assumptions and follow-up trail",
        assessment: "Sales Simulation (gate at week 12)",
      },
      {
        competency: "Digital marketing, SEO and paid/organic acquisition understanding",
        evidence: "Keyword and search-intent research, competitor scan, landing-page brief, FAQ set and internal-linking recommendations for approved mobility keywords",
        assessment: "Campaign Performance Review (gate at week 16)",
      },
      {
        competency: "Content production and social distribution under approval",
        evidence: "Content items each carrying objective, audience, product, message, CTA, channel, campaign, owner, approval status and performance metrics",
        assessment: "Brand and approval compliance review — no unauthorised claims, pricing or confidential information",
      },
      {
        competency: "CRM and pipeline discipline",
        evidence: "Traceable interactions: customer/prospect, interaction, date, channel, need, product, stage, next action, owner and follow-up date",
        assessment: "CRM completeness audit; missing information reduces quality score",
      },
      {
        competency: "Sales analytics and commercial judgement",
        evidence: "Funnel analysis from impressions → engagement → click → lead → qualified lead → opportunity → customer, with a stated improvement action",
        assessment: "Capstone commercial case and final assessment (week 24)",
      },
    ],

    learning_outcomes: [
      { action: "Explain", competency: "Product portfolio competence", context: "Any of the seven approved TaxiD product families", evidence: "Passed product knowledge assessment" },
      { action: "Segment", competency: "Customer segmentation", context: "A Nairobi target market list", evidence: "Reviewed segmentation map" },
      { action: "Prospect", competency: "Lead generation", context: "Corporate, SME and institutional buyers", evidence: "CRM prospect records" },
      { action: "Qualify", competency: "Lead qualification", context: "Inbound and outbound leads", evidence: "Qualification notes with product match" },
      { action: "Conduct", competency: "Telesales", context: "Structured outbound calling", evidence: "Reviewed call records" },
      { action: "Visit", competency: "Field sales", context: "Supervised business and partner visits", evidence: "Field visit records" },
      { action: "Develop", competency: "Corporate account development", context: "A corporate employee-transport requirement", evidence: "Corporate mobility proposal outline" },
      { action: "Prepare", competency: "Quotation support", context: "A qualified mobility requirement", evidence: "Quotation request and follow-up trail" },
      { action: "Run", competency: "Marketing campaign execution", context: "One approved product activation", evidence: "Campaign report with funnel metrics" },
      { action: "Produce", competency: "Content and social distribution", context: "Approved content pillars", evidence: "Approved, published content assets" },
      { action: "Maintain", competency: "CRM discipline", context: "Daily commercial activity", evidence: "Audited CRM completeness" },
      { action: "Analyse", competency: "Sales analytics", context: "Own pipeline and campaign results", evidence: "Funnel analysis with improvement action" },
    ],

    productivity_mandate: [
      { output: "Prospect records created", cadence: "20–30 per week (stage-configurable)", system_of_record: "CRM" },
      { output: "Qualified leads", cadence: "5–15 per week (stage-configurable)", system_of_record: "CRM" },
      { output: "Sales conversations and appointments", cadence: "5 appointments per week from week 5", system_of_record: "CRM" },
      { output: "Proposals and quotation requests prepared", cadence: "5 per week from week 9", system_of_record: "Quotation engine" },
      { output: "Structured follow-ups", cadence: "5 per week", system_of_record: "CRM" },
      { output: "Marketing campaigns executed under supervision", cadence: "1 per week from week 13", system_of_record: "Marketing workspace" },
      { output: "Content assets drafted for approval", cadence: "3 per week", system_of_record: "Social distribution system" },
      { output: "Corporate accounts under active development", cadence: "5 concurrent from week 17", system_of_record: "CRM" },
      { output: "Customer interactions and service support cases", cadence: "5 per week", system_of_record: "Customer experience cases" },
    ],

    kpis: [
      { kpi: "Prospects created", target: "Stage target met, with CRM completeness ≥ 95%", evidence_source: "CRM" },
      { kpi: "Qualified leads", target: "Stage target met and accepted by supervisor", evidence_source: "CRM" },
      { kpi: "Appointments held", target: "≥ 5 per week from week 5", evidence_source: "CRM" },
      { kpi: "Opportunities and quotes supported", target: "≥ 5 proposals per week from week 9", evidence_source: "Quotation engine" },
      { kpi: "Campaign performance", target: "Reach, engagement, clicks, leads and qualified leads reported per campaign", evidence_source: "Marketing analytics" },
      { kpi: "Conversion contribution", target: "Attributed only from authoritative booking and transaction records", evidence_source: "Commercial transactions" },
      { kpi: "Verified commercial value", target: "SOURCE RECORD → ATTRIBUTION → VALIDATION → VERIFIED VALUE; self-reported revenue is never verified", evidence_source: "Commercial transactions" },
      { kpi: "CRM discipline", target: "≥ 95% audited record completeness", evidence_source: "Data integrity audit" },
    ],

    academic_eligibility: {
      qualification_level: "Certificate",
      programme_families: [
        "Commerce — Marketing",
        "Business Administration",
        "Sales & Marketing",
        "Business Management",
        "Public Relations",
        "Communication / Digital Communication",
        "Digital Marketing",
        "Tourism Management",
        "Hospitality Management",
        "Travel & Tourism",
        "Entrepreneurship",
        "Information Technology",
        "Data / Business Analytics",
      ],
      year_of_study: "Any year, including recent completers",
      minimum_grade:
        "No minimum grade and no minimum professional experience. Degree holders are not automatically ranked above diploma or certificate holders — capability is assessed from evidence",
      attachment_letter_required: false,
    },
    required_documents: [
      "University or college introduction letter",
      "Academic transcript",
      "Course unit list / curriculum outline",
      "National identification",
    ],

    curriculum_map: [
      { course: "Marketing and digital marketing units", capability: "Demand generation and campaign design", application: "Product activation campaigns for approved TaxiD products" },
      { course: "Sales and customer relationship units", capability: "Prospecting, qualification and closing support", application: "CRM pipeline from prospect to conversion" },
      { course: "Business communication and public relations", capability: "Professional commercial communication", application: "Telesales, corporate outreach and proposal support" },
      { course: "Entrepreneurship and business management", capability: "Commercial judgement and opportunity sizing", application: "Corporate target lists and opportunity estimates" },
      { course: "Tourism, travel and hospitality units", capability: "Travel and transfer demand understanding", application: "Airport transfer, charter and tourism-mobility selling" },
      { course: "Information systems / data and analytics units", capability: "Funnel and campaign analysis", application: "Sales analytics, CRM integrity and reporting" },
      { course: "Accounting or costing units", capability: "Cost, price and margin awareness", application: "Quotation support and commercial trade-off reasoning" },
      { course: "Media, content or design units", capability: "Content production", application: "Approved social and content assets" },
    ],

    competencies: [
      { competency: "Product knowledge across the seven TaxiD product families", evidence: "Passed product knowledge assessment", level: "Working" },
      { competency: "Prospecting and lead generation", evidence: "CRM prospect records", level: "Working" },
      { competency: "Qualification and discovery", evidence: "Qualification notes", level: "Working" },
      { competency: "Telesales", evidence: "Reviewed call records", level: "Working" },
      { competency: "Field sales", evidence: "Field visit records", level: "Awareness" },
      { competency: "Corporate account development", evidence: "Corporate proposal outline", level: "Awareness" },
      { competency: "Quotation and proposal support", evidence: "Quotation requests and follow-up trail", level: "Working" },
      { competency: "Digital marketing and SEO", evidence: "Keyword research and landing-page brief", level: "Awareness" },
      { competency: "Content and social distribution", evidence: "Approved content assets", level: "Working" },
      { competency: "CRM, pipeline and sales analytics discipline", evidence: "Audited CRM completeness and funnel analysis", level: "Working" },
    ],

    practical_capabilities: [
      "Prospecting and lead generation",
      "Lead qualification",
      "B2C and B2B selling",
      "Corporate account acquisition",
      "Telesales",
      "Field sales",
      "Product marketing",
      "Digital marketing and SEO",
      "Content and social media marketing",
      "CRM and pipeline management",
      "Quotations, proposals and follow-up",
      "Retention, cross-selling and upselling",
      "Market intelligence and sales analytics",
    ],

    experience_equivalency: [
      "Student sales or trading ventures",
      "Entrepreneurship",
      "Campus organisations and student leadership",
      "Digital marketing or content creation",
      "Customer service work",
      "Business projects and coursework fieldwork",
      "Previous internships or attachments",
      "Volunteer coordination work",
    ],

    assessment_design: [
      { stage: "Assessment 1 — TaxiD product knowledge", instrument: "Product knowledge assessment across the seven approved product families", weight: 15, passing: "Correct customer, problem, value proposition and product path per family" },
      { stage: "Assessment 2 — Market and segmentation analysis", instrument: "Target market and segmentation map for Nairobi", weight: 10, passing: "Distinct segments with channel, decision-maker and cycle logic" },
      { stage: "Assessment 3 — Qualified lead generation", instrument: "CRM prospect and qualification set", weight: 15, passing: "Qualified leads accepted by supervisor with complete records" },
      { stage: "Assessment 4 — Telesales call assessment", instrument: "Recorded or observed structured sales call", weight: 10, passing: "Discovery, product match, objection handling, CTA and CRM entry" },
      { stage: "Assessment 5 — Corporate mobility sales scenario", instrument: "Daily employee-transport requirement worked to a quotation pathway", weight: 15, passing: "Fleet, routes, schedule, billing, account structure and service level reasoned" },
      { stage: "Assessment 6 — Marketing campaign execution", instrument: "One supervised campaign, objective through report", weight: 10, passing: "Funnel metrics reported with lead quality, not impressions alone" },
      { stage: "Assessment 7 — Digital and SEO exercise", instrument: "Keyword research, search-intent analysis and landing-page brief", weight: 10, passing: "Demand evidence with an actionable, approval-respecting brief" },
      { stage: "Assessment 8 — Capstone commercial growth project", instrument: "TaxiD Commercial Growth Project: 15-minute presentation, 15-minute Q&A", weight: 15, passing: "Market, segment, persona, proposition, strategy, pipeline, risks and 90-day plan" },
    ],

    interview_framework: [
      { question: "TaxiD wants 20 new corporate customers in a market with limited brand awareness. Explain how you would identify prospects, reach decision-makers, qualify them, position TaxiD's products, create follow-up discipline and measure whether your strategy is working.", rubric: "Market understanding, prospecting, segmentation, value proposition, channel selection, sales process, measurement and commercial judgement", max_marks: 5 },
      { question: "A company needs daily employee transport for 60 staff on three routes. What would you establish before promising anything, and which TaxiD product path fits?", rubric: "Requirement gathering, fleet and route logic, billing, service level and product matching", max_marks: 5 },
      { question: "A prospect says TaxiD is too expensive. Respond.", rubric: "Objection handling without inventing pricing, value framing and next step", max_marks: 5 },
      { question: "How would you generate qualified leads for airport transfers using digital channels on a small budget?", rubric: "Channel choice, search intent, lead capture, qualification and measurement", max_marks: 5 },
      { question: "Describe the difference between an impression, a lead, a qualified lead and an opportunity, and why it matters commercially.", rubric: "Funnel literacy and honest measurement", max_marks: 5 },
      { question: "An SME needs courier and logistics support. What do you qualify before quoting?", rubric: "Volume, frequency, locations, service requirements and delivery expectations", max_marks: 5 },
      { question: "Tell us about a time you sold, persuaded or recovered a customer relationship. What was the outcome?", rubric: "Verifiable evidence of commercial initiative and outcome", max_marks: 5 },
      { question: "How do you keep a pipeline honest when targets are pressing?", rubric: "Integrity, CRM discipline and refusal to fabricate activity or revenue", max_marks: 5 },
    ],

    selection_weights: {
      academic_relevance: 10,
      curriculum_relevance: 10,
      competencies: 15,
      evidence: 20,
      assessment: 20,
      learning_agility: 10,
      communication: 5,
      problem_solving: 5,
      interview: 5,
    },

    talent_attributes: [
      "Learning velocity",
      "Execution",
      "Commercial judgement",
      "Initiative",
      "Discipline",
      "Communication",
      "Customer orientation",
      "Problem solving",
      "Data literacy",
      "Ownership",
      "Integrity",
      "Consistency",
    ],

    commercial_objective: {
      objective:
        "Generate qualified demand and support conversion across ride-hailing, corporate mobility, airport transfers, charter, rentals & leasing, logistics and marketplace, then retain and expand the customers won",
      measure:
        "LEAD_CREATED, LEAD_QUALIFIED, APPOINTMENT, OPPORTUNITY_CREATED, QUOTE_PREPARED, BOOKING_ASSIST, CUSTOMER_WON, REPEAT_CUSTOMER, CROSS_SELL and UPSELL events, scored alongside lead quality, pipeline discipline, process compliance and campaign performance",
      attribution_source:
        "Authoritative TaxiD records only (commercial transactions, quotations, bookings). SOURCE RECORD → ATTRIBUTION → VALIDATION → VERIFIED VALUE. An intern's self-reported revenue never becomes verified revenue, and DEMO records never enter live analytics.",
    },

    success_profile: [
      "Builds a qualified pipeline that survives supervisor scrutiny",
      "Matches a customer problem to the right TaxiD product without overselling",
      "Runs a campaign and reports the funnel honestly, including what failed",
      "Develops a corporate account from first contact to proposal support",
      "Keeps CRM records another seller can pick up cleanly",
      "Never invents pricing, customers, bookings or revenue",
    ],

    development_plan: [
      { phase: "Weeks 1–4 · LEARN", focus: "TaxiD orientation, product knowledge, sales and marketing fundamentals, CRM, customer service and commercial ethics", milestone: "Gate: Product Knowledge Certification" },
      { phase: "Weeks 5–8 · PROSPECT", focus: "Market research, lead generation, telesales, field prospecting, digital acquisition and corporate targeting", milestone: "Gate: Qualified Lead Generation Assessment" },
      { phase: "Weeks 9–12 · CONVERT", focus: "Discovery, needs analysis, product matching, quotations, proposals, objection handling and follow-up", milestone: "Gate: Sales Simulation" },
      { phase: "Weeks 13–16 · MARKET", focus: "Campaign design, digital campaigns, content, SEO, social distribution and corporate outreach", milestone: "Gate: Campaign Performance Review" },
      { phase: "Weeks 17–20 · OWN", focus: "Account development, pipeline management, cross-selling, upselling, retention and partner development", milestone: "Gate: Commercial Portfolio Review" },
      { phase: "Weeks 21–24 · PRODUCE & PROVE", focus: "Capstone commercial growth project, pipeline and campaign presentation, final assessment", milestone: "Gate: High-Potential Review — evidence-based talent decision" },
    ],

    public_preview: {
      summary:
        "Sales & Marketing Professional Internship — 24 weeks in Nairobi learning to generate demand, acquire customers, develop corporate accounts and market TaxiD's ride-hailing, corporate mobility, airport transfer, charter, rental, logistics and marketplace services. Hybrid and field, 12 places.",
      what_you_will_do:
        "Research markets, build prospect lists, run structured telesales and supervised field visits, qualify leads, support quotations and proposals, run product-activation campaigns, produce approved content, maintain disciplined CRM records and present a capstone commercial growth project.",
      what_you_will_learn:
        "Prospecting, qualification, B2C and B2B selling, corporate account acquisition, telesales, field sales, product and digital marketing, SEO, content and social media, CRM and pipeline management, quotations, retention, cross-selling and sales analytics.",
      who_should_apply:
        "Students and recent completers from marketing, business, commerce, communication, PR, digital marketing, tourism, hospitality, entrepreneurship, IT or analytics programmes. Certificate, diploma and degree holders are weighted equally, and no professional experience is required — we assess evidence of capability such as student sales, ventures, campus leadership, content creation, customer service, projects and volunteer work.",
    },

    application_questions: [
      { question: "Describe something you have sold, promoted or persuaded someone to do. What did you do, and what was the result?", input: "Long text", required: true },
      { question: "Pick one TaxiD service. Who would you sell it to in Nairobi, and how would you reach the decision-maker?", input: "Long text", required: true },
      { question: "Which coursework units are closest to sales, marketing or analytics, and what did you actually do in them?", input: "Long text", required: true },
      { question: "A prospect stops replying after you send a quotation. What are your next three actions?", input: "Long text", required: true },
      { question: "Link to any evidence of your work: campaigns, content, portfolios, social accounts you manage, projects or attachment reports.", input: "Short text", required: false },
    ],
  };
}
