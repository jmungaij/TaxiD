/**
 * Commercial intelligence — deterministic read service.
 *
 * Reads the commercial lifecycle register under RLS and returns claims only.
 * The revenue law is enforced here: opportunity value is an ESTIMATE of
 * potential and is never labelled revenue; only recognised and collected states
 * produce revenue FACTs.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  emptyReading,
  kes,
  newestTimestamp,
  type Claim,
  type DomainReading,
} from "../contract";

export const COMMERCIAL_PERMISSION = "staff.commercial.read";

interface LifecycleRow {
  current_state: string | null;
  opportunity_value_kes: number | null;
  contracted_value_kes: number | null;
  recognised_value_kes: number | null;
  collected_value_kes: number | null;
  updated_at: string | null;
}

const sum = (rows: LifecycleRow[], key: keyof LifecycleRow) =>
  rows.reduce((total, row) => total + (Number(row[key] ?? 0) || 0), 0);

export async function readCommercial(authorised: boolean): Promise<DomainReading> {
  if (!authorised) {
    return emptyReading("commercial", COMMERCIAL_PERMISSION, "commercial read permission not held", false);
  }

  const { data, error } = await supabase
    .from("commercial_lifecycle")
    .select("current_state,opportunity_value_kes,contracted_value_kes,recognised_value_kes,collected_value_kes,updated_at")
    .eq("is_test", false)
    .limit(1000);

  if (error) {
    return emptyReading("commercial", COMMERCIAL_PERMISSION, `commercial register unreadable: ${error.message}`);
  }

  const rows = (data ?? []) as LifecycleRow[];
  if (rows.length === 0) {
    return emptyReading("commercial", COMMERCIAL_PERMISSION, "no non-test lifecycle records inside your scope");
  }

  const freshestAt = newestTimestamp(rows.map((r) => r.updated_at));
  const byState = new Map<string, number>();
  for (const row of rows) {
    const state = row.current_state ?? "UNKNOWN";
    byState.set(state, (byState.get(state) ?? 0) + 1);
  }
  const stateEvidence = [...byState.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([state, count]) => ({ label: `${count} record(s) in ${state}`, path: "/staff/workspace/book" }));

  const contracted = sum(rows, "contracted_value_kes");
  const recognised = sum(rows, "recognised_value_kes");
  const collected = sum(rows, "collected_value_kes");
  const potential = sum(rows, "opportunity_value_kes");

  const claims: Claim[] = [
    {
      id: "commercial.records",
      label: "Live commercial records",
      value: `${rows.length}`,
      numeric: rows.length,
      classification: "FACT",
      source: "commercial_lifecycle",
      observedAt: freshestAt,
      confidence: 100,
      evidence: stateEvidence.slice(0, 6),
    },
    {
      id: "commercial.contracted",
      label: "Contracted value",
      value: kes(contracted),
      numeric: contracted,
      classification: "FACT",
      source: "commercial_lifecycle.contracted_value_kes",
      observedAt: freshestAt,
      confidence: 95,
      evidence: [{ label: "Sum of contracted value on non-test lifecycle records", path: "/staff/workspace/contracts" }],
    },
    {
      id: "commercial.recognised",
      label: "Recognised revenue",
      value: kes(recognised),
      numeric: recognised,
      classification: "FACT",
      source: "commercial_lifecycle.recognised_value_kes",
      observedAt: freshestAt,
      confidence: 95,
      evidence: [{ label: "Recognised state only — won deals are excluded", path: "/staff/closure" }],
    },
    {
      id: "commercial.collected",
      label: "Collected cash",
      value: kes(collected),
      numeric: collected,
      classification: "FACT",
      source: "commercial_lifecycle.collected_value_kes",
      observedAt: freshestAt,
      confidence: 95,
      evidence: [{ label: "Collected state on the lifecycle register", path: "/staff/commercial/collections" }],
    },
  ];

  if (potential > 0) {
    claims.push({
      id: "commercial.potential",
      label: "Open pipeline potential (not revenue)",
      value: kes(potential),
      numeric: potential,
      classification: "ESTIMATE",
      source: "commercial_lifecycle.opportunity_value_kes",
      observedAt: freshestAt,
      confidence: 60,
      assumptions: [
        "Opportunity value is what the deal would be worth if it closed at the stated figure.",
        "It is potential, not revenue: nothing counts as revenue before the recognised state.",
      ],
      evidence: [{ label: "Opportunity values on open lifecycle records", path: "/staff/workspace/opportunities" }],
    });
  }

  return {
    domain: "commercial",
    permission: COMMERCIAL_PERMISSION,
    authorised: true,
    claims,
    freshestAt,
    rowsInspected: rows.length,
  };
}
