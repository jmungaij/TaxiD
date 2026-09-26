/**
 * Phase 5 — Cross-agent routing for demand shortages.
 *
 * A liquidity gap is never only a marketplace problem: supply acquisition costs
 * money and unserved demand costs revenue, so the marketplace and revenue
 * agents must both answer before an authority decides. This module runs the
 * marketplace coordination and then attaches an explicit revenue impact
 * analysis and a supply acquisition route, each labelled with what quantifies
 * it — or reported as unquantified when no table can.
 */
import { orchestrate, type OrchestrationRun } from "@/lib/staff/phase4/orchestrator";
import type { Coverage } from "@/lib/staff/phase2/readiness";
import type { Epistemic } from "@/lib/staff/phase4/contextFabric";
import type { Correlated } from "./correlation";

export interface SupplyLever {
  key: string;
  label: string;
  /** Speed to effect. */
  horizon: "immediate" | "days" | "weeks";
  cost: "none" | "incentive" | "acquisition";
  quantifiedBy: string | null;
  note: string;
}

export const SUPPLY_LEVERS: readonly SupplyLever[] = [
  { key: "reallocate", label: "Reallocate approved idle supply", horizon: "immediate", cost: "none", quantifiedBy: "charter_inventory", note: "Uses already-verified operators; no onboarding risk." },
  { key: "incentivise", label: "Incentivise existing partners into the segment", horizon: "days", cost: "incentive", quantifiedBy: "charter_inventory", note: "Spend must be approved; ROI measured against incremental completed supply." },
  { key: "acquire", label: "Open a partner acquisition list and outreach tasks", horizon: "weeks", cost: "acquisition", quantifiedBy: "charter_partner_applications", note: "Adds durable capacity; onboarding and compliance time applies." },
  { key: "constrain", label: "Constrain demand intake for the segment", horizon: "immediate", cost: "none", quantifiedBy: "charter_bookings", note: "Protects SLA at the price of forgone revenue." },
];

export interface RevenueImpact
{
  statement: string;
  /** Table that would quantify the exposure, or null. */
  quantifiedBy: string | null;
  quantified: boolean;
  epistemic: Epistemic;
}

export interface ShortageRoute {
  run: OrchestrationRun | null;
  /** Revenue agent's contribution to the marketplace decision. */
  revenue: RevenueImpact[];
  levers: SupplyLever[];
  /** Levers whose consequence cannot be quantified from readable data. */
  unquantifiedLevers: SupplyLever[];
  /** Agents that actually contributed evidence to this route. */
  contributors: string[];
  /** Statement of what the route could not establish. */
  withheld: string[];
}

/**
 * Route a marketplace liquidity gap through marketplace supply acquisition and
 * revenue impact analysis in one governed pass.
 */
export function routeSupplyShortage(
  correlation: Correlated,
  roles: readonly string[],
  coverage: Coverage,
): ShortageRoute {
  const readable = (t: string | null) => !!t && !!coverage[t] && coverage[t].rows !== null;
  const run = orchestrate(correlation.situation.coordination, roles, coverage);
  const withheld: string[] = [];

  const revenue: RevenueImpact[] = [
    { statement: "Revenue exposed by demand that cannot be fulfilled in the affected segment", quantifiedBy: "charter_bookings", quantified: readable("charter_bookings"), epistemic: "inference" },
    { statement: "Recurring corporate revenue attached to accounts served by the segment", quantifiedBy: "corporate_invoices", quantified: readable("corporate_invoices"), epistemic: "fact" },
    { statement: "Margin effect of incentive or acquisition spend required to close the gap", quantifiedBy: null, quantified: false, epistemic: "simulation" },
  ];
  for (const r of revenue) if (!r.quantified) {
    withheld.push(r.quantifiedBy
      ? `Revenue analysis incomplete — ${r.quantifiedBy} is not readable for this identity`
      : "Margin effect of supply spend has no system of record — MODELLED only");
  }

  const levers = SUPPLY_LEVERS.filter((l) => readable(l.quantifiedBy));
  const unquantifiedLevers = SUPPLY_LEVERS.filter((l) => !readable(l.quantifiedBy));
  for (const l of unquantifiedLevers) {
    withheld.push(`Lever "${l.label}" cannot be quantified${l.quantifiedBy ? ` — ${l.quantifiedBy} unreadable` : " — no source"}`);
  }

  const contributors = ["marketplace", "revenue", ...(run?.answerable.map((a) => a.agent) ?? [])]
    .filter((v, i, arr) => arr.indexOf(v) === i);

  return { run, revenue, levers, unquantifiedLevers, contributors, withheld };
}
