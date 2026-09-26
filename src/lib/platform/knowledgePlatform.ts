/**
 * Enterprise Knowledge Platform — IEOS Phase 8, Layer A.
 *
 * The event registry answers "how is this event governed / behaving".  The
 * Knowledge Platform answers "how is EVERYTHING connected".  It is a DERIVED,
 * in-memory knowledge graph: nodes and edges are computed from the assets the
 * platform already owns (capability contracts, canonical events, business
 * processes, policies, metric contracts) plus a small, explicit table of
 * business-object domains.
 *
 * No graph database, no new storage, no network, no state — pure functions over
 * existing configuration, so the graph can never drift from the catalogs.
 */
import { CAPABILITY_CONTRACTS } from "@/lib/contracts";
import { ENTERPRISE_EVENT_CATALOG, type EventDomain } from "./eventCatalog";
import { BUSINESS_PROCESS_CATALOG } from "./processCatalog";
import { POLICY_REGISTRY } from "./policyRegistry";
import { METRIC_CONTRACTS } from "./semanticLayer";
import { makeFinding, sortFindings, clamp, type PlatformFinding } from "./_shared";

// ── Node / edge model ──────────────────────────────────────────────────────

export type KnowledgeNodeKind =
  | "business_object"
  | "capability"
  | "process"
  | "process_stage"
  | "event"
  | "policy"
  | "metric"
  | "workflow"
  | "ai_service";

export type KnowledgeEdgeKind =
  | "owns"
  | "publishes"
  | "consumes"
  | "depends_on"
  | "evidenced_by"
  | "governs"
  | "measures"
  | "contains"
  | "operates_on"
  | "executes";

export interface KnowledgeNode {
  id: string;
  kind: KnowledgeNodeKind;
  label: string;
  /** Business domain the node belongs to; used for blast-radius grouping. */
  domain: string;
  owner: string;
  /** Free-form, serialisable descriptors — never secrets. */
  attributes: Record<string, string | number | boolean>;
}

export interface KnowledgeEdge {
  from: string;
  to: string;
  kind: KnowledgeEdgeKind;
  /** Why the relationship exists — rendered in explorers. */
  reason: string;
}

export interface KnowledgeGraph {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
}

// ── Business objects ───────────────────────────────────────────────────────
// The enterprise nouns. Each is bound to the capabilities that operate on it,
// so entity-level questions ("who touches inventory?") resolve through the same
// traversal engine as capability-level ones.

interface BusinessObjectSpec {
  id: string;
  label: string;
  domain: EventDomain | "platform" | "analytics";
  owner: string;
  /** Capability modules / process owners that operate on the object. */
  operatedBy: string[];
}

export const BUSINESS_OBJECTS: BusinessObjectSpec[] = [
  { id: "rider", label: "Riders", domain: "mobility", owner: "mobility_operations", operatedBy: ["mobility", "customer_operations", "trust_safety", "finance_refunds"] },
  { id: "driver", label: "Drivers", domain: "fleet", owner: "fleet", operatedBy: ["fleet", "mobility", "trust_safety", "finance_refunds", "delivery_logistics"] },
  { id: "vehicle", label: "Vehicles", domain: "fleet", owner: "fleet", operatedBy: ["fleet", "delivery_logistics"] },
  { id: "trip", label: "Trips", domain: "mobility", owner: "mobility_operations", operatedBy: ["mobility", "finance_refunds", "corporate", "customer_operations"] },
  { id: "delivery", label: "Deliveries", domain: "delivery", owner: "delivery_logistics", operatedBy: ["delivery_logistics", "customer_operations", "finance_refunds"] },
  { id: "warehouse", label: "Warehouses", domain: "delivery", owner: "delivery_logistics", operatedBy: ["delivery_logistics"] },
  { id: "inventory", label: "Inventory", domain: "delivery", owner: "delivery_logistics", operatedBy: ["delivery_logistics", "marketplace"] },
  { id: "corporate_client", label: "Corporate Clients", domain: "corporate", owner: "corporate_operations", operatedBy: ["corporate", "finance_refunds", "customer_operations"] },
  { id: "marketplace_partner", label: "Marketplace Partners", domain: "marketplace", owner: "marketplace", operatedBy: ["marketplace", "finance_refunds", "delivery_logistics"] },
  { id: "fleet_asset", label: "Fleet", domain: "fleet", owner: "fleet", operatedBy: ["fleet", "finance_refunds"] },
  { id: "finance_ledger", label: "Finance", domain: "finance", owner: "finance_refunds", operatedBy: ["finance_refunds", "corporate", "marketplace"] },
  { id: "support_case", label: "Support", domain: "customer_operations", owner: "customer_operations", operatedBy: ["customer_operations", "trust_safety", "delivery_logistics"] },
  { id: "customer_operations_desk", label: "Customer Operations", domain: "customer_operations", owner: "customer_operations", operatedBy: ["customer_operations"] },
  { id: "trust_case", label: "Trust & Safety", domain: "trust_safety", owner: "trust_safety", operatedBy: ["trust_safety", "customer_operations"] },
  { id: "executive_intelligence", label: "Executive Intelligence", domain: "analytics", owner: "executive_office", operatedBy: ["finance_refunds", "customer_operations", "delivery_logistics", "trust_safety", "marketplace", "fleet"] },
];

// ── Graph construction ─────────────────────────────────────────────────────

const nodeId = (kind: KnowledgeNodeKind, key: string) => `${kind}:${key}`;

function capabilityDomain(module: string): string {
  const obj = BUSINESS_OBJECTS.find((o) => o.operatedBy[0] === module);
  return obj?.domain ?? module;
}

/** Build the full enterprise knowledge graph from the governed catalogs. */
export function buildKnowledgeGraph(): KnowledgeGraph {
  const nodes = new Map<string, KnowledgeNode>();
  const edges: KnowledgeEdge[] = [];

  const addNode = (n: KnowledgeNode) => {
    if (!nodes.has(n.id)) nodes.set(n.id, n);
  };
  const addEdge = (from: string, to: string, kind: KnowledgeEdgeKind, reason: string) => {
    edges.push({ from, to, kind, reason });
  };

  // Business objects
  for (const o of BUSINESS_OBJECTS) {
    addNode({
      id: nodeId("business_object", o.id),
      kind: "business_object",
      label: o.label,
      domain: o.domain,
      owner: o.owner,
      attributes: { operatedByCount: o.operatedBy.length },
    });
  }

  // Events
  for (const e of ENTERPRISE_EVENT_CATALOG) {
    addNode({
      id: nodeId("event", e.name),
      kind: "event",
      label: e.name,
      domain: e.domain,
      owner: e.owner,
      attributes: { criticality: e.criticality, latencyBudgetMinutes: e.latencyBudgetMinutes, version: e.version },
    });
  }

  // Capabilities, their workflows, AI services, dependencies and event wiring
  for (const c of CAPABILITY_CONTRACTS) {
    const capId = nodeId("capability", c.module);
    addNode({
      id: capId,
      kind: "capability",
      label: c.title,
      domain: capabilityDomain(c.module),
      owner: c.owner,
      attributes: { version: c.version, route: c.route, workflows: c.workflows.length },
    });

    for (const w of c.workflows) {
      const wid = nodeId("workflow", `${c.module}.${w.id}`);
      addNode({
        id: wid,
        kind: "workflow",
        label: w.name,
        domain: capabilityDomain(c.module),
        owner: c.owner,
        attributes: { targetMinutes: w.targetMinutes, stages: w.stages.length, approvals: w.approvals.length },
      });
      addEdge(capId, wid, "executes", `${c.title} executes workflow ${w.name}`);
    }

    for (const a of c.aiRoadmap) {
      const aid = nodeId("ai_service", `${c.module}.${a.service}`);
      addNode({
        id: aid,
        kind: "ai_service",
        label: `${a.service} (${c.module})`,
        domain: capabilityDomain(c.module),
        owner: c.owner,
        attributes: { status: a.status, evaluation: a.evaluation },
      });
      addEdge(capId, aid, "owns", `${c.title} owns AI service ${a.service}`);
    }

    for (const e of c.publishes) addEdge(capId, nodeId("event", e.name), "publishes", `${c.title} is the writer of ${e.name}`);
    for (const e of c.consumes) addEdge(nodeId("event", e.name), capId, "consumes", `${c.title} consumes ${e.name}`);
    for (const d of c.dependencies) addEdge(capId, nodeId("capability", d.module), "depends_on", d.reason);

    for (const o of BUSINESS_OBJECTS) {
      if (o.operatedBy.includes(c.module)) {
        addEdge(capId, nodeId("business_object", o.id), "operates_on", `${c.title} operates on ${o.label}`);
      }
    }
  }

  // Processes and stages
  for (const p of BUSINESS_PROCESS_CATALOG) {
    const pid = nodeId("process", p.id);
    addNode({
      id: pid,
      kind: "process",
      label: p.name,
      domain: p.valueStream,
      owner: p.owner,
      attributes: { valueStream: p.valueStream, stages: p.stages.length, endToEndSlaMinutes: p.endToEndSlaMinutes, version: p.version },
    });

    for (const s of p.stages) {
      const sid = nodeId("process_stage", `${p.id}.${s.id}`);
      addNode({
        id: sid,
        kind: "process_stage",
        label: `${p.name} · ${s.name}`,
        domain: p.valueStream,
        owner: s.capability,
        attributes: { slaMinutes: s.slaMinutes, controls: s.controls.length },
      });
      addEdge(pid, sid, "contains", `${p.name} contains stage ${s.name}`);
      addEdge(nodeId("capability", s.capability), sid, "owns", `${s.capability} is accountable for stage ${s.name}`);
      for (const ev of s.events) addEdge(sid, nodeId("event", ev), "evidenced_by", `Stage ${s.name} is evidenced by ${ev}`);
    }
  }

  // Policies
  for (const pol of POLICY_REGISTRY) {
    const polId = nodeId("policy", pol.id);
    addNode({
      id: polId,
      kind: "policy",
      label: pol.name,
      domain: pol.domain,
      owner: pol.owner,
      attributes: {
        statements: pol.statements.length,
        rules: pol.enforcedByRules.length,
        reviewCadenceMonths: pol.reviewCadenceMonths,
        lastReviewed: pol.lastReviewed,
      },
    });
    for (const proc of pol.appliesToProcesses) addEdge(polId, nodeId("process", proc), "governs", `${pol.name} governs ${proc}`);
  }

  // Metrics
  for (const m of METRIC_CONTRACTS) {
    const mid = nodeId("metric", m.id);
    addNode({
      id: mid,
      kind: "metric",
      label: m.label,
      domain: m.domain,
      owner: m.owner,
      attributes: { grain: m.grain, unit: m.unit, version: m.version },
    });
    for (const procId of m.processes) {
      addEdge(mid, nodeId("process", procId), "measures", `${m.label} measures ${procId}`);
    }
    for (const ev of m.sourceEvents) {
      addEdge(mid, nodeId("event", ev), "evidenced_by", `${m.label} is derived from ${ev}`);
    }
  }

  // Prune edges pointing at nodes that do not exist (e.g. dependency on a module
  // without a published contract) — reported separately as a knowledge gap.
  const known = new Set(nodes.keys());
  const resolved = edges.filter((e) => known.has(e.from) && known.has(e.to));

  return { nodes: [...nodes.values()], edges: resolved };
}

let CACHED: KnowledgeGraph | null = null;
/** Memoised graph — the inputs are static configuration. */
export function knowledgeGraph(): KnowledgeGraph {
  if (!CACHED) CACHED = buildKnowledgeGraph();
  return CACHED;
}

// ── Explorers ──────────────────────────────────────────────────────────────

export interface Relationship {
  edge: KnowledgeEdge;
  direction: "outbound" | "inbound";
  node: KnowledgeNode;
}

export function knowledgeNode(id: string, graph: KnowledgeGraph = knowledgeGraph()): KnowledgeNode | undefined {
  return graph.nodes.find((n) => n.id === id);
}

/** Relationship Explorer — direct neighbours of a node, both directions. */
export function relationshipsOf(id: string, graph: KnowledgeGraph = knowledgeGraph()): Relationship[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const out: Relationship[] = [];
  for (const e of graph.edges) {
    if (e.from === id) {
      const node = byId.get(e.to);
      if (node) out.push({ edge: e, direction: "outbound", node });
    } else if (e.to === id) {
      const node = byId.get(e.from);
      if (node) out.push({ edge: e, direction: "inbound", node });
    }
  }
  return out.sort((a, b) => a.node.id.localeCompare(b.node.id));
}

export interface TraversalHop {
  id: string;
  depth: number;
  /** Shortest path from the origin, inclusive of origin and this node. */
  path: string[];
}

function traverse(
  origin: string,
  graph: KnowledgeGraph,
  next: (id: string) => string[],
  maxDepth: number,
): TraversalHop[] {
  const seen = new Set([origin]);
  const hops: TraversalHop[] = [];
  let frontier: TraversalHop[] = [{ id: origin, depth: 0, path: [origin] }];

  while (frontier.length > 0) {
    const nextFrontier: TraversalHop[] = [];
    for (const hop of frontier) {
      if (hop.depth >= maxDepth) continue;
      for (const target of next(hop.id)) {
        if (seen.has(target)) continue;
        seen.add(target);
        const h = { id: target, depth: hop.depth + 1, path: [...hop.path, target] };
        hops.push(h);
        nextFrontier.push(h);
      }
    }
    frontier = nextFrontier;
  }
  return hops.sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id));
}

/** Dependency Explorer — everything the node relies on, transitively. */
export function dependenciesOf(id: string, graph: KnowledgeGraph = knowledgeGraph(), maxDepth = 6): TraversalHop[] {
  const forward = (n: string) =>
    graph.edges.filter((e) => e.from === n && (e.kind === "depends_on" || e.kind === "consumes" || e.kind === "evidenced_by")).map((e) => e.to);
  return traverse(id, graph, forward, maxDepth);
}

export interface ImpactAssessment {
  origin: string;
  impacted: TraversalHop[];
  impactedCapabilities: string[];
  impactedProcesses: string[];
  impactedBusinessObjects: string[];
  criticalEvents: string[];
  /** 0-100 blast radius as a share of the reachable enterprise graph. */
  blastRadius: number;
}

/**
 * Impact Analysis — if this node fails or changes, what else is affected?
 * Traverses downstream: publishers → events → consumers → stages → processes.
 */
export function impactOf(id: string, graph: KnowledgeGraph = knowledgeGraph(), maxDepth = 6): ImpactAssessment {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const downstream = (n: string) => {
    const outbound = graph.edges.filter((e) => e.from === n && e.kind !== "depends_on").map((e) => e.to);
    const inbound = graph.edges
      .filter((e) => e.to === n && (e.kind === "depends_on" || e.kind === "evidenced_by" || e.kind === "publishes"))
      .map((e) => e.from);
    return [...outbound, ...inbound];
  };

  const impacted = traverse(id, graph, downstream, maxDepth);
  const kinds = (kind: KnowledgeNodeKind) =>
    impacted.map((h) => byId.get(h.id)).filter((n): n is KnowledgeNode => n?.kind === kind).map((n) => n.label);

  return {
    origin: id,
    impacted,
    impactedCapabilities: kinds("capability"),
    impactedProcesses: kinds("process"),
    impactedBusinessObjects: kinds("business_object"),
    criticalEvents: impacted
      .map((h) => byId.get(h.id))
      .filter((n): n is KnowledgeNode => n?.kind === "event" && n.attributes.criticality === "critical")
      .map((n) => n.label),
    blastRadius: clamp((impacted.length / Math.max(1, graph.nodes.length - 1)) * 100),
  };
}

export interface RootCauseCandidate {
  id: string;
  label: string;
  kind: KnowledgeNodeKind;
  owner: string;
  distance: number;
  path: string[];
  /** 0-100 — nearer, critical and single-writer nodes rank higher. */
  likelihood: number;
}

/**
 * Root Cause Navigation — from an observed symptom node, walk upstream through
 * the dependency direction and rank plausible originating nodes.
 */
export function rootCauseCandidates(
  symptomId: string,
  graph: KnowledgeGraph = knowledgeGraph(),
  maxDepth = 5,
): RootCauseCandidate[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const upstream = (n: string) => {
    const viaDeps = graph.edges.filter((e) => e.from === n && (e.kind === "depends_on" || e.kind === "consumes" || e.kind === "evidenced_by")).map((e) => e.to);
    const viaWriters = graph.edges.filter((e) => e.to === n && e.kind === "publishes").map((e) => e.from);
    const viaOwners = graph.edges.filter((e) => e.to === n && e.kind === "owns").map((e) => e.from);
    return [...viaDeps, ...viaWriters, ...viaOwners];
  };

  return traverse(symptomId, graph, upstream, maxDepth)
    .map((hop) => {
      const node = byId.get(hop.id);
      if (!node) return null;
      const proximity = 100 - (hop.depth - 1) * 22;
      const criticalBoost = node.attributes.criticality === "critical" ? 12 : 0;
      const kindBoost = node.kind === "capability" ? 8 : node.kind === "event" ? 6 : 0;
      return {
        id: node.id,
        label: node.label,
        kind: node.kind,
        owner: node.owner,
        distance: hop.depth,
        path: hop.path,
        likelihood: clamp(proximity + criticalBoost + kindBoost),
      } satisfies RootCauseCandidate;
    })
    .filter((c): c is RootCauseCandidate => c !== null)
    .sort((a, b) => b.likelihood - a.likelihood || a.id.localeCompare(b.id));
}

// ── Lineage services ───────────────────────────────────────────────────────

export interface CapabilityLineage {
  capability: string;
  owner: string;
  workflows: string[];
  publishes: string[];
  consumes: string[];
  dependsOn: string[];
  dependedOnBy: string[];
  processStages: string[];
  businessObjects: string[];
  aiServices: string[];
}

export function capabilityLineage(module: string, graph: KnowledgeGraph = knowledgeGraph()): CapabilityLineage | undefined {
  const id = nodeId("capability", module);
  const node = knowledgeNode(id, graph);
  if (!node) return undefined;
  const rel = relationshipsOf(id, graph);
  const pick = (kind: KnowledgeEdgeKind, direction: Relationship["direction"], nodeKind?: KnowledgeNodeKind) =>
    rel.filter((r) => r.edge.kind === kind && r.direction === direction && (!nodeKind || r.node.kind === nodeKind)).map((r) => r.node.label);

  return {
    capability: node.label,
    owner: node.owner,
    workflows: pick("executes", "outbound"),
    publishes: pick("publishes", "outbound"),
    consumes: pick("consumes", "inbound"),
    dependsOn: pick("depends_on", "outbound"),
    dependedOnBy: pick("depends_on", "inbound"),
    processStages: pick("owns", "outbound", "process_stage"),
    businessObjects: pick("operates_on", "outbound"),
    aiServices: pick("owns", "outbound", "ai_service"),
  };
}

export interface EventLineage {
  event: string;
  owner: string;
  criticality: string;
  publishers: string[];
  consumers: string[];
  processStages: string[];
  processes: string[];
  policies: string[];
}

export function eventLineage(name: string, graph: KnowledgeGraph = knowledgeGraph()): EventLineage | undefined {
  const id = nodeId("event", name);
  const node = knowledgeNode(id, graph);
  if (!node) return undefined;
  const rel = relationshipsOf(id, graph);
  const stages = rel.filter((r) => r.edge.kind === "evidenced_by" && r.node.kind === "process_stage");
  const processes = new Set<string>();
  const policies = new Set<string>();

  for (const s of stages) {
    for (const pr of relationshipsOf(s.node.id, graph)) {
      if (pr.edge.kind === "contains" && pr.node.kind === "process") {
        processes.add(pr.node.label);
        for (const gov of relationshipsOf(pr.node.id, graph)) {
          if (gov.edge.kind === "governs" && gov.node.kind === "policy") policies.add(gov.node.label);
        }
      }
    }
  }

  return {
    event: node.label,
    owner: node.owner,
    criticality: String(node.attributes.criticality ?? "standard"),
    publishers: rel.filter((r) => r.edge.kind === "publishes").map((r) => r.node.label),
    consumers: rel.filter((r) => r.edge.kind === "consumes").map((r) => r.node.label),
    processStages: stages.map((s) => s.node.label),
    processes: [...processes].sort(),
    policies: [...policies].sort(),
  };
}

export interface ProcessLineage {
  process: string;
  owner: string;
  valueStream: string;
  stages: { stage: string; capability: string; events: string[] }[];
  capabilities: string[];
  events: string[];
  policies: string[];
  metrics: string[];
}

export function processLineage(processId: string, graph: KnowledgeGraph = knowledgeGraph()): ProcessLineage | undefined {
  const id = nodeId("process", processId);
  const node = knowledgeNode(id, graph);
  if (!node) return undefined;
  const rel = relationshipsOf(id, graph);
  const stageNodes = rel.filter((r) => r.edge.kind === "contains" && r.node.kind === "process_stage");

  const capabilities = new Set<string>();
  const events = new Set<string>();
  const stages = stageNodes.map((s) => {
    const sr = relationshipsOf(s.node.id, graph);
    const cap = sr.find((r) => r.edge.kind === "owns" && r.node.kind === "capability");
    if (cap) capabilities.add(cap.node.label);
    const evs = sr.filter((r) => r.edge.kind === "evidenced_by" && r.node.kind === "event").map((r) => r.node.label);
    evs.forEach((e) => events.add(e));
    return { stage: s.node.label, capability: cap?.node.label ?? s.node.owner, events: evs };
  });

  return {
    process: node.label,
    owner: node.owner,
    valueStream: String(node.attributes.valueStream ?? node.domain),
    stages,
    capabilities: [...capabilities].sort(),
    events: [...events].sort(),
    policies: rel.filter((r) => r.edge.kind === "governs" && r.node.kind === "policy").map((r) => r.node.label).sort(),
    metrics: rel.filter((r) => r.edge.kind === "measures" && r.node.kind === "metric").map((r) => r.node.label).sort(),
  };
}

// ── Certification ──────────────────────────────────────────────────────────

export interface KnowledgeCertification {
  passed: boolean;
  score: number;
  nodes: number;
  edges: number;
  /** Nodes with no relationship at all — untraceable enterprise objects. */
  orphanNodes: string[];
  /** Capability dependencies pointing at modules with no published contract. */
  danglingDependencies: { capability: string; missingModule: string }[];
  /** Processes whose stages are not evidenced by any canonical event. */
  unevidencedStages: string[];
  traceabilityCoverage: number;
  findings: PlatformFinding[];
}

/**
 * Certify that every enterprise object is traceable. Traceability coverage is
 * the share of nodes participating in at least one relationship.
 */
export function certifyKnowledgePlatform(graph: KnowledgeGraph = knowledgeGraph()): KnowledgeCertification {
  const connected = new Set(graph.edges.flatMap((e) => [e.from, e.to]));
  const orphanNodes = graph.nodes.filter((n) => !connected.has(n.id)).map((n) => n.id);

  const contractModules = new Set(CAPABILITY_CONTRACTS.map((c) => c.module as string));
  const danglingDependencies = CAPABILITY_CONTRACTS.flatMap((c) =>
    c.dependencies
      .filter((d) => !contractModules.has(d.module))
      .map((d) => ({ capability: c.module as string, missingModule: d.module })),
  );

  const unevidencedStages = BUSINESS_PROCESS_CATALOG.flatMap((p) =>
    p.stages.filter((s) => s.events.length === 0).map((s) => `${p.id}.${s.id}`),
  );

  const traceabilityCoverage = graph.nodes.length === 0 ? 0 : clamp((connected.size / graph.nodes.length) * 100);

  const findings: PlatformFinding[] = [];
  for (const id of orphanNodes) {
    findings.push(makeFinding("knowledge", "p2", id, "Enterprise object has no relationships and is not traceable.", "Wire the object to a capability, process or event, or retire it."));
  }
  for (const d of danglingDependencies) {
    findings.push(
      makeFinding(
        "knowledge",
        "p1",
        `${d.capability}→${d.missingModule}`,
        `Capability '${d.capability}' depends on '${d.missingModule}', which publishes no capability contract.`,
        "Publish a capability contract for the dependency or remove the declared dependency.",
      ),
    );
  }
  for (const s of unevidencedStages) {
    findings.push(makeFinding("knowledge", "p1", s, "Process stage is not evidenced by any canonical event.", "Bind the stage to a canonical event so lineage and SLA measurement resolve."));
  }

  const p1 = findings.filter((f) => f.severity === "p1").length;
  const score = clamp(traceabilityCoverage - p1 * 5 - Math.min(15, orphanNodes.length));

  return {
    passed: p1 === 0 && traceabilityCoverage >= 95,
    score,
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    orphanNodes,
    danglingDependencies,
    unevidencedStages,
    traceabilityCoverage,
    findings: sortFindings(findings),
  };
}
