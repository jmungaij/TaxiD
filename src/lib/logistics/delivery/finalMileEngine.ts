/**
 * Final-mile evidence & reverse-logistics client layer (Phase 3).
 *
 * Every mutation is a single server RPC. The client never writes
 * `packages.status`, never marks a POD verified, never mints a return number
 * and never decides a disposition — the database owns all of that, including
 * the POD policy check, OTP anti-replay and the append-only return history.
 *
 * Pure helpers in this module mirror the server rules so an operator gets an
 * instant message; the server re-validates everything.
 */
import { supabase } from "@/integrations/supabase/client";

export interface RpcResult<T = Record<string, unknown>> {
  ok: boolean;
  code?: string;
  message?: string;
  data?: T;
}

function envelope<T extends Record<string, unknown>>(raw: unknown): RpcResult<T> {
  const value = (raw ?? {}) as Record<string, unknown>;
  if (value.ok === true) return { ok: true, data: value as T };
  return {
    ok: false,
    code: typeof value.code === "string" ? value.code : "PROVIDER_ERROR",
    message: typeof value.message === "string" ? value.message : "The operation failed.",
    data: value as T,
  };
}

async function call<T extends Record<string, unknown>>(
  fn: string,
  args: Record<string, unknown>,
): Promise<RpcResult<T>> {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) return { ok: false, code: "PROVIDER_ERROR", message: error.message };
  return envelope<T>(data);
}

/* ------------------------------------------------------------------ */
/* POD policy                                                          */
/* ------------------------------------------------------------------ */

export interface PodPolicy {
  require_signature: boolean;
  require_photo: boolean;
  require_recipient_name: boolean;
  require_otp: boolean;
  require_scan: boolean;
  require_geolocation: boolean;
  require_notes: boolean;
  require_id_reference: boolean;
  require_recipient_relationship: boolean;
  otp_ttl_seconds: number;
  otp_max_attempts: number;
  otp_max_resends: number;
  requires_inspection_before_disposition: boolean;
}

export type ConfigurationState =
  | "CONFIGURED"
  | "NOT_CONFIGURED"
  | "PROVIDER_CONFIGURATION_REQUIRED"
  | "OWNER_ACTION_REQUIRED";

export interface EffectivePodPolicy extends Record<string, unknown> {
  configuration_state: ConfigurationState;
  offering_code: string;
  policy_id?: string;
  version?: number;
  policy: PodPolicy;
}

export const POD_REQUIREMENT_KEYS = [
  "require_signature",
  "require_photo",
  "require_recipient_name",
  "require_otp",
  "require_scan",
  "require_geolocation",
  "require_notes",
  "require_id_reference",
  "require_recipient_relationship",
] as const;

export const POD_REQUIREMENT_COPY: Record<string, string> = {
  require_signature: "Recipient signature",
  require_photo: "Delivery photo",
  require_recipient_name: "Recipient name",
  require_otp: "One-time passcode",
  require_scan: "Barcode / QR scan",
  require_geolocation: "Geolocation",
  require_notes: "Delivery notes",
  require_id_reference: "ID / reference capture",
  require_recipient_relationship: "Recipient relationship or authority",
};

export const DEFAULT_POD_POLICY: PodPolicy = {
  require_signature: false,
  require_photo: false,
  require_recipient_name: true,
  require_otp: false,
  require_scan: false,
  require_geolocation: true,
  require_notes: false,
  require_id_reference: false,
  require_recipient_relationship: false,
  otp_ttl_seconds: 600,
  otp_max_attempts: 5,
  otp_max_resends: 3,
  requires_inspection_before_disposition: true,
};

export interface PodDraft {
  recipient_name?: string | null;
  recipient_relationship?: string | null;
  recipient_id_reference?: string | null;
  signature_ref?: string | null;
  scanned_barcode?: string | null;
  notes?: string | null;
  lat?: number | null;
  lng?: number | null;
  files?: { kind: string; object_ref: string; content_hash?: string; byte_size?: number; mime_type?: string }[];
  otpVerified?: boolean;
}

/** Mirrors the server's POD_POLICY_UNSATISFIED check. Returns missing keys. */
export function podMissingRequirements(policy: PodPolicy, draft: PodDraft): string[] {
  const missing: string[] = [];
  const text = (v: unknown) => typeof v === "string" && v.trim().length > 0;
  if (policy.require_recipient_name && !text(draft.recipient_name)) missing.push("recipient_name");
  if (policy.require_recipient_relationship && !text(draft.recipient_relationship)) missing.push("recipient_relationship");
  if (policy.require_id_reference && !text(draft.recipient_id_reference)) missing.push("recipient_id_reference");
  if (policy.require_signature && !text(draft.signature_ref)) missing.push("signature");
  if (policy.require_scan && !text(draft.scanned_barcode)) missing.push("scan");
  if (policy.require_notes && !text(draft.notes)) missing.push("notes");
  if (policy.require_geolocation && (draft.lat == null || draft.lng == null)) missing.push("geolocation");
  if (policy.require_photo && !(draft.files ?? []).some((f) => f.kind === "photo")) missing.push("photo");
  if (policy.require_otp && !draft.otpVerified) missing.push("otp_verification");
  return missing;
}

export async function loadEffectivePodPolicy(offeringCode: string): Promise<RpcResult<EffectivePodPolicy>> {
  return call<EffectivePodPolicy>("logistics_pod_policy_effective", { _offering_code: offeringCode });
}

export interface PodPolicyRow {
  id: string;
  offering_code: string;
  version: number;
  status: string;
  notes: string | null;
  effective_from: string | null;
  created_at: string;
  otp_ttl_seconds: number;
  otp_max_attempts: number;
  otp_max_resends: number;
  requires_inspection_before_disposition: boolean;
  require_signature: boolean;
  require_photo: boolean;
  require_recipient_name: boolean;
  require_otp: boolean;
  require_scan: boolean;
  require_geolocation: boolean;
  require_notes: boolean;
  require_id_reference: boolean;
  require_recipient_relationship: boolean;
}

export async function listPodPolicies(): Promise<PodPolicyRow[]> {
  const { data } = await supabase
    .from("logistics_pod_policies")
    .select("*")
    .order("offering_code", { ascending: true })
    .order("version", { ascending: false });
  return (data ?? []) as PodPolicyRow[];
}

export async function savePodPolicyDraft(
  offeringCode: string,
  requirements: Partial<PodPolicy>,
  notes?: string | null,
) {
  return call("logistics_pod_policy_upsert", {
    _offering_code: offeringCode,
    _requirements: requirements,
    _notes: notes ?? null,
  });
}

export async function activatePodPolicy(policyId: string) {
  return call("logistics_pod_policy_activate", { _policy_id: policyId });
}

/* ------------------------------------------------------------------ */
/* OTP                                                                 */
/* ------------------------------------------------------------------ */

export interface OtpRow {
  id: string;
  package_id: string;
  attempt_id: string | null;
  purpose: string;
  status: string;
  attempts: number;
  max_attempts: number;
  resend_count: number;
  max_resends: number;
  expires_at: string;
  verified_at: string | null;
  consumed_at: string | null;
  provider_status: string;
  recipient_phone: string | null;
  created_at: string;
}

export interface IssueOtpResult extends Record<string, unknown> {
  otp_id: string;
  expires_in_seconds: number;
  delivery_status: string;
  configuration_state: ConfigurationState;
  manual_disclosure: boolean;
  code: string | null;
}

export async function issueOtp(packageId: string, purpose = "delivery_confirmation", phone?: string | null) {
  return call<IssueOtpResult>("logistics_otp_issue", {
    _package_id: packageId,
    _purpose: purpose,
    _recipient_phone: phone ?? null,
  });
}

export async function verifyOtp(packageId: string, code: string, attemptId?: string | null) {
  return call<{ otp_id: string; verified: boolean }>("logistics_otp_verify", {
    _package_id: packageId,
    _code: code,
    _attempt_id: attemptId ?? null,
  });
}

export async function listOtps(limit = 100): Promise<OtpRow[]> {
  const { data } = await supabase
    .from("logistics_delivery_otps")
    .select(
      "id,package_id,attempt_id,purpose,status,attempts,max_attempts,resend_count,max_resends,expires_at,verified_at,consumed_at,provider_status,recipient_phone,created_at",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as OtpRow[];
}

/** An OTP is usable only while pending, unexpired and under the attempt cap. */
export function otpUsable(otp: Pick<OtpRow, "status" | "expires_at" | "attempts" | "max_attempts">, now = Date.now()) {
  if (otp.status !== "pending") return false;
  if (new Date(otp.expires_at).getTime() <= now) return false;
  return otp.attempts < otp.max_attempts;
}

/* ------------------------------------------------------------------ */
/* POD capture                                                         */
/* ------------------------------------------------------------------ */

export interface PodRecord {
  id: string;
  attempt_id: string;
  package_id: string;
  offering_code: string | null;
  policy_version: number | null;
  status: string;
  recipient_name: string | null;
  recipient_relationship: string | null;
  signature_ref: string | null;
  scanned_barcode: string | null;
  otp_verified: boolean;
  captured_lat: number | null;
  captured_lng: number | null;
  notes: string | null;
  integrity_hash: string;
  captured_at: string;
}

export async function capturePod(attemptId: string, draft: PodDraft, idempotencyKey: string) {
  const { otpVerified, ...payload } = draft;
  return call<{ pod_id: string; integrity_hash: string; replayed: boolean }>("logistics_pod_capture", {
    _attempt_id: attemptId,
    _payload: payload,
    _idempotency_key: idempotencyKey,
  });
}

export async function listPodRecords(limit = 100): Promise<PodRecord[]> {
  const { data } = await supabase
    .from("logistics_pod_records")
    .select(
      "id,attempt_id,package_id,offering_code,policy_version,status,recipient_name,recipient_relationship,signature_ref,scanned_barcode,otp_verified,captured_lat,captured_lng,notes,integrity_hash,captured_at",
    )
    .order("captured_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as PodRecord[];
}

export interface PodEvidenceFile {
  id: string;
  pod_id: string;
  kind: string;
  object_ref: string;
  content_hash: string;
  hash_algorithm: string;
  byte_size: number | null;
  created_at: string;
}

export async function listPodEvidence(podId: string): Promise<PodEvidenceFile[]> {
  const { data } = await supabase
    .from("logistics_pod_evidence_files")
    .select("id,pod_id,kind,object_ref,content_hash,hash_algorithm,byte_size,created_at")
    .eq("pod_id", podId)
    .order("created_at", { ascending: true });
  return (data ?? []) as PodEvidenceFile[];
}

/* ------------------------------------------------------------------ */
/* Delivery outcome                                                    */
/* ------------------------------------------------------------------ */

export type DeliveryOutcome =
  | "DELIVERED"
  | "AWAITING_EVIDENCE"
  | "PARTIALLY_DELIVERED"
  | "FAILED"
  | "REFUSED"
  | "UNAVAILABLE"
  | "DAMAGED"
  | "WRONG_ADDRESS"
  | "RETURN_REQUIRED"
  | "NO_ATTEMPT"
  | "OTHER";

export const OUTCOME_COPY: Record<DeliveryOutcome, string> = {
  DELIVERED: "Delivered with evidence",
  AWAITING_EVIDENCE: "Delivered — proof of delivery outstanding",
  PARTIALLY_DELIVERED: "Partially delivered",
  FAILED: "Delivery failed",
  REFUSED: "Refused by recipient",
  UNAVAILABLE: "Recipient unavailable",
  DAMAGED: "Damaged",
  WRONG_ADDRESS: "Wrong address",
  RETURN_REQUIRED: "Return required",
  NO_ATTEMPT: "No attempt recorded",
  OTHER: "Other",
};

/** Outcomes that must drive the reverse-logistics chain. */
export const RETURN_DRIVING_OUTCOMES: DeliveryOutcome[] = [
  "REFUSED",
  "RETURN_REQUIRED",
  "WRONG_ADDRESS",
  "DAMAGED",
];

export function returnRequired(outcome: DeliveryOutcome): boolean {
  return RETURN_DRIVING_OUTCOMES.includes(outcome);
}

export async function loadDeliveryOutcome(packageId: string) {
  return call<{
    outcome: DeliveryOutcome;
    attempt_id?: string;
    attempt_number?: number;
    pod_id?: string | null;
    package_status: string;
  }>("logistics_delivery_outcome", { _package_id: packageId });
}

/* ------------------------------------------------------------------ */
/* Returns                                                             */
/* ------------------------------------------------------------------ */

export type ReturnMovementStatus =
  | "AUTHORIZED"
  | "READY_FOR_RETURN"
  | "DISPATCHED"
  | "IN_TRANSIT"
  | "HUB_RECEIVED"
  | "INSPECTION"
  | "DISPOSITION"
  | "RESOLVED"
  | "CANCELLED";

/** Client mirror of the server transition table (receipt/inspection/disposition
 *  are performed by their own operations, never by a bare status change). */
export const RETURN_TRANSITIONS: Record<ReturnMovementStatus, ReturnMovementStatus[]> = {
  AUTHORIZED: ["READY_FOR_RETURN", "CANCELLED"],
  READY_FOR_RETURN: ["DISPATCHED", "CANCELLED"],
  DISPATCHED: ["IN_TRANSIT", "CANCELLED"],
  IN_TRANSIT: ["HUB_RECEIVED"],
  HUB_RECEIVED: [],
  INSPECTION: [],
  DISPOSITION: [],
  RESOLVED: [],
  CANCELLED: [],
};

export const DISPOSITIONS = [
  "RETURN_TO_MERCHANT",
  "RETURN_TO_CUSTOMER",
  "RESTOCK",
  "REPAIR",
  "REPACK",
  "DISPOSE",
  "HOLD",
  "CLAIM_REVIEW",
] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

export const RESOLUTION_STATES = [
  "RESOLVED_DELIVERED",
  "RESOLVED_RETURNED",
  "RESOLVED_REPLACEMENT",
  "RESOLVED_REFUND",
  "RESOLVED_CLAIM",
  "RESOLVED_CUSTOMER_ACTION_REQUIRED",
] as const;
export type ResolutionState = (typeof RESOLUTION_STATES)[number];

/** Resolutions that cannot close without a finance reference. */
export const FINANCIAL_RESOLUTIONS: ResolutionState[] = ["RESOLVED_REFUND", "RESOLVED_CLAIM"];

export function resolutionNeedsFinance(state: ResolutionState): boolean {
  return FINANCIAL_RESOLUTIONS.includes(state);
}

export function returnTransitionsFor(status: ReturnMovementStatus): ReturnMovementStatus[] {
  return RETURN_TRANSITIONS[status] ?? [];
}

/** Disposition gate: policy may demand a completed inspection first. */
export function dispositionBlockers(policy: PodPolicy, ctx: { status: ReturnMovementStatus; hasInspection: boolean }): string[] {
  const blockers: string[] = [];
  if (policy.requires_inspection_before_disposition && !ctx.hasInspection) {
    blockers.push("An inspection must be completed before a disposition can be recorded.");
  }
  if (!["HUB_RECEIVED", "INSPECTION", "DISPOSITION"].includes(ctx.status)) {
    blockers.push("The return must be received at a hub before a disposition.");
  }
  return blockers;
}

export interface ReturnRow {
  id: string;
  package_id: string;
  return_number: string | null;
  reason: string;
  reason_code: string | null;
  status: string;
  authorization_status: string;
  movement_status: ReturnMovementStatus;
  merchant_approval_required: boolean;
  destination_hub_id: string | null;
  return_service_level: string | null;
  return_instructions: string | null;
  origin_attempt_id: string | null;
  return_route_id: string | null;
  disposition: string | null;
  resolution_state: string | null;
  financial_reference: string | null;
  resolution_notes: string | null;
  exception_id: string | null;
  created_at: string;
  updated_at: string;
}

export async function listReturns(limit = 100): Promise<ReturnRow[]> {
  const { data } = await supabase
    .from("package_returns")
    .select(
      "id,package_id,return_number,reason,reason_code,status,authorization_status,movement_status,merchant_approval_required,destination_hub_id,return_service_level,return_instructions,origin_attempt_id,return_route_id,disposition,resolution_state,financial_reference,resolution_notes,exception_id,created_at,updated_at",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as ReturnRow[];
}

export interface ReturnEvent {
  id: string;
  return_id: string;
  event_name: string;
  from_status: string | null;
  to_status: string | null;
  note: string | null;
  created_at: string;
}

export async function listReturnEvents(returnId: string): Promise<ReturnEvent[]> {
  const { data } = await supabase
    .from("logistics_return_events")
    .select("id,return_id,event_name,from_status,to_status,note,created_at")
    .eq("return_id", returnId)
    .order("created_at", { ascending: true });
  return (data ?? []) as ReturnEvent[];
}

export async function authorizeReturn(input: {
  packageId: string;
  reason: string;
  reasonCode?: string | null;
  destinationHubId?: string | null;
  serviceLevel?: string | null;
  instructions?: string | null;
  merchantApprovalRequired?: boolean;
}) {
  return call<{ return_id: string; return_number: string; authorization_status: string }>(
    "logistics_return_authorize",
    {
      _package_id: input.packageId,
      _reason: input.reason,
      _reason_code: input.reasonCode ?? null,
      _destination_hub_id: input.destinationHubId ?? null,
      _service_level: input.serviceLevel ?? null,
      _instructions: input.instructions ?? null,
      _merchant_approval_required: input.merchantApprovalRequired ?? false,
    },
  );
}

export async function merchantApproveReturn(returnId: string, approve: boolean, note?: string | null) {
  return call("logistics_return_merchant_approve", {
    _return_id: returnId,
    _approve: approve,
    _note: note ?? null,
  });
}

export async function transitionReturn(
  returnId: string,
  toStatus: ReturnMovementStatus,
  note?: string | null,
  returnRouteId?: string | null,
) {
  return call("logistics_return_transition", {
    _return_id: returnId,
    _to_status: toStatus,
    _note: note ?? null,
    _return_route_id: returnRouteId ?? null,
  });
}

export async function receiveReturnAtHub(input: {
  returnId: string;
  hubId: string;
  condition: string;
  sealState?: string;
  sealId?: string | null;
  scannedReference?: string | null;
  notes?: string | null;
  evidence?: Record<string, unknown>;
}) {
  return call<{ receipt_id: string; custody_event_id: string }>("logistics_return_receive", {
    _return_id: input.returnId,
    _hub_id: input.hubId,
    _condition: input.condition,
    _seal_state: input.sealState ?? "unknown",
    _seal_id: input.sealId ?? null,
    _scanned_reference: input.scannedReference ?? null,
    _notes: input.notes ?? null,
    _evidence: input.evidence ?? {},
  });
}

export async function inspectReturn(input: {
  returnId: string;
  condition: string;
  damageFound?: boolean;
  damageDetail?: string | null;
  missingContents?: boolean;
  missingDetail?: string | null;
  sealCondition?: string;
  packagingCondition?: string;
  photos?: unknown[];
  notes?: string | null;
}) {
  return call<{ inspection_id: string }>("logistics_return_inspect", {
    _return_id: input.returnId,
    _condition: input.condition,
    _damage_found: input.damageFound ?? false,
    _damage_detail: input.damageDetail ?? null,
    _missing_contents: input.missingContents ?? false,
    _missing_detail: input.missingDetail ?? null,
    _seal_condition: input.sealCondition ?? "unknown",
    _packaging_condition: input.packagingCondition ?? "unknown",
    _photos: input.photos ?? [],
    _notes: input.notes ?? null,
  });
}

export async function setReturnDisposition(returnId: string, disposition: Disposition, note?: string | null) {
  return call<{ disposition_id: string }>("logistics_return_disposition", {
    _return_id: returnId,
    _disposition: disposition,
    _note: note ?? null,
  });
}

export async function resolveReturn(
  returnId: string,
  state: ResolutionState,
  financialReference?: string | null,
  note?: string | null,
) {
  return call("logistics_return_resolve", {
    _return_id: returnId,
    _resolution_state: state,
    _financial_reference: financialReference ?? null,
    _note: note ?? null,
  });
}

export interface ReturnReceipt {
  id: string;
  return_id: string;
  package_id: string;
  hub_id: string;
  received_at: string;
  condition: string;
  seal_state: string;
  seal_id: string | null;
  scanned_reference: string | null;
  custody_event_id: string | null;
  notes: string | null;
}

export async function listReturnReceipts(limit = 100): Promise<ReturnReceipt[]> {
  const { data } = await supabase
    .from("logistics_return_receipts")
    .select(
      "id,return_id,package_id,hub_id,received_at,condition,seal_state,seal_id,scanned_reference,custody_event_id,notes",
    )
    .order("received_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as ReturnReceipt[];
}

export interface ReturnInspection {
  id: string;
  return_id: string;
  condition: string;
  damage_found: boolean;
  damage_detail: string | null;
  missing_contents: boolean;
  seal_condition: string;
  packaging_condition: string;
  notes: string | null;
  completed_at: string;
}

export async function listReturnInspections(limit = 100): Promise<ReturnInspection[]> {
  const { data } = await supabase
    .from("logistics_return_inspections")
    .select(
      "id,return_id,condition,damage_found,damage_detail,missing_contents,seal_condition,packaging_condition,notes,completed_at",
    )
    .order("completed_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as ReturnInspection[];
}

export interface ReturnDisposition {
  id: string;
  return_id: string;
  disposition: string;
  authorization_note: string | null;
  executed_at: string;
}

export async function listReturnDispositions(limit = 100): Promise<ReturnDisposition[]> {
  const { data } = await supabase
    .from("logistics_return_dispositions")
    .select("id,return_id,disposition,authorization_note,executed_at")
    .order("executed_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as ReturnDisposition[];
}

/* ------------------------------------------------------------------ */
/* Hubs, providers, notifications                                      */
/* ------------------------------------------------------------------ */

export interface ReturnsHub {
  id: string;
  code: string;
  name: string;
  city: string | null;
  status: string;
  capabilities: string[] | null;
}

/** Only active hubs carrying `returns_processing` may receive a return. */
export async function listReturnsHubs(): Promise<ReturnsHub[]> {
  const { data } = await supabase
    .from("logistics_hubs")
    .select("id,code,name,city,status,capabilities")
    .eq("status", "active")
    .contains("capabilities", ["returns_processing"])
    .order("code", { ascending: true });
  return (data ?? []) as ReturnsHub[];
}

export interface MessageProvider {
  id: string;
  channel: string;
  provider: string;
  environment: string;
  credentials_secret_name: string | null;
  sender_identity: string | null;
  enabled: boolean;
  timeout_ms: number;
  retry_max_attempts: number;
  retry_backoff_seconds: number;
  health_status: string;
  health_checked_at: string | null;
  health_detail: string | null;
  notes: string | null;
  updated_at: string;
}

export async function listMessageProviders(): Promise<MessageProvider[]> {
  const { data } = await supabase
    .from("logistics_message_providers")
    .select("*")
    .order("channel", { ascending: true });
  return (data ?? []) as MessageProvider[];
}

/** Config state of the messaging adapter — never fabricates a healthy provider. */
export function providerConfigurationState(p: MessageProvider | null | undefined): ConfigurationState {
  if (!p) return "OWNER_ACTION_REQUIRED";
  if (!p.credentials_secret_name || !p.sender_identity) return "PROVIDER_CONFIGURATION_REQUIRED";
  if (!p.enabled) return "OWNER_ACTION_REQUIRED";
  return "CONFIGURED";
}

export async function saveMessageProvider(input: {
  id?: string | null;
  channel: string;
  provider: string;
  environment: string;
  credentialsSecretName?: string | null;
  senderIdentity?: string | null;
  enabled: boolean;
  timeoutMs: number;
  retryMaxAttempts: number;
  retryBackoffSeconds: number;
  notes?: string | null;
}): Promise<{ ok: boolean; message?: string }> {
  const row = {
    channel: input.channel,
    provider: input.provider,
    environment: input.environment,
    credentials_secret_name: input.credentialsSecretName ?? null,
    sender_identity: input.senderIdentity ?? null,
    enabled: input.enabled,
    timeout_ms: input.timeoutMs,
    retry_max_attempts: input.retryMaxAttempts,
    retry_backoff_seconds: input.retryBackoffSeconds,
    health_status:
      input.credentialsSecretName && input.senderIdentity ? "unknown" : "configuration_required",
    notes: input.notes ?? null,
  };
  const { error } = input.id
    ? await supabase.from("logistics_message_providers").update(row).eq("id", input.id)
    : await supabase.from("logistics_message_providers").insert(row);
  return error ? { ok: false, message: error.message } : { ok: true };
}

export interface DeliveryNotification {
  id: string;
  event_name: string;
  package_id: string | null;
  return_id: string | null;
  otp_id: string | null;
  channel: string | null;
  recipient: string | null;
  status: string;
  provider: string | null;
  error_detail: string | null;
  created_at: string;
}

export async function listDeliveryNotifications(limit = 100): Promise<DeliveryNotification[]> {
  const { data } = await supabase
    .from("logistics_delivery_notifications")
    .select("id,event_name,package_id,return_id,otp_id,channel,recipient,status,provider,error_detail,created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as DeliveryNotification[];
}

/* ------------------------------------------------------------------ */
/* Customer-facing milestones                                          */
/* ------------------------------------------------------------------ */

export interface CustomerMilestone {
  key: string;
  label: string;
  reached: boolean;
}

/**
 * Maps internal state to the customer-visible milestone ladder. Operational
 * detail (hubs, drivers, reason codes, exceptions, evidence hashes) is never
 * exposed here.
 */
export function customerMilestones(input: {
  packageStatus: string;
  attempts: number;
  outcome?: DeliveryOutcome | null;
  returnStatus?: ReturnMovementStatus | null;
}): CustomerMilestone[] {
  const s = input.packageStatus;
  const forward: CustomerMilestone[] = [
    { key: "created", label: "Shipment created", reached: true },
    { key: "picked_up", label: "Picked up", reached: ["picked_up", "in_transit", "out_for_delivery", "delivery_failed", "delivered", "returned"].includes(s) },
    { key: "in_transit", label: "In transit", reached: ["in_transit", "out_for_delivery", "delivery_failed", "delivered", "returned"].includes(s) },
    { key: "out_for_delivery", label: "Out for delivery", reached: ["out_for_delivery", "delivery_failed", "delivered"].includes(s) || input.attempts > 0 },
    { key: "attempted", label: "Delivery attempted", reached: input.attempts > 0 },
  ];

  if (input.returnStatus) {
    const r = input.returnStatus;
    const reachedTransit = ["DISPATCHED", "IN_TRANSIT", "HUB_RECEIVED", "INSPECTION", "DISPOSITION", "RESOLVED"].includes(r);
    return [
      ...forward,
      { key: "return_initiated", label: "Return initiated", reached: true },
      { key: "return_in_transit", label: "Return in transit", reached: reachedTransit },
      { key: "returned", label: "Returned", reached: ["HUB_RECEIVED", "INSPECTION", "DISPOSITION", "RESOLVED"].includes(r) },
    ];
  }

  return [
    ...forward,
    { key: "delivered", label: "Delivered", reached: input.outcome === "DELIVERED" || s === "delivered" },
  ];
}

/* ------------------------------------------------------------------ */
/* Attempts awaiting evidence                                          */
/* ------------------------------------------------------------------ */

export interface AttemptAwaitingPod {
  id: string;
  package_id: string;
  attempt_number: number;
  outcome: string;
  reason_code: string | null;
  recipient_name: string | null;
  occurred_at: string;
  pod_id: string | null;
}

/** Delivered attempts with no proof of delivery yet — the evidence backlog. */
export async function listAttemptsAwaitingPod(limit = 100): Promise<AttemptAwaitingPod[]> {
  const { data } = await supabase
    .from("logistics_delivery_attempts")
    .select("id,package_id,attempt_number,outcome,reason_code,recipient_name,occurred_at,pod_id")
    .is("pod_id", null)
    .order("occurred_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as AttemptAwaitingPod[];
}

export interface PackageLite {
  id: string;
  tracking_number: string;
  status: string;
  recipient_name: string | null;
  recipient_phone: string | null;
  module: string | null;
}

export async function listPackagesLite(ids: string[]): Promise<Record<string, PackageLite>> {
  if (ids.length === 0) return {};
  const { data } = await supabase
    .from("packages")
    .select("id,tracking_number,status,recipient_name,recipient_phone,module")
    .in("id", ids);
  const out: Record<string, PackageLite> = {};
  for (const row of (data ?? []) as PackageLite[]) out[row.id] = row;
  return out;
}
