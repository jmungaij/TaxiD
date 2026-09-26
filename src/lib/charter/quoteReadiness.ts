/**
 * Quote readiness — the single explanation shown when SmartFare is locked.
 *
 * Two independent gates must pass before a binding quote may be issued:
 *   1. the operator rate card is complete (delegated to `validateRateCard`),
 *   2. the selected mission route is actually operable and confirmed.
 *
 * This module joins both so the UI, the exports and the audit trail all state
 * the identical block reason.
 */
import { validateFare, type RateCardValidation } from "./rateCardValidation";
import type { MissionFare } from "./smartFare";

export type CheckStatus = "pass" | "warn" | "fail";

export interface RouteCheck {
  key: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface QuoteReadiness {
  validation: RateCardValidation;
  routeChecks: RouteCheck[];
  failedRouteChecks: RouteCheck[];
  /** Rate card components still outstanding. */
  missingComponents: { key: string; label: string; reason: string }[];
  blocked: boolean;
  /** One-line reason suitable for a button caption or toast. */
  blockReason: string;
  /** Full multi-line reason for panels, CSV and PDF. */
  blockDetail: string[];
}

/** Availability / operability checks for the selected mission route. */
export function routeAvailabilityChecks(fare: MissionFare): RouteCheck[] {
  const checks: RouteCheck[] = [];
  const { from, to, aircraft, operator } = fare;

  checks.push(
    from && to
      ? { key: "endpoints", label: "Route endpoints resolved", status: "pass", detail: `${from.code} → ${to.code} resolved in the airfield registry.` }
      : { key: "endpoints", label: "Route endpoints resolved", status: "fail", detail: "One or both airfields could not be resolved, so no route price can be confirmed." },
  );

  const routeScoped = Boolean(operator?.fromCode && operator?.toCode);
  const routeMatch = routeScoped
    && operator?.fromCode === from?.code && operator?.toCode === to?.code;
  checks.push({
    key: "route_scope",
    label: "Operator route coverage",
    status: !operator ? "fail" : routeMatch ? "pass" : "warn",
    detail: !operator
      ? "No operator submission covers this aircraft and route."
      : routeMatch
        ? `${operator.operatorName} submitted a route-scoped card for ${from?.code} → ${to?.code}.`
        : `${operator.operatorName} priced this mission from a fleet-wide card — positioning is estimated.`,
  });

  checks.push({
    key: "availability",
    label: "Availability confirmed for the mission window",
    status: operator?.availabilityConfirmed ? "pass" : "fail",
    detail: operator?.availabilityConfirmed
      ? "The operator has confirmed the asset for the requested window."
      : "The operator has not confirmed the asset for the requested window.",
  });

  checks.push({
    key: "seats",
    label: "Seat capacity",
    status: fare.passengers <= aircraft.seats ? "pass" : "fail",
    detail: fare.passengers <= aircraft.seats
      ? `${fare.passengers} of ${aircraft.seats} seats requested.`
      : `${fare.passengers} passengers exceed the ${aircraft.seats}-seat capacity of the ${aircraft.label}.`,
  });

  if (to) {
    const runwayOk = !to.runwayM || to.runwayM >= (aircraft.runwayM ?? 0);
    checks.push({
      key: "runway",
      label: "Destination performance",
      status: runwayOk ? "pass" : "fail",
      detail: runwayOk
        ? `${to.code} runway ${to.runwayM ?? "n/a"} m is adequate for the ${aircraft.label}.`
        : `${to.code} runway ${to.runwayM} m is below the ${aircraft.label} requirement of ${aircraft.runwayM} m.`,
    });
    checks.push({
      key: "night_ops",
      label: "Night operations",
      status: to.nightOps ? "pass" : "warn",
      detail: to.nightOps
        ? `${to.code} is approved for night operations.`
        : `${to.code} is daylight-only — the schedule must allow a daylight arrival.`,
    });
    checks.push({
      key: "fuel",
      label: "Fuel availability",
      status: to.fuel ? "pass" : "warn",
      detail: to.fuel
        ? `Fuel uplift available at ${to.code}.`
        : `No fuel uplift at ${to.code} — return fuel must be carried or a tech stop planned.`,
    });
  }

  return checks;
}

/** Combined readiness assessment for a computed mission fare. */
export function assessQuoteReadiness(fare: MissionFare, now?: Date): QuoteReadiness {
  const validation = validateFare(fare, now);
  const routeChecks = routeAvailabilityChecks(fare);
  const failedRouteChecks = routeChecks.filter((c) => c.status === "fail");
  const missingComponents = validation.blocking
    .filter((b) => b.key !== "availability" && b.key !== "rate_card")
    .map((b) => ({ key: b.key, label: b.label, reason: b.reason }));

  const blocked = !validation.canFinalise || failedRouteChecks.length > 0;
  const parts: string[] = [];
  if (missingComponents.length) {
    parts.push(`${missingComponents.length} rate card component${missingComponents.length === 1 ? "" : "s"} missing`);
  }
  if (validation.blocking.some((b) => b.key === "rate_card")) parts.push("no operator rate card");
  if (failedRouteChecks.length) {
    parts.push(`${failedRouteChecks.length} route availability check${failedRouteChecks.length === 1 ? "" : "s"} failed`);
  }

  return {
    validation,
    routeChecks,
    failedRouteChecks,
    missingComponents,
    blocked,
    blockReason: blocked
      ? `Binding quote locked — ${parts.join(" · ") || "operator inputs incomplete"}.`
      : "Binding quote eligible.",
    blockDetail: blocked
      ? [
        ...missingComponents.map((m) => `Missing component — ${m.label}: ${m.reason}`),
        ...validation.blocking.filter((b) => b.key === "availability" || b.key === "rate_card")
          .map((b) => `${b.label}: ${b.reason}`),
        ...failedRouteChecks.map((c) => `Route check failed — ${c.label}: ${c.detail}`),
      ]
      : [],
  };
}
