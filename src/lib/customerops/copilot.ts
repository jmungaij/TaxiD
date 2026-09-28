/**
 * Customer Operations — AI Mobility Operations Copilot.
 *
 * The copilot is an *agent assist* layer: every capability is declared here
 * with the role it requires, the platform service it reuses and whether it
 * writes. Deterministic drafting/sentiment run locally so the cockpit works
 * without a model round-trip; the same contract is what a gateway-backed
 * inference would fill in.
 */
import type { CaseType } from "./taxonomy";
import type { BusinessLine } from "./businessLines";

export type CopilotCategory =
  | "understand"
  | "respond"
  | "resolve"
  | "commerce"
  | "coordinate";

export interface CopilotAction {
  id: string;
  label: string;
  category: CopilotCategory;
  description: string;
  /** Existing platform capability reused — never a new backend. */
  reuses: string;
  /** Roles allowed to run the action. Empty = any operations role. */
  roles: string[];
  /** True when the action mutates platform state and must be audited. */
  writes: boolean;
}

export const COPILOT_ACTIONS: CopilotAction[] = [
  { id: "summarize_conversation", label: "Summarize conversation", category: "understand", description: "Condense the unified thread into a handover-ready brief.", reuses: "conversation threads", roles: [], writes: false },
  { id: "detect_sentiment", label: "Detect sentiment", category: "understand", description: "Classify tone and flag legal, fraud or safety risk.", reuses: "sentiment engine", roles: [], writes: false },
  { id: "identify_urgency", label: "Identify urgency", category: "understand", description: "Predict priority and SLA tier from case signals.", reuses: "taxonomy priority predictor", roles: [], writes: false },
  { id: "translate_conversation", label: "Translate conversation", category: "understand", description: "Render the thread in the customer's language.", reuses: "AI gateway", roles: [], writes: false },
  { id: "suggest_reply", label: "Suggest reply", category: "respond", description: "Draft a channel-appropriate response with policy citations.", reuses: "knowledge base", roles: [], writes: false },
  { id: "draft_email", label: "Draft email", category: "respond", description: "Compose a formal email for the customer or corporate contact.", reuses: "notifications", roles: [], writes: false },
  { id: "recommend_actions", label: "Recommend next actions", category: "respond", description: "Rank the next best actions from the matching playbook.", reuses: "playbooks", roles: [], writes: false },
  { id: "suggest_refund", label: "Suggest refund", category: "resolve", description: "Propose a refund amount with the supporting evidence trail.", reuses: "refunds & disputes", roles: ["finance_admin", "operations_admin", "admin", "super_admin"], writes: false },
  { id: "suggest_compensation", label: "Suggest compensation", category: "resolve", description: "Propose goodwill credit sized to impact and customer value.", reuses: "wallet ledger", roles: ["finance_admin", "operations_admin", "admin", "super_admin"], writes: false },
  { id: "explain_wallet", label: "Explain wallet transaction", category: "resolve", description: "Trace a wallet movement back to its verified payment event.", reuses: "wallet ledger", roles: [], writes: false },
  { id: "find_booking_history", label: "Find booking history", category: "resolve", description: "Retrieve every trip, charter, delivery and rental for the customer.", reuses: "Customer 360", roles: [], writes: false },
  { id: "find_invoice", label: "Find invoice or receipt", category: "commerce", description: "Locate and re-issue invoices and receipts, including eTIMS.", reuses: "tax & invoicing", roles: [], writes: false },
  { id: "generate_quotation", label: "Generate quotation", category: "commerce", description: "Build a priced quotation for the requested line of business.", reuses: "charter pricing engine", roles: ["operations_admin", "admin", "super_admin"], writes: true },
  { id: "recommend_upgrade", label: "Recommend vehicle upgrade", category: "commerce", description: "Offer a class upgrade that fits the passenger and budget profile.", reuses: "fleet inventory", roles: [], writes: false },
  { id: "book_on_behalf", label: "Book on behalf of customer", category: "coordinate", description: "Place an assisted booking with audited operator attribution.", reuses: "assisted booking desk", roles: ["operations_admin", "admin", "super_admin"], writes: true },
  { id: "schedule_callback", label: "Schedule callback", category: "coordinate", description: "Queue a callback with owner, window and reminder.", reuses: "notifications", roles: [], writes: true },
  { id: "search_knowledge", label: "Search knowledge base", category: "coordinate", description: "Retrieve policies, contract clauses, scripts and fleet documents.", reuses: "knowledge platform", roles: [], writes: false },
];

export const COPILOT_BY_ID = new Map(COPILOT_ACTIONS.map((a) => [a.id, a]));

export const COPILOT_CATEGORY_LABEL: Record<CopilotCategory, string> = {
  understand: "Understand",
  respond: "Respond",
  resolve: "Resolve",
  commerce: "Commerce",
  coordinate: "Coordinate",
};

/** Filters the catalogue to what this operator may actually run. */
export function availableCopilotActions(roles: string[]): CopilotAction[] {
  const owned = new Set(roles.map((r) => r.toLowerCase()));
  return COPILOT_ACTIONS.filter((a) => a.roles.length === 0 || a.roles.some((r) => owned.has(r)));
}

export function copilotActionAllowed(actionId: string, roles: string[]): boolean {
  const action = COPILOT_BY_ID.get(actionId);
  if (!action) return false;
  return action.roles.length === 0 || action.roles.some((r) => roles.map((x) => x.toLowerCase()).includes(r));
}

/* ----------------------------- sentiment -------------------------------- */

export type SentimentLabel =
  | "happy"
  | "neutral"
  | "frustrated"
  | "angry"
  | "urgent";

export type RiskFlag =
  | "legal_risk"
  | "fraud_risk"
  | "safety_risk"
  | "vip"
  | "high_value";

export interface SentimentResult {
  label: SentimentLabel;
  /** 0-100 negative intensity. */
  intensity: number;
  risks: RiskFlag[];
  /** True when the conversation must escalate immediately. */
  escalate: boolean;
  signals: string[];
}

const LEXICON: Array<{ words: string[]; label: SentimentLabel; weight: number }> = [
  { words: ["thank", "thanks", "excellent", "great service", "happy", "appreciate", "perfect"], label: "happy", weight: -30 },
  { words: ["please", "kindly", "enquiry", "question", "checking"], label: "neutral", weight: 0 },
  { words: ["still waiting", "again", "delayed", "slow", "no response", "disappointed", "frustrated"], label: "frustrated", weight: 35 },
  { words: ["unacceptable", "terrible", "furious", "angry", "worst", "never again", "scam"], label: "angry", weight: 60 },
  { words: ["urgent", "immediately", "asap", "stranded", "right now", "emergency", "stuck"], label: "urgent", weight: 55 },
];

const RISK_SIGNALS: Array<{ words: string[]; flag: RiskFlag }> = [
  { words: ["lawyer", "legal", "sue", "court", "regulator", "ombudsman", "data protection"], flag: "legal_risk" },
  { words: ["fraud", "unauthorised", "unauthorized", "chargeback", "stolen card", "not my transaction"], flag: "fraud_risk" },
  { words: ["accident", "assault", "harass", "unsafe", "injury", "threat", "sos"], flag: "safety_risk" },
];

export interface SentimentInput {
  text: string;
  isVip?: boolean;
  isCorporate?: boolean;
  lifetimeValueCents?: number;
}

const HIGH_VALUE_CENTS = 500_000; // KES 5,000+ lifetime spend

/** Deterministic sentiment + risk classification over conversation text. */
export function classifySentiment(input: SentimentInput): SentimentResult {
  const text = (input.text ?? "").toLowerCase();
  const signals: string[] = [];
  let intensity = 0;
  let label: SentimentLabel = "neutral";
  let bestWeight = -Infinity;

  for (const entry of LEXICON) {
    for (const w of entry.words) {
      if (!text.includes(w)) continue;
      signals.push(w);
      intensity += entry.weight;
      if (entry.weight > bestWeight) {
        bestWeight = entry.weight;
        label = entry.label;
      }
    }
  }
  if (bestWeight === -Infinity) label = "neutral";

  const risks: RiskFlag[] = [];
  for (const r of RISK_SIGNALS) {
    if (r.words.some((w) => text.includes(w))) {
      risks.push(r.flag);
      signals.push(r.flag);
    }
  }
  if (input.isVip) risks.push("vip");
  if ((input.lifetimeValueCents ?? 0) >= HIGH_VALUE_CENTS || input.isCorporate) risks.push("high_value");

  const clamped = Math.max(0, Math.min(100, intensity));
  const hardRisk = risks.some((r) => r === "legal_risk" || r === "fraud_risk" || r === "safety_risk");
  const escalate = hardRisk || clamped >= 55 || (risks.includes("vip") && clamped >= 30);

  return { label, intensity: clamped, risks: [...new Set(risks)], escalate, signals: [...new Set(signals)] };
}

/* --------------------------- drafting helpers ---------------------------- */

export interface DraftContext {
  customerName?: string | null;
  subject: string;
  caseNumber: string;
  caseType: CaseType;
  line: BusinessLine;
  sentiment: SentimentResult;
  nextActions: string[];
  agentName?: string | null;
}

/**
 * Composes an agent-ready reply. Tone follows sentiment; the body cites the
 * resolving line of business and the concrete next actions.
 */
export function draftReply(ctx: DraftContext): string {
  const name = ctx.customerName?.trim() || "there";
  const opener =
    ctx.sentiment.label === "angry" || ctx.sentiment.label === "frustrated"
      ? `Hi ${name}, I'm sorry for the disruption — I've taken ownership of this personally.`
      : ctx.sentiment.label === "urgent"
        ? `Hi ${name}, treating this as urgent and working it right now.`
        : `Hi ${name}, thank you for reaching out.`;

  const steps = ctx.nextActions.length
    ? ctx.nextActions.map((s, i) => `${i + 1}. ${s}`).join("\n")
    : "1. Reviewing the full record on your account and confirming the resolution.";

  return [
    opener,
    ``,
    `Reference ${ctx.caseNumber} — ${ctx.subject} (${ctx.line.label}).`,
    ``,
    `Here is exactly what happens next:`,
    steps,
    ``,
    ctx.sentiment.escalate
      ? `I've escalated this to our ${ctx.line.label} operations lead so it stays prioritised until closed.`
      : `I'll keep you updated at every step until this is fully closed.`,
    ``,
    `Warm regards,`,
    `${ctx.agentName?.trim() || "TaxiD Customer Operations"}`,
  ].join("\n");
}

export interface CompensationProposal {
  /** Recommended goodwill credit in cents. */
  amountCents: number;
  currency: "KES";
  rationale: string;
  requiresApproval: boolean;
  instrument: "wallet_credit" | "refund" | "service_recovery";
}

/**
 * Sizes goodwill compensation from trip value, impact and customer tier.
 * Anything above the desk threshold routes to finance approval.
 */
export function recommendCompensation(input: {
  tripValueCents: number;
  sentiment: SentimentResult;
  slaBreached: boolean;
  line: BusinessLine;
  repeatIssue?: boolean;
}): CompensationProposal {
  const base = Math.max(0, Math.round(input.tripValueCents));
  let pct = input.slaBreached ? 0.25 : 0.1;
  if (input.sentiment.label === "angry") pct += 0.15;
  if (input.sentiment.escalate) pct += 0.1;
  if (input.repeatIssue) pct += 0.1;
  if (input.line.slaTier === "vip") pct += 0.15;
  else if (input.line.slaTier === "priority") pct += 0.05;
  pct = Math.min(1, pct);

  const amountCents = Math.round(base * pct);
  const instrument: CompensationProposal["instrument"] =
    input.sentiment.risks.includes("legal_risk") ? "refund"
      : amountCents === 0 ? "service_recovery"
        : "wallet_credit";

  return {
    amountCents,
    currency: "KES",
    instrument,
    requiresApproval: amountCents > 500_000 || input.line.slaTier === "vip",
    rationale: [
      `${Math.round(pct * 100)}% of the affected ${input.line.label} value`,
      input.slaBreached ? "SLA breach" : "within SLA",
      `${input.sentiment.label} sentiment`,
      input.repeatIssue ? "repeat issue" : "first occurrence",
    ].join(" · "),
  };
}
