/**
 * Workforce intelligence — deterministic read service.
 *
 * Reads the canonical objective performance projection. Scores are computed by
 * the database view, not here, so a person's performance can never be restated
 * by the intelligence layer.
 */
import { supabase } from "@/integrations/supabase/client";
import { emptyReading, newestTimestamp, type Claim, type DomainReading } from "../contract";

export const WORKFORCE_PERMISSION = "staff.people.read";

interface ObjectiveRow {
  owner_name: string | null;
  kpi_label: string | null;
  achievement_pct: number | null;
  expected_pct: number | null;
  computed_status: string | null;
  critical_breach: boolean | null;
  actual_recorded_at: string | null;
}

export async function readWorkforce(authorised: boolean): Promise<DomainReading> {
  if (!authorised) {
    return emptyReading("workforce", WORKFORCE_PERMISSION, "people read permission not held", false);
  }

  const { data, error } = await supabase
    .from("v_objective_performance")
    .select("owner_name,kpi_label,achievement_pct,expected_pct,computed_status,critical_breach,actual_recorded_at")
    .limit(1000);

  if (error) {
    return emptyReading("workforce", WORKFORCE_PERMISSION, `performance projection unreadable: ${error.message}`);
  }

  const rows = (data ?? []) as ObjectiveRow[];
  if (rows.length === 0) {
    return emptyReading("workforce", WORKFORCE_PERMISSION, "no objectives inside your scope");
  }

  const freshestAt = newestTimestamp(rows.map((r) => r.actual_recorded_at));
  const scored = rows.filter((r) => typeof r.achievement_pct === "number");
  const behind = scored.filter((r) => (r.achievement_pct ?? 0) < (r.expected_pct ?? 0));
  const breaches = rows.filter((r) => r.critical_breach === true);
  const average = scored.length
    ? scored.reduce((s, r) => s + (r.achievement_pct ?? 0), 0) / scored.length
    : undefined;

  const claims: Claim[] = [
    {
      id: "workforce.objectives",
      label: "Objectives being measured",
      value: `${rows.length}`,
      numeric: rows.length,
      classification: "FACT",
      source: "v_objective_performance",
      observedAt: freshestAt,
      confidence: 100,
      evidence: [{ label: `${scored.length} with a recorded actual`, path: "/staff/org/objectives" }],
    },
    {
      id: "workforce.behind_plan",
      label: "Objectives behind their expected pace",
      value: `${behind.length}`,
      numeric: behind.length,
      classification: "FACT",
      source: "v_objective_performance.achievement_pct vs expected_pct",
      observedAt: freshestAt,
      confidence: 90,
      evidence: behind.slice(0, 5).map((r) => ({
        label: `${r.owner_name ?? "Unassigned"} — ${r.kpi_label ?? "objective"} at ${Math.round(r.achievement_pct ?? 0)}%`,
        path: "/staff/org/performance",
      })),
    },
    {
      id: "workforce.critical_breaches",
      label: "Critical objective breaches",
      value: `${breaches.length}`,
      numeric: breaches.length,
      classification: "FACT",
      source: "v_objective_performance.critical_breach",
      observedAt: freshestAt,
      confidence: 100,
      evidence: [{ label: "Computed by the objective performance projection", path: "/staff/org/performance" }],
    },
  ];

  if (average !== undefined) {
    claims.push({
      id: "workforce.average_attainment",
      label: "Average attainment across measured objectives",
      value: `${Math.round(average)}%`,
      numeric: Math.round(average),
      classification: "ESTIMATE",
      source: "v_objective_performance (unweighted mean of achievement_pct)",
      observedAt: freshestAt,
      confidence: 65,
      assumptions: [
        "Every measured objective is treated equally; objective weights are not applied to this mean.",
        "Objectives without a recorded actual are excluded.",
      ],
      evidence: [{ label: `${scored.length} objective(s) contributed`, path: "/staff/org/performance" }],
    });
  }

  return {
    domain: "workforce",
    permission: WORKFORCE_PERMISSION,
    authorised: true,
    claims,
    freshestAt,
    rowsInspected: rows.length,
  };
}
