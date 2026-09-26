/**
 * INTERNSHIP PROGRAMME BUILDER — client contract.
 *
 * An internship programme is not a job advert. It is a capability development
 * mandate attached to a single approved vacancy: learning objectives with
 * evidence, measurable productivity, curriculum-to-capability mapping, a
 * weighted selection model and a publication gate. Every rule below is enforced
 * server-side (`rec_internship_validate`, `rec_internship_create`); the UI only
 * collects and mirrors the verdict — it never decides readiness itself.
 *
 * Governing rule: a degree title alone is never capability. Track fit comes
 * from mapped coursework, demonstrated competencies and verifiable evidence.
 */
import { supabase } from "@/integrations/supabase/client";
import { untypedDb } from "@/integrations/supabase/untyped";

const anyClient = untypedDb;

const call = async <T>(fn: string, args?: Record<string, unknown>): Promise<T> => {
  const { data, error } = await anyClient.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
};

/* ------------------------------- contracts ------------------------------- */

export const INTERNSHIP_TYPES = [
  { value: "ACADEMIC", label: "Academic internship" },
  { value: "INDUSTRIAL_ATTACHMENT", label: "Industrial attachment" },
  { value: "PROFESSIONAL", label: "Professional internship" },
  { value: "GRADUATE", label: "Graduate trainee" },
  { value: "STRUCTURED_TALENT", label: "Structured talent accelerator" },
] as const;

export const QUALIFICATION_LEVELS = [
  "Certificate",
  "Diploma",
  "Higher diploma",
  "Undergraduate degree",
  "Postgraduate degree",
] as const;

export const REQUIRED_DOCUMENT_OPTIONS = [
  "University or college introduction letter",
  "Academic transcript",
  "Course unit list / curriculum outline",
  "Student identification",
  "National identification",
  "Insurance cover confirmation",
  "Supervisor or faculty contact",
] as const;

export interface LearningObjective { competency: string; evidence: string; assessment: string }
export interface LearningOutcome { action: string; competency: string; context: string; evidence: string }
export interface ProductivityItem { output: string; cadence: string; system_of_record: string }
export interface Kpi { kpi: string; target: string; evidence_source: string }
export interface CurriculumLink { course: string; capability: string; application: string }
export interface CompetencyReq { competency: string; evidence: string; level: string }
export interface AssessmentStage { stage: string; instrument: string; weight: number; passing: string }
export interface InterviewQuestion { question: string; rubric: string; max_marks: number }
export interface DevelopmentPhase { phase: string; focus: string; milestone: string }
export interface ApplicationQuestion { question: string; input: string; required: boolean }

export interface SelectionWeights {
  academic_relevance: number;
  curriculum_relevance: number;
  competencies: number;
  evidence: number;
  assessment: number;
  learning_agility: number;
  communication: number;
  problem_solving: number;
  interview: number;
}

export const SELECTION_WEIGHT_LABELS: Record<keyof SelectionWeights, string> = {
  academic_relevance: "Academic relevance",
  curriculum_relevance: "Curriculum-to-capability mapping",
  competencies: "Demonstrated competencies",
  evidence: "Verified evidence",
  assessment: "Practical assessment",
  learning_agility: "Learning agility",
  communication: "Communication",
  problem_solving: "Problem solving",
  interview: "Structured interview",
};

export const DEFAULT_SELECTION_WEIGHTS: SelectionWeights = {
  academic_relevance: 15,
  curriculum_relevance: 15,
  competencies: 10,
  evidence: 15,
  assessment: 20,
  learning_agility: 10,
  communication: 5,
  problem_solving: 5,
  interview: 5,
};

export interface InternshipProgrammeDraft {
  title: string;
  location: string;
  position_id: string;
  position_exception_reason: string;
  work_arrangement: string;
  priority: string;
  headcount: number;
  sla_days: number;
  internship_type: string;
  duration_weeks: number;
  start_date: string;
  end_date: string;
  application_deadline: string;
  host_function: string;
  department: string;
  business_unit: string;
  supervisor_staff_id: string;
  mentor_staff_id: string;
  approving_manager_staff_id: string;
  cohort_id: string;
  programme_id: string;
  primary_track_id: string;
  secondary_track_id: string;
  development_track_id: string;
  programme_purpose: string;
  learning_objectives: LearningObjective[];
  learning_outcomes: LearningOutcome[];
  productivity_mandate: ProductivityItem[];
  kpis: Kpi[];
  academic_eligibility: {
    qualification_level: string;
    programme_families: string[];
    year_of_study: string;
    minimum_grade: string;
    attachment_letter_required: boolean;
  };
  required_documents: string[];
  curriculum_map: CurriculumLink[];
  competencies: CompetencyReq[];
  practical_capabilities: string[];
  experience_equivalency: string[];
  assessment_design: AssessmentStage[];
  interview_framework: InterviewQuestion[];
  selection_weights: SelectionWeights;
  talent_attributes: string[];
  commercial_objective: { objective: string; measure: string; attribution_source: string };
  success_profile: string[];
  development_plan: DevelopmentPhase[];
  public_preview: { summary: string; what_you_will_do: string; what_you_will_learn: string; who_should_apply: string };
  application_questions: ApplicationQuestion[];
  /**
   * Stable per-draft submit key. The server replays the original programme when
   * the same key arrives twice, so a double-click can never create two roles.
   */
  idempotency_key: string;
}

/** Fresh submit key for a new draft session. */
export const newSubmitKey = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `int-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export const emptyDraft = (): InternshipProgrammeDraft => ({
  idempotency_key: newSubmitKey(),
  title: "",
  location: "Nairobi",
  position_id: "",
  position_exception_reason: "",
  work_arrangement: "onsite",
  priority: "normal",
  headcount: 10,
  sla_days: 30,
  internship_type: "ACADEMIC",
  duration_weeks: 12,
  start_date: "",
  end_date: "",
  application_deadline: "",
  host_function: "",
  department: "",
  business_unit: "",
  supervisor_staff_id: "",
  mentor_staff_id: "",
  approving_manager_staff_id: "",
  cohort_id: "",
  programme_id: "",
  primary_track_id: "",
  secondary_track_id: "",
  development_track_id: "",
  programme_purpose: "",
  learning_objectives: [{ competency: "", evidence: "", assessment: "" }],
  learning_outcomes: [{ action: "", competency: "", context: "", evidence: "" }],
  productivity_mandate: [{ output: "", cadence: "Weekly", system_of_record: "" }],
  kpis: [{ kpi: "", target: "", evidence_source: "" }],
  academic_eligibility: {
    qualification_level: "Undergraduate degree",
    programme_families: [],
    year_of_study: "Year 3 or above",
    minimum_grade: "",
    attachment_letter_required: true,
  },
  required_documents: [
    "University or college introduction letter",
    "Academic transcript",
    "Course unit list / curriculum outline",
    "National identification",
  ],
  curriculum_map: [{ course: "", capability: "", application: "" }],
  competencies: [{ competency: "", evidence: "", level: "Working" }],
  practical_capabilities: [],
  experience_equivalency: [],
  assessment_design: [{ stage: "Practical work sample", instrument: "", weight: 100, passing: "" }],
  interview_framework: [{ question: "", rubric: "", max_marks: 5 }],
  selection_weights: { ...DEFAULT_SELECTION_WEIGHTS },
  talent_attributes: [],
  commercial_objective: { objective: "", measure: "", attribution_source: "" },
  success_profile: [],
  development_plan: [
    { phase: "Week 1", focus: "", milestone: "" },
    { phase: "Weeks 2–4", focus: "", milestone: "" },
    { phase: "Completion", focus: "", milestone: "" },
  ],
  public_preview: { summary: "", what_you_will_do: "", what_you_will_learn: "", who_should_apply: "" },
  application_questions: [{ question: "", input: "Long text", required: true }],
});

export interface ValidationVerdict {
  verdict: "READY" | "BLOCKED";
  blockers: string[];
  vacancy_no?: string | null;
  spec_status?: string | null;
}

export const weightTotal = (w: SelectionWeights) =>
  Object.values(w).reduce((sum, value) => sum + (Number(value) || 0), 0);

/* --------------------------------- reads -------------------------------- */

export interface StaffOption { id: string; full_name: string | null; staff_no: string | null; work_email: string | null }

export async function listStaffOptions(): Promise<StaffOption[]> {
  const { data, error } = await anyClient
    .from("staff_members")
    .select("id, full_name, staff_no, work_email")
    .eq("employment_status", "active")
    .order("full_name")
    .limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []) as StaffOption[];
}

export interface InternshipSpecRow {
  id: string;
  vacancy_id: string;
  spec_status: string;
  internship_type: string;
  primary_track_id: string | null;
  cohort_id: string | null;
  start_date: string | null;
  end_date: string | null;
  application_deadline: string | null;
  duration_weeks: number | null;
}

export async function listInternshipSpecs(): Promise<InternshipSpecRow[]> {
  const { data, error } = await anyClient
    .from("rec_internship_specs")
    .select("id, vacancy_id, spec_status, internship_type, primary_track_id, cohort_id, start_date, end_date, application_deadline, duration_weeks")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as InternshipSpecRow[];
}

/* -------------------------------- writes -------------------------------- */

export interface CreateResult {
  ok: boolean;
  vacancy_id: string;
  vacancy_no: string;
  spec_id: string;
  validation: ValidationVerdict;
}

/** Creates the vacancy and its internship blueprint in one governed server call. */
export async function createInternshipProgramme(draft: InternshipProgrammeDraft): Promise<CreateResult> {
  return call<CreateResult>("rec_internship_create", { p: draft as unknown as Record<string, unknown> });
}

export async function validateInternshipProgramme(vacancyId: string): Promise<ValidationVerdict> {
  return call<ValidationVerdict>("rec_internship_validate", { p_vacancy: vacancyId });
}

export async function updateInternshipProgramme(
  vacancyId: string,
  patch: Partial<InternshipProgrammeDraft> & { spec_status?: string },
): Promise<ValidationVerdict> {
  return call<ValidationVerdict>("rec_internship_update", {
    p_vacancy: vacancyId,
    p: patch as unknown as Record<string, unknown>,
  });
}

/**
 * Public announcement slug for a created programme, so staff can open exactly
 * what a visitor sees. Returns null while the programme is unpublished.
 */
export async function internshipPublicSlug(vacancyId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("rec_vacancies")
    .select("public_slug")
    .eq("id", vacancyId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.public_slug as string | null) ?? null;
}
