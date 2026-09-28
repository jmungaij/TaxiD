import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowLeft, ArrowRight, CheckCircle2, FileWarning, Loader2, Plus, RefreshCw, Save, Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { MarketingPage, PageHero } from "@/components/marketing/PageHero";
import { clearResumeToken, getApplicationBootstrap, loadApplicationDraft, PUBLIC_VACANCY_QUERY_OPTIONS, saveApplicationDraft, getPublicInternship, submitPublicApplication, submitPublicInternshipApplication, trackAnnouncementEvent, uploadApplicationDocument, validateApplicationFile, validateApplicationPayload, validateInternshipAcademicProfile, type ApplicationDocumentRef, type InternshipAcademicProfile, type PublicApplicationResult } from "@/lib/recruitment/publicApi";
import DocumentRequirementStep, {
  EMPTY_EDUCATION_DECLARATION,
  type EducationDeclaration,
  type SelectedDocuments,
} from "@/components/careers/DocumentRequirementStep";
import {
  publicDocumentCheck,
  publicStageGate,
  type DocumentChecklist,
} from "@/lib/recruitment/documentControl";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import EducationHistorySection from "@/components/careers/EducationHistorySection";
import { persistedEducationKeys, synthesisedAcademicRequirements } from "@/lib/recruitment/educationEvidence";
import {
  EMPTY_OTHER_QUALIFICATION,
  EMPTY_QUALIFICATION_RECORD,
  EMPTY_SCHOOL_RECORD,
  EMPTY_TERTIARY_RECORD,
  educationDataBlockers,
  educationPolicyFromVacancy,
  transcriptRequirements,
  evaluateEducationGate,
  type OtherQualification,
  type QualificationRecord,
  type SchoolRecord,
  type TertiaryRecord,
} from "@/lib/recruitment/education";

import { APPLICATION_STEPS, EMPTY_INTERNSHIP_PERSONAL, stepBlockers, stepLabel, submissionReady, type InternshipPersonalDetails, type StepGateState } from "@/lib/recruitment/applicationSteps";
import {
  EMPTY_INTERNSHIP_INSURANCE,
  EMPTY_PREVIOUS_ATTACHMENT,
  MIN_ATTACHMENT_DAYS,
  ageOn,
  evaluateAttachmentGate,
  serverAttachmentGate,
  validateAttachmentPeriod,
  validateInsurancePeriod,
  type InternshipInsurance,
  type PreviousAttachment,
} from "@/lib/recruitment/internshipAttachment";

import {
  classifyApplicationFailure,
  type ClassifiedApplicationFailure,
} from "@/lib/recruitment/applicationFailure";
import {
  careersClientIdentity,
  contractBlockMessage,
  isContractBlocking,
  reloadToCurrentBuild,
  type ApplicationContract,
} from "@/lib/recruitment/careersContract";
import { notifyCompatibilityBlock } from "@/lib/recruitment/candidateRemediation";


interface Row { [k: string]: string }

const ACADEMIC_FIELDS = ["institution", "qualification", "grade", "year_completed"] as const;
const EMPLOYMENT_FIELDS = ["employer", "role", "start_date", "end_date", "responsibilities"] as const;

/** Stable empty maps so read-only consumers keep referential identity. */
const EMPTY_DOCUMENTS: SelectedDocuments = Object.freeze({});
const EMPTY_PERSISTED: Record<string, ApplicationDocumentRef> = Object.freeze({});

const humanise = (f: string) => f.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const STEPS = APPLICATION_STEPS;

/** Academic context an internship programme requires from the applicant. */
interface AcademicState {
  institution: string; institution_type: string; programme: string;
  qualification_level: string; specialisation: string;
  year_of_study: string; semester: string; academic_stage: string;
  relevant_courses: string; attachment_done: boolean; attachment_detail: string;
  projects: string; portfolio_url: string;
  learning_objectives: string; expected_outcomes: string;
}

const EMPTY_ACADEMIC: AcademicState = {
  institution: "", institution_type: "", programme: "",
  qualification_level: "", specialisation: "",
  year_of_study: "", semester: "", academic_stage: "",
  relevant_courses: "", attachment_done: false, attachment_detail: "",
  projects: "", portfolio_url: "",
  learning_objectives: "", expected_outcomes: "",
};

const listOf = (value: string): string[] =>
  value.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);

interface FormState {
  full_name: string; email: string; phone: string; location: string;
  cover_letter: string;
  academic: Row[]; employment: Row[];
  answers: Record<string, unknown>;
}

const EMPTY: FormState = {
  full_name: "", email: "", phone: "", location: "",
  cover_letter: "",
  academic: [{}], employment: [{}], answers: {},
};

function RepeatableSection({
  title, help, fields, rows, setRows,
}: {
  title: string; help: string; fields: readonly string[];
  rows: Row[]; setRows: (r: Row[]) => void;
}) {
  return (
    <section className="p-5 rounded-xl bg-card border border-border space-y-4">
      <div>
        <h2 className="font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{help}</p>
      </div>
      {rows.map((row, idx) => (
        <div key={idx} className="grid gap-3 sm:grid-cols-2 pb-4 border-b border-border last:border-0">
          {fields.map((f) => (
            <div key={f} className="space-y-1.5">
              <Label htmlFor={`${title}-${idx}-${f}`}>{humanise(f)}</Label>
              <Input
                id={`${title}-${idx}-${f}`}
                value={row[f] ?? ""}
                onChange={(e) => {
                  const next = [...rows];
                  next[idx] = { ...next[idx], [f]: e.target.value };
                  setRows(next);
                }}
              />
            </div>
          ))}
          {rows.length > 1 && (
            <div className="sm:col-span-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setRows(rows.filter((_, i) => i !== idx))}>
                <Trash2 className="h-4 w-4 mr-1" aria-hidden="true" />Remove entry
              </Button>
            </div>
          )}
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => setRows([...rows, {}])}>
        <Plus className="h-4 w-4 mr-1" aria-hidden="true" />Add entry
      </Button>
    </section>
  );
}

/**
 * Shown when the handshake proves this bundle cannot satisfy the authoritative
 * application contract. The candidate is never told they did something wrong,
 * and they can have their saved application emailed to them with a private
 * continuation link so the interruption costs them nothing.
 */
function CompatibilityBlockScreen({
  contract, slug, defaultEmail, documents,
}: {
  contract: ApplicationContract;
  slug: string;
  defaultEmail: string;
  documents: ApplicationDocumentRef[];
}) {
  const block = contractBlockMessage(contract);
  const [email, setEmail] = useState(defaultEmail);
  const [sent, setSent] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const send = async () => {
    setSending(true);
    const notice = await notifyCompatibilityBlock({
      slug: slug || null,
      email: email.trim(),
      verdict: contract.verdict,
      reason: contract.reason,
      documents,
    });
    setSending(false);
    if (notice.queued) {
      setSent(notice.continue_url ?? null);
      toast.success("Your saved application is on its way to your inbox.");
    } else if (notice.reason === "rate_limited") {
      toast.info("We have already sent you that message — please check your inbox.");
    } else {
      toast.error("We could not send that message. Reload the form and continue here instead.");
    }
  };

  return (
    <MarketingPage>
      <div className="container mx-auto px-4 py-24 max-w-2xl text-center" role="alert" aria-live="assertive">
        <RefreshCw className="h-10 w-10 text-primary mx-auto mb-4" aria-hidden="true" />
        <h1 className="text-2xl font-bold mb-3">{block.title}</h1>
        <p className="text-muted-foreground mb-2">{block.detail}</p>
        <p className="text-muted-foreground mb-6">{block.action}</p>
        <Button onClick={() => void reloadToCurrentBuild()}>Reload the application form</Button>

        <div className="mt-10 text-left rounded-xl border border-border bg-card p-6">
          <h2 className="font-semibold mb-1">Prefer to continue later?</h2>
          <p className="text-sm text-muted-foreground mb-4">
            We will email you a private link to your saved application, together with the steps to finish it.
          </p>
          {sent ? (
            <p className="text-sm">
              Sent. You can also continue now:{" "}
              <Link className="underline" to={sent}>open my saved application</Link>.
            </p>
          ) : (
            <form
              className="flex flex-wrap gap-3 items-end"
              onSubmit={(e) => { e.preventDefault(); void send(); }}
            >
              <div className="flex-1 min-w-[220px]">
                <Label htmlFor="block-email">Your email address</Label>
                <Input
                  id="block-email" type="email" value={email} required
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </div>
              <Button type="submit" variant="outline" disabled={sending || email.trim().length < 5}>
                {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Email me my application"}
              </Button>
            </form>
          )}
        </div>

        <p className="mt-6 text-xs text-muted-foreground">
          Reference {contract.client.build_id} · contract{" "}
          {contract.client.api_contract_version}/{contract.authoritative?.api_contract_version ?? "?"}
        </p>
      </div>
    </MarketingPage>
  );
}


export default function CareerApply() {
  const { slug = "" } = useParams();
  const [params] = useSearchParams();

  /**
   * ONE server call establishes the compatibility handshake, the form blueprint
   * and the vacancy detail. Three sequential round trips on the application
   * entry path were the largest controllable component of read latency.
   */
  const boot = useQuery({
    queryKey: ["public", "application-bootstrap", slug],
    queryFn: () => getApplicationBootstrap(slug),
    ...PUBLIC_VACANCY_QUERY_OPTIONS,
  });

  const bp = {
    data: boot.data?.blueprint,
    isLoading: boot.isLoading,
    error: boot.error,
  };

  const contract = useMemo(
    () => ({
      data: boot.data
        ? ({
            ...(boot.data.contract ?? { verdict: "UNVERIFIED" }),
            client: careersClientIdentity(),
          } as ApplicationContract)
        : undefined,
      isLoading: boot.isLoading,
    }),
    [boot.data, boot.isLoading],
  );




  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [consent, setConsent] = useState(false);
  const [declaration, setDeclaration] = useState(false);
  const [talentPool, setTalentPool] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [result, setResult] = useState<PublicApplicationResult | null>(null);
  const [academic, setAcademic] = useState<AcademicState>(EMPTY_ACADEMIC);
  // Document requirement engine state: declaration drives the requirement set,
  // selected files are keyed by requirement so per-year transcripts stay distinct.
  const [education, setEducation] = useState<EducationDeclaration>(EMPTY_EDUCATION_DECLARATION);
  // Document evidence is chosen and persisted on the Documents step; the
  // Education stage only reads these maps, so they stay stable empties here.
  const docFiles: SelectedDocuments = EMPTY_DOCUMENTS;
  // Candidate confirmations against the vacancy's mandatory requirements.
  // The requirement set is resolved here, at the top of the flow, so the
  // Education stage never waits for the later Documents step to mount — that
  // dependency is what left the academic ledger stuck at "0 of 0 attached".
  /**
   * Documents already persisted in storage during an earlier submission attempt,
   * keyed by requirement. A refused submission must not orphan the upload or
   * make the candidate send the same certificate twice.
   */
  const persisted: Record<string, ApplicationDocumentRef> = EMPTY_PERSISTED;
  // Education-stage evidence: which requirement is uploading, and the server's
  // refusal reasons when the authoritative stage gate declines an advance.
  const [stageChecking, setStageChecking] = useState(false);
  const [stageRefusal, setStageRefusal] = useState<string[] | null>(null);
  const [failure, setFailure] = useState<ClassifiedApplicationFailure | null>(null);
  /** Internship intake: statutory personal details. */
  const [intern, setIntern] = useState<InternshipPersonalDetails>(EMPTY_INTERNSHIP_PERSONAL);
  const setIp = useCallback(
    <K extends keyof InternshipPersonalDetails>(key: K, value: InternshipPersonalDetails[K]) =>
      setIntern((prev) => ({ ...prev, [key]: value })),
    [],
  );

  /**
   * Internship-only: the previous industrial attachment, its supervisor, and the
   * insurance cover. Evidence files are held here until submission so a refused
   * attempt never orphans an upload.
   */
  const [attach, setAttach] = useState<PreviousAttachment>(EMPTY_PREVIOUS_ATTACHMENT);
  const [insurance, setInsurance] = useState<InternshipInsurance>(EMPTY_INTERNSHIP_INSURANCE);
  const [recommendation, setRecommendation] = useState<File | null>(null);
  const [insuranceDoc, setInsuranceDoc] = useState<File | null>(null);
  const setAt = useCallback(
    <K extends keyof PreviousAttachment>(key: K, value: PreviousAttachment[K]) =>
      setAttach((prev) => ({ ...prev, [key]: value })),
    [],
  );
  const setIns = useCallback(
    <K extends keyof InternshipInsurance>(key: K, value: InternshipInsurance[K]) =>
      setInsurance((prev) => ({ ...prev, [key]: value })),
    [],
  );

  /** Structured education history (4 sections) for internship intake. */
  const [primaryEdu, setPrimaryEdu] = useState<SchoolRecord>(EMPTY_SCHOOL_RECORD);
  const [secondaryEdu, setSecondaryEdu] = useState<SchoolRecord>(EMPTY_SCHOOL_RECORD);
  const [tertiary, setTertiary] = useState<TertiaryRecord>(EMPTY_TERTIARY_RECORD);
  const [qual, setQual] = useState<QualificationRecord>(EMPTY_QUALIFICATION_RECORD);
  const [otherQual, setOtherQual] = useState<OtherQualification>(EMPTY_OTHER_QUALIFICATION);
  const setPe = useCallback(<K extends keyof SchoolRecord>(k: K, v: SchoolRecord[K]) =>
    setPrimaryEdu((p) => ({ ...p, [k]: v })), []);
  const setSe = useCallback(<K extends keyof SchoolRecord>(k: K, v: SchoolRecord[K]) =>
    setSecondaryEdu((p) => ({ ...p, [k]: v })), []);
  const setTe = useCallback(<K extends keyof TertiaryRecord>(k: K, v: TertiaryRecord[K]) =>
    setTertiary((p) => ({ ...p, [k]: v })), []);
  const setQu = useCallback(<K extends keyof QualificationRecord>(k: K, v: QualificationRecord[K]) =>
    setQual((p) => ({ ...p, [k]: v })), []);
  const setOq = useCallback(<K extends keyof OtherQualification>(k: K, v: OtherQualification[K]) =>
    setOtherQual((p) => ({ ...p, [k]: v })), []);



  // Internship programmes collect an academic profile and route through the
  // internship intake so the internal pipeline opens on submission.
  const internship = useQuery({
    queryKey: ["public", "internship", slug],
    queryFn: () => getPublicInternship(slug),
    ...PUBLIC_VACANCY_QUERY_OPTIONS,
  });
  const isInternship = !!internship.data;

  const setAc = useCallback(<K extends keyof AcademicState>(key: K, value: AcademicState[K]) => {
    setAcademic((prev) => ({ ...prev, [key]: value }));
  }, []);

  const supervisor = useMemo(
    () => ({
      name: intern.supervisor_name,
      title: intern.supervisor_title,
      email: intern.supervisor_email,
      phone: intern.supervisor_phone,
    }),
    [intern.supervisor_name, intern.supervisor_title, intern.supervisor_email, intern.supervisor_phone],
  );

  /** One evaluation drives the step gate, the readiness panel and submission. */
  const attachmentGate = useMemo(
    () =>
      evaluateAttachmentGate({
        attachment: attach,
        insurance,
        supervisor,
        dateOfBirth: intern.date_of_birth,
        recommendationAttached: !!recommendation,
        insuranceDocumentAttached: !!insuranceDoc,
      }),
    [attach, insurance, supervisor, intern.date_of_birth, recommendation, insuranceDoc],
  );

  const attachmentPeriod = validateAttachmentPeriod(attach.start_date, attach.end_date);
  const coverPeriod = validateInsurancePeriod(insurance.valid_from, insurance.valid_to);
  const internAge = ageOn(intern.date_of_birth);

  /**
   * Education & qualifications module. The vacancy requirement configuration
   * drives the policy, and one evaluation feeds the section ledger, the step
   * gate and the submission gate.
   */
  const educationPolicy = useMemo(
    () => educationPolicyFromVacancy(bp.data?.blueprint ?? null),
    [bp.data?.blueprint],
  );
  /**
   * Requirement engine — resolved for the whole flow, not per step. The
   * structured education record (section 3) is the only context it consumes.
   */
  const requirementSlug = bp.data?.canonical_slug ?? slug;
  const requirementContext = useMemo(
    () => ({
      education_status: education.education_status || null,
      qualification_level: education.qualification_level || null,
      completed_years: education.completed_years ? Number(education.completed_years) : null,
      consolidated_transcript: education.consolidated_transcript,
      documents: [] as never[],
    }),
    [education],
  );
  const requirementQuery = useQuery({
    queryKey: ["public", "document-requirements", requirementSlug, requirementContext],
    queryFn: () => publicDocumentCheck(requirementSlug, requirementContext),
    enabled: !!requirementSlug,
    staleTime: 0,
  });
  const serverRequirements = requirementQuery.data?.items ?? [];
  const graduationCertificateRequired = useMemo(
    () => serverRequirements.some((i) => i.mandatory && i.doc_class === "graduation"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [requirementQuery.data],
  );
  /**
   * Transcript and graduation evidence the Education gate demands but the
   * vacancy rules do not publish are synthesised, so every gated academic
   * document has an upload control. Without this the stage is unsatisfiable.
   */
  const academicRequirements = useMemo(
    () =>
      synthesisedAcademicRequirements(serverRequirements, {
        transcriptKeys: isInternship && educationPolicy.transcript_required
          ? transcriptRequirements(tertiary)
          : [],
        graduationCertificateRequired,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [requirementQuery.data, isInternship, educationPolicy.transcript_required, tertiary, graduationCertificateRequired],
  );
  const persistedRequirementKeys = useMemo(() => Object.keys(persisted), [persisted]);
  /**
   * A requirement counts as satisfied once a validated file is chosen or an
   * earlier attempt already persisted it. Persistence is re-checked on submit.
   */
  const docChecklist: DocumentChecklist | null = useMemo(() => {
    if (!requirementQuery.data) return null;
    const evaluated = [...serverRequirements, ...academicRequirements].map((item) => ({
      ...item,
      state: docFiles[item.requirement_key] || persisted[item.requirement_key]
        ? ("uploaded" as const)
        : item.mandatory
          ? ("missing" as const)
          : ("not_provided" as const),
    }));
    const mandatory = evaluated.filter((i) => i.mandatory);
    const satisfied = mandatory.filter((i) => i.state === "uploaded");
    return {
      open: requirementQuery.data.open,
      complete: mandatory.length === satisfied.length,
      mandatory_total: mandatory.length,
      mandatory_satisfied: satisfied.length,
      completion_percent: mandatory.length === 0
        ? 100
        : Math.round((satisfied.length / mandatory.length) * 100),
      missing: mandatory.filter((i) => i.state !== "uploaded").map((i) => i.label),
      items: evaluated,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requirementQuery.data, academicRequirements, docFiles, persisted]);
  /**
   * Academic evidence is uploaded on the Education stage itself and persisted
   * immediately, so the gate reasons about documents that actually exist in
   * storage — never about browser file state.
   */
  const educationPersisted = useMemo(
    () => persistedEducationKeys(docChecklist?.items, persistedRequirementKeys),
    [docChecklist, persistedRequirementKeys],
  );
  const educationGate = useMemo(
    () =>
      evaluateEducationGate({
        policy: educationPolicy,
        primary: primaryEdu,
        secondary: secondaryEdu,
        tertiary,
        qualification: qual,
        otherQualification: otherQual,
        persistedDocuments: educationPersisted,
        graduationCertificateRequired,
      }),
    [
      educationPolicy, primaryEdu, secondaryEdu, tertiary, qual, otherQual,
      educationPersisted, graduationCertificateRequired,
    ],
  );

  /**
   * Section 3 is the single source of truth for the document requirement
   * engine — the candidate never declares their level or transcript mode twice.
   */
  useEffect(() => {
    if (!isInternship) return;
    setEducation((prev) => {
      const next: EducationDeclaration = {
        education_status: "graduated",
        qualification_level: tertiary.qualification_level || "",
        graduation_date: prev.graduation_date,
        completed_years: tertiary.duration_years ? String(tertiary.duration_years) : "",
        consolidated_transcript: tertiary.transcript_mode === "consolidated",
      };
      return prev.education_status === next.education_status
        && prev.qualification_level === next.qualification_level
        && prev.completed_years === next.completed_years
        && prev.consolidated_transcript === next.consolidated_transcript
        ? prev
        : next;
    });
  }, [isInternship, tertiary.completion_status, tertiary.qualification_level, tertiary.duration_years, tertiary.transcript_mode]);

  /**
   * The structured education record is the single source of the academic
   * history sent with the application — interns never retype it as free text.
   */
  useEffect(() => {
    if (!isInternship) return;
    const rows = [
      {
        institution: tertiary.institution,
        qualification: [qual.qualification_type, qual.programme].filter(Boolean).join(" — "),
        start_date: tertiary.admission_date,
        end_date: tertiary.completion_date,
        grade: qual.award_classification,
      },
      { institution: secondaryEdu.name, qualification: "Secondary education", start_date: secondaryEdu.start_date, end_date: secondaryEdu.end_date, grade: "" },
      { institution: primaryEdu.name, qualification: "Primary education", start_date: primaryEdu.start_date, end_date: primaryEdu.end_date, grade: "" },
      ...(otherQual.name
        ? [{ institution: otherQual.institution, qualification: otherQual.name, start_date: "", end_date: otherQual.award_date, grade: "" }]
        : []),
    ].filter((r) => Object.values(r).some(Boolean));
    setForm((prev) =>
      JSON.stringify(prev.academic) === JSON.stringify(rows) ? prev : { ...prev, academic: rows },
    );
  }, [isInternship, primaryEdu, secondaryEdu, tertiary, qual, otherQual]);



  // For internship intake the legal name is composed from the statutory fields,
  // so the candidate never types their name twice.
  useEffect(() => {
    if (!isInternship) return;
    const composed = `${intern.other_names} ${intern.last_name}`.replace(/\s+/g, " ").trim();
    setForm((prev) => (prev.full_name === composed ? prev : { ...prev, full_name: composed }));
  }, [isInternship, intern.other_names, intern.last_name]);


  // Funnel signal: the visitor reached the application form.
  const startSlug = bp.data?.canonical_slug ?? (bp.data?.open ? slug : "");
  useEffect(() => {
    if (startSlug) trackAnnouncementEvent(startSlug, "APPLICATION_START");
  }, [startSlug]);

  const set = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const blueprint = bp.data?.blueprint ?? null;
  const sections = blueprint?.sections ?? { education: true, qualifications: true, employment: true, skills: true };
  const coverLetterMode = blueprint?.cover_letter_mode ?? "optional";

  const draftPayload = useMemo(() => ({ ...form, consent, declaration, talentPool }), [form, consent, declaration, talentPool]);

  // Resume a saved application when arriving via the resume link.
  const resumeEmail = params.get("resume");
  useEffect(() => {
    if (!resumeEmail || !slug) return;
    void loadApplicationDraft<typeof draftPayload>(slug, resumeEmail)
      .then((d) => {
        if (!d.found || !d.payload) return;
        const p = d.payload as FormState & { consent?: boolean; declaration?: boolean; talentPool?: boolean };
        setForm({ ...EMPTY, ...p, answers: p.answers ?? {} });
        setConsent(!!p.consent);
        setDeclaration(!!p.declaration);
        setTalentPool(!!p.talentPool);
        setStep(Math.min(Math.max((d.step ?? 1) - 1, 0), STEPS.length - 1));
        setSavedAt(d.saved_at ?? null);
        toast.success("We restored your saved application.");
      })
      .catch(() => toast.error("We could not restore that saved application."));
     
  }, [resumeEmail, slug]);

  const saveDraft = useMutation({
    mutationFn: async () => {
      if (!form.email.trim()) throw new Error("Enter your email address so we can save your progress.");
      return saveApplicationDraft(slug, form.email.trim(), draftPayload, step + 1);
    },
    onSuccess: (r) => {
      setSavedAt(r.saved_at);
      toast.success("Progress saved. Use the resume link on this device to continue later.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const submit = useMutation({
    mutationFn: async () => {
      if (!consent) throw new Error("Please acknowledge the recruitment privacy notice.");
      if (!declaration) throw new Error("Please confirm the information provided is accurate.");
      if (coverLetterMode === "required" && form.cover_letter.trim().length < 50) {
        throw new Error("A cover letter is required for this vacancy.");
      }
      if (!education.graduation_date.trim()) throw new Error("Enter the date you graduated.");
      if (!education.qualification_level.trim()) throw new Error("Select your qualification.");

      // No documents are attached at application stage.
      const docs: ApplicationDocumentRef[] = [];


      // Internship intake: eligibility and attachment evidence are decided by
      // the server, with the browser rules as the fast mirror. Neither side can
      // be bypassed by editing the page.
      if (isInternship) {
        if (attachmentGate.ineligible) throw new Error(attachmentGate.ineligibleReason!);
        if (!attachmentGate.ok) {
          throw new Error(`Attachment details are incomplete: ${attachmentGate.missing.join(", ")}`);
        }
        const server = await serverAttachmentGate({
          attachment: attach,
          insurance,
          supervisor,
          date_of_birth: intern.date_of_birth,
          recommendation_attached: !!recommendation,
          insurance_document_attached: !!insuranceDoc,
        });
        if (server.available && !server.ok) {
          throw new Error(
            server.missing.length
              ? `Attachment details did not pass verification: ${server.missing.join(", ")}`
              : (server.reason ?? "Attachment details did not pass verification."),
          );
        }
        for (const [file, key] of [
          [recommendation, "attachment_recommendation_letter"],
          [insuranceDoc, "internship_insurance_cover"],
        ] as Array<[File | null, string]>) {
          if (!file) continue;
          const problem = validateApplicationFile(file);
          if (problem) throw new Error(problem);
          docs.push(await uploadApplicationDocument(slug, file, "supporting", { doc_key: key }));
        }
      }

      const clean = (rows: Row[]) => rows.filter((r) => Object.values(r).some((v) => (v ?? "").trim().length > 0));

      const payload = {
        vacancy_slug: bp.data?.canonical_slug ?? slug,
        full_name: form.full_name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        location: form.location.trim(),
        cover_letter: form.cover_letter.trim(),
        academic_qualifications: clean(form.academic),
        professional_qualifications: [],
        employment_history: isInternship ? [] : clean(form.employment),
        skills: [],
        documents: docs,
        education_status: education.education_status || null,
        qualification_level: education.qualification_level || null,
        completed_years: education.completed_years ? Number(education.completed_years) : null,
        consolidated_transcript: education.consolidated_transcript,
        answers: isInternship
          ? {
              ...form.answers,
              internship_personal_details: intern,
              internship_previous_attachment: {
                ...attach,
                inclusive_days: attachmentPeriod.days,
                duration_description: attachmentPeriod.description,
              },
              internship_insurance: { ...insurance, cover_days: coverPeriod.days },
              internship_age_years: internAge,
            }
          : form.answers,


        consent_privacy: consent,
        declaration_accuracy: declaration,
        consent_talent_pool: talentPool,
        source_detail: "careers_web",
      };

      const problems = validateApplicationPayload(payload);
      if (problems.length > 0) throw new Error(problems[0]);

      if (isInternship) {
        // Education & qualifications is a structured record: the same evaluation
        // the candidate saw on the Education step gates the submission.
        if (!educationGate.ok) {
          throw new Error(`Education record incomplete. ${educationGate.missing[0]}`);
        }
        const academic_profile: InternshipAcademicProfile = {
          institution: tertiary.institution,
          institution_type: academic.institution_type,
          programme: tertiary.programme,
          qualification_level: tertiary.qualification_level,
          specialisation: qual.specialisation,
          year_of_study: tertiary.duration_years,
          semester: academic.semester ? Number(academic.semester) : null,
          academic_stage: tertiary.completion_status === "COMPLETED" ? "Completed" : academic.academic_stage,
          relevant_courses: listOf(academic.relevant_courses),

          // Authoritative source for the attachment claim is Section B.
          attachment_done: attach.undertaken === "yes",
          attachment_detail: [
            attach.org_name,
            [attach.town, attach.country].filter(Boolean).join(", "),
            attach.org_url,

            attachmentPeriod.description
              ? `${attach.start_date} to ${attach.end_date} (${attachmentPeriod.description})`
              : "",
          ].filter(Boolean).join(" · "),

          projects: listOf(academic.projects),
          skills: payload.skills,
          portfolio_url: academic.portfolio_url,
          work_experience: form.cover_letter.trim() || null,
          learning_objectives: listOf(academic.learning_objectives),
          expected_outcomes: listOf(academic.expected_outcomes),
        };
        // Only genuinely required academic facts block a submission; an
        // undeclared qualification level is a triage note, not a barrier.
        const academicCheck = validateInternshipAcademicProfile(academic_profile);
        if (academicCheck.errors.length > 0) throw new Error(academicCheck.errors[0]);
        return submitPublicInternshipApplication({ ...payload, academic_profile });
      }


      return submitPublicApplication(payload);
    },
    onSuccess: (r) => {
      clearResumeToken(slug);
      setFailure(null);
      setResult(r);
      toast.success(r.duplicate ? "You have already applied for this role" : "Application submitted");
    },
    /**
     * A refused submission must never look like lost work. The completed answers
     * are written to the resumable draft immediately, the refusal is classified
     * so the candidate is told exactly what is outstanding, and a platform-caused
     * failure is never presented as the candidate's mistake.
     */
    onError: (e: Error) => {
      const classified = classifyApplicationFailure(e);
      setFailure(classified);
      toast.error(classified.message);
      if (form.email.trim()) {
        void saveApplicationDraft(slug, form.email.trim(), draftPayload, step + 1)
          .then((r) => setSavedAt(r.saved_at))
          .catch(() => undefined);
      }
    },
  });


  /**
   * Contract integrity gate (INC-2026-08-31). A bundle older than the
   * authoritative application contract is stopped here — before the candidate
   * uploads anything — instead of being allowed to submit and then receive a
   * business-validation refusal it could never have satisfied.
   */
  if (contract.isLoading || bp.isLoading) {
    return (
      <MarketingPage>
        <div className="container mx-auto px-4 py-24 max-w-3xl space-y-4">
          <Skeleton className="h-10 w-2/3" /><Skeleton className="h-64" />
        </div>
      </MarketingPage>
    );
  }

  if (isContractBlocking(contract.data)) {
    return (
      <CompatibilityBlockScreen
        contract={contract.data!}
        slug={slug}
        defaultEmail={form.email}
        documents={Object.values(persisted)}
      />
    );
  }



  if (bp.error || !bp.data?.open || !bp.data.vacancy) {
    return (
      <MarketingPage>
        <div className="container mx-auto px-4 py-24 max-w-2xl text-center">
          <h1 className="text-2xl font-bold mb-3">Applications are closed for this role</h1>
          <p className="text-muted-foreground mb-6">This vacancy is not currently open for applications.</p>
          <Button asChild><Link to="/careers">View current openings</Link></Button>
        </div>
      </MarketingPage>
    );
  }

  const v = bp.data.vacancy;
  const notice = bp.data.privacy_notice ?? null;

  if (result) {
    return (
      <MarketingPage>
        <div className="container mx-auto px-4 py-24 max-w-2xl text-center">
          <CheckCircle2 className="h-12 w-12 text-primary mx-auto mb-4" aria-hidden="true" />
          <h1 className="text-2xl font-bold mb-2">
            {result.duplicate ? "You have already applied" : "Application received"}
          </h1>
          <p className="text-muted-foreground mb-6">
            {result.duplicate
              ? `Our records already hold an application from you for ${result.vacancy_title}.`
              : `Thank you for applying for ${result.vacancy_title}. Our recruitment team will review your application and be in touch.`}
          </p>
          <div className="p-5 rounded-xl bg-card border border-border inline-block mb-8">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Application reference</p>
            <p className="text-xl font-semibold tabular-nums">{result.application_no}</p>
          </div>
          <div>
            <Button asChild variant="outline"><Link to="/careers">Back to careers</Link></Button>
          </div>
        </div>
      </MarketingPage>
    );
  }

  const isLast = step === STEPS.length - 1;

  // Candidate-facing completeness mirror: each step reports exactly what is
  // outstanding, advancing is blocked until the current step is clear, and
  // submission is only offered once every step is clear.
  const gateState: StepGateState = {
    form: {
      full_name: form.full_name,
      email: form.email,
      phone: form.phone,
      cover_letter: form.cover_letter,
      answers: form.answers,
      academic: form.academic as unknown as Array<Record<string, string>>,
      employment: form.employment as unknown as Array<Record<string, string>>,
    },
    sections,
    coverLetterMode: coverLetterMode as "none" | "optional" | "required",
    isInternship,
    academicProfile: {
      institution: tertiary.institution,
      programme: tertiary.programme,
      qualification_level: tertiary.qualification_level,
    },

    internshipPersonal: intern,
    attachmentGate: isInternship ? attachmentGate : undefined,

    qualification: {
      graduation_date: education.graduation_date,
      qualification_level: education.qualification_level,
    },
    consent,
    declaration,
  };
  /**
   * Education is an evidence gate, not a form. Structured academic data AND the
   * persisted certificates/transcripts it demands both block the Education step,
   * and `rec_public_stage_gate` enforces the same rule server-side on advance.
   */
  const educationBlockers = isInternship ? educationDataBlockers(educationGate) : [];

  const blockersFor = (i: number) => [...stepBlockers(i, gateState), ...(i === 1 ? educationBlockers : [])];
  const currentBlockers = blockersFor(step);
  const baseReadiness = submissionReady(gateState);
  const readiness = {
    ready: baseReadiness.ready && educationBlockers.length === 0,
    blockers: [...baseReadiness.blockers, ...educationBlockers.map((b) => `Education: ${b}`)],
  };
  const stepStatus = STEPS.map((_, i) => blockersFor(i).length === 0);
  const advanceBlocked = isLast ? !readiness.ready : currentBlockers.length > 0 || stageChecking;


  /**
   * Forward navigation. Leaving Education asks the server for permission: it
   * re-evaluates the academic record and the persisted evidence, so the stage
   * cannot be crossed by editing the page. When the gate itself is unreachable
   * the browser mirror stands and submission remains server-enforced.
   */
  const advance = async () => {
    const nextStep = Math.min(step + 1, STEPS.length - 1);
    if (isInternship && step === 1) {
      setStageChecking(true);
      try {
        const verdict = await publicStageGate(bp.data?.canonical_slug ?? slug, "profession", {
          draft_ref: form.email.trim() || null,
          education: {
            primary: primaryEdu,
            secondary: secondaryEdu,
            tertiary,
            qualification: qual,
          },
          documents: Object.values(persisted),
        });
        if (verdict.available && !verdict.allowed) {
          setStageRefusal(verdict.outstanding.length ? verdict.outstanding : [
            "Your academic record and evidence did not pass verification.",
          ]);
          toast.error("Education stage incomplete — see the outstanding items.");
          return;
        }
      } finally {
        setStageChecking(false);
      }
    }
    setStageRefusal(null);
    setStep(nextStep);
  };




  return (
    <MarketingPage>
      <PageHero
        eyebrow={`Apply · Ref ${v.vacancy_no}`}
        title={v.title}
        subtitle="Your application enters our recruitment system immediately. You can save and return at any point."
      />

      <section className="container mx-auto px-4 py-14 max-w-3xl">
        <Link to={`/careers/${bp.data.canonical_slug ?? slug}`} className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-6">
          <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" /> Back to role details
        </Link>

        <div className="mb-8 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium">Step {step + 1} of {STEPS.length} · {STEPS[step]}</p>
            <div className="flex items-center gap-3">
              {savedAt ? (
                <span className="text-xs text-muted-foreground">Saved {new Date(savedAt).toLocaleTimeString()}</span>
              ) : null}
              <Button type="button" variant="outline" size="sm" onClick={() => saveDraft.mutate()} disabled={saveDraft.isPending}>
                {saveDraft.isPending
                  ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  : <><Save className="h-4 w-4 mr-1" aria-hidden="true" />Save &amp; finish later</>}
              </Button>
            </div>
          </div>
          <Progress value={((step + 1) / STEPS.length) * 100} />
          <ol className="flex flex-wrap gap-2" aria-label="Application progress">
            {STEPS.map((label, i) => {

              const done = stepStatus[i];
              const current = i === step;
              return (
                <li key={label}>
                  <button
                    type="button"
                    // Backwards navigation is always allowed; forward only into
                    // steps whose predecessors are complete.
                    onClick={() => {
                      if (i <= step || stepStatus.slice(0, i).every(Boolean)) setStep(i);
                    }}
                    aria-current={current ? "step" : undefined}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors ${
                      current
                        ? "border-primary bg-primary/10 text-foreground font-medium"
                        : done
                          ? "border-border text-muted-foreground"
                          : "border-destructive/40 text-destructive"
                    }`}
                  >
                    {done
                      ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                      : <FileWarning className="h-3.5 w-3.5" aria-hidden="true" />}
                    {i + 1}. {stepLabel(i, isInternship)}
                    <span className="sr-only">{done ? " complete" : " incomplete"}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>

        <form
          className="space-y-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (advanceBlocked) return;
            if (isLast) { submit.mutate(); return; }
            void advance();
          }}
        >

          {step === 0 && (
            <>
              {!isInternship && (
                <section className="p-5 rounded-xl bg-card border border-border space-y-4">
                  <h2 className="font-semibold">Personal details</h2>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Text label="Full name" required value={form.full_name} onChange={(x) => set("full_name", x)} />
                    <Text label="Email address" type="email" required value={form.email} onChange={(x) => set("email", x)} />
                    <Text label="Phone number" required value={form.phone} onChange={(x) => set("phone", x)} />
                    <Text label="Current location" value={form.location} onChange={(x) => set("location", x)} />
                  </div>
                </section>
              )}

              {isInternship && (
                <section className="p-5 rounded-xl bg-card border border-border space-y-4">
                  <div>
                    <h2 className="font-semibold">A. Personal details</h2>
                    <p className="text-sm text-muted-foreground">
                      Exactly as they appear on your national identity card. Your legal name is composed
                      from these fields — you do not enter it twice.
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Text label="Last name" required value={intern.last_name} onChange={(x) => setIp("last_name", x)} />
                    <Text label="Other names" required value={intern.other_names} onChange={(x) => setIp("other_names", x)} />
                    <div className="space-y-1.5">
                      <Label htmlFor="intern-gender">Gender *</Label>
                      <Select value={intern.gender} onValueChange={(x) => setIp("gender", x)}>
                        <SelectTrigger id="intern-gender"><SelectValue placeholder="Select" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Female">Female</SelectItem>
                          <SelectItem value="Male">Male</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Text label="National identity card no" required value={intern.national_id} onChange={(x) => setIp("national_id", x)} />
                    <div className="space-y-1.5">
                      <Label htmlFor="intern-dob">Date of birth *</Label>
                      <Input
                        id="intern-dob" type="date" required value={intern.date_of_birth}
                        aria-describedby="intern-dob-note"
                        onChange={(e) => setIp("date_of_birth", e.target.value)}
                      />
                      <p id="intern-dob-note" className="text-xs text-muted-foreground">
                        {internAge === null
                          ? "This programme is open to applicants aged 22–26."
                          : internAge < 22 || internAge > 26
                            ? `Recorded age ${internAge} — this programme is open to applicants aged 22–26.`
                            : `Recorded age ${internAge} — within the 22–26 eligibility range.`}
                      </p>
                    </div>
                    <Text label="Email address" type="email" required value={form.email} onChange={(x) => set("email", x)} />
                    <Text label="Mobile number" required value={form.phone} onChange={(x) => set("phone", x)} />
                    <Text label="Home telephone" required value={intern.telephone} onChange={(x) => setIp("telephone", x)} />
                    <Text label="Current location / town" value={form.location} onChange={(x) => set("location", x)} />
                    <Text label="Next of kin (name)" required value={intern.next_of_kin_name} onChange={(x) => setIp("next_of_kin_name", x)} />
                    <Text label="Relationship" required value={intern.next_of_kin_relationship} onChange={(x) => setIp("next_of_kin_relationship", x)} />
                    <Text label="Postal address" value={intern.postal_address} onChange={(x) => setIp("postal_address", x)} />
                    <Text label="Postal code" value={intern.postal_code} onChange={(x) => setIp("postal_code", x)} />
                    <Text label="Postal telephone no" value={intern.postal_tel} onChange={(x) => setIp("postal_tel", x)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="intern-home-address">Home address *</Label>
                    <Textarea
                      id="intern-home-address" rows={2} value={intern.home_address}
                      onChange={(e) => setIp("home_address", e.target.value)}
                    />
                  </div>
                </section>
              )}
            </>

          )}


          {step === 1 && (
            <>
              {isInternship && (
                <>
                  <EducationHistorySection
                    policy={educationPolicy}
                    verdict={educationGate}
                    primary={primaryEdu}
                    secondary={secondaryEdu}
                    tertiary={tertiary}
                    qualification={qual}
                    other={otherQual}
                    onPrimary={setPe}
                    onSecondary={setSe}
                    onTertiary={setTe}
                    onQualification={setQu}
                    onOther={setOq}
                  />
                  {stageRefusal && stageRefusal.length > 0 && (
                    <Alert variant="destructive" role="alert">
                      <AlertTitle>Education stage refused by the recruitment system</AlertTitle>
                      <AlertDescription>
                        <ul className="list-disc pl-5 text-sm">
                          {stageRefusal.map((r) => <li key={r}>{r}</li>)}
                        </ul>
                      </AlertDescription>
                    </Alert>
                  )}
                  <section className="p-5 rounded-xl bg-card border border-border space-y-4">
                    <div>
                      <h2 className="font-semibold">Learning goals</h2>
                      <p className="text-sm text-muted-foreground">
                        We assess internship applications on demonstrated capability and evidence — not on a
                        qualification title alone. Your industrial attachment is captured on the Attachment step.
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="ac-courses">Relevant coursework (comma separated)</Label>
                      <Textarea id="ac-courses" rows={2} value={academic.relevant_courses} onChange={(e) => setAc("relevant_courses", e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="ac-projects">Projects or practical work you can evidence</Label>
                      <Textarea id="ac-projects" rows={3} value={academic.projects} onChange={(e) => setAc("projects", e.target.value)} placeholder="One per line" />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="ac-objectives">What you want to learn</Label>
                        <Textarea id="ac-objectives" rows={3} value={academic.learning_objectives} onChange={(e) => setAc("learning_objectives", e.target.value)} placeholder="One per line" />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="ac-outcomes">What you expect to contribute</Label>
                        <Textarea id="ac-outcomes" rows={3} value={academic.expected_outcomes} onChange={(e) => setAc("expected_outcomes", e.target.value)} placeholder="One per line" />
                      </div>
                    </div>
                    <Text label="Portfolio or work sample link" value={academic.portfolio_url} onChange={(x) => setAc("portfolio_url", x)} />
                  </section>
                </>
              )}
              {sections.education !== false && !isInternship && (
                <RepeatableSection title="Academic qualifications" help="Highest qualification first." fields={ACADEMIC_FIELDS} rows={form.academic} setRows={(r) => set("academic", r)} />
              )}
            </>
          )}

          {step === 2 && (
            <>
              {isInternship ? (
                <>
                  <section className="p-5 rounded-xl bg-card border border-border space-y-4">
                    <div>
                      <h2 className="font-semibold">Eligibility: industrial attachment</h2>
                      <p className="text-sm text-muted-foreground">
                        This internship is open only to applicants who completed an industrial attachment
                        of at least 12 weeks ({MIN_ATTACHMENT_DAYS} calendar days) during their studies, evidenced by a
                        recommendation letter from that organisation.
                      </p>
                    </div>
                    <div className="space-y-1.5 max-w-sm">
                      <Label htmlFor="attach-undertaken">
                        Did you undertake an industrial attachment during your academic period? *
                      </Label>
                      <Select
                        value={attach.undertaken}
                        onValueChange={(x) => setAt("undertaken", x as "yes" | "no")}
                      >
                        <SelectTrigger id="attach-undertaken"><SelectValue placeholder="Select yes or no" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="yes">Yes — I completed an industrial attachment</SelectItem>
                          <SelectItem value="no">No — I have not undertaken one</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {attachmentGate.ineligible ? (
                      <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 space-y-2">
                        <p className="text-sm font-semibold">You cannot continue with this internship application</p>
                        <p className="text-sm text-muted-foreground">{attachmentGate.ineligibleReason}</p>
                        <p className="text-sm text-muted-foreground">
                          Nothing you entered has been lost. You can save this application and return if your
                          circumstances change, or view other roles on our careers page.
                        </p>
                        <div className="flex flex-wrap gap-2 pt-1">
                          <Button type="button" size="sm" variant="outline" asChild data-analytics="none">
                            <Link to="/careers">See other opportunities</Link>
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </section>

                  {attach.undertaken === "yes" && !attachmentGate.ineligible ? (
                    <>
                      <section className="p-5 rounded-xl bg-card border border-border space-y-4">
                        <div>
                          <h2 className="font-semibold">B. Previous place of attachment</h2>
                          <p className="text-sm text-muted-foreground">
                            The organisation where you completed your industrial attachment. Use its official
                            organisational email address — personal Gmail, Yahoo or Outlook addresses are not accepted.
                          </p>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Text label="Name of organisation" required value={attach.org_name} onChange={(x) => setAt("org_name", x)} />
                          <Text label="Organisational email address" type="email" required value={attach.org_email} onChange={(x) => setAt("org_email", x)} />
                          <Text label="Postal address / P.O. Box" required value={attach.po_box} onChange={(x) => setAt("po_box", x)} />
                          <Text label="Postal code" required value={attach.postal_code} onChange={(x) => setAt("postal_code", x)} />
                          <Text label="Town / city" required value={attach.town} onChange={(x) => setAt("town", x)} />
                          <Text label="County / region" value={attach.county} onChange={(x) => setAt("county", x)} />
                          <Text label="Country" required value={attach.country} onChange={(x) => setAt("country", x)} />
                          <Text label="Physical address / building" value={attach.physical_address} onChange={(x) => setAt("physical_address", x)} />
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Text
                            label="Organisation website or profile link"
                            required
                            value={attach.org_url}
                            onChange={(x) => setAt("org_url", x)}
                          />
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                          <Text label="Attachment start date" type="date" required value={attach.start_date} onChange={(x) => setAt("start_date", x)} />
                          <Text label="Attachment end date" type="date" required value={attach.end_date} onChange={(x) => setAt("end_date", x)} />
                        </div>
                        <p
                          className={`text-sm ${attachmentPeriod.ok ? "text-muted-foreground" : "text-destructive"}`}
                          role="status"
                          aria-live="polite"
                        >
                          {attachmentPeriod.ok
                            ? `Duration: ${attachmentPeriod.description} — the 12-week minimum is satisfied.`
                            : (attachmentPeriod.message ?? "")}
                        </p>
                        <div className="space-y-1.5">
                          <Label htmlFor="attach-letter">Recommendation letter from that organisation *</Label>
                          <Input
                            id="attach-letter"
                            type="file"
                            accept="application/pdf,image/png,image/jpeg"
                            onChange={(e) => {
                              const file = e.target.files?.[0] ?? null;
                              const problem = file ? validateApplicationFile(file) : null;
                              if (problem) { toast.error(problem); return; }
                              setRecommendation(file);
                            }}
                          />
                          <p className="text-xs text-muted-foreground">
                            {recommendation ? recommendation.name : "PDF, JPG or PNG on the organisation's letterhead."}
                          </p>
                        </div>
                      </section>

                      <section className="p-5 rounded-xl bg-card border border-border space-y-4">
                        <div>
                          <h2 className="font-semibold">C. Attachment supervisor / trainer</h2>
                          <p className="text-sm text-muted-foreground">
                            The person who supervised you at that organisation. We may contact them to verify
                            your attachment, so the email must be on the organisation's domain.
                          </p>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Text label="Supervisor name" required value={intern.supervisor_name} onChange={(x) => setIp("supervisor_name", x)} />
                          <Text label="Supervisor title" required value={intern.supervisor_title} onChange={(x) => setIp("supervisor_title", x)} />
                          <Text label="Supervisor organisational email" type="email" required value={intern.supervisor_email} onChange={(x) => setIp("supervisor_email", x)} />
                          <Text label="Supervisor telephone" required value={intern.supervisor_phone} onChange={(x) => setIp("supervisor_phone", x)} />
                        </div>
                      </section>

                      <section className="p-5 rounded-xl bg-card border border-border space-y-4">
                        <div>
                          <h2 className="font-semibold">D. Internship insurance cover</h2>
                          <p className="text-sm text-muted-foreground">
                            Personal accident or medical cover valid for at least six months from the start of
                            your internship, in the name of the person being insured.
                          </p>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Text label="Insurance provider" required value={insurance.provider} onChange={(x) => setIns("provider", x)} />
                          <Text label="Name of person insured" required value={insurance.insured_name} onChange={(x) => setIns("insured_name", x)} />
                          <Text label="Policy or reference number" required value={insurance.reference_no} onChange={(x) => setIns("reference_no", x)} />
                          <Text label="Cover start date" type="date" required value={insurance.valid_from} onChange={(x) => setIns("valid_from", x)} />
                          <Text label="Cover expiry date" type="date" required value={insurance.valid_to} onChange={(x) => setIns("valid_to", x)} />
                        </div>
                        <p
                          className={`text-sm ${coverPeriod.ok ? "text-muted-foreground" : "text-destructive"}`}
                          role="status"
                          aria-live="polite"
                        >
                          {coverPeriod.ok
                            ? "Cover satisfies the six-month requirement."
                            : (coverPeriod.message ?? "")}
                        </p>
                        <div className="space-y-1.5">
                          <Label htmlFor="attach-insurance-doc">Insurance cover document *</Label>
                          <Input
                            id="attach-insurance-doc"
                            type="file"
                            accept="application/pdf,image/png,image/jpeg"
                            onChange={(e) => {
                              const file = e.target.files?.[0] ?? null;
                              const problem = file ? validateApplicationFile(file) : null;
                              if (problem) { toast.error(problem); return; }
                              setInsuranceDoc(file);
                            }}
                          />
                          <p className="text-xs text-muted-foreground">
                            {insuranceDoc ? insuranceDoc.name : "Certificate or schedule showing the insured name and validity."}
                          </p>
                        </div>
                      </section>
                    </>
                  ) : null}
                </>
              ) : (

                <>
                  {sections.employment !== false && (
                    <RepeatableSection title="Employment history" help="Most recent role first." fields={EMPLOYMENT_FIELDS} rows={form.employment} setRows={(r) => set("employment", r)} />
                  )}
                </>
              )}
            </>
          )}

          {step === 3 && (
            <>
              <DocumentRequirementStep
                declaration={education}
                onDeclarationChange={setEducation}
              />
              {coverLetterMode !== "none" && (
                <section className="p-5 rounded-xl bg-card border border-border space-y-1.5">
                  <Label htmlFor="cover_letter">
                    Cover letter{coverLetterMode === "required" ? " *" : " (optional)"}
                  </Label>
                  <Textarea
                    id="cover_letter" rows={6} value={form.cover_letter}
                    onChange={(e) => set("cover_letter", e.target.value)}
                    placeholder="Why this role, and what you bring."
                  />
                </section>
              )}
            </>
          )}

          {isLast && (
            <>
              <section className="p-5 rounded-xl bg-card border border-border space-y-3">
                <h2 className="font-semibold">Review</h2>
                <dl className="grid gap-2 sm:grid-cols-2 text-sm">
                  <Review k="Name" val={form.full_name} />
                  <Review k="Email" val={form.email} />
                  <Review k="Phone" val={form.phone} />
                  <Review k="Location" val={form.location} />
                  <Review k="Academic entries" val={String(form.academic.filter((r) => Object.values(r).some(Boolean)).length)} />
                  {!isInternship && (
                    <Review k="Employment entries" val={String(form.employment.filter((r) => Object.values(r).some(Boolean)).length)} />
                  )}
                </dl>
                <p className="text-xs text-muted-foreground">
                  You are applying to {v.title} (version {v.content_version}){blueprint ? `, application form v${blueprint.version}` : ""}.
                </p>
              </section>

              <section className="p-5 rounded-xl bg-card border border-border space-y-4">
                <h2 className="font-semibold">{notice?.title ?? "Recruitment privacy notice"}</h2>
                {notice ? (
                  <div className="max-h-48 overflow-y-auto text-sm text-muted-foreground whitespace-pre-line rounded-lg bg-muted/40 p-4">
                    {notice.body_markdown.trim()}
                  </div>
                ) : null}
                <div className="flex items-start gap-3">
                  <Checkbox id="consent" checked={consent} onCheckedChange={(c) => setConsent(c === true)} />
                  <Label htmlFor="consent" className="text-sm font-normal leading-relaxed">
                    I have read the recruitment privacy notice{notice ? ` (v${notice.version})` : ""} and agree to TaxiD
                    Mobility processing my personal data and documents for this recruitment process.
                  </Label>
                </div>
                <div className="flex items-start gap-3">
                  <Checkbox id="declaration" checked={declaration} onCheckedChange={(c) => setDeclaration(c === true)} />
                  <Label htmlFor="declaration" className="text-sm font-normal leading-relaxed">
                    I declare that the information and documents provided are accurate and complete.
                  </Label>
                </div>
                <div className="flex items-start gap-3">
                  <Checkbox id="talent-pool" checked={talentPool} onCheckedChange={(c) => setTalentPool(c === true)} />
                  <Label htmlFor="talent-pool" className="text-sm font-normal leading-relaxed">
                    Optional: keep my details for future opportunities at TaxiD.
                  </Label>
                </div>
              </section>
            </>
          )}

          {failure ? (
            <div
              role="alert"
              className="rounded-xl border border-destructive/40 bg-destructive/5 p-5 space-y-3"
            >
              <div className="flex items-start gap-3">
                <FileWarning className="mt-0.5 h-5 w-5 text-destructive" aria-hidden="true" />
                <div className="space-y-1">
                  <p className="font-semibold">
                    {failure.failureClass === "TECHNICAL_FAILURE" ||
                    failure.failureClass === "SECURITY_FAILURE"
                      ? "We could not complete your submission"
                      : "Your application is not complete yet"}
                  </p>
                  <p className="text-sm text-muted-foreground">{failure.message}</p>
                </div>
              </div>
              {failure.missing.length > 0 ? (
                <ul className="ml-8 list-disc space-y-1 text-sm">
                  {failure.missing.map((m) => (
                    <li key={m}>{m} — still outstanding</li>
                  ))}
                </ul>
              ) : null}
              <p className="ml-8 text-sm">{failure.guidance}</p>
              {failure.failureClass === "TECHNICAL_FAILURE" ||
              failure.failureClass === "SECURITY_FAILURE" ? (
                <p className="ml-8 text-xs text-muted-foreground">
                  This was a fault on our side, not yours. Your application has been preserved and our
                  recruitment team can see it.
                </p>
              ) : null}
              {savedAt ? (
                <p className="ml-8 text-xs text-muted-foreground">
                  Progress saved {new Date(savedAt).toLocaleString()} — you can close this page and resume.
                </p>
              ) : null}
            </div>
          ) : null}

          {/* What is still outstanding, on this step or across the application. */}
          {(isLast ? readiness.blockers : currentBlockers).length > 0 ? (
            <div
              role="status"
              aria-live="polite"
              className="rounded-xl border border-border bg-muted/40 p-4 space-y-2"
            >
              <p className="text-sm font-medium">
                {isLast
                  ? "Complete these before submitting"
                  : `Complete these to continue to ${STEPS[step + 1]}`}
              </p>
              <ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground">
                {(isLast ? readiness.blockers : currentBlockers).map((b) => <li key={b}>{b}</li>)}
              </ul>
            </div>
          ) : null}

          <div className="flex items-center gap-3">

            {step > 0 && (
              <Button type="button" variant="outline" onClick={() => setStep((s) => Math.max(s - 1, 0))}>
                <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" />Back
              </Button>
            )}
            <Button type="submit" size="lg" disabled={submit.isPending || advanceBlocked}>
              {submit.isPending
                ? "Submitting…"
                : isLast
                  ? <>Submit application <ArrowRight className="ml-1 h-4 w-4" aria-hidden="true" /></>
                  : <>Continue <ArrowRight className="ml-1 h-4 w-4" aria-hidden="true" /></>}
            </Button>
          </div>
        </form>
      </section>
    </MarketingPage>
  );
}

function Review({ k, val }: { k: string; val: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{k}</dt>
      <dd className="font-medium break-words">{val || "—"}</dd>
    </div>
  );
}

function Text({
  label, type = "text", required, value, onChange,
}: { label: string; type?: string; required?: boolean; value: string; onChange: (v: string) => void }) {
  const id = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}{required ? " *" : ""}</Label>
      <Input id={id} type={type} required={required} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
