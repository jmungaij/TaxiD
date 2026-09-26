/**
 * Per-segment carbon and operational-risk alerts.
 *
 * Extracted from the RouteMap so the identical alert set can be embedded in the
 * procurement CSV/PDF exports — the map and the downloadable breakdown must
 * never disagree about a mission's risks.
 */
import type { AirportRecord } from "./airportRegistry";
import type { MissionFare } from "./smartFare";

export type AlertKind = "carbon" | "risk";
export type AlertSeverity = "info" | "watch" | "elevated";

export interface SegmentAlert {
  kind: AlertKind;
  severity: AlertSeverity;
  label: string;
  detail: string;
}

export interface MissionSegmentAlerts {
  /** e.g. "WIL → MRE (outbound)" */
  segment: string;
  fromCode: string;
  toCode: string;
  alerts: SegmentAlert[];
}

/** Derive carbon and operational-risk alerts for one plotted leg. */
export function deriveSegmentAlerts(
  to: AirportRecord | null,
  distanceNm: number,
  carbonKg: number,
): SegmentAlert[] {
  const out: SegmentAlert[] = [];
  const intensity = distanceNm > 0 ? carbonKg / distanceNm : 0;
  out.push({
    kind: "carbon",
    severity: intensity > 12 ? "elevated" : intensity > 7 ? "watch" : "info",
    label: `${Math.round(intensity * 10) / 10} kg CO₂e / nm`,
    detail: intensity > 7
      ? "Carbon intensity above the fleet median — a turboprop or shared mission cuts emissions materially."
      : "Carbon intensity within the efficient band for this mission profile.",
  });
  if (to && !to.nightOps) {
    out.push({ kind: "risk", severity: "watch", label: "Daylight-only airfield", detail: `${to.name} has no night operations approval — departure must allow a daylight arrival.` });
  }
  if (to && !to.fuel) {
    out.push({ kind: "risk", severity: "watch", label: "No fuel uplift", detail: `No fuel at ${to.code} — the mission must carry return fuel or plan a tech stop.` });
  }
  if (to?.runwayM && to.runwayM < 1200) {
    out.push({ kind: "risk", severity: "elevated", label: `Short field ${to.runwayM} m`, detail: "Performance-limited runway: payload or fuel may be restricted on departure." });
  }
  if (to && !to.customs) {
    out.push({ kind: "risk", severity: "info", label: "Domestic clearance only", detail: `${to.code} has no customs & immigration — international missions must clear elsewhere.` });
  }
  return out;
}

/**
 * Alerts for every leg of a computed mission. Round trips produce an outbound
 * and a return segment; carbon is apportioned evenly across the legs.
 */
export function missionSegmentAlerts(fare: MissionFare): MissionSegmentAlerts[] {
  const legs = fare.sectors === 2 ? 2 : 1;
  const perLegCarbon = legs > 0 ? fare.carbonKg / legs : fare.carbonKg;
  const out: MissionSegmentAlerts[] = [];
  const label = (a: AirportRecord | null) => a?.code ?? "—";

  out.push({
    segment: `${label(fare.from)} → ${label(fare.to)}${legs === 2 ? " (outbound)" : ""}`,
    fromCode: label(fare.from),
    toCode: label(fare.to),
    alerts: deriveSegmentAlerts(fare.to, fare.distanceNm, perLegCarbon),
  });
  if (legs === 2) {
    out.push({
      segment: `${label(fare.to)} → ${label(fare.from)} (return)`,
      fromCode: label(fare.to),
      toCode: label(fare.from),
      alerts: deriveSegmentAlerts(fare.from, fare.distanceNm, perLegCarbon),
    });
  }
  return out;
}

/** Highest severity present across every segment. */
export function worstSeverity(groups: MissionSegmentAlerts[]): AlertSeverity {
  const rank: Record<AlertSeverity, number> = { info: 0, watch: 1, elevated: 2 };
  let worst: AlertSeverity = "info";
  for (const g of groups) for (const a of g.alerts) if (rank[a.severity] > rank[worst]) worst = a.severity;
  return worst;
}
