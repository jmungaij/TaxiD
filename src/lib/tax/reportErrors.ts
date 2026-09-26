/**
 * Tax report error classification.
 *
 * Turns raw Postgres / PostgREST failures into an operator-readable reason so the
 * Tax Command Center never renders a blank screen with a generic "Failed" toast.
 */

export type TaxErrorKind =
  | "permission"
  | "constraint"
  | "missing_function"
  | "missing_column"
  | "schema_drift"
  | "invalid_range"
  | "network"
  | "unknown";

/** Kinds that mean the deployed backend no longer matches the reporting contract. */
export const SCHEMA_DRIFT_KINDS: TaxErrorKind[] = [
  "missing_function",
  "missing_column",
  "schema_drift",
];

export const isSchemaDrift = (kind: TaxErrorKind): boolean =>
  SCHEMA_DRIFT_KINDS.includes(kind);

export type TaxLoadFailure = {
  kind: TaxErrorKind;
  title: string;
  /** The real upstream reason, verbatim where useful. */
  reason: string;
  /** What the operator can do about it. */
  hint: string;
  code?: string;
  retryable: boolean;
};

const text = (e: unknown): string => {
  if (!e) return "";
  if (typeof e === "string") return e;
  const any = e as Record<string, unknown>;
  return [any.message, any.details, any.hint].filter(Boolean).join(" · ");
};

export function classifyTaxError(error: unknown): TaxLoadFailure {
  const raw = text(error) || "Unknown error";
  const code = (error as { code?: string } | null)?.code;
  const lower = raw.toLowerCase();

  if (lower.includes("tax_reports_forbidden") || lower.includes("forbidden")) {
    return {
      kind: "permission",
      title: "Access denied by the tax reporting policy",
      reason: raw,
      hint: "Your account needs a finance or admin role (finance admin, corporate admin/manager, operations, compliance or platform admin). Ask a super admin to grant the role, then retry.",
      code,
      retryable: true,
    };
  }

  if (lower.includes("permission denied for function")) {
    const fn = /permission denied for function ([a-z0-9_.]+)/i.exec(raw)?.[1];
    return {
      kind: "permission",
      title: "Database permission missing",
      reason: raw,
      hint: fn
        ? `The report function ${fn} is not executable by your role. A backend grant is required.`
        : "The report function is not executable by your role. A backend grant is required.",
      code,
      retryable: true,
    };
  }

  if (lower.includes("permission denied") || code === "42501") {
    return {
      kind: "permission",
      title: "Permission denied",
      reason: raw,
      hint: "Access rules blocked this read. Confirm your role assignment and retry.",
      code,
      retryable: true,
    };
  }

  if (lower.includes("violates check constraint") || lower.includes("constraint")) {
    const c = /constraint "([^"]+)"/.exec(raw)?.[1];
    return {
      kind: "constraint",
      title: "Data rejected by a database rule",
      reason: raw,
      hint: c
        ? `The rule ${c} rejected this record. The underlying data must be corrected before this report can load.`
        : "A database validation rule rejected this record. The underlying data must be corrected.",
      code,
      retryable: false,
    };
  }

  if (code === "42703" || /column\s+"?[a-z0-9_.]+"?\s+does not exist/i.test(raw)) {
    const col = /column\s+"?([a-z0-9_."]+)"?\s+does not exist/i.exec(raw)?.[1]?.replace(/"/g, "");
    return {
      kind: "missing_column",
      title: "Reporting schema is out of date",
      reason: raw,
      hint: col
        ? `The reporting function references ${col}, which no longer exists in the database. A backend migration must be applied before this report can load.`
        : "The reporting function references a column that no longer exists. A backend migration must be applied before this report can load.",
      code,
      retryable: false,
    };
  }

  if (
    lower.includes("could not find the function") ||
    lower.includes("does not exist") ||
    code === "42883" ||
    code === "PGRST202"
  ) {
    return {
      kind: "missing_function",
      title: "Report endpoint unavailable",
      reason: raw,
      hint: "The reporting function is missing or its signature changed. A backend migration is required.",
      code,
      retryable: false,
    };
  }

  if (lower.includes("invalid_range") || lower.includes("invalid range")) {
    return {
      kind: "invalid_range",
      title: "Invalid reporting window",
      reason: raw,
      hint: "Pick a From date earlier than the To date and retry.",
      code,
      retryable: true,
    };
  }

  if (lower.includes("failed to fetch") || lower.includes("network") || lower.includes("timeout")) {
    return {
      kind: "network",
      title: "Could not reach the reporting service",
      reason: raw,
      hint: "The backend did not respond. Check connectivity and retry.",
      code,
      retryable: true,
    };
  }

  return {
    kind: "unknown",
    title: "Report failed to load",
    reason: raw,
    hint: "Retry the load. If it keeps failing, share the reason below with the platform team.",
    code,
    retryable: true,
  };
}
