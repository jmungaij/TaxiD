/**
 * Customer Operations — evidence evaluation engine (Improvement #3).
 *
 * The correlation panel no longer just aggregates evidence; it evaluates it:
 *
 *   Evidence → Confidence → Missing Evidence → Contradictions → Next Step
 *
 * Deterministic and configuration-driven. Evidence presence is supplied by the
 * caller from data already loaded in the module — no new tables, no new fetches.
 */
import type { BusinessDomain, CaseType } from "./taxonomy";
import { getPlaybook } from "./playbooks";

export type EvidenceState = "confirmed" | "missing" | "conflicting" | "not_applicable";

export interface EvidenceItem {
  id: string;
  label: string;
  domain: BusinessDomain;
  state: EvidenceState;
  /** What the evidence shows (or why it is absent). */
  detail: string;
  /** Evidence that must be present before a financial decision is made. */
  required: boolean;
  /** Weight in the confidence calculation. */
  weight: number;
}

export type EvidenceConfidence = "high" | "medium" | "low";

export interface Contradiction {
  id: string;
  statement: string;
  impact: string;
}

export interface EvidenceAssessment {
  caseType: CaseType;
  items: EvidenceItem[];
  score: number;
  confidence: EvidenceConfidence;
  missing: EvidenceItem[];
  contradictions: Contradiction[];
  /** The single action the agent should take next. */
  nextStep: string;
  /** Whether a payout / refund decision is currently safe. */
  decisionReady: boolean;
}

/** Facts the module already knows about a case, used to derive evidence state. */
export interface EvidenceFacts {
  hasTrip?: boolean;
  gpsConfirmsCompletion?: boolean;
  hasProofOfDelivery?: boolean;
  otpVerified?: boolean;
  hasWarehouseScans?: boolean;
  hasPaymentAttempt?: boolean;
  paymentSucceeded?: boolean;
  hasLedgerEntry?: boolean;
  driverIncidentHistory?: number;
  priorCases?: number;
  fraudScore?: number;
  amountKes?: number;
  customerClaimsNotReceived?: boolean;
}

const item = (
  id: string,
  label: string,
  domain: BusinessDomain,
  state: EvidenceState,
  detail: string,
  required: boolean,
  weight = 1,
): EvidenceItem => ({ id, label, domain, state, detail, required, weight });

function tri(value: boolean | undefined, yes: string, no: string): [EvidenceState, string] {
  if (value === undefined) return ["not_applicable", "Not applicable to this case type"];
  return value ? ["confirmed", yes] : ["missing", no];
}

export function assessEvidence(caseType: CaseType, f: EvidenceFacts): EvidenceAssessment {
  const items: EvidenceItem[] = [];
  const push = (
    id: string,
    label: string,
    domain: BusinessDomain,
    value: boolean | undefined,
    yes: string,
    no: string,
    required: boolean,
    weight = 1,
  ) => {
    const [state, detail] = tri(value, yes, no);
    items.push(item(id, label, domain, state, detail, required, weight));
  };

  const isDelivery = caseType === "lost_parcel" || caseType === "delivery_failure";
  const isFinancial = caseType === "refund_dispute" || caseType === "payment_issue";
  const isRide = caseType === "delayed_ride" || caseType === "driver_conduct" || caseType === "safety_incident";

  if (isDelivery || isRide || isFinancial) {
    push("trip", "Trip / order record", "logistics", f.hasTrip, "Trip or delivery order located", "No trip or order record found for the claim", true, 2);
    push("gps", "GPS trace", "logistics", f.gpsConfirmsCompletion, "GPS trace confirms the service reached the destination", "GPS trace does not confirm completion", false, 1.5);
  }
  if (isDelivery) {
    push("pod", "Proof of delivery", "logistics", f.hasProofOfDelivery, "POD captured at handover", "POD is missing for the handover", true, 2);
    push("otp", "OTP verification", "logistics", f.otpVerified, "Recipient OTP verified", "OTP was never verified", true, 1.5);
    push("scans", "Warehouse scans", "logistics", f.hasWarehouseScans, "Scan chain is complete", "Scan events are incomplete", false, 1);
  }
  if (isFinancial) {
    push("payment", "Payment attempt", "finance", f.hasPaymentAttempt, "Payment attempt located", "No payment attempt matches the disputed charge", true, 2);
    push("ledger", "Ledger consistency", "finance", f.hasLedgerEntry, "Journal lines reconcile with the wallet projection", "Ledger entry missing — projection may be drifting", true, 1.5);
  }

  items.push(
    item(
      "driver_history",
      "Driver history",
      "driver_ops",
      (f.driverIncidentHistory ?? 0) > 0 ? "conflicting" : "confirmed",
      (f.driverIncidentHistory ?? 0) > 0
        ? `${f.driverIncidentHistory} prior incident(s) recorded against the driver`
        : "No prior incidents recorded",
      false,
      1,
    ),
  );
  items.push(
    item(
      "risk",
      "Risk posture",
      "trust_safety",
      (f.fraudScore ?? 0) >= 60 ? "conflicting" : "confirmed",
      `Fraud score ${f.fraudScore ?? 0} · ${f.priorCases ?? 0} prior contact(s)`,
      false,
      1.5,
    ),
  );

  /* ------------------------------ contradictions ------------------------- */

  const contradictions: Contradiction[] = [];
  if (f.gpsConfirmsCompletion && f.customerClaimsNotReceived) {
    contradictions.push({
      id: "gps_vs_claim",
      statement: "GPS confirms arrival at the destination but the customer reports non-receipt.",
      impact: "Do not auto-refund — obtain courier proof or recipient statement first.",
    });
  }
  if (f.gpsConfirmsCompletion && f.hasProofOfDelivery === false) {
    contradictions.push({
      id: "gps_vs_pod",
      statement: "GPS confirms delivery but no proof of delivery was captured.",
      impact: "Handover cannot be evidenced; treat courier compliance as the primary root cause.",
    });
  }
  if (f.paymentSucceeded && f.hasLedgerEntry === false) {
    contradictions.push({
      id: "payment_vs_ledger",
      statement: "Payment succeeded upstream but no ledger entry exists.",
      impact: "Projection drift — run reconciliation before any reversal to avoid double refund.",
    });
  }
  if ((f.fraudScore ?? 0) >= 60 && (f.amountKes ?? 0) >= 10000) {
    contradictions.push({
      id: "risk_vs_amount",
      statement: "High fraud score combined with high monetary exposure.",
      impact: "Fraud Intelligence review is mandatory before disbursement.",
    });
  }

  /* -------------------------------- scoring ------------------------------ */

  const scored = items.filter((i) => i.state !== "not_applicable");
  const totalWeight = scored.reduce((a, i) => a + i.weight, 0) || 1;
  const earned = scored.reduce((a, i) => a + (i.state === "confirmed" ? i.weight : i.state === "conflicting" ? i.weight * 0.3 : 0), 0);
  let score = Math.round((earned / totalWeight) * 100);
  score = Math.max(0, score - contradictions.length * 10);

  const missing = items.filter((i) => i.state === "missing");
  const requiredMissing = missing.filter((i) => i.required);
  const confidence: EvidenceConfidence = score >= 75 && contradictions.length === 0 ? "high" : score >= 45 ? "medium" : "low";

  /* ------------------------------- next step ----------------------------- */

  let nextStep: string;
  if (contradictions.length > 0) {
    nextStep = contradictions[0].impact;
  } else if (requiredMissing.length > 0) {
    nextStep = `Collect ${requiredMissing.map((i) => i.label.toLowerCase()).join(", ")} before advancing the playbook.`;
  } else {
    const playbook = getPlaybook(caseType);
    const gate = playbook.steps.find((s) => s.approval);
    nextStep = gate
      ? `Evidence is complete — proceed to "${gate.title}" (${gate.approval}).`
      : `Evidence is complete — proceed to "${playbook.steps[0].title}".`;
  }

  return {
    caseType,
    items,
    score,
    confidence,
    missing,
    contradictions,
    nextStep,
    decisionReady: requiredMissing.length === 0 && contradictions.length === 0 && confidence !== "low",
  };
}
