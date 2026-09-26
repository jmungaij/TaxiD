/**
 * DEAL READINESS — is this deal genuinely ready to move?
 *
 * Not a form wall. The question is never "did you fill every field", it is
 * "do the conditions that make the next stage meaningful actually exist".
 * Missing conditions are named; the transition is never silently blocked here —
 * the server-side stage machine remains the authority on what may change.
 */
export type ReadinessStage = "qualified" | "proposal" | "negotiation" | "contract";

export interface ReadinessFacts {
  hasRecordedNeed: boolean;
  hasNamedContact: boolean;
  hasExpectedValue: boolean;
  hasNextAction: boolean;
  hasPricedProposal: boolean;
  hasDecisionDate: boolean;
  hasDecisionMaker: boolean;
  hasOpenObjectionRecorded: boolean;
  hasApprovedCommercialTerms: boolean;
  hasLegalStatus: boolean;
  hasAuthorisedSignatory: boolean;
  hasOperationalRequirements: boolean;
}

export interface ReadinessCondition {
  key: keyof ReadinessFacts;
  label: string;
  met: boolean;
  why: string;
}

export interface ReadinessReading {
  stage: ReadinessStage;
  ready: boolean;
  met: number;
  total: number;
  missing: ReadinessCondition[];
  conditions: ReadinessCondition[];
  headline: string;
}

const REQUIREMENTS: Record<ReadinessStage, { key: keyof ReadinessFacts; label: string; why: string }[]> = {
  qualified: [
    { key: "hasRecordedNeed", label: "Customer need recorded", why: "Without a stated need there is nothing to sell against." },
    { key: "hasNamedContact", label: "Named contact", why: "A deal with no person attached cannot be progressed." },
    { key: "hasExpectedValue", label: "Expected value", why: "Value decides how much effort and which approvals apply." },
    { key: "hasNextAction", label: "Next action", why: "A deal with no next step is a deal that stops." },
  ],
  proposal: [
    { key: "hasRecordedNeed", label: "Confirmed requirement", why: "Pricing a requirement nobody confirmed produces a rejected proposal." },
    { key: "hasPricedProposal", label: "Priced proposal on record", why: "The stage claims the customer has pricing from us." },
    { key: "hasDecisionDate", label: "Expected decision date", why: "Without it, follow-up timing is guesswork and forecasting is fiction." },
    { key: "hasNamedContact", label: "Named contact", why: "Somebody must be receiving the proposal." },
  ],
  negotiation: [
    { key: "hasPricedProposal", label: "Priced proposal on record", why: "There is nothing to negotiate without a price." },
    { key: "hasDecisionMaker", label: "Decision maker identified", why: "Negotiating with someone who cannot decide wastes the cycle." },
    { key: "hasOpenObjectionRecorded", label: "Outstanding objection recorded", why: "If nothing is open, the deal should be closing, not negotiating." },
    { key: "hasNextAction", label: "Next negotiation action", why: "Negotiations stall when no next move is owned." },
  ],
  contract: [
    { key: "hasApprovedCommercialTerms", label: "Approved commercial terms", why: "Terms must be internally approved before signature." },
    { key: "hasLegalStatus", label: "Legal status recorded", why: "Contracting without a legal position creates exposure." },
    { key: "hasAuthorisedSignatory", label: "Authorised signatory", why: "A signature from an unauthorised person is not a contract." },
    { key: "hasOperationalRequirements", label: "Operational requirements captured", why: "Operations cannot activate a service they have never been told about." },
  ],
};

export function dealReadiness(stage: ReadinessStage, facts: ReadinessFacts): ReadinessReading {
  const conditions: ReadinessCondition[] = REQUIREMENTS[stage].map((r) => ({
    key: r.key,
    label: r.label,
    why: r.why,
    met: Boolean(facts[r.key]),
  }));
  const missing = conditions.filter((c) => !c.met);
  const met = conditions.length - missing.length;
  return {
    stage,
    ready: missing.length === 0,
    met,
    total: conditions.length,
    missing,
    conditions,
    headline:
      missing.length === 0
        ? `Ready for ${stage.replace(/_/g, " ")}`
        : `${missing.length} condition(s) missing before ${stage.replace(/_/g, " ")} is real`,
  };
}

/** The stage a deal is trying to reach, given where it is now. */
export function nextReadinessStage(currentStage: string): ReadinessStage | null {
  switch ((currentStage ?? "").toLowerCase()) {
    case "new":
      return "qualified";
    case "qualified":
      return "proposal";
    case "quoted":
    case "proposal":
      return "negotiation";
    case "negotiation":
      return "contract";
    default:
      return null;
  }
}
