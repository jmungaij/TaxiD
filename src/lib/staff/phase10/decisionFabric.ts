/**
 * Phase 10 §10.23–10.24 — the AI Orchestration Council and the Decision Fabric.
 *
 * There is no generic "TaxiD AI". There are fourteen specialised agents plus an
 * orchestrator, and every consequential decision carries the same record:
 *
 *   signal → evidence → recommendation → confidence → economic impact → risk
 *          → approval requirement → action → outcome → learning
 *
 * Human authority is structural: the risk and safety agent holds a veto, and
 * approval thresholds are evaluated in code, not left to the model's judgement.
 */
import { clamp } from "../phase8/provenance";

export const AGENTS = [
  "demand_intelligence",
  "supply_intelligence",
  "matching_intelligence",
  "pricing_intelligence",
  "mission_orchestrator",
  "corporate_mobility",
  "logistics",
  "air_mobility",
  "provider_intelligence",
  "customer_intelligence",
  "revenue_intelligence",
  "risk_safety",
  "exception",
  "learning",
] as const;
export type AgentId = (typeof AGENTS)[number];

export const AGENT_LABEL: Record<AgentId, string> = {
  demand_intelligence: "Demand Intelligence",
  supply_intelligence: "Supply Intelligence",
  matching_intelligence: "Matching Intelligence",
  pricing_intelligence: "Pricing Intelligence",
  mission_orchestrator: "Mission Orchestrator",
  corporate_mobility: "Corporate Mobility Agent",
  logistics: "Logistics Agent",
  air_mobility: "Air Mobility Agent",
  provider_intelligence: "Provider Intelligence",
  customer_intelligence: "Customer Intelligence",
  revenue_intelligence: "Revenue Intelligence",
  risk_safety: "Risk & Safety Agent",
  exception: "Exception Agent",
  learning: "Learning Agent",
};

export const AGENT_MANDATE: Record<AgentId, string> = {
  demand_intelligence: "Predict demand by market, window and service",
  supply_intelligence: "Predict available and committed capacity",
  matching_intelligence: "Find the best feasible provider under policy",
  pricing_intelligence: "Recommend economics inside authorised boundaries",
  mission_orchestrator: "Coordinate mission execution across states",
  corporate_mobility: "Manage enterprise programmes and their governance",
  logistics: "Coordinate shipments, hubs and proof of delivery",
  air_mobility: "Coordinate aircraft missions and operator compliance",
  provider_intelligence: "Optimise the partner network and its quality",
  customer_intelligence: "Optimise customer experience and retention",
  revenue_intelligence: "Optimise contribution and revenue integrity",
  risk_safety: "Identify dangerous or non-compliant conditions",
  exception: "Resolve operational failures within authority",
  learning: "Compare expected against actual and update the models",
};

/** The one agent whose objection cannot be outvoted. */
export const VETO_AGENT: AgentId = "risk_safety";

export type DecisionRisk = "low" | "medium" | "high";
export type ApprovalRequirement = "none" | "operations_approver" | "commercial_director" | "executive";

export interface DecisionEvidence {
  fact: string;
  source: string;
  provenance: "LIVE" | "MODELLED" | "SIMULATED" | "DEMO" | "UNAVAILABLE";
}

export interface DecisionRecord {
  id: string;
  agent: AgentId;
  signal: string;
  evidence: DecisionEvidence[];
  recommendation: string;
  /** 0-100. Degraded automatically when evidence is weak. */
  confidence: number;
  /** Expected economic impact in cents; null when unquantifiable. */
  economicImpactCents: number | null;
  risk: DecisionRisk;
  approvalRequirement: ApprovalRequirement;
  /** True only when the fabric permits unattended execution. */
  executable: boolean;
  action: string;
  outcome?: { at: string; actualCents: number | null; note: string };
  learning?: string;
  blockers: string[];
}

export interface DecisionInput {
  id: string;
  agent: AgentId;
  signal: string;
  evidence: DecisionEvidence[];
  recommendation: string;
  baseConfidence: number;
  economicImpactCents: number | null;
  risk: DecisionRisk;
  action: string;
}

export interface FabricThresholds {
  /** Impact above which a commercial director must approve. */
  commercialCents: number;
  /** Impact above which the executive must approve. */
  executiveCents: number;
}

export const DEFAULT_FABRIC_THRESHOLDS: FabricThresholds = {
  commercialCents: 250_000_00,
  executiveCents: 1_000_000_00,
};

/** Builds a governed decision record. Weak evidence lowers confidence and authority. */
export function buildDecision(
  input: DecisionInput,
  thresholds: FabricThresholds = DEFAULT_FABRIC_THRESHOLDS,
): DecisionRecord {
  const blockers: string[] = [];
  const live = input.evidence.filter((e) => e.provenance === "LIVE").length;
  const unavailable = input.evidence.filter((e) => e.provenance === "UNAVAILABLE").length;

  if (input.evidence.length === 0) blockers.push("Decision carries no evidence");
  if (unavailable > 0) blockers.push(`${unavailable} evidence item(s) are unavailable`);

  const coverage = input.evidence.length === 0 ? 0 : live / input.evidence.length;
  let confidence = clamp(input.baseConfidence * (0.5 + coverage * 0.5), 0, 100);
  if (unavailable > 0) confidence = clamp(confidence - unavailable * 10, 0, 100);

  let approval: ApprovalRequirement = "none";
  if (input.risk === "high") approval = "commercial_director";
  else if (input.risk === "medium") approval = "operations_approver";

  const impact = input.economicImpactCents;
  if (impact === null) {
    approval = approval === "none" ? "operations_approver" : approval;
    blockers.push("Economic impact could not be quantified");
  } else {
    if (impact >= thresholds.executiveCents) approval = "executive";
    else if (impact >= thresholds.commercialCents) approval = "commercial_director";
  }

  if (confidence < 50 && approval === "none") approval = "operations_approver";

  return {
    id: input.id,
    agent: input.agent,
    signal: input.signal,
    evidence: input.evidence,
    recommendation: input.recommendation,
    confidence: Math.round(confidence),
    economicImpactCents: impact,
    risk: input.risk,
    approvalRequirement: approval,
    executable: approval === "none" && blockers.length === 0,
    action: input.action,
    blockers,
  };
}

/** §10.24 closes the loop: expected against actual, then learning. */
export function recordOutcome(
  decision: DecisionRecord,
  actualCents: number | null,
  note: string,
  at = new Date().toISOString(),
): DecisionRecord {
  const expected = decision.economicImpactCents;
  const learning = expected === null || actualCents === null
    ? "Outcome cannot be compared to expectation — one side is unquantified, so no model update is justified"
    : (() => {
        const variance = expected === 0 ? 0 : ((actualCents - expected) / Math.abs(expected)) * 100;
        if (Math.abs(variance) <= 15) return `Outcome within ±15% of expectation (${variance.toFixed(1)}%) — model retained`;
        return variance > 0
          ? `Outcome exceeded expectation by ${variance.toFixed(1)}% — raise the confidence prior for ${AGENT_LABEL[decision.agent]}`
          : `Outcome fell short of expectation by ${Math.abs(variance).toFixed(1)}% — lower the confidence prior for ${AGENT_LABEL[decision.agent]}`;
      })();

  return { ...decision, outcome: { at, actualCents, note }, learning };
}

/* ------------------------------------------------------------------ */
/* Orchestration council                                               */
/* ------------------------------------------------------------------ */

export type AgentStance = "support" | "oppose" | "abstain";

export interface AgentOpinion {
  agent: AgentId;
  stance: AgentStance;
  reasoning: string;
  /** 0-100; abstentions carry no weight. */
  confidence: number;
}

export interface CouncilVerdict {
  question: string;
  /** proceed | proceed_with_conditions | hold | reject */
  verdict: "proceed" | "proceed_with_conditions" | "hold" | "reject";
  vetoed: boolean;
  support: number;
  oppose: number;
  abstain: number;
  conditions: string[];
  /** Preserved verbatim — dissent is never averaged away. */
  dissent: AgentOpinion[];
  approvalRequirement: ApprovalRequirement;
  narrative: string;
}

/**
 * The TaxiD Orchestration Agent coordinates the council. It does not overrule
 * the risk veto, and it will not manufacture a verdict from abstentions.
 */
export function conveneCouncil(
  question: string,
  opinions: readonly AgentOpinion[],
  approvalRequirement: ApprovalRequirement = "operations_approver",
): CouncilVerdict {
  const support = opinions.filter((o) => o.stance === "support");
  const oppose = opinions.filter((o) => o.stance === "oppose");
  const abstain = opinions.filter((o) => o.stance === "abstain");
  const dissent = oppose.map((o) => ({ ...o }));

  const veto = oppose.find((o) => o.agent === VETO_AGENT);
  if (veto) {
    return {
      question,
      verdict: "reject",
      vetoed: true,
      support: support.length,
      oppose: oppose.length,
      abstain: abstain.length,
      conditions: [],
      dissent,
      approvalRequirement: "executive",
      narrative: `Rejected on the Risk & Safety veto: ${veto.reasoning}`,
    };
  }

  const voting = support.length + oppose.length;
  if (voting === 0 || abstain.length > opinions.length / 2) {
    return {
      question,
      verdict: "hold",
      vetoed: false,
      support: support.length,
      oppose: oppose.length,
      abstain: abstain.length,
      conditions: abstain.map((o) => `${AGENT_LABEL[o.agent]} requires evidence: ${o.reasoning}`),
      dissent,
      approvalRequirement,
      narrative: `Held: ${abstain.length} of ${opinions.length} agents abstained for want of evidence. TaxiD does not decide on a majority of silence.`,
    };
  }

  const supportWeight = support.reduce((a, o) => a + o.confidence, 0);
  const opposeWeight = oppose.reduce((a, o) => a + o.confidence, 0);
  const total = supportWeight + opposeWeight;
  const share = total === 0 ? 0 : supportWeight / total;

  const verdict = share >= 0.75 ? "proceed" : share >= 0.55 ? "proceed_with_conditions" : share >= 0.4 ? "hold" : "reject";
  return {
    question,
    verdict,
    vetoed: false,
    support: support.length,
    oppose: oppose.length,
    abstain: abstain.length,
    conditions: verdict === "proceed" ? [] : dissent.map((d) => `Address: ${d.reasoning}`),
    dissent,
    approvalRequirement: verdict === "proceed" ? approvalRequirement : "commercial_director",
    narrative: `${support.length} support, ${oppose.length} oppose, ${abstain.length} abstain — ${Math.round(share * 100)}% confidence-weighted support.`,
  };
}
