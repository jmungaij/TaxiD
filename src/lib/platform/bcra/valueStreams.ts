/**
 * BCRA Phase 2 — Business Value Stream Certification.
 *
 * Value streams are DERIVED from the existing Business Process Catalog.
 * Participating capabilities, events, policies, controls, SLAs, risks and
 * owners are resolved from the registries — none are hardcoded here.
 */
import { BUSINESS_PROCESS_CATALOG, certifyProcess, type BusinessProcess, type ProcessId } from "../processCatalog";
import { POLICY_REGISTRY } from "../policyRegistry";
import { eventRegistry, type RegisteredEvent } from "../eventRegistry";
import { CAPABILITY_CONTRACTS } from "@/lib/contracts";
import { bcraCapabilityRegister, bcraEvidence, type BcraCapabilityRegister, type BcraEvidenceBundle } from "./capabilityRelease";

export const VALUE_STREAM_VERSION = "1.0.0";

export interface ValueStreamRisk {
  source: "capability" | "process" | "event";
  ref: string;
  severity: "p0" | "p1" | "p2";
  message: string;
}

export interface ValueStreamCertification {
  id: ProcessId;
  name: string;
  classification: BusinessProcess["valueStream"];
  owner: string;
  capabilities: string[];
  events: string[];
  policies: string[];
  controls: string[];
  slaMinutes: number;
  stageSlaMinutes: number;
  slaHonoured: boolean;
  risks: ValueStreamRisk[];
  /** Weakest participating capability — a stream is only as strong as its links. */
  weakestCapability: { module: string; score: number } | null;
  processScore: number;
  capabilityScore: number;
  eventGovernanceScore: number;
  policyCoverageScore: number;
  score: number;
  passed: boolean;
  blockers: string[];
}

function clamp(n: number): number { return Math.max(0, Math.min(100, Math.round(n))); }

const CONTRACT_MODULES = new Set(CAPABILITY_CONTRACTS.map((c) => c.module as string));

export function certifyValueStream(
  process: BusinessProcess,
  register: BcraCapabilityRegister,
  events: RegisteredEvent[] = eventRegistry(),
): ValueStreamCertification {
  const processCert = certifyProcess(process);
  const capabilities = Array.from(new Set(process.stages.map((s) => s.capability)));
  const streamEvents = Array.from(new Set(process.stages.flatMap((s) => s.events)));
  const policies = POLICY_REGISTRY.filter((p) => p.appliesToProcesses.includes(process.id));
  const controls = Array.from(new Set([...process.controls, ...process.stages.flatMap((s) => s.controls)]));

  const participating = register.capabilities.filter((c) => capabilities.includes(c.module));
  const capabilityScore = participating.length === 0 ? 0 : clamp(Math.min(...participating.map((c) => c.score)));
  const weakest = participating.length === 0
    ? null
    : participating.reduce((m, c) => (c.score < m.score ? c : m));

  const registered = streamEvents.map((n) => events.find((e) => e.name === n)).filter(Boolean) as RegisteredEvent[];
  const eventGovernanceScore = streamEvents.length === 0
    ? 0
    : clamp((registered.filter((e) => e.observability.length > 0 && e.publishers.length > 0).length / streamEvents.length) * 100);
  const policyCoverageScore = policies.length === 0 ? 40 : clamp(60 + policies.length * 20);

  const stageSla = process.stages.reduce((n, s) => n + s.slaMinutes, 0);
  const slaHonoured = stageSla <= process.endToEndSlaMinutes;

  const risks: ValueStreamRisk[] = [
    ...processCert.issues.map((i) => ({ source: "process" as const, ref: i.stage ?? process.id, severity: i.severity, message: i.message })),
    ...participating.flatMap((c) => c.blockers.map((b) => ({ source: "capability" as const, ref: c.module, severity: (c.decision === "blocked" ? "p0" : "p1") as "p0" | "p1", message: b }))),
    ...capabilities.filter((m) => !CONTRACT_MODULES.has(m)).map((m) => ({ source: "capability" as const, ref: m, severity: "p1" as const, message: `stage capability '${m}' has no capability contract` })),
    ...streamEvents.filter((n) => !events.some((e) => e.name === n)).map((n) => ({ source: "event" as const, ref: n, severity: "p0" as const, message: `event '${n}' is not in the canonical event registry` })),
  ];
  if (!slaHonoured) risks.push({ source: "process", ref: process.id, severity: "p1", message: `stage SLA budget ${stageSla}m exceeds end-to-end SLA ${process.endToEndSlaMinutes}m` });

  const score = clamp(
    processCert.score * 0.3 + capabilityScore * 0.35 + eventGovernanceScore * 0.2 + policyCoverageScore * 0.15,
  );
  const blockers = risks.filter((r) => r.severity === "p0").map((r) => `${r.ref}: ${r.message}`);

  return {
    id: process.id,
    name: process.name,
    classification: process.valueStream,
    owner: process.owner,
    capabilities,
    events: streamEvents,
    policies: policies.map((p) => p.id),
    controls,
    slaMinutes: process.endToEndSlaMinutes,
    stageSlaMinutes: stageSla,
    slaHonoured,
    risks,
    weakestCapability: weakest ? { module: weakest.module, score: weakest.score } : null,
    processScore: processCert.score,
    capabilityScore,
    eventGovernanceScore,
    policyCoverageScore,
    score,
    passed: blockers.length === 0 && score >= 80 && capabilityScore >= 70,
    blockers,
  };
}

export interface ValueStreamRegister {
  version: string;
  streams: ValueStreamCertification[];
  score: number;
  passed: boolean;
  certified: number;
  blocked: number;
  blockers: string[];
}

export function bcraValueStreamRegister(
  evidence: BcraEvidenceBundle = bcraEvidence(),
  register: BcraCapabilityRegister = bcraCapabilityRegister(undefined, evidence),
): ValueStreamRegister {
  const streams = BUSINESS_PROCESS_CATALOG.map((p) => certifyValueStream(p, register, evidence.events));
  return {
    version: VALUE_STREAM_VERSION,
    streams,
    score: streams.length === 0 ? 0 : clamp(streams.reduce((s, v) => s + v.score, 0) / streams.length),
    passed: streams.every((s) => s.passed),
    certified: streams.filter((s) => s.passed).length,
    blocked: streams.filter((s) => !s.passed).length,
    blockers: streams.flatMap((s) => s.blockers.map((b) => `${s.id} · ${b}`)),
  };
}
