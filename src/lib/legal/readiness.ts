/**
 * Legal readiness matrix (§15, §18).
 *
 * Scores are computed from records, never asserted. A domain with no records
 * scores 0 with an explicit CONFIGURATION_REQUIRED gap — it is never rounded up.
 */
import type { LegalGateStage } from "./types";

export type LegalDomainKey =
  | "licensing"
  | "partner_compliance"
  | "goods"
  | "contracts"
  | "data_protection"
  | "tax_etims"
  | "protection"
  | "claims";

export type LegalGap = "NONE" | "CONFIGURATION_REQUIRED" | "EVIDENCE_REQUIRED" | "LEGAL_REVIEW_REQUIRED" | "APPROVAL_REQUIRED";

export interface LegalDomainScore {
  key: LegalDomainKey;
  label: string;
  /** 0-100, computed as satisfied / applicable. */
  score: number;
  satisfied: number;
  applicable: number;
  gap: LegalGap;
  blockingStage: LegalGateStage;
  owner: string;
  systemOfRecord: string;
}

export interface LegalReadinessSummary {
  domains: LegalDomainScore[];
  overallScore: number;
  verdict: "NOT_READY" | "CONDITIONAL_ACTION_REQUIRED" | "READY_PENDING_APPROVAL" | "READY";
  blockingStages: LegalGateStage[];
  openReviews: number;
  openIncidents: number;
  generatedAt: string;
}

export interface LegalDomainInput {
  key: LegalDomainKey;
  applicable: number;
  satisfied: number;
  /** Records sitting in a state that only a human can clear. */
  awaitingReview?: number;
  awaitingEvidence?: number;
  awaitingApproval?: number;
}

const META: Record<LegalDomainKey, { label: string; blockingStage: LegalGateStage; owner: string; systemOfRecord: string }> = {
  licensing: { label: "Licensing", blockingStage: "dispatch", owner: "compliance_admin", systemOfRecord: "Legal licence register" },
  partner_compliance: { label: "Partner compliance", blockingStage: "activation", owner: "compliance_admin", systemOfRecord: "Partner registry + licence register" },
  goods: { label: "Goods controls", blockingStage: "booking", owner: "compliance_admin", systemOfRecord: "Goods rule register" },
  contracts: { label: "Contracts", blockingStage: "booking", owner: "compliance_admin", systemOfRecord: "Contract register" },
  data_protection: { label: "Data protection", blockingStage: "processing", owner: "compliance_admin", systemOfRecord: "Processing register" },
  tax_etims: { label: "Tax / eTIMS", blockingStage: "invoicing", owner: "finance_admin", systemOfRecord: "Invoice + eTIMS response ledger" },
  protection: { label: "Protection", blockingStage: "claims", owner: "finance_admin", systemOfRecord: "Protection policy register" },
  claims: { label: "Claims", blockingStage: "claims", owner: "compliance_admin", systemOfRecord: "Claims policy + claim records" },
};

function gapFor(input: LegalDomainInput): LegalGap {
  if (input.applicable === 0) return "CONFIGURATION_REQUIRED";
  if (input.satisfied >= input.applicable) return "NONE";
  if ((input.awaitingReview ?? 0) > 0) return "LEGAL_REVIEW_REQUIRED";
  if ((input.awaitingApproval ?? 0) > 0) return "APPROVAL_REQUIRED";
  if ((input.awaitingEvidence ?? 0) > 0) return "EVIDENCE_REQUIRED";
  return "CONFIGURATION_REQUIRED";
}

export function scoreLegalDomain(input: LegalDomainInput): LegalDomainScore {
  const meta = META[input.key];
  const score = input.applicable === 0 ? 0 : Math.round((Math.min(input.satisfied, input.applicable) / input.applicable) * 1000) / 10;
  return {
    key: input.key,
    label: meta.label,
    score,
    satisfied: input.satisfied,
    applicable: input.applicable,
    gap: gapFor(input),
    blockingStage: meta.blockingStage,
    owner: meta.owner,
    systemOfRecord: meta.systemOfRecord,
  };
}

export function summariseLegalReadiness(
  inputs: LegalDomainInput[],
  extras: { openReviews?: number; openIncidents?: number; generatedAt?: string } = {},
): LegalReadinessSummary {
  const domains = inputs.map(scoreLegalDomain);
  const overallScore = domains.length === 0 ? 0 : Math.round((domains.reduce((a, d) => a + d.score, 0) / domains.length) * 10) / 10;
  const blockingStages = Array.from(new Set(domains.filter((d) => d.gap !== "NONE").map((d) => d.blockingStage)));
  const openReviews = extras.openReviews ?? 0;

  let verdict: LegalReadinessSummary["verdict"];
  if (domains.some((d) => d.gap === "CONFIGURATION_REQUIRED") || overallScore < 60) verdict = "NOT_READY";
  else if (domains.some((d) => d.gap === "LEGAL_REVIEW_REQUIRED" || d.gap === "EVIDENCE_REQUIRED") || openReviews > 0) verdict = "CONDITIONAL_ACTION_REQUIRED";
  else if (domains.some((d) => d.gap === "APPROVAL_REQUIRED")) verdict = "READY_PENDING_APPROVAL";
  else verdict = "READY";

  return {
    domains,
    overallScore,
    verdict,
    blockingStages,
    openReviews,
    openIncidents: extras.openIncidents ?? 0,
    generatedAt: extras.generatedAt ?? new Date().toISOString(),
  };
}

/** §18 readiness matrix rows, rendered in the admin console. */
export interface LegalMatrixRow {
  domain: string;
  requirement: string;
  system: string;
  evidence: string;
  status: string;
  blocking: LegalGateStage;
}

export function legalMatrix(summary: LegalReadinessSummary): LegalMatrixRow[] {
  return summary.domains.map((d) => ({
    domain: d.label,
    requirement: META[d.key].systemOfRecord,
    system: META[d.key].systemOfRecord,
    evidence: d.gap === "NONE" ? "Complete" : d.gap.replace(/_/g, " ").toLowerCase(),
    status: d.gap === "NONE" ? "SATISFIED" : d.gap,
    blocking: d.blockingStage,
  }));
}
