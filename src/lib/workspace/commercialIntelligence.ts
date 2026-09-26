/**
 * STAGE 10 — COMMERCIAL INTELLIGENCE.
 *
 * Derived judgement on top of the Stage 8/9 records. Four readings:
 *   opportunity health   → stage progress vs idle time vs proposal coverage
 *   proposal momentum    → issued → sent → decided, and validity burn-down
 *   contract renewal risk→ term end vs status vs live schedules
 *   account engagement   → recorded interactions (email/meeting/call) cadence
 *
 * Laws:
 *  1. Every score is explained by named recorded facts. No opaque numbers.
 *  2. A reading is only produced when the source record carries the field it
 *     needs; otherwise the reading is `unknown` with the reason stated.
 *  3. This module is PURE. Fetching lives at the bottom of the file, in thin
 *     reads against the authoritative tables.
 */
import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type Band = "strong" | "watch" | "at_risk" | "critical" | "unknown";

export interface Reading {
  /** 0–100 where 100 is healthiest. Null when it cannot be computed. */
  score: number | null;
  band: Band;
  headline: string;
  reasons: string[];
}

export const BAND_LABEL: Record<Band, string> = {
  strong: "Healthy",
  watch: "Watch",
  at_risk: "At risk",
  critical: "Critical",
  unknown: "Not enough recorded",
};

const dayMs = 86_400_000;

export const daysSince = (iso: string | null | undefined, now: Date = new Date()): number | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? Math.floor((now.getTime() - t) / dayMs) : null;
};

export const daysUntil = (iso: string | null | undefined, now: Date = new Date()): number | null => {
  const d = daysSince(iso, now);
  return d == null ? null : -d;
};

const bandFromScore = (score: number): Band =>
  score >= 70 ? "strong" : score >= 50 ? "watch" : score >= 30 ? "at_risk" : "critical";

/* --------------------------------------------------- opportunity health */

const STAGE_PROGRESS: Record<string, number> = {
  new: 10,
  qualified: 30,
  quoted: 50,
  proposal: 55,
  negotiation: 75,
  won: 100,
  lost: 0,
};

export interface OpportunityInput {
  stage: string;
  updatedAt: string | null;
  valueCents: number | null;
  probabilityPct: number | null;
  hasProposal: boolean;
}

export function opportunityHealth(input: OpportunityInput, now: Date = new Date()): Reading {
  const stage = (input.stage ?? "").toLowerCase();
  const progress = STAGE_PROGRESS[stage];
  const idle = daysSince(input.updatedAt, now);
  const reasons: string[] = [];

  if (progress == null) {
    return {
      score: null,
      band: "unknown",
      headline: `Stage "${input.stage}" is not on the commercial ladder`,
      reasons: ["The recorded stage is not one the pipeline recognises, so progress cannot be read."],
    };
  }
  if (stage === "won") return { score: 100, band: "strong", headline: "Won", reasons: ["Recorded as won."] };
  if (stage === "lost") return { score: 0, band: "critical", headline: "Lost", reasons: ["Recorded as lost."] };

  let score = 40 + progress * 0.4; // 44–70 before signals
  reasons.push(`Stage is ${stage.replace(/_/g, " ")} (${progress}% of the ladder).`);

  if (idle == null) {
    reasons.push("No last-activity date is recorded, so idle time cannot be read.");
  } else if (idle >= 21) {
    score -= 35;
    reasons.push(`No movement for ${idle} days.`);
  } else if (idle >= 10) {
    score -= 20;
    reasons.push(`No movement for ${idle} days.`);
  } else if (idle >= 5) {
    score -= 10;
    reasons.push(`Last moved ${idle} days ago.`);
  } else {
    score += 8;
    reasons.push(idle <= 0 ? "Moved today." : `Moved ${idle} day(s) ago.`);
  }

  if (["quoted", "proposal", "negotiation"].includes(stage)) {
    if (input.hasProposal) {
      score += 10;
      reasons.push("A priced proposal is on record.");
    } else {
      score -= 20;
      reasons.push("Stage expects a proposal, but none is on record.");
    }
  }

  if (input.probabilityPct != null) {
    score += (input.probabilityPct - 50) * 0.1;
    reasons.push(`Owner's recorded confidence is ${input.probabilityPct}%.`);
  }
  if (input.valueCents == null) reasons.push("No expected value is recorded, so impact cannot be weighed.");

  const bounded = Math.max(0, Math.min(100, Math.round(score)));
  const band = bandFromScore(bounded);
  const headline =
    band === "strong"
      ? "Progressing"
      : band === "watch"
        ? "Needs a next step"
        : idle != null && idle >= 21
          ? "Stalled — no movement for weeks"
          : "Losing momentum";
  return { score: bounded, band, headline, reasons };
}

/* ---------------------------------------------------- proposal momentum */

export interface ProposalInput {
  status: string;
  approvalStatus: string | null;
  createdAt: string;
  validUntil: string | null;
  totalAmount: number | null;
}

export function proposalMomentum(input: ProposalInput, now: Date = new Date()): Reading {
  const status = (input.status ?? "").toLowerCase();
  const age = daysSince(input.createdAt, now) ?? 0;
  const validity = daysUntil(input.validUntil, now);
  const reasons: string[] = [`Issued ${age} day(s) ago.`];
  let score = 60;

  if (status === "accepted") return { score: 100, band: "strong", headline: "Accepted", reasons: ["Customer accepted."] };
  if (["rejected", "declined"].includes(status))
    return { score: 0, band: "critical", headline: "Rejected", reasons: ["Customer declined."] };

  if (status === "draft") {
    score -= age >= 3 ? 30 : 10;
    reasons.push(age >= 3 ? `Still a draft after ${age} days — it has not reached the customer.` : "Still a draft.");
  }
  if (status === "sent") {
    reasons.push("Sent — awaiting the customer.");
    if (age >= 10) {
      score -= 25;
      reasons.push(`No response in ${age} days.`);
    } else if (age >= 5) {
      score -= 12;
      reasons.push(`No response in ${age} days.`);
    }
  }
  if (input.approvalStatus && !["approved", "not_required", "none"].includes(input.approvalStatus.toLowerCase())) {
    score -= 15;
    reasons.push(`Internal approval is ${input.approvalStatus.replace(/_/g, " ")}.`);
  }
  if (validity == null) {
    reasons.push("No validity date is recorded.");
  } else if (validity < 0) {
    score -= 35;
    reasons.push(`Validity expired ${Math.abs(validity)} day(s) ago.`);
  } else if (validity <= 7) {
    score -= 18;
    reasons.push(`Validity ends in ${validity} day(s).`);
  }
  if (input.totalAmount == null) reasons.push("No priced total is recorded on this proposal.");

  const bounded = Math.max(0, Math.min(100, Math.round(score)));
  const band = bandFromScore(bounded);
  return {
    score: bounded,
    band,
    headline:
      validity != null && validity < 0
        ? "Expired — reissue or withdraw"
        : status === "draft"
          ? "Not yet with the customer"
          : band === "strong"
            ? "Moving"
            : "Chase the customer",
    reasons,
  };
}

/** Months in a free-text contract term, e.g. "12 months", "2 years". */
export function termMonths(term: string | null | undefined): number | null {
  if (!term) return null;
  const t = term.toLowerCase();
  const years = /(\d+(?:\.\d+)?)\s*(year|yr)/.exec(t);
  if (years) return Math.round(Number(years[1]) * 12);
  const months = /(\d+)\s*month/.exec(t);
  if (months) return Number(months[1]);
  return null;
}

/* ------------------------------------------------ contract renewal risk */

export interface ContractInput {
  status: string;
  effectiveDate: string | null;
  contractTerm: string | null;
  hasApprovedSchedule: boolean;
}

export interface RenewalReading extends Reading {
  renewalDate: string | null;
  daysToRenewal: number | null;
}

export function renewalRisk(input: ContractInput, now: Date = new Date()): RenewalReading {
  const status = (input.status ?? "").toLowerCase();
  const months = termMonths(input.contractTerm);
  const reasons: string[] = [`Contract status is ${status.replace(/_/g, " ") || "unknown"}.`];

  let renewalDate: string | null = null;
  let daysToRenewal: number | null = null;
  if (input.effectiveDate && months != null) {
    const start = new Date(input.effectiveDate);
    if (!Number.isNaN(start.getTime())) {
      const end = new Date(start);
      end.setMonth(end.getMonth() + months);
      renewalDate = end.toISOString().slice(0, 10);
      daysToRenewal = Math.ceil((end.getTime() - now.getTime()) / dayMs);
    }
  }

  if (!["active", "signed", "executed"].includes(status)) {
    reasons.push("It is not in force yet, so the customer is not committed.");
    if (renewalDate) reasons.push(`Term would end ${renewalDate}.`);
    return {
      score: status === "draft" ? 25 : 40,
      band: status === "draft" ? "critical" : "at_risk",
      headline: status === "draft" ? "Unsigned draft" : "Awaiting signature",
      reasons,
      renewalDate,
      daysToRenewal,
    };
  }

  let score = 85;
  if (renewalDate == null) {
    reasons.push(
      input.effectiveDate == null
        ? "No effective date is recorded, so the renewal date cannot be computed."
        : "The contract term is not recorded in months, so the renewal date cannot be computed.",
    );
    return { score: null, band: "unknown", headline: "Renewal date not computable", reasons, renewalDate, daysToRenewal };
  }
  reasons.push(`Term ends ${renewalDate}.`);
  if (daysToRenewal != null) {
    if (daysToRenewal < 0) {
      score = 15;
      reasons.push(`Term ended ${Math.abs(daysToRenewal)} day(s) ago with no renewal recorded.`);
    } else if (daysToRenewal <= 30) {
      score = 35;
      reasons.push(`Renewal is ${daysToRenewal} day(s) away.`);
    } else if (daysToRenewal <= 90) {
      score = 55;
      reasons.push(`Renewal is ${daysToRenewal} day(s) away — start the conversation.`);
    }
  }
  if (!input.hasApprovedSchedule) {
    score -= 15;
    reasons.push("No approved service schedule sits under this contract, so nothing is authorised to run.");
  }

  const bounded = Math.max(0, Math.min(100, Math.round(score)));
  return {
    score: bounded,
    band: bandFromScore(bounded),
    headline:
      daysToRenewal != null && daysToRenewal < 0
        ? "Lapsed — renew or close"
        : daysToRenewal != null && daysToRenewal <= 90
          ? "Renewal window open"
          : "In force",
    reasons,
    renewalDate,
    daysToRenewal,
  };
}

/* --------------------------------------------------- account engagement */

export interface InteractionInput {
  occurredAt: string;
  direction: string | null;
  interactionType: string | null;
}

export interface EngagementReading extends Reading {
  lastContactDays: number | null;
  interactions30d: number;
  inbound30d: number;
}

export function accountEngagement(interactions: InteractionInput[], now: Date = new Date()): EngagementReading {
  if (interactions.length === 0) {
    return {
      score: null,
      band: "unknown",
      headline: "No contact is recorded",
      reasons: ["No email, call or meeting has been recorded against this account yet."],
      lastContactDays: null,
      interactions30d: 0,
      inbound30d: 0,
    };
  }
  const sorted = [...interactions].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const lastContactDays = daysSince(sorted[0].occurredAt, now);
  const recent = sorted.filter((i) => (daysSince(i.occurredAt, now) ?? 999) <= 30);
  const inbound = recent.filter((i) => (i.direction ?? "").toLowerCase() === "inbound");
  const reasons: string[] = [
    `${sorted.length} interaction(s) recorded, ${recent.length} in the last 30 days.`,
    lastContactDays == null ? "Last contact date unreadable." : `Last contact ${lastContactDays} day(s) ago.`,
  ];

  let score = 50;
  if (lastContactDays != null) {
    if (lastContactDays <= 7) score += 30;
    else if (lastContactDays <= 21) score += 10;
    else if (lastContactDays <= 45) score -= 15;
    else {
      score -= 35;
      reasons.push("The relationship has gone quiet.");
    }
  }
  score += Math.min(15, recent.length * 3);
  if (inbound.length > 0) {
    score += 8;
    reasons.push(`${inbound.length} of those came from the customer.`);
  } else if (recent.length > 0) {
    score -= 8;
    reasons.push("All recent contact was outbound — the customer has not replied.");
  }

  const bounded = Math.max(0, Math.min(100, Math.round(score)));
  return {
    score: bounded,
    band: bandFromScore(bounded),
    headline:
      lastContactDays != null && lastContactDays > 45
        ? "Gone quiet"
        : bounded >= 70
          ? "Engaged"
          : "Cooling — re-engage",
    lastContactDays,
    interactions30d: recent.length,
    inbound30d: inbound.length,
    reasons,
  };
}

/** The single worst reading, so a page can lead with the real problem. */
export function worstReading(readings: { label: string; reading: Reading }[]): { label: string; reading: Reading } | null {
  const scored = readings.filter((r) => r.reading.score != null);
  if (scored.length === 0) return null;
  return scored.reduce((a, b) => ((b.reading.score as number) < (a.reading.score as number) ? b : a));
}

/* ------------------------------------------------------------- reads */

export interface AccountInteractions {
  items: InteractionInput[];
  authorised: boolean;
}

export async function fetchAccountInteractions(accountId: string): Promise<AccountInteractions> {
  const { data, error } = await db
    .from("crm_interactions")
    .select("occurred_at, direction, interaction_type")
    .eq("account_id", accountId)
    .order("occurred_at", { ascending: false })
    .limit(200);
  if (error) return { items: [], authorised: false };
  return {
    items: (data ?? []).map((r: Record<string, unknown>) => ({
      occurredAt: String(r.occurred_at),
      direction: (r.direction as string) ?? null,
      interactionType: (r.interaction_type as string) ?? null,
    })),
    authorised: true,
  };
}
