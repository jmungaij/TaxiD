/**
 * Phase 9 §1-§2 — The TaxiD Commerce Loop and Commerce Graph.
 *
 * Governing idea: TaxiD does not sell vehicles, it sells access to mobility
 * capacity. So the commercial spine is NOT lead → CRM → sale. It is
 * demand → capacity → matching → fulfilment → settlement → repeat demand,
 * and sales is one side of that equation rather than the whole of it.
 *
 * Pure configuration + graph logic. No Supabase dependency, so it is unit
 * testable and reusable by every Phase 9 engine.
 */
import { type Measure, type Provenance, unavailableMeasure, weakestProvenance } from "../phase8/provenance";

/* ------------------------------------------------ the commerce loop */

export const COMMERCE_STAGES = [
  "market_demand", "customer_intent", "commercial_opportunity", "required_capacity",
  "supply_discovery", "qualification", "matching", "pricing", "booking",
  "fulfilment", "payment", "settlement", "customer_value", "repeat_demand", "expansion",
] as const;
export type CommerceStage = (typeof COMMERCE_STAGES)[number];

export const STAGE_LABEL: Record<CommerceStage, string> = {
  market_demand: "Market demand",
  customer_intent: "Customer intent",
  commercial_opportunity: "Commercial opportunity",
  required_capacity: "Required mobility capacity",
  supply_discovery: "Supply discovery",
  qualification: "Qualification",
  matching: "Matching",
  pricing: "Pricing",
  booking: "Booking / contract",
  fulfilment: "Fulfilment",
  payment: "Payment",
  settlement: "Settlement",
  customer_value: "Customer value",
  repeat_demand: "Repeat demand",
  expansion: "Expansion",
};

/** Which side of the two-sided marketplace owns the stage. */
export const STAGE_SIDE: Record<CommerceStage, "demand" | "supply" | "both"> = {
  market_demand: "demand",
  customer_intent: "demand",
  commercial_opportunity: "demand",
  required_capacity: "both",
  supply_discovery: "supply",
  qualification: "supply",
  matching: "both",
  pricing: "both",
  booking: "both",
  fulfilment: "supply",
  payment: "demand",
  settlement: "supply",
  customer_value: "demand",
  repeat_demand: "demand",
  expansion: "both",
};

/* ------------------------------------------------ the commerce graph */

export const GRAPH_NODE_KINDS = [
  "customer", "employee", "traveller", "shipment", "booking", "trip", "resource",
  "operator", "driver", "route", "location", "price", "quote", "contract",
  "invoice", "payment", "settlement", "rating", "sla", "incident", "revenue",
] as const;
export type GraphNodeKind = (typeof GRAPH_NODE_KINDS)[number];

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  /** Authoritative table/view this node was read from. */
  source: string;
  provenance: Provenance;
  attributes?: Record<string, string | number | null>;
}

export interface GraphEdge {
  from: string;
  to: string;
  /** e.g. "booked", "fulfilled_by", "priced_at", "settled_to". */
  relation: string;
  source: string;
}

export interface CommerceGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export function emptyGraph(): CommerceGraph {
  return { nodes: [], edges: [] };
}

export function addNode(g: CommerceGraph, node: GraphNode): CommerceGraph {
  if (g.nodes.some((n) => n.id === node.id)) return g;
  return { nodes: [...g.nodes, node], edges: g.edges };
}

export function link(g: CommerceGraph, edge: GraphEdge): CommerceGraph {
  return { nodes: g.nodes, edges: [...g.edges, edge] };
}

export function neighbours(g: CommerceGraph, id: string, relation?: string): GraphNode[] {
  const ids = new Set(
    g.edges
      .filter((e) => (relation ? e.relation === relation : true))
      .flatMap((e) => (e.from === id ? [e.to] : e.to === id ? [e.from] : [])),
  );
  return g.nodes.filter((n) => ids.has(n.id));
}

/** Walk the graph from a start node, returning the reachable node ids. */
export function reachable(g: CommerceGraph, startId: string, maxDepth = 6): Set<string> {
  const seen = new Set<string>([startId]);
  let frontier = [startId];
  for (let d = 0; d < maxDepth && frontier.length; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const n of neighbours(g, id)) {
        if (!seen.has(n.id)) { seen.add(n.id); next.push(n.id); }
      }
    }
    frontier = next;
  }
  return seen;
}

/* ------------------------------------- the seven questions (§2) */

export const GRAPH_QUESTIONS = [
  "Which customer generated this revenue?",
  "Which booking generated it?",
  "Which operator fulfilled it?",
  "What resource was used?",
  "What did TaxiD earn?",
  "What did the operator earn?",
  "What went wrong?",
  "What should happen next?",
] as const;
export type GraphQuestion = (typeof GRAPH_QUESTIONS)[number];

export interface GraphAnswer {
  question: GraphQuestion;
  answer: string | null;
  /** Node ids that support the answer, so the answer is auditable. */
  evidence: string[];
  provenance: Provenance;
}

const QUESTION_KIND: Record<GraphQuestion, GraphNodeKind | null> = {
  "Which customer generated this revenue?": "customer",
  "Which booking generated it?": "booking",
  "Which operator fulfilled it?": "operator",
  "What resource was used?": "resource",
  "What did TaxiD earn?": "revenue",
  "What did the operator earn?": "settlement",
  "What went wrong?": "incident",
  "What should happen next?": null,
};

/**
 * Answer the eight graph questions for a revenue node. An unanswerable question
 * returns `null` — the graph never guesses an attribution.
 */
export function answerGraphQuestions(g: CommerceGraph, revenueNodeId: string): GraphAnswer[] {
  const scope = reachable(g, revenueNodeId);
  const inScope = g.nodes.filter((n) => scope.has(n.id));

  return GRAPH_QUESTIONS.map((question) => {
    const kind = QUESTION_KIND[question];
    if (kind === null) {
      const incident = inScope.find((n) => n.kind === "incident");
      const sla = inScope.find((n) => n.kind === "sla");
      const settled = inScope.find((n) => n.kind === "settlement");
      const next = incident
        ? `Resolve ${incident.label} before pursuing further demand on this chain.`
        : !settled
          ? "Settle the operator — revenue is not complete until the supply side is paid."
          : sla
            ? `Review ${sla.label} adherence and confirm repeat demand.`
            : null;
      return {
        question,
        answer: next,
        evidence: [incident?.id, sla?.id, settled?.id].filter(Boolean) as string[],
        provenance: weakestProvenance(inScope.map((n) => n.provenance)),
      };
    }
    const matches = inScope.filter((n) => n.kind === kind);
    return {
      question,
      answer: matches.length ? matches.map((m) => m.label).join(", ") : null,
      evidence: matches.map((m) => m.id),
      provenance: matches.length ? weakestProvenance(matches.map((n) => n.provenance)) : "UNAVAILABLE",
    };
  });
}

/** A graph that cannot answer an attribution question is an integrity defect. */
export interface AttributionGap {
  question: GraphQuestion;
  consequence: string;
}

export function attributionGaps(answers: readonly GraphAnswer[]): AttributionGap[] {
  const consequence: Partial<Record<GraphQuestion, string>> = {
    "Which customer generated this revenue?": "Revenue cannot be attributed to a customer — cohort and LTV analysis is invalid.",
    "Which booking generated it?": "Revenue is not traceable to a transaction — settlement cannot be reconciled.",
    "Which operator fulfilled it?": "Supply-side attribution is missing — operator economics cannot be computed.",
    "What resource was used?": "Utilisation and capacity planning cannot be computed.",
    "What did TaxiD earn?": "Platform take is unknown — contribution cannot be stated.",
    "What did the operator earn?": "Operator payout is unknown — settlement integrity cannot be asserted.",
    "What went wrong?": "No incident linkage — fulfilment quality cannot be assessed.",
    "What should happen next?": "No next action derivable — the loop does not close into repeat demand.",
  };
  return answers
    .filter((a) => a.answer === null)
    .map((a) => ({ question: a.question, consequence: consequence[a.question] ?? "Attribution incomplete." }));
}

/* --------------------------------- loop instrumentation coverage */

export interface StageInstrumentation {
  stage: CommerceStage;
  /** Table/view that evidences the stage; null when nothing is wired. */
  source: string | null;
  observed: Measure;
}

export interface LoopCoverage {
  stages: StageInstrumentation[];
  /** 0-100 share of loop stages that are actually evidenced. */
  coverage: number;
  breaks: { stage: CommerceStage; reason: string }[];
  provenance: Provenance;
}

/**
 * A loop is only as strong as its weakest stage: a break at settlement makes
 * every upstream revenue claim provisional, so breaks are reported explicitly.
 */
export function assessLoop(stages: readonly StageInstrumentation[]): LoopCoverage {
  const evidenced = stages.filter((s) => s.source !== null && s.observed.value !== null);
  const breaks = stages
    .filter((s) => s.source === null || s.observed.value === null)
    .map((s) => ({
      stage: s.stage,
      reason: s.source === null
        ? `${STAGE_LABEL[s.stage]} has no wired source — the loop cannot be observed here.`
        : `${STAGE_LABEL[s.stage]} is wired to ${s.source} but returned no readable value.`,
    }));
  return {
    stages: [...stages],
    coverage: stages.length ? Math.round((evidenced.length / stages.length) * 100) : 0,
    breaks,
    provenance: weakestProvenance(stages.map((s) => s.observed.provenance)),
  };
}

/** Convenience for callers that cannot read a stage at all. */
export function unwiredStage(stage: CommerceStage): StageInstrumentation {
  return {
    stage,
    source: null,
    observed: unavailableMeasure(STAGE_LABEL[stage], "count", "—", "No source wired for this commerce-loop stage"),
  };
}
