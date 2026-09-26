/**
 * Public application step gating.
 *
 * Pure functions: given the current form state, report exactly what is still
 * outstanding on each step. A candidate may not advance past a step while it
 * carries an outstanding requirement, and the final submit is only offered once
 * every step reports clear. The server remains the authority on submission —
 * this is the candidate-facing mirror so nobody reaches Review with gaps.
 */
import type { DocumentChecklist } from "@/lib/recruitment/documentControl";
import type { AttachmentGateVerdict } from "@/lib/recruitment/internshipAttachment";


export const APPLICATION_STEPS = [
  "You",
  "Education",
  "Experience",
  "Qualification",
  "Review",
] as const;

export type ApplicationStepIndex = 0 | 1 | 2 | 3 | 4;

/**
 * Statutory internship intake identity (institution attachment form).
 * Collected on the personal step for internship programmes only.
 */
export interface InternshipPersonalDetails {
  last_name: string;
  other_names: string;
  gender: string;
  national_id: string;
  date_of_birth: string;
  home_address: string;
  telephone: string;
  next_of_kin_name: string;
  next_of_kin_relationship: string;
  postal_address: string;
  postal_code: string;
  postal_tel: string;
  org_name: string;
  org_postal_address: string;
  org_postal_code: string;
  org_tel: string;
  org_fax: string;
  supervisor_name: string;
  supervisor_title: string;
  supervisor_email: string;
  supervisor_phone: string;
}

export const EMPTY_INTERNSHIP_PERSONAL: InternshipPersonalDetails = {
  last_name: "", other_names: "", gender: "", national_id: "", date_of_birth: "",
  home_address: "", telephone: "", next_of_kin_name: "", next_of_kin_relationship: "",
  postal_address: "", postal_code: "", postal_tel: "",
  org_name: "", org_postal_address: "", org_postal_code: "", org_tel: "", org_fax: "",
  supervisor_name: "", supervisor_title: "", supervisor_email: "", supervisor_phone: "",
};

export interface StepGateState {
  form: {
    full_name: string;
    email: string;
    phone: string;
    cover_letter: string;
    answers: Record<string, unknown>;
    academic: Array<Record<string, string>>;
    employment: Array<Record<string, string>>;
  };
  sections: { education?: boolean; employment?: boolean };
  coverLetterMode: "none" | "optional" | "required";
  isInternship: boolean;
  academicProfile: { institution: string; programme: string; qualification_level: string };
  /** Internship-only: statutory personal details and the full-size photograph. */
  internshipPersonal?: InternshipPersonalDetails;
  internshipPhotoAttached?: boolean;
  /**
   * Internship-only: previous industrial attachment, supervisor and insurance
   * evaluation. Produced by `evaluateAttachmentGate` so the requirement ledger
   * and the step gate can never disagree.
   */
  attachmentGate?: AttachmentGateVerdict;
  /** Graduation date and qualification declared on the Qualification step. */
  qualification?: { graduation_date: string; qualification_level: string };
  docChecklist?: DocumentChecklist | null;
  consent: boolean;
  declaration: boolean;
}

/** Step 2 is the attachment & insurance step for internship intake. */
export function stepLabel(step: number, isInternship: boolean): string {
  if (isInternship && step === 2) return "Attachment";
  return APPLICATION_STEPS[step];
}



const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^[+0-9][0-9\s-]{6,}$/;

const filled = (rows: Array<Record<string, string>>) =>
  rows.filter((r) => Object.values(r).some((v) => String(v ?? "").trim() !== "")).length;

/** Outstanding requirements for one step, in the order the candidate sees them. */
export function stepBlockers(step: number, s: StepGateState): string[] {
  const out: string[] = [];
  switch (step) {
    case 0:
      if (!s.form.full_name.trim()) out.push("Enter your full name.");
      if (!EMAIL.test(s.form.email.trim())) out.push("Enter a valid email address.");
      if (!PHONE.test(s.form.phone.trim())) out.push("Enter a reachable phone number.");
      if (s.isInternship) {
        const p = s.internshipPersonal;
        
        if (!p?.last_name.trim()) out.push("Enter your last name.");
        if (!p?.other_names.trim()) out.push("Enter your other names.");
        if (!p?.gender.trim()) out.push("Select your gender.");
        if (!p?.national_id.trim()) out.push("Enter your national identity card number.");
        if (!p?.date_of_birth.trim()) out.push("Enter your date of birth.");
        if (!p?.home_address.trim()) out.push("Enter your home address.");
        if (!p?.telephone.trim()) out.push("Enter your home telephone number.");
        if (!p?.next_of_kin_name.trim()) out.push("Enter your next of kin.");
        if (!p?.next_of_kin_relationship.trim()) out.push("State your relationship to your next of kin.");
      }
      break;
    case 1:
      if (s.isInternship) {
        if (!s.academicProfile.institution.trim()) out.push("Name the institution you study at.");
        if (!s.academicProfile.programme.trim()) out.push("Name your programme of study.");
        if (!s.academicProfile.qualification_level.trim()) out.push("Select your qualification level.");
      }
      if (s.sections.education !== false && filled(s.form.academic) === 0) {
        out.push("Add at least one academic qualification.");
      }
      break;
    case 2:
      // Internship intake replaces employment/skills with the previous
      // industrial attachment, supervisor and insurance evidence.
      if (s.isInternship) {
        const gate = s.attachmentGate;
        if (!gate) out.push("Attachment details are still loading.");
        else if (gate.ineligible) out.push(gate.ineligibleReason ?? "You are not eligible for this internship.");
        else {
          for (const r of gate.requirements) {
            if (!r.ok) out.push(r.detail ? `${r.label} — ${r.detail}` : `Provide: ${r.label}`);
          }
        }
        break;
      }
      if (s.sections.employment !== false && filled(s.form.employment) === 0) {
        out.push("Add at least one employment entry (state 'None' if you have no history yet).");
      }
      break;

    case 3:
      if (!s.qualification?.graduation_date?.trim()) out.push("Enter the date you graduated.");
      if (!s.qualification?.qualification_level?.trim()) out.push("Select your qualification.");
      if (s.coverLetterMode === "required" && s.form.cover_letter.trim().length < 50) {
        out.push("A cover letter of at least 50 characters is required for this role.");
      }
      break;
    case 4:
      if (!s.consent) out.push("Acknowledge the recruitment privacy notice.");
      if (!s.declaration) out.push("Confirm the information provided is accurate.");
      break;
  }
  return out;
}

/** Missing-document labels are de-duplicated: one requirement, one line. */
export function uniqueMissing(missing: string[]): string[] {
  return Array.from(new Set(missing.map((m) => m.trim()).filter(Boolean)));
}

/** Every step except Review, so Review can show the whole application state. */
export function allStepBlockers(s: StepGateState): Record<number, string[]> {
  const map: Record<number, string[]> = {};
  for (let i = 0; i < APPLICATION_STEPS.length; i += 1) map[i] = stepBlockers(i, s);
  return map;
}

/** Submission is offered only when no step carries an outstanding requirement. */
export function submissionReady(s: StepGateState): { ready: boolean; blockers: string[] } {
  const all = allStepBlockers(s);
  const blockers = Object.keys(all)
    .map(Number)
    .sort((a, b) => a - b)
    .flatMap((i) => all[i].map((b) => `${stepLabel(i, s.isInternship)}: ${b}`));

  return { ready: blockers.length === 0, blockers };
}
