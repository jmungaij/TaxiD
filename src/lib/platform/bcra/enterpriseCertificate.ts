/**
 * BCRA Phase 7 & 8 — Enterprise Readiness Certificate and validation.
 *
 * Deterministic aggregation of every BCRA engine into a single certificate,
 * plus the independent validation runner used by CI. Aggregate scores can
 * never mask a failed mandatory dimension: every gate is enforced separately.
 */
import { certifyAllCapabilities } from "../maturityGate";
import { certifyIntelligenceGovernance } from "../intelligenceGovernance";
import { certifyEventRegistry } from "../eventRegistry";
import { certifyPolicyRegistry } from "../policyRegistry";
import { certifyProcessCatalog } from "../processCatalog";
import { certifyKnowledgePlatform } from "../knowledgePlatform";
import { unwiredConsumedEvents, validateAllContracts } from "@/lib/contracts";
import type { ControlSignal } from "../controlPlane";
import { bcraCapabilityRegister, bcraEvidence, bcraInvestmentPriority, BCRA_VERSION, type BcraCapabilityRegister, type BcraEvidenceBundle } from "./capabilityRelease";
import { bcraValueStreamRegister, type ValueStreamRegister } from "./valueStreams";
import { bcraDependencyMatrix, type DependencyMatrixReport } from "./dependencyIntelligence";
import { certifyBusinessOutcomes, type BusinessOutcomeRegister } from "./businessOutcomes";
import { certifyContinuous, type CertificationSnapshot, type CertificationWindow, type ContinuousCertificationReport } from "./continuousCertification";
import { type BcraAiGovernanceReport } from "./aiGovernanceRegistries";

export const ENTERPRISE_CERTIFICATE_VERSION = "1.0.0";

export interface CertificateDimension {
  id: string;
  label: string;
  score: number;
  floor: number;
  passed: boolean;
  /** Mandatory dimensions cannot be masked by the aggregate score. */
  mandatory: boolean;
  blockers: string[];
}

export interface EnterpriseReadinessCertificate {
  version: string;
  bcraVersion: string;
  executiveSummary: string;
  dimensions: CertificateDimension[];
  capabilityRegister: BcraCapabilityRegister;
  valueStreams: ValueStreamRegister;
  dependencies: DependencyMatrixReport;
  outcomes: BusinessOutcomeRegister;
  aiGovernance: BcraAiGovernanceReport;
  continuous: ContinuousCertificationReport;
  operationalRisk: "low" | "moderate" | "elevated" | "high";
  revenueExposureKes: number;
  customerImpactPct: number;
  weakestCapabilities: Array<{ module: string; score: number; limitingDimension: string }>;
  investmentPriority: ReturnType<typeof bcraInvestmentPriority>;
  enterpriseConfidenceScore: number;
  decision: "go" | "conditional_go" | "no_go";
  blockers: string[];
  fingerprint: string;
}

export interface BcraInputs {
  evidence?: BcraEvidenceBundle;
  signalsByWindow?: Partial<Record<CertificationWindow, ControlSignal[]>>;
  previousSnapshots?: CertificationSnapshot[];
}

function clamp(n: number): number { return Math.max(0, Math.min(100, Math.round(n))); }

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`;
}

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; }
  return h.toString(16).padStart(8, "0");
}

export function enterpriseReadinessCertificate(inputs: BcraInputs = {}): EnterpriseReadinessCertificate {
  const evidence = inputs.evidence ?? bcraEvidence();
  const capabilityRegister = bcraCapabilityRegister(undefined, evidence);
  const valueStreams = bcraValueStreamRegister(evidence, capabilityRegister);
  const dependencies = bcraDependencyMatrix(evidence, capabilityRegister);
  const aiGovernance = evidence.ai;
  const outcomes = certifyBusinessOutcomes(capabilityRegister, valueStreams, dependencies);
  const continuous = certifyContinuous(capabilityRegister, valueStreams, dependencies, aiGovernance, inputs.signalsByWindow, inputs.previousSnapshots);

  const avg = (d: string) => capabilityRegister.dimensionAverages.find((x) => x.dimension === d)?.score ?? 0;

  const dimensions: CertificateDimension[] = [
    { id: "business_capability", label: "Business Capability Readiness", score: capabilityRegister.score, floor: 80, mandatory: true, passed: false, blockers: capabilityRegister.blockers },
    { id: "value_stream", label: "Business Value Stream Readiness", score: valueStreams.score, floor: 80, mandatory: true, passed: false, blockers: valueStreams.blockers },
    { id: "dependency", label: "Cross-Capability Dependency", score: dependencies.score, floor: 80, mandatory: true, passed: false, blockers: dependencies.blockers },
    { id: "operational", label: "Operational Readiness", score: avg("operational"), floor: 80, mandatory: true, passed: false, blockers: [] },
    { id: "commercial", label: "Commercial Readiness", score: avg("commercial"), floor: 70, mandatory: false, passed: false, blockers: [] },
    { id: "financial", label: "Financial Readiness", score: avg("financial"), floor: 80, mandatory: true, passed: false, blockers: [] },
    { id: "compliance", label: "Compliance Readiness", score: avg("compliance"), floor: 85, mandatory: true, passed: false, blockers: [] },
    { id: "ai_governance", label: "AI Governance Readiness", score: aiGovernance.score, floor: 85, mandatory: true, passed: false, blockers: aiGovernance.findings },
    { id: "business_outcome", label: "Business Outcome Certification", score: outcomes.score, floor: 80, mandatory: true, passed: false, blockers: outcomes.blockers },
    { id: "continuous", label: "Continuous Certification", score: continuous.score, floor: 80, mandatory: true, passed: false, blockers: continuous.blockers },
  ].map((d) => ({ ...d, passed: d.score >= d.floor && d.blockers.length === 0 }));

  const failedMandatory = dimensions.filter((d) => d.mandatory && !d.passed);
  const enterpriseConfidenceScore = clamp(dimensions.reduce((s, d) => s + d.score, 0) / dimensions.length);
  const risk = dependencies.score < 60 || outcomes.outcomes.some((o) => o.enterpriseRisk === "high")
    ? "high" : dependencies.score < 75 ? "elevated" : dependencies.score < 88 ? "moderate" : "low";

  const weakestCapabilities = [...capabilityRegister.capabilities]
    .sort((a, b) => a.score - b.score).slice(0, 5)
    .map((c) => ({ module: c.module, score: c.score, limitingDimension: c.limitingDimension as string }));

  const blockers = [
    ...failedMandatory.map((d) => `${d.label} ${d.score}/${d.floor}${d.blockers.length ? ` (${d.blockers.length} finding(s))` : ""}`),
    ...failedMandatory.flatMap((d) => d.blockers.map((b) => `${d.id} · ${b}`)),
  ];

  const decision: EnterpriseReadinessCertificate["decision"] =
    failedMandatory.length === 0 ? "go"
      : failedMandatory.some((d) => d.id === "compliance" || d.id === "financial" || d.id === "dependency") ? "no_go"
        : "conditional_go";

  const certificate: Omit<EnterpriseReadinessCertificate, "fingerprint"> = {
    version: ENTERPRISE_CERTIFICATE_VERSION,
    bcraVersion: BCRA_VERSION,
    executiveSummary:
      `${capabilityRegister.capabilities.length} capabilities and ${valueStreams.streams.length} value streams certified. ` +
      `Enterprise confidence ${enterpriseConfidenceScore}/100 · decision ${decision.toUpperCase()} · ` +
      `${outcomes.totalRevenueAtRiskKes.toLocaleString()} KES revenue exposure · operational risk ${risk} · ` +
      `${failedMandatory.length} mandatory dimension(s) failing.`,
    dimensions,
    capabilityRegister,
    valueStreams,
    dependencies,
    outcomes,
    aiGovernance,
    continuous,
    operationalRisk: risk,
    revenueExposureKes: outcomes.totalRevenueAtRiskKes,
    customerImpactPct: 100 - outcomes.slaProtectedPct,
    weakestCapabilities,
    investmentPriority: bcraInvestmentPriority(capabilityRegister),
    enterpriseConfidenceScore,
    decision,
    blockers,
  };

  return { ...certificate, fingerprint: fnv1a(canonical({ dimensions, decision, enterpriseConfidenceScore })) };
}

/* ------------------------------------------------------------------ *
 * Phase 8 — independent validation (no aggregate masking)
 * ------------------------------------------------------------------ */

export interface BcraValidationCheck {
  id: string;
  label: string;
  passed: boolean;
  score: number;
  findings: string[];
}

export interface BcraValidationReport {
  passed: boolean;
  checks: BcraValidationCheck[];
  failed: string[];
  certificate: EnterpriseReadinessCertificate;
}

export function validateBcra(inputs: BcraInputs = {}): BcraValidationReport {
  const certificate = enterpriseReadinessCertificate(inputs);
  const maturity = certifyAllCapabilities();
  const governance = certifyIntelligenceGovernance();
  const events = certifyEventRegistry();
  const policies = certifyPolicyRegistry();
  const processes = certifyProcessCatalog();
  const knowledge = certifyKnowledgePlatform();
  const contracts = validateAllContracts();
  const unwired = unwiredConsumedEvents();

  const checks: BcraValidationCheck[] = [
    { id: "capability_maturity_gate", label: "Capability Maturity Gate", passed: maturity.passed, score: maturity.score, findings: maturity.blockers },
    { id: "intelligence_governance", label: "Intelligence Governance Validation", passed: governance.passed, score: governance.score, findings: governance.findings.map(String) },
    { id: "registry_consistency", label: "Registry Consistency Validation", passed: events.passed && knowledge.score >= 90 && contracts.every((c) => c.ok), score: Math.round((events.score + knowledge.score) / 2), findings: [...events.issues.filter((i) => i.severity === "p0").map((i) => `${i.event}: ${i.message}`), ...contracts.filter((c) => !c.ok).map((c) => `${c.module}: missing ${c.missing.join(", ")}`), ...unwired.map((u) => `${u.consumer} consumes unpublished event ${u.event}`)] },
    { id: "policy_validation", label: "Policy Validation", passed: policies.passed, score: policies.score, findings: policies.issues.filter((i) => i.severity === "p0").map((i) => `${i.policy}: ${i.message}`) },
    { id: "process_validation", label: "Process Catalog Validation", passed: processes.passed, score: processes.score, findings: processes.blockers },
    { id: "value_stream_validation", label: "Value Stream Validation", passed: certificate.valueStreams.passed, score: certificate.valueStreams.score, findings: certificate.valueStreams.blockers },
    { id: "dependency_validation", label: "Dependency Validation", passed: certificate.dependencies.passed, score: certificate.dependencies.score, findings: certificate.dependencies.blockers },
    { id: "ai_governance_validation", label: "AI Governance Validation", passed: certificate.aiGovernance.passed, score: certificate.aiGovernance.score, findings: certificate.aiGovernance.findings },
    { id: "business_outcome_validation", label: "Business Outcome Validation", passed: certificate.outcomes.passed, score: certificate.outcomes.score, findings: certificate.outcomes.blockers },
    { id: "continuous_certification", label: "Continuous Certification Validation", passed: certificate.continuous.operational, score: certificate.continuous.score, findings: certificate.continuous.blockers },
  ];

  return {
    passed: checks.every((c) => c.passed),
    checks,
    failed: checks.filter((c) => !c.passed).map((c) => c.id),
    certificate,
  };
}

/** Deterministic markdown rendering of the executive certificate. */
export function renderEnterpriseCertificateMarkdown(cert: EnterpriseReadinessCertificate = enterpriseReadinessCertificate()): string {
  const lines: string[] = [];
  lines.push(`# Enterprise Readiness Certificate (BCRA v${cert.bcraVersion})`, "", `${cert.executiveSummary}`, "");
  lines.push("## Certification Dimensions", "", "| Dimension | Score | Floor | Mandatory | Result |", "|---|---|---|---|---|");
  for (const d of cert.dimensions) {
    lines.push(`| ${d.label} | ${d.score} | ${d.floor} | ${d.mandatory ? "yes" : "no"} | ${d.passed ? "PASS" : "FAIL"} |`);
  }
  lines.push("", "## Business Capability Register", "", "| Capability | Score | Decision | Limiting dimension | Revenue at risk (KES) |", "|---|---|---|---|---|");
  for (const c of cert.capabilityRegister.capabilities) {
    lines.push(`| ${c.title} | ${c.score} | ${c.decision} | ${c.limitingDimension} | ${c.revenueAtRiskKes.toLocaleString()} |`);
  }
  lines.push("", "## Business Value Stream Register", "", "| Value stream | Score | Weakest capability | SLA honoured | Result |", "|---|---|---|---|---|");
  for (const s of cert.valueStreams.streams) {
    lines.push(`| ${s.name} | ${s.score} | ${s.weakestCapability?.module ?? "n/a"} | ${s.slaHonoured ? "yes" : "no"} | ${s.passed ? "PASS" : "FAIL"} |`);
  }
  lines.push("", "## Cross-Capability Dependency Matrix", "", "| Capability | Depends on | Chain score | Weakest link | Propagation |", "|---|---|---|---|---|");
  for (const n of cert.dependencies.nodes) {
    lines.push(`| ${n.module} | ${n.dependsOn.join(", ") || "—"} | ${n.chainScore} | ${n.weakestLink ?? "—"} | ${n.propagationImpact} |`);
  }
  lines.push("", renderCertificationGapsMarkdown(topCertificationGaps(cert)));
  lines.push("", `## Decision`, "", `**${cert.decision.toUpperCase()}** — enterprise confidence ${cert.enterpriseConfidenceScore}/100, fingerprint \`${cert.fingerprint}\`.`);
  return lines.join("\n");
}

/* ------------------------------------------------------------------ *
 * Enterprise Hardening WS10 — strict release authority.
 *
 * Extension of `validateBcra`: the aggregate score can never authorise a
 * release. Every dimension, dependency, value stream, AI governance rule
 * and capability contract must pass independently. No averaging.
 * ------------------------------------------------------------------ */

export interface StrictReleaseGate {
  id: string;
  label: string;
  kind: "dimension" | "dependency" | "value_stream" | "ai_governance" | "capability_contract" | "validation";
  passed: boolean;
  score: number;
  reasons: string[];
}

export interface StrictReleaseAuthority {
  approved: boolean;
  decision: "approved" | "blocked";
  gates: StrictReleaseGate[];
  failedGates: string[];
  /** Recorded for transparency only — it never influences the decision. */
  aggregateScore: number;
  certificate: EnterpriseReadinessCertificate;
  fingerprint: string;
}

export function strictReleaseAuthority(inputs: BcraInputs = {}): StrictReleaseAuthority {
  const report = validateBcra(inputs);
  const cert = report.certificate;

  const gates: StrictReleaseGate[] = [
    ...cert.dimensions.map((d) => ({
      id: `dimension.${d.id}`,
      label: d.label,
      kind: "dimension" as const,
      passed: d.passed,
      score: d.score,
      reasons: d.blockers,
    })),
    ...cert.valueStreams.streams.map((s) => ({
      id: `value_stream.${s.id}`,
      label: s.name,
      kind: "value_stream" as const,
      passed: s.passed,
      score: s.score,
      reasons: s.blockers ?? [],
    })),
    {
      id: "dependency.matrix",
      label: "Capability dependency matrix",
      kind: "dependency",
      passed: cert.dependencies.passed,
      score: cert.dependencies.score,
      reasons: cert.dependencies.blockers,
    },
    {
      id: "ai_governance.ledger",
      label: "AI governance ledger",
      kind: "ai_governance",
      passed: cert.aiGovernance.passed,
      score: cert.aiGovernance.score,
      reasons: cert.aiGovernance.findings,
    },
    ...validateAllContracts().map((c) => ({
      id: `capability_contract.${c.module}`,
      label: `${c.module} capability contract`,
      kind: "capability_contract" as const,
      passed: c.ok,
      score: c.ok ? 100 : 0,
      reasons: c.ok ? [] : [`missing ${c.missing.join(", ")}`],
    })),
    ...report.checks.map((c) => ({
      id: `validation.${c.id}`,
      label: c.label,
      kind: "validation" as const,
      passed: c.passed,
      score: c.score,
      reasons: c.findings,
    })),
  ];

  const failedGates = gates.filter((g) => !g.passed).map((g) => g.id);
  return {
    approved: failedGates.length === 0,
    decision: failedGates.length === 0 ? "approved" : "blocked",
    gates,
    failedGates,
    aggregateScore: cert.enterpriseConfidenceScore,
    certificate: cert,
    fingerprint: fnv1a(canonical({ gates: gates.map((g) => [g.id, g.passed, g.score]), failedGates })),
  };
}

/* ------------------------------------------------------------------ *
 * Top Remaining Certification Gaps.
 *
 * Reuse-only projection over the existing certificate: turns scores into
 * directed engineering work — what is blocked, why it matters, and the
 * evidence required to close it. No new registries or data sources.
 * ------------------------------------------------------------------ */

export interface CertificationGap {
  id: string;
  area: "dimension" | "capability" | "value_stream" | "dependency" | "ai_governance";
  title: string;
  score: number;
  target: number;
  /** Downstream business surfaces degraded while this gap is open. */
  blocks: string[];
  businessImpact: string;
  evidenceRequired: string[];
  severity: "critical" | "high" | "moderate";
}

function severityFor(score: number, target: number): CertificationGap["severity"] {
  const delta = target - score;
  return delta >= 20 ? "critical" : delta >= 8 ? "high" : "moderate";
}

export function topCertificationGaps(
  cert: EnterpriseReadinessCertificate = enterpriseReadinessCertificate(),
  limit = 10,
): CertificationGap[] {
  const gaps: CertificationGap[] = [];

  for (const d of cert.dimensions.filter((x) => x.score < 100)) {
    gaps.push({
      id: `dimension.${d.id}`,
      area: "dimension",
      title: `${d.label} certification: ${d.score}/100`,
      score: d.score,
      target: Math.max(d.floor, 100),
      blocks: d.mandatory ? ["enterprise release authority"] : ["enterprise confidence score"],
      businessImpact: d.passed
        ? `Above floor ${d.floor} but short of full certification — residual audit exposure.`
        : `Below mandatory floor ${d.floor} — blocks the GO decision for phased rollout.`,
      evidenceRequired: d.blockers.length ? d.blockers.slice(0, 4) : [`raise ${d.label.toLowerCase()} evidence coverage to 100%`],
      severity: severityFor(d.score, Math.max(d.floor, 100)),
    });
  }

  const streamsByCapability = new Map<string, string[]>();
  for (const s of cert.valueStreams.streams) {
    const weakest = s.weakestCapability?.module;
    if (!weakest) continue;
    streamsByCapability.set(weakest, [...(streamsByCapability.get(weakest) ?? []), s.name]);
  }

  for (const c of cert.capabilityRegister.capabilities.filter((x) => x.score < 95)) {
    gaps.push({
      id: `capability.${c.module}`,
      area: "capability",
      title: `${c.title} maturity: ${c.score}/100`,
      score: c.score,
      target: 95,
      blocks: streamsByCapability.get(c.module) ?? ["dependent value streams"],
      businessImpact: `Revenue at risk KES ${c.revenueAtRiskKes.toLocaleString()} — limiting dimension ${c.limitingDimension}.`,
      evidenceRequired: [`close ${c.limitingDimension} evidence`, "re-run capability contract validation", "publish rolling certification window"],
      severity: severityFor(c.score, 95),
    });
  }

  for (const s of cert.valueStreams.streams.filter((x) => !x.passed)) {
    gaps.push({
      id: `value_stream.${s.name}`,
      area: "value_stream",
      title: `${s.name} value stream: ${s.score}/100`,
      score: s.score,
      target: 95,
      blocks: [s.weakestCapability?.module ?? "unknown capability"],
      businessImpact: s.slaHonoured ? "Certification short of target with SLA intact." : "SLA breached end-to-end — direct customer impact.",
      evidenceRequired: ["end-to-end run evidence across the stream", "SLA telemetry for the rolling window"],
      severity: severityFor(s.score, 95),
    });
  }

  for (const n of cert.dependencies.nodes.filter((x) => x.chainScore < 95)) {
    gaps.push({
      id: `dependency.${n.module}`,
      area: "dependency",
      title: `${n.module} dependency chain: ${n.chainScore}/100`,
      score: n.chainScore,
      target: 95,
      blocks: n.dependsOn,
      businessImpact: `Weakest link ${n.weakestLink ?? "—"} propagates ${n.propagationImpact} impact downstream.`,
      evidenceRequired: [`raise ${n.weakestLink ?? "upstream"} maturity`, "verify published/consumed event wiring"],
      severity: severityFor(n.chainScore, 95),
    });
  }

  if (!cert.aiGovernance.passed) {
    gaps.push({
      id: "ai_governance.ledger",
      area: "ai_governance",
      title: `AI governance ledger: ${cert.aiGovernance.score}/100`,
      score: cert.aiGovernance.score,
      target: 100,
      blocks: ["autonomous decisioning release"],
      businessImpact: "Non-replayable or ungated AI decisions cannot be defended in audit.",
      evidenceRequired: cert.aiGovernance.findings.slice(0, 4),
      severity: "critical",
    });
  }

  const rank = { critical: 0, high: 1, moderate: 2 } as const;
  return gaps
    .sort((a, b) => rank[a.severity] - rank[b.severity] || a.score - b.score || a.id.localeCompare(b.id))
    .slice(0, limit);
}

export function renderCertificationGapsMarkdown(
  gaps: CertificationGap[] = topCertificationGaps(),
): string {
  if (!gaps.length) return "## Top Remaining Certification Gaps\n\nNone — every certified area is at target.";
  const lines = ["## Top Remaining Certification Gaps", "", "| Severity | Gap | Score → Target | Blocks | Business impact | Evidence required |", "|---|---|---|---|---|---|"];
  for (const g of gaps) {
    lines.push(
      `| ${g.severity.toUpperCase()} | ${g.title} | ${g.score} → ${g.target} | ${g.blocks.join(", ") || "—"} | ${g.businessImpact} | ${g.evidenceRequired.join("; ")} |`,
    );
  }
  return lines.join("\n");
}
