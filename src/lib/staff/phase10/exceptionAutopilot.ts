/**
 * Phase 10 §10.18 — Exception Autopilot.
 *
 * Risk tier decides authority, never convenience:
 *   low    → detect → classify → recommend → execute → verify
 *   medium → detect → recommend → human approval → execute → verify
 *   high   → detect → escalate → human decision → execute → verify
 *
 * Economic exposure and safety both escalate a tier. Nothing that touches safety
 * or money above the authorised threshold executes without a named human.
 */
import { clamp } from "../phase8/provenance";

export type ExceptionKind =
  | "no_match"
  | "provider_no_show"
  | "late_arrival"
  | "sla_breach"
  | "customer_cancellation"
  | "provider_cancellation"
  | "payment_failure"
  | "compliance_lapse"
  | "safety_incident"
  | "pricing_anomaly"
  | "settlement_break"
  | "capacity_withdrawn";

export type RiskTier = "low" | "medium" | "high";

export const AUTOPILOT_MODES = ["autopilot", "approval_required", "human_decision"] as const;
export type AutopilotMode = (typeof AUTOPILOT_MODES)[number];

export interface ExceptionInput {
  id: string;
  kind: ExceptionKind;
  missionId: string;
  missionType: string;
  productLine: string;
  detectedAt: string;
  /** Economic exposure in cents; null when it cannot be quantified. */
  exposureCents: number | null;
  customerSegment: "individual" | "corporate" | "enterprise";
  slaBound: boolean;
  detail: string;
}

export interface AutopilotThresholds {
  /** Above this exposure, medium becomes high. */
  highExposureCents: number;
  /** Above this exposure, low becomes medium. */
  mediumExposureCents: number;
}

export const DEFAULT_AUTOPILOT_THRESHOLDS: AutopilotThresholds = {
  highExposureCents: 5_000_00,
  mediumExposureCents: 500_00,
};

const BASE_TIER: Record<ExceptionKind, RiskTier> = {
  no_match: "low",
  provider_no_show: "medium",
  late_arrival: "low",
  sla_breach: "medium",
  customer_cancellation: "low",
  provider_cancellation: "medium",
  payment_failure: "medium",
  compliance_lapse: "high",
  safety_incident: "high",
  pricing_anomaly: "high",
  settlement_break: "high",
  capacity_withdrawn: "medium",
};

const REMEDY: Record<ExceptionKind, string> = {
  no_match: "Widen the matching radius one step and re-run the universal matching engine",
  provider_no_show: "Release the assignment, re-match from the feasible set and notify the customer with a revised ETA",
  late_arrival: "Notify the customer with a revised ETA and record the delay against provider quality",
  sla_breach: "Apply the contracted SLA remedy and log the breach against the account's service record",
  customer_cancellation: "Apply the published cancellation policy and release committed capacity",
  provider_cancellation: "Re-match immediately and record the cancellation against provider quality",
  payment_failure: "Retry the authorised payment path once, then move the mission to finance follow-up",
  compliance_lapse: "Suspend the provider from matching and require re-verification of the lapsed credential",
  safety_incident: "Trigger the safety protocol, suspend the provider and open a trust and safety case",
  pricing_anomaly: "Freeze the affected price rule at its last authorised value pending commercial review",
  settlement_break: "Hold the settlement line and route the break to the reconciliation queue",
  capacity_withdrawn: "Re-commit capacity from the feasible set and inform the programme owner",
};

export interface AutopilotStep {
  step: string;
  actor: "system" | "human";
  detail: string;
}

export interface ExceptionRouting {
  exception: ExceptionInput;
  tier: RiskTier;
  mode: AutopilotMode;
  /** Escalations applied on top of the base tier. */
  escalations: string[];
  recommendation: string;
  approverRole: string | null;
  /** SLA to resolution in minutes. */
  resolveWithinMinutes: number;
  steps: AutopilotStep[];
  /** 0-100 confidence that the recommended remedy resolves the exception. */
  confidence: number;
}

export function routeException(
  e: ExceptionInput,
  thresholds: AutopilotThresholds = DEFAULT_AUTOPILOT_THRESHOLDS,
): ExceptionRouting {
  let tier = BASE_TIER[e.kind];
  const escalations: string[] = [];

  if (e.exposureCents !== null) {
    if (e.exposureCents >= thresholds.highExposureCents && tier !== "high") {
      tier = "high";
      escalations.push(`Exposure of KES ${Math.round(e.exposureCents / 100).toLocaleString()} exceeds the autopilot limit`);
    } else if (e.exposureCents >= thresholds.mediumExposureCents && tier === "low") {
      tier = "medium";
      escalations.push(`Exposure of KES ${Math.round(e.exposureCents / 100).toLocaleString()} exceeds the unattended threshold`);
    }
  } else if (tier === "low") {
    tier = "medium";
    escalations.push("Economic exposure could not be quantified — autopilot is withheld");
  }

  if (e.customerSegment === "enterprise" && tier === "low") {
    tier = "medium";
    escalations.push("Enterprise customer: unattended remediation is not permitted");
  }
  if (e.slaBound && tier === "low") {
    tier = "medium";
    escalations.push("Mission is SLA-bound — remediation needs an accountable owner");
  }

  const mode: AutopilotMode = tier === "low" ? "autopilot" : tier === "medium" ? "approval_required" : "human_decision";
  const steps: AutopilotStep[] = [
    { step: "detect", actor: "system", detail: `${e.kind.replace(/_/g, " ")} detected on mission ${e.missionId}` },
    { step: "classify", actor: "system", detail: `Classified ${tier} risk${escalations.length ? ` after ${escalations.length} escalation(s)` : ""}` },
    { step: "recommend", actor: "system", detail: REMEDY[e.kind] },
  ];
  if (mode === "approval_required") steps.push({ step: "approve", actor: "human", detail: "Operations approver authorises the remedy" });
  if (mode === "human_decision") steps.push({ step: "escalate", actor: "human", detail: "Duty lead takes the decision; the system does not act alone" });
  steps.push({ step: "execute", actor: mode === "autopilot" ? "system" : "human", detail: "Remedy applied and recorded against the mission" });
  steps.push({ step: "verify", actor: "system", detail: "Outcome verified against the mission state and the transaction spine" });

  return {
    exception: e,
    tier,
    mode,
    escalations,
    recommendation: REMEDY[e.kind],
    approverRole: mode === "autopilot" ? null : mode === "approval_required" ? "operations_approver" : "duty_operations_lead",
    resolveWithinMinutes: tier === "high" ? 15 : tier === "medium" ? 60 : 240,
    steps,
    confidence: clamp(tier === "low" ? 80 : tier === "medium" ? 65 : 45, 0, 100),
  };
}

export interface AutopilotSummary {
  total: number;
  autopilot: number;
  approvalRequired: number;
  humanDecision: number;
  exposureCents: number | null;
  /** Share of exceptions safely handled without a human, 0-100. */
  automationRate: number | null;
}

export function summariseAutopilot(routings: readonly ExceptionRouting[]): AutopilotSummary {
  if (routings.length === 0) {
    return { total: 0, autopilot: 0, approvalRequired: 0, humanDecision: 0, exposureCents: null, automationRate: null };
  }
  const quantified = routings.filter((r) => r.exception.exposureCents !== null);
  const autopilot = routings.filter((r) => r.mode === "autopilot").length;
  return {
    total: routings.length,
    autopilot,
    approvalRequired: routings.filter((r) => r.mode === "approval_required").length,
    humanDecision: routings.filter((r) => r.mode === "human_decision").length,
    exposureCents: quantified.length === 0 ? null : quantified.reduce((a, r) => a + (r.exception.exposureCents ?? 0), 0),
    automationRate: Math.round((autopilot / routings.length) * 100),
  };
}
