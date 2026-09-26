/**
 * Qualification / competency gap engine.
 *
 * Every gap must be evidenced: it is derived strictly from the position's
 * declared requirements compared against the employee's recorded qualifications
 * and assessed competencies. No requirement, no gap. No record, no claim of
 * competence. Nothing here invents a recommendation.
 */
import type { PositionRequirement, StaffQualification, StaffCompetency, OrgCompetency } from "./types";

export interface GapEvidence {
  requirement: string;
  requirement_kind: string;
  required_level: number | null;
  matched_record: string | null;
  matched_level: number | null;
  reason: "no_record" | "below_required_level" | "expired" | "unverified";
}

export interface DerivedGap {
  requirement_id: string;
  gap_kind: PositionRequirement["requirement_kind"];
  label: string;
  required_level: number | null;
  current_level: number | null;
  severity: "low" | "medium" | "high" | "critical";
  evidence: GapEvidence;
}

const norm = (s: string) => s.trim().toLowerCase();

function severityFor(mandatory: boolean, reason: GapEvidence["reason"]): DerivedGap["severity"] {
  if (!mandatory) return reason === "no_record" ? "low" : "low";
  if (reason === "no_record") return "critical";
  if (reason === "expired") return "high";
  if (reason === "unverified") return "medium";
  return "high";
}

export interface GapInputs {
  requirements: PositionRequirement[];
  qualifications: StaffQualification[];
  competencies: StaffCompetency[];
  competencyCatalogue: Pick<OrgCompetency, "id" | "name">[];
  /** Injected so results are deterministic in tests. */
  today?: Date;
}

/** Compare one employee against their position requirements. */
export function deriveGaps({
  requirements,
  qualifications,
  competencies,
  competencyCatalogue,
  today = new Date(),
}: GapInputs): DerivedGap[] {
  const catalogueById = new Map(competencyCatalogue.map((c) => [c.id, c.name]));
  const gaps: DerivedGap[] = [];

  for (const req of requirements) {
    if (req.requirement_kind === "competency" || req.competency_id) {
      const held = competencies.find((c) => c.competency_id === req.competency_id);
      const label = req.label || catalogueById.get(req.competency_id ?? "") || "Competency";
      if (!held) {
        gaps.push({
          requirement_id: req.id,
          gap_kind: "competency",
          label,
          required_level: req.required_level,
          current_level: null,
          severity: severityFor(req.mandatory, "no_record"),
          evidence: {
            requirement: label,
            requirement_kind: req.requirement_kind,
            required_level: req.required_level,
            matched_record: null,
            matched_level: null,
            reason: "no_record",
          },
        });
        continue;
      }
      const required = req.required_level ?? 1;
      if (held.assessed_level < required) {
        gaps.push({
          requirement_id: req.id,
          gap_kind: "competency",
          label,
          required_level: required,
          current_level: held.assessed_level,
          severity: severityFor(req.mandatory, "below_required_level"),
          evidence: {
            requirement: label,
            requirement_kind: req.requirement_kind,
            required_level: required,
            matched_record: `staff_competencies:${held.id}`,
            matched_level: held.assessed_level,
            reason: "below_required_level",
          },
        });
      }
      continue;
    }

    // qualification / certification / training requirements match on title
    const match = qualifications.find(
      (q) => norm(q.title).includes(norm(req.label)) || norm(req.label).includes(norm(q.title)),
    );
    if (!match) {
      gaps.push({
        requirement_id: req.id,
        gap_kind: req.requirement_kind,
        label: req.label,
        required_level: req.required_level,
        current_level: null,
        severity: severityFor(req.mandatory, "no_record"),
        evidence: {
          requirement: req.label,
          requirement_kind: req.requirement_kind,
          required_level: req.required_level,
          matched_record: null,
          matched_level: null,
          reason: "no_record",
        },
      });
      continue;
    }
    const expired = !!match.expires_on && new Date(match.expires_on) < today;
    if (expired || match.verification_status !== "verified") {
      gaps.push({
        requirement_id: req.id,
        gap_kind: req.requirement_kind,
        label: req.label,
        required_level: req.required_level,
        current_level: null,
        severity: severityFor(req.mandatory, expired ? "expired" : "unverified"),
        evidence: {
          requirement: req.label,
          requirement_kind: req.requirement_kind,
          required_level: req.required_level,
          matched_record: `staff_qualifications:${match.id}`,
          matched_level: null,
          reason: expired ? "expired" : "unverified",
        },
      });
    }
  }

  return gaps;
}

/** Training need derived from a gap — origin is traceable, never invented. */
export function trainingNeedFromGap(gap: DerivedGap) {
  const origin =
    gap.gap_kind === "competency"
      ? ("competency_gap" as const)
      : gap.gap_kind === "training"
        ? ("position_requirement" as const)
        : ("qualification_gap" as const);
  const priority =
    gap.severity === "critical" ? "critical" : gap.severity === "high" ? "high" : gap.severity === "medium" ? "medium" : "low";
  return {
    origin,
    title: `Close gap: ${gap.label}`,
    description:
      gap.evidence.reason === "no_record"
        ? `Position requires ${gap.label}; no record exists on the employee file.`
        : gap.evidence.reason === "below_required_level"
          ? `Assessed level ${gap.current_level} is below required level ${gap.required_level}.`
          : gap.evidence.reason === "expired"
            ? `Matching record ${gap.evidence.matched_record} has expired.`
            : `Matching record ${gap.evidence.matched_record} is not verified.`,
    priority: priority as "low" | "medium" | "high" | "critical",
  };
}
