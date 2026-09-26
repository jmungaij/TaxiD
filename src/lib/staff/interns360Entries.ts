/**
 * Interns 360 (YMEITA) entry points surfaced on the Staff 360 landing page.
 *
 * Declared in its own module — never as a file-local literal inside a page —
 * so the binding is created by an explicit import at build time. A missing or
 * misspelled import fails the TypeScript check instead of surviving until
 * render (which is how a hot-reloaded page can throw
 * "X is not defined" and blank the screen).
 */
export interface Interns360Entry {
  /** Route inside the staff portal. */
  to: string;
  label: string;
  hint: string;
  cta?: string;
}

export const INTERNS_360_ENTRIES: readonly Interns360Entry[] = [
  {
    to: "/staff/interns",
    label: "Interns 360 dashboard",
    hint: "Cohort health, capability profile, work accepted, verified revenue and integrity flags.",
    cta: "Open Interns 360",
  },
  {
    to: "/staff/interns/recruitment",
    label: "Internship recruitment",
    hint: "Application → eligibility → scoring → track fit → activation, with an append-only trail.",
  },
  {
    to: "/staff/recruitment/internships/new",
    label: "New internship programme",
    hint: "Build the mandate: learning design, productivity, eligibility and the weighted selection model.",
    cta: "Start builder",
  },
  {
    to: "/staff/interns/cohorts",
    label: "Cohorts",
    hint: "Intake planning, calendar and cohort-level performance recalculation.",
  },
  {
    to: "/staff/interns/supply",
    label: "Destinations & mobility supply",
    hint: "DMFD-INT-2608 supply cockpit: driver, fleet and destination pipelines with server-scored productivity.",
    cta: "Open supply cockpit",
  },
  {
    to: "/staff/interns/talent",
    label: "Talent discovery",
    hint: "Ranked, evidence-scored talent and conversion to permanent roles.",
  },
  {
    to: "/staff/interns/governance",
    label: "Integrity & audit",
    hint: "Anti-gaming flags, score invariants and the full decision trail.",
  },
] as const;

/**
 * Runtime guard for required page configuration. Returns the entries when the
 * config is present and well-formed; throws a named, actionable error otherwise
 * so the Staff error boundary can explain the fix rather than showing a blank
 * screen.
 */
export function requireInterns360Entries(): readonly Interns360Entry[] {
  const entries = INTERNS_360_ENTRIES as readonly Interns360Entry[] | undefined;
  if (!entries || !Array.isArray(entries) || entries.length === 0) {
    throw new Error(
      "Staff 360 configuration missing: INTERNS_360_ENTRIES is undefined or empty. " +
        "Import it from '@/lib/staff/interns360Entries' and reload the page.",
    );
  }
  for (const e of entries) {
    if (!e?.to?.startsWith("/") || !e.label || !e.hint) {
      throw new Error(
        `Staff 360 configuration invalid: entry ${JSON.stringify(e)} needs an absolute route, a label and a hint.`,
      );
    }
  }
  return entries;
}
