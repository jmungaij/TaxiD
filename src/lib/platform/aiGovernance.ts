/**
 * IEOS Phase 8 · Phase L — Enterprise AI Governance.
 *
 * Governs every AI service in the platform: purpose, human oversight,
 * evaluation, drift, explainability and fallback. Ungoverned AI is blocked.
 */
import { clamp, round, makeFinding, sortFindings, grade, type PlatformFinding, type Grade } from "./_shared";

export type AiRiskTier = "minimal" | "limited" | "high";

export interface AiService {
  id: string;
  name: string;
  purpose: string;
  riskTier: AiRiskTier;
  /** A human approves before the output takes effect. */
  humanInTheLoop: boolean;
  /** Offline evaluation suite exists and is versioned. */
  evaluated: boolean;
  /** Accuracy on the latest evaluation, 0-100. */
  accuracyPct: number;
  /** Accuracy on the baseline evaluation, 0-100. */
  baselineAccuracyPct: number;
  /** Outputs carry a machine-readable rationale. */
  explainable: boolean;
  /** A deterministic fallback exists when the model is unavailable. */
  hasFallback: boolean;
  /** Inputs and outputs are logged for audit. */
  auditLogged: boolean;
  /** Personal data is redacted before inference. */
  piiRedacted: boolean;
}

export interface AiServiceGovernance {
  id: string;
  name: string;
  riskTier: AiRiskTier;
  /** Negative = degraded versus baseline. */
  driftPct: number;
  score: number;
  grade: Grade;
  gaps: string[];
  /** High-risk services missing oversight controls are blocked from production. */
  productionBlocked: boolean;
}

export interface AiGovernanceCertification {
  services: AiServiceGovernance[];
  averageScore: number;
  blockedServices: number;
  /** Percentage of services with an evaluation suite. */
  evaluationCoverage: number;
  /** Percentage of high-risk services with human oversight. */
  oversightCoverage: number;
  score: number;
  grade: Grade;
  findings: PlatformFinding[];
}

export function governService(s: AiService): AiServiceGovernance {
  const gaps: string[] = [];
  let score = 0;

  if (s.evaluated) score += 20; else gaps.push("no evaluation suite");
  if (s.explainable) score += 15; else gaps.push("no explainability");
  if (s.hasFallback) score += 15; else gaps.push("no deterministic fallback");
  if (s.auditLogged) score += 15; else gaps.push("no audit logging");
  if (s.piiRedacted) score += 15; else gaps.push("no PII redaction");
  if (s.riskTier !== "high" || s.humanInTheLoop) score += 10; else gaps.push("no human oversight on a high-risk service");
  if (s.purpose.trim().length > 0) score += 10; else gaps.push("no declared purpose");

  const driftPct = round(s.accuracyPct - s.baselineAccuracyPct, 1);
  const driftPenalty = driftPct < 0 ? Math.min(30, Math.abs(driftPct) * 2) : 0;
  const finalScore = round(clamp(score - driftPenalty), 1);

  const productionBlocked =
    s.riskTier === "high" && (!s.humanInTheLoop || !s.evaluated || !s.auditLogged || !s.piiRedacted);

  return { id: s.id, name: s.name, riskTier: s.riskTier, driftPct, score: finalScore, grade: grade(finalScore, 90, 75), gaps, productionBlocked };
}

export function certifyAiGovernance(services: AiService[]): AiGovernanceCertification {
  const findings: PlatformFinding[] = [];
  const governed = services.map(governService);

  if (governed.length === 0) {
    findings.push(makeFinding("aigov", "p2", "registry", "No AI services registered", "Register every AI-assisted service, including visual copilot shells"));
    return { services: governed, averageScore: 0, blockedServices: 0, evaluationCoverage: 0, oversightCoverage: 100, score: 0, grade: "not_certified", findings };
  }

  const averageScore = round(governed.reduce((a, g) => a + g.score, 0) / governed.length, 1);
  const blockedServices = governed.filter((g) => g.productionBlocked).length;
  const evaluationCoverage = round((services.filter((s) => s.evaluated).length / services.length) * 100, 1);
  const highRisk = services.filter((s) => s.riskTier === "high");
  const oversightCoverage = highRisk.length === 0
    ? 100
    : round((highRisk.filter((s) => s.humanInTheLoop).length / highRisk.length) * 100, 1);

  for (const g of governed) {
    if (g.productionBlocked) {
      findings.push(makeFinding("aigov", "p0", g.name, `High-risk AI service is ungoverned: ${g.gaps.join(", ")}`, "Close the oversight gaps or keep the service out of production"));
    } else if (g.gaps.length > 0) {
      findings.push(makeFinding("aigov", g.score < 75 ? "p1" : "p2", g.name, `Governance gaps: ${g.gaps.join(", ")}`, "Close the gaps before increasing autonomy"));
    }
    if (g.driftPct < -5) {
      findings.push(makeFinding("aigov", "p1", g.name, `Accuracy drifted ${g.driftPct}% below baseline`, "Retrain, re-evaluate or roll back to the baseline model"));
    }
  }

  const score = round(clamp(averageScore * 0.6 + evaluationCoverage * 0.2 + oversightCoverage * 0.2 - blockedServices * 10), 1);
  return { services: governed, averageScore, blockedServices, evaluationCoverage, oversightCoverage, score, grade: grade(score, 90, 75), findings: sortFindings(findings) };
}
