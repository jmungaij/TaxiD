/**
 * Search → workflow trace linkage.
 *
 * Any authorised search result can be traced into the Demand → CLV chain: the
 * entity class declares which stage it evidences, so the trace shows what must
 * already have happened upstream, what should follow downstream, and which
 * integrity checks apply at the entry point. The trace never asserts that a
 * particular record satisfied a check — it states the check and where its
 * evidence lives.
 */
import {
  WORKFLOW_STAGES,
  WORKFLOW_INTEGRITY_CHECKS,
  type WorkflowStage,
  type WorkflowStageId,
} from "@/lib/staff/marketplaceWorkflow";
import { adapterFor, type SearchEntityId, type SearchHit } from "@/lib/staff/universalSearch";

export interface WorkflowTraceTarget {
  entity: SearchEntityId;
  entityLabel: string;
  recordId?: string;
  recordLabel?: string;
}

export interface WorkflowTrace {
  target: WorkflowTraceTarget;
  entryStage: WorkflowStage;
  upstream: WorkflowStage[];
  downstream: WorkflowStage[];
  /** Checks that must hold for the record to be trustworthy at this point. */
  integrityChecks: string[];
  /** What is still unproven for this specific record, stated honestly. */
  unproven: string[];
}

/** Integrity checks relevant to each entry stage. */
const STAGE_CHECKS: Record<WorkflowStageId, string[]> = {
  demand: [
    "Every enquiry resolves to exactly one customer or a deliberate new-customer decision",
    "Channel attribution is recorded, not inferred",
  ],
  customer: [
    "Every authorised request passes a policy and credit check before matching",
    "Every approval action has an identified approver and timestamp",
  ],
  matching: [
    "Every match traces to a verified, compliant participant",
    "Every quoted price traces to a governed pricing rule or floor",
  ],
  supply: [
    "Every assignment traces to a compliant, verified participant",
    "No compliance document backing an assignment is expired",
  ],
  fulfilment: [
    "Every fulfilled service resolves to exactly one payment record",
    "Every exception is closed with a recorded resolution",
  ],
  payment: [
    "Every wallet credit traces to a verified payment callback",
    "Every recognised revenue line traces to a balanced journal",
  ],
  lifetime_value: [
    "Every lifetime-value figure traces to transaction history only",
    "Retention and expansion signals derive from platform events, not estimates",
  ],
};

export function buildWorkflowTrace(
  entity: SearchEntityId,
  hit?: Pick<SearchHit, "id" | "title">,
): WorkflowTrace | undefined {
  const adapter = adapterFor(entity);
  if (!adapter) return undefined;
  const index = WORKFLOW_STAGES.findIndex((s) => s.id === adapter.stage);
  if (index < 0) return undefined;

  return {
    target: {
      entity,
      entityLabel: adapter.label,
      recordId: hit?.id,
      recordLabel: hit?.title,
    },
    entryStage: WORKFLOW_STAGES[index],
    upstream: WORKFLOW_STAGES.slice(0, index),
    downstream: WORKFLOW_STAGES.slice(index + 1),
    integrityChecks: STAGE_CHECKS[adapter.stage] ?? [...WORKFLOW_INTEGRITY_CHECKS],
    unproven: [
      "Whether this specific record satisfies each check is resolved by the owning module, not asserted here.",
      adapter.table
        ? `Entry evidence reads from ${adapter.table} under your access.`
        : "No wired source backs this class yet, so the entry point is structural only.",
    ],
  };
}

/** Query string for a deep link into the workflow surface. */
export function traceHref(entity: SearchEntityId, hit?: Pick<SearchHit, "id" | "title">): string {
  const adapter = adapterFor(entity);
  const params = new URLSearchParams();
  if (adapter) {
    params.set("stage", adapter.stage);
    params.set("entity", entity);
  }
  if (hit?.id) params.set("record", hit.id);
  if (hit?.title) params.set("label", hit.title.slice(0, 120));
  return `/staff/workflow?${params.toString()}`;
}

/** Read a trace target back out of workflow-surface search params. */
export function traceFromParams(params: URLSearchParams): {
  stage?: WorkflowStageId;
  entity?: SearchEntityId;
  recordId?: string;
  recordLabel?: string;
} {
  const stage = params.get("stage") as WorkflowStageId | null;
  const entity = params.get("entity") as SearchEntityId | null;
  return {
    stage: WORKFLOW_STAGES.some((s) => s.id === stage) ? (stage as WorkflowStageId) : undefined,
    entity: entity && adapterFor(entity) ? entity : undefined,
    recordId: params.get("record") ?? undefined,
    recordLabel: params.get("label") ?? undefined,
  };
}
