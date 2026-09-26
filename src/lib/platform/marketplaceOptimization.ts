/**
 * IEOS Phase 8 · Phase I — Enterprise Supply & Marketplace Optimization.
 *
 * Balances demand against supply per market cell and emits deterministic,
 * bounded optimisation actions (incentive, reposition, surge, throttle).
 */
import { clamp, round, makeFinding, sortFindings, grade, type PlatformFinding, type Grade } from "./_shared";

export interface MarketCell {
  id: string;
  name: string;
  /** Requests observed in the interval. */
  demand: number;
  /** Available, eligible supply units in the interval. */
  supply: number;
  /** Requests that found no supply. */
  unfulfilled: number;
  /** Average pickup/handover ETA in minutes. */
  etaMinutes: number;
  /** Fraction of supply time actually earning, 0-1. */
  utilization: number;
  /** Currently active surge multiplier. */
  surgeMultiplier: number;
}

export type OptimizationAction = "incentivise_supply" | "reposition_supply" | "apply_surge" | "relax_surge" | "throttle_demand" | "hold";

export interface CellOptimization {
  cellId: string;
  name: string;
  /** demand / supply, capped for readability. */
  imbalanceRatio: number;
  fulfilmentRate: number;
  /** 0-100 marketplace health for the cell. */
  healthScore: number;
  action: OptimizationAction;
  rationale: string;
  /** 0-100 expected improvement if the action is executed. */
  expectedLift: number;
}

export interface MarketplaceCertification {
  cells: CellOptimization[];
  overallFulfilmentRate: number;
  averageEtaMinutes: number;
  averageUtilization: number;
  balancedCells: number;
  score: number;
  grade: Grade;
  findings: PlatformFinding[];
}

export function optimiseCell(cell: MarketCell): CellOptimization {
  const supply = Math.max(0.0001, cell.supply);
  const imbalanceRatio = round(clamp(cell.demand / supply, 0, 20), 2);
  const fulfilmentRate = cell.demand <= 0 ? 100 : round(clamp(((cell.demand - cell.unfulfilled) / cell.demand) * 100), 1);
  const utilization = clamp(cell.utilization, 0, 1);

  const healthScore = round(
    clamp(fulfilmentRate * 0.5 + clamp(100 - cell.etaMinutes * 6) * 0.25 + utilization * 100 * 0.25),
    1,
  );

  let action: OptimizationAction = "hold";
  let rationale = "Demand and supply are balanced within tolerance";

  if (imbalanceRatio >= 2 && fulfilmentRate < 90) {
    action = cell.surgeMultiplier < 1.5 ? "apply_surge" : "incentivise_supply";
    rationale = `Demand is ${imbalanceRatio}x supply with ${round(100 - fulfilmentRate, 1)}% unfulfilled`;
  } else if (imbalanceRatio >= 1.3 && cell.etaMinutes > 8) {
    action = "reposition_supply";
    rationale = `ETA ${round(cell.etaMinutes, 1)} min under mild undersupply — move idle supply into the cell`;
  } else if (imbalanceRatio < 0.6 && utilization < 0.4) {
    action = cell.surgeMultiplier > 1 ? "relax_surge" : "throttle_demand";
    rationale = `Oversupply: utilization ${round(utilization * 100, 1)}% at ${imbalanceRatio}x demand ratio`;
  }

  const expectedLift = action === "hold" ? 0 : round(clamp((100 - healthScore) * 0.6), 1);
  return { cellId: cell.id, name: cell.name, imbalanceRatio, fulfilmentRate, healthScore, action, rationale, expectedLift };
}

export function certifyMarketplace(cells: MarketCell[]): MarketplaceCertification {
  const findings: PlatformFinding[] = [];
  const optimised = cells.map(optimiseCell);

  if (optimised.length === 0) {
    findings.push(makeFinding("marketplace", "p1", "cells", "No market cells supplied", "Register the operating cells for each launched city"));
    return { cells: optimised, overallFulfilmentRate: 0, averageEtaMinutes: 0, averageUtilization: 0, balancedCells: 0, score: 0, grade: "not_certified", findings };
  }

  const totalDemand = cells.reduce((a, c) => a + c.demand, 0);
  const totalUnfulfilled = cells.reduce((a, c) => a + c.unfulfilled, 0);
  const overallFulfilmentRate = totalDemand <= 0 ? 100 : round(clamp(((totalDemand - totalUnfulfilled) / totalDemand) * 100), 1);
  const averageEtaMinutes = round(cells.reduce((a, c) => a + c.etaMinutes, 0) / cells.length, 1);
  const averageUtilization = round((cells.reduce((a, c) => a + clamp(c.utilization, 0, 1), 0) / cells.length) * 100, 1);
  const balancedCells = optimised.filter((c) => c.action === "hold").length;

  for (const c of optimised) {
    if (c.fulfilmentRate < 85) {
      findings.push(makeFinding("marketplace", "p0", c.name, `Fulfilment ${c.fulfilmentRate}% — customers are being turned away`, `Execute ${c.action}: ${c.rationale}`));
    } else if (c.action !== "hold") {
      findings.push(makeFinding("marketplace", "p2", c.name, c.rationale, `Recommended action: ${c.action} (expected lift ${c.expectedLift})`));
    }
  }

  const score = round(
    clamp(overallFulfilmentRate * 0.5 + clamp(100 - averageEtaMinutes * 6) * 0.2 + averageUtilization * 0.15 + (balancedCells / optimised.length) * 100 * 0.15),
    1,
  );
  return { cells: optimised, overallFulfilmentRate, averageEtaMinutes, averageUtilization, balancedCells, score, grade: grade(score), findings: sortFindings(findings) };
}
