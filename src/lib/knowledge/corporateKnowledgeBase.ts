/**
 * Corporate knowledge base for the AI mobility concierge.
 *
 * Curated, versioned enterprise content: travel policies, FAQs, contract
 * clauses, approval workflow rules and fleet documentation. Pure data plus a
 * deterministic retrieval scorer so answers are auditable and offline-safe.
 */

export type KnowledgeCategory =
  | "travel_policy"
  | "faq"
  | "contract_clause"
  | "approval_rule"
  | "fleet_doc";

export interface KnowledgeArticle {
  id: string;
  category: KnowledgeCategory;
  title: string;
  /** Short answer used by the concierge (1–3 sentences). */
  summary: string;
  /** Full body rendered in the knowledge browser. */
  body: string[];
  keywords: string[];
  /** Where the authoritative surface lives in-app. */
  sourceHref?: string;
  version: string;
  updatedAt: string;
}

export const KNOWLEDGE_CATEGORY_LABEL: Record<KnowledgeCategory, string> = {
  travel_policy: "Corporate travel policy",
  faq: "Frequently asked questions",
  contract_clause: "Contract clauses",
  approval_rule: "Approval workflow rules",
  fleet_doc: "Fleet documentation",
};

const V = "1.0.0";
const UPDATED = "2026-08-01";

export const KNOWLEDGE_BASE: KnowledgeArticle[] = [
  /* ------------------------------------------------------ travel policies */
  {
    id: "policy-spend-limits",
    category: "travel_policy",
    title: "Trip spend limits and out-of-policy handling",
    summary:
      "Every corporate account carries a per-trip limit, a monthly departmental budget and an approver chain. Trips above the limit are not blocked — they are routed to the named approver for a decision before dispatch.",
    body: [
      "Per-trip limits are configured per department on the corporate account and enforced by the policy engine at request time, not after the trip.",
      "A request that exceeds the per-trip limit, falls outside approved hours, or uses a non-approved vehicle class is marked out-of-policy and routed to the department approver.",
      "Approvers see the justification, estimated fare, route and policy rule that fired. Decisions are recorded with actor, timestamp and reason for audit.",
      "If no decision is made inside the approval SLA the request escalates to the next approver in the chain and, if still undecided, expires automatically.",
    ],
    keywords: ["spend", "limit", "budget", "out of policy", "policy", "cap", "threshold", "exceed"],
    sourceHref: "/dashboard/corporate?tab=policies",
    version: V,
    updatedAt: UPDATED,
  },
  {
    id: "policy-approved-classes",
    category: "travel_policy",
    title: "Approved vehicle classes by employee band",
    summary:
      "Standard staff travel is economy and comfort sedans or shared shuttles; executive and board travel unlocks chauffeur-driven premium classes. The planner only offers the classes your band permits.",
    body: [
      "Staff band: economy sedan, comfort sedan and shared staff shuttle for scheduled routes.",
      "Management band: comfort and business sedans, plus dedicated vans for group movements.",
      "Executive and board band: chauffeur-driven premium sedans and executive vans, with airport meet-and-greet available.",
      "Group movements of 12 passengers and above must use vans or coaches — multiple single-occupancy trips for the same route are automatically flagged for review.",
    ],
    keywords: ["vehicle class", "executive", "chauffeur", "sedan", "van", "coach", "band", "eligibility"],
    sourceHref: "/dashboard/corporate?tab=policies",
    version: V,
    updatedAt: UPDATED,
  },
  {
    id: "policy-cost-centres",
    category: "travel_policy",
    title: "Cost centres, departments and expense coding",
    summary:
      "Every trip must carry a cost centre and expense code. These flow to the monthly invoice line item so finance can reconcile spend by department without manual tagging.",
    body: [
      "Cost centres and expense codes are maintained on the corporate account and scoped per department, so employees only select codes they are entitled to use.",
      "Trip intent (client meeting, airport transfer, staff shuttle, after-hours) is captured at booking and printed on the invoice line.",
      "Invoice line items include employee, department, cost centre, route, timestamps and tax lines, so no separate expense claim is required.",
    ],
    keywords: ["cost centre", "cost center", "expense code", "department", "coding", "reconcile", "invoice line"],
    sourceHref: "/dashboard/corporate?tab=departments",
    version: V,
    updatedAt: UPDATED,
  },
  {
    id: "policy-after-hours",
    category: "travel_policy",
    title: "After-hours, night travel and duty of care",
    summary:
      "Night travel between 21:00 and 05:00 requires an approver decision and is dispatched only to vetted drivers with live trip sharing enabled for the safety desk.",
    body: [
      "After-hours requests always create an approval, regardless of fare, because duty of care overrides spend rules.",
      "Live trip sharing is enabled by default for night trips and the safety desk monitors the route to completion.",
      "Female staff travelling alone after hours can be routed to a preferred-driver pool where the corporate account has enabled it.",
    ],
    keywords: ["after hours", "night", "safety", "duty of care", "late", "21:00", "escort"],
    version: V,
    updatedAt: UPDATED,
  },

  /* --------------------------------------------------------------- FAQs */
  {
    id: "faq-billing-cycle",
    category: "faq",
    title: "When are corporate invoices issued and when is payment due?",
    summary:
      "Invoices are issued at the close of each billing period with itemised trip lines and eTIMS tax data. Payment terms default to the days configured on your account (commonly 30 days from issue).",
    body: [
      "The billing period closes automatically, generating one consolidated invoice per corporate account with per-trip line items.",
      "Each invoice carries subtotal, tax total, adjustments, amount paid and outstanding balance, and is downloadable as PDF or CSV.",
      "Receipts are issued per settlement and appear against the invoice in your statement.",
      "Statements for any period can be downloaded from the account command centre.",
    ],
    keywords: ["invoice", "billing", "payment terms", "due", "statement", "receipt", "cycle"],
    sourceHref: "/dashboard/corporate?tab=billing",
    version: V,
    updatedAt: UPDATED,
  },
  {
    id: "faq-wallet-prefunded",
    category: "faq",
    title: "How does the pre-funded corporate wallet work?",
    summary:
      "Top up the corporate wallet by M-Pesa paybill or bank transfer using your account reference. Trips draw down the wallet balance, and low-balance alerts fire before dispatch is affected.",
    body: [
      "Each corporate account has a unique paybill reference; funds credited against it are posted to the corporate cash ledger with a full audit trail.",
      "Wallet drawdowns are recorded per trip so the ledger always reconciles to trip and invoice records.",
      "Low-balance and arrears alerts are raised to your account managers and to the TaxiD operations desk.",
      "Accounts on credit terms invoice in arrears instead of drawing down a wallet balance.",
    ],
    keywords: ["wallet", "top up", "paybill", "mpesa", "m-pesa", "balance", "prefunded", "credit limit"],
    sourceHref: "/dashboard/corporate?tab=wallet",
    version: V,
    updatedAt: UPDATED,
  },
  {
    id: "faq-onboarding-docs",
    category: "faq",
    title: "What documents are needed to activate a corporate account?",
    summary:
      "CR12, certificate of incorporation, KRA PIN certificate, a valid tax compliance certificate, director identification and the signed corporate agreement.",
    body: [
      "Documents are uploaded in the corporate portal and reviewed by the compliance desk; each has a status and, where relevant, an expiry date.",
      "Expiring documents raise in-app and email alerts 30 days before expiry so account access is never interrupted.",
      "An account is activated once all required documents are approved and the agreement is countersigned.",
    ],
    keywords: ["documents", "kyb", "cr12", "kra pin", "tax compliance", "activate", "onboarding", "incorporation"],
    sourceHref: "/dashboard/corporate?tab=documents",
    version: V,
    updatedAt: UPDATED,
  },
  {
    id: "faq-cancellation",
    category: "faq",
    title: "What are the cancellation and no-show rules?",
    summary:
      "Scheduled trips cancelled more than 60 minutes before pickup are free. Inside 60 minutes a mobilisation fee applies, and a no-show after 15 minutes of waiting is billed as a completed minimum-fare trip.",
    body: [
      "Charter and coach movements have their own notice windows stated on the quotation, typically 24 to 72 hours.",
      "Cancellation fees are itemised on the invoice with the trip reference so they can be challenged through the dispute desk.",
      "Repeated late cancellations on the same cost centre are surfaced to the corporate administrator.",
    ],
    keywords: ["cancel", "cancellation", "no show", "no-show", "waiting", "fee", "penalty"],
    version: V,
    updatedAt: UPDATED,
  },
  {
    id: "faq-support-sla",
    category: "faq",
    title: "What support response times apply to corporate accounts?",
    summary:
      "Critical live-trip and safety issues are answered within 15 minutes, operational issues within 2 hours during business hours, and billing queries within one business day.",
    body: [
      "Corporate accounts have a named account manager plus 24/7 access to the operations desk for live trips.",
      "Tickets raised through the corporate portal are tracked with internal notes and resolution timestamps.",
      "Service-level compliance is reported back to you in the account command centre.",
    ],
    keywords: ["support", "sla", "response time", "escalation", "help", "ticket", "account manager"],
    version: V,
    updatedAt: UPDATED,
  },

  /* ---------------------------------------------------- contract clauses */
  {
    id: "clause-pricing-validity",
    category: "contract_clause",
    title: "Clause 4 — Pricing, rate card validity and fuel adjustment",
    summary:
      "Contract rates are fixed for the stated term and applied automatically to every quote. Fuel-linked adjustment applies only where the pump price moves beyond the agreed band, with 30 days' written notice.",
    body: [
      "Rate cards are governed centrally: quotes are priced from the contracted card, never from ad-hoc pricing.",
      "Any adjustment requires written notice and takes effect only for trips booked after the notice period.",
      "Surge pricing does not apply to contracted corporate rates unless expressly agreed in the schedule.",
    ],
    keywords: ["pricing", "rate card", "clause", "fuel", "surge", "validity", "adjustment", "contract rate"],
    version: V,
    updatedAt: UPDATED,
  },
  {
    id: "clause-liability-insurance",
    category: "contract_clause",
    title: "Clause 7 — Insurance, liability and duty of care",
    summary:
      "All vehicles carry statutory passenger liability cover; operators maintain comprehensive insurance and PSV licensing, and evidence is held in the fleet document registry.",
    body: [
      "Insurance certificates, inspection certificates and PSV licences are tracked per vehicle with expiry monitoring.",
      "Vehicles with lapsed compliance documents are automatically withheld from corporate dispatch.",
      "Incident reporting, investigation and remediation timelines are defined in the service schedule.",
    ],
    keywords: ["insurance", "liability", "psv", "clause", "cover", "indemnity", "incident"],
    version: V,
    updatedAt: UPDATED,
  },
  {
    id: "clause-data-protection",
    category: "contract_clause",
    title: "Clause 11 — Data protection and confidentiality",
    summary:
      "Employee and trip data is processed under the Kenya Data Protection Act as your processor, limited to service delivery, with access controls, audit logging and defined retention.",
    body: [
      "Access to corporate data is role-scoped and every privileged read or export is written to an immutable audit log.",
      "Personal data is retained only for the contractual retention period and then anonymised for statistical use.",
      "Sub-processors are disclosed and subject to equivalent obligations.",
    ],
    keywords: ["data protection", "privacy", "confidentiality", "gdpr", "kdpa", "retention", "audit", "clause"],
    version: V,
    updatedAt: UPDATED,
  },
  {
    id: "clause-termination",
    category: "contract_clause",
    title: "Clause 15 — Term, renewal and termination",
    summary:
      "Agreements run for 12 months and renew automatically unless either party gives 60 days' written notice. Outstanding invoices remain payable on termination.",
    body: [
      "Renewal pricing is confirmed at least 60 days before the renewal date.",
      "Either party may terminate for material breach with 30 days to remedy.",
      "On termination, statements, invoices and trip records remain available for download for the retention period.",
    ],
    keywords: ["termination", "renewal", "term", "notice", "exit", "clause", "breach"],
    version: V,
    updatedAt: UPDATED,
  },

  /* ----------------------------------------------------- approval rules */
  {
    id: "rule-approval-chain",
    category: "approval_rule",
    title: "Approval chain, delegation and escalation",
    summary:
      "Requests route to the department approver, then to the corporate administrator if the SLA lapses. Approvers can delegate for a fixed window, and every decision is auditable.",
    body: [
      "Step 1 — the department approver reviews the request against the policy rule that fired.",
      "Step 2 — if no decision is taken inside the SLA (4 hours by default), the request escalates to the corporate administrator.",
      "Step 3 — unresolved requests expire and the employee is notified to rebook; nothing is silently approved.",
      "Delegations are time-boxed with start and end dates, and delegated decisions record both the delegate and the original approver.",
    ],
    keywords: ["approval", "chain", "approver", "escalation", "delegate", "delegation", "sla", "workflow"],
    sourceHref: "/dashboard/corporate?tab=approvals",
    version: V,
    updatedAt: UPDATED,
  },
  {
    id: "rule-auto-approve",
    category: "approval_rule",
    title: "Auto-approval conditions",
    summary:
      "In-policy trips inside the per-trip limit, during approved hours, on an approved vehicle class and with budget remaining are auto-approved and dispatched immediately.",
    body: [
      "Auto-approval requires all four conditions to hold: fare within limit, time inside approved hours, approved vehicle class and remaining departmental budget.",
      "Auto-approved trips are still logged with the evaluated rule set so finance can reconstruct why no human decision was needed.",
      "Auto-approval is disabled automatically when the account is in arrears or the wallet balance is below the dispatch floor.",
    ],
    keywords: ["auto approve", "automatic", "instant", "dispatch", "in policy", "rules"],
    version: V,
    updatedAt: UPDATED,
  },
  {
    id: "rule-charter-approval",
    category: "approval_rule",
    title: "Charter and group movement approvals",
    summary:
      "Charter quotations require a commercial authority decision: quotes above the delegated threshold need finance or executive sign-off before the mission is confirmed.",
    body: [
      "Charter requests follow the RFQ lifecycle: draft, submitted, under review, approved, then won once the client confirms.",
      "Approval authority is derived from role and value band; a user without commercial authority can prepare but not approve.",
      "Approved quotations generate an itemised, tax-compliant document with a verification seal.",
    ],
    keywords: ["charter", "rfq", "quotation", "group", "coach", "authority", "sign-off", "approval"],
    sourceHref: "/dashboard/charter/portal",
    version: V,
    updatedAt: UPDATED,
  },

  /* -------------------------------------------------- fleet documentation */
  {
    id: "fleet-classes",
    category: "fleet_doc",
    title: "Fleet classes and seating capacity",
    summary:
      "Economy and comfort sedans seat up to 4, executive sedans 3, executive vans 6–7, minibuses 14–19 and coaches 33–51 passengers.",
    body: [
      "Sedan classes cover point-to-point staff and executive travel within the city and airport transfers.",
      "Executive vans (for example the premium MPV class) are used for board movements, delegations and airport meet-and-greet.",
      "Minibuses and coaches serve staff shuttles, event movements and up-country programmes with a driver and route supervisor.",
      "Specialist categories include refrigerated logistics vehicles and long-term leased pool vehicles.",
    ],
    keywords: ["fleet", "capacity", "seats", "sedan", "van", "minibus", "coach", "classes", "vehicles"],
    sourceHref: "/dashboard/admin/corporate-os",
    version: V,
    updatedAt: UPDATED,
  },
  {
    id: "fleet-compliance-docs",
    category: "fleet_doc",
    title: "Vehicle compliance documentation and inspection cycle",
    summary:
      "Each vehicle carries insurance, PSV licence, inspection certificate and service record. Expiry is monitored and non-compliant vehicles are withheld from dispatch.",
    body: [
      "Compliance documents are tracked per vehicle with expiry dates and a 30-day advance alert.",
      "Preventive maintenance is scheduled by odometer interval; vehicles approaching the interval appear in the maintenance-due queue.",
      "Inspection results, incident history and telematics integrity signals are held against the vehicle record.",
    ],
    keywords: ["compliance", "inspection", "insurance", "psv", "maintenance", "service", "expiry", "documents"],
    version: V,
    updatedAt: UPDATED,
  },
  {
    id: "fleet-driver-standards",
    category: "fleet_doc",
    title: "Driver vetting and corporate service standards",
    summary:
      "Corporate drivers are background-checked, licence-verified, trained on executive service standards and continuously scored on punctuality, safety and rating.",
    body: [
      "Onboarding requires licence verification, certificate of good conduct, training completion and vehicle compliance sign-off.",
      "Driver scores combine acceptance, punctuality, safety telemetry and passenger ratings; scores below threshold remove corporate dispatch eligibility.",
      "Named-driver pools can be assigned to an account for executive or recurring routes.",
    ],
    keywords: ["driver", "vetting", "background check", "training", "standards", "rating", "good conduct"],
    version: V,
    updatedAt: UPDATED,
  },
];

/* ----------------------------------------------------------------- retrieval */

const STOP = new Set([
  "the", "a", "an", "and", "or", "of", "to", "for", "is", "are", "do", "does", "how", "what",
  "when", "who", "why", "can", "i", "we", "my", "our", "you", "your", "in", "on", "at", "it",
  "be", "with", "about", "please", "me",
]);

export const tokenize = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));

export interface KnowledgeHit {
  article: KnowledgeArticle;
  score: number;
  matched: string[];
}

/**
 * Deterministic keyword/BM25-lite scorer: keyword hits weigh most, then title,
 * summary and body. Returns hits sorted by score, strongest first.
 */
export function searchKnowledge(query: string, limit = 5): KnowledgeHit[] {
  const tokens = tokenize(query);
  if (!tokens.length) return [];
  const hits: KnowledgeHit[] = [];
  for (const article of KNOWLEDGE_BASE) {
    const keywords = article.keywords.map((k) => k.toLowerCase());
    const title = article.title.toLowerCase();
    const summary = article.summary.toLowerCase();
    const body = article.body.join(" ").toLowerCase();
    let score = 0;
    const matched: string[] = [];
    for (const t of tokens) {
      let s = 0;
      if (keywords.some((k) => k === t)) s += 6;
      else if (keywords.some((k) => k.includes(t))) s += 4;
      if (title.includes(t)) s += 3;
      if (summary.includes(t)) s += 2;
      if (body.includes(t)) s += 1;
      if (s > 0) {
        score += s;
        matched.push(t);
      }
    }
    if (score > 0) hits.push({ article, score, matched });
  }
  return hits
    .sort((a, b) => b.score - a.score || a.article.id.localeCompare(b.article.id))
    .slice(0, limit);
}

export interface KnowledgeAnswer {
  article: KnowledgeArticle;
  lines: string[];
  confidence: "high" | "medium" | "low";
  related: KnowledgeArticle[];
  citation: string;
}

/** Retrieval-grounded answer for the concierge, or null when nothing is relevant. */
export function answerFromKnowledge(query: string): KnowledgeAnswer | null {
  const hits = searchKnowledge(query, 4);
  if (!hits.length) return null;
  const [best, ...rest] = hits;
  if (best.score < 4) return null;
  return {
    article: best.article,
    lines: [best.article.summary, ...best.article.body.slice(0, 2)],
    confidence: best.score >= 12 ? "high" : best.score >= 7 ? "medium" : "low",
    related: rest.map((h) => h.article),
    citation: `${KNOWLEDGE_CATEGORY_LABEL[best.article.category]} · ${best.article.title} (v${best.article.version})`,
  };
}

export const knowledgeByCategory = (category: KnowledgeCategory): KnowledgeArticle[] =>
  KNOWLEDGE_BASE.filter((a) => a.category === category);

export const knowledgeStats = (): Array<{ category: KnowledgeCategory; label: string; count: number }> =>
  (Object.keys(KNOWLEDGE_CATEGORY_LABEL) as KnowledgeCategory[]).map((c) => ({
    category: c,
    label: KNOWLEDGE_CATEGORY_LABEL[c],
    count: knowledgeByCategory(c).length,
  }));
