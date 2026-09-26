/**
 * Staff 360 organisation data access.
 *
 * Thin, typed wrappers over the persisted organisation tables plus the
 * read-only projections of authoritative systems (Sales OS opportunities,
 * commercial transactions). All writes are governed by RLS: only platform
 * admins may mutate organisation structure, staff records and policies.
 */
import { supabase } from "@/integrations/supabase/client";
import type {
  OrgEntity, OrgUnit, OrgPosition, OrgCompetency, PositionRequirement, StaffMember,
  StaffDocument, StaffQualification, StaffCompetency, StaffGap, TrainingNeed,
  OrgObjective, StaffWorkItem, OrgPolicy, OrgPolicyVersion, OrgPolicyAck,
  StaffLifecycleEvent, OrgAuditEntry, StaffWorkReview, CorrectiveAction,
} from "./types";
import { deriveGaps, trainingNeedFromGap } from "./gapEngine";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const unwrap = <T,>(res: { data: T | null; error: { message: string } | null }): T => {
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? []) as T;
};

export const STAFF_DOC_BUCKET = "staff-documents";

/* ------------------------------ organisation ------------------------------ */

export async function getOrganisation(): Promise<OrgEntity | null> {
  const { data, error } = await db.from("org_entities").select("*").order("created_at").limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

export const saveOrganisation = async (patch: Partial<OrgEntity> & { id?: string }) => {
  if (patch.id) return unwrap(await db.from("org_entities").update(patch).eq("id", patch.id).select().single());
  return unwrap(await db.from("org_entities").insert(patch).select().single());
};

/* --------------------------------- units --------------------------------- */

export const listUnits = async (): Promise<OrgUnit[]> =>
  unwrap(await db.from("org_units").select("*").order("unit_type").order("sort_order").order("name"));

export const saveUnit = async (patch: Partial<OrgUnit> & { id?: string }) => {
  const { id, ...rest } = patch;
  if (id) return unwrap(await db.from("org_units").update(rest).eq("id", id).select().single());
  return unwrap(await db.from("org_units").insert(rest).select().single());
};

export const setUnitStatus = async (id: string, status: OrgUnit["status"]) =>
  unwrap(await db.from("org_units").update({ status }).eq("id", id).select().single());

/** Build the division → department → team tree. */
export function buildUnitTree(units: OrgUnit[]) {
  const byParent = new Map<string | null, OrgUnit[]>();
  for (const u of units) {
    const key = u.parent_unit_id ?? null;
    byParent.set(key, [...(byParent.get(key) ?? []), u]);
  }
  const walk = (parent: string | null, depth = 0): { unit: OrgUnit; depth: number }[] =>
    (byParent.get(parent) ?? []).flatMap((u) => [{ unit: u, depth }, ...walk(u.id, depth + 1)]);
  return walk(null);
}

/* ------------------------------- positions ------------------------------- */

export const listPositions = async (): Promise<OrgPosition[]> =>
  unwrap(await db.from("org_positions").select("*").order("title"));

export const savePosition = async (patch: Partial<OrgPosition> & { id?: string }) => {
  const { id, ...rest } = patch;
  if (id) return unwrap(await db.from("org_positions").update(rest).eq("id", id).select().single());
  return unwrap(await db.from("org_positions").insert(rest).select().single());
};

export const listCompetencies = async (): Promise<OrgCompetency[]> =>
  unwrap(await db.from("org_competencies").select("*").order("name"));

export const saveCompetency = async (patch: Partial<OrgCompetency>) =>
  unwrap(await db.from("org_competencies").insert(patch).select().single());

export const listRequirements = async (positionId?: string): Promise<PositionRequirement[]> => {
  let q = db.from("org_position_requirements").select("*").order("created_at");
  if (positionId) q = q.eq("position_id", positionId);
  return unwrap(await q);
};

export const saveRequirement = async (patch: Partial<PositionRequirement>) =>
  unwrap(await db.from("org_position_requirements").insert(patch).select().single());

export const deleteRequirement = async (id: string) => {
  const { error } = await db.from("org_position_requirements").delete().eq("id", id);
  if (error) throw new Error(error.message);
};

/* --------------------------------- staff --------------------------------- */

export const listStaff = async (): Promise<StaffMember[]> =>
  unwrap(await db.from("staff_members").select("*").order("full_name"));

export const getStaff = async (id: string): Promise<StaffMember | null> => {
  const { data, error } = await db.from("staff_members").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
};

export const getMyStaffRecord = async (): Promise<StaffMember | null> => {
  const { data: session } = await supabase.auth.getUser();
  const uid = session.user?.id;
  if (!uid) return null;
  const { data, error } = await db.from("staff_members").select("*").eq("user_id", uid).maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
};

export const saveStaff = async (patch: Partial<StaffMember> & { id?: string }) => {
  const { id, ...rest } = patch;
  if (id) return unwrap(await db.from("staff_members").update(rest).eq("id", id).select().single());
  return unwrap(await db.from("staff_members").insert(rest).select().single());
};

export const listDirectReports = async (managerStaffId: string): Promise<StaffMember[]> =>
  unwrap(await db.from("staff_members").select("*").eq("manager_staff_id", managerStaffId).order("full_name"));

/* ------------------------------- documents ------------------------------- */

export const listStaffDocuments = async (staffId: string): Promise<StaffDocument[]> =>
  unwrap(await db.from("staff_documents").select("*").eq("staff_id", staffId).order("created_at", { ascending: false }));

export async function uploadStaffDocument(input: {
  staffId: string;
  file: File;
  docType: string;
  title: string;
  description?: string;
  issueDate?: string | null;
  expiryDate?: string | null;
  classification?: StaffDocument["classification"];
  supersedesId?: string | null;
}) {
  const { data: session } = await supabase.auth.getUser();
  const path = `${input.staffId}/${Date.now()}-${input.file.name.replace(/[^\w.-]/g, "_")}`;
  const up = await supabase.storage.from(STAFF_DOC_BUCKET).upload(path, input.file, { upsert: false });
  if (up.error) throw new Error(up.error.message);

  let version = 1;
  if (input.supersedesId) {
    const prev = await db.from("staff_documents").select("version").eq("id", input.supersedesId).maybeSingle();
    version = (prev.data?.version ?? 1) + 1;
  }

  return unwrap(
    await db.from("staff_documents").insert({
      staff_id: input.staffId,
      doc_type: input.docType,
      title: input.title,
      description: input.description ?? null,
      storage_path: path,
      file_name: input.file.name,
      mime_type: input.file.type,
      issue_date: input.issueDate || null,
      expiry_date: input.expiryDate || null,
      classification: input.classification ?? "confidential",
      version,
      supersedes_document_id: input.supersedesId ?? null,
      uploaded_by: session.user?.id ?? null,
    }).select().single(),
  );
}

export async function documentUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(STAFF_DOC_BUCKET).createSignedUrl(path, 300);
  if (error) return null;
  return data?.signedUrl ?? null;
}

export const verifyDocument = async (id: string, decision: "verified" | "rejected", reason?: string) => {
  const { data: session } = await supabase.auth.getUser();
  return unwrap(
    await db.from("staff_documents").update({
      verification_status: decision,
      verified_by: session.user?.id ?? null,
      verified_at: new Date().toISOString(),
      rejection_reason: decision === "rejected" ? (reason ?? null) : null,
    }).eq("id", id).select().single(),
  );
};

/** Documents expiring within `days` or already expired, across the workforce. */
export async function expiringDocuments(days = 30): Promise<StaffDocument[]> {
  const horizon = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  return unwrap(
    await db.from("staff_documents").select("*").not("expiry_date", "is", null)
      .lte("expiry_date", horizon).order("expiry_date"),
  );
}

/* ------------------- qualifications, competencies, gaps ------------------- */

export const listQualifications = async (staffId: string): Promise<StaffQualification[]> =>
  unwrap(await db.from("staff_qualifications").select("*").eq("staff_id", staffId).order("awarded_on", { ascending: false }));

export const saveQualification = async (patch: Partial<StaffQualification>) =>
  unwrap(await db.from("staff_qualifications").insert(patch).select().single());

export const setQualificationVerification = async (id: string, status: "verified" | "rejected" | "pending") =>
  unwrap(await db.from("staff_qualifications").update({ verification_status: status }).eq("id", id).select().single());

export const listStaffCompetencies = async (staffId: string): Promise<StaffCompetency[]> =>
  unwrap(await db.from("staff_competencies").select("*").eq("staff_id", staffId));

export const saveStaffCompetency = async (patch: Partial<StaffCompetency>) =>
  unwrap(
    await db.from("staff_competencies")
      .upsert(patch, { onConflict: "staff_id,competency_id" })
      .select().single(),
  );

export const listGaps = async (staffId?: string): Promise<StaffGap[]> => {
  let q = db.from("staff_gaps").select("*").order("severity");
  if (staffId) q = q.eq("staff_id", staffId);
  return unwrap(await q);
};

/**
 * Recompute gaps for one employee from their position requirements and
 * persist the result. Returns the persisted gaps. Gaps whose requirement is
 * now satisfied are closed rather than deleted, keeping the trail intact.
 */
export async function recomputeGaps(staffId: string): Promise<{ gaps: StaffGap[]; closed: number }> {
  const staff = await getStaff(staffId);
  if (!staff?.position_id) throw new Error("Assign the employee to a position before comparing requirements.");

  const [requirements, qualifications, competencies, catalogue, existing] = await Promise.all([
    listRequirements(staff.position_id),
    listQualifications(staffId),
    listStaffCompetencies(staffId),
    listCompetencies(),
    listGaps(staffId),
  ]);

  const derived = deriveGaps({ requirements, qualifications, competencies, competencyCatalogue: catalogue });
  const derivedByReq = new Map(derived.map((d) => [d.requirement_id, d]));

  for (const d of derived) {
    await db.from("staff_gaps").upsert(
      {
        staff_id: staffId,
        position_id: staff.position_id,
        requirement_id: d.requirement_id,
        gap_kind: d.gap_kind,
        label: d.label,
        required_level: d.required_level,
        current_level: d.current_level,
        severity: d.severity,
        evidence: d.evidence as unknown as Record<string, unknown>,
        status: "open",
        closed_at: null,
      },
      { onConflict: "staff_id,requirement_id" },
    );
  }

  let closed = 0;
  for (const g of existing) {
    if (g.requirement_id && !derivedByReq.has(g.requirement_id) && g.status !== "closed") {
      await db.from("staff_gaps").update({ status: "closed", closed_at: new Date().toISOString() }).eq("id", g.id);
      closed += 1;
    }
  }
  return { gaps: await listGaps(staffId), closed };
}

/* ---------------------------- training needs ---------------------------- */

export const listTrainingNeeds = async (staffId?: string): Promise<TrainingNeed[]> => {
  let q = db.from("staff_training_needs").select("*").order("created_at", { ascending: false });
  if (staffId) q = q.eq("staff_id", staffId);
  return unwrap(await q);
};

export const saveTrainingNeed = async (patch: Partial<TrainingNeed> & { id?: string }) => {
  const { id, ...rest } = patch;
  if (id) return unwrap(await db.from("staff_training_needs").update(rest).eq("id", id).select().single());
  return unwrap(await db.from("staff_training_needs").insert(rest).select().single());
};

/** Turn an evidenced gap into a training need. */
export async function createTrainingNeedFromGap(gap: StaffGap) {
  const derived = {
    requirement_id: gap.requirement_id ?? "",
    gap_kind: gap.gap_kind,
    label: gap.label,
    required_level: gap.required_level,
    current_level: gap.current_level,
    severity: gap.severity as "low" | "medium" | "high" | "critical",
    evidence: gap.evidence as never,
  };
  const need = trainingNeedFromGap(derived as never);
  const row = await saveTrainingNeed({
    staff_id: gap.staff_id,
    gap_id: gap.id,
    origin: need.origin,
    title: need.title,
    description: need.description,
    priority: need.priority,
    status: "identified",
  });
  await db.from("staff_gaps").update({ status: "in_progress" }).eq("id", gap.id);
  return row;
}

/** Assessment result decides competency, not attendance. */
export async function recordTrainingAssessment(id: string, score: number, passed: boolean) {
  return saveTrainingNeed({
    id,
    assessment_score: score,
    assessment_passed: passed,
    status: passed ? "certified" : "assessed",
    completed_at: passed ? new Date().toISOString() : null,
  });
}

/* ------------------------------- objectives ------------------------------ */

export const listObjectives = async (filter?: { unitId?: string; staffId?: string }): Promise<OrgObjective[]> => {
  let q = db.from("org_objectives").select("*").order("level").order("deadline");
  if (filter?.unitId) q = q.eq("unit_id", filter.unitId);
  if (filter?.staffId) q = q.eq("staff_id", filter.staffId);
  return unwrap(await q);
};

export const saveObjective = async (patch: Partial<OrgObjective> & { id?: string }) => {
  const { id, ...rest } = patch;
  if (id) return unwrap(await db.from("org_objectives").update(rest).eq("id", id).select().single());
  return unwrap(await db.from("org_objectives").insert(rest).select().single());
};

/** Cascade a parent objective down to an employee, preserving the chain. */
export async function cascadeObjective(parent: OrgObjective, to: { staffId: string; unitId: string | null; target: number; deadline: string | null }) {
  return saveObjective({
    org_id: parent.org_id,
    parent_objective_id: parent.id,
    level: "employee",
    unit_id: to.unitId ?? parent.unit_id,
    staff_id: to.staffId,
    owner_staff_id: to.staffId,
    title: parent.title,
    description: `Cascaded from ${parent.level} objective “${parent.title}”.`,
    kpi_label: parent.kpi_label,
    kpi_unit: parent.kpi_unit,
    baseline: parent.baseline,
    target: to.target,
    deadline: to.deadline ?? parent.deadline,
    status: "active",
    provenance: parent.provenance,
  });
}

export const objectiveVariance = (o: OrgObjective) =>
  o.actual === null || o.actual === undefined ? null : Number(o.actual) - Number(o.target);

/* ------------------------------- work items ------------------------------ */

export const listWorkItems = async (filter?: { staffId?: string; unitId?: string; kind?: string }): Promise<StaffWorkItem[]> => {
  let q = db.from("staff_work_items").select("*").order("next_action_due", { nullsFirst: false });
  if (filter?.staffId) q = q.eq("staff_id", filter.staffId);
  if (filter?.unitId) q = q.eq("unit_id", filter.unitId);
  if (filter?.kind) q = q.eq("work_kind", filter.kind);
  return unwrap(await q);
};

export const saveWorkItem = async (patch: Partial<StaffWorkItem> & { id?: string }) => {
  const { id, ...rest } = patch;
  if (id) return unwrap(await db.from("staff_work_items").update(rest).eq("id", id).select().single());
  return unwrap(await db.from("staff_work_items").insert(rest).select().single());
};

/* ------------------ authoritative Sales OS (read + progress) ------------- */

export interface SalesOpportunity {
  id: string;
  opportunity_ref: string;
  title: string;
  stage: string;
  customer_kind: string;
  customer_label: string | null;
  corporate_id: string | null;
  expected_value_cents: number | null;
  currency: string;
  probability_pct: number | null;
  owner_user_id: string | null;
  provenance: string;
  updated_at: string;
}

export const OPPORTUNITY_STAGES = [
  "lead", "qualified", "opportunity", "quoted", "offered", "accepted", "won", "lost",
] as const;

/** Read the authoritative Sales OS pipeline. Staff 360 never copies it. */
export const listOpportunities = async (): Promise<SalesOpportunity[]> =>
  unwrap(
    await db.from("commercial_opportunities")
      .select("id, opportunity_ref, title, stage, customer_kind, customer_label, corporate_id, expected_value_cents, currency, probability_pct, owner_user_id, provenance, updated_at")
      .order("updated_at", { ascending: false }).limit(200),
  );

export const getOpportunities = async (ids: string[]): Promise<SalesOpportunity[]> => {
  if (ids.length === 0) return [];
  return unwrap(
    await db.from("commercial_opportunities")
      .select("id, opportunity_ref, title, stage, customer_kind, customer_label, corporate_id, expected_value_cents, currency, probability_pct, owner_user_id, provenance, updated_at")
      .in("id", ids),
  );
};

/** Assign an existing authoritative opportunity as staff work. */
export async function assignOpportunity(opportunity: SalesOpportunity, staff: StaffMember, opts?: { objectiveId?: string | null; nextAction?: string; due?: string | null }) {
  const { data: session } = await supabase.auth.getUser();
  if (staff.user_id) {
    await db.from("commercial_opportunities").update({ owner_user_id: staff.user_id }).eq("id", opportunity.id);
  }
  return saveWorkItem({
    staff_id: staff.id,
    unit_id: staff.unit_id,
    objective_id: opts?.objectiveId ?? null,
    work_kind: "sales_opportunity",
    title: opportunity.title,
    description: `Authoritative record: commercial_opportunities/${opportunity.opportunity_ref}`,
    source_table: "commercial_opportunities",
    source_id: opportunity.id,
    priority: (opportunity.expected_value_cents ?? 0) > 500_000_00 ? "high" : "medium",
    status: "open",
    next_action: opts?.nextAction ?? "Contact customer and qualify requirement",
    next_action_due: opts?.due ?? null,
    assigned_by: session.user?.id ?? null,
  });
}

/** Progress the authoritative opportunity; the work item records the action. */
export async function progressOpportunity(workItem: StaffWorkItem, opportunityId: string, nextStage: string, note: string) {
  const { error } = await db.from("commercial_opportunities").update({ stage: nextStage }).eq("id", opportunityId);
  if (error) throw new Error(error.message);
  return saveWorkItem({
    id: workItem.id,
    status: nextStage === "won" || nextStage === "lost" ? "done" : "in_progress",
    started_at: workItem.started_at ?? new Date().toISOString(),
    completed_at: nextStage === "won" || nextStage === "lost" ? new Date().toISOString() : null,
    outcome: `${nextStage}: ${note}`,
    next_action: nextStage === "won" || nextStage === "lost" ? null : note,
  });
}

/* --------------------- commercial traceability chain -------------------- */

export interface TraceLink {
  transaction_ref: string | null;
  opportunity_id: string | null;
  booking_ref: string | null;
  payment_reference: string | null;
  gross_amount_cents: number | null;
  currency: string | null;
  stage: string | null;
  provenance: string | null;
}

/** Follow opportunity → booking → fulfilment → payment → revenue in the spine. */
export async function traceOpportunity(opportunityId: string): Promise<TraceLink[]> {
  const { data, error } = await db.from("commercial_transactions")
    .select("transaction_ref, opportunity_id, booking_ref, payment_reference, gross_amount_cents, currency, stage, provenance")
    .eq("opportunity_id", opportunityId);
  if (error) return [];
  return (data ?? []) as TraceLink[];
}

/* -------------------------------- policies ------------------------------- */

export const listPolicies = async (): Promise<OrgPolicy[]> =>
  unwrap(await db.from("org_policies").select("*").order("category").order("title"));

export const savePolicy = async (patch: Partial<OrgPolicy> & { id?: string }) => {
  const { id, ...rest } = patch;
  if (id) return unwrap(await db.from("org_policies").update(rest).eq("id", id).select().single());
  return unwrap(await db.from("org_policies").insert(rest).select().single());
};

export const listPolicyVersions = async (policyId: string): Promise<OrgPolicyVersion[]> =>
  unwrap(await db.from("org_policy_versions").select("*").eq("policy_id", policyId).order("version", { ascending: false }));

export const savePolicyVersion = async (patch: Partial<OrgPolicyVersion>) =>
  unwrap(await db.from("org_policy_versions").insert(patch).select().single());

/** Advance a policy through draft → review → approve → publish → archive. */
export async function transitionPolicy(policy: OrgPolicy, next: OrgPolicy["status"]) {
  const { data: session } = await supabase.auth.getUser();
  const versions = await listPolicyVersions(policy.id);
  const current = versions.find((v) => v.version === policy.current_version);
  if (current) {
    const patch: Partial<OrgPolicyVersion> = {
      status: next === "published" ? "published" : next === "approved" ? "approved" : next === "in_review" ? "in_review" : "draft",
    };
    if (next === "approved") { patch.approved_by = session.user?.id ?? null; patch.approved_at = new Date().toISOString(); }
    if (next === "published") patch.published_at = new Date().toISOString();
    await db.from("org_policy_versions").update(patch).eq("id", current.id);
  }
  return savePolicy({ id: policy.id, status: next });
}

/** Create the next version of a published policy and return to draft. */
export async function revisePolicy(policy: OrgPolicy, body: string, changeSummary: string) {
  const { data: session } = await supabase.auth.getUser();
  const nextVersion = policy.current_version + 1;
  await db.from("org_policy_versions").update({ status: "superseded" }).eq("policy_id", policy.id).eq("version", policy.current_version);
  await savePolicyVersion({
    policy_id: policy.id, version: nextVersion, body, change_summary: changeSummary,
    status: "draft", authored_by: session.user?.id ?? null,
  });
  return savePolicy({ id: policy.id, current_version: nextVersion, status: "draft" });
}

export const listPolicyAssignments = async (policyId?: string) => {
  let q = db.from("org_policy_assignments").select("*");
  if (policyId) q = q.eq("policy_id", policyId);
  return unwrap(await q) as OrgPolicyAssignmentRow[];
};

export interface OrgPolicyAssignmentRow {
  id: string; policy_id: string; unit_id: string | null; position_id: string | null;
  staff_id: string | null; platform_role: string | null; created_at: string;
}

export const assignPolicy = async (patch: Partial<OrgPolicyAssignmentRow>) =>
  unwrap(await db.from("org_policy_assignments").insert(patch).select().single());

export const listPolicyAcks = async (policyId?: string): Promise<OrgPolicyAck[]> => {
  let q = db.from("org_policy_acknowledgements").select("*").order("acknowledged_at", { ascending: false });
  if (policyId) q = q.eq("policy_id", policyId);
  return unwrap(await q);
};

export async function acknowledgePolicy(policy: OrgPolicy, staffId: string) {
  const { data: session } = await supabase.auth.getUser();
  return unwrap(
    await db.from("org_policy_acknowledgements").insert({
      policy_id: policy.id, policy_version: policy.current_version, staff_id: staffId,
      acknowledged_by_user: session.user?.id ?? null,
    }).select().single(),
  );
}

/** Policies applicable to an employee via unit, position or direct assignment. */
export function applicablePolicies(policies: OrgPolicy[], assignments: OrgPolicyAssignmentRow[], staff: StaffMember) {
  const ids = new Set(
    assignments
      .filter((a) =>
        (a.staff_id && a.staff_id === staff.id) ||
        (a.unit_id && a.unit_id === staff.unit_id) ||
        (a.position_id && a.position_id === staff.position_id))
      .map((a) => a.policy_id),
  );
  return policies.filter((p) => p.status === "published" && ids.has(p.id));
}

/* ------------------------- lifecycle & audit trail ----------------------- */

export const listLifecycle = async (staffId: string): Promise<StaffLifecycleEvent[]> =>
  unwrap(await db.from("staff_lifecycle_events").select("*").eq("staff_id", staffId).order("effective_date", { ascending: false }));

export const recordLifecycleEvent = async (patch: Partial<StaffLifecycleEvent>) => {
  const { data: session } = await supabase.auth.getUser();
  return unwrap(await db.from("staff_lifecycle_events").insert({ ...patch, recorded_by: session.user?.id ?? null }).select().single());
};

/**
 * Offboarding: status change, access review flag, work reassignment and a
 * lifecycle trail. Role revocation stays with the authoritative role system.
 */
export async function startOffboarding(staff: StaffMember, opts: { reassignToStaffId?: string | null; notes?: string }) {
  await saveStaff({ id: staff.id, employment_status: "offboarding" });
  await recordLifecycleEvent({
    staff_id: staff.id, event_kind: "offboarding_started",
    from_value: staff.employment_status, to_value: "offboarding", notes: opts.notes ?? null,
  });
  let reassigned = 0;
  if (opts.reassignToStaffId) {
    const open = await listWorkItems({ staffId: staff.id });
    for (const w of open.filter((i) => i.status === "open" || i.status === "in_progress")) {
      await saveWorkItem({ id: w.id, staff_id: opts.reassignToStaffId });
      reassigned += 1;
    }
    await recordLifecycleEvent({
      staff_id: staff.id, event_kind: "work_reassigned",
      to_value: opts.reassignToStaffId, notes: `${reassigned} open work item(s) reassigned`,
    });
  }
  return { reassigned };
}

export const listAudit = async (filter?: { table?: string; entityId?: string; limit?: number }): Promise<OrgAuditEntry[]> => {
  let q = db.from("org_audit_log").select("*").order("created_at", { ascending: false }).limit(filter?.limit ?? 100);
  if (filter?.table) q = q.eq("entity_table", filter.table);
  if (filter?.entityId) q = q.eq("entity_id", filter.entityId);
  return unwrap(await q);
};

/* --------------------------- productivity model -------------------------- */

export interface ProductivityView {
  assigned: number;
  completed: number;
  inFlight: number;
  overdue: number;
  reworked: number;
  escalated: number;
  avgCycleDays: number | null;
  slaBreaches: number;
  objectivesAchieved: number;
  objectivesTotal: number;
}

/**
 * Outcome-based productivity. Deliberately excludes surveillance signals —
 * no login frequency, screen time, clicks or activity monitoring.
 */
export function productivityFrom(items: StaffWorkItem[], objectives: OrgObjective[]): ProductivityView {
  const done = items.filter((i) => i.status === "done");
  const cycles = done
    .map((i) => (i.completed_at && i.assigned_at ? (new Date(i.completed_at).getTime() - new Date(i.assigned_at).getTime()) / 86_400_000 : null))
    .filter((n): n is number => n !== null);
  const today = new Date().toISOString().slice(0, 10);
  return {
    assigned: items.length,
    completed: done.length,
    inFlight: items.filter((i) => i.status === "in_progress").length,
    overdue: items.filter((i) => i.status !== "done" && i.next_action_due && i.next_action_due < today).length,
    reworked: items.filter((i) => i.quality_flag === "rework").length,
    escalated: items.filter((i) => i.quality_flag === "escalated").length,
    avgCycleDays: cycles.length ? Number((cycles.reduce((a, b) => a + b, 0) / cycles.length).toFixed(1)) : null,
    slaBreaches: items.filter((i) => i.sla_due_at && i.status !== "done" && new Date(i.sla_due_at) < new Date()).length,
    objectivesAchieved: objectives.filter((o) => o.status === "achieved").length,
    objectivesTotal: objectives.length,
  };
}

/* ----------------------- manager review of work items -------------------- */

export const listWorkReviews = async (filter?: { workItemId?: string; staffId?: string; limit?: number }): Promise<StaffWorkReview[]> => {
  let q = db.from("staff_work_reviews").select("*").order("created_at", { ascending: false }).limit(filter?.limit ?? 200);
  if (filter?.workItemId) q = q.eq("work_item_id", filter.workItemId);
  if (filter?.staffId) q = q.eq("staff_id", filter.staffId);
  return unwrap(await q);
};

/** Employee submits completed work for manager review. */
export async function submitForReview(item: StaffWorkItem, reviewerStaffId: string | null, note: string) {
  if (!note.trim()) throw new Error("Describe what was delivered — the submission note is the review evidence.");
  const { data: session } = await supabase.auth.getUser();
  await db.from("staff_work_reviews").insert({
    work_item_id: item.id,
    staff_id: item.staff_id,
    reviewer_staff_id: reviewerStaffId,
    reviewer_user_id: session.user?.id ?? null,
    decision: "submitted",
    rationale: note.trim(),
    source_of_record: item.source_table ?? "staff_work_items",
    source_record_id: item.source_id ?? item.id,
  });
  return saveWorkItem({
    id: item.id,
    status: "in_review",
    review_state: "submitted",
    reviewer_staff_id: reviewerStaffId,
    started_at: item.started_at ?? new Date().toISOString(),
  });
}

export interface ReviewDecisionInput {
  decision: "approved" | "returned" | "changes_requested";
  rationale: string;
  qualityRating?: "good" | "rework" | "escalated" | null;
  requiredAction?: string | null;
  reviewerStaffId?: string | null;
}

/**
 * Manager decision on submitted work. Every decision is documented: rationale
 * is mandatory, and a return must say what has to change. Approval closes the
 * work item; a return sends it back with a rework flag so the productivity
 * baseline counts it honestly.
 */
export async function decideWorkReview(item: StaffWorkItem, input: ReviewDecisionInput) {
  const rationale = input.rationale.trim();
  if (!rationale) throw new Error("A documented rationale is required for every review decision.");
  if (input.decision !== "approved" && !input.requiredAction?.trim()) {
    throw new Error("State the required action so the employee knows what must change.");
  }
  const { data: session } = await supabase.auth.getUser();
  await db.from("staff_work_reviews").insert({
    work_item_id: item.id,
    staff_id: item.staff_id,
    reviewer_staff_id: input.reviewerStaffId ?? item.reviewer_staff_id ?? null,
    reviewer_user_id: session.user?.id ?? null,
    decision: input.decision,
    rationale,
    quality_rating: input.qualityRating ?? (input.decision === "approved" ? "good" : "rework"),
    required_action: input.requiredAction?.trim() ?? null,
    source_of_record: item.source_table ?? "staff_work_items",
    source_record_id: item.source_id ?? item.id,
  });

  const approved = input.decision === "approved";
  return saveWorkItem({
    id: item.id,
    status: approved ? "done" : "in_progress",
    review_state: approved ? "approved" : "returned",
    reviewed_at: new Date().toISOString(),
    completed_at: approved ? (item.completed_at ?? new Date().toISOString()) : null,
    quality_flag: input.qualityRating ?? (approved ? "good" : "rework"),
    outcome: approved ? `Approved on review: ${rationale}` : `Returned on review: ${rationale}`,
    next_action: approved ? null : (input.requiredAction?.trim() ?? "Address review feedback"),
  });
}

/* -------------------------- corrective actions --------------------------- */

export const listCorrectiveActions = async (filter?: { staffId?: string; workItemId?: string; objectiveId?: string }): Promise<CorrectiveAction[]> => {
  let q = db.from("staff_corrective_actions").select("*").order("created_at", { ascending: false }).limit(300);
  if (filter?.staffId) q = q.eq("staff_id", filter.staffId);
  if (filter?.workItemId) q = q.eq("work_item_id", filter.workItemId);
  if (filter?.objectiveId) q = q.eq("objective_id", filter.objectiveId);
  return unwrap(await q);
};

export interface CorrectiveActionInput {
  triggerKind: "rework" | "blocked" | "escalated" | "sla_breach";
  causeCategory: string;
  causeDescription: string;
  evidenceNote?: string;
  impactDays?: number | null;
  impactValueCents?: number | null;
  correctiveAction?: string;
  ownerStaffId?: string | null;
  dueDate?: string | null;
}

/**
 * Report rework or blocked work against a work item. The cause, the evidence
 * and the measured impact are recorded against the same objective the work
 * serves, so productivity loss is attributed rather than absorbed silently.
 */
export async function reportCorrectiveAction(item: StaffWorkItem, input: CorrectiveActionInput) {
  if (!input.causeDescription.trim()) throw new Error("Record the cause — a corrective action without a cause cannot be acted on.");
  const { data: session } = await supabase.auth.getUser();
  const row = unwrap(
    await db.from("staff_corrective_actions").insert({
      work_item_id: item.id,
      staff_id: item.staff_id,
      objective_id: item.objective_id,
      trigger_kind: input.triggerKind,
      cause_category: input.causeCategory,
      cause_description: input.causeDescription.trim(),
      evidence_source_table: item.source_table ?? "staff_work_items",
      evidence_source_id: item.source_id ?? item.id,
      evidence_note: input.evidenceNote?.trim() || null,
      impact_days: input.impactDays ?? null,
      impact_value_cents: input.impactValueCents ?? null,
      corrective_action: input.correctiveAction?.trim() || null,
      owner_staff_id: input.ownerStaffId ?? item.staff_id,
      due_date: input.dueDate || null,
      status: "open",
      reported_by: session.user?.id ?? null,
    }).select().single(),
  );

  await saveWorkItem({
    id: item.id,
    status: input.triggerKind === "blocked" ? "blocked" : item.status,
    quality_flag: input.triggerKind === "escalated" ? "escalated" : "rework",
  });
  return row as CorrectiveAction;
}

export async function resolveCorrectiveAction(id: string, status: "resolved" | "ineffective" | "closed" | "in_progress", resolution: string) {
  if (status !== "in_progress" && !resolution.trim()) throw new Error("Document the resolution before closing a corrective action.");
  return unwrap(
    await db.from("staff_corrective_actions").update({
      status,
      resolution: resolution.trim() || null,
      resolved_at: status === "in_progress" ? null : new Date().toISOString(),
    }).eq("id", id).select().single(),
  ) as CorrectiveAction;
}

/** Reopen the work item once a blocking cause is cleared. */
export async function unblockWork(item: StaffWorkItem, note: string) {
  return saveWorkItem({
    id: item.id,
    status: "in_progress",
    next_action: note.trim() || item.next_action,
  });
}
