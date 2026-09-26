/**
 * Customer fulfilment journey — read model + commitment register.
 *
 * Nothing here owns state that already lives in the spine:
 *   opportunity truth  → commercial_opportunities (via crm_set_opportunity_stage)
 *   executable work    → staff_work_items (via crm_create_next_action)
 *   revenue            → commercial_transactions
 *
 * This module only reads the journey and tracks CUSTOMER COMMITMENTS — the
 * promises made to (or by) the customer, which are deliberately distinct from
 * generic internal tasks.
 */
import { supabase } from "@/integrations/supabase/client";

// CRM journey tables are newer than the generated types snapshot.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/* ------------------------------ chain proof ------------------------------ */

export type JourneyHopStatus = "valid" | "missing" | "not_yet_reached" | "invalid";

export interface JourneyHop {
  hop: string;
  status: JourneyHopStatus;
  entity: string;
  entity_id: string | null;
  detail: string | null;
}

export const JOURNEY_HOP_LABELS: Record<string, string> = {
  "01_staff": "Employee",
  "02_objective": "Objective",
  "03_kpi_actual": "KPI actual",
  "04_account": "Customer account",
  "05_contact": "Decision contact",
  "06_opportunity": "Opportunity",
  "07_outreach": "Outreach",
  "08_customer_response": "Customer response",
  "09_meeting": "Meeting",
  "10_meeting_outcome": "Meeting outcome",
  "11_customer_requirement": "Customer requirement",
  "12_document": "Document",
  "13_document_version": "Approved version",
  "14_shared_artifact": "Shared artefact",
  "15_next_action": "Next action",
  "16_work_item": "Work item",
  "17_contract_executed": "Contract executed",
  "18_onboarding": "Onboarding",
  "19_first_booking": "First booking",
  "20_transaction": "Transaction",
  "21_revenue": "Revenue",
};

export const JOURNEY_STATUS_LABEL: Record<JourneyHopStatus, string> = {
  valid: "Valid",
  missing: "Missing required link",
  not_yet_reached: "Not yet reached",
  invalid: "Invalid state",
};

export async function verifyJourneyChain(accountId: string): Promise<JourneyHop[]> {
  const { data, error } = await db.rpc("verify_journey_chain", { _account_id: accountId });
  if (error) throw new Error(error.message);
  return (data ?? []) as JourneyHop[];
}

/* --------------------------- next best action ---------------------------- */

export interface NextBestAction {
  action: string | null;
  kind?: "execute_existing" | "follow_up_documents" | "capture_discovery" | "advance_stage";
  rationale: string;
  priority?: "low" | "medium" | "high" | "critical";
  due_at?: string | null;
  next_action_id?: string | null;
  work_item_id?: string | null;
  opportunity_id?: string | null;
  expected_outcome?: string;
  open_commitments?: number;
  capture_completeness_pct?: number;
}

export async function nextBestAction(accountId: string): Promise<NextBestAction> {
  const { data, error } = await db.rpc("crm_next_best_action", { _account_id: accountId });
  if (error) throw new Error(error.message);
  return data as NextBestAction;
}

/* --------------------------- customer commitments ------------------------ */

export const COMMITMENT_STATUSES = ["open", "in_progress", "fulfilled", "waived", "cancelled"] as const;
export type CommitmentStatus = (typeof COMMITMENT_STATUSES)[number];

export interface CustomerCommitment {
  id: string;
  account_id: string;
  opportunity_id: string | null;
  contact_id: string | null;
  interaction_id: string | null;
  work_item_id: string | null;
  owner_staff_id: string | null;
  direction: "yalla_to_customer" | "customer_to_yalla";
  commitment: string;
  expected_outcome: string | null;
  status: CommitmentStatus;
  due_at: string | null;
  fulfilled_at: string | null;
  evidence_kind: string | null;
  evidence_ref: string | null;
  notes: string | null;
  created_at: string;
}

export async function listCommitments(accountId: string): Promise<CustomerCommitment[]> {
  const { data, error } = await db
    .from("crm_customer_commitments")
    .select("*")
    .eq("account_id", accountId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as CustomerCommitment[];
}

export async function createCommitment(
  input: Pick<CustomerCommitment, "account_id" | "commitment"> & Partial<CustomerCommitment>,
): Promise<CustomerCommitment> {
  const { data, error } = await db.from("crm_customer_commitments").insert(input).select("*").single();
  if (error) throw new Error(error.message);
  return data as CustomerCommitment;
}

/** Fulfilment must always carry evidence — a status flip alone proves nothing. */
export async function fulfilCommitment(
  id: string,
  evidence: { evidence_kind: string; evidence_ref: string },
): Promise<void> {
  const { error } = await db
    .from("crm_customer_commitments")
    .update({ status: "fulfilled", fulfilled_at: new Date().toISOString(), ...evidence })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export function commitmentIsOverdue(c: CustomerCommitment, now = new Date()): boolean {
  if (c.status === "fulfilled" || c.status === "waived" || c.status === "cancelled") return false;
  return !!c.due_at && new Date(c.due_at) < now;
}

/* ------------------------- shared artefact ledger ------------------------ */

export interface SharedArtefact {
  shareId: string;
  documentTitle: string;
  docType: string;
  versionLabel: string;
  approvalState: string;
  sharedAt: string;
  channel: string;
  note: string | null;
  recipientEmail: string | null;
}

/**
 * Answers exactly which contract and which rate card the customer received.
 * Resolved without embedding: crm_documents and crm_document_versions have two
 * foreign keys between them (document_id and current_version_id), so an
 * embedded join is ambiguous. Account scope lives on the document, the share
 * ledger is keyed on the version.
 */
export async function listSharedArtefacts(accountId: string): Promise<SharedArtefact[]> {
  const docsRes = await db
    .from("crm_documents")
    .select("id, title, doc_type")
    .eq("account_id", accountId);
  if (docsRes.error) throw new Error(docsRes.error.message);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const docs = (docsRes.data ?? []) as any[];
  if (docs.length === 0) return [];
  const docById = new Map(docs.map((d) => [d.id as string, d]));

  const versionsRes = await db
    .from("crm_document_versions")
    .select("id, document_id, version_label, approval_state")
    .in("document_id", [...docById.keys()]);
  if (versionsRes.error) throw new Error(versionsRes.error.message);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const versions = (versionsRes.data ?? []) as any[];
  if (versions.length === 0) return [];
  const versionById = new Map(versions.map((v) => [v.id as string, v]));

  const sharesRes = await db
    .from("crm_document_shares")
    .select("id, version_id, shared_at, channel, note, recipient_email")
    .in("version_id", [...versionById.keys()])
    .order("shared_at", { ascending: false });
  if (sharesRes.error) throw new Error(sharesRes.error.message);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((sharesRes.data ?? []) as any[]).map((r) => {
    const v = versionById.get(r.version_id);
    const d = v ? docById.get(v.document_id) : undefined;
    return {
      shareId: r.id,
      documentTitle: d?.title ?? "Unknown document",
      docType: d?.doc_type ?? "unknown",
      versionLabel: v?.version_label ?? "—",
      approvalState: v?.approval_state ?? "unknown",
      sharedAt: r.shared_at,
      channel: r.channel,
      note: r.note ?? null,
      recipientEmail: r.recipient_email ?? null,
    };
  });
}



/* ------------------------------ linked work ------------------------------ */

export interface JourneyWorkItem {
  id: string;
  title: string;
  status: string;
  lifecycle_state: string;
  priority: string;
  ops_queue: string | null;
  sla_due_at: string | null;
  next_action_due: string | null;
  description: string | null;
  staff_id: string | null;
}

export async function listAccountWork(accountId: string): Promise<JourneyWorkItem[]> {
  const { data, error } = await db
    .from("staff_work_items")
    .select(
      "id,title,status,lifecycle_state,priority,ops_queue,sla_due_at,next_action_due,description,staff_id",
    )
    .eq("entity_type", "crm_account")
    .eq("entity_id", accountId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as JourneyWorkItem[];
}

/* ---------------------------- journey scoreboard ------------------------- */

export interface JourneyScoreboard {
  documentsShared: number;
  commitmentsTotal: number;
  commitmentsFulfilled: number;
  commitmentsOpen: number;
  commitmentsOverdue: number;
  openWork: number;
  slaAtRisk: number;
  reachedStages: number;
  missingLinks: number;
}

export function buildScoreboard(input: {
  hops: JourneyHop[];
  commitments: CustomerCommitment[];
  work: JourneyWorkItem[];
  artefacts: SharedArtefact[];
  now?: Date;
}): JourneyScoreboard {
  const now = input.now ?? new Date();
  const openWork = input.work.filter((w) => !["done", "cancelled"].includes(w.status));
  return {
    documentsShared: input.artefacts.length,
    commitmentsTotal: input.commitments.length,
    commitmentsFulfilled: input.commitments.filter((c) => c.status === "fulfilled").length,
    commitmentsOpen: input.commitments.filter((c) => c.status === "open" || c.status === "in_progress").length,
    commitmentsOverdue: input.commitments.filter((c) => commitmentIsOverdue(c, now)).length,
    openWork: openWork.length,
    slaAtRisk: openWork.filter((w) => !!w.sla_due_at && new Date(w.sla_due_at) < now).length,
    reachedStages: input.hops.filter((h) => h.status === "valid").length,
    missingLinks: input.hops.filter((h) => h.status === "missing").length,
  };
}
