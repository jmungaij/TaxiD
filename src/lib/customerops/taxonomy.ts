/**
 * Customer Operations — configuration-driven case taxonomy, classification,
 * priority prediction and auto-escalation routing.
 *
 * Deterministic and dependency-free: no backend AI. The AI Copilot will later
 * replace `classifyCase` / `predictPriority` with model inference, but the
 * contract (inputs → CaseType / PriorityPrediction) stays identical.
 */

export type BusinessDomain =
  | "finance"
  | "logistics"
  | "driver_ops"
  | "rider_ops"
  | "trust_safety"
  | "corporate"
  | "fleet"
  | "marketplace"
  | "support";

export type CaseType =
  | "fraud"
  | "driver_conduct"
  | "lost_parcel"
  | "delayed_ride"
  | "payment_issue"
  | "refund_dispute"
  | "corporate_policy"
  | "safety_incident"
  | "vehicle_issue"
  | "delivery_failure"
  | "general_enquiry";

export interface CaseTypeDefinition {
  type: CaseType;
  label: string;
  /** Owning domain for auto-escalation (no human routing required). */
  domain: BusinessDomain;
  /** Team that receives the case on auto-route. */
  team: string;
  /** Legacy `support_cases.category` values that map to this type. */
  categories: string[];
  /** Lowercase keyword signals used for deterministic classification. */
  keywords: string[];
  /** Baseline severity weight (0-100) used by the priority predictor. */
  baseWeight: number;
  /** Domains this case type must be able to traverse end-to-end. */
  traverses: BusinessDomain[];
}

export const CASE_TYPES: CaseTypeDefinition[] = [
  {
    type: "safety_incident",
    label: "Safety incident",
    domain: "trust_safety",
    team: "Trust & Safety · Rapid Response",
    categories: ["safety"],
    keywords: ["assault", "accident", "harass", "unsafe", "threat", "sos", "injury", "emergency"],
    baseWeight: 95,
    traverses: ["trust_safety", "driver_ops", "rider_ops", "support"],
  },
  {
    type: "fraud",
    label: "Fraud",
    domain: "trust_safety",
    team: "Fraud Intelligence",
    categories: ["fraud"],
    keywords: ["fraud", "scam", "stolen", "unauthorised", "unauthorized", "chargeback", "fake"],
    baseWeight: 85,
    traverses: ["trust_safety", "finance", "rider_ops", "driver_ops"],
  },
  {
    type: "refund_dispute",
    label: "Refund dispute",
    domain: "finance",
    team: "Finance · Refunds & Disputes",
    categories: ["payment"],
    keywords: ["refund", "reversal", "dispute", "overcharge", "double charge", "money back"],
    baseWeight: 70,
    traverses: ["finance", "support", "driver_ops"],
  },
  {
    type: "payment_issue",
    label: "Payment issue",
    domain: "finance",
    team: "Finance · Payment Operations",
    categories: ["payment"],
    keywords: ["payment", "mpesa", "m-pesa", "wallet", "card", "failed transaction", "stk"],
    baseWeight: 60,
    traverses: ["finance", "support"],
  },
  {
    type: "lost_parcel",
    label: "Lost parcel",
    domain: "logistics",
    team: "Delivery & Logistics · Exceptions",
    categories: ["delivery"],
    keywords: ["lost", "never arrived", "missing parcel", "not delivered", "disappeared", "stolen parcel"],
    baseWeight: 75,
    traverses: ["logistics", "trust_safety", "finance", "driver_ops"],
  },
  {
    type: "delivery_failure",
    label: "Delivery failure",
    domain: "logistics",
    team: "Delivery & Logistics Ops",
    categories: ["delivery"],
    keywords: ["late delivery", "damaged", "wrong address", "failed delivery", "pod", "proof of delivery"],
    baseWeight: 55,
    traverses: ["logistics", "driver_ops", "finance"],
  },
  {
    type: "driver_conduct",
    label: "Driver conduct",
    domain: "driver_ops",
    team: "Driver Operations · Conduct",
    categories: ["driver"],
    keywords: ["rude", "driver behaviour", "driver behavior", "refused", "abusive", "smoking", "reckless"],
    baseWeight: 65,
    traverses: ["driver_ops", "trust_safety", "support"],
  },
  {
    type: "delayed_ride",
    label: "Delayed ride",
    domain: "marketplace",
    team: "Marketplace · Supply Operations",
    categories: ["general", "rentals"],
    keywords: ["late", "waiting", "no driver", "delay", "eta", "cancelled trip"],
    baseWeight: 40,
    traverses: ["marketplace", "driver_ops", "support"],
  },
  {
    type: "vehicle_issue",
    label: "Vehicle issue",
    domain: "fleet",
    team: "Fleet Operations",
    categories: ["rentals"],
    keywords: ["vehicle", "car broke", "breakdown", "dirty car", "tyre", "maintenance", "rental car"],
    baseWeight: 50,
    traverses: ["fleet", "driver_ops", "support"],
  },
  {
    type: "corporate_policy",
    label: "Corporate policy",
    domain: "corporate",
    team: "Enterprise Support · Corporate Success",
    categories: ["corporate"],
    keywords: ["policy", "cost center", "approval", "invoice", "department", "budget", "employee"],
    baseWeight: 55,
    traverses: ["corporate", "finance", "support"],
  },
  {
    type: "general_enquiry",
    label: "General enquiry",
    domain: "support",
    team: "Tier 1 Customer Operations",
    categories: ["general"],
    keywords: [],
    baseWeight: 20,
    traverses: ["support"],
  },
];

export const CASE_TYPE_BY_KEY = new Map(CASE_TYPES.map((t) => [t.type, t]));

export const DOMAIN_LABEL: Record<BusinessDomain, string> = {
  finance: "Finance",
  logistics: "Delivery & Logistics",
  driver_ops: "Driver Management",
  rider_ops: "Rider Management",
  trust_safety: "Trust & Safety",
  corporate: "Corporate Accounts",
  fleet: "Fleet",
  marketplace: "Marketplace",
  support: "Customer Operations",
};

export interface ClassificationInput {
  subject: string;
  description?: string | null;
  category?: string | null;
  channel?: string | null;
}

export interface Classification {
  type: CaseType;
  definition: CaseTypeDefinition;
  confidence: number;
  matchedSignals: string[];
}

/** Deterministic auto-classification: keyword evidence + category fallback. */
export function classifyCase(input: ClassificationInput): Classification {
  const text = `${input.subject ?? ""} ${input.description ?? ""}`.toLowerCase();
  let best: { def: CaseTypeDefinition; hits: string[] } | null = null;

  for (const def of CASE_TYPES) {
    const hits = def.keywords.filter((k) => text.includes(k));
    if (hits.length === 0) continue;
    if (!best || hits.length > best.hits.length || (hits.length === best.hits.length && def.baseWeight > best.def.baseWeight)) {
      best = { def, hits };
    }
  }

  if (best) {
    return {
      type: best.def.type,
      definition: best.def,
      confidence: Math.min(95, 55 + best.hits.length * 15),
      matchedSignals: best.hits,
    };
  }

  const byCategory =
    CASE_TYPES.find((t) => input.category && t.categories.includes(input.category) && t.type !== "general_enquiry") ??
    CASE_TYPE_BY_KEY.get("general_enquiry")!;

  return {
    type: byCategory.type,
    definition: byCategory,
    confidence: input.category ? 45 : 25,
    matchedSignals: input.category ? [`category:${input.category}`] : [],
  };
}

export interface PrioritySignals {
  /** Lifetime value / spend tier of the customer (0-100). */
  customerValue?: number;
  /** Corporate account attached to the case. */
  isCorporate?: boolean;
  /** Fraud score already stored on the case (0-100). */
  fraudScore?: number;
  /** Monetary exposure in KES. */
  amountKes?: number;
  /** Minutes remaining against the resolution SLA (negative = breached). */
  slaMinutesRemaining?: number | null;
  /** Count of prior cases from the same requester. */
  priorCases?: number;
}

export interface PriorityPrediction {
  priority: "low" | "medium" | "high" | "urgent";
  score: number;
  drivers: string[];
}

/** Predicted priority replaces manual selection; fully explainable. */
export function predictPriority(type: CaseType, s: PrioritySignals): PriorityPrediction {
  const def = CASE_TYPE_BY_KEY.get(type) ?? CASE_TYPE_BY_KEY.get("general_enquiry")!;
  let score = def.baseWeight;
  const drivers: string[] = [`Case type baseline (${def.label}) +${def.baseWeight}`];

  if (s.isCorporate) { score += 10; drivers.push("Corporate account +10"); }
  if ((s.customerValue ?? 0) >= 70) { score += 8; drivers.push("High-value customer +8"); }
  if ((s.fraudScore ?? 0) >= 60) { score += 12; drivers.push(`Fraud score ${s.fraudScore} +12`); }
  if ((s.amountKes ?? 0) >= 10000) { score += 8; drivers.push("Financial exposure ≥ KES 10,000 +8"); }
  if ((s.priorCases ?? 0) >= 3) { score += 6; drivers.push(`${s.priorCases} prior cases +6`); }
  if (s.slaMinutesRemaining != null) {
    if (s.slaMinutesRemaining <= 0) { score += 15; drivers.push("SLA already breached +15"); }
    else if (s.slaMinutesRemaining <= 60) { score += 9; drivers.push("SLA breach within 1h +9"); }
  }
  if (def.domain === "trust_safety") { score += 5; drivers.push("Legal / safety exposure +5"); }

  score = Math.max(0, Math.min(100, score));
  const priority = score >= 85 ? "urgent" : score >= 65 ? "high" : score >= 40 ? "medium" : "low";
  return { priority, score, drivers };
}

export interface EscalationRoute {
  domain: BusinessDomain;
  team: string;
  reason: string;
  immediate: boolean;
}

/** Auto-escalation: case type owns the destination — no human routing needed. */
export function autoEscalate(type: CaseType, isCorporate: boolean, priority: string): EscalationRoute {
  const def = CASE_TYPE_BY_KEY.get(type) ?? CASE_TYPE_BY_KEY.get("general_enquiry")!;
  if (isCorporate && def.domain === "support") {
    return {
      domain: "corporate",
      team: "Enterprise Support · Corporate Success",
      reason: "Corporate account overrides Tier 1 routing",
      immediate: false,
    };
  }
  return {
    domain: def.domain,
    team: def.team,
    reason: `${def.label} is owned by ${DOMAIN_LABEL[def.domain]}`,
    immediate: def.domain === "trust_safety" || priority === "urgent",
  };
}
