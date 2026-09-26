/**
 * Ask SAFARID orchestrator.
 *
 * Intent → required domains → authorisation → parallel domain reads →
 * cross-check → data quality → confidence → quality gate → answer, with every
 * answer and every refusal written to the append-only answer ledger.
 *
 * The orchestrator does no arithmetic on money and calls no model: figures come
 * from the domain services, which read authoritative records under RLS.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  computeConfidence,
  computeDataQuality,
  countByClass,
  newestTimestamp,
  type Claim,
  type DataQuality,
  type DomainReading,
  type IntelligenceDomain,
} from "./contract";
import { runAnswerQualityGate, type AnswerVerdict, type GateResult } from "./gate";
import { resolveIntent, type ResolvedIntent } from "./intent";
import { COMMERCIAL_PERMISSION, readCommercial } from "./domains/commercial";
import { FINANCE_PERMISSION, readFinance } from "./domains/finance";
import { OPERATIONS_PERMISSION, readOperations } from "./domains/operations";
import { WORKFORCE_PERMISSION, readWorkforce } from "./domains/workforce";
import { SPINE_PERMISSION, readDecisionSpine, type SpineAction } from "./domains/decisionSpine";
import { SECURITY_PERMISSION, readSecurity } from "./domains/security";

export const DOMAIN_PERMISSION: Record<IntelligenceDomain, string> = {
  commercial: COMMERCIAL_PERMISSION,
  finance: FINANCE_PERMISSION,
  operations: OPERATIONS_PERMISSION,
  workforce: WORKFORCE_PERMISSION,
  decision_spine: SPINE_PERMISSION,
  security: SECURITY_PERMISSION,
};

export interface CrossCheck {
  label: string;
  agrees: boolean;
  detail: string;
}

export interface IntelligenceAnswer {
  question: string;
  intent: ResolvedIntent;
  verdict: AnswerVerdict;
  headline: string;
  why: string[];
  claims: Claim[];
  readings: DomainReading[];
  crossChecks: CrossCheck[];
  quality: DataQuality;
  confidence: number;
  nextBestActions: SpineAction[];
  gate: GateResult;
  generatedAt: string;
  latencyMs: number;
  /** False when the audit ledger rejected the record (answer still returned). */
  recorded: boolean;
}

async function permissionHeld(permission: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("has_staff_permission", { _perm: permission });
  if (error) return false;
  return data === true;
}

/**
 * Cross-checks are stated openly. A disagreement does not silence the answer —
 * it is reported so the reader knows two authoritative sources differ.
 */
function crossCheck(readings: DomainReading[]): CrossCheck[] {
  const out: CrossCheck[] = [];
  const claim = (id: string) => readings.flatMap((r) => r.claims).find((c) => c.id === id);

  const lifecycleRevenue = claim("commercial.recognised");
  const txRevenue = claim("finance.platform_revenue");
  if (lifecycleRevenue?.numeric !== undefined && txRevenue?.numeric !== undefined) {
    const both = lifecycleRevenue.numeric > 0 || txRevenue.numeric > 0;
    const gap = Math.abs(lifecycleRevenue.numeric - txRevenue.numeric);
    const tolerance = Math.max(1, 0.05 * Math.max(lifecycleRevenue.numeric, txRevenue.numeric));
    out.push({
      label: "Recognised revenue agrees between the lifecycle register and the transaction register",
      agrees: !both || gap <= tolerance,
      detail: both
        ? `lifecycle ${lifecycleRevenue.value} vs transactions ${txRevenue.value}`
        : "both registers report nothing recognised yet",
    });
  }

  const contracted = claim("commercial.contracted");
  const recognised = claim("commercial.recognised");
  if (contracted?.numeric !== undefined && recognised?.numeric !== undefined) {
    out.push({
      label: "Recognised revenue never exceeds contracted value",
      agrees: recognised.numeric <= contracted.numeric + 1,
      detail: `${recognised.value} recognised against ${contracted.value} contracted`,
    });
  }

  return out;
}

function buildHeadline(verdict: AnswerVerdict, intent: ResolvedIntent, claims: Claim[]): string {
  if (verdict === "not_authorised") {
    return "This account is not permitted to read any of the domains this question needs.";
  }
  if (verdict === "insufficient_data") {
    return "Insufficient data to answer. Nothing has been estimated in its place.";
  }
  const facts = claims.filter((c) => c.classification === "FACT").slice(0, 3);
  const lead = facts.map((c) => `${c.label}: ${c.value}`).join(" · ");
  const prefix = verdict === "qualified" ? "Partial answer — " : "";
  return `${prefix}${lead || intent.label}`;
}

function buildWhy(
  intent: ResolvedIntent,
  readings: DomainReading[],
  crossChecks: CrossCheck[],
  gate: GateResult,
): string[] {
  const why: string[] = [];
  why.push(
    `Routed to ${readings.map((r) => r.domain.replace("_", " ")).join(", ")} because the question matched ${intent.label.toLowerCase()}.`,
  );
  for (const reading of readings) {
    if (!reading.authorised) {
      why.push(`${reading.domain.replace("_", " ")} was not read: you do not hold ${reading.permission}.`);
    } else if (reading.unavailableReason) {
      why.push(`${reading.domain.replace("_", " ")} returned nothing: ${reading.unavailableReason}.`);
    } else {
      why.push(`${reading.domain.replace("_", " ")}: ${reading.rowsInspected} record(s) read under your own access.`);
    }
  }
  for (const check of crossChecks) {
    why.push(`${check.agrees ? "Cross-check passed" : "Cross-check disagreed"} — ${check.label} (${check.detail}).`);
  }
  for (const failed of gate.checks.filter((c) => !c.passed)) {
    why.push(`Answer quality: ${failed.label} — ${failed.detail ?? "not satisfied"}.`);
  }
  return why;
}

async function recordAnswer(answer: Omit<IntelligenceAnswer, "recorded">): Promise<boolean> {
  const counts = countByClass(answer.readings);
  const { error } = await supabase.from("ai_answer_ledger").insert({
    question: answer.question.slice(0, 2000),
    intent: answer.intent.code,
    domains: answer.readings.map((r) => r.domain),
    verdict: answer.verdict,
    gate_failures: answer.gate.failures,
    data_quality: answer.quality.score,
    confidence: answer.confidence,
    fact_count: counts.FACT,
    estimate_count: counts.ESTIMATE,
    prediction_count: counts.PREDICTION,
    recommendation_count: counts.RECOMMENDATION,
    freshest_at: newestTimestamp(answer.readings.map((r) => r.freshestAt)) ?? null,
    latency_ms: answer.latencyMs,
  });
  return !error;
}

export async function askYalla(question: string): Promise<IntelligenceAnswer> {
  const started = Date.now();
  const intent = resolveIntent(question);

  const permissions = await Promise.all(
    intent.domains.map(async (domain) => ({ domain, held: await permissionHeld(DOMAIN_PERMISSION[domain]) })),
  );
  const held = new Map(permissions.map((p) => [p.domain, p.held]));

  const readings: DomainReading[] = [];
  let spineActions: SpineAction[] = [];

  await Promise.all(
    intent.domains.map(async (domain) => {
      const ok = held.get(domain) === true;
      switch (domain) {
        case "commercial":
          readings.push(await readCommercial(ok));
          break;
        case "finance":
          readings.push(await readFinance(ok));
          break;
        case "operations":
          readings.push(await readOperations(ok));
          break;
        case "workforce":
          readings.push(await readWorkforce(ok));
          break;
        case "security":
          readings.push(await readSecurity(ok));
          break;

        case "decision_spine": {
          const spine = await readDecisionSpine(ok);
          spineActions = spine.actions;
          readings.push(spine);
          break;
        }
      }
    }),
  );

  readings.sort((a, b) => intent.domains.indexOf(a.domain) - intent.domains.indexOf(b.domain));

  const quality = computeDataQuality(readings);
  const confidence = computeConfidence(readings, quality);
  const checks = crossCheck(readings);
  const gate = runAnswerQualityGate({ readings, quality, intentResolved: intent.resolved });
  const claims = readings.filter((r) => r.authorised).flatMap((r) => r.claims);

  const draft: Omit<IntelligenceAnswer, "recorded"> = {
    question,
    intent,
    verdict: gate.verdict,
    headline: buildHeadline(gate.verdict, intent, claims),
    why: buildWhy(intent, readings, checks, gate),
    claims: gate.verdict === "not_authorised" ? [] : claims,
    readings,
    crossChecks: checks,
    quality,
    confidence: gate.verdict === "answered" || gate.verdict === "qualified" ? confidence : 0,
    nextBestActions: gate.verdict === "not_authorised" ? [] : spineActions,
    gate,
    generatedAt: new Date().toISOString(),
    latencyMs: Date.now() - started,
  };

  const recorded = await recordAnswer(draft);
  return { ...draft, recorded };
}
