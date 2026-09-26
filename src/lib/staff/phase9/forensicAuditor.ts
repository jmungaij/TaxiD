/**
 * Phase 9 §37, §38, §40 — the Phase 9 forensic auditor and production exit
 * criteria.
 *
 * Audits every module on nine value dimensions and names the specific
 * anti-patterns the phase was created to eliminate: dashboards without
 * decisions, sales promises without supply validation, revenue without
 * settlement, marketplace supply without quality control.
 */

export const VALUE_DIMENSIONS = [
  "commercial", "marketplace", "productivity", "customer",
  "operational", "financial", "risk", "data", "strategic",
] as const;
export type ValueDimension = (typeof VALUE_DIMENSIONS)[number];

export const VALUE_LABEL: Record<ValueDimension, string> = {
  commercial: "Commercial value",
  marketplace: "Marketplace value",
  productivity: "Productivity value",
  customer: "Customer value",
  operational: "Operational value",
  financial: "Financial value",
  risk: "Risk value",
  data: "Data value",
  strategic: "Strategic value",
};

export const ANTI_PATTERNS = [
  "duplicate_system", "unconnected_module", "false_live_metric", "unowned_workflow",
  "manual_bottleneck", "ai_without_roi", "dashboard_without_decision",
  "promise_without_supply", "operations_without_commercial_context",
  "revenue_without_settlement", "supply_without_quality_control",
] as const;
export type AntiPattern = (typeof ANTI_PATTERNS)[number];

export const ANTI_PATTERN_LABEL: Record<AntiPattern, string> = {
  duplicate_system: "Duplicate system",
  unconnected_module: "Unconnected module",
  false_live_metric: "False-live metric",
  unowned_workflow: "Unowned workflow",
  manual_bottleneck: "Manual bottleneck",
  ai_without_roi: "AI without ROI",
  dashboard_without_decision: "Dashboard without decisions",
  promise_without_supply: "Sales promise without supply validation",
  operations_without_commercial_context: "Operations without commercial context",
  revenue_without_settlement: "Revenue without settlement",
  supply_without_quality_control: "Marketplace supply without quality controls",
};

export const ANTI_PATTERN_CONSEQUENCE: Record<AntiPattern, string> = {
  duplicate_system: "Two systems of record for one entity guarantees divergent truth.",
  unconnected_module: "A module outside the commerce graph cannot be attributed to revenue.",
  false_live_metric: "A modelled or seeded number presented as live misleads commercial decisions.",
  unowned_workflow: "No accountable owner means no one closes the loop.",
  manual_bottleneck: "Human throughput becomes the ceiling on marketplace volume.",
  ai_without_roi: "Model spend without measured effect is cost, not capability.",
  dashboard_without_decision: "Observation without an action path produces no value.",
  promise_without_supply: "Selling unvalidated capacity converts revenue into fulfilment failure.",
  operations_without_commercial_context: "Fulfilment decisions made without contribution destroy margin.",
  revenue_without_settlement: "Unsettled revenue is not cash and the supply side is unpaid.",
  supply_without_quality_control: "Unvetted supply transfers risk directly to the demand side.",
};

export interface ModuleAuditInput {
  moduleId: string;
  name: string;
  /** 0-100 per dimension; null when not assessable. */
  dimensionScores: Partial<Record<ValueDimension, number | null>>;
  /** Anti-patterns observed with the concrete evidence for each. */
  observedAntiPatterns: { pattern: AntiPattern; evidence: string }[];
  /** Is the module wired into the commerce graph? */
  inCommerceGraph: boolean;
  /** Named accountable owner. */
  owner: string | null;
  /** Does the module lead to a decision or action? */
  producesDecision: boolean;
}

export interface ModuleAudit {
  moduleId: string;
  name: string
  verdict: "production_grade" | "conditional" | "remediate" | "not_evidenced";
  score: number | null;
  dimensions: { dimension: ValueDimension; score: number | null }[];
  findings: { pattern: AntiPattern; evidence: string; consequence: string }[];
  requiredActions: string[];
}

export function auditModule(i: ModuleAuditInput): ModuleAudit {
  const dimensions = VALUE_DIMENSIONS.map((dimension) => ({ dimension, score: i.dimensionScores[dimension] ?? null }));
  const usable = dimensions.filter((d) => d.score !== null);
  const score = usable.length ? usable.reduce((a, d) => a + (d.score ?? 0), 0) / usable.length : null;

  const findings = i.observedAntiPatterns.map((p) => ({
    pattern: p.pattern, evidence: p.evidence, consequence: ANTI_PATTERN_CONSEQUENCE[p.pattern],
  }));

  const requiredActions: string[] = [];
  if (!i.inCommerceGraph) requiredActions.push("Wire the module into the commerce graph so its output is attributable to revenue.");
  if (!i.owner) requiredActions.push("Assign a named accountable owner.");
  if (!i.producesDecision) requiredActions.push("Attach a decision or action to the module, or retire it.");
  for (const f of findings) requiredActions.push(`Resolve ${ANTI_PATTERN_LABEL[f.pattern]}: ${f.evidence}`);
  if (usable.length < 5) requiredActions.push(`Assess the remaining ${VALUE_DIMENSIONS.length - usable.length} value dimension(s) — an unassessed module cannot be certified.`);

  const verdict: ModuleAudit["verdict"] =
    usable.length < 5 ? "not_evidenced"
      : findings.length === 0 && requiredActions.length === 0 && (score ?? 0) >= 75 ? "production_grade"
      : findings.some((f) => ["promise_without_supply", "revenue_without_settlement", "false_live_metric", "supply_without_quality_control"].includes(f.pattern)) ? "remediate"
      : "conditional";

  return { moduleId: i.moduleId, name: i.name, verdict, score, dimensions, findings, requiredActions };
}

export interface Phase9AuditReport {
  modules: ModuleAudit[];
  productionGrade: number;
  remediate: number;
  /** Anti-patterns ranked by how many modules exhibit them. */
  systemicPatterns: { pattern: AntiPattern; count: number; consequence: string }[];
  headline: string;
}

export function runPhase9Audit(inputs: readonly ModuleAuditInput[]): Phase9AuditReport {
  const modules = inputs.map(auditModule).sort((a, b) => (a.score ?? 101) - (b.score ?? 101));
  const counts = new Map<AntiPattern, number>();
  for (const m of modules) for (const f of m.findings) counts.set(f.pattern, (counts.get(f.pattern) ?? 0) + 1);

  const systemic = [...counts.entries()]
    .map(([pattern, count]) => ({ pattern, count, consequence: ANTI_PATTERN_CONSEQUENCE[pattern] }))
    .sort((a, b) => b.count - a.count);

  const pg = modules.filter((m) => m.verdict === "production_grade").length;
  const rem = modules.filter((m) => m.verdict === "remediate").length;

  return {
    modules,
    productionGrade: pg,
    remediate: rem,
    systemicPatterns: systemic,
    headline: modules.length === 0
      ? "No module has been submitted for audit."
      : `${pg}/${modules.length} module(s) production-grade, ${rem} requiring remediation${systemic[0] ? `. Dominant systemic pattern: ${ANTI_PATTERN_LABEL[systemic[0].pattern]} (${systemic[0].count} module(s))` : ""}.`,
  };
}

/* ---------------------------------- §40 production exit criteria */

export const EXIT_CRITERIA = [
  { id: "demand_detected", label: "Demand can be detected" },
  { id: "supply_measured", label: "Supply can be measured" },
  { id: "capacity_validated", label: "Capacity can be validated" },
  { id: "customers_qualified", label: "Customers can be commercially qualified" },
  { id: "opportunity_matched", label: "Opportunities can be matched to capacity" },
  { id: "price_under_policy", label: "Prices can be calculated under policy" },
  { id: "booking_executed", label: "Bookings can be executed" },
  { id: "operations_fulfil", label: "Operations can fulfil" },
  { id: "exceptions_escalated", label: "Exceptions can be escalated" },
  { id: "payments_reconciled", label: "Payments can be reconciled" },
  { id: "operators_settled", label: "Operators can be settled" },
  { id: "revenue_attributed", label: "Revenue can be attributed" },
  { id: "customer_value_measured", label: "Customer value can be measured" },
  { id: "liquidity_measured", label: "Marketplace liquidity can be measured" },
  { id: "failures_learned", label: "Failures can be learned from" },
  { id: "demand_informs_supply", label: "Demand can inform future supply acquisition" },
] as const;
export type ExitCriterionId = (typeof EXIT_CRITERIA)[number]["id"];

export interface ExitEvidence {
  id: ExitCriterionId;
  /** Engine or table that demonstrates the capability. */
  demonstratedBy: string | null;
  /** Live data proving it, when available. */
  liveEvidence: string | null;
}

export interface ExitCriterionStatus {
  id: ExitCriterionId;
  label: string;
  status: "demonstrated_live" | "implemented_awaiting_data" | "not_implemented";
  detail: string;
}

export interface Phase9Certification {
  criteria: ExitCriterionStatus[];
  demonstratedLive: number;
  implemented: number;
  complete: boolean;
  /** The phase is not complete on code alone; live evidence is required. */
  statement: string;
}

export function certifyPhase9(evidence: readonly ExitEvidence[]): Phase9Certification {
  const byId = new Map(evidence.map((e) => [e.id, e]));
  const criteria: ExitCriterionStatus[] = EXIT_CRITERIA.map((c) => {
    const e = byId.get(c.id);
    if (!e || !e.demonstratedBy) {
      return { id: c.id, label: c.label, status: "not_implemented", detail: "No engine or table demonstrates this capability." };
    }
    if (!e.liveEvidence) {
      return { id: c.id, label: c.label, status: "implemented_awaiting_data", detail: `Implemented in ${e.demonstratedBy}; awaiting live transactional evidence.` };
    }
    return { id: c.id, label: c.label, status: "demonstrated_live", detail: `${e.demonstratedBy} — ${e.liveEvidence}` };
  });

  const live = criteria.filter((c) => c.status === "demonstrated_live").length;
  const impl = criteria.filter((c) => c.status === "implemented_awaiting_data").length;
  const missing = criteria.filter((c) => c.status === "not_implemented").length;

  return {
    criteria,
    demonstratedLive: live,
    implemented: impl,
    complete: live === criteria.length,
    statement: missing > 0
      ? `Phase 9 is NOT complete: ${missing} exit criterion(a) have no implementation.`
      : live === criteria.length
        ? "Phase 9 is complete: every exit criterion is demonstrated against live connected systems."
        : `Phase 9 is engineered but not certified: ${impl} criterion(a) await live transactional evidence. Code presence is not proof of a working marketplace.`,
  };
}
