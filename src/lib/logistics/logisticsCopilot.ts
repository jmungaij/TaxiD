/**
 * Phase 5 — AI Logistics Orchestrator.
 *
 * Evolves the copilot shell into a governed orchestration agent. Every
 * response is deterministic, grounded in the digital twin + prediction
 * engine + capability intelligence, and carries a trace: the sources it
 * read, the policy it was evaluated against and whether human approval is
 * required before the action executes.
 *
 * No model calls here — the orchestrator resolves commands against platform
 * state. Free-text answers degrade gracefully to a grounded summary.
 */
import { buildTwin, simulateTwin, type TwinObservation } from "./digitalTwin";
import { detectAnomalies, forecastCapacity, predictEta, type AnomalyInput } from "./predictionEngine";
import { runCapabilityIntelligence, investmentPriorities } from "./capabilityIntelligence";

export const ORCHESTRATOR_VERSION = "1.0.0";

export type CopilotCommandId =
  | "network_status"
  | "optimize_routes"
  | "dispatch_recommendation"
  | "capacity_forecast"
  | "anomaly_scan"
  | "eta_explain"
  | "capability_maturity"
  | "simulate_surge";

export interface CopilotCommandSpec {
  id: CopilotCommandId;
  label: string;
  description: string;
  /** Keywords that route free text to this command. */
  keywords: string[];
  /** Autonomy tier — mutating actions require approval. */
  autonomy: "read_only" | "recommend" | "act_with_approval";
  /** Capability ids the command is grounded in. */
  grounding: string[];
}

export const COPILOT_COMMANDS: CopilotCommandSpec[] = [
  {
    id: "network_status", label: "Network status", description: "Current twin health, bottlenecks and environment.",
    keywords: ["status", "health", "network", "overview", "how are we"], autonomy: "read_only",
    grounding: ["national_hub_network", "parcel_tracking", "courier_network"],
  },
  {
    id: "optimize_routes", label: "Optimize routes", description: "Re-sequencing recommendation under current traffic and capacity.",
    keywords: ["route", "routes", "optimize", "optimise", "resequence", "reroute"], autonomy: "act_with_approval",
    grounding: ["route_optimization", "dynamic_routing"],
  },
  {
    id: "dispatch_recommendation", label: "Dispatch recommendation", description: "Courier allocation and rebalancing advice.",
    keywords: ["dispatch", "assign", "courier", "allocate", "rebalance"], autonomy: "act_with_approval",
    grounding: ["fleet_dispatch", "driver_logistics", "courier_network"],
  },
  {
    id: "capacity_forecast", label: "Capacity forecast", description: "Projected demand vs capacity per dispatch window.",
    keywords: ["capacity", "forecast", "demand", "backlog", "volume"], autonomy: "recommend",
    grounding: ["warehouse_intelligence", "vehicle_capacity"],
  },
  {
    id: "anomaly_scan", label: "Anomaly scan", description: "Predicted failures across the network.",
    keywords: ["anomaly", "risk", "exception", "failure", "issues", "problems"], autonomy: "read_only",
    grounding: ["parcel_tracking", "cold_chain", "reverse_logistics"],
  },
  {
    id: "eta_explain", label: "Explain an ETA", description: "Feature-level explanation of a predicted arrival.",
    keywords: ["eta", "arrival", "late", "when will", "delivery time"], autonomy: "read_only",
    grounding: ["eta_prediction"],
  },
  {
    id: "capability_maturity", label: "Capability maturity", description: "Where logistics maturity is being lost and what to fund.",
    keywords: ["maturity", "capability", "score", "invest", "readiness", "gap"], autonomy: "read_only",
    grounding: ["executive_logistics_intelligence"],
  },
  {
    id: "simulate_surge", label: "Simulate a surge", description: "What-if demand surge against the digital twin.",
    keywords: ["simulate", "what if", "surge", "scenario", "peak"], autonomy: "recommend",
    grounding: ["national_hub_network", "fleet_dispatch"],
  },
];

export interface CopilotTrace {
  /** Grounding sources actually read to produce the answer. */
  sources: string[];
  /** Capability ids the answer is attributable to. */
  capabilities: string[];
  /** Governance decision applied to the response. */
  policy: string;
  /** 0-1 confidence in the grounded answer. */
  confidence: number;
  /** Deterministic id so the same state + command replays identically. */
  traceId: string;
}

export interface CopilotAction {
  id: string;
  label: string;
  detail: string;
  /** Estimated operational impact in plain language. */
  impact: string;
  requiresApproval: boolean;
  approver: string | null;
}

export interface CopilotResponse {
  command: CopilotCommandId | "unknown";
  title: string;
  /** Grounded, executive-readable answer lines. */
  answer: string[];
  actions: CopilotAction[];
  trace: CopilotTrace;
  autonomy: CopilotCommandSpec["autonomy"];
}

export interface CopilotContextInput extends AnomalyInput {
  /** Optional ETA question context. */
  eta?: { distanceKm: number; stopsRemaining: number; serviceType?: "express" | "standard" | "economy" | "cold_chain" };
}

function fnv(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Route free text to a command. Deterministic keyword scoring. */
export function resolveCommand(prompt: string): CopilotCommandSpec | null {
  const text = prompt.toLowerCase();
  let best: { spec: CopilotCommandSpec; score: number } | null = null;
  for (const spec of COPILOT_COMMANDS) {
    const score = spec.keywords.reduce((s, k) => (text.includes(k) ? s + k.length : s), 0);
    if (score > 0 && (!best || score > best.score)) best = { spec, score };
  }
  return best?.spec ?? null;
}

const APPROVER: Record<CopilotCommandId, string | null> = {
  network_status: null,
  optimize_routes: "Routing manager",
  dispatch_recommendation: "Dispatch manager",
  capacity_forecast: null,
  anomaly_scan: null,
  eta_explain: null,
  capability_maturity: null,
  simulate_surge: null,
};

/**
 * Ask the orchestrator. Pure: same prompt + same context ⇒ same response
 * (including the trace id), which is what makes it certifiable.
 */
export function askLogisticsCopilot(prompt: string, ctx: CopilotContextInput = {}): CopilotResponse {
  const spec = resolveCommand(prompt);
  const obs: TwinObservation = ctx;
  const twin = buildTwin(obs, new Date(0));
  const baseTrace = (sources: string[], capabilities: string[], confidence: number, policy: string): CopilotTrace => ({
    sources,
    capabilities,
    policy,
    confidence: Math.round(confidence * 100) / 100,
    traceId: fnv(`${spec?.id ?? "unknown"}|${JSON.stringify(ctx)}|${prompt.toLowerCase().trim()}`),
  });

  if (!spec) {
    return {
      command: "unknown",
      title: "Grounded summary",
      answer: [
        `I can only answer from platform state. Network health is ${twin.health}/100 with ${twin.bottlenecks.length} bottleneck(s).`,
        `Try one of: ${COPILOT_COMMANDS.map((c) => c.label).join(", ")}.`,
      ],
      actions: [],
      trace: baseTrace(["digital_twin"], ["executive_logistics_intelligence"], 0.5, "Ungrounded request — refused to speculate"),
      autonomy: "read_only",
    };
  }

  const approver = APPROVER[spec.id];
  const policy = spec.autonomy === "act_with_approval"
    ? `Mutating action — requires ${approver} approval before execution`
    : spec.autonomy === "recommend"
      ? "Advisory output — no state change performed"
      : "Read-only grounded answer";

  let answer: string[] = [];
  let actions: CopilotAction[] = [];
  let confidence = 0.85;
  const sources = ["digital_twin"];

  switch (spec.id) {
    case "network_status": {
      answer = [
        `Network health ${twin.health}/100 across ${twin.nodes.length} modelled nodes.`,
        `Traffic index ${twin.environment.trafficIndex.toFixed(2)}, weather index ${twin.environment.weatherIndex.toFixed(2)}, ~${twin.environment.networkDelayMinutes} min accumulated delay.`,
        twin.bottlenecks.length
          ? `Bottlenecks: ${twin.bottlenecks.slice(0, 4).map((b) => `${b.label} (${Math.round(b.utilisation * 100)}%)`).join(", ")}.`
          : "No node above 75% utilisation.",
      ];
      confidence = 0.92;
      break;
    }
    case "optimize_routes": {
      const congested = twin.bottlenecks.filter((b) => b.nodeId.startsWith("dc:") || b.nodeId === "route:plan");
      answer = [
        `Traffic index ${twin.environment.trafficIndex.toFixed(2)} adds roughly ${twin.environment.networkDelayMinutes} min across the active plan.`,
        congested.length
          ? `Re-sequence around: ${congested.map((b) => b.label).join(", ")}.`
          : "No structural congestion — only opportunistic re-sequencing available.",
        "Expected effect: shorter final-mile legs on the most loaded lanes, refreshed customer ETAs.",
      ];
      actions = [{
        id: "route.resequence",
        label: "Re-sequence active routes",
        detail: `Apply dynamic re-sequencing to ${congested.length || 1} lane(s) using current traffic and capacity signals.`,
        impact: `Estimated ${Math.max(4, Math.round(twin.environment.networkDelayMinutes * 0.3))} min saved per affected route`,
        requiresApproval: true,
        approver,
      }];
      confidence = 0.78;
      sources.push("prediction_engine");
      break;
    }
    case "dispatch_recommendation": {
      const forecast = forecastCapacity(obs, twin);
      const near = forecast[0];
      answer = [
        `Next hour: ${near.projectedDemand} parcels against ${near.availableCapacity} capacity (utilisation ${near.utilisation}).`,
        near.recommendation,
        `Courier network utilisation ${Math.round((twin.nodes.find((n) => n.id === "courier:network")?.utilisation ?? 0) * 100)}%.`,
      ];
      actions = [{
        id: "dispatch.rebalance",
        label: "Rebalance courier allocation",
        detail: near.shortfall > 0
          ? `Add ~${Math.ceil(near.shortfall / 3.2)} couriers to the most loaded zones.`
          : "Hold reserve couriers on standby; no reallocation needed.",
        impact: near.shortfall > 0 ? `Closes a ${near.shortfall}-parcel shortfall in the next window` : "Preserves absorption headroom",
        requiresApproval: true,
        approver,
      }];
      confidence = near.confidence;
      sources.push("prediction_engine");
      break;
    }
    case "capacity_forecast": {
      const forecast = forecastCapacity(obs, twin);
      answer = forecast.map(
        (f) => `${f.window.replace("next_", "Next ").replace("h", " h")}: demand ${f.projectedDemand} vs capacity ${f.availableCapacity} (util ${f.utilisation}) — ${f.recommendation}`,
      );
      confidence = 0.8;
      sources.push("prediction_engine");
      break;
    }
    case "anomaly_scan": {
      const anomalies = detectAnomalies(ctx, twin);
      answer = anomalies.length
        ? anomalies.slice(0, 6).map((a) => `[${a.severity}] ${a.subject}: ${a.detail} → ${a.recommendedAction}`)
        : ["No predicted anomalies above threshold in the current dispatch window."];
      confidence = 0.86;
      sources.push("prediction_engine");
      break;
    }
    case "eta_explain": {
      const p = predictEta({
        distanceKm: ctx.eta?.distanceKm ?? 8,
        stopsRemaining: ctx.eta?.stopsRemaining ?? 3,
        serviceType: ctx.eta?.serviceType ?? "standard",
        trafficIndex: twin.environment.trafficIndex,
        weatherIndex: twin.environment.weatherIndex,
        hubUtilisation: twin.nodes.find((n) => n.kind === "hub")?.utilisation,
      });
      answer = [
        `Predicted arrival in ${p.etaMinutes} min (band ${p.lowerMinutes}–${p.upperMinutes} min, confidence ${p.confidence}).`,
        p.rationale,
        `Top contributors: ${[...p.features].sort((a, b) => b.contributionMinutes - a.contributionMinutes).slice(0, 3).map((f) => `${f.name} +${f.contributionMinutes} min`).join(", ")}.`,
      ];
      confidence = p.confidence;
      sources.push("eta_model");
      break;
    }
    case "capability_maturity": {
      const report = runCapabilityIntelligence();
      const top = investmentPriorities(report, 3);
      answer = [
        ...report.explanation,
        `Fund next: ${top.map((g) => `${g.capabilityLabel} · ${g.dimensionLabel} (${g.score})`).join("; ")}.`,
      ];
      confidence = 0.95;
      sources.push("capability_intelligence");
      break;
    }
    case "simulate_surge": {
      const result = simulateTwin(obs, { label: "1.5× demand surge", demandMultiplier: 1.5 }, new Date(0));
      answer = [
        `${result.scenario}: health moves ${result.baseHealth} → ${result.projectedHealth} (${result.delta >= 0 ? "+" : ""}${result.delta}).`,
        result.newBottlenecks.length ? `New bottlenecks: ${result.newBottlenecks.join(", ")}.` : "No new bottlenecks emerge.",
        `Verdict: ${result.verdict}.`,
      ];
      confidence = 0.82;
      sources.push("twin_simulation");
      break;
    }
  }

  return {
    command: spec.id,
    title: spec.label,
    answer,
    actions,
    trace: baseTrace(sources, spec.grounding, confidence, policy),
    autonomy: spec.autonomy,
  };
}

export interface CopilotCertification {
  version: string;
  commands: number;
  groundedCommands: number;
  approvalGatedCommands: number;
  traceable: boolean;
  score: number;
  passed: boolean;
  findings: string[];
}

/** Certifies that the orchestrator is governed, grounded and traceable. */
export function certifyCopilot(): CopilotCertification {
  const findings: string[] = [];
  for (const c of COPILOT_COMMANDS) {
    if (c.grounding.length === 0) findings.push(`${c.id}: no grounding capability`);
    if (c.autonomy === "act_with_approval" && !APPROVER[c.id]) findings.push(`${c.id}: mutating command has no approver`);
  }
  const probe = askLogisticsCopilot("network status");
  const replay = askLogisticsCopilot("network status");
  const traceable = probe.trace.traceId === replay.trace.traceId && probe.trace.traceId.length > 0;
  if (!traceable) findings.push("Responses are not deterministically replayable");

  const score = Math.max(0, 100 - findings.length * 15);
  return {
    version: ORCHESTRATOR_VERSION,
    commands: COPILOT_COMMANDS.length,
    groundedCommands: COPILOT_COMMANDS.filter((c) => c.grounding.length > 0).length,
    approvalGatedCommands: COPILOT_COMMANDS.filter((c) => c.autonomy === "act_with_approval").length,
    traceable,
    score,
    passed: findings.length === 0,
    findings,
  };
}
