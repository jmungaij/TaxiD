/**
 * Translates raw Postgres / PostgREST / edge-function errors into precise,
 * operator-readable reasons. Used by the charter surfaces so a failed status
 * update explains *exactly* what the database rejected instead of a generic
 * "Update failed".
 */

export interface DbFailure {
  /** Short human title for the toast. */
  title: string;
  /** Precise reason, including the offending constraint/policy when known. */
  reason: string;
  /** Machine kind, useful for tests and monitoring. */
  kind: "check_constraint" | "rls" | "foreign_key" | "unique" | "not_null" | "transition" | "permission" | "unknown";
  /** Whether refreshing and retrying may succeed. */
  retryable: boolean;
}

const constraintName = (raw: string) => raw.match(/"([a-z0-9_]+_(?:check|fkey|key|policy))"/i)?.[1] ?? null;

export function describeDbError(input: unknown): DbFailure {
  const raw = input instanceof Error ? input.message : String(input ?? "");
  const lower = raw.toLowerCase();

  if (lower.includes("row-level security")) {
    return {
      title: "Blocked by access policy",
      reason: `A row-level security policy rejected this write${
        constraintName(raw) ? ` (${constraintName(raw)})` : ""
      }. Your account may not have the required role, or the record belongs to another user. Raw reason: ${raw}`,
      kind: "rls",
      retryable: false,
    };
  }
  if (lower.includes("violates check constraint")) {
    const name = constraintName(raw);
    return {
      title: "Rejected by database rule",
      reason: `The value is not allowed by ${name ?? "a check constraint"}. Raw reason: ${raw}`,
      kind: "check_constraint",
      retryable: false,
    };
  }
  if (lower.includes("foreign key")) {
    return { title: "Related record missing", reason: raw, kind: "foreign_key", retryable: false };
  }
  if (lower.includes("duplicate key")) {
    return { title: "Already recorded", reason: raw, kind: "unique", retryable: false };
  }
  if (lower.includes("null value in column")) {
    return { title: "Missing required value", reason: raw, kind: "not_null", retryable: false };
  }
  if (lower.includes("invalid_transition") || lower.includes("cannot move a")) {
    return { title: "Invalid status change", reason: raw, kind: "transition", retryable: true };
  }
  if (lower.includes("forbidden") || lower.includes("authentication_required")) {
    return {
      title: "Not permitted",
      reason: "Operator or admin role required for this action. Sign in with the right role and try again.",
      kind: "permission",
      retryable: false,
    };
  }
  return { title: "Update failed", reason: raw || "Unknown error", kind: "unknown", retryable: true };
}
