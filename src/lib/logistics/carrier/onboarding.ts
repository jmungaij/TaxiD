/**
 * FLEET OWNER (CARRIER) ONBOARDING — client API.
 *
 * Yalla Mobility is a digital marketplace. The Fleet Owner / Transport Service
 * Provider is the independent provider of the physical transport service and is
 * the OWNER of the carrier-side evidence: operating licences, insurance, vehicle
 * inspection, driver licences and professional badges.
 *
 * This module decides nothing. Requirement provisioning, declaration acceptance,
 * eligibility, matchability and withdrawal transitions are computed by the
 * database RPCs created for the existing carrier_* compliance engine. No second
 * compliance, wallet, ledger or settlement engine exists here.
 */
import { supabase } from "@/integrations/supabase/client";

export type ResponsibilityLevel = "PLATFORM" | "CARRIER" | "VEHICLE" | "DRIVER" | "CLIENT";
export type CarrierEvidenceLevel = "CARRIER" | "VEHICLE" | "DRIVER";

export type DeclarationCode =
  | "FLEET_OWNER_AGREEMENT"
  | "PROHIBITED_GOODS_UNDERTAKING"
  | "INDEMNITY_ACCEPTANCE";

export type DestinationVerificationState =
  | "UNVERIFIED" | "UNDER_REVIEW" | "VERIFIED" | "REJECTED" | "SUSPENDED";

export type WithdrawalState =
  | "REQUESTED" | "UNDER_REVIEW" | "APPROVED" | "REJECTED" | "EXECUTED"
  | "CONFIRMED" | "RECONCILED" | "CLOSED" | "FAILED" | "CANCELLED";

export interface RequirementTemplateRow {
  id: string;
  requirement_code: string;
  requirement_label: string;
  category: string;
  responsibility_level: CarrierEvidenceLevel;
  is_mandatory: boolean;
  service_categories: string[];
  evidence_type: string;
  issuing_authority_hint: string | null;
  requires_expiry: boolean;
  guidance: string | null;
  active: boolean;
}

export interface CarrierDeclarationRow {
  id: string;
  carrier_id: string;
  declaration_code: string;
  declaration_version: string;
  declaration_title: string;
  declaration_text_hash: string;
  accepted_by_name: string | null;
  accepted_at: string | null;
  document_path: string | null;
  state: string;
}

export interface SettlementDestinationRow {
  id: string;
  carrier_id: string;
  destination_type: "MPESA" | "BANK";
  account_name: string;
  msisdn: string | null;
  bank_name: string | null;
  bank_account_number: string | null;
  currency: string;
  is_default: boolean;
  verification_state: DestinationVerificationState;
  verified_at: string | null;
  verification_notes: string | null;
}

export interface WithdrawalRequestRow {
  id: string;
  request_reference: string;
  carrier_id: string;
  destination_id: string;
  amount_kes: number;
  state: WithdrawalState;
  available_balance_at_request: number | null;
  requested_at: string;
  authorised_at: string | null;
  executed_at: string | null;
  payment_evidence: Record<string, unknown> | null;
  failure_reason: string | null;
}

export interface EligibilityVerdict {
  eligible?: boolean;
  matchable?: boolean;
  state: string;
  level?: CarrierEvidenceLevel;
  mandatory_items?: number;
  blocking: { code: string; requirement?: string; [k: string]: unknown }[];
  compliance?: Record<string, unknown>;
  evaluated_at?: string;
}

export interface RpcOutcome {
  ok?: boolean;
  error?: boolean;
  code?: string;
  message?: string;
  [k: string]: unknown;
}

function unwrap<T>(data: T, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  return data;
}

async function rpc<T = RpcOutcome>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) return { error: true, code: "RPC_FAILED", message: error.message } as T;
  return (data ?? { error: true, code: "EMPTY_RESPONSE" }) as T;
}

/* ------------------------------------------------------------------ reads */

export async function listRequirementTemplates(): Promise<RequirementTemplateRow[]> {
  const { data, error } = await supabase
    .from("carrier_requirement_templates" as never)
    .select("*")
    .order("responsibility_level")
    .order("requirement_code");
  return unwrap((data ?? []) as unknown as RequirementTemplateRow[], error);
}

export async function listDeclarations(carrierId: string): Promise<CarrierDeclarationRow[]> {
  const { data, error } = await supabase
    .from("carrier_declarations" as never)
    .select("*")
    .eq("carrier_id", carrierId)
    .order("declaration_code");
  return unwrap((data ?? []) as unknown as CarrierDeclarationRow[], error);
}

export async function listSettlementDestinations(carrierId: string): Promise<SettlementDestinationRow[]> {
  const { data, error } = await supabase
    .from("carrier_settlement_destinations" as never)
    .select("*")
    .eq("carrier_id", carrierId)
    .order("created_at", { ascending: false });
  return unwrap((data ?? []) as unknown as SettlementDestinationRow[], error);
}

export async function listWithdrawalRequests(carrierId?: string): Promise<WithdrawalRequestRow[]> {
  let q = supabase
    .from("carrier_withdrawal_requests" as never)
    .select("*")
    .order("requested_at", { ascending: false })
    .limit(200);
  if (carrierId) q = q.eq("carrier_id", carrierId);
  const { data, error } = await q;
  return unwrap((data ?? []) as unknown as WithdrawalRequestRow[], error);
}

/* ------------------------------------------------------- onboarding gates */

/** Instantiate the Fleet Owner's own mandatory checklist (carrier level). */
export const provisionCarrierRequirements = (carrierId: string) =>
  rpc("carrier_requirements_provision", { _carrier_id: carrierId, _vehicle_id: null, _driver_user_id: null });

/** Instantiate a specific vehicle's checklist — never shared with other vehicles. */
export const provisionVehicleRequirements = (carrierId: string, vehicleId: string) =>
  rpc("carrier_requirements_provision", { _carrier_id: carrierId, _vehicle_id: vehicleId, _driver_user_id: null });

/** Instantiate a specific driver's checklist — never shared with other drivers. */
export const provisionDriverRequirements = (carrierId: string, driverUserId: string) =>
  rpc("carrier_requirements_provision", { _carrier_id: carrierId, _vehicle_id: null, _driver_user_id: driverUserId });

export const carrierLevelEligibility = (carrierId: string) =>
  rpc<EligibilityVerdict>("carrier_subject_eligibility", {
    _carrier_id: carrierId, _level: "CARRIER", _vehicle_id: null, _driver_user_id: null,
  });

export const vehicleEligibility = (carrierId: string, vehicleId: string) =>
  rpc<EligibilityVerdict>("carrier_subject_eligibility", {
    _carrier_id: carrierId, _level: "VEHICLE", _vehicle_id: vehicleId, _driver_user_id: null,
  });

export const driverEligibility = (carrierId: string, driverUserId: string) =>
  rpc<EligibilityVerdict>("carrier_subject_eligibility", {
    _carrier_id: carrierId, _level: "DRIVER", _vehicle_id: null, _driver_user_id: driverUserId,
  });

/** Fleet Owner market access: compliance + declarations + verified settlement destination. */
export const carrierMatchability = (carrierId: string) =>
  rpc<EligibilityVerdict>("carrier_matchability", { _carrier_id: carrierId });

/* ------------------------------------------------------------ declarations */

export const acceptDeclaration = (input: {
  carrierId: string;
  code: DeclarationCode;
  version?: string;
  title: string;
  /** The full text presented to the signatory — hashed server-side for tamper evidence. */
  text: string;
  acceptedByName?: string;
  acceptedByRole?: string;
  documentPath?: string;
}) =>
  rpc("carrier_declaration_accept", {
    p: {
      carrier_id: input.carrierId,
      declaration_code: input.code,
      declaration_version: input.version ?? "v1",
      declaration_title: input.title,
      declaration_text: input.text,
      accepted_by_name: input.acceptedByName ?? null,
      accepted_by_role: input.acceptedByRole ?? null,
      document_path: input.documentPath ?? null,
    },
  });

/* ------------------------------------------------------------- withdrawals */

export const requestWithdrawal = (input: {
  carrierId: string;
  destinationId: string;
  amountKes: number;
  idempotencyKey: string;
  notes?: string;
}) =>
  rpc("carrier_withdrawal_request", {
    p: {
      carrier_id: input.carrierId,
      destination_id: input.destinationId,
      amount_kes: input.amountKes,
      idempotency_key: input.idempotencyKey,
      notes: input.notes ?? null,
    },
  });

export const decideWithdrawal = (input: {
  requestId: string;
  action: "REVIEW" | "APPROVE" | "REJECT" | "EXECUTED" | "CONFIRMED" | "RECONCILED" | "CLOSE" | "FAIL";
  reason?: string;
  paymentEvidence?: Record<string, unknown>;
}) =>
  rpc("carrier_withdrawal_decide", {
    p: {
      request_id: input.requestId,
      action: input.action,
      reason: input.reason ?? null,
      payment_evidence: input.paymentEvidence ?? null,
    },
  });

/** Ordered onboarding chain, used by the UI to show where a Fleet Owner stands. */
export const FLEET_OWNER_ONBOARDING_CHAIN = [
  "REGISTERED",
  "DOCUMENTS_PENDING",
  "UNDER_REVIEW",
  "VERIFICATION_FAILED",
  "COMPLIANCE_EXPIRED",
  "APPROVED",
  "SUSPENDED",
  "BLOCKED",
] as const;
export type FleetOwnerOnboardingState = (typeof FLEET_OWNER_ONBOARDING_CHAIN)[number];

/* ------------------------------------------------- evidence & activation */

export interface ComplianceItemRow {
  id: string;
  carrier_id: string;
  requirement_code: string;
  requirement_label: string;
  category: string;
  is_mandatory: boolean;
  state: "MISSING" | "PENDING_REVIEW" | "VERIFIED" | "EXPIRED" | "REJECTED" | "LEGAL_REVIEW_REQUIRED";
  responsibility_level: CarrierEvidenceLevel;
  vehicle_id: string | null;
  driver_user_id: string | null;
  evidence_storage_path: string | null;
  reference_number: string | null;
  issuing_authority: string | null;
  issued_on: string | null;
  expires_on: string | null;
  review_notes: string | null;
  reviewed_at: string | null;
}

export interface OnboardingReadinessRow {
  carrier_id: string;
  carrier_code: string;
  legal_entity_name: string;
  operating_status: string;
  contract_status: string;
  carrier_requirements: number;
  carrier_verified: number;
  declarations_accepted: number;
  verified_destinations: number;
}

export async function listComplianceItems(carrierId: string): Promise<ComplianceItemRow[]> {
  const { data, error } = await supabase
    .from("carrier_compliance_items" as never)
    .select("*")
    .eq("carrier_id", carrierId)
    .order("responsibility_level")
    .order("requirement_code");
  return unwrap((data ?? []) as unknown as ComplianceItemRow[], error);
}

export async function listOnboardingReadiness(): Promise<OnboardingReadinessRow[]> {
  const { data, error } = await supabase
    .from("v_carrier_onboarding_readiness" as never)
    .select("*")
    .order("legal_entity_name");
  return unwrap((data ?? []) as unknown as OnboardingReadinessRow[], error);
}

/**
 * Upload Fleet Owner evidence into the existing partner-documents store and bind
 * it to ONE requirement item. Evidence is always entity-scoped: one Fleet Owner's
 * document can never satisfy another's, and one vehicle/driver's document can
 * never satisfy another vehicle/driver.
 */
export async function submitEvidence(input: {
  itemId: string;
  partnerId: string;
  carrierId: string;
  requirementCode: string;
  file: File;
  referenceNumber?: string;
  issuingAuthority?: string;
  issuedOn?: string;
  expiresOn?: string;
}): Promise<RpcOutcome> {
  const safe = input.requirementCode.replace(/[^A-Z0-9_]/gi, "");
  const path = `${input.partnerId}/fleet-owner/${input.carrierId}/${safe}-${Date.now()}-${input.file.name}`;
  const up = await supabase.storage.from("partner-documents").upload(path, input.file, { upsert: false });
  if (up.error) return { error: true, code: "UPLOAD_FAILED", message: up.error.message };

  const res = await rpc("carrier_evidence_submit", {
    p: {
      item_id: input.itemId,
      evidence_storage_path: path,
      reference_number: input.referenceNumber ?? null,
      issuing_authority: input.issuingAuthority ?? null,
      issued_on: input.issuedOn ?? null,
      expires_on: input.expiresOn ?? null,
    },
  });
  if (res?.error) {
    // Keep storage and the register consistent — no orphaned evidence objects.
    await supabase.storage.from("partner-documents").remove([path]);
  }
  return res;
}

export const reviewEvidence = (input: {
  itemId: string;
  decision: "VERIFY" | "REJECT" | "LEGAL_REVIEW";
  notes?: string;
}) => rpc("carrier_evidence_review", { p: { item_id: input.itemId, decision: input.decision, notes: input.notes ?? null } });

export const verifyDestination = (input: {
  destinationId: string;
  decision: "VERIFY" | "REJECT" | "SUSPEND" | "REVIEW";
  notes?: string;
}) => rpc("carrier_destination_verify", {
  p: { destination_id: input.destinationId, decision: input.decision, notes: input.notes ?? null },
});

/** Staff activation — refuses unless the authoritative matchability verdict passes. */
export const activateFleetOwner = (carrierId: string, action: "ACTIVATE" | "SUSPEND" = "ACTIVATE") =>
  rpc("carrier_activate", { p: { carrier_id: carrierId, action } });

/** The exact gate the live dispatch engine applies to a candidate. */
export const dispatchGate = (carrierId: string | null, vehicleId?: string, driverUserId?: string) =>
  rpc("carrier_dispatch_gate", {
    _carrier_id: carrierId, _vehicle_id: vehicleId ?? null, _driver_user_id: driverUserId ?? null,
  });

/** Register a nominated payout destination. It cannot be used until staff verify it. */
export async function registerSettlementDestination(input: {
  carrierId: string;
  destinationType: "MPESA" | "BANK";
  accountName: string;
  msisdn?: string;
  bankName?: string;
  bankAccountNumber?: string;
  bankBranch?: string;
}): Promise<RpcOutcome> {
  const { data, error } = await supabase
    .from("carrier_settlement_destinations" as never)
    .insert({
      carrier_id: input.carrierId,
      destination_type: input.destinationType,
      account_name: input.accountName,
      msisdn: input.msisdn ?? null,
      bank_name: input.bankName ?? null,
      bank_account_number: input.bankAccountNumber ?? null,
      bank_branch: input.bankBranch ?? null,
    } as never)
    .select("id")
    .single();
  if (error) return { error: true, code: "INSERT_FAILED", message: error.message };
  return { ok: true, destination_id: (data as { id: string }).id };
}
