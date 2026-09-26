/**
 * Fleet Owner proof-of-delivery submission and carrier payable release.
 *
 * Every verdict and money movement lives in the database:
 *   carrier_pod_submit      — Fleet Owner submits evidence for a COMPLETED leg
 *   carrier_pod_review      — staff approves/rejects; approval accrues a payable
 *   carrier_payable_release — finance posts the net amount to the carrier wallet
 *
 * This module only marshals input and surfaces the server's refusal codes; it
 * never computes eligibility, commission or amounts client-side.
 */
import { supabase } from "@/integrations/supabase/client";

const EVIDENCE_BUCKET = "partner-documents";

export interface PodEvidenceRef {
  kind: string;
  object_ref: string;
  content_hash: string;
  mime_type?: string | null;
  byte_size?: number | null;
}

export interface CarrierPodSubmissionRow {
  id: string;
  submission_reference: string;
  carrier_id: string;
  leg_id: string;
  order_id: string;
  recipient_name: string;
  recipient_relationship: string | null;
  recipient_id_reference: string | null;
  recipient_phone: string | null;
  delivered_at: string;
  captured_lat: number | null;
  captured_lng: number | null;
  notes: string | null;
  evidence: PodEvidenceRef[];
  integrity_hash: string;
  state: "SUBMITTED" | "APPROVED" | "REJECTED";
  submitted_by: string | null;
  submitted_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  rejection_reason: string | null;
}

export interface CarrierPayableLineRow {
  id: string;
  line_reference: string;
  carrier_id: string;
  order_id: string;
  leg_id: string;
  pod_submission_id: string;
  currency: string;
  gross_amount: number;
  commission_pct: number;
  platform_fee: number;
  net_payable: number;
  state: "ACCRUED" | "RELEASED";
  ledger_entry_id: string | null;
  accrued_at: string;
  released_at: string | null;
}

export interface CompletedLegRow {
  id: string;
  order_id: string;
  leg_no: number;
  leg_type: string;
  status: string;
  origin_label: string;
  destination_label: string;
  actual_arrival: string | null;
  vehicle_id: string | null;
  driver_id: string | null;
}

type Rpc = Record<string, unknown>;
const asResult = (data: unknown): Rpc => (data && typeof data === "object" ? (data as Rpc) : {});

/** Hex sha-256 of a file, computed in the browser so the hash is evidence-bound. */
export async function hashFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function uploadPodEvidence(
  carrierId: string,
  legId: string,
  kind: string,
  file: File,
): Promise<PodEvidenceRef> {
  const hash = await hashFile(file);
  const ext = file.name.includes(".") ? file.name.split(".").pop() : "bin";
  const path = `carrier-pod/${carrierId}/${legId}/${kind}-${hash.slice(0, 16)}.${ext}`;
  const up = await supabase.storage.from(EVIDENCE_BUCKET).upload(path, file, { upsert: true });
  if (up.error) throw new Error(up.error.message);
  return {
    kind,
    object_ref: `${EVIDENCE_BUCKET}/${path}`,
    content_hash: hash,
    mime_type: file.type || null,
    byte_size: file.size,
  };
}

/**
 * Completed movements a Fleet Owner may evidence.
 *
 * Read access is granted by the database policy legs_carrier_member_read, which
 * scopes legs to the carrier that registered the vehicle (or owns the driver of
 * record). Passing the carrier narrows the list to that same attribution so an
 * operator holding several carriers sees only the selected fleet's movements.
 * This is presentation scoping only — carrier_pod_submit re-establishes
 * ownership server-side before accepting any evidence.
 */
export async function listCompletedLegs(carrierId?: string | null): Promise<CompletedLegRow[]> {
  let vehicleIds: string[] | null = null;
  if (carrierId) {
    const fleet = await supabase
      .from("logistics_fleet_capacity")
      .select("vehicle_id")
      .eq("carrier_id", carrierId);
    if (fleet.error) throw new Error(fleet.error.message);
    vehicleIds = (fleet.data ?? []).map((r) => (r as { vehicle_id: string }).vehicle_id);
    if (vehicleIds.length === 0) return [];
  }
  let q = supabase
    .from("logistics_order_legs")
    .select("id,order_id,leg_no,leg_type,status,origin_label,destination_label,actual_arrival,vehicle_id,driver_id")
    .eq("status", "COMPLETED")
    .order("actual_arrival", { ascending: false })
    .limit(100);
  if (vehicleIds) q = q.in("vehicle_id", vehicleIds);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as CompletedLegRow[];
}

export async function listPodSubmissions(state?: string): Promise<CarrierPodSubmissionRow[]> {
  let q = supabase
    .from("carrier_pod_submissions")
    .select("*")
    .order("submitted_at", { ascending: false })
    .limit(200);
  if (state) q = q.eq("state", state);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as CarrierPodSubmissionRow[];
}

export async function listPayableLines(): Promise<CarrierPayableLineRow[]> {
  const { data, error } = await supabase
    .from("carrier_payable_lines")
    .select("*")
    .order("accrued_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as CarrierPayableLineRow[];
}

export async function submitPod(input: {
  carrierId: string;
  legId: string;
  recipientName: string;
  recipientRelationship?: string;
  recipientIdReference?: string;
  recipientPhone?: string;
  deliveredAt: string;
  capturedLat?: number | null;
  capturedLng?: number | null;
  notes?: string;
  evidence: PodEvidenceRef[];
  idempotencyKey: string;
}): Promise<Rpc> {
  const { data, error } = await supabase.rpc("carrier_pod_submit", {
    p: {
      carrier_id: input.carrierId,
      leg_id: input.legId,
      recipient_name: input.recipientName,
      recipient_relationship: input.recipientRelationship ?? null,
      recipient_id_reference: input.recipientIdReference ?? null,
      recipient_phone: input.recipientPhone ?? null,
      delivered_at: input.deliveredAt,
      captured_lat: input.capturedLat ?? null,
      captured_lng: input.capturedLng ?? null,
      notes: input.notes ?? null,
      evidence: input.evidence,
      idempotency_key: input.idempotencyKey,
    },
  } as never);
  if (error) throw new Error(error.message);
  return asResult(data);
}

export async function reviewPod(input: {
  submissionId: string;
  decision: "APPROVED" | "REJECTED";
  reviewNotes?: string;
  rejectionReason?: string;
}): Promise<Rpc> {
  const { data, error } = await supabase.rpc("carrier_pod_review", {
    p: {
      submission_id: input.submissionId,
      decision: input.decision,
      review_notes: input.reviewNotes ?? null,
      rejection_reason: input.rejectionReason ?? null,
    },
  } as never);
  if (error) throw new Error(error.message);
  return asResult(data);
}

export async function releasePayable(payableLineId: string): Promise<Rpc> {
  const { data, error } = await supabase.rpc("carrier_payable_release", {
    p: { payable_line_id: payableLineId },
  } as never);
  if (error) throw new Error(error.message);
  return asResult(data);
}

/** Human wording for the server's refusal codes — never invented client-side. */
export const POD_REFUSAL_COPY: Record<string, string> = {
  NOT_AUTHORISED: "You are not a member of this Fleet Owner account.",
  IDEMPOTENCY_KEY_REQUIRED: "Submission key missing — reload and try again.",
  LEG_NOT_FOUND: "That movement no longer exists.",
  LEG_NOT_COMPLETED: "The transport leg is not finished yet, so delivery evidence cannot be submitted.",
  EVIDENCE_REQUIRED: "Attach at least one evidence file (signed delivery note or photo).",
  POD_ALREADY_PENDING_OR_APPROVED: "Delivery evidence for this movement is already submitted or approved.",
  VALIDATION_ERROR: "Check the highlighted field.",
  AUTHORIZATION_ERROR: "You do not hold the permission required for this action.",
  ALREADY_REVIEWED: "This submission has already been reviewed.",
  SEPARATION_OF_DUTIES: "The person who submitted the evidence cannot approve it.",
  COMMISSION_NOT_CONFIGURED:
    "Platform commission is not configured, so a payable amount cannot be derived. Finance must set it before approval.",
  COMMISSION_INVALID: "The configured commission percentage is out of range.",
  ORDER_AMOUNT_UNAVAILABLE: "The order total is unavailable, so no payable can be derived.",
  CARRIER_PARTNER_MISSING: "This Fleet Owner has no partner wallet linked.",
  NOT_FOUND: "Record not found.",
};

export const refusalCopy = (code: unknown): string =>
  POD_REFUSAL_COPY[String(code ?? "")] ?? `Refused by the server (${String(code ?? "unknown")}).`;
