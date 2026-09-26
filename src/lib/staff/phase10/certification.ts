/**
 * Phase 10 §10.40 — the certification standard.
 *
 * Phase 10 is NOT certified because the portal looks impressive, agents exist,
 * the Control Tower is cinematic, the catalogue was copied or dashboards render.
 * It passes only when one platform demonstrably coordinates multiple demand
 * types against multiple independent supply types across multiple services while
 * maintaining matching, availability, pricing, booking, fulfilment, safety,
 * governance, payment, settlement, revenue, customer experience, provider
 * economics, auditability and learning.
 */
import type { MissionDemonstration } from "./orchestrationDemo";
import type { LiquidityAssessment } from "./liquidityBrain";
import type { Product360 } from "./product360";
import type { NetworkEffects } from "./networkValue";
import type { KnowledgeGraphHealth } from "./enterpriseGraph";

export interface CertificationCriterion {
  id: string;
  requirement: string;
  /** Weight in the overall verdict. */
  weight: number;
  passed: boolean;
  evidence: string;
  /** What must change for this criterion to pass. */
  remediation?: string;
}

export interface Phase10Certification {
  verdict: "pass" | "conditional" | "fail";
  score: number;
  criteria: CertificationCriterion[];
  /** Distinct demand segments, supply kinds and product lines demonstrated. */
  breadth: { demandTypes: number; supplyKinds: number; productLines: number };
  gaps: string[];
  narrative: string;
}

export interface CertificationEvidence {
  demonstrations: readonly MissionDemonstration[];
  liquidity: readonly LiquidityAssessment[];
  products: readonly Product360[];
  network: NetworkEffects;
  knowledge: KnowledgeGraphHealth;
  /** Recognised revenue in cents from the transaction spine. */
  recognisedRevenueCents: number | null;
  /** Settled value in cents from the settlement engine. */
  settledCents: number | null;
  /** Immutable audit entries covering the demonstrated chain. */
  auditEntries: number | null;
}

export function certifyPhase10(e: CertificationEvidence): Phase10Certification {
  const demos = e.demonstrations;
  const demandTypes = new Set(demos.map((d) => d.mission.demand.segment)).size;
  const supplyKinds = new Set(demos.flatMap((d) => d.mission.supplyKinds)).size;
  const productLines = new Set(demos.map((d) => d.mission.product)).size;

  const matched = demos.filter((d) => d.match.best !== null);
  const priced = demos.filter((d) => d.price.recommendedPriceCents !== null);
  const booked = demos.filter((d) => d.statesExecuted.includes("booked"));
  const fulfilled = demos.filter((d) => d.statesExecuted.includes("completed"));
  const settled = demos.filter((d) => d.statesExecuted.includes("settled"));
  const trusted = demos.filter((d) => d.trust.closureAllowed);
  const governed = demos.filter((d) => d.price.requiresApproval || d.decision.approvalRequirement !== "none");
  const learned = demos.filter((d) => d.decision.learning !== undefined);
  const measuredLiquidity = e.liquidity.filter((l) => l.state !== "unmeasured");
  const providerEconomics = e.products.filter((p) => p.contribution.value !== null);

  const criteria: CertificationCriterion[] = [
    {
      id: "multi_demand",
      requirement: "Coordinates multiple distinct demand types",
      weight: 8,
      passed: demandTypes >= 3,
      evidence: `${demandTypes} distinct demand segment(s) demonstrated`,
      remediation: demandTypes >= 3 ? undefined : "Demonstrate at least three demand segments (individual, corporate, shipper)",
    },
    {
      id: "multi_supply",
      requirement: "Coordinates multiple independent supply types",
      weight: 8,
      passed: supplyKinds >= 4,
      evidence: `${supplyKinds} supply kind(s) demonstrated`,
      remediation: supplyKinds >= 4 ? undefined : "Demonstrate drivers, operators, couriers/carriers and aircraft operators",
    },
    {
      id: "multi_service",
      requirement: "Operates across multiple mobility and logistics services",
      weight: 8,
      passed: productLines >= 5,
      evidence: `${productLines} product line(s) demonstrated`,
      remediation: productLines >= 5 ? undefined : "Demonstrate at least five of the seven catalogue product lines",
    },
    {
      id: "matching",
      requirement: "Matching produces a best feasible provider, not merely the cheapest or nearest",
      weight: 8,
      passed: matched.length === demos.length && demos.every((d) => d.match.rejected.length > 0),
      evidence: `${matched.length}/${demos.length} missions matched with infeasible candidates explicitly rejected`,
      remediation: matched.length === demos.length ? undefined : "Every demonstrated mission must resolve to a feasible match or an explicit no-match reason",
    },
    {
      id: "availability",
      requirement: "Liquidity is measured and actionable, not asserted",
      weight: 7,
      passed: measuredLiquidity.length > 0 && measuredLiquidity.every((l) => l.interventions.length > 0),
      evidence: `${measuredLiquidity.length}/${e.liquidity.length} liquidity cells measured with interventions attached`,
      remediation: measuredLiquidity.length > 0 ? undefined : "Instrument demand and supply telemetry for at least one market cell",
    },
    {
      id: "pricing",
      requirement: "Pricing is context-sensitive and governed by authorised boundaries",
      weight: 7,
      passed: priced.length > 0 && demos.every((d) => d.price.recommendedPriceCents === null || !d.price.autoApplicable || d.price.deltaPercent === null || Math.abs(d.price.deltaPercent) <= 8),
      evidence: `${priced.length}/${demos.length} missions priced; no unapproved movement exceeded the 8% autonomy boundary`,
      remediation: priced.length > 0 ? undefined : "Configure authorised base prices so a recommendation can be produced",
    },
    {
      id: "booking",
      requirement: "Booking runs on one governed state machine per product",
      weight: 7,
      passed: booked.length === demos.length,
      evidence: `${booked.length}/${demos.length} missions reached booked through governed transitions`,
    },
    {
      id: "fulfilment",
      requirement: "Fulfilment is evidenced, not assumed",
      weight: 7,
      passed: fulfilled.length === demos.length,
      evidence: `${fulfilled.length}/${demos.length} missions reached completed`,
    },
    {
      id: "safety",
      requirement: "Trust and safety facts are complete enough to permit closure",
      weight: 8,
      passed: trusted.length === demos.length,
      evidence: `${trusted.length}/${demos.length} missions cleared the closure-critical trust facets`,
      remediation: trusted.length === demos.length ? undefined : "Evidence identity, compliance, payment and completion for every mission before closure",
    },
    {
      id: "governance",
      requirement: "Consequential actions require a named human authority",
      weight: 8,
      passed: governed.length > 0 && demos.every((d) => d.exception.mode === "autopilot" || d.exception.approverRole !== null),
      evidence: `${governed.length}/${demos.length} missions routed through an approval authority; every non-autopilot exception has a named approver role`,
    },
    {
      id: "payment",
      requirement: "Payment is linked into the transaction spine",
      weight: 8,
      passed: demos.every((d) => d.stages.find((s) => s.stage === "Payment")?.evidenced === true),
      evidence: demos.every((d) => d.stages.find((s) => s.stage === "Payment")?.evidenced) ? "Every demonstrated mission carries a payment reference" : "One or more missions have no linked payment reference",
      remediation: demos.every((d) => d.stages.find((s) => s.stage === "Payment")?.evidenced) ? undefined : "Link an authoritative payment reference from the spine before certifying",
    },
    {
      id: "settlement",
      requirement: "Settlement closes the provider side of the transaction",
      weight: 7,
      passed: settled.length === demos.length && e.settledCents !== null,
      evidence: `${settled.length}/${demos.length} missions reached settled; settlement value ${e.settledCents === null ? "not observed" : `KES ${Math.round(e.settledCents / 100).toLocaleString()}`}`,
      remediation: e.settledCents === null ? "Record settled value against the demonstrated transactions" : undefined,
    },
    {
      id: "revenue",
      requirement: "Revenue is recognised under configured rules",
      weight: 8,
      passed: e.recognisedRevenueCents !== null && e.recognisedRevenueCents > 0,
      evidence: e.recognisedRevenueCents === null ? "No recognised revenue observed" : `KES ${Math.round(e.recognisedRevenueCents / 100).toLocaleString()} recognised`,
      remediation: e.recognisedRevenueCents ? undefined : "Recognise revenue on at least one demonstrated transaction",
    },
    {
      id: "customer_experience",
      requirement: "Customer outcome is captured for every applicable product",
      weight: 5,
      passed: demos.every((d) => d.stages.find((s) => s.stage === "Customer outcome")?.evidenced === true),
      evidence: "Rating or explicit non-applicability recorded for every demonstrated mission",
    },
    {
      id: "provider_economics",
      requirement: "Provider economics are visible per product line",
      weight: 6,
      passed: providerEconomics.length >= Math.max(1, Math.ceil(e.products.length / 2)),
      evidence: `${providerEconomics.length}/${e.products.length} product lines carry observed contribution`,
      remediation: "Attribute contribution to every product line in the transaction spine",
    },
    {
      id: "auditability",
      requirement: "The commercial chain is traceable end to end and audited",
      weight: 8,
      passed: demos.every((d) => d.graph.brokenAt === null) && (e.auditEntries ?? 0) > 0,
      evidence: `${demos.filter((d) => d.graph.brokenAt === null).length}/${demos.length} chains unbroken; ${e.auditEntries ?? 0} audit entries`,
      remediation: demos.every((d) => d.graph.brokenAt === null) ? undefined : `First break: ${demos.find((d) => d.graph.brokenAt)?.graph.narrative ?? "unknown"}`,
    },
    {
      id: "learning",
      requirement: "Expected outcomes are compared to actuals and fed back",
      weight: 6,
      passed: learned.length === demos.length,
      evidence: `${learned.length}/${demos.length} decisions carry a recorded outcome and learning`,
    },
    {
      id: "one_architecture",
      requirement: "All products share one orchestration architecture, not parallel engines",
      weight: 8,
      passed: demos.length > 0 && demos.every((d) => d.machine.length > 0) && new Set(demos.map((d) => d.machine[0])).size === 1,
      evidence: demos.length === 0 ? "No demonstration executed" : `All ${demos.length} product machines derive from the same universal mission framework`,
    },
    {
      id: "knowledge_graph",
      requirement: "Enterprise knowledge is instrumented rather than asserted",
      weight: 5,
      passed: (e.knowledge.coverage.value ?? 0) >= 60,
      evidence: e.knowledge.coverage.value === null ? "Knowledge graph coverage not measurable" : `${Math.round(e.knowledge.coverage.value)}% of entities have an instrumented source of truth`,
      remediation: (e.knowledge.coverage.value ?? 0) >= 60 ? undefined : `Instrument: ${e.knowledge.gaps.join(", ")}`,
    },
    {
      id: "network_effects",
      requirement: "Network effects are measured, not claimed",
      weight: 5,
      passed: e.network.score.value !== null,
      evidence: e.network.score.value === null ? e.network.narrative : `Flywheel scored ${Math.round(e.network.score.value)}/100`,
      remediation: e.network.score.value === null ? `Instrument: ${e.network.unmeasured.slice(0, 3).join("; ")}` : undefined,
    },
  ];

  const totalWeight = criteria.reduce((a, c) => a + c.weight, 0);
  const earned = criteria.filter((c) => c.passed).reduce((a, c) => a + c.weight, 0);
  const score = Math.round((earned / totalWeight) * 100);

  /* Certification is fail-closed: any critical criterion failing caps the verdict. */
  const CRITICAL = ["matching", "safety", "governance", "payment", "revenue", "auditability", "one_architecture"];
  const criticalFailures = criteria.filter((c) => CRITICAL.includes(c.id) && !c.passed);

  const verdict: Phase10Certification["verdict"] = criticalFailures.length > 0
    ? "fail"
    : score >= 90
      ? "pass"
      : score >= 75
        ? "conditional"
        : "fail";

  return {
    verdict,
    score,
    criteria,
    breadth: { demandTypes, supplyKinds, productLines },
    gaps: criteria.filter((c) => !c.passed).map((c) => c.remediation ?? `${c.requirement} — ${c.evidence}`),
    narrative: criticalFailures.length > 0
      ? `FAIL: ${criticalFailures.length} critical criterion/criteria unmet (${criticalFailures.map((c) => c.id).join(", ")}). Phase 10 is not certified on presentation.`
      : verdict === "pass"
        ? `PASS at ${score}/100: one platform coordinated ${demandTypes} demand types against ${supplyKinds} supply types across ${productLines} product lines through a single orchestration architecture.`
        : `CONDITIONAL at ${score}/100: the architecture holds but ${criteria.filter((c) => !c.passed).length} criterion/criteria still rest on uninstrumented evidence.`,
  };
}
