/**
 * Yalla Security Control Plane — Risk & Decision Engine.
 *
 * Not all findings deserve equal treatment. Four public recruitment reference
 * tables and a PUBLIC EXECUTE grant on a contract mutation are not the same
 * class of problem, and the platform must know the difference without a human
 * re-deciding it every time.
 *
 * Risk Priority = Impact × Exploitability × Exposure × Business Criticality ×
 *                 Uncertainty, adjusted by graph and effort factors.
 *
 * Every multiplier is named in the output. A score with no visible drivers is
 * not usable evidence, so the engine always explains itself.
 */
import { computeBlastRadius, getAsset, type BlastRadius } from "./assetGraph";

export type RiskBand = "P0" | "P1" | "P2" | "P3";

export type FindingClass =
  | "excessive_privilege"
  | "missing_rls"
  | "permissive_policy"
  | "anon_write_surface"
  | "unauthenticated_endpoint"
  | "public_reference_exposure"
  | "definer_reliance"
  | "config_weakness"
  | "unverified_control";

export interface SecurityFinding {
  id: string;
  assetId: string;
  findingClass: FindingClass;
  title: string;
  /** How sure we are that the finding is real: 0-1. Uncertainty raises urgency. */
  confidence: number;
  /** Set when the finding was proven by an executed probe rather than inferred. */
  proven?: boolean;
  /** Effort to remediate: 1 (a grant) … 5 (an architectural change). */
  remediationEffort: 1 | 2 | 3 | 4 | 5;
  /** Number of tenants demonstrably in scope, when known. */
  tenantsInScope?: number;
  /** Money reachable through the finding, in KSh, when known. */
  financialExposureKes?: number;
  /** True when exploitation would leave no trace in the audit trail. */
  detectionDifficult?: boolean;
  /** 1 (trivial: one request) … 5 (needs privileged position and timing). */
  exploitComplexity: 1 | 2 | 3 | 4 | 5;
}

export interface RiskDriver {
  factor: string;
  value: number;
  reason: string;
}

export interface RiskAssessment {
  findingId: string;
  assetId: string
  score: number;
  band: RiskBand;
  drivers: RiskDriver[];
  blast: BlastRadius;
  /** Plain statement of why this ranks where it does. */
  rationale: string;
  /** Set when the asset is not in the graph — the score is then bounded. */
  unknownAsset: boolean;
}

const IMPACT_BY_CLASS: Record<FindingClass, number> = {
  excessive_privilege: 0.9,
  missing_rls: 0.95,
  permissive_policy: 0.75,
  anon_write_surface: 0.7,
  unauthenticated_endpoint: 0.65,
  public_reference_exposure: 0.15,
  definer_reliance: 0.4,
  config_weakness: 0.35,
  unverified_control: 0.5,
};

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export function assessRisk(finding: SecurityFinding): RiskAssessment {
  const asset = getAsset(finding.assetId);
  const blast = computeBlastRadius(finding.assetId);
  const drivers: RiskDriver[] = [];

  const impact = IMPACT_BY_CLASS[finding.findingClass];
  drivers.push({
    factor: "Impact",
    value: impact,
    reason: `finding class ${finding.findingClass}`,
  });

  // Exploitability falls as complexity rises; a proven probe raises it.
  const exploitability = clamp01((6 - finding.exploitComplexity) / 5 * (finding.proven ? 1 : 0.85));
  drivers.push({
    factor: "Exploitability",
    value: Number(exploitability.toFixed(2)),
    reason: finding.proven
      ? `proven by probe, complexity ${finding.exploitComplexity}/5`
      : `inferred, complexity ${finding.exploitComplexity}/5`,
  });

  const exposure = asset
    ? clamp01(0.35 + (asset.externallyAccessible ? 0.45 : 0) + (blast.touchesExternalSurface ? 0.2 : 0))
    : 0.5;
  drivers.push({
    factor: "Exposure",
    value: Number(exposure.toFixed(2)),
    reason: asset?.externallyAccessible
      ? "reachable without authentication"
      : blast.touchesExternalSurface
        ? "an external caller sits downstream"
        : "internal callers only",
  });

  const criticality = asset ? asset.criticality / 5 : 0.6;
  drivers.push({
    factor: "Business criticality",
    value: Number(criticality.toFixed(2)),
    reason: asset ? `${asset.label} criticality ${asset.criticality}/5` : "asset not in graph — assumed moderate",
  });

  // Uncertainty is treated as risk, not as an excuse to defer.
  const uncertainty = clamp01(1 + 0.25 * (1 - clamp01(finding.confidence)));
  drivers.push({
    factor: "Uncertainty",
    value: Number(uncertainty.toFixed(2)),
    reason: `confidence ${Math.round(clamp01(finding.confidence) * 100)}% in the finding`,
  });

  let score = 100 * impact * exploitability * exposure * criticality * uncertainty;

  const adjust = (factor: string, multiplier: number, reason: string) => {
    score *= multiplier;
    drivers.push({ factor, value: Number(multiplier.toFixed(2)), reason });
  };

  if (asset?.dataSensitivity) {
    adjust("Data sensitivity", 0.8 + 0.08 * asset.dataSensitivity, `sensitivity ${asset.dataSensitivity}/5`);
  }
  if (blast.touchesFinancialPath) adjust("Financial path", 1.25, "a monetary value or its recognition is downstream");
  if (asset?.privileged) adjust("Privileged execution", 1.15, "runs with elevated rights");
  if (blast.touchesTenantData) adjust("Tenant data", 1.1, "tenant-scoped data is in the radius");
  if ((finding.tenantsInScope ?? 0) > 1) {
    adjust("Tenant count", Math.min(1.3, 1 + 0.03 * (finding.tenantsInScope ?? 0)), `${finding.tenantsInScope} tenants in scope`);
  }
  if ((finding.financialExposureKes ?? 0) > 0) {
    const m = Math.min(1.35, 1 + Math.log10(1 + (finding.financialExposureKes ?? 0)) / 30);
    adjust("Financial exposure", m, `KSh ${Math.round(finding.financialExposureKes ?? 0).toLocaleString("en-KE")} reachable`);
  }
  if (finding.detectionDifficult) adjust("Detection difficulty", 1.15, "exploitation would leave no audit trace");
  if (blast.spreadScore > 0) {
    adjust("Blast radius", 1 + Math.min(0.3, blast.spreadScore / 300), `${blast.nodes.length} dependent asset(s), spread ${blast.spreadScore}/100`);
  }
  // Effort never lowers urgency, only sequencing — a small, cheap discount only.
  adjust("Remediation effort", 1 - 0.02 * (finding.remediationEffort - 1), `effort ${finding.remediationEffort}/5`);

  const finalScore = Math.max(0, Math.min(100, Math.round(score)));
  const band: RiskBand = finalScore >= 70 ? "P0" : finalScore >= 45 ? "P1" : finalScore >= 22 ? "P2" : "P3";

  const rationale = [
    `${finding.title}: ${band} at ${finalScore}/100.`,
    asset ? `${asset.label} (${asset.domain})` : `Asset ${finding.assetId} is not in the security graph.`,
    blast.nodes.length
      ? `${blast.nodes.length} dependent asset(s) across ${blast.domains.join(", ")}.`
      : "No dependent assets recorded.",
    blast.touchesFinancialPath ? "Money is downstream." : "No monetary path downstream.",
  ].join(" ");

  return {
    findingId: finding.id,
    assetId: finding.assetId,
    score: finalScore,
    band,
    drivers,
    blast,
    rationale,
    unknownAsset: !asset,
  };
}

/** Rank findings for remediation: risk first, then cheapest at equal risk. */
export function rankRemediation(findings: SecurityFinding[]): RiskAssessment[] {
  return findings
    .map(assessRisk)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const ea = findings.find((f) => f.id === a.findingId)?.remediationEffort ?? 3;
      const eb = findings.find((f) => f.id === b.findingId)?.remediationEffort ?? 3;
      if (ea !== eb) return ea - eb;
      return a.findingId.localeCompare(b.findingId);
    });
}
