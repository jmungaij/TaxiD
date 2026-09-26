/**
 * Enterprise Education & Qualifications module — four structured sections with
 * an evidence ledger, replacing the old free-text academic block for internship
 * intake.
 *
 * The section only collects and displays: every rule (chronology, duration,
 * institutional email, award classification, transcript mode) lives in
 * `@/lib/recruitment/education`, which the submission gate and the server share.
 * Document evidence itself is uploaded on the Documents step; here it is shown
 * as outstanding evidence so a candidate always knows what is still owed.
 */
import { CheckCircle2, CircleDashed, GraduationCap, Info } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AWARD_CLASSIFICATIONS,
  QUALIFICATION_LEVELS,
  academicYears,
  isDocumentRequirement,
  type AwardClassification,
  type EducationGateVerdict,
  type EducationPolicy,
  type OtherQualification,
  type QualificationLevel,
  type QualificationRecord,
  type SchoolRecord,
  type TertiaryRecord,
} from "@/lib/recruitment/education";

interface Props {
  policy: EducationPolicy;
  verdict: EducationGateVerdict;
  primary: SchoolRecord;
  secondary: SchoolRecord;
  tertiary: TertiaryRecord;
  qualification: QualificationRecord;
  other: OtherQualification;
  onPrimary: <K extends keyof SchoolRecord>(k: K, v: SchoolRecord[K]) => void;
  onSecondary: <K extends keyof SchoolRecord>(k: K, v: SchoolRecord[K]) => void;
  onTertiary: <K extends keyof TertiaryRecord>(k: K, v: TertiaryRecord[K]) => void;
  onQualification: <K extends keyof QualificationRecord>(k: K, v: QualificationRecord[K]) => void;
  onOther: <K extends keyof OtherQualification>(k: K, v: OtherQualification[K]) => void;
}

function Field({
  label, value, onChange, type = "text", required, id, help,
}: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; required?: boolean; id: string; help?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}{required ? " *" : ""}</Label>
      <Input id={id} type={type} value={value} onChange={(e) => onChange(e.target.value)} />
      {help && <p className="text-xs text-muted-foreground">{help}</p>}
    </div>
  );
}

function SectionShell({
  index, title, description, ok, children,
}: {
  index: number; title: string; description: string; ok: boolean; children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-5 space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{index}. {title}</h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <Badge variant={ok ? "default" : "outline"} className="shrink-0">
          {ok ? "Complete" : "Outstanding"}
        </Badge>
      </header>
      {children}
    </section>
  );
}

export default function EducationHistorySection(props: Props) {
  const {
    policy, verdict, primary, secondary, tertiary, qualification, other,
    onPrimary, onSecondary, onTertiary, onQualification, onOther,
  } = props;

  const section = (key: string) => verdict.sections.find((s) => s.key === key);
  const durationOptions = tertiary.qualification_level
    ? policy.duration_options[tertiary.qualification_level]
    : [];
  const completeCount = verdict.sections.filter((s) => s.ok).length;
  const percent = Math.round((completeCount / verdict.sections.length) * 100);
  const evidence = verdict.sections.flatMap((s) =>
    s.requirements.filter((r) => isDocumentRequirement(r.key)).map((r) => ({ ...r, section: s.label })),
  );

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-border bg-muted/30 p-5 space-y-3">
        <div className="flex items-start gap-3">
          <GraduationCap className="h-5 w-5 mt-0.5 text-muted-foreground" aria-hidden />
          <div className="space-y-1">
            <h2 className="font-semibold">Education &amp; qualifications</h2>
            <p className="text-sm text-muted-foreground">
              Your academic history is recorded as a structured, evidence-backed record:
              primary, secondary, college or university, your qualification, then the
              certificates and transcripts that prove it — all on this stage.
            </p>
          </div>
        </div>
        <Progress value={percent} aria-label="Education completeness" />
        <p className="text-xs text-muted-foreground">{completeCount} of {verdict.sections.length} sections complete</p>
      </section>

      <SectionShell
        index={1}
        title="Primary education"
        description="Where you completed primary school, and the period you attended."
        ok={section("primary")?.ok ?? false}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="edu-p-name" label="Primary school name" required value={primary.name} onChange={(v) => onPrimary("name", v)} />
          <Field id="edu-p-start" label="Start date" type="date" required value={primary.start_date} onChange={(v) => onPrimary("start_date", v)} />
          <Field id="edu-p-end" label="Completion date" type="date" required value={primary.end_date} onChange={(v) => onPrimary("end_date", v)} />
        </div>
        <p className="text-xs text-muted-foreground">Evidence required: {policy.primary_certificate_label}.</p>
      </SectionShell>

      <SectionShell
        index={2}
        title="Secondary education"
        description="Where you completed secondary school, and the period you attended."
        ok={section("secondary")?.ok ?? false}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="edu-s-name" label="Secondary school name" required value={secondary.name} onChange={(v) => onSecondary("name", v)} />
          <Field id="edu-s-start" label="Start date" type="date" required value={secondary.start_date} onChange={(v) => onSecondary("start_date", v)} />
          <Field id="edu-s-end" label="Completion date" type="date" required value={secondary.end_date} onChange={(v) => onSecondary("end_date", v)} />
        </div>
        <p className="text-xs text-muted-foreground">Evidence required: {policy.secondary_certificate_label}.</p>
      </SectionShell>

      <SectionShell
        index={3}
        title="College / university education"
        description="Your tertiary institution, the programme, its structured duration and the institution's official contacts."
        ok={section("tertiary")?.ok ?? false}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="edu-t-inst" label="Institution name" required value={tertiary.institution} onChange={(v) => onTertiary("institution", v)} />
          <Field id="edu-t-prog" label="Programme of study" required value={tertiary.programme} onChange={(v) => onTertiary("programme", v)} />

          <div className="space-y-1.5">
            <Label htmlFor="edu-t-level">Qualification level *</Label>
            <Select
              value={tertiary.qualification_level}
              onValueChange={(v) => {
                onTertiary("qualification_level", v as QualificationLevel);
                onTertiary("duration_years", null);
              }}
            >
              <SelectTrigger id="edu-t-level"><SelectValue placeholder="Select the level you studied" /></SelectTrigger>
              <SelectContent>
                {QUALIFICATION_LEVELS.filter((l) => policy.allowed_levels.includes(l.value)).map((l) => (
                  <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edu-t-duration">Programme duration *</Label>
            <Select
              value={tertiary.duration_years ? String(tertiary.duration_years) : ""}
              onValueChange={(v) => onTertiary("duration_years", Number(v))}
            >
              <SelectTrigger id="edu-t-duration" disabled={!tertiary.qualification_level}>
                <SelectValue placeholder={tertiary.qualification_level ? "Select the number of academic years" : "Select a qualification level first"} />
              </SelectTrigger>
              <SelectContent>
                {durationOptions.map((d) => (
                  <SelectItem key={d} value={String(d)}>{d} academic years</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {policy.required_duration_years !== null && (
              <p className="text-xs text-muted-foreground">
                This programme requires at least {policy.required_duration_years} academic years of study.
              </p>
            )}
          </div>

          <Field id="edu-t-admit" label="Admission date" type="date" required value={tertiary.admission_date} onChange={(v) => onTertiary("admission_date", v)} />
          <Field id="edu-t-complete" label="Completion date" type="date" required value={tertiary.completion_date} onChange={(v) => onTertiary("completion_date", v)} />
          <Field id="edu-t-phone" label="Institution telephone" required value={tertiary.institution_phone} onChange={(v) => onTertiary("institution_phone", v)} />
          <Field
            id="edu-t-email"
            label="Institution official email"
            type="email"
            required
            value={tertiary.institution_email}
            onChange={(v) => onTertiary("institution_email", v)}
            help="Use the registrar or department address — personal mailboxes are not accepted."
          />
        </div>

        {policy.completion_required && (
          <div className="space-y-1.5">
            <Label htmlFor="edu-t-status">Have you completed your studies? *</Label>
            <Select value={tertiary.completion_status} onValueChange={(v) => onTertiary("completion_status", v as TertiaryRecord["completion_status"])}>
              <SelectTrigger id="edu-t-status"><SelectValue placeholder="Select your completion status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="COMPLETED">Yes — studies completed</SelectItem>
                <SelectItem value="IN_PROGRESS">No — still studying</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {policy.transcript_required && (
          <div className="space-y-2">
            <Label>How will you submit your transcripts? *</Label>
            <RadioGroup
              value={tertiary.transcript_mode}
              onValueChange={(v) => onTertiary("transcript_mode", v as TertiaryRecord["transcript_mode"])}
              className="grid gap-2 sm:grid-cols-2"
            >
              <label className="flex items-start gap-2 rounded-lg border border-border p-3 text-sm">
                <RadioGroupItem value="annual" id="edu-t-annual" className="mt-0.5" />
                <span>
                  <span className="font-medium">One transcript per academic year</span>
                  <span className="block text-xs text-muted-foreground">
                    {academicYears(tertiary.duration_years).length
                      ? `${academicYears(tertiary.duration_years).length} transcripts required`
                      : "Select the programme duration to see how many are required"}
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 rounded-lg border border-border p-3 text-sm">
                <RadioGroupItem value="consolidated" id="edu-t-consolidated" className="mt-0.5" />
                <span>
                  <span className="font-medium">One consolidated transcript</span>
                  <span className="block text-xs text-muted-foreground">A single transcript covering the whole programme</span>
                </span>
              </label>
            </RadioGroup>
          </div>
        )}
      </SectionShell>

      <SectionShell
        index={4}
        title="Qualification"
        description="The qualification you were awarded, its specialisation and classification."
        ok={section("qualification")?.ok ?? false}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="edu-q-type">Qualification type *</Label>
            <Select value={qualification.qualification_type} onValueChange={(v) => onQualification("qualification_type", v as QualificationLevel)}>
              <SelectTrigger id="edu-q-type"><SelectValue placeholder="Select your qualification" /></SelectTrigger>
              <SelectContent>
                {QUALIFICATION_LEVELS.filter((l) => policy.allowed_levels.includes(l.value)).map((l) => (
                  <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Field id="edu-q-prog" label="Programme of study" required value={qualification.programme} onChange={(v) => onQualification("programme", v)} />
          <Field id="edu-q-spec" label="Area of specialisation" required value={qualification.specialisation} onChange={(v) => onQualification("specialisation", v)} />
          <Field id="edu-q-grad" label="Graduation date" type="date" required value={qualification.graduation_date} onChange={(v) => onQualification("graduation_date", v)} />
          <div className="space-y-1.5">
            <Label htmlFor="edu-q-award">Award classification *</Label>
            <Select value={qualification.award_classification} onValueChange={(v) => onQualification("award_classification", v as AwardClassification)}>
              <SelectTrigger id="edu-q-award"><SelectValue placeholder="Select your classification" /></SelectTrigger>
              <SelectContent>
                {AWARD_CLASSIFICATIONS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {verdict.qualificationMismatch && verdict.mismatchNote && (
          <Alert>
            <Info className="h-4 w-4" aria-hidden />
            <AlertDescription>{verdict.mismatchNote}</AlertDescription>
          </Alert>
        )}

        <div className="rounded-lg border border-dashed border-border p-4 space-y-3">
          <p className="text-sm font-medium">Other qualification (optional)</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field id="edu-o-name" label="Qualification name" value={other.name} onChange={(v) => onOther("name", v)} />
            <Field id="edu-o-inst" label="Awarding institution" value={other.institution} onChange={(v) => onOther("institution", v)} />
            <Field id="edu-o-date" label="Award date" type="date" value={other.award_date} onChange={(v) => onOther("award_date", v)} />
          </div>
        </div>
      </SectionShell>

      {evidence.length > 0 && (
        <section className="rounded-xl border border-border bg-muted/30 p-5 space-y-3">
          <h3 className="font-semibold">Academic evidence ledger</h3>
          <ul className="space-y-2 text-sm">
            {evidence.map((e) => (
              <li key={`${e.section}-${e.key}`} className="flex items-start gap-2">
                {e.ok
                  ? <CheckCircle2 className="h-4 w-4 mt-0.5 text-primary" aria-hidden />
                  : <CircleDashed className="h-4 w-4 mt-0.5 text-muted-foreground" aria-hidden />}
                <span>
                  {e.label}
                  <span className="block text-xs text-muted-foreground">{e.section}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
