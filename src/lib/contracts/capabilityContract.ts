/**
 * Business Capability Contract — the self-describing module standard.
 *
 * Every enterprise module must publish one contract. It makes the module
 * testable, integrable and auditable without reading its source:
 *
 *   workflows · published events · consumed events · dependencies ·
 *   operational KPIs · AI capability roadmap · failure modes · escalation paths
 *
 * Pure configuration. The registry is validated by `validateContract` so a
 * malformed or incomplete contract fails loudly during certification.
 */

export type ModuleId =
  | "corporate"
  | "customer_operations"
  | "delivery_logistics"
  | "finance_refunds"
  | "fleet"
  | "marketplace"
  | "mobility"
  | "trust_safety";

export interface WorkflowSpec {
  id: string;
  name: string;
  trigger: string;
  /** Ordered high-level stages — must map to a playbook or SOP. */
  stages: string[];
  /** Maker-checker or approval gates inside the workflow. */
  approvals: string[];
  /** Target completion in minutes. */
  targetMinutes: number;
}

export interface EventSpec {
  name: string;
  payload: string[];
  /** Latency budget in minutes for producers/consumers of this event. */
  latencyBudgetMinutes: number;
  criticality: "critical" | "standard";
}

export interface DependencySpec {
  module: ModuleId | string;
  reason: string;
  /** Behaviour when the dependency is unavailable. */
  degradedBehaviour: string;
}

export interface KpiSpec {
  id: string;
  name: string;
  unit: "percent" | "minutes" | "count" | "kes";
  target: string;
  source: string;
}

export type AiCapabilityStatus = "live" | "preview" | "planned";

export interface AiCapabilitySpec {
  /** Discrete service, never a generic chatbot. */
  service:
    | "classification"
    | "prioritization"
    | "similar_case_retrieval"
    | "sop_recommendation"
    | "executive_summarization"
    | "risk_detection"
    | "forecasting"
    | "natural_language_query";
  status: AiCapabilityStatus;
  description: string;
  /** How the service is evaluated before it can move to `live`. */
  evaluation: string;
}

export interface FailureModeSpec {
  id: string;
  mode: string;
  detection: string;
  impact: string;
  mitigation: string;
}

export interface EscalationPathSpec {
  trigger: string;
  tier: string;
  owner: string;
  responseMinutes: number;
}

export interface CapabilityContract {
  module: ModuleId;
  title: string;
  version: string;
  route: string;
  owner: string;
  workflows: WorkflowSpec[];
  publishes: EventSpec[];
  consumes: EventSpec[];
  dependencies: DependencySpec[];
  kpis: KpiSpec[];
  aiRoadmap: AiCapabilitySpec[];
  failureModes: FailureModeSpec[];
  escalationPaths: EscalationPathSpec[];
}

export interface ContractValidation {
  module: ModuleId;
  ok: boolean;
  missing: string[];
  warnings: string[];
  /** 0-100 completeness of the contract. */
  completeness: number;
}

const REQUIRED_SECTIONS: (keyof CapabilityContract)[] = [
  "workflows",
  "publishes",
  "consumes",
  "dependencies",
  "kpis",
  "aiRoadmap",
  "failureModes",
  "escalationPaths",
];

export function validateContract(contract: CapabilityContract): ContractValidation {
  const missing: string[] = [];
  const warnings: string[] = [];

  for (const section of REQUIRED_SECTIONS) {
    const value = contract[section] as unknown[];
    if (!Array.isArray(value) || value.length === 0) missing.push(section);
  }

  if (contract.workflows.some((w) => w.stages.length === 0)) warnings.push("A workflow declares no stages");
  if (contract.publishes.some((e) => e.payload.length === 0)) warnings.push("A published event declares no payload");
  if (contract.aiRoadmap.every((a) => a.status === "planned")) warnings.push("No AI capability has reached preview");
  if (contract.escalationPaths.some((p) => p.responseMinutes <= 0)) warnings.push("An escalation path has no response target");

  const completeness = Math.round(((REQUIRED_SECTIONS.length - missing.length) / REQUIRED_SECTIONS.length) * 100);
  return { module: contract.module, ok: missing.length === 0, missing, warnings, completeness };
}
