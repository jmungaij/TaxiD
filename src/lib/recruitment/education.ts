/**
 * Enterprise education & qualification engine (Recruitment 360).
 *
 * Four structured sections replace the old free-text education block:
 *   1. Primary education        (school, period, KCPE / equivalent)
 *   2. Secondary education      (school, period, KCSE / GCSE / equivalent)
 *   3. College / university     (institution, programme, level, period,
 *                                institution contacts, structured duration,
 *                                per-year or consolidated transcripts)
 *   4. Qualification            (type, programme, specialisation, graduation,
 *                                award classification) + optional others
 *
 * Business rules are NOT hard-coded per vacancy: an `EducationPolicy` is
 * derived from the vacancy requirement configuration, the UI renders that
 * policy, and the backend enforces the same policy authoritatively. Nothing
 * here treats a browser upload as satisfied evidence — a requirement only
 * clears when the document is PERSISTED (uploaded and recorded against the
 * application). Persisted is not verified: verification stays a downstream
 * recruiter process.
 */

export type QualificationLevel = "certificate" | "diploma" | "degree";

export const QUALIFICATION_LEVELS: Array<{ value: QualificationLevel; label: string }> = [
  { value: "certificate", label: "Certificate" },
  { value: "diploma", label: "Diploma" },
  { value: "degree", label: "Degree" },
];

export const AWARD_CLASSIFICATIONS = [
  "First Class",
  "Second Class Upper Division",
  "Second Class Lower Division",
  "Pass",
] as const;
export type AwardClassification = (typeof AWARD_CLASSIFICATIONS)[number];

export type TranscriptMode = "annual" | "consolidated";
export type CompletionStatus = "COMPLETED" | "IN_PROGRESS";

/* --------------------------------------------------------------- policy */

export interface EducationPolicy {
  primary_required: boolean;
  secondary_required: boolean;
  tertiary_required: boolean;
  qualification_required: boolean;
  /** Studies must be finished (every internship requires this by default). */
  completion_required: boolean;
  transcript_required: boolean;
  allowed_levels: QualificationLevel[];
  /** Selectable programme durations per level, in academic years. */
  duration_options: Record<QualificationLevel, number[]>;
  /** Minimum programme duration the vacancy demands, when configured. */
  required_duration_years: number | null;
  /** Label for the primary-school completion credential. */
  primary_certificate_label: string;
  /** Label for the secondary completion credential. */
  secondary_certificate_label: string;
}

export const DEFAULT_EDUCATION_POLICY: EducationPolicy = {
  primary_required: true,
  secondary_required: true,
  tertiary_required: true,
  qualification_required: true,
  completion_required: true,
  transcript_required: true,
  allowed_levels: ["certificate", "diploma", "degree"],
  duration_options: { certificate: [1, 2], diploma: [2, 3], degree: [3, 4, 5, 6] },
  required_duration_years: null,
  primary_certificate_label: "KCPE certificate (or equivalent)",
  secondary_certificate_label: "KCSE / GCSE certificate (or equivalent)",
};

const numArray = (v: unknown): number[] | null => {
  if (!Array.isArray(v)) return null;
  const out = v.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0 && n <= 10);
  return out.length ? out : null;
};

/**
 * Reads the vacancy requirement configuration into a policy. Unknown or absent
 * keys fall back to the platform default, so a vacancy never silently loses a
 * mandatory section.
 */
export function educationPolicyFromVacancy(config: unknown): EducationPolicy {
  const c = (config ?? {}) as Record<string, unknown>;
  const raw = (c.education ?? c.education_policy ?? c) as Record<string, unknown>;
  const bool = (k: string, fallback: boolean) =>
    typeof raw[k] === "boolean" ? (raw[k] as boolean) : fallback;
  const levels = Array.isArray(raw.allowed_levels)
    ? (raw.allowed_levels as unknown[])
        .map((l) => String(l).toLowerCase())
        .filter((l): l is QualificationLevel => l === "certificate" || l === "diploma" || l === "degree")
    : [];
  const durations = (raw.duration_options ?? {}) as Record<string, unknown>;
  const required = Number(raw.required_duration_years);

  return {
    primary_required: bool("primary_required", DEFAULT_EDUCATION_POLICY.primary_required),
    secondary_required: bool("secondary_required", DEFAULT_EDUCATION_POLICY.secondary_required),
    tertiary_required: bool("tertiary_required", DEFAULT_EDUCATION_POLICY.tertiary_required),
    qualification_required: bool("qualification_required", DEFAULT_EDUCATION_POLICY.qualification_required),
    completion_required: bool("completion_required", DEFAULT_EDUCATION_POLICY.completion_required),
    transcript_required: bool("transcript_required", DEFAULT_EDUCATION_POLICY.transcript_required),
    allowed_levels: levels.length ? levels : DEFAULT_EDUCATION_POLICY.allowed_levels,
    duration_options: {
      certificate: numArray(durations.certificate) ?? DEFAULT_EDUCATION_POLICY.duration_options.certificate,
      diploma: numArray(durations.diploma) ?? DEFAULT_EDUCATION_POLICY.duration_options.diploma,
      degree: numArray(durations.degree) ?? DEFAULT_EDUCATION_POLICY.duration_options.degree,
    },
    required_duration_years: Number.isInteger(required) && required > 0 ? required : null,
    primary_certificate_label:
      typeof raw.primary_certificate_label === "string" && raw.primary_certificate_label.trim()
        ? raw.primary_certificate_label
        : DEFAULT_EDUCATION_POLICY.primary_certificate_label,
    secondary_certificate_label:
      typeof raw.secondary_certificate_label === "string" && raw.secondary_certificate_label.trim()
        ? raw.secondary_certificate_label
        : DEFAULT_EDUCATION_POLICY.secondary_certificate_label,
  };
}

/* ---------------------------------------------------------------- state */

export interface SchoolRecord {
  name: string;
  start_date: string;
  end_date: string;
}

export const EMPTY_SCHOOL_RECORD: SchoolRecord = { name: "", start_date: "", end_date: "" };

export interface TertiaryRecord {
  institution: string;
  programme: string;
  qualification_level: QualificationLevel | "";
  admission_date: string;
  completion_date: string;
  duration_years: number | null;
  institution_phone: string;
  institution_email: string;
  completion_status: CompletionStatus | "";
  transcript_mode: TranscriptMode;
}

export const EMPTY_TERTIARY_RECORD: TertiaryRecord = {
  institution: "", programme: "", qualification_level: "", admission_date: "", completion_date: "",
  duration_years: null, institution_phone: "", institution_email: "", completion_status: "",
  transcript_mode: "annual",
};

export interface QualificationRecord {
  qualification_type: QualificationLevel | "";
  programme: string;
  specialisation: string;
  graduation_date: string;
  award_classification: AwardClassification | "";
}

export const EMPTY_QUALIFICATION_RECORD: QualificationRecord = {
  qualification_type: "", programme: "", specialisation: "", graduation_date: "", award_classification: "",
};

export interface OtherQualification {
  name: string;
  institution: string;
  award_date: string;
}

export const EMPTY_OTHER_QUALIFICATION: OtherQualification = { name: "", institution: "", award_date: "" };

/* ----------------------------------------------------------- primitives */

const DAY = 86_400_000;
const PLACEHOLDER = /^(n\/?a|na|none|nil|test|xxx+|abc|asdf+|\.+|-+)$/i;
const CONSUMER_DOMAINS = [
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "hotmail.com", "outlook.com",
  "live.com", "icloud.com", "aol.com", "protonmail.com", "proton.me", "mail.com",
  "yandex.com", "zoho.com", "gmx.com", "mailinator.com", "yopmail.com", "10minutemail.com",
];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^[+0-9][0-9\s-]{7,}$/;

export function meaningfulText(value: string, min = 3): boolean {
  const v = (value ?? "").trim();
  return v.length >= min && !PLACEHOLDER.test(v);
}

export function parseDay(value: string | null | undefined): number | null {
  const v = (value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const t = Date.parse(`${v}T00:00:00Z`);
  return Number.isFinite(t) ? t : null;
}

/** Institutional email: syntactically valid and not a consumer mailbox. */
export function validateInstitutionEmail(value: string): { ok: boolean; domain: string; message?: string } {
  const v = (value ?? "").trim().toLowerCase();
  if (!EMAIL.test(v)) return { ok: false, domain: "", message: "Enter a valid institution email address." };
  const domain = v.split("@")[1];
  if (CONSUMER_DOMAINS.includes(domain)) {
    return {
      ok: false,
      domain,
      message: "Use the institution's official email address, not a personal mailbox.",
    };
  }
  return { ok: true, domain };
}

export interface PeriodVerdict {
  ok: boolean;
  years: number | null;
  message?: string;
}

/**
 * Chronology for a completed academic period: both dates present, end strictly
 * after start, and the end date never in the future for a completed record.
 */
export function validateAcademicPeriod(
  start: string,
  end: string,
  opts: { completed?: boolean; today?: Date } = {},
): PeriodVerdict {
  const a = parseDay(start);
  const b = parseDay(end);
  if (a === null || b === null) return { ok: false, years: null, message: "Enter both the start and completion dates." };
  if (b <= a) return { ok: false, years: null, message: "The completion date must be after the start date." };
  const today = opts.today ?? new Date();
  const todayMs = Date.parse(`${today.toISOString().slice(0, 10)}T00:00:00Z`);
  if (opts.completed !== false && b > todayMs) {
    return { ok: false, years: null, message: "This record is for completed studies — the completion date cannot be in the future." };
  }
  const years = Math.round(((b - a) / DAY / 365.25) * 10) / 10;
  return { ok: true, years };
}

/** Academic years generated from the selected programme duration. */
export function academicYears(duration: number | null): number[] {
  if (!duration || duration < 1) return [];
  return Array.from({ length: Math.min(duration, 10) }, (_, i) => i + 1);
}

/**
 * Transcript requirement keys for a programme. `annual` requires one transcript
 * per academic year; `consolidated` requires a single final transcript.
 */
export function transcriptRequirements(record: TertiaryRecord): string[] {
  if (record.transcript_mode === "consolidated") return ["transcript_final"];
  return academicYears(record.duration_years).map((y) => `transcript_year_${y}`);
}

/* ------------------------------------------------------------ evaluation */

export interface EducationRequirement {
  key: string;
  label: string;
  ok: boolean;
  detail?: string;
}

export interface EducationSectionVerdict {
  key: "primary" | "secondary" | "tertiary" | "qualification";
  label: string;
  required: boolean;
  ok: boolean;
  requirements: EducationRequirement[];
  missing: string[];
}

export interface EducationGateInput {
  policy: EducationPolicy;
  primary: SchoolRecord;
  secondary: SchoolRecord;
  tertiary: TertiaryRecord;
  qualification: QualificationRecord;
  otherQualification?: OtherQualification;
  /**
   * PERSISTED document keys for this application — not browser upload state.
   * Expected keys: `kcpe_certificate`, `kcse_certificate`,
   * `transcript_year_<n>`, `transcript_final`.
   */
  persistedDocuments: string[];
  /**
   * True when the vacancy's document engine requires the award certificate
   * (degree / diploma) for the declared status. Derived from the server
   * requirement set, never hard-coded.
   */
  graduationCertificateRequired?: boolean;
  today?: Date;
}

export interface EducationGateVerdict {
  ok: boolean;
  sections: EducationSectionVerdict[];
  missing: string[];
  missingKeys: string[];
  /** Section 3 vs Section 4 mismatch: informational, never a rejection. */
  qualificationMismatch: boolean;
  mismatchNote?: string;
}

const has = (docs: string[], key: string) => docs.includes(key);

function schoolSection(
  key: "primary" | "secondary",
  label: string,
  record: SchoolRecord,
  certificateKey: string,
  certificateLabel: string,
  required: boolean,
  docs: string[],
  today?: Date,
): EducationSectionVerdict {
  const period = validateAcademicPeriod(record.start_date, record.end_date, { completed: true, today });
  const requirements: EducationRequirement[] = [
    { key: `${key}_name`, label: `${label} school name`, ok: meaningfulText(record.name) },
    {
      key: `${key}_period`, label: `${label} period`, ok: period.ok,
      detail: period.ok ? `${period.years} years` : period.message,
    },
    { key: certificateKey, label: certificateLabel, ok: has(docs, certificateKey) },
  ];
  const failed = requirements.filter((r) => !r.ok);
  return {
    key, label: `${label} education`, required,
    ok: !required || failed.length === 0,
    requirements,
    missing: failed.map((r) => (r.detail ? `${r.label} — ${r.detail}` : r.label)),
  };
}

function tertiarySection(input: EducationGateInput): EducationSectionVerdict {
  const { policy, tertiary: t, persistedDocuments: docs } = input;
  const email = validateInstitutionEmail(t.institution_email);
  const completed = policy.completion_required || t.completion_status === "COMPLETED";
  const period = validateAcademicPeriod(t.admission_date, t.completion_date, { completed, today: input.today });
  const levelOk = t.qualification_level !== "" && policy.allowed_levels.includes(t.qualification_level);
  const options = t.qualification_level ? policy.duration_options[t.qualification_level] : [];
  const durationOk = t.duration_years !== null && options.includes(t.duration_years);
  const meetsRequired =
    policy.required_duration_years === null ||
    (t.duration_years !== null && t.duration_years >= policy.required_duration_years);

  const requirements: EducationRequirement[] = [
    { key: "institution", label: "Institution name", ok: meaningfulText(t.institution) },
    { key: "programme", label: "Programme of study", ok: meaningfulText(t.programme) },
    {
      key: "qualification_level", label: "Qualification level", ok: levelOk,
      detail: levelOk ? undefined : "Select a qualification level accepted for this vacancy.",
    },
    {
      key: "academic_period", label: "Admission and completion dates", ok: period.ok,
      detail: period.ok ? `${period.years} years` : period.message,
    },
    {
      key: "institution_phone", label: "Institution telephone", ok: PHONE.test(t.institution_phone.trim()),
      detail: PHONE.test(t.institution_phone.trim()) ? undefined : "Enter a reachable institution telephone number.",
    },
    {
      key: "institution_email", label: "Institution official email", ok: email.ok,
      detail: email.ok ? email.domain : email.message,
    },
    {
      key: "programme_duration", label: "Programme duration", ok: durationOk && meetsRequired,
      detail: !durationOk
        ? `Select the programme duration${options.length ? ` (${options.join(" / ")} years)` : ""}.`
        : !meetsRequired
          ? `This vacancy requires at least ${policy.required_duration_years} academic years of study.`
          : `${t.duration_years} academic years`,
    },
  ];

  if (policy.completion_required) {
    requirements.push({
      key: "completion_status", label: "Studies completed", ok: t.completion_status === "COMPLETED",
      detail: t.completion_status === "COMPLETED" ? undefined : "This programme is only open to candidates who have completed their studies.",
    });
  }

  if (policy.transcript_required) {
    if (t.transcript_mode === "consolidated") {
      requirements.push({
        key: "transcript_final", label: "Final academic transcript covering the whole programme",
        ok: has(docs, "transcript_final"),
      });
    } else {
      const years = academicYears(t.duration_years);
      if (years.length === 0) {
        requirements.push({
          key: "transcript_year_pending", label: "Academic transcripts", ok: false,
          detail: "Select the programme duration to reveal the transcript requirements.",
        });
      }
      for (const y of years) {
        requirements.push({
          key: `transcript_year_${y}`, label: `Year ${y} academic transcript`,
          ok: has(docs, `transcript_year_${y}`),
        });
      }
    }
  }

  const failed = requirements.filter((r) => !r.ok);
  return {
    key: "tertiary", label: "College / university education", required: policy.tertiary_required,
    ok: !policy.tertiary_required || failed.length === 0,
    requirements,
    missing: failed.map((r) => (r.detail ? `${r.label} — ${r.detail}` : r.label)),
  };
}

function qualificationSection(input: EducationGateInput): EducationSectionVerdict {
  const { policy, qualification: q } = input;
  const typeOk = q.qualification_type !== "" && policy.allowed_levels.includes(q.qualification_type);
  const graduation = parseDay(q.graduation_date);
  const today = input.today ?? new Date();
  const todayMs = Date.parse(`${today.toISOString().slice(0, 10)}T00:00:00Z`);
  const awardOk = (AWARD_CLASSIFICATIONS as readonly string[]).includes(q.award_classification);

  const requirements: EducationRequirement[] = [
    { key: "qualification_type", label: "Qualification type", ok: typeOk },
    { key: "qualification_programme", label: "Programme of study", ok: meaningfulText(q.programme) },
    { key: "specialisation", label: "Area of specialisation", ok: meaningfulText(q.specialisation) },
    {
      key: "graduation_date", label: "Graduation date",
      ok: graduation !== null && graduation <= todayMs,
      detail: graduation === null
        ? "Select your graduation date."
        : graduation > todayMs ? "The graduation date cannot be in the future." : undefined,
    },
    {
      key: "award_classification", label: "Award classification", ok: awardOk,
      detail: awardOk ? undefined : "Select one of the listed award classifications.",
    },
  ];

  // A completed award must be evidenced by the certificate itself. The
  // requirement only appears when the vacancy's document engine asks for it, so
  // an in-progress candidate is never blocked on a certificate they cannot hold.
  if (input.graduationCertificateRequired) {
    requirements.push({
      key: "graduation_certificate",
      label: "Degree / diploma certificate",
      ok: has(input.persistedDocuments, "graduation_certificate"),
    });
  }

  const failed = requirements.filter((r) => !r.ok);
  return {
    key: "qualification", label: "Qualification", required: policy.qualification_required,
    ok: !policy.qualification_required || failed.length === 0,
    requirements,
    missing: failed.map((r) => (r.detail ? `${r.label} — ${r.detail}` : r.label)),
  };
}


/** Whole-module evaluation: one ledger the UI and the server both read. */
export function evaluateEducationGate(input: EducationGateInput): EducationGateVerdict {
  const { policy } = input;
  const sections: EducationSectionVerdict[] = [
    schoolSection(
      "primary", "Primary", input.primary, "kcpe_certificate",
      policy.primary_certificate_label, policy.primary_required, input.persistedDocuments, input.today,
    ),
    schoolSection(
      "secondary", "Secondary", input.secondary, "kcse_certificate",
      policy.secondary_certificate_label, policy.secondary_required, input.persistedDocuments, input.today,
    ),
    tertiarySection(input),
    qualificationSection(input),
  ];

  const failing = sections.filter((s) => s.required && !s.ok);
  const mismatch =
    input.qualification.qualification_type !== "" &&
    input.tertiary.qualification_level !== "" &&
    input.qualification.qualification_type !== input.tertiary.qualification_level;

  return {
    ok: failing.length === 0,
    sections,
    missing: failing.flatMap((s) => s.missing.map((m) => `${s.label}: ${m}`)),
    missingKeys: sections.flatMap((s) => (s.required ? s.requirements.filter((r) => !r.ok).map((r) => r.key) : [])),
    qualificationMismatch: mismatch,
    mismatchNote: mismatch
      ? "Your highest qualification differs from the academic record above. That is accepted where you hold more than one qualification — recruiters will review both records."
      : undefined,
  };
}

/**
 * True when a requirement is satisfied by a persisted document rather than by
 * typed data. Academic evidence is now collected inside the Education stage, so
 * these keys block the stage exactly like the structured fields do.
 */
export function isDocumentRequirement(key: string): boolean {
  return (
    key === "kcpe_certificate" ||
    key === "kcse_certificate" ||
    key === "graduation_certificate" ||
    key.startsWith("transcript_")
  );
}

function blockersFor(
  verdict: EducationGateVerdict,
  keep: (key: string) => boolean,
): string[] {
  return verdict.sections
    .filter((s) => s.required)
    .flatMap((s) =>
      s.requirements
        .filter((r) => !r.ok && keep(r.key))
        .map((r) => `${s.label}: ${r.detail ? `${r.label} — ${r.detail}` : r.label}`),
    );
}

/**
 * Every outstanding Education requirement — structured data AND academic
 * evidence. This is the authoritative stage gate mirrored by the server
 * (`rec_public_stage_gate`); nothing downstream may be reached while it is
 * non-empty.
 */
export function educationBlockers(verdict: EducationGateVerdict): string[] {
  return blockersFor(verdict, () => true);
}

/** Data-entry subset, used to label the ledger — never the stage gate. */
export function educationDataBlockers(verdict: EducationGateVerdict): string[] {
  return blockersFor(verdict, (key) => !isDocumentRequirement(key));
}

/** Documentary-evidence subset, used to label the ledger. */
export function educationEvidenceBlockers(verdict: EducationGateVerdict): string[] {
  return blockersFor(verdict, isDocumentRequirement);
}

