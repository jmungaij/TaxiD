/**
 * Internship eligibility and previous-attachment rules.
 *
 * One rule set, shared by the candidate-facing form and mirrored by the
 * authoritative server gate (`rec_internship_attachment_gate`). Every duration
 * is computed with the SAME documented convention on both sides:
 *
 *   INCLUSIVE CALENDAR DAYS = floor((end - start) / 86_400_000) + 1
 *
 * so a period from 01 Jan to 25 Mar counts both endpoints. The minimum previous
 * attachment is therefore exactly 84 inclusive calendar days ("12 weeks").
 *
 * Nothing here proves that a person is authorised by an organisation: domain
 * validation only establishes "this is an organisational-domain address".
 * Authenticity of the organisation, the supervisor and the recommendation
 * letter remains a recruiter verification responsibility.
 */

export const MIN_ATTACHMENT_DAYS = 84; // 12 weeks, inclusive convention
export const MIN_INSURANCE_DAYS = 182; // 6 months cover
export const MIN_INTERN_AGE = 22;
export const MAX_INTERN_AGE = 26;

const DAY_MS = 86_400_000;

/** Midnight UTC of a `YYYY-MM-DD` value, or null when unparseable. */
export function parseDay(value: string | null | undefined): number | null {
  const v = (value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const t = Date.parse(`${v}T00:00:00Z`);
  return Number.isFinite(t) ? t : null;
}

/** Inclusive calendar days between two `YYYY-MM-DD` dates (both counted). */
export function inclusiveDays(start: string, end: string): number | null {
  const a = parseDay(start);
  const b = parseDay(end);
  if (a === null || b === null) return null;
  return Math.floor((b - a) / DAY_MS) + 1;
}

/** "14 weeks and 2 days" from an inclusive day count. */
export function describeDuration(days: number): string {
  const weeks = Math.floor(days / 7);
  const rest = days % 7;
  if (weeks === 0) return `${days} day${days === 1 ? "" : "s"}`;
  if (rest === 0) return `${weeks} week${weeks === 1 ? "" : "s"}`;
  return `${weeks} week${weeks === 1 ? "" : "s"} and ${rest} day${rest === 1 ? "" : "s"}`;
}

/** Age in whole years on a reference day. */
export function ageOn(dob: string, reference: Date = new Date()): number | null {
  const d = parseDay(dob);
  if (d === null) return null;
  const b = new Date(d);
  let age = reference.getUTCFullYear() - b.getUTCFullYear();
  const monthDelta = reference.getUTCMonth() - b.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && reference.getUTCDate() < b.getUTCDate())) age -= 1;
  return age;
}

/**
 * Consumer / free-mail providers. Deliberately not the whole rule: an address
 * is also rejected when the domain is structurally invalid. Recruitment may add
 * an override for a genuine edge case rather than growing this list ad hoc.
 */
const CONSUMER_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "ymail.com", "rocketmail.com",
  "hotmail.com", "hotmail.co.uk", "outlook.com", "outlook.co.ke", "live.com", "msn.com",
  "icloud.com", "me.com", "mac.com", "aol.com", "protonmail.com", "proton.me", "pm.me",
  "zoho.com", "gmx.com", "gmx.net", "mail.com", "yandex.com", "yandex.ru", "inbox.com",
  "fastmail.com", "hushmail.com", "tutanota.com", "mail.ru", "qq.com", "163.com", "126.com",
  "rediffmail.com", "web.de", "t-online.de", "sky.com", "btinternet.com", "comcast.net",
  "verizon.net", "att.net", "sbcglobal.net", "example.com", "test.com",
  // Common disposable providers
  "mailinator.com", "guerrillamail.com", "10minutemail.com", "yopmail.com", "trashmail.com",
  "sharklasers.com", "temp-mail.org", "getnada.com", "dispostable.com",
]);

const SYNTAX = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@([A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+)$/;

export interface OrgEmailVerdict {
  ok: boolean;
  /** Lower-cased, trimmed address. */
  normalized: string;
  domain: string;
  reason?: "SYNTAX" | "DOMAIN_STRUCTURE" | "CONSUMER_DOMAIN";
  message?: string;
}

/**
 * Organisational-domain email validation: syntax, domain structure and a
 * consumer/free-mail rejection. DNS existence is verified server-side where
 * technically feasible; the browser cannot resolve MX records.
 */
export function validateOrganisationEmail(
  raw: string,
  overrides: Iterable<string> = [],
): OrgEmailVerdict {
  const normalized = (raw ?? "").trim().toLowerCase();
  const m = SYNTAX.exec(normalized);
  if (!m) {
    return { ok: false, normalized, domain: "", reason: "SYNTAX", message: "Enter a valid email address." };
  }
  const domain = m[1];
  const labels = domain.split(".");
  const tld = labels[labels.length - 1];
  if (labels.length < 2 || tld.length < 2 || !/^[a-z]{2,}$/.test(tld)) {
    return {
      ok: false, normalized, domain, reason: "DOMAIN_STRUCTURE",
      message: "That email domain is not valid.",
    };
  }
  const allowed = new Set(Array.from(overrides, (d) => d.trim().toLowerCase()));
  if (!allowed.has(domain) && CONSUMER_DOMAINS.has(domain)) {
    return {
      ok: false, normalized, domain, reason: "CONSUMER_DOMAIN",
      message:
        "Use an official organisational email address (for example hr@organisation.co.ke). Personal services such as Gmail, Yahoo, Hotmail or Outlook are not accepted.",
    };
  }
  return { ok: true, normalized, domain };
}

/* ------------------------------------------------------------------ state */

/**
 * Normalises a candidate-entered organisation web address. Accepts a bare
 * domain (`decagon.co.ke`) and upgrades it to https. A valid URL only proves
 * the shape of a web address — never that the organisation is authentic.
 */
export function validateOrganisationUrl(value: string): { ok: boolean; normalized: string; message?: string } {
  const raw = (value ?? "").trim();
  if (!raw) return { ok: false, normalized: "", message: "Enter the organisation website or profile link." };
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, normalized: "", message: "This does not look like a valid web address." };
  }
  const host = url.hostname.toLowerCase();
  if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(host) || host.endsWith(".")) {
    return { ok: false, normalized: "", message: "Enter a full web address, for example www.organisation.co.ke." };
  }
  if (host === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    return { ok: false, normalized: "", message: "Enter a public organisation web address." };
  }
  return { ok: true, normalized: `${url.protocol}//${host}${url.pathname === "/" ? "" : url.pathname}` };
}

/** Section B — previous place of attachment. */
export interface PreviousAttachment {
  undertaken: "" | "yes" | "no";
  org_name: string;
  org_email: string;
  /** Organisation website or official profile link (replaces map confirmation). */
  org_url: string;
  po_box: string;
  postal_code: string;
  town: string;
  county: string;
  country: string;
  physical_address: string;
  start_date: string;
  end_date: string;
}

export const EMPTY_PREVIOUS_ATTACHMENT: PreviousAttachment = {
  undertaken: "", org_name: "", org_email: "", org_url: "", po_box: "", postal_code: "", town: "",
  county: "", country: "Kenya", physical_address: "",
  start_date: "", end_date: "",
};


/** Section D — internship insurance cover. */
export interface InternshipInsurance {
  provider: string;
  insured_name: string;
  reference_no: string;
  valid_from: string;
  valid_to: string;
}

export const EMPTY_INTERNSHIP_INSURANCE: InternshipInsurance = {
  provider: "", insured_name: "", reference_no: "", valid_from: "", valid_to: "",
};

export interface AttachmentRequirement {
  key: string;
  label: string;
  ok: boolean;
  detail?: string;
}

const PLACEHOLDER = /^(n\/?a|na|none|nil|test|xxx+|abc|asdf+|\.+|-+)$/i;

/** A meaningful free-text value: trimmed, long enough, not a placeholder. */
export function meaningful(value: string, min = 3): boolean {
  const v = (value ?? "").trim();
  return v.length >= min && !PLACEHOLDER.test(v);
}

export interface AttachmentPeriodVerdict {
  ok: boolean;
  days: number | null;
  description: string | null;
  message?: string;
}

/**
 * Attachment period rules: both dates present and valid, end on or after start,
 * not the same day, entirely in the past (this is a *previous* attachment), and
 * at least 84 inclusive calendar days.
 */
export function validateAttachmentPeriod(
  start: string,
  end: string,
  today: Date = new Date(),
): AttachmentPeriodVerdict {
  const a = parseDay(start);
  const b = parseDay(end);
  if (a === null || b === null) {
    return { ok: false, days: null, description: null, message: "Select both attachment start and end dates." };
  }
  const todayMs = Date.parse(`${today.toISOString().slice(0, 10)}T00:00:00Z`);
  if (b < a) {
    return { ok: false, days: null, description: null, message: "The end date cannot be before the start date." };
  }
  if (b === a) {
    return { ok: false, days: 1, description: describeDuration(1), message: "A same-day attachment is not accepted." };
  }
  if (b > todayMs) {
    return {
      ok: false, days: null, description: null,
      message: "This must be a completed previous attachment — the end date cannot be in the future.",
    };
  }
  if (a < todayMs - 3650 * DAY_MS) {
    return {
      ok: false, days: null, description: null,
      message: "Attachment dates older than 10 years cannot be accepted. Please check your entry.",
    };
  }
  const days = inclusiveDays(start, end)!;
  const description = describeDuration(days);
  if (days < MIN_ATTACHMENT_DAYS) {
    return {
      ok: false, days, description,
      message: `Attachment period is ${description} — below the required minimum of 12 weeks (${MIN_ATTACHMENT_DAYS} days). Please review your dates.`,
    };
  }
  return { ok: true, days, description };
}

export interface InsuranceVerdict {
  ok: boolean;
  days: number | null;
  message?: string;
}

/** Cover must run for at least six months and still be valid today. */
export function validateInsurancePeriod(
  from: string,
  to: string,
  today: Date = new Date(),
): InsuranceVerdict {
  const a = parseDay(from);
  const b = parseDay(to);
  if (a === null || b === null) {
    return { ok: false, days: null, message: "Enter the cover start and expiry dates." };
  }
  if (b <= a) return { ok: false, days: null, message: "The cover expiry date must be after the start date." };
  const todayMs = Date.parse(`${today.toISOString().slice(0, 10)}T00:00:00Z`);
  if (b < todayMs) return { ok: false, days: null, message: "This cover has already expired." };
  const days = inclusiveDays(from, to)!;
  if (days < MIN_INSURANCE_DAYS) {
    return { ok: false, days, message: `Cover runs for ${describeDuration(days)} — at least 6 months of cover is required.` };
  }
  return { ok: true, days };
}

export interface AttachmentGateInput {
  attachment: PreviousAttachment;
  insurance: InternshipInsurance;
  recommendationAttached: boolean;
  insuranceDocumentAttached: boolean;
  supervisor: { name: string; title: string; email: string; phone: string };
  dateOfBirth: string;
  today?: Date;
  emailOverrides?: string[];
}

/** Ordered requirement ledger for the candidate-facing readiness panel. */
export function attachmentRequirements(input: AttachmentGateInput): AttachmentRequirement[] {
  const { attachment: b, insurance: d, supervisor: c } = input;
  const today = input.today ?? new Date();
  const orgEmail = validateOrganisationEmail(b.org_email, input.emailOverrides ?? []);
  const supEmail = validateOrganisationEmail(c.email, input.emailOverrides ?? []);
  const period = validateAttachmentPeriod(b.start_date, b.end_date, today);
  const cover = validateInsurancePeriod(d.valid_from, d.valid_to, today);
  const age = ageOn(input.dateOfBirth, today);

  const req: AttachmentRequirement[] = [
    {
      key: "eligibility_age",
      label: "Age eligibility (22–26)",
      ok: age !== null && age >= MIN_INTERN_AGE && age <= MAX_INTERN_AGE,
      detail:
        age === null
          ? "Enter your date of birth."
          : age < MIN_INTERN_AGE
            ? `This programme is open to applicants aged ${MIN_INTERN_AGE}–${MAX_INTERN_AGE}. Your recorded age is ${age}.`
            : age > MAX_INTERN_AGE
              ? `This programme is open to applicants aged ${MIN_INTERN_AGE}–${MAX_INTERN_AGE}. Your recorded age is ${age}.`
              : `${age} years`,
    },
    {
      key: "attachment_undertaken",
      label: "Previous industrial attachment undertaken",
      ok: b.undertaken === "yes",
      detail:
        b.undertaken === "no"
          ? "This internship requires a completed industrial attachment of at least 12 weeks."
          : b.undertaken === ""
            ? "Confirm whether you undertook an industrial attachment during your studies."
            : undefined,
    },
    { key: "org_name", label: "Name of organisation", ok: meaningful(b.org_name) },
    {
      key: "organization_email", label: "Organisational email address", ok: orgEmail.ok,
      detail: orgEmail.ok ? orgEmail.domain : orgEmail.message,
    },
    { key: "postal_address", label: "Postal address / P.O. Box", ok: meaningful(b.po_box) },
    { key: "postal_code", label: "Postal code", ok: /^[A-Za-z0-9][A-Za-z0-9 -]{2,11}$/.test(b.postal_code.trim()) },
    { key: "town", label: "Town / city", ok: meaningful(b.town, 2) },
    { key: "country", label: "Country", ok: meaningful(b.country, 2) },
    {
      key: "organization_url", label: "Organisation website or profile link",
      ok: validateOrganisationUrl(b.org_url).ok,
      detail: validateOrganisationUrl(b.org_url).ok
        ? validateOrganisationUrl(b.org_url).normalized
        : validateOrganisationUrl(b.org_url).message,
    },

    {
      key: "attachment_period", label: "Attachment period (12 weeks minimum)", ok: period.ok,
      detail: period.ok ? `${period.description} — minimum satisfied` : period.message,
    },
    { key: "recommendation_letter", label: "Recommendation letter", ok: input.recommendationAttached },
    { key: "supervisor_name", label: "Supervisor name", ok: meaningful(c.name) },
    { key: "supervisor_title", label: "Supervisor title", ok: meaningful(c.title, 2) },
    {
      key: "supervisor_email", label: "Supervisor organisational email", ok: supEmail.ok,
      detail: supEmail.ok ? supEmail.domain : supEmail.message,
    },
    { key: "supervisor_phone", label: "Supervisor telephone", ok: /^[+0-9][0-9\s-]{6,}$/.test(c.phone.trim()) },
    { key: "insurance_provider", label: "Insurance cover provider", ok: meaningful(d.provider) },
    { key: "insurance_insured_name", label: "Name of person insured", ok: meaningful(d.insured_name) },
    { key: "insurance_reference", label: "Insurance reference number", ok: meaningful(d.reference_no) },
    {
      key: "insurance_validity", label: "Cover valid for 6 months", ok: cover.ok,
      detail: cover.ok ? `${describeDuration(cover.days!)} of cover` : cover.message,
    },
    { key: "insurance_document", label: "Insurance cover document", ok: input.insuranceDocumentAttached },
  ];
  return req;
}

export interface AttachmentGateVerdict {
  ok: boolean;
  /** Hard ineligibility: no amount of form filling can clear it. */
  ineligible: boolean;
  ineligibleReason?: string;
  requirements: AttachmentRequirement[];
  missing: string[];
  missingKeys: string[];
}

export function evaluateAttachmentGate(input: AttachmentGateInput): AttachmentGateVerdict {
  const requirements = attachmentRequirements(input);
  const failed = requirements.filter((r) => !r.ok);
  const age = ageOn(input.dateOfBirth, input.today ?? new Date());
  const ageOutOfRange = age !== null && (age < MIN_INTERN_AGE || age > MAX_INTERN_AGE);
  const noAttachment = input.attachment.undertaken === "no";
  return {
    ok: failed.length === 0,
    ineligible: ageOutOfRange || noAttachment,
    ineligibleReason: noAttachment
      ? `This internship requires a completed industrial attachment of at least 12 weeks (${MIN_ATTACHMENT_DAYS} calendar days) and a recommendation letter from that organisation.`
      : ageOutOfRange
        ? `This internship is open to applicants aged ${MIN_INTERN_AGE}–${MAX_INTERN_AGE} years.`
        : undefined,
    requirements,
    missing: failed.map((r) => r.label),
    missingKeys: failed.map((r) => r.key),
  };
}

/* ------------------------------------------------------- server authority */

/**
 * Independent server evaluation of the same rules
 * (`rec_internship_attachment_gate`). The browser copy is a mirror for
 * responsiveness; this is the decision that counts. If the RPC is unreachable
 * the caller is told the gate is `unavailable` rather than being silently
 * passed, and the client rules still stand.
 */
export async function serverAttachmentGate(payload: {
  attachment: PreviousAttachment;
  insurance: InternshipInsurance;
  supervisor: { name: string; title: string; email: string; phone: string };
  date_of_birth: string;
  recommendation_attached: boolean;
  insurance_document_attached: boolean;
}): Promise<{ available: boolean; ok: boolean; missing: string[]; reason?: string }> {
  const { supabase } = await import("@/integrations/supabase/client");
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("rec_internship_attachment_gate", {
      p_payload: payload,
    });
    if (error) return { available: false, ok: false, missing: [], reason: error.message };
    const row = (data ?? {}) as { ok?: boolean; missing?: string[]; reason?: string };
    return {
      available: true,
      ok: row.ok === true,
      missing: Array.isArray(row.missing) ? row.missing : [],
      reason: row.reason,
    };
  } catch (e) {
    return { available: false, ok: false, missing: [], reason: (e as Error).message };
  }
}
