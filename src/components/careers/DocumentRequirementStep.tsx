/**
 * Candidate qualification step.
 *
 * The application is deliberately simple and direct: a candidate declares when
 * they graduated and the qualification they hold. No files are attached at
 * application stage — evidence is requested by recruitment later in the process.
 */
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface EducationDeclaration {
  education_status: string;
  qualification_level: string;
  graduation_date: string;
  completed_years: string;
  consolidated_transcript: boolean;
}

export const EMPTY_EDUCATION_DECLARATION: EducationDeclaration = {
  education_status: "graduated",
  qualification_level: "",
  graduation_date: "",
  completed_years: "",
  consolidated_transcript: false,
};

/** Qualifications a candidate may declare. */
export const QUALIFICATION_OPTIONS = [
  "Certificate",
  "Diploma",
  "Advanced Diploma",
  "Bachelor's degree",
] as const;

/** Files chosen per requirement, keyed by `requirement_key`. Retained for compatibility. */
export type SelectedDocuments = Record<string, File>;

/** Candidate answers to vacancy requirements. Retained for compatibility. */
export type RequirementDeclarations = Record<string, { declared: boolean; detail: string }>;

interface Props {
  declaration: EducationDeclaration;
  onDeclarationChange: (next: EducationDeclaration) => void;
}

export default function DocumentRequirementStep({ declaration, onDeclarationChange }: Props) {
  const set = (patch: Partial<EducationDeclaration>) =>
    onDeclarationChange({ ...declaration, education_status: "graduated", ...patch });

  return (
    <section className="p-5 rounded-xl bg-card border border-border space-y-5">
      <div>
        <h2 className="font-semibold">Qualification</h2>
        <p className="text-sm text-muted-foreground">
          Tell us when you graduated and the qualification you hold.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="graduation-date">Graduated on *</Label>
          <Input
            id="graduation-date"
            type="date"
            value={declaration.graduation_date}
            onChange={(e) => set({ graduation_date: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="qualification-level">Qualification *</Label>
          <Select
            value={declaration.qualification_level}
            onValueChange={(v) => set({ qualification_level: v })}
          >
            <SelectTrigger id="qualification-level"><SelectValue placeholder="Select qualification" /></SelectTrigger>
            <SelectContent>
              {QUALIFICATION_OPTIONS.map((q) => (
                <SelectItem key={q} value={q}>{q}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </section>
  );
}
