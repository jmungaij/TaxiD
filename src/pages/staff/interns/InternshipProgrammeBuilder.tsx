/**
 * NEW INTERNSHIP PROGRAMME — builder.
 *
 * Replaces the generic "New vacancy" form for internships. An internship is a
 * capability mandate, so this builder collects the mandate: purpose, learning
 * objectives with evidence, measurable productivity, curriculum-to-capability
 * mapping, a weighted selection model, and the public advert. Readiness is
 * decided by the server (`rec_internship_validate`) and mirrored here.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, GraduationCap, Plus, Trash2,
} from "lucide-react";

import { StaffPageHeader } from "@/components/staff/primitives";
import {
  TTO_LEARNING_DOMAINS, TTO_PERFORMANCE_LENSES, TTO_SEED_OUTSTANDING, TTO_SEED_REFERENCES,
  travelTourOperationsSeed,
} from "@/lib/interns/seeds/travelTourOperations";
import {
  DMFD_LEARNING_DOMAINS, DMFD_PRODUCT_SURFACE, DMFD_SEED_OUTSTANDING,
  DMFD_SEED_REFERENCES, destinationsMobilitySupplySeed,
} from "@/lib/interns/seeds/destinationsMobilitySupply";
import {
  SM_LEARNING_DOMAINS, SM_PERFORMANCE_LENSES, SM_PRODUCT_FAMILIES, SM_SEED_OUTSTANDING,
  SM_SEED_REFERENCES, salesMarketingSeed,
} from "@/lib/interns/seeds/salesMarketing";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import * as interns from "@/lib/interns/api";
import * as rec from "@/lib/recruitment/api";
import {
  DEFAULT_SELECTION_WEIGHTS, INTERNSHIP_TYPES, QUALIFICATION_LEVELS, REQUIRED_DOCUMENT_OPTIONS,
  SELECTION_WEIGHT_LABELS, createInternshipProgramme, emptyDraft, internshipPublicSlug, listStaffOptions,
  newSubmitKey, weightTotal,
  type InternshipProgrammeDraft, type SelectionWeights, type ValidationVerdict,
} from "@/lib/interns/programmeBuilder";
import { PRIORITIES, WORK_ARRANGEMENTS, titleise } from "@/lib/recruitment/types";

const STEPS = [
  { key: "mandate", label: "Programme mandate" },
  { key: "learning", label: "Learning design" },
  { key: "productivity", label: "Productivity & value" },
  { key: "eligibility", label: "Eligibility & curriculum" },
  { key: "selection", label: "Assessment & selection" },
  { key: "publication", label: "Advert & publication" },
] as const;

/* ------------------------------- primitives ------------------------------ */

function FieldRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function TagField({
  label, hint, values, onChange, placeholder,
}: { label: string; hint?: string; values: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const value = draft.trim();
    if (!value) return;
    if (!values.includes(value)) onChange([...values, value]);
    setDraft("");
  };
  return (
    <FieldRow label={label} hint={hint}>
      <div className="flex gap-2">
        <Input
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          aria-label={label}
        />
        <Button type="button" variant="outline" onClick={add}>Add</Button>
      </div>
      {values.length ? (
        <div className="flex flex-wrap gap-2 pt-1">
          {values.map((v) => (
            <Badge key={v} variant="secondary" className="gap-1">
              {v}
              <button
                type="button"
                onClick={() => onChange(values.filter((x) => x !== v))}
                aria-label={`Remove ${v}`}
                className="text-muted-foreground hover:text-foreground"
              >
                ×
              </button>
            </Badge>
          ))}
        </div>
      ) : null}
    </FieldRow>
  );
}

function Repeater<T>({
  title, description, rows, onChange, blank, render,
}: {
  title: string;
  description?: string;
  rows: T[];
  onChange: (rows: T[]) => void;
  blank: () => T;
  render: (row: T, update: (patch: Partial<T>) => void) => React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      <div className="space-y-3">
        {rows.map((row, i) => (
          <div key={i} className="rounded-lg border border-border/70 bg-card/60 p-3 backdrop-blur-sm">
            <div className="flex items-start gap-3">
              <div className="flex-1 grid gap-3 sm:grid-cols-3">
                {render(row, (patch) => onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r))))}
              </div>
              <Button
                type="button" variant="ghost" size="icon"
                aria-label={`Remove ${title} row ${i + 1}`}
                onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        ))}
      </div>
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...rows, blank()])}>
        <Plus className="mr-2 h-4 w-4" aria-hidden="true" />Add row
      </Button>
    </div>
  );
}

/* --------------------------------- page ---------------------------------- */

export default function InternshipProgrammeBuilder() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<InternshipProgrammeDraft>(emptyDraft);
  const [verdict, setVerdict] = useState<ValidationVerdict | null>(null);
  const [seedNotice, setSeedNotice] = useState<{
    title: string;
    description: string;
    outstanding: string[];
  } | null>(null);

  const set = <K extends keyof InternshipProgrammeDraft>(key: K, value: InternshipProgrammeDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const tracks = useQuery({ queryKey: ["intern-tracks"], queryFn: interns.listTracks });
  const cohorts = useQuery({ queryKey: ["intern-cohorts"], queryFn: interns.listCohorts });
  const programmes = useQuery({ queryKey: ["intern-programmes"], queryFn: interns.listProgrammes });
  const staff = useQuery({ queryKey: ["staff-options"], queryFn: listStaffOptions });
  const positions = useQuery({ queryKey: ["position-options"], queryFn: rec.listPositionOptions });

  /**
   * Loads a specialist programme seed.
   *
   * Only the design is seeded. Programme and tracks are resolved from live
   * records by code so no duplicate YMEITA programme or track is created, and
   * the position, staff assignments and cohort are deliberately left empty —
   * they must come from authoritative records, and the server keeps publication
   * blocked until they do.
   */
  const loadSeed = (spec: {
    seed: InternshipProgrammeDraft;
    references: {
      programmeCode: string;
      primaryTrackCode: string;
      secondaryTrackCode: string;
      developmentTrackCode: string;
      cohortName: string;
    };
    outstanding: readonly string[];
    title: string;
    description: string;
    toast: string;
  }) => {
    const { seed, references } = spec;
    const trackByCode = (code: string) => (tracks.data ?? []).find((t) => t.code === code)?.id ?? "";
    const programmeId =
      (programmes.data ?? []).find((p) => p.code === references.programmeCode)?.id ?? "";
    const cohortId =
      (cohorts.data ?? []).find((c) => c.name === references.cohortName)?.id ?? "";

    setCreated(null);
    setDraft({
      ...seed,
      idempotency_key: newSubmitKey(),
      programme_id: programmeId,
      primary_track_id: trackByCode(references.primaryTrackCode),
      secondary_track_id: trackByCode(references.secondaryTrackCode),
      development_track_id: trackByCode(references.developmentTrackCode),
      cohort_id: cohortId,
    });

    const outstanding: string[] = spec.outstanding.filter(
      (item) => !(cohortId && item.startsWith(`Cohort ${references.cohortName}`)),
    );
    if (!programmeId) outstanding.unshift("YMEITA programme record could not be resolved — check Programmes");
    setSeedNotice({ title: spec.title, description: spec.description, outstanding });
    setStep(0);
    toast.success(spec.toast);
  };

  const loadTravelSeed = () =>
    loadSeed({
      seed: travelTourOperationsSeed(),
      references: TTO_SEED_REFERENCES,
      outstanding: TTO_SEED_OUTSTANDING,
      title: `Travel & Tour Operations seed loaded · ${TTO_SEED_REFERENCES.programmeCodeTto}`,
      description: `Specialist design seeded across ${TTO_LEARNING_DOMAINS.length} learning domains — travel desk, corporate mobility, operations, tourism product and commercial. Performance additionally exposes ${TTO_PERFORMANCE_LENSES.join(", ").toLowerCase()}. Nothing below was fabricated: no staff, position, cohort, customer, fleet or revenue record is invented by the seed.`,
      toast: "Travel & Tour Operations seed loaded (TTO-001). Assign the outstanding records before publishing.",
    });

  const loadSalesMarketingSeed = () =>
    loadSeed({
      seed: salesMarketingSeed(),
      references: SM_SEED_REFERENCES,
      outstanding: SM_SEED_OUTSTANDING,
      title: `Sales & Marketing Professional Internship seed loaded · ${SM_SEED_REFERENCES.programmeCodeSm}`,
      description: `24-week commercial programme seeded across ${SM_LEARNING_DOMAINS.length} learning domains and ${SM_PRODUCT_FAMILIES.length} approved product families (${SM_PRODUCT_FAMILIES.join(", ").toLowerCase()}). Performance weights commercial contribution at 30% and additionally exposes ${SM_PERFORMANCE_LENSES.join(", ").toLowerCase()} — never raw revenue. No staff, position, cohort, customer, booking or revenue record is invented by the seed, and self-reported revenue is never treated as verified.`,
      toast: "Sales & Marketing seed loaded (YMEITA-SM-001). Assign the outstanding records before publishing.",
    });

  const loadDestinationsSupplySeed = () =>
    loadSeed({
      seed: destinationsMobilitySupplySeed(),
      references: DMFD_SEED_REFERENCES,
      outstanding: DMFD_SEED_OUTSTANDING,
      title: `Destinations, Mobility Supply & Fleet Development seed loaded · ${DMFD_SEED_REFERENCES.programmeCodeDmfd}`,
      description: `24-week supply-side capability programme seeded across ${DMFD_LEARNING_DOMAINS.length} learning domains and the ${DMFD_PRODUCT_SURFACE.length} Yalla product families that consume mobility supply (${DMFD_PRODUCT_SURFACE.join(", ").toLowerCase()}). Performance weights supply development at 25% and is computed server-side; demand stays UNVERIFIED without evidence, compliance is never inferred, and interns can never verify, activate, approve or declare revenue.`,
      toast: "Destinations & Mobility Supply seed loaded (DMFD-INT-2608). Assign the outstanding records before publishing.",
    });

  const totalWeight = weightTotal(draft.selection_weights);

  const [publicSlug, setPublicSlug] = useState<string | null>(null);
  /** Set once the programme exists, so a second click can never create a twin. */
  const [created, setCreated] = useState<{ vacancy_id: string; vacancy_no: string } | null>(null);

  const create = useMutation({
    mutationFn: () => createInternshipProgramme(draft),
    onSuccess: async (result) => {
      setVerdict(result.validation);
      setCreated({ vacancy_id: result.vacancy_id, vacancy_no: result.vacancy_no });
      try {
        setPublicSlug(await internshipPublicSlug(result.vacancy_id));
      } catch {
        setPublicSlug(null);
      }
      if (result.validation.verdict === "READY") {
        toast.success(`Programme ${result.vacancy_no} created and ready to publish.`);
      } else {
        toast.warning(`Programme ${result.vacancy_no} saved as a draft. Clear the blockers before publishing.`);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const staffOptions = staff.data ?? [];
  const staffSelect = (label: string, key: keyof InternshipProgrammeDraft, hint?: string) => (
    <FieldRow label={label} hint={hint}>
      <Select value={String(draft[key] ?? "")} onValueChange={(v) => set(key, v as never)}>
        <SelectTrigger><SelectValue placeholder="Select a staff member" /></SelectTrigger>
        <SelectContent>
          {staffOptions.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.full_name ?? s.work_email ?? s.staff_no ?? s.id}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FieldRow>
  );

  const stepBody = useMemo(() => {
    switch (STEPS[step].key) {
      case "mandate":
        return (
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldRow label="Programme title" hint="Name the capability, for example “Travel Operations Internship — Nairobi”.">
                <Input value={draft.title} onChange={(e) => set("title", e.target.value)} />
              </FieldRow>
              <FieldRow label="Location">
                <Input value={draft.location} onChange={(e) => set("location", e.target.value)} />
              </FieldRow>
              <FieldRow label="Internship type">
                <Select value={draft.internship_type} onValueChange={(v) => set("internship_type", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {INTERNSHIP_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </FieldRow>
              <FieldRow label="Work arrangement">
                <Select value={draft.work_arrangement} onValueChange={(v) => set("work_arrangement", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {WORK_ARRANGEMENTS.map((v) => <SelectItem key={v} value={v}>{titleise(v)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </FieldRow>
              <FieldRow label="Priority">
                <Select value={draft.priority} onValueChange={(v) => set("priority", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((v) => <SelectItem key={v} value={v}>{titleise(v)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </FieldRow>
              <FieldRow label="Intake size">
                <Input type="number" min={1} value={draft.headcount}
                  onChange={(e) => set("headcount", Math.max(1, Number(e.target.value) || 1))} />
              </FieldRow>
              <FieldRow label="Duration (weeks)">
                <Input type="number" min={1} value={draft.duration_weeks}
                  onChange={(e) => set("duration_weeks", Math.max(1, Number(e.target.value) || 1))} />
              </FieldRow>
              <FieldRow label="Time-to-fill target (days)">
                <Input type="number" min={1} value={draft.sla_days}
                  onChange={(e) => set("sla_days", Math.max(1, Number(e.target.value) || 1))} />
              </FieldRow>
              <FieldRow label="Start date">
                <Input type="date" value={draft.start_date} onChange={(e) => set("start_date", e.target.value)} />
              </FieldRow>
              <FieldRow label="End date">
                <Input type="date" value={draft.end_date} onChange={(e) => set("end_date", e.target.value)} />
              </FieldRow>
              <FieldRow label="Application deadline" hint="Must fall on or before the start date.">
                <Input type="date" value={draft.application_deadline}
                  onChange={(e) => set("application_deadline", e.target.value)} />
              </FieldRow>
              <FieldRow label="Host function" hint="The team that owns the intern's work.">
                <Input value={draft.host_function} onChange={(e) => set("host_function", e.target.value)} />
              </FieldRow>
              <FieldRow label="Department">
                <Input value={draft.department} onChange={(e) => set("department", e.target.value)} />
              </FieldRow>
              <FieldRow label="Business unit">
                <Input value={draft.business_unit} onChange={(e) => set("business_unit", e.target.value)} />
              </FieldRow>
              <FieldRow label="Org position" hint="Link an approved position, or record an exception reason below.">
                <Select value={draft.position_id || "none"} onValueChange={(v) => set("position_id", v === "none" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="Select a position" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No linked position</SelectItem>
                    {(positions.data ?? []).map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.title} · {p.code}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldRow>
              <FieldRow label="Position exception reason">
                <Input value={draft.position_exception_reason}
                  onChange={(e) => set("position_exception_reason", e.target.value)} />
              </FieldRow>
              {staffSelect("Supervisor", "supervisor_staff_id", "Validates the intern's daily output.")}
              {staffSelect("Mentor / learning owner", "mentor_staff_id", "Owns capability development.")}
              {staffSelect("Approving manager", "approving_manager_staff_id")}
              <FieldRow label="Programme">
                <Select value={draft.programme_id || "default"} onValueChange={(v) => set("programme_id", v === "default" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="YMEITA (default)" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">YMEITA (default)</SelectItem>
                    {(programmes.data ?? []).map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldRow>
              <FieldRow label="Cohort">
                <Select value={draft.cohort_id} onValueChange={(v) => set("cohort_id", v)}>
                  <SelectTrigger><SelectValue placeholder="Select a cohort" /></SelectTrigger>
                  <SelectContent>
                    {(cohorts.data ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldRow>
              <FieldRow label="Primary track">
                <Select value={draft.primary_track_id} onValueChange={(v) => set("primary_track_id", v)}>
                  <SelectTrigger><SelectValue placeholder="Select a track" /></SelectTrigger>
                  <SelectContent>
                    {(tracks.data ?? []).map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldRow>
              <FieldRow label="Secondary track (optional)">
                <Select value={draft.secondary_track_id || "none"} onValueChange={(v) => set("secondary_track_id", v === "none" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {(tracks.data ?? []).map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </FieldRow>
            </div>
            <FieldRow
              label="Programme purpose"
              hint="State the capability Yalla is building and the business problem the intern helps solve. At least 40 characters."
            >
              <Textarea rows={4} value={draft.programme_purpose}
                onChange={(e) => set("programme_purpose", e.target.value)} />
            </FieldRow>
          </div>
        );

      case "learning":
        return (
          <div className="space-y-8">
            <Repeater
              title="Learning objectives"
              description="Each objective needs the evidence it produces and how it is assessed."
              rows={draft.learning_objectives}
              onChange={(rows) => set("learning_objectives", rows)}
              blank={() => ({ competency: "", evidence: "", assessment: "" })}
              render={(row, update) => (
                <>
                  <Input placeholder="Competency" value={row.competency} onChange={(e) => update({ competency: e.target.value })} aria-label="Competency" />
                  <Input placeholder="Expected evidence" value={row.evidence} onChange={(e) => update({ evidence: e.target.value })} aria-label="Expected evidence" />
                  <Input placeholder="Assessment method" value={row.assessment} onChange={(e) => update({ assessment: e.target.value })} aria-label="Assessment method" />
                </>
              )}
            />
            <Repeater
              title="Measurable learning outcomes"
              description="Written as action + competency + context + evidence."
              rows={draft.learning_outcomes}
              onChange={(rows) => set("learning_outcomes", rows)}
              blank={() => ({ action: "", competency: "", context: "", evidence: "" })}
              render={(row, update) => (
                <>
                  <Input placeholder="Action verb" value={row.action} onChange={(e) => update({ action: e.target.value })} aria-label="Action" />
                  <Input placeholder="Competency" value={row.competency} onChange={(e) => update({ competency: e.target.value })} aria-label="Outcome competency" />
                  <Input placeholder="Context / system" value={row.context} onChange={(e) => update({ context: e.target.value })} aria-label="Context" />
                  <Input className="sm:col-span-3" placeholder="Evidence of achievement" value={row.evidence} onChange={(e) => update({ evidence: e.target.value })} aria-label="Outcome evidence" />
                </>
              )}
            />
            <Repeater
              title="Development plan"
              rows={draft.development_plan}
              onChange={(rows) => set("development_plan", rows)}
              blank={() => ({ phase: "", focus: "", milestone: "" })}
              render={(row, update) => (
                <>
                  <Input placeholder="Phase" value={row.phase} onChange={(e) => update({ phase: e.target.value })} aria-label="Phase" />
                  <Input placeholder="Focus" value={row.focus} onChange={(e) => update({ focus: e.target.value })} aria-label="Focus" />
                  <Input placeholder="Milestone" value={row.milestone} onChange={(e) => update({ milestone: e.target.value })} aria-label="Milestone" />
                </>
              )}
            />
          </div>
        );

      case "productivity":
        return (
          <div className="space-y-8">
            <Repeater
              title="Productivity mandate"
              description="The real work the intern performs, and where the output is recorded."
              rows={draft.productivity_mandate}
              onChange={(rows) => set("productivity_mandate", rows)}
              blank={() => ({ output: "", cadence: "Weekly", system_of_record: "" })}
              render={(row, update) => (
                <>
                  <Input placeholder="Output" value={row.output} onChange={(e) => update({ output: e.target.value })} aria-label="Output" />
                  <Input placeholder="Cadence" value={row.cadence} onChange={(e) => update({ cadence: e.target.value })} aria-label="Cadence" />
                  <Input placeholder="System of record" value={row.system_of_record} onChange={(e) => update({ system_of_record: e.target.value })} aria-label="System of record" />
                </>
              )}
            />
            <Repeater
              title="KPIs"
              description="A number only counts when an authoritative system can produce it."
              rows={draft.kpis}
              onChange={(rows) => set("kpis", rows)}
              blank={() => ({ kpi: "", target: "", evidence_source: "" })}
              render={(row, update) => (
                <>
                  <Input placeholder="KPI" value={row.kpi} onChange={(e) => update({ kpi: e.target.value })} aria-label="KPI" />
                  <Input placeholder="Target" value={row.target} onChange={(e) => update({ target: e.target.value })} aria-label="Target" />
                  <Input placeholder="Evidence source" value={row.evidence_source} onChange={(e) => update({ evidence_source: e.target.value })} aria-label="Evidence source" />
                </>
              )}
            />
            <div className="grid gap-4 sm:grid-cols-3">
              <FieldRow label="Commercial objective">
                <Input value={draft.commercial_objective.objective}
                  onChange={(e) => set("commercial_objective", { ...draft.commercial_objective, objective: e.target.value })} />
              </FieldRow>
              <FieldRow label="Measure">
                <Input value={draft.commercial_objective.measure}
                  onChange={(e) => set("commercial_objective", { ...draft.commercial_objective, measure: e.target.value })} />
              </FieldRow>
              <FieldRow label="Attribution source" hint="Only verified revenue is ever credited.">
                <Input value={draft.commercial_objective.attribution_source}
                  onChange={(e) => set("commercial_objective", { ...draft.commercial_objective, attribution_source: e.target.value })} />
              </FieldRow>
            </div>
            <TagField
              label="Successful intern profile"
              hint="Observable behaviours at completion, not personality adjectives."
              values={draft.success_profile}
              onChange={(v) => set("success_profile", v)}
              placeholder="Closes a booking file end to end without rework"
            />
            <TagField
              label="Talent attributes to identify"
              values={draft.talent_attributes}
              onChange={(v) => set("talent_attributes", v)}
              placeholder="Commercial curiosity"
            />
          </div>
        );

      case "eligibility":
        return (
          <div className="space-y-8">
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldRow label="Qualification level">
                <Select
                  value={draft.academic_eligibility.qualification_level}
                  onValueChange={(v) => set("academic_eligibility", { ...draft.academic_eligibility, qualification_level: v })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {QUALIFICATION_LEVELS.map((q) => <SelectItem key={q} value={q}>{q}</SelectItem>)}
                  </SelectContent>
                </Select>
              </FieldRow>
              <FieldRow label="Year of study">
                <Input value={draft.academic_eligibility.year_of_study}
                  onChange={(e) => set("academic_eligibility", { ...draft.academic_eligibility, year_of_study: e.target.value })} />
              </FieldRow>
              <FieldRow label="Minimum grade (optional)">
                <Input value={draft.academic_eligibility.minimum_grade}
                  onChange={(e) => set("academic_eligibility", { ...draft.academic_eligibility, minimum_grade: e.target.value })} />
              </FieldRow>
              <div className="flex items-center gap-2 pt-6">
                <Checkbox
                  id="attachment_letter"
                  checked={draft.academic_eligibility.attachment_letter_required}
                  onCheckedChange={(c) => set("academic_eligibility", {
                    ...draft.academic_eligibility, attachment_letter_required: Boolean(c),
                  })}
                />
                <Label htmlFor="attachment_letter" className="text-sm">Institution attachment letter required</Label>
              </div>
            </div>
            <TagField
              label="Relevant academic programme families"
              hint="Broad families, never a single degree title — capability can arrive from several programmes."
              values={draft.academic_eligibility.programme_families}
              onChange={(v) => set("academic_eligibility", { ...draft.academic_eligibility, programme_families: v })}
              placeholder="Travel & tourism management"
            />
            <FieldRow label="Required documents">
              <div className="grid gap-2 sm:grid-cols-2">
                {REQUIRED_DOCUMENT_OPTIONS.map((doc) => (
                  <label key={doc} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={draft.required_documents.includes(doc)}
                      onCheckedChange={(c) => set(
                        "required_documents",
                        c ? [...draft.required_documents, doc] : draft.required_documents.filter((d) => d !== doc),
                      )}
                    />
                    {doc}
                  </label>
                ))}
              </div>
            </FieldRow>
            <Repeater
              title="Curriculum-to-capability map"
              description="Map coursework to the Yalla capability it supports. A degree title alone is not capability."
              rows={draft.curriculum_map}
              onChange={(rows) => set("curriculum_map", rows)}
              blank={() => ({ course: "", capability: "", application: "" })}
              render={(row, update) => (
                <>
                  <Input placeholder="Course unit" value={row.course} onChange={(e) => update({ course: e.target.value })} aria-label="Course unit" />
                  <Input placeholder="Yalla capability" value={row.capability} onChange={(e) => update({ capability: e.target.value })} aria-label="Capability" />
                  <Input placeholder="How it is applied" value={row.application} onChange={(e) => update({ application: e.target.value })} aria-label="Application" />
                </>
              )}
            />
            <Repeater
              title="Required competencies"
              rows={draft.competencies}
              onChange={(rows) => set("competencies", rows)}
              blank={() => ({ competency: "", evidence: "", level: "Working" })}
              render={(row, update) => (
                <>
                  <Input placeholder="Competency" value={row.competency} onChange={(e) => update({ competency: e.target.value })} aria-label="Required competency" />
                  <Input placeholder="Evidence that demonstrates it" value={row.evidence} onChange={(e) => update({ evidence: e.target.value })} aria-label="Competency evidence" />
                  <Input placeholder="Level" value={row.level} onChange={(e) => update({ level: e.target.value })} aria-label="Competency level" />
                </>
              )}
            />
            <TagField
              label="Practical capabilities"
              hint="Observable, checkable abilities."
              values={draft.practical_capabilities}
              onChange={(v) => set("practical_capabilities", v)}
              placeholder="Builds an itinerary with correct fare rules"
            />
            <TagField
              label="Experience equivalency accepted"
              hint="Routes other than formal employment that count as experience."
              values={draft.experience_equivalency}
              onChange={(v) => set("experience_equivalency", v)}
              placeholder="Student business or hustle with records"
            />
          </div>
        );

      case "selection":
        return (
          <div className="space-y-8">
            <Repeater
              title="Assessment design"
              rows={draft.assessment_design}
              onChange={(rows) => set("assessment_design", rows)}
              blank={() => ({ stage: "", instrument: "", weight: 0, passing: "" })}
              render={(row, update) => (
                <>
                  <Input placeholder="Stage" value={row.stage} onChange={(e) => update({ stage: e.target.value })} aria-label="Assessment stage" />
                  <Input placeholder="Instrument" value={row.instrument} onChange={(e) => update({ instrument: e.target.value })} aria-label="Instrument" />
                  <Input type="number" placeholder="Weight" value={row.weight} onChange={(e) => update({ weight: Number(e.target.value) || 0 })} aria-label="Assessment weight" />
                  <Input className="sm:col-span-3" placeholder="Passing standard" value={row.passing} onChange={(e) => update({ passing: e.target.value })} aria-label="Passing standard" />
                </>
              )}
            />
            <Repeater
              title="Structured interview framework"
              description="Every question carries a rubric and maximum marks, scored on the platform 1–5 scale where applicable."
              rows={draft.interview_framework}
              onChange={(rows) => set("interview_framework", rows)}
              blank={() => ({ question: "", rubric: "", max_marks: 5 })}
              render={(row, update) => (
                <>
                  <Input className="sm:col-span-2" placeholder="Question" value={row.question} onChange={(e) => update({ question: e.target.value })} aria-label="Interview question" />
                  <Input type="number" min={1} placeholder="Max marks" value={row.max_marks} onChange={(e) => update({ max_marks: Number(e.target.value) || 0 })} aria-label="Maximum marks" />
                  <Input className="sm:col-span-3" placeholder="Scoring rubric" value={row.rubric} onChange={(e) => update({ rubric: e.target.value })} aria-label="Rubric" />
                </>
              )}
            />
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold">Selection weighting model</h3>
                  <p className="text-xs text-muted-foreground">Weights must total 100. Version increments on every change.</p>
                </div>
                <Badge variant={Math.round(totalWeight) === 100 ? "secondary" : "destructive"}>
                  {Math.round(totalWeight)}%
                </Badge>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {(Object.keys(draft.selection_weights) as (keyof SelectionWeights)[]).map((key) => (
                  <FieldRow key={key} label={SELECTION_WEIGHT_LABELS[key]}>
                    <Input
                      type="number" min={0} max={100} value={draft.selection_weights[key]}
                      onChange={(e) => set("selection_weights", {
                        ...draft.selection_weights, [key]: Number(e.target.value) || 0,
                      })}
                    />
                  </FieldRow>
                ))}
              </div>
              <Button type="button" variant="outline" size="sm"
                onClick={() => set("selection_weights", { ...DEFAULT_SELECTION_WEIGHTS })}>
                Reset to the governed default model
              </Button>
            </div>
          </div>
        );

      case "publication":
      default:
        return (
          <div className="space-y-6">
            <FieldRow label="Advert summary">
              <Textarea rows={3} value={draft.public_preview.summary}
                onChange={(e) => set("public_preview", { ...draft.public_preview, summary: e.target.value })} />
            </FieldRow>
            <div className="grid gap-4 sm:grid-cols-3">
              <FieldRow label="What you will do">
                <Textarea rows={5} value={draft.public_preview.what_you_will_do}
                  onChange={(e) => set("public_preview", { ...draft.public_preview, what_you_will_do: e.target.value })} />
              </FieldRow>
              <FieldRow label="What you will learn">
                <Textarea rows={5} value={draft.public_preview.what_you_will_learn}
                  onChange={(e) => set("public_preview", { ...draft.public_preview, what_you_will_learn: e.target.value })} />
              </FieldRow>
              <FieldRow label="Who should apply">
                <Textarea rows={5} value={draft.public_preview.who_should_apply}
                  onChange={(e) => set("public_preview", { ...draft.public_preview, who_should_apply: e.target.value })} />
              </FieldRow>
            </div>
            <Repeater
              title="Application questions"
              rows={draft.application_questions}
              onChange={(rows) => set("application_questions", rows)}
              blank={() => ({ question: "", input: "Long text", required: true })}
              render={(row, update) => (
                <>
                  <Input className="sm:col-span-2" placeholder="Question" value={row.question} onChange={(e) => update({ question: e.target.value })} aria-label="Application question" />
                  <div className="flex items-center gap-2">
                    <Input placeholder="Input type" value={row.input} onChange={(e) => update({ input: e.target.value })} aria-label="Input type" />
                    <label className="flex items-center gap-1 text-xs">
                      <Checkbox checked={row.required} onCheckedChange={(c) => update({ required: Boolean(c) })} />
                      Required
                    </label>
                  </div>
                </>
              )}
            />
          </div>
        );
    }
  }, [step, draft, tracks.data, cohorts.data, programmes.data, staffOptions, positions.data, totalWeight]);

  return (
    <div className="p-6 lg:p-8">
      <StaffPageHeader
        eyebrow="Recruitment 360 · Interns 360"
        title="New internship programme"
        lede="An internship is a capability mandate, not a job advert. Publication is gated server-side until the learning design, productivity mandate, curriculum mapping and selection model are complete."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => navigate("/staff/recruitment/vacancies")}>
              <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />Back to vacancies
            </Button>
            <Button variant="outline" onClick={loadTravelSeed}>
              Load Travel &amp; Tour Operations seed
            </Button>
            <Button variant="outline" onClick={loadSalesMarketingSeed}>
              Load Sales &amp; Marketing seed
            </Button>
            <Button onClick={loadDestinationsSupplySeed}>
              Load Destinations &amp; Mobility Supply seed
            </Button>
          </div>
        }
      />

      {seedNotice ? (
        <Card className="mb-6 border-warning/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{seedNotice.title}</CardTitle>
            <CardDescription>{seedNotice.description}</CardDescription>
          </CardHeader>
          <CardContent className="pt-0 text-sm">
            {seedNotice.outstanding.length === 0 ? (
              <p className="text-muted-foreground">All referenced records resolved. Review each step, then create the programme.</p>
            ) : (
              <>
                <p className="font-medium">Assign from authoritative records before publication:</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                  {seedNotice.outstanding.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </>
            )}
          </CardContent>
        </Card>
      ) : null}

      <div className="mb-6 space-y-3">
        <Progress value={((step + 1) / STEPS.length) * 100} aria-label="Builder progress" />
        <div className="flex flex-wrap gap-2">
          {STEPS.map((s, i) => (
            <Button
              key={s.key}
              type="button"
              size="sm"
              variant={i === step ? "default" : "outline"}
              onClick={() => setStep(i)}
            >
              {i + 1}. {s.label}
            </Button>
          ))}
        </div>
      </div>

      {verdict ? (
        <Card className={`mb-6 border ${verdict.verdict === "READY" ? "border-success/40" : "border-warning/40"}`}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              {verdict.verdict === "READY"
                ? <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />
                : <AlertTriangle className="h-4 w-4 text-warning" aria-hidden="true" />}
              {verdict.verdict === "READY" ? "Ready to publish" : "Blocked from publication"}
            </CardTitle>
            <CardDescription>
              {verdict.vacancy_no ? `Reference ${verdict.vacancy_no}.` : null} Verdict issued by the server.
            </CardDescription>
          </CardHeader>
          {publicSlug ? (
            <CardContent className="pt-0">
              <Button variant="outline" size="sm" asChild>
                <a href={`/careers/${publicSlug}`} target="_blank" rel="noreferrer">
                  View the public announcement
                </a>
              </Button>
            </CardContent>
          ) : null}
          {verdict.blockers?.length ? (
            <CardContent>
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {verdict.blockers.map((b) => <li key={b}>{b}</li>)}
              </ul>
            </CardContent>
          ) : null}
        </Card>
      ) : null}

      <Card className="border-border/70 bg-card/70 backdrop-blur">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GraduationCap className="h-5 w-5 text-primary" aria-hidden="true" />
            {STEPS[step].label}
          </CardTitle>
          <CardDescription>Step {step + 1} of {STEPS.length}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {stepBody}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
            <Button type="button" variant="outline" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
              <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />Previous
            </Button>
            {step < STEPS.length - 1 ? (
              <Button type="button" onClick={() => setStep((s) => s + 1)}>
                Next<ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </Button>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                {created ? (
                  <p className="text-sm text-muted-foreground">
                    Programme {created.vacancy_no} already created from this draft — open it in vacancies to make changes.
                  </p>
                ) : null}
                {created ? (
                  <Button type="button" variant="outline" onClick={() => navigate("/staff/recruitment/vacancies")}>
                    Open vacancies
                  </Button>
                ) : (
                  <Button
                    type="button"
                    disabled={create.isPending}
                    onClick={() => {
                      if (create.isPending || created) return;
                      create.mutate();
                    }}
                  >
                    {create.isPending ? "Creating programme…" : "Create internship programme"}
                  </Button>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
