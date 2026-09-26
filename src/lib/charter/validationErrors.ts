/**
 * Turns charter-api `validation_failed` responses into field-level guidance.
 *
 * The edge function returns human-readable sentences plus a `debug` block
 * describing the decision inputs (sector, passengers supplied, contact
 * completeness). Booking surfaces use this module to show the traveller which
 * field is blocking payment and exactly how to fix it, instead of a single
 * opaque toast.
 */
import { CharterApiError } from "./api";

/** Booking fields a payment validation error can point at. */
export type CharterBlockedField =
  | "contact.name"
  | "contact.email"
  | "contact.phone"
  | "passengers"
  | "seats"
  | "trip.origin"
  | "trip.destination"
  | "ground"
  | "unknown";

export interface CharterFieldIssue {
  field: CharterBlockedField;
  /** The server sentence, verbatim, so support and UI never diverge. */
  message: string;
  /** What the user should do next. */
  fix: string;
  /** Human label of the field for headings and aria descriptions. */
  label: string;
}

const RULES: Array<{ test: RegExp; field: CharterBlockedField; label: string; fix: string }> = [
  {
    test: /contact name/i,
    field: "contact.name",
    label: "Booking contact name",
    fix: "Enter the full name of the person responsible for this mission.",
  },
  {
    test: /contact email|valid.*email/i,
    field: "contact.email",
    label: "Booking contact email",
    fix: "Use a deliverable address (a corporate domain is preferred) — the invoice and itinerary are sent there.",
  },
  {
    test: /phone/i,
    field: "contact.phone",
    label: "Booking contact phone",
    fix: "Add a reachable phone number in international format, e.g. +254712345678.",
  },
  {
    test: /passenger|manifest|traveller|date of birth|passport|nationality/i,
    field: "passengers",
    label: "Passenger manifest",
    fix: "Complete the manifest rows for this sector — aviation sectors require full traveller identity details.",
  },
  {
    test: /seat/i,
    field: "seats",
    label: "Cabin seating",
    fix: "Assign a seat to every named passenger in the cabin layout.",
  },
  {
    test: /pickup|origin/i,
    field: "trip.origin",
    label: "Pickup location",
    fix: "Set a pickup location for every leg of the mission.",
  },
  {
    test: /drop-?off|destination/i,
    field: "trip.destination",
    label: "Drop-off location",
    fix: "Set a drop-off location for every leg of the mission.",
  },
  {
    test: /ground/i,
    field: "ground",
    label: "Ground transport package",
    fix: "Re-check the ground transport legs — the declared total no longer matches the selected services.",
  },
];

/** Classifies one server message into a field plus a remediation hint. */
export function classifyCharterIssue(message: string): CharterFieldIssue {
  const rule = RULES.find((r) => r.test.test(message));
  if (!rule) {
    return {
      field: "unknown",
      message,
      label: "Booking details",
      fix: "Review the highlighted step and resubmit. Contact operations if this persists.",
    };
  }
  return { field: rule.field, message, label: rule.label, fix: rule.fix };
}

export interface CharterValidationReport {
  issues: CharterFieldIssue[];
  /** Sector the server actually validated against. */
  sector: string | null;
  /** Whether the server demanded a passenger manifest. */
  manifestRequired: boolean;
  /** One-line technical trace for support, safe to render (no PII). */
  trace: string | null;
  /** Raw server debug block, safe to render in the technical debug view. */
  debug: Record<string, unknown>;
}

/**
 * Builds a field-level report from a charter API error. Returns null when the
 * failure is not a validation failure, so callers can fall back to their
 * generic error handling.
 */
export function charterValidationReport(error: unknown): CharterValidationReport | null {
  if (!(error instanceof CharterApiError) || error.code !== "validation_failed") return null;
  const debug = error.debug ?? {};
  const sector = typeof debug.sector === "string" ? debug.sector : null;
  const traceParts: string[] = [];
  if (sector) traceParts.push(`sector=${sector}`);
  if (typeof debug.sector_source === "string") traceParts.push(`via ${debug.sector_source}`);
  if (typeof debug.passengers_supplied === "number") traceParts.push(`passengers=${debug.passengers_supplied}`);
  if (typeof debug.named_passengers === "number") traceParts.push(`named=${debug.named_passengers}`);
  if (typeof debug.contact_name_present === "boolean") traceParts.push(`contactName=${debug.contact_name_present ? "yes" : "no"}`);
  if (typeof debug.contact_email_valid === "boolean") traceParts.push(`contactEmail=${debug.contact_email_valid ? "valid" : "invalid"}`);
  if (typeof debug.ground_legs === "number") traceParts.push(`groundLegs=${debug.ground_legs}`);

  const seen = new Set<string>();
  // Destructured deliberately: these are CharterApiError field issues, not
  // ZodError issues, so they must not be routed through normalizeZodError().
  const { errors: apiIssues } = error;
  const issues = apiIssues
    .map(classifyCharterIssue)
    .filter((issue) => {
      const key = `${issue.field}|${issue.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  return {
    issues,
    sector,
    manifestRequired: debug.manifest_required === true,
    trace: traceParts.length ? traceParts.join(" · ") : null,
    debug: debug as Record<string, unknown>,
  };
}

/** Short toast-friendly summary of the blocking fields. */
export function charterValidationSummary(report: CharterValidationReport): string {
  if (report.issues.length === 1) return `${report.issues[0].label}: ${report.issues[0].fix}`;
  return `${report.issues.length} details block payment: ${report.issues.map((i) => i.label).join(", ")}.`;
}

/** One labelled row of the technical debug view. */
export interface CharterDebugRow { label: string; value: string }

const DEBUG_LABELS: Record<string, string> = {
  sector: "Sector validated",
  sector_source: "Sector determined from",
  category_slug: "Category",
  manifest_required: "Passenger manifest required",
  passengers_supplied: "Passenger rows received",
  named_passengers: "Named passengers received",
  contact_name_present: "Contact name received",
  contact_email_valid: "Contact email valid",
  contact_phone_present: "Contact phone received",
  ground_legs: "Ground transport legs",
  seats_assigned: "Seats assigned",
};

const pretty = (v: unknown): string => {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
};

/** Server debug block flattened into labelled rows for the debug view. */
export function charterDebugRows(report: CharterValidationReport): CharterDebugRow[] {
  const rows: CharterDebugRow[] = [];
  for (const [key, value] of Object.entries(report.debug)) {
    rows.push({ label: DEBUG_LABELS[key] ?? key.replace(/_/g, " "), value: pretty(value) });
  }
  return rows;
}

/**
 * Numbered, do-this-next instructions. Sector-aware: a road charter is never
 * told to complete a passenger manifest, and an aviation sector always is.
 */
export function charterRemediationSteps(report: CharterValidationReport): string[] {
  const steps = report.issues.map((issue, i) => `${i + 1}. ${issue.label} — ${issue.fix}`);
  steps.push(
    report.manifestRequired
      ? `${steps.length + 1}. This is an aviation sector: every traveller needs identity details and a seat before payment can be requested.`
      : `${steps.length + 1}. This is a road charter: only the booking contact is required — passenger names are optional.`,
  );
  steps.push(`${steps.length + 1}. Resubmit payment. If the same field is reported again, send operations the reference line below.`);
  return steps;
}
