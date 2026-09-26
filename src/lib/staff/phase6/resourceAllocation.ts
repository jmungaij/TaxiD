/**
 * Phase 6 — Resource Allocation Engine and the Attention Economy.
 *
 * SAFARID's scarce resources are capital, human time, management attention, AI
 * compute and marketplace capacity. Allocation is ranked by marginal value per
 * unit of the scarce resource, and every claim is either supported by a readable
 * system of record or reported as unsupported. Management attention is treated
 * as the scarcest resource: the queue below is capped, and anything that does
 * not fit is named rather than quietly dropped.
 */
import type { Coverage } from "@/lib/staff/phase2/readiness";
import { SLA_LABEL, type Prioritised } from "@/lib/staff/phase5/priority";
import { VALUE_STREAMS, type ValueStream } from "./valueEngine";

export const RESOURCES = [
  { key: "capital", label: "Capital", unit: "KES committed", constraint: "Wallet funding and settlement float" },
  { key: "human_time", label: "Human time", unit: "person-hours", constraint: "Headcount by department" },
  { key: "management_attention", label: "Management attention", unit: "decisions/day", constraint: "Hard cap — the scarcest resource" },
  { key: "ai_compute", label: "AI compute", unit: "agent runs", constraint: "Cost and safety budget" },
  { key: "marketplace_capacity", label: "Marketplace capacity", unit: "verified vehicles", constraint: "Activated partner supply" },
  { key: "sales_capacity", label: "Sales capacity", unit: "pursuits", constraint: "Commercial team coverage" },
  { key: "finance_capacity", label: "Finance capacity", unit: "cases", constraint: "Finance and assurance team" },
  { key: "operational_capacity", label: "Operational capacity", unit: "movements", constraint: "Dispatch and fulfilment" },
  { key: "customer_success_capacity", label: "Customer success capacity", unit: "tickets", constraint: "Customer operations team" },
  { key: "technology_capacity", label: "Technology capacity", unit: "changes", constraint: "Engineering throughput" },
] as const;

export type ResourceKey = (typeof RESOURCES)[number]["key"];

export const resourceLabel = (key: string) =>
  RESOURCES.find((r) => r.key === key)?.label ?? key;

export interface AllocationCandidate {
  stream: ValueStream;
  /** Resource the claim consumes. */
  resource: string;
  /** Measured evidence volume behind the claim, or null. */
  evidence: number | null;
  /** Marginal value per unit of resource, 0–100, or null when unquantifiable. */
  marginalValue: number | null;
  supported: boolean;
  reason: string | null;
}

/**
 * Rank every value stream by marginal value per unit of its scarce resource.
 * A stream whose system of record is unreadable is returned unsupported: it can
 * still be argued for by a human, but it cannot outrank measured work.
 */
export function rankAllocation(coverage: Coverage): AllocationCandidate[] {
  const candidates = VALUE_STREAMS.map((stream): AllocationCandidate => {
    const probe = stream.quantifiedBy ? coverage[stream.quantifiedBy] : undefined;
    if (!probe || probe.rows === null) {
      return {
        stream,
        resource: stream.consumes,
        evidence: null,
        marginalValue: null,
        supported: false,
        reason: stream.quantifiedBy
          ? `${stream.quantifiedBy} ${probe ? probe.error ?? "unreadable" : "not probed"}`
          : "no system of record",
      };
    }
    // Diminishing returns: a stream already carrying large volume earns less
    // marginal value from an additional unit of the same resource.
    const rows = probe.rows;
    const breadth = stream.dimensions.length; // streams serving more objective terms rank higher
    const marginalValue = Math.max(
      0,
      Math.min(100, Math.round(breadth * 18 + 40 - Math.log10(rows + 1) * 12)),
    );
    return { stream, resource: stream.consumes, evidence: rows, marginalValue, supported: true, reason: null };
  });

  return candidates.sort((a, b) => {
    if (a.supported !== b.supported) return a.supported ? -1 : 1;
    return (b.marginalValue ?? -1) - (a.marginalValue ?? -1);
  });
}

export interface ResourcePressure {
  resource: string;
  label: string;
  unit: string;
  constraint: string;
  /** Streams competing for this resource. */
  claims: number;
  /** Claims that cannot be measured. */
  unsupportedClaims: number;
  contention: "low" | "moderate" | "high";
}

export function resourcePressure(candidates: readonly AllocationCandidate[]): ResourcePressure[] {
  return RESOURCES.map((r) => {
    const claims = candidates.filter((c) => c.resource === r.key);
    const unsupported = claims.filter((c) => !c.supported).length;
    return {
      resource: r.key,
      label: r.label,
      unit: r.unit,
      constraint: r.constraint,
      claims: claims.length,
      unsupportedClaims: unsupported,
      contention: (claims.length >= 3 ? "high" : claims.length === 2 ? "moderate" : "low") as ResourcePressure["contention"],
    };
  }).sort((a, b) => b.claims - a.claims);
}

/* ----------------------------------------------------- the attention economy */

/** Hard cap on how many situations a human authority is asked to hold at once. */
export const ATTENTION_CAP = 7;

export interface AttentionItem {
  item: Prioritised;
  rank: number;
  /** Why this item earned scarce attention. */
  justification: string;
}

export interface AttentionQueue {
  items: AttentionItem[];
  /** Situations that did not fit the cap — named, never hidden. */
  deferred: Prioritised[];
  cap: number;
  /** Situations excluded because no contributing evidence was readable. */
  unevidenced: Prioritised[];
}

/**
 * Build the capped attention queue from ranked Phase 5 situations. Items with no
 * readable evidence are separated out: they represent a sensing failure to fix,
 * not a business decision to make.
 */
export function buildAttentionQueue(
  prioritised: readonly Prioritised[],
  cap = ATTENTION_CAP,
): AttentionQueue {
  const unevidenced = prioritised.filter((p) => p.correlation.evidence.length === 0);
  const evidenced = prioritised.filter((p) => p.correlation.evidence.length > 0);
  const items = evidenced.slice(0, cap).map((item, i) => ({
    item,
    rank: i + 1,
    justification: `${SLA_LABEL[item.sla]} · priority ${item.score} · confidence ${Math.round(item.confidence * 100)}%`,
  }));
  return { items, deferred: evidenced.slice(cap), cap, unevidenced };
}

/* ------------------------------------------------- productivity measurement */

export interface ProductivityMeasure {
  key: string;
  label: string;
  /** What a genuine improvement would look like. */
  improvement: string;
  quantifiedBy: string | null;
  observed: number | null;
  measured: boolean;
}

const PRODUCTIVITY: readonly { key: string; label: string; improvement: string; table: string | null }[] = [
  { key: "decisions_made", label: "Authorised decisions completed", improvement: "More decisions closed per reviewer, with audit intact", table: "staff_decisions" },
  { key: "outcomes_measured", label: "Actions with measured outcomes", improvement: "Higher share of actions whose real effect is known", table: "staff_action_outcomes" },
  { key: "live_sensing", label: "Signature-verified events ingested", improvement: "Less manual reporting, more automatic sensing", table: "staff_live_events" },
  { key: "cases_resolved", label: "Customer cases resolved", improvement: "Shorter resolution with unchanged quality", table: "corporate_support_tickets" },
  { key: "assurance_findings", label: "Assurance findings closed", improvement: "Leakage found and recovered earlier", table: "charter_wallet_reconciliation_findings" },
  { key: "experiments_run", label: "Experiments with measured results", improvement: "Decisions replaced by evidence", table: "staff_experiments" },
];

export function productivityMeasures(coverage: Coverage): ProductivityMeasure[] {
  return PRODUCTIVITY.map((p) => {
    const probe = p.table ? coverage[p.table] : undefined;
    const measured = !!probe && probe.rows !== null;
    return {
      key: p.key,
      label: p.label,
      improvement: p.improvement,
      quantifiedBy: p.table,
      observed: measured ? probe!.rows : null,
      measured,
    };
  });
}
