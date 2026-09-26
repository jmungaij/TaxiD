/**
 * Phase 10 §10.11, §10.22, §10.26 — the marketplace intelligence triangle, the
 * Enterprise Commercial Graph and the Enterprise Knowledge Graph.
 *
 * Customer 360 ↔ Mission 360 ↔ Provider 360 is the triangle that lets the
 * platform answer questions no single object can: which provider suits this
 * customer, which customers suit this provider, which missions are unfulfilled,
 * and which provider acquisition would unlock the most value.
 */
import { type Measure, liveMeasure, modelledMeasure, unavailableMeasure } from "../phase8/provenance";
import type { Mission, ProductLine } from "./mission";
import type { Provider360 } from "./provider360";

export interface Customer360 {
  customerId: string;
  name: string;
  kind: "individual" | "corporate";
  accountId?: string;
  segments: string[];
  productLines: ProductLine[];
  missionsCompleted: number | null;
  spendCents: number | null;
  contributionCents: number | null;
  slaBreaches: number | null;
  openExceptions: number | null;
  preferredProviderIds: string[];
  requiredCompliance: string[];
  asOf: string | null;
}

export interface Mission360 {
  mission: Mission;
  providerId: string | null;
  /** Trust completeness 0-100, from the trust graph. */
  trustCompleteness: number | null;
  exceptionCount: number;
  contributionCents: number | null;
  /** True when the mission has reached settled or beyond. */
  economicallyClosed: boolean;
}

export interface TriangleFit {
  customerId: string;
  providerId: string;
  /** 0-100 suitability of this provider for this customer. */
  fit: number | null;
  reasons: string[];
  blockers: string[];
}

/**
 * Suitability is compliance-first: a provider that cannot meet the customer's
 * mandatory credentials is not a "lower-scoring" option, it is not an option.
 */
export function assessFit(customer: Customer360, provider: Provider360): TriangleFit {
  const reasons: string[] = [];
  const blockers: string[] = [];

  for (const line of customer.productLines) {
    if (!provider.identity.services.includes(line)) {
      blockers.push(`Provider does not serve ${line.replace(/_/g, " ")}`);
    }
  }
  if (provider.riskFlags.length > 0) blockers.push(`Provider carries ${provider.riskFlags.length} open risk flag(s)`);

  if (blockers.length > 0) return { customerId: customer.customerId, providerId: provider.identity.providerId, fit: null, reasons, blockers };

  const quality = provider.quality.score;
  if (quality === null) {
    return {
      customerId: customer.customerId,
      providerId: provider.identity.providerId,
      fit: null,
      reasons,
      blockers: ["Provider has no published quality score — suitability cannot be asserted"],
    };
  }

  let fit = quality * 0.6;
  if (customer.preferredProviderIds.includes(provider.identity.providerId)) {
    fit += 20;
    reasons.push("Customer has declared a preference for this provider");
  }
  if (provider.fulfilment.value !== null) {
    fit += (provider.fulfilment.value / 100) * 20;
    reasons.push(`Fulfilment rate of ${Math.round(provider.fulfilment.value)}%`);
  } else {
    reasons.push("Fulfilment rate is not observed — fit rests on quality alone");
  }

  return {
    customerId: customer.customerId,
    providerId: provider.identity.providerId,
    fit: Math.round(Math.min(100, fit)),
    reasons,
    blockers,
  };
}

/** §10.11: which provider acquisition would unlock the most customer value? */
export interface AcquisitionOpportunity {
  productLine: ProductLine;
  unfulfilledMissions: number;
  /** Value unlocked if this supply gap were closed. */
  valueUnlocked: Measure;
  rationale: string;
}

export function acquisitionOpportunities(
  unfulfilled: readonly Mission360[],
  contributionPerMissionCents: number | null,
): AcquisitionOpportunity[] {
  const src = "mission telemetry + transaction spine";
  const byLine = new Map<ProductLine, number>();
  for (const m of unfulfilled) byLine.set(m.mission.product, (byLine.get(m.mission.product) ?? 0) + 1);

  return [...byLine.entries()]
    .map(([productLine, count]) => ({
      productLine,
      unfulfilledMissions: count,
      valueUnlocked: contributionPerMissionCents === null
        ? unavailableMeasure("Value unlocked", "kes", src, "Contribution per mission is not observed")
        : modelledMeasure("Value unlocked", (count * contributionPerMissionCents) / 100, "kes", src,
            "unfulfilled missions × observed contribution per mission", 45, "yalla-p10-graph-1.0.0"),
      rationale: `${count} unfulfilled ${productLine.replace(/_/g, " ")} mission(s) indicate a supply gap, not a demand gap.`,
    }))
    .sort((a, b) => (b.valueUnlocked.value ?? -1) - (a.valueUnlocked.value ?? -1));
}

/* ------------------------------------------------------------------ */
/* §10.22 Enterprise Commercial Graph                                  */
/* ------------------------------------------------------------------ */

export const COMMERCIAL_GRAPH_NODES = [
  "customer", "account", "programme", "mission", "booking", "provider",
  "fulfilment", "payment", "settlement", "revenue", "outcome",
] as const;
export type CommercialGraphNode = (typeof COMMERCIAL_GRAPH_NODES)[number];

export interface GraphEdgeState {
  from: CommercialGraphNode;
  to: CommercialGraphNode;
  /** Evidence that this hop exists for the traced entity. */
  evidenced: boolean;
  source: string;
  note?: string;
}

export interface CommercialGraphTrace {
  entityRef: string;
  edges: GraphEdgeState[];
  /** 0-100 share of hops evidenced. */
  completeness: number;
  brokenAt: CommercialGraphNode | null;
  narrative: string;
}

export function traceCommercialGraph(entityRef: string, edges: readonly GraphEdgeState[]): CommercialGraphTrace {
  const ordered = [...edges];
  const firstBreak = ordered.find((e) => !e.evidenced) ?? null;
  const completeness = ordered.length === 0 ? 0 : Math.round((ordered.filter((e) => e.evidenced).length / ordered.length) * 100);
  return {
    entityRef,
    edges: ordered,
    completeness,
    brokenAt: firstBreak?.from ?? null,
    narrative: firstBreak
      ? `Chain breaks at ${firstBreak.from} → ${firstBreak.to}: ${firstBreak.note ?? "no evidence recorded"}`
      : `Full commercial chain evidenced across ${ordered.length} hops.`,
  };
}

/* ------------------------------------------------------------------ */
/* §10.26 Enterprise Knowledge Graph                                   */
/* ------------------------------------------------------------------ */

export const KNOWLEDGE_ENTITIES = [
  "person", "customer", "company", "provider", "resource", "service", "market",
  "mission", "transaction", "contract", "payment", "risk", "decision", "outcome", "knowledge",
] as const;
export type KnowledgeEntity = (typeof KNOWLEDGE_ENTITIES)[number];

export interface KnowledgeNode {
  entity: KnowledgeEntity;
  /** Authoritative source of truth — never duplicated in Phase 10. */
  systemOfRecord: string;
  /** Observed instance count; null when the entity is not yet instrumented. */
  count: number | null;
  connectedTo: KnowledgeEntity[];
}

export interface KnowledgeGraphHealth {
  nodes: KnowledgeNode[];
  instrumented: number;
  total: number;
  coverage: Measure;
  /** Entities with no source of truth — the contextual memory gaps. */
  gaps: KnowledgeEntity[];
}

export function assessKnowledgeGraph(nodes: readonly KnowledgeNode[]): KnowledgeGraphHealth {
  const src = "Yalla enterprise knowledge graph registry";
  const instrumented = nodes.filter((n) => n.count !== null).length;
  return {
    nodes: [...nodes],
    instrumented,
    total: nodes.length,
    coverage: nodes.length === 0
      ? unavailableMeasure("Knowledge graph coverage", "percent", src, "No entities are registered")
      : liveMeasure("Knowledge graph coverage", (instrumented / nodes.length) * 100, "percent", src,
          "entities with an instrumented source of truth ÷ registered entities"),
    gaps: nodes.filter((n) => n.count === null).map((n) => n.entity),
  };
}
