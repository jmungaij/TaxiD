/**
 * Recruitment 360 — evaluation completeness checks.
 *
 * Pure shaping over the server-computed `rec_evaluation_completeness` view:
 * flags interviews that have invitation letters but no evaluation forms and
 * lists exactly what is missing before an application may proceed to final
 * scoring. No business figures are derived beyond boolean completeness gates.
 */

export interface CompletenessRow {
  application_id: string;
  vacancy_id: string | null;
  candidate_id: string;
  candidate_name: string;
  stage: string;
  application_status: string;
  invitation_letters: number;
  interviews_total: number;
  interviews_completed: number;
  evaluations_submitted: number;
  interviews_missing_evaluation: number;
  open_conflicts: number;
}

export interface CompletenessGap {
  key: string;
  label: string;
  blocking: boolean;
}

/** Everything still missing for one application, in pipeline order. */
export function missingItems(row: CompletenessRow): CompletenessGap[] {
  const gaps: CompletenessGap[] = [];
  if (row.invitation_letters === 0 && row.interviews_total > 0) {
    gaps.push({
      key: "no_letter",
      label: "Interview held without a governed invitation letter on file",
      blocking: false,
    });
  }
  if (row.invitation_letters > 0 && row.interviews_completed === 0) {
    gaps.push({
      key: "letter_no_interview",
      label: "Invitation letter issued but no completed interview recorded",
      blocking: true,
    });
  }
  if (row.interviews_missing_evaluation > 0) {
    gaps.push({
      key: "missing_evaluation",
      label: `${row.interviews_missing_evaluation} completed interview${row.interviews_missing_evaluation === 1 ? "" : "s"} without a submitted evaluation form`,
      blocking: true,
    });
  }
  if (row.interviews_completed > 0 && row.evaluations_submitted === 0) {
    gaps.push({
      key: "no_evaluations",
      label: "No evaluation forms submitted at all",
      blocking: true,
    });
  }
  if (row.open_conflicts > 0) {
    gaps.push({
      key: "open_conflict",
      label: `${row.open_conflicts} evaluation conflict${row.open_conflicts === 1 ? "" : "s"} awaiting adjudication`,
      blocking: true,
    });
  }
  return gaps;
}

/** Final scoring is only reachable when no blocking gap remains. */
export function readyForScoring(row: CompletenessRow): { ready: boolean; blockers: string[] } {
  const blockers = missingItems(row).filter((g) => g.blocking).map((g) => g.label);
  return { ready: blockers.length === 0 && row.evaluations_submitted > 0, blockers };
}

export interface CompletenessSummary {
  total: number;
  ready: number;
  flagged: number;
  missingEvaluations: number;
  openConflicts: number;
}

/** Headline counts for the dashboard strip. */
export function completenessSummary(rows: CompletenessRow[]): CompletenessSummary {
  return {
    total: rows.length,
    ready: rows.filter((r) => readyForScoring(r).ready).length,
    flagged: rows.filter((r) => !readyForScoring(r).ready).length,
    missingEvaluations: rows.reduce((s, r) => s + r.interviews_missing_evaluation, 0),
    openConflicts: rows.reduce((s, r) => s + r.open_conflicts, 0),
  };
}
