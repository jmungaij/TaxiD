/**
 * INTERNS 360 data access.
 *
 * Every read is RLS-scoped server-side; every scoring, promotion, integrity and
 * conversion decision runs through a governed database routine so the UI can
 * never invent a number or grant a level it has no authority to grant.
 */
import { supabase } from "@/integrations/supabase/client";
import type {
  CohortHealthRow,
  InternAttribution,
  InternAuditEntry,
  InternCapstone,
  InternCohort,
  InternIntegrityFlag,
  InternLearningProgress,
  InternPerformanceScore,
  InternProfile,
  InternProgramme,
  InternReview,
  InternScoreboardRow,
  InternSkill,
  InternTrack,
  InternWorkItem,
} from "./types";

const unwrap = <T>(res: { data: T | null; error: { message: string } | null }): T => {
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? []) as unknown as T;
};

// ---------- catalogue ----------
export async function listProgrammes(): Promise<InternProgramme[]> {
  return unwrap(
    await supabase.from("intern_programmes").select("*").order("code"),
  ) as InternProgramme[];
}

export async function listTracks(): Promise<InternTrack[]> {
  return unwrap(
    await supabase.from("intern_tracks").select("*").order("sequence"),
  ) as unknown as InternTrack[];
}

export async function listCohorts(): Promise<InternCohort[]> {
  return unwrap(
    await supabase.from("intern_cohorts").select("*").order("start_date", { ascending: false }),
  ) as InternCohort[];
}

export async function listCohortHealth(): Promise<CohortHealthRow[]> {
  return unwrap(
    await supabase.from("v_intern_cohort_health").select("*").order("start_date", { ascending: false }),
  ) as CohortHealthRow[];
}

export async function createCohort(input: {
  programme_id: string;
  name: string;
  start_date?: string | null;
  end_date?: string | null;
  duration_weeks?: number | null;
  intake_size?: number | null;
  target_outcomes?: string | null;
}): Promise<InternCohort> {
  const { data, error } = await supabase.from("intern_cohorts").insert(input).select("*").single();
  if (error) throw new Error(error.message);
  return data as InternCohort;
}

export async function setCohortStatus(id: string, status: string): Promise<void> {
  const { error } = await supabase.from("intern_cohorts").update({ status }).eq("id", id);
  if (error) throw new Error(error.message);
}

// ---------- register ----------
export async function listScoreboard(filters?: {
  cohortId?: string;
  trackId?: string;
  status?: string;
}): Promise<InternScoreboardRow[]> {
  let q = supabase.from("v_intern_scoreboard").select("*");
  if (filters?.cohortId) q = q.eq("cohort_id", filters.cohortId);
  if (filters?.trackId) q = q.eq("track_id", filters.trackId);
  if (filters?.status) q = q.eq("status", filters.status);
  return unwrap(await q.order("performance_index", { ascending: false, nullsFirst: false })) as InternScoreboardRow[];
}

export async function getIntern(id: string): Promise<InternProfile | null> {
  const { data, error } = await supabase.from("intern_profiles").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as InternProfile) ?? null;
}

export async function updateIntern(id: string, patch: Partial<InternProfile>): Promise<void> {
  const { error } = await supabase.from("intern_profiles").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Applications that are far enough along the recruitment funnel to enrol. */
export async function listEnrollableApplications(): Promise<
  { id: string; stage: string; status: string; candidate: { id: string; full_name: string | null; email: string | null } | null }[]
> {
  const { data, error } = await supabase
    .from("rec_applications")
    .select("id, stage, status, rec_candidates(id, full_name, email)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  const enrolled = new Set(
    (
      unwrap(await supabase.from("intern_profiles").select("application_id")) as {
        application_id: string | null;
      }[]
    )
      .map((r) => r.application_id)
      .filter(Boolean) as string[],
  );
  return (data ?? [])
    .filter((r) => !enrolled.has(r.id))
    .map((r) => {
      const c = (r as unknown as { rec_candidates: { id: string; full_name: string | null; email: string | null } | null })
        .rec_candidates;
      return { id: r.id as string, stage: String(r.stage), status: String(r.status), candidate: c ?? null };
    });
}

export async function enrolFromApplication(input: {
  applicationId: string;
  cohortId: string;
  trackId: string;
  mentorStaffId?: string | null;
  supervisorStaffId?: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc("intern_enrol_from_application", {
    p_application: input.applicationId,
    p_cohort: input.cohortId,
    p_track: input.trackId,
    p_mentor: input.mentorStaffId ?? null,
    p_supervisor: input.supervisorStaffId ?? null,
  });
  if (error) throw new Error(error.message);
  return data as unknown as string;
}

// ---------- capability ----------
export async function listSkills(internId: string): Promise<InternSkill[]> {
  return unwrap(
    await supabase.from("intern_skills").select("*").eq("intern_id", internId).order("category"),
  ) as InternSkill[];
}

export async function upsertSkill(input: {
  intern_id: string;
  category: string;
  skill: string;
  level: number;
  classification?: string;
  evidence?: string | null;
  source?: string | null;
  confidence?: number;
}): Promise<void> {
  const { error } = await supabase
    .from("intern_skills")
    .upsert({ ...input, last_verified_at: new Date().toISOString() }, { onConflict: "intern_id,skill" });
  if (error) throw new Error(error.message);
}

export async function matchTracks(internId: string) {
  const { data, error } = await supabase.rpc("intern_match_tracks", { p_intern: internId });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as {
    track_id: string;
    track_code: string;
    track_name: string;
    score: number;
    evidenced_skills: number;
    skills_considered: number;
    reason: string;
  }[];
}

// ---------- learn ----------
export async function listLearning(internId: string): Promise<InternLearningProgress[]> {
  return unwrap(
    await supabase
      .from("intern_learning_progress")
      .select("*, intern_learning_modules(*)")
      .eq("intern_id", internId),
  ) as unknown as InternLearningProgress[];
}

export async function updateLearning(
  id: string,
  patch: {
    status?: InternLearningProgress["status"];
    assessment_score?: number | null;
    attempts?: number;
    application_evidence?: string | null;
    started_at?: string | null;
    completed_at?: string | null;
  },
): Promise<void> {
  const { error } = await supabase.from("intern_learning_progress").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}


export async function validateCompetency(id: string, score: number | null): Promise<void> {
  const { data: me } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("intern_learning_progress")
    .update({
      status: "validated",
      assessment_score: score,
      completed_at: new Date().toISOString(),
      validated_by: me.user?.id ?? null,
      validated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

// ---------- produce ----------
export async function listWork(internId: string): Promise<InternWorkItem[]> {
  return unwrap(
    await supabase
      .from("intern_work_items")
      .select("*")
      .eq("intern_id", internId)
      .order("created_at", { ascending: false }),
  ) as InternWorkItem[];
}

export async function createWork(input: {
  intern_id: string;
  title: string;
  description?: string | null;
  work_kind?: string;
  priority?: string;
  deadline?: string | null;
  quality_criteria?: string | null;
  complexity?: number;
  impact?: number;
}): Promise<void> {
  const { data: me } = await supabase.auth.getUser();
  const { error } = await supabase.from("intern_work_items").insert({ ...input, created_by: me.user?.id ?? null });
  if (error) throw new Error(error.message);
}

export async function reviewWork(
  id: string,
  input: { status: "ACCEPTED" | "REWORK"; quality_score: number; note?: string | null },
): Promise<void> {
  const { error } = await supabase.rpc("intern_review_work" as never, {
    p_item: id,
    p_decision: input.status,
    p_quality: input.quality_score,
    p_note: input.note ?? null,
  } as never);
  if (error) throw new Error(error.message);
}

/** Intern (or supervisor on their behalf) submits work with deliverable evidence. */
export async function submitWork(id: string, deliverableUrl: string, note?: string | null): Promise<void> {
  const { error } = await supabase.rpc("intern_submit_work" as never, {
    p_item: id,
    p_deliverable_url: deliverableUrl,
    p_note: note ?? null,
  } as never);
  if (error) throw new Error(error.message);
}

export async function setWorkStatus(id: string, status: string): Promise<void> {
  if (status === "SUBMITTED") {
    throw new Error("Submission requires deliverable evidence — use submitWork().");
  }
  const { error } = await supabase.from("intern_work_items").update({ status }).eq("id", id);
  if (error) throw new Error(error.message);
}



// ---------- sell ----------
export async function listAttributions(internId: string): Promise<InternAttribution[]> {
  return unwrap(
    await supabase
      .from("intern_commercial_attributions")
      .select("*")
      .eq("intern_id", internId)
      .order("created_at", { ascending: false }),
  ) as InternAttribution[];
}

export async function createAttribution(input: {
  intern_id: string;
  attribution_type: string;
  channel?: string | null;
  product_line?: string | null;
  subject_ref?: string | null;
  amount_kes?: number | null;
  notes?: string | null;
}): Promise<void> {
  const { data: me } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("intern_commercial_attributions")
    .insert({ ...input, created_by: me.user?.id ?? null, source_system: "manual", verified: false });
  if (error) throw new Error(error.message);
}

/**
 * Verification is server-governed: only a programme authority may verify, never the
 * intern themselves, and only against a named authoritative source system.
 */
export async function verifyAttribution(
  id: string,
  sourceSystem: string,
  opts?: { subject_id?: string | null; amount_kes?: number | null },
): Promise<void> {
  const { error } = await supabase.rpc("intern_verify_attribution" as never, {
    p_id: id,
    p_source_system: sourceSystem,
    p_subject_id: opts?.subject_id ?? null,
    p_amount_kes: opts?.amount_kes ?? null,
  } as never);
  if (error) throw new Error(error.message);
}


// ---------- perform ----------
export async function listScores(internId: string): Promise<InternPerformanceScore[]> {
  return unwrap(
    await supabase
      .from("intern_performance_scores")
      .select("*")
      .eq("intern_id", internId)
      .order("period_end", { ascending: false }),
  ) as unknown as InternPerformanceScore[];
}

export async function computePerformance(internId: string, start: string, end: string) {
  const { data, error } = await supabase.rpc("intern_compute_performance", {
    p_intern: internId,
    p_start: start,
    p_end: end,
  });
  if (error) throw new Error(error.message);
  return data as unknown as Record<string, unknown>;
}

export async function recomputeCohort(cohortId: string, start: string, end: string) {
  const { data, error } = await supabase.rpc("intern_recompute_cohort", {
    p_cohort: cohortId,
    p_start: start,
    p_end: end,
  });
  if (error) throw new Error(error.message);
  return data as unknown as { cohort_id: string; interns_computed: number };
}

export async function promoteLevel(internId: string, level: string, rationale?: string) {
  const { data, error } = await supabase.rpc("intern_promote_level", {
    p_intern: internId,
    p_level: level,
    p_rationale: rationale ?? null,
  });
  if (error) throw new Error(error.message);
  return data as unknown as Record<string, unknown>;
}

export async function scanIntegrity(internId: string) {
  const { data, error } = await supabase.rpc("intern_scan_integrity", { p_intern: internId });
  if (error) throw new Error(error.message);
  return data as unknown as { flags_raised: number };
}

export async function recommendConversion(internId: string) {
  const { data, error } = await supabase.rpc("intern_recommend_conversion", { p_intern: internId });
  if (error) throw new Error(error.message);
  return data as unknown as { recommended_outcome: string; performance_index: number };
}

export async function decideConversion(input: {
  id: string;
  decision: "APPROVED" | "DECLINED" | "DEFERRED";
  outcome: string;
  rationale: string;
}): Promise<void> {
  const { data: me } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("intern_conversion_decisions")
    .update({
      decision: input.decision,
      outcome: input.outcome,
      rationale: input.rationale,
      decided_by: me.user?.id ?? null,
      decided_at: new Date().toISOString(),
    })
    .eq("id", input.id);
  if (error) throw new Error(error.message);
}

export async function listConversionRecommendations(internId?: string) {
  let q = supabase.from("intern_conversion_decisions").select("*").order("created_at", { ascending: false });
  if (internId) q = q.eq("intern_id", internId);
  return unwrap(await q) as {
    id: string;
    intern_id: string;
    recommended_outcome: string;
    decision: string | null;
    outcome: string | null;
    rationale: string | null;
    evidence: Record<string, unknown>;
    created_at: string;
    decided_at: string | null;
  }[];
}

// ---------- governance ----------
export async function listFlags(internId?: string): Promise<InternIntegrityFlag[]> {
  let q = supabase.from("intern_integrity_flags").select("*").order("created_at", { ascending: false });
  if (internId) q = q.eq("intern_id", internId);
  return unwrap(await q) as unknown as InternIntegrityFlag[];
}

export async function resolveFlag(id: string, status: "CLEARED" | "SUBSTANTIATED"): Promise<void> {
  const { data: me } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("intern_integrity_flags")
    .update({ status, reviewed_by: me.user?.id ?? null, reviewed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function listAudit(internId?: string, limit = 100): Promise<InternAuditEntry[]> {
  let q = supabase.from("intern_audit_log").select("*").order("created_at", { ascending: false }).limit(limit);
  if (internId) q = q.eq("intern_id", internId);
  return unwrap(await q) as unknown as InternAuditEntry[];
}

// ---------- rhythm ----------
export async function listReviews(internId: string): Promise<InternReview[]> {
  return unwrap(
    await supabase.from("intern_reviews").select("*").eq("intern_id", internId).order("created_at", { ascending: false }),
  ) as InternReview[];
}

export async function createReview(input: {
  intern_id: string;
  review_type: string;
  period_label?: string | null;
  strengths?: string | null;
  concerns?: string | null;
  coaching?: string | null;
  subjective_rating?: number | null;
}): Promise<void> {
  const { data: me } = await supabase.auth.getUser();
  const { error } = await supabase.from("intern_reviews").insert({ ...input, reviewer_user_id: me.user?.id ?? null });
  if (error) throw new Error(error.message);
}

// ---------- capstone ----------
export async function listCapstones(internId: string): Promise<InternCapstone[]> {
  return unwrap(
    await supabase.from("intern_capstones").select("*").eq("intern_id", internId).order("created_at", { ascending: false }),
  ) as unknown as InternCapstone[];
}

export async function saveCapstone(input: {
  id?: string;
  intern_id: string;
  title: string;
  problem?: string | null;
  solution?: string | null;
  measured_impact?: string | null;
  recommendation?: string | null;
  evidence_url?: string | null;
  status?: string;
}): Promise<void> {
  if (input.id) {
    const { id, ...patch } = input;
    const { error } = await supabase.from("intern_capstones").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
    return;
  }
  const { error } = await supabase.from("intern_capstones").insert(input);
  if (error) throw new Error(error.message);
}

/** Seal a capstone for review: evidence is mandatory and the narrative becomes immutable. */
export async function submitCapstone(
  id: string,
  evidenceUrl: string,
  evidenceSha256?: string | null,
): Promise<{ content_sha256: string; seal_fingerprint: string }> {
  const { data, error } = await supabase.rpc("intern_submit_capstone" as never, {
    p_id: id,
    p_evidence_url: evidenceUrl,
    p_evidence_sha256: evidenceSha256 ?? null,
  } as never);
  if (error) throw new Error(error.message);
  return data as unknown as { content_sha256: string; seal_fingerprint: string };
}

/** Mentor decision: move to review, return for revision, or score against the rubric. */
export async function reviewCapstone(
  id: string,
  decision: "under_review" | "returned" | "scored",
  scores?: Record<string, number>,
  notes?: string | null,
): Promise<void> {
  const { error } = await supabase.rpc("intern_review_capstone" as never, {
    p_id: id,
    p_decision: decision,
    p_scores: scores ?? {},
    p_notes: notes ?? null,
  } as never);
  if (error) throw new Error(error.message);
}

export async function scoreCapstone(id: string, scores: Record<string, number>): Promise<void> {
  await reviewCapstone(id, "scored", scores);
}

/** Release gate: synthetic end-to-end certification of the Interns 360 controls. */
export async function runCertificationSuite(): Promise<{
  verdict: string;
  gaps: number;
  total_checks: number;
  checks: Array<{ check: string; passed: boolean; detail?: unknown }>;
}> {
  const { data, error } = await supabase.rpc("intern_certify_and_record" as never, {} as never);
  if (error) throw new Error(error.message);
  return data as never;
}

export async function listCertificationRuns(): Promise<
  Array<{ id: string; verdict: string; gaps: number; total_checks: number; created_at: string; result: unknown }>
> {
  return unwrap(
    await supabase
      .from("intern_certification_runs" as never)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(10),
  ) as never;
}

