/**
 * Phase 9.11 — AI Expansion Council.
 *
 * Five named advisors argue the same evidence from different mandates:
 * Growth, Finance, Operations, Risk & Regulation, Network. Each returns a
 * position, a confidence and its reasoning. Dissent is preserved, never
 * averaged away, and a council recommendation is only issued when a majority
 * position exists on evidenced inputs.
 *
 * Deterministic and dependency-free: the council is an auditable rule set, not
 * a generative narrator.
 */
import type { AttractivenessResult } from "./attractiveness";
import type { EntryDecision } from "./entryDecision";
import type { ScenarioMatrix } from "./entrySimulator";
import type { NetworkEffectReading } from "./networkDensity";
import type { SeedingPlan } from "./seeding";

export type CouncilSeat = "growth" | "finance" | "operations" | "risk" | "network";
export type CouncilPosition = "advance" | "advance_with_conditions" | "hold" | "reject" | "abstain";

export interface CouncilOpinion {
  seat: CouncilSeat;
  title: string;
  position: CouncilPosition;
  /** 0–100; abstain always carries 0. */
  confidence: number;
  reasoning: string;
  /** The single thing that would change this seat's mind. */
  wouldChangeMind: string;
}

export interface CouncilVerdict {
  marketId: string;
  marketName: string;
  opinions: CouncilOpinion[];
  recommendation: CouncilPosition;
  /** Positions that disagree with the recommendation, preserved verbatim. */
  dissent: CouncilOpinion[];
  /** Seats that could not form a view because evidence was missing. */
  abstentions: CouncilSeat[];
  rationale: string;
  decidedAt: string;
}

const TITLES: Record<CouncilSeat, string> = {
  growth: "Growth mandate",
  finance: "Capital discipline",
  operations: "Fulfilment reality",
  risk: "Risk & regulation",
  network: "Network defensibility",
};

export interface CouncilInputs {
  attractiveness: AttractivenessResult;
  decision: EntryDecision;
  matrix: ScenarioMatrix;
  seeding: SeedingPlan;
  network?: NetworkEffectReading;
}

export function convene(inputs: CouncilInputs): CouncilVerdict {
  const { attractiveness, decision, matrix, seeding, network } = inputs;
  const base = matrix.scenarios.find((s) => s.stress === "base" && s.strategy === "balanced_launch") ?? null;
  const opinions: CouncilOpinion[] = [];

  /* Growth — argues for the size of the prize, and nothing else. */
  const score = attractiveness.score.value;
  opinions.push(score === null ? {
    seat: "growth", title: TITLES.growth, position: "abstain", confidence: 0,
    reasoning: `Attractiveness is not assessable — only ${attractiveness.coveragePct}% of scoring weight is evidenced.`,
    wouldChangeMind: `Observe: ${attractiveness.excluded.join(", ") || "the missing signals"}.`,
  } : {
    seat: "growth", title: TITLES.growth,
    position: score >= 72 ? "advance" : score >= 58 ? "advance_with_conditions" : score >= 42 ? "hold" : "reject",
    confidence: Math.round((attractiveness.score.confidence ?? 50)),
    reasoning: `Attractiveness scores ${score}/100 in band "${attractiveness.band}". Strongest dimensions: ${
      [...attractiveness.dimensions].filter((d) => d.score !== null)
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 2).map((d) => d.label).join(" and ")
    }.`,
    wouldChangeMind: "A material downgrade in addressable riders or achievable fare.",
  });

  /* Finance — argues for cash, payback and the return hurdle. */
  const peak = base?.peakCashNeed.value ?? null;
  const be = base?.breakevenMonth.value ?? null;
  opinions.push(peak === null || be === null ? {
    seat: "finance", title: TITLES.finance, position: "abstain", confidence: 0,
    reasoning: "Peak cash need or breakeven month is not projectable, so no capital position can be taken.",
    wouldChangeMind: "A complete twin projection with contribution per trip evidenced.",
  } : {
    seat: "finance", title: TITLES.finance,
    position: be <= 12 && peak <= 80_000_000 ? "advance"
      : be <= 18 ? "advance_with_conditions" : be <= 24 ? "hold" : "reject",
    confidence: be <= 18 ? 72 : 60,
    reasoning: `Peak cash need is KES ${Math.round(peak).toLocaleString()} with breakeven at month ${be}. Seeding alone commits KES ${
      Math.round(seeding.totalBudget.value ?? 0).toLocaleString()}.`,
    wouldChangeMind: "Breakeven slipping past month 24, or peak cash exceeding the approved envelope.",
  });

  /* Operations — argues fulfilment, not sales. */
  const unserved = base?.unservedShare ?? null;
  opinions.push(unserved === null ? {
    seat: "operations", title: TITLES.operations, position: "abstain", confidence: 0,
    reasoning: "Unserved demand cannot be projected, so fulfilment risk is unknown.",
    wouldChangeMind: "Observed reachable supply and trips per supply unit.",
  } : {
    seat: "operations", title: TITLES.operations,
    position: unserved <= 10 ? "advance" : unserved <= 25 ? "advance_with_conditions" : "hold",
    confidence: 68,
    reasoning: `${unserved.toFixed(1)}% of projected demand goes unserved. The seeding plan is ${seeding.side.replace("_", "-")}: ${seeding.sideRationale}`,
    wouldChangeMind: "Evidence that operators can be activated faster than the seeding waves assume.",
  });

  /* Risk & regulation — the only seat with a veto. */
  const regGate = decision.gates.find((g) => g.id === "regulatory");
  opinions.push(regGate?.passed === null ? {
    seat: "risk", title: TITLES.risk, position: "abstain", confidence: 0,
    reasoning: "Regulatory friction has not been assessed for this market.",
    wouldChangeMind: "A completed licensing and compliance assessment.",
  } : {
    seat: "risk", title: TITLES.risk,
    position: regGate?.passed ? (decision.verdict === "go" ? "advance" : "advance_with_conditions") : "reject",
    confidence: 80,
    reasoning: `Regulatory admissibility ${regGate?.passed ? "passes" : "fails"} (${regGate?.observed}). Entry engine verdict: ${decision.verdict.replace("_", " ")}.`,
    wouldChangeMind: "A change in licensing regime or a written regulator position.",
  });

  /* Network — argues defensibility through density. */
  opinions.push(!network || network.zones.length === 0 ? {
    seat: "network", title: TITLES.network, position: "abstain", confidence: 0,
    reasoning: "No zone-level density observations exist for this market.",
    wouldChangeMind: "Instrumented zones reporting operators, request outcomes and accept latency.",
  } : {
    seat: "network", title: TITLES.network,
    position: network.criticalMassSharePct >= 60 ? "advance"
      : network.criticalMassSharePct >= 30 ? "advance_with_conditions" : "hold",
    confidence: 65,
    reasoning: network.interpretation,
    wouldChangeMind: `Density improving in ${network.weakestZones.map((z) => z.zoneName).join(", ") || "the weakest zones"}.`,
  });

  const voting = opinions.filter((o) => o.position !== "abstain");
  const abstentions = opinions.filter((o) => o.position === "abstain").map((o) => o.seat);
  const vetoed = opinions.some((o) => o.seat === "risk" && o.position === "reject");

  let recommendation: CouncilPosition;
  let rationale: string;

  if (vetoed) {
    recommendation = "reject";
    rationale = "Risk & regulation holds a veto and has rejected entry. No growth case overrides an inadmissible market.";
  } else if (voting.length < 3) {
    recommendation = "hold";
    rationale = `Only ${voting.length} of 5 seats could form a view; the council will not recommend on ${abstentions.length} abstentions.`;
  } else {
    const tally = new Map<CouncilPosition, number>();
    for (const o of voting) tally.set(o.position, (tally.get(o.position) ?? 0) + 1);
    const ordered = [...tally.entries()].sort((a, b) => b[1] - a[1]);
    const [top, count] = ordered[0];
    recommendation = count > voting.length / 2 ? top : "advance_with_conditions";
    rationale = count > voting.length / 2
      ? `${count} of ${voting.length} voting seats hold "${top.replace(/_/g, " ")}".`
      : `No majority position — the council defaults to conditional advance with every dissent recorded.`;
  }

  return {
    marketId: attractiveness.marketId,
    marketName: attractiveness.marketName,
    opinions,
    recommendation,
    dissent: voting.filter((o) => o.position !== recommendation),
    abstentions,
    rationale,
    decidedAt: new Date().toISOString(),
  };
}
