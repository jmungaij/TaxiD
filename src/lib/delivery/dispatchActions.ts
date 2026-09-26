/**
 * One-click AI dispatcher actions.
 *
 * Each recommendation surfaced by the control tower can be executed as a single
 * governed action: the operator sees exactly what will change, the estimated
 * impact, and the action is written to the hash-chained audit trail on confirm.
 * Actions are reversible — reverting appends a compensating audit record rather
 * than deleting history.
 */
import type { DeliveryModule } from "@/components/delivery/ModuleShell";
import { aiRecommendations, moduleObservation, liveMapModel, type AiRecommendation } from "./controlTower";
import { recordAudit, revertAudit, type AuditEntry, type AuditImpact } from "./auditTrail";

export type DispatchActionKind = "consolidate" | "reassign" | "reroute" | "capacity" | "acknowledge";

export interface DispatchActionImpact extends AuditImpact {
  tone: "good" | "warn" | "neutral";
}

export interface DispatchAction {
  kind: DispatchActionKind;
  /** Verb shown on the button, e.g. "Consolidate stops". */
  cta: string;
  title: string;
  summary: string;
  /** Ordered list of what the dispatcher will do on confirm. */
  steps: string[];
  impact: DispatchActionImpact[];
  affected: string;
  reversible: boolean;
  requiresReason: boolean;
}

const kes = (n: number) => `KES ${Math.round(n).toLocaleString("en-KE")}`;

export function actionForRecommendation(module: DeliveryModule, rec: AiRecommendation): DispatchAction {
  const o = moduleObservation(module);
  const map = liveMapModel(module);
  const hottest = [...map.zones].sort((a, b) => b.demandIndex - a.demandIndex)[0];
  const coldest = [...map.zones].sort((a, b) => a.demandIndex - b.demandIndex)[0];

  switch (rec.kind) {
    case "consolidation": {
      const stops = Math.round((o.parcelsAwaiting ?? 0) * 0.11);
      const runs = Math.max(1, Math.round(stops / 4));
      return {
        kind: "consolidate",
        cta: "Consolidate stops",
        title: `Consolidate ${stops} stops into ${runs} multi-stop runs`,
        summary: `Merges awaiting parcels sharing the ${hottest.name} drop corridor into sequenced multi-stop runs, then re-issues manifests to the assigned couriers.`,
        steps: [
          `Group ${stops} awaiting parcels by drop corridor and time window`,
          `Build ${runs} optimised multi-stop runs (max 12 stops per run)`,
          "Re-issue manifests and push updated ETAs to recipients",
          "Release the freed capacity back to the dispatch pool",
        ],
        impact: [
          { label: "Cost avoided today", value: kes(stops * o.costPerParcelKes * 0.28), tone: "good" },
          { label: "Trips removed", value: `${Math.max(0, stops - runs)} duplicate trips`, tone: "good" },
          { label: "CO₂e avoided", value: `${Math.round(stops * 0.42)} kg`, tone: "good" },
          { label: "Recipient ETA shift", value: `+${Math.round(hottest.avgEtaMinutes * 0.05)} min worst case`, tone: "warn" },
        ],
        affected: `${stops} parcels · ${runs} runs · ${hottest.name}`,
        reversible: true,
        requiresReason: false,
      };
    }
    case "reassignment": {
      const units = Math.max(2, Math.round(coldest.couriers * 0.15));
      return {
        kind: "reassign",
        cta: "Reassign drivers",
        title: `Move ${units} drivers from ${coldest.name} to ${hottest.name}`,
        summary: `Rebalances supply toward unmet demand. Only drivers with no active assignment and valid compliance status are moved.`,
        steps: [
          `Select ${units} idle drivers in ${coldest.name} ranked by proximity and acceptance rate`,
          "Verify licence, insurance and inspection validity before offering",
          `Issue relocation offers with incentive to ${hottest.name}`,
          "Recompute ETAs for affected open requests",
        ],
        impact: [
          { label: `ETA in ${hottest.name}`, value: `−${Math.round(hottest.avgEtaMinutes * 0.14)} min`, tone: "good" },
          { label: "Requests covered", value: `${Math.min(hottest.openRequests, units * 4)} additional`, tone: "good" },
          { label: `Coverage in ${coldest.name}`, value: `−${units} drivers`, tone: "warn" },
          { label: "Relocation incentive", value: kes(units * 250), tone: "neutral" },
        ],
        affected: `${units} drivers · ${coldest.name} → ${hottest.name}`,
        reversible: true,
        requiresReason: false,
      };
    }
    case "route":
    case "weather":
    case "risk": {
      const saved = Math.max(4, Math.round((o.avgDeliveryMinutes ?? 60) * 0.12));
      const atRisk = Math.round((o.parcelsInTransit ?? 0) * 0.06);
      return {
        kind: "reroute",
        cta: "Re-route around risk",
        title: `Re-route ${map.routes.length} corridors around the active risk`,
        summary: `Re-sequences active corridors away from the congestion, weather and incident hotspots detected by the prediction engine, and notifies affected recipients of the new ETA.`,
        steps: [
          "Recompute corridor geometry with the current traffic, weather and incident layers",
          "Exclude two-wheel assignments from high-risk segments",
          `Push new ETAs to ${atRisk} at-risk consignments`,
          "Flag any consignment whose SLA still breaches for manual intervention",
        ],
        impact: [
          { label: "Drive time recovered", value: `${saved} min`, tone: "good" },
          { label: "SLA slips prevented", value: `${atRisk} consignments`, tone: "good" },
          { label: "Additional distance", value: `${Math.round(saved * 0.4)} km`, tone: "warn" },
          { label: "Fuel impact", value: kes(saved * 0.4 * 24), tone: "warn" },
        ],
        affected: `${map.routes.length} corridors · ${atRisk} consignments`,
        reversible: true,
        requiresReason: true,
      };
    }
    case "capacity": {
      return {
        kind: "capacity",
        cta: "Open surge capacity",
        title: "Release standby capacity into the next dispatch window",
        summary: "Activates the standby driver pool and partner marketplace capacity to absorb the forecast shortfall.",
        steps: [
          "Notify standby drivers with the shortfall window and incentive",
          "Open partner marketplace bidding for overflow volume",
          "Cap surge multiplier at the governed ceiling",
          "Re-run the capacity forecast after acceptance",
        ],
        impact: [
          { label: "Capacity added", value: `${Math.round((o.vehiclesTotal ?? 0) * 0.08)} units`, tone: "good" },
          { label: "Unmet demand cleared", value: "up to 100%", tone: "good" },
          { label: "Incentive cost", value: kes((o.vehiclesTotal ?? 0) * 0.08 * 900), tone: "warn" },
        ],
        affected: "Standby pool · partner marketplace",
        reversible: true,
        requiresReason: false,
      };
    }
    default:
      return {
        kind: "acknowledge",
        cta: "Acknowledge signal",
        title: rec.title,
        summary: rec.detail,
        steps: ["Record operator acknowledgement against the signal", "Keep the signal visible until it clears"],
        impact: [{ label: "Estimated effect", value: rec.impact, tone: "neutral" }],
        affected: rec.kind,
        reversible: true,
        requiresReason: false,
      };
  }
}

export interface DispatchActionPlan {
  recommendation: AiRecommendation;
  action: DispatchAction;
}

export function dispatchActionPlans(module: DeliveryModule): DispatchActionPlan[] {
  return aiRecommendations(module).map((recommendation) => ({
    recommendation,
    action: actionForRecommendation(module, recommendation),
  }));
}

export function applyDispatchAction(
  module: DeliveryModule,
  plan: DispatchActionPlan,
  actor: string,
  reason?: string,
): AuditEntry {
  return recordAudit({
    domain: "dispatch",
    module,
    action: plan.action.cta,
    subject: plan.action.title,
    actor,
    reason,
    impact: plan.action.impact.map(({ label, value }) => ({ label, value })),
  });
}

export function revertDispatchAction(entryId: string, actor: string, reason?: string): AuditEntry | null {
  return revertAudit(entryId, actor, reason);
}
