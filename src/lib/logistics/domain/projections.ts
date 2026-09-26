/**
 * PHASE 1 (tracking / exception reconciliation) — READ PROJECTIONS.
 *
 * Law of direction:
 *
 *   AUTHORITATIVE EVENT / STATE  →  PROJECTION  →  CUSTOMER UI / ADMIN UI / API
 *
 * Never:
 *
 *   CUSTOMER UI → projection → shipment state
 *
 * A projection is therefore declared as a VIEW with no INSERT/UPDATE/DELETE
 * grant to any role. It can never become a second competing source of truth.
 */

export type ProjectionKind = "TRACKING" | "EXCEPTION";

export interface ProjectionSpec {
  name: string;
  kind: ProjectionKind;
  /** Authoritative store the projection reads from. */
  sourceOfTruth: string;
  materialised: boolean;
  writable: false;
  grants: string[];
  /** Roles allowed to read; anon reads only redacted tracking. */
  readableBy: string[];
  redactedFields: string[];
  refresh: "LIVE_VIEW" | "TRIGGERED_REFRESH";
}

export const PROJECTIONS: ProjectionSpec[] = [
  {
    name: "v_logistics_tracking_events",
    kind: "TRACKING",
    sourceOfTruth: "logistics_events (append-only)",
    materialised: false,
    writable: false,
    grants: ["SELECT TO authenticated", "SELECT TO anon (tracking-number scoped, redacted)"],
    readableBy: ["anon(tracking_number)", "customer", "corporate_user", "ops", "support", "admin"],
    redactedFields: ["actor_id", "courier_id", "partner_id", "internal_notes", "gps_precision_below_100m"],
    refresh: "LIVE_VIEW",
  },
  {
    name: "v_logistics_exceptions",
    kind: "EXCEPTION",
    sourceOfTruth: "logistics_events (failure events with structured reason codes)",
    materialised: false,
    writable: false,
    grants: ["SELECT TO authenticated"],
    readableBy: ["ops", "support", "compliance", "finance", "admin"],
    redactedFields: [],
    refresh: "LIVE_VIEW",
  },
];

export interface ProjectionAudit {
  status: "PASS" | "FAIL";
  violations: string[];
  projections: number;
}

/** A projection with any write grant, or without a declared source of truth, fails. */
export function auditProjections(specs: ProjectionSpec[] = PROJECTIONS): ProjectionAudit {
  const violations: string[] = [];
  for (const p of specs) {
    if (!p.sourceOfTruth) violations.push(`${p.name}: no declared source of truth`);
    const writeGrant = p.grants.find((g) => /INSERT|UPDATE|DELETE|ALL/i.test(g));
    if (writeGrant) violations.push(`${p.name}: write grant "${writeGrant}" would create a second source of truth`);
    if (p.kind === "TRACKING" && p.readableBy.some((r) => r.startsWith("anon")) && p.redactedFields.length === 0) {
      violations.push(`${p.name}: anon-readable tracking must redact operational identities`);
    }
  }
  return { status: violations.length === 0 ? "PASS" : "FAIL", violations, projections: specs.length };
}

/** Guard for any code path that tries to write through a projection. */
export function assertProjectionWriteRejected(target: string): { rejected: boolean; error: string } {
  const isProjection = PROJECTIONS.some((p) => p.name === target);
  return {
    rejected: isProjection,
    error: isProjection
      ? `projection_write_forbidden: ${target} is a read projection; write to the authoritative aggregate via its RPC`
      : "",
  };
}
