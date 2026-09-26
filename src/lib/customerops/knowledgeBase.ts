/**
 * Customer Operations — support knowledge base.
 *
 * Curated corpus the AI copilot searches so agents answer from policy instead
 * of memory: travel policies, FAQs, refund policy, travel rules, support
 * scripts and escalation guidance. Deterministic keyword+field scoring — no
 * network calls, safe to unit test.
 */
import type { CaseType } from "./taxonomy";

export type KnowledgeKind =
  | "policy"
  | "faq"
  | "travel_rule"
  | "refund_policy"
  | "script"
  | "escalation";

export const KNOWLEDGE_KIND_LABEL: Record<KnowledgeKind, string> = {
  policy: "Policy",
  faq: "FAQ",
  travel_rule: "Travel rule",
  refund_policy: "Refund policy",
  script: "Support script",
  escalation: "Escalation guide",
};

export interface KnowledgeArticle {
  id: string;
  kind: KnowledgeKind;
  title: string;
  /** Agent-facing summary — what the policy actually says. */
  summary: string;
  /** Insertable customer-facing text. */
  reply: string;
  keywords: string[];
  caseTypes?: CaseType[];
  /** Owning team for corrections. */
  owner: string;
  version: string;
}

export const KNOWLEDGE_BASE: KnowledgeArticle[] = [
  {
    id: "kb-refund-window",
    kind: "refund_policy",
    title: "Refund eligibility and processing windows",
    summary:
      "Fare disputes raised within 7 days of trip completion are eligible for review. Verified overcharges and duplicate charges are refunded in full. M-PESA reversals settle in 1-3 business days; wallet credits are instant.",
    reply:
      "I've reviewed your fare. Where an overcharge or duplicate payment is confirmed, we refund the full difference. M-PESA reversals reach your number within 1-3 business days, or I can credit your SAFARID wallet instantly if you prefer.",
    keywords: ["refund", "overcharge", "double charge", "duplicate", "reversal", "fare dispute", "money back"],
    caseTypes: ["payment_issue", "refund_dispute"],
    owner: "Finance Operations",
    version: "3.2",
  },
  {
    id: "kb-cancellation-fee",
    kind: "policy",
    title: "Cancellation fees",
    summary:
      "No fee if cancelled within 2 minutes of driver assignment or if the driver is more than 5 minutes late beyond the quoted ETA. Otherwise a fixed cancellation fee applies.",
    reply:
      "Cancellations within two minutes of driver assignment are free, and there is no fee at all when the driver runs more than five minutes past the quoted ETA. I've checked your trip and applied the policy accordingly.",
    keywords: ["cancel", "cancellation", "fee", "charged for cancelling", "driver late"],
    caseTypes: ["payment_issue", "delayed_ride"],
    owner: "Rider Operations",
    version: "2.4",
  },
  {
    id: "kb-corporate-travel-policy",
    kind: "travel_rule",
    title: "Corporate travel policy enforcement",
    summary:
      "Corporate trips must fall inside the employee's designation limit, approved cost centre and booking window. Out-of-policy trips route to the corporate approver before dispatch; the employee is never charged personally.",
    reply:
      "This booking sits outside your company's travel policy, so it has been routed to your approver rather than declined. You'll be notified as soon as they action it — no personal charge is raised in the meantime.",
    keywords: ["policy", "corporate", "approval", "cost centre", "cost center", "designation", "limit", "out of policy"],
    caseTypes: ["corporate_policy", "delayed_ride"],
    owner: "Corporate Mobility",
    version: "4.1",
  },
  {
    id: "kb-charter-quote-validity",
    kind: "travel_rule",
    title: "Charter quote validity and amendments",
    summary:
      "Charter quotes are valid for 48 hours from issue. Amendments inside 24 hours of departure require operations confirmation and may re-price the sector.",
    reply:
      "Your charter quote is held for 48 hours from issue. I can amend the itinerary for you — changes within 24 hours of departure need operations confirmation and may adjust the sector price, which I'll confirm before anything is charged.",
    keywords: ["charter", "quote", "expiry", "valid", "amend", "reschedule", "sector"],
    caseTypes: ["corporate_policy", "delayed_ride"],
    owner: "Charter Operations",
    version: "1.9",
  },
  {
    id: "kb-wallet-funding",
    kind: "faq",
    title: "How wallet funding is credited",
    summary:
      "Wallet balances are credited only after the verified M-PESA callback is received. Pending STK pushes are not balance. Receipts are deduplicated, so a repeated callback never double-credits.",
    reply:
      "Wallet top-ups are credited the moment we receive the verified M-PESA confirmation for your payment. If the STK prompt is still pending, the amount hasn't left your account yet — I'm watching the confirmation and will update you immediately.",
    keywords: ["wallet", "top up", "topup", "funding", "stk", "mpesa", "balance", "not credited"],
    caseTypes: ["payment_issue"],
    owner: "Finance Operations",
    version: "2.0",
  },
  {
    id: "kb-safety-incident",
    kind: "escalation",
    title: "Safety incident escalation",
    summary:
      "Any report involving injury, assault, threat, an accident or a stranded passenger is a P1: acknowledge within 5 minutes, escalate to Trust & Safety immediately, preserve trip telemetry and never negotiate compensation on the first contact.",
    reply:
      "I'm sorry — your safety comes first. I've escalated this to our Trust & Safety team as a priority case and preserved the trip record. A specialist will contact you directly, and I'll stay on this until they do.",
    keywords: ["safety", "accident", "assault", "unsafe", "threat", "stranded", "police", "injury", "emergency"],
    caseTypes: ["safety_incident", "driver_conduct"],
    owner: "Trust & Safety",
    version: "5.0",
  },
  {
    id: "kb-lost-item",
    kind: "script",
    title: "Lost item recovery script",
    summary:
      "Confirm the trip, contact the driver through the platform (never share numbers), agree a handover point and log the return. A handling fee applies only where the driver makes a dedicated return trip.",
    reply:
      "I've located your trip and I'm contacting the driver through our platform now. Once they confirm the item, we'll arrange a convenient handover point for you. If a dedicated return trip is needed, I'll confirm any handling fee with you first.",
    keywords: ["lost", "left", "phone", "bag", "item", "forgot", "recover"],
    caseTypes: ["lost_parcel"],
    owner: "Rider Operations",
    version: "2.2",
  },
  {
    id: "kb-delivery-sla",
    kind: "policy",
    title: "Delivery SLA and delay remedies",
    summary:
      "Same-day parcels carry a 4-hour SLA window. Breaches inside the platform's control credit the delivery fee; proof of delivery must be attached before any dispute is closed.",
    reply:
      "Your parcel is outside our 4-hour delivery window, which we treat as an SLA breach on our side. I've credited the delivery fee and I'm tracking the parcel through to handover, with proof of delivery attached to your case.",
    keywords: ["delivery", "parcel", "late", "delayed", "sla", "courier", "pod", "proof of delivery"],
    caseTypes: ["delivery_failure"],
    owner: "Logistics Operations",
    version: "3.0",
  },
  {
    id: "kb-invoice-request",
    kind: "faq",
    title: "Invoices, receipts and eTIMS",
    summary:
      "Every completed trip issues a KRA eTIMS-compliant receipt. Corporate invoices are issued per billing period with itemised trips, taxes and adjustments and are downloadable from the corporate portal.",
    reply:
      "Your KRA-compliant receipt is issued for every completed trip, and your company's itemised invoice for the period is available to download from the corporate portal. I've re-sent both to the email on your account.",
    keywords: ["invoice", "receipt", "etims", "kra", "vat", "statement", "billing document"],
    caseTypes: ["payment_issue", "corporate_policy"],
    owner: "Finance Operations",
    version: "2.6",
  },
  {
    id: "kb-driver-conduct",
    kind: "policy",
    title: "Driver conduct standards",
    summary:
      "Confirmed conduct breaches trigger a documented warning, retraining or deactivation depending on severity. Riders are never given the driver's personal details, and outcomes are shared as an action taken, not a named sanction.",
    reply:
      "Thank you for reporting this — driver conduct standards are non-negotiable for us. Your report is documented and reviewed by our driver quality team, and I'll confirm to you that action has been taken once the review closes.",
    keywords: ["driver", "rude", "conduct", "behaviour", "behavior", "complaint", "unprofessional"],
    caseTypes: ["driver_conduct"],
    owner: "Driver Operations",
    version: "3.4",
  },
  {
    id: "kb-data-privacy",
    kind: "policy",
    title: "Data privacy and access requests",
    summary:
      "Data access, correction and deletion requests are fulfilled within 30 days under the Kenya Data Protection Act. Identity must be verified before any personal data is released.",
    reply:
      "I can action your data request. Once I've verified your identity on the account, we fulfil access, correction and deletion requests within 30 days as required by the Kenya Data Protection Act, and I'll confirm each step to you.",
    keywords: ["privacy", "data", "delete", "gdpr", "dpa", "personal information", "access request"],
    caseTypes: ["general_enquiry"],
    owner: "Compliance",
    version: "1.8",
  },
  {
    id: "kb-service-recovery",
    kind: "script",
    title: "Service recovery and goodwill sizing",
    summary:
      "Goodwill is sized on trip value and SLA impact: up to 25% for a service miss, up to 100% for a failed trip, and finance approval above KES 5,000. Always apologise once, state the fix, then state the gesture.",
    reply:
      "I'm sorry this fell short of the standard you should expect. Here's what I've done to fix it, and I've added a goodwill credit to your account to acknowledge the disruption.",
    keywords: ["compensation", "goodwill", "credit", "sorry", "apology", "service recovery", "voucher"],
    owner: "Customer Operations",
    version: "2.1",
  },
];

export interface KnowledgeHit {
  article: KnowledgeArticle;
  score: number;
  matched: string[];
}

const tokenize = (s: string): string[] =>
  s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2);

/**
 * Ranks knowledge articles against a free-text query plus optional case
 * context. Keyword phrase hits weigh heaviest, then title/summary tokens,
 * then case-type affinity.
 */
export function searchKnowledge(
  query: string,
  opts: { caseType?: CaseType; kinds?: KnowledgeKind[]; limit?: number } = {},
): KnowledgeHit[] {
  const q = query.toLowerCase().trim();
  const tokens = tokenize(q);
  const pool = opts.kinds?.length
    ? KNOWLEDGE_BASE.filter((a) => opts.kinds!.includes(a.kind))
    : KNOWLEDGE_BASE;

  const hits = pool.map((article) => {
    const matched: string[] = [];
    let score = 0;

    for (const kw of article.keywords) {
      if (q && q.includes(kw)) { score += 12; matched.push(kw); }
      else if (tokens.some((t) => kw.includes(t))) { score += 4; matched.push(kw); }
    }
    const haystack = `${article.title} ${article.summary}`.toLowerCase();
    for (const t of tokens) if (haystack.includes(t)) score += 2;
    if (opts.caseType && article.caseTypes?.includes(opts.caseType)) {
      score += 8;
      matched.push(`case type ${opts.caseType}`);
    }
    return { article, score, matched: [...new Set(matched)] };
  });

  return hits
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score || a.article.title.localeCompare(b.article.title))
    .slice(0, opts.limit ?? 6);
}

/** Top articles for a case with no explicit query — used to prime the panel. */
export function knowledgeForCase(input: {
  subject?: string | null;
  description?: string | null;
  caseType?: CaseType;
}): KnowledgeHit[] {
  const query = `${input.subject ?? ""} ${input.description ?? ""}`.trim();
  const hits = searchKnowledge(query, { caseType: input.caseType, limit: 5 });
  if (hits.length > 0) return hits;
  return KNOWLEDGE_BASE.slice(0, 3).map((article) => ({ article, score: 0, matched: [] }));
}

/** Builds an insertable reply from selected articles, signed by the agent. */
export function composeSuggestedReply(
  articles: KnowledgeArticle[],
  ctx: { customerName?: string | null; agentName?: string | null; caseNumber?: string | null },
): string {
  const greeting = `Hi ${ctx.customerName?.split(" ")[0] ?? "there"},`;
  const body = articles.map((a) => a.reply).join("\n\n");
  const refs = articles.map((a) => `${KNOWLEDGE_KIND_LABEL[a.kind]}: ${a.title} (v${a.version})`);
  const sign = `Best regards,\n${ctx.agentName ?? "SAFARID Customer Operations"}${
    ctx.caseNumber ? `\nCase ${ctx.caseNumber}` : ""
  }`;
  return `${greeting}\n\n${body}\n\n${sign}\n\n— Sources: ${refs.join(" · ")}`;
}
