/**
 * BCRA Phase 3 — Cross-Capability Dependency Intelligence.
 *
 * Capabilities are never certified in isolation. The dependency graph is
 * derived from capability-contract dependencies, published/consumed event
 * wiring and the value-stream stage ordering. A chain fails when any link
 * fails: weakest-link analysis, propagation impact and dependency scores.
 */
import { CAPABILITY_CONTRACTS } from "@/lib/contracts";
import { BUSINESS_PROCESS_CATALOG } from "../processCatalog";
import { bcraCapabilityRegister, bcraEvidence, type BcraCapabilityRegister, type BcraEvidenceBundle } from "./capabilityRelease";

export const DEPENDENCY_VERSION = "1.0.0";

export interface DependencyEdge {
  from: string;
  to: string;
  kind: "contract" | "event" | "value_stream";
  reason: string;
  degradedBehaviour: string;
}

/** Derive every dependency edge from existing registries. */
export function dependencyEdges(): DependencyEdge[] {
  const edges: DependencyEdge[] = [];

  for (const c of CAPABILITY_CONTRACTS) {
    for (const d of c.dependencies) {
      edges.push({ from: c.module, to: String(d.module), kind: "contract", reason: d.reason, degradedBehaviour: d.degradedBehaviour });
    }
    for (const e of c.consumes) {
      for (const p of CAPABILITY_CONTRACTS) {
        if (p.module !== c.module && p.publishes.some((x) => x.name === e.name)) {
          edges.push({ from: c.module, to: p.module, kind: "event", reason: `consumes ${e.name}`, degradedBehaviour: `${e.criticality === "critical" ? "hard" : "soft"} degradation beyond ${e.latencyBudgetMinutes}m` });
        }
      }
    }
  }

  for (const p of BUSINESS_PROCESS_CATALOG) {
    for (let i = 1; i < p.stages.length; i++) {
      const from = p.stages[i].capability;
      const to = p.stages[i - 1].capability;
      if (from !== to) edges.push({ from, to, kind: "value_stream", reason: `${p.name}: ${p.stages[i].name} follows ${p.stages[i - 1].name}`, degradedBehaviour: `${p.name} stalls at ${p.stages[i - 1].name}` });
    }
  }

  const seen = new Set<string>();
  return edges.filter((e) => {
    const key = `${e.from}->${e.to}:${e.kind}:${e.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface DependencyNodeReport {
  module: string;
  /** Modules this capability depends on. */
  dependsOn: string[];
  /** Modules that fail when this capability fails. */
  dependents: string[];
  ownScore: number;
  /** Score after chain propagation — min of the whole upstream chain. */
  chainScore: number;
  weakestLink: string | null;
  /** Number of capabilities impacted if this one fails. */
  propagationImpact: number;
  operationalDependencyScore: number;
  financialDependencyScore: number;
  certified: boolean;
  findings: string[];
}

export interface DependencyMatrixReport {
  version: string;
  edges: DependencyEdge[];
  nodes: DependencyNodeReport[];
  cycles: string[][];
  score: number;
  passed: boolean;
  weakestChain: { module: string; chainScore: number; weakestLink: string | null } | null;
  blockers: string[];
}

function clamp(n: number): number { return Math.max(0, Math.min(100, Math.round(n))); }

function reachable(start: string, adjacency: Map<string, string[]>): Set<string> {
  const out = new Set<string>();
  const stack = [start];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const nxt of adjacency.get(cur) ?? []) {
      if (nxt === start || out.has(nxt)) continue;
      out.add(nxt);
      stack.push(nxt);
    }
  }
  return out;
}

function findCycles(modules: string[], adjacency: Map<string, string[]>): string[][] {
  const cycles: string[][] = [];
  const seen = new Set<string>();
  for (const m of modules) {
    for (const n of reachable(m, adjacency)) {
      if (reachable(n, adjacency).has(m)) {
        const key = [m, n].sort().join("|");
        if (!seen.has(key)) { seen.add(key); cycles.push([m, n]); }
      }
    }
  }
  return cycles;
}

export function bcraDependencyMatrix(
  evidence: BcraEvidenceBundle = bcraEvidence(),
  register: BcraCapabilityRegister = bcraCapabilityRegister(undefined, evidence),
): DependencyMatrixReport {
  const edges = dependencyEdges();
  const modules = Array.from(new Set([...register.capabilities.map((c) => c.module), ...edges.flatMap((e) => [e.from, e.to])]));
  const dependsOn = new Map<string, string[]>();
  const dependents = new Map<string, string[]>();
  for (const m of modules) { dependsOn.set(m, []); dependents.set(m, []); }
  for (const e of edges) {
    if (!dependsOn.get(e.from)!.includes(e.to)) dependsOn.get(e.from)!.push(e.to);
    if (!dependents.get(e.to)!.includes(e.from)) dependents.get(e.to)!.push(e.from);
  }

  const scoreOf = (m: string) => register.capabilities.find((c) => c.module === m)?.score ?? 0;
  const known = new Set(register.capabilities.map((c) => c.module));

  const nodes: DependencyNodeReport[] = modules.map((module) => {
    const upstream = Array.from(reachable(module, dependsOn));
    const downstream = Array.from(reachable(module, dependents));
    const own = known.has(module) ? scoreOf(module) : 0;
    const chainMembers = [module, ...upstream].filter((m) => known.has(m));
    const chainScore = chainMembers.length === 0 ? 0 : Math.min(...chainMembers.map(scoreOf));
    const weakestLink = chainMembers.length === 0
      ? null
      : chainMembers.reduce((a, b) => (scoreOf(b) < scoreOf(a) ? b : a));
    const cap = register.capabilities.find((c) => c.module === module);
    const opDim = cap?.dimensions.find((d) => d.dimension === "operational")?.score ?? 0;
    const finDim = cap?.dimensions.find((d) => d.dimension === "financial")?.score ?? 0;
    const upstreamOp = upstream.filter((m) => known.has(m))
      .map((m) => register.capabilities.find((c) => c.module === m)!.dimensions.find((d) => d.dimension === "operational")!.score);
    const upstreamFin = upstream.filter((m) => known.has(m))
      .map((m) => register.capabilities.find((c) => c.module === m)!.dimensions.find((d) => d.dimension === "financial")!.score);

    const findings: string[] = [];
    if (!known.has(module)) findings.push(`'${module}' participates in dependencies but publishes no capability contract`);
    for (const up of upstream) if (!known.has(up)) findings.push(`upstream '${up}' is uncertified — chain cannot be certified`);
    if (chainScore < own) findings.push(`chain limited by '${weakestLink}' at ${chainScore}/100`);

    return {
      module,
      dependsOn: dependsOn.get(module)!.sort(),
      dependents: dependents.get(module)!.sort(),
      ownScore: own,
      chainScore,
      weakestLink,
      propagationImpact: downstream.length,
      operationalDependencyScore: clamp(Math.min(opDim, ...(upstreamOp.length ? upstreamOp : [opDim]))),
      financialDependencyScore: clamp(Math.min(finDim, ...(upstreamFin.length ? upstreamFin : [finDim]))),
      certified: known.has(module) && chainScore >= 80 && upstream.every((m) => known.has(m)),
      findings,
    };
  }).sort((a, b) => a.module.localeCompare(b.module));

  const cycles = findCycles(modules, dependsOn);
  const weakest = nodes.length === 0 ? null : nodes.reduce((m, n) => (n.chainScore < m.chainScore ? n : m));
  const score = nodes.length === 0 ? 0 : clamp(nodes.reduce((s, n) => s + n.chainScore, 0) / nodes.length);
  const blockers = nodes.filter((n) => !n.certified).flatMap((n) => n.findings.map((f) => `${n.module} · ${f}`));

  return {
    version: DEPENDENCY_VERSION,
    edges,
    nodes,
    cycles,
    score,
    passed: blockers.length === 0,
    weakestChain: weakest ? { module: weakest.module, chainScore: weakest.chainScore, weakestLink: weakest.weakestLink } : null,
    blockers,
  };
}
