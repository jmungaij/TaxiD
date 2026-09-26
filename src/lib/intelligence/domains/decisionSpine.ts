/**
 * Decision spine read service.
 *
 * The recommendation, finding and policy tables already exist and are written
 * only by the orchestration worker. This service reads them so an answer can
 * carry the platform's own next best actions instead of inventing advice.
 */
import { supabase } from "@/integrations/supabase/client";
import { emptyReading, newestTimestamp, type Claim, type DomainReading } from "../contract";

export const SPINE_PERMISSION = "staff.commercial.read";

interface RecommendationRow {
  id: string;
  recommendation_type: string | null;
  priority: string | null;
  observation: string | null;
  status: string | null;
  confidence: number | null;
  requires_approval: boolean | null;
  entity_ref: string | null;
  created_at: string | null;
  grounded: boolean | null;
}

export interface SpineAction {
  id: string;
  title: string;
  priority: string;
  requiresApproval: boolean;
  grounded: boolean;
  confidence?: number;
}

export interface SpineReading extends DomainReading {
  actions: SpineAction[];
}

export async function readDecisionSpine(authorised: boolean): Promise<SpineReading> {
  const base = (reason?: string, ok = true): SpineReading => ({
    ...emptyReading("decision_spine", SPINE_PERMISSION, reason, ok),
    actions: [],
  });

  if (!authorised) return base("decision spine read permission not held", false);

  const { data, error } = await supabase
    .from("ai_recommendations")
    .select("id,recommendation_type,priority,observation,status,confidence,requires_approval,entity_ref,created_at,grounded")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) return base(`decision spine unreadable: ${error.message}`);

  const rows = (data ?? []) as RecommendationRow[];
  const open = rows.filter((r) => (r.status ?? "").toUpperCase() !== "CLOSED" && (r.status ?? "").toUpperCase() !== "REJECTED");
  if (rows.length === 0) return base("the decision spine holds no recommendations inside your scope");

  const freshestAt = newestTimestamp(rows.map((r) => r.created_at));
  const grounded = open.filter((r) => r.grounded === true);
  const awaitingApproval = open.filter((r) => r.requires_approval === true);

  const claims: Claim[] = [
    {
      id: "spine.open_recommendations",
      label: "Open recommendations on the decision spine",
      value: `${open.length}`,
      numeric: open.length,
      classification: "FACT",
      source: "ai_recommendations",
      observedAt: freshestAt,
      confidence: 100,
      evidence: [
        { label: `${grounded.length} grounded in an evidence snapshot`, path: "/staff/agentic" },
        { label: `${awaitingApproval.length} require human authorisation before execution`, path: "/staff/agentic" },
      ],
    },
  ];

  for (const row of open.slice(0, 3)) {
    claims.push({
      id: `spine.recommendation.${row.id}`,
      label: row.recommendation_type ?? "Recommended action",
      value: row.observation ?? "Recorded on the decision spine",
      classification: "RECOMMENDATION",
      source: "ai_recommendations",
      observedAt: row.created_at ?? undefined,
      confidence: row.confidence != null ? Math.round(Number(row.confidence) * (Number(row.confidence) <= 1 ? 100 : 1)) : undefined,
      evidence: [
        {
          label: row.grounded ? "Grounded in a hashed evidence snapshot" : "Not yet grounded — treat as a lead, not a conclusion",
          path: "/staff/agentic",
          detail: row.entity_ref ?? undefined,
        },
      ],
    });
  }

  return {
    domain: "decision_spine",
    permission: SPINE_PERMISSION,
    authorised: true,
    claims,
    freshestAt,
    rowsInspected: rows.length,
    actions: open.slice(0, 6).map((row) => ({
      id: row.id,
      title: row.observation ?? row.recommendation_type ?? "Recommended action",
      priority: row.priority ?? "medium",
      requiresApproval: row.requires_approval === true,
      grounded: row.grounded === true,
      confidence: row.confidence != null ? Number(row.confidence) : undefined,
    })),
  };
}
