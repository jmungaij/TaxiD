/**
 * Phase 9.9–9.10 — Expansion portfolio & capital allocation.
 *
 * The portfolio sequences approved markets under a finite capital envelope and
 * a finite operating-team envelope. Capital is allocated on evidenced return per
 * shilling at risk; a market that cannot evidence its return receives nothing
 * and is listed as unfunded with the reason.
 */
import { type Measure, seededMeasure, unavailableMeasure } from "../phase8/provenance";
import type { AttractivenessResult } from "./attractiveness";
import type { EntryDecision } from "./entryDecision";
import type { ScenarioMatrix } from "./entrySimulator";

export interface PortfolioCandidate {
  marketId: string;
  marketName: string;
  attractiveness: AttractivenessResult;
  decision: EntryDecision;
  matrix: ScenarioMatrix;
}

export interface CapitalEnvelope {
  /** Total capital available for expansion in the period, KES. */
  totalCapitalKes: number;
  /** Launch teams available concurrently. */
  launchTeams: number;
  /** Minimum return multiple on capital at risk to fund a market. */
  minReturnMultiple: number;
}

export interface Allocation {
  marketId: string;
  marketName: string;
  rank: number;
  wave: number;
  requestedCapital: Measure;
  allocatedCapital: Measure;
  /** Horizon contribution ÷ peak cash need. */
  returnMultiple: number | null;
  verdict: EntryDecision["verdict"];
  status: "funded" | "partially_funded" | "queued" | "unfunded";
  reason: string;
}

export interface ExpansionPortfolio {
  envelope: CapitalEnvelope;
  allocations: Allocation[];
  committedCapital: Measure;
  uncommittedCapital: Measure;
  /** Expected annualised contribution from funded markets. */
  expectedContribution: Measure;
  unfunded: Allocation[];
  narrative: string;
}

const SRC = "expansion:portfolio";

function baseScenario(c: PortfolioCandidate) {
  return c.matrix.scenarios.find((s) => s.strategy === (c.decision.recommendedStrategy ?? "balanced_launch")
    && s.stress === "base")
    ?? c.matrix.scenarios.find((s) => s.stress === "base")
    ?? null;
}

export function buildPortfolio(
  candidates: readonly PortfolioCandidate[],
  envelope: CapitalEnvelope,
): ExpansionPortfolio {
  const evidence = "Allocation computed from simulated market twins under the stated capital envelope";

  const scored = candidates.map((c) => {
    const base = baseScenario(c);
    const peak = base?.peakCashNeed.value ?? null;
    const contribution = base?.contributionAtHorizon ?? null;
    const multiple = peak !== null && peak > 0 && contribution !== null ? (contribution * 12) / peak : null;
    return { c, peak, contribution, multiple };
  });

  const eligible = scored
    .filter((x) => (x.c.decision.verdict === "go" || x.c.decision.verdict === "conditional_go"))
    .sort((a, b) => {
      const am = a.multiple ?? -1, bm = b.multiple ?? -1;
      if (bm !== am) return bm - am;
      return (b.c.attractiveness.score.value ?? -1) - (a.c.attractiveness.score.value ?? -1);
    });

  const allocations: Allocation[] = [];
  let remaining = envelope.totalCapitalKes;
  let funded = 0;
  let expected = 0;
  let rank = 0;

  for (const x of eligible) {
    rank++;
    const wave = Math.ceil(rank / Math.max(1, envelope.launchTeams));
    const requested = x.peak === null
      ? unavailableMeasure("Requested capital", "kes", SRC, "Peak cash need is not projectable")
      : seededMeasure("Requested capital", x.peak, "kes", SRC, "twin peak cash need for the recommended strategy", evidence);

    if (x.peak === null || x.multiple === null) {
      allocations.push({
        marketId: x.c.marketId, marketName: x.c.marketName, rank, wave,
        requestedCapital: requested,
        allocatedCapital: unavailableMeasure("Allocated capital", "kes", SRC, "Return on capital at risk is not evidenced"),
        returnMultiple: x.multiple, verdict: x.c.decision.verdict, status: "unfunded",
        reason: "Return on capital at risk cannot be evidenced — TaxiD does not fund an unquantified launch.",
      });
      continue;
    }

    if (x.multiple < envelope.minReturnMultiple) {
      allocations.push({
        marketId: x.c.marketId, marketName: x.c.marketName, rank, wave,
        requestedCapital: requested,
        allocatedCapital: seededMeasure("Allocated capital", 0, "kes", SRC, "below the return hurdle", evidence),
        returnMultiple: x.multiple, verdict: x.c.decision.verdict, status: "unfunded",
        reason: `Return multiple of ${x.multiple.toFixed(2)}× is below the ${envelope.minReturnMultiple}× hurdle.`,
      });
      continue;
    }

    if (remaining <= 0) {
      allocations.push({
        marketId: x.c.marketId, marketName: x.c.marketName, rank, wave,
        requestedCapital: requested,
        allocatedCapital: seededMeasure("Allocated capital", 0, "kes", SRC, "envelope exhausted", evidence),
        returnMultiple: x.multiple, verdict: x.c.decision.verdict, status: "queued",
        reason: "Capital envelope is exhausted for this period; queued for the next allocation round.",
      });
      continue;
    }

    const grant = Math.min(x.peak, remaining);
    remaining -= grant;
    funded += grant;
    expected += (x.contribution ?? 0) * 12 * (grant / x.peak);
    allocations.push({
      marketId: x.c.marketId, marketName: x.c.marketName, rank, wave,
      requestedCapital: requested,
      allocatedCapital: seededMeasure("Allocated capital", grant, "kes", SRC,
        grant < x.peak ? "remaining envelope, below the full requirement" : "full twin peak cash need", evidence),
      returnMultiple: x.multiple, verdict: x.c.decision.verdict,
      status: grant < x.peak ? "partially_funded" : "funded",
      reason: grant < x.peak
        ? "Partially funded — launch scope must be reduced to the lean pilot until the next round."
        : `Funded at ${x.multiple.toFixed(2)}× projected annual contribution on capital at risk.`,
    });
  }

  for (const x of scored.filter((s) => s.c.decision.verdict === "defer" || s.c.decision.verdict === "no_go")) {
    allocations.push({
      marketId: x.c.marketId, marketName: x.c.marketName, rank: 0, wave: 0,
      requestedCapital: unavailableMeasure("Requested capital", "kes", SRC, "Entry not approved"),
      allocatedCapital: seededMeasure("Allocated capital", 0, "kes", SRC, "entry gate not cleared", evidence),
      returnMultiple: x.multiple, verdict: x.c.decision.verdict, status: "unfunded",
      reason: x.c.decision.verdict === "defer"
        ? `Deferred pending evidence: ${x.c.decision.evidenceRequired.join(", ") || "entry gates unresolved"}.`
        : x.c.decision.rationale,
    });
  }

  const fundedCount = allocations.filter((a) => a.status === "funded" || a.status === "partially_funded").length;
  return {
    envelope,
    allocations,
    committedCapital: seededMeasure("Committed capital", funded, "kes", SRC, "sum of allocations", evidence),
    uncommittedCapital: seededMeasure("Uncommitted capital", Math.max(0, remaining), "kes", SRC,
      "envelope − committed capital", evidence),
    expectedContribution: fundedCount === 0
      ? unavailableMeasure("Expected annual contribution", "kes", SRC, "No market is funded")
      : seededMeasure("Expected annual contribution", expected, "kes", SRC,
        "funded share × final-month contribution × 12", evidence),
    unfunded: allocations.filter((a) => a.status === "unfunded" || a.status === "queued"),
    narrative: fundedCount === 0
      ? "No market clears both its entry gates and the return hurdle inside this envelope. The disciplined answer is to fund none of them and close the evidence gaps first."
      : `${fundedCount} market${fundedCount > 1 ? "s" : ""} funded across ${
          Math.max(...allocations.filter((a) => a.wave > 0).map((a) => a.wave), 0)
        } launch wave(s); KES ${Math.round(remaining).toLocaleString()} of the envelope remains uncommitted.`,
  };
}
