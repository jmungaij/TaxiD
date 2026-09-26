/**
 * Bridge between the server document requirement engine
 * (`rec_public_document_check` → `RequirementItem`) and the Education module's
 * evidence keys (`evaluateEducationGate`).
 *
 * The two sides use different vocabularies: the requirement rules store
 * `kcpe` / `kcse` / `transcript` (+ `academic_year`), while the Education gate
 * reasons about `kcpe_certificate`, `kcse_certificate`, `transcript_year_<n>`
 * and `transcript_final`. Without this mapping the gate never sees a satisfied
 * academic document, which is exactly how the Education stage could be crossed
 * without evidence.
 *
 * Academic evidence is uploaded on the Education step itself, so the keys here
 * describe documents already persisted in storage — not browser file state.
 */
import type { DocumentChecklist, RequirementItem } from "@/lib/recruitment/documentControl";

/** Requirement classes whose evidence belongs to the Education stage. */
export const EDUCATION_DOC_CLASSES = ["education", "graduation"] as const;

/** True when this requirement is academic evidence owned by the Education step. */
export function isEducationRequirement(item: Pick<RequirementItem, "doc_class" | "doc_key">): boolean {
  if ((EDUCATION_DOC_CLASSES as readonly string[]).includes(item.doc_class)) return true;
  // Legacy rule rows carried the academic certificates in the `universal` class.
  return /^(kcpe|kcse)(_certificate)?$/.test(item.doc_key);
}

/**
 * Education-gate key for a server requirement row. Returns `null` when the
 * requirement is not academic evidence.
 */
export function educationEvidenceKey(
  item: Pick<RequirementItem, "doc_class" | "doc_key" | "academic_year" | "consolidated">,
): string | null {
  const key = item.doc_key;
  if (/^kcpe(_certificate)?$/.test(key)) return "kcpe_certificate";
  if (/^kcse(_certificate)?$/.test(key)) return "kcse_certificate";
  if (key.startsWith("transcript")) {
    if (item.academic_year) return `transcript_year_${item.academic_year}`;
    return "transcript_final";
  }
  if (key === "degree_certificate" || key === "diploma_certificate") return "graduation_certificate";
  return null;
}

/** Education-gate keys for every academic requirement already persisted. */
export function persistedEducationKeys(
  items: RequirementItem[] | undefined,
  persistedRequirementKeys: readonly string[],
): string[] {
  const persisted = new Set(persistedRequirementKeys);
  const keys = new Set<string>();
  for (const item of items ?? []) {
    if (!persisted.has(item.requirement_key)) continue;
    const key = educationEvidenceKey(item);
    if (key) keys.add(key);
  }
  return [...keys];
}

/** Academic requirements, in the order the candidate should satisfy them. */
export function educationRequirements(checklist: DocumentChecklist | null): RequirementItem[] {
  return (checklist?.items ?? []).filter(isEducationRequirement);
}

/** Non-academic requirements — these stay on the generic Documents step. */
export function generalRequirements(checklist: DocumentChecklist | null): RequirementItem[] {
  return (checklist?.items ?? []).filter((i) => !isEducationRequirement(i));
}

/**
 * The Education gate reasons about transcript and graduation evidence even when
 * a vacancy's requirement rules do not yet publish a rule row for them. Without
 * an upload control for those keys the stage would be impossible to satisfy, so
 * the ledger synthesises the missing academic requirements from the structured
 * record. They persist through the same upload path (`doc_key` +
 * `academic_year` / `consolidated`), so the server still owns storage identity.
 */
export function synthesisedAcademicRequirements(
  serverItems: readonly RequirementItem[],
  input: {
    transcriptKeys: readonly string[];
    graduationCertificateRequired?: boolean;
  },
): RequirementItem[] {
  const covered = new Set(
    serverItems.map((i) => educationEvidenceKey(i)).filter((k): k is string => !!k),
  );
  const base = {
    rule_id: null,
    doc_class: "education" as const,
    doc_type: "certificate" as const,
    mandatory: true,
    requires_verification: true,
    state: "missing" as const,
    file_name: null,
  };
  const out: RequirementItem[] = [];

  for (const key of input.transcriptKeys) {
    if (covered.has(key)) continue;
    const year = /^transcript_year_(\d+)$/.exec(key)?.[1];
    out.push({
      ...base,
      requirement_key: key,
      doc_key: "transcript",
      academic_year: year ? Number(year) : null,
      consolidated: !year,
      label: year ? `Academic transcript — Year ${year}` : "Final academic transcript",
      why_required: year
        ? "Each academic year of your programme must be evidenced by its own transcript."
        : "A consolidated transcript covering the whole programme.",
    });
  }

  if (input.graduationCertificateRequired && !covered.has("graduation_certificate")) {
    out.push({
      ...base,
      requirement_key: "graduation_certificate",
      doc_key: "degree_certificate",
      doc_class: "graduation",
      academic_year: null,
      consolidated: false,
      label: "Graduation certificate",
      why_required: "Your award must be evidenced by the graduation certificate.",
    });
  }

  return out;
}
