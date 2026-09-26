/**
 * Client bindings for the charter-api edge function. Every charter surface
 * (marketplace, booking workflow, aviation center) calls through here.
 */
import { supabase } from "@/integrations/supabase/client";
import type { FundingRequestRow } from "@/lib/charter/walletFunding";

export interface CharterInventoryRow {
  id: string;
  category_slug: string;
  name: string;
  spec: string;
  capacity: string;
  base_rate: number;
  currency: string;
  status: string;
  offer_label: string | null;
  offer_discount_pct: number;
  operator_name: string | null;
  home_base: string | null;
  active: boolean;
  available_from: string | null;
  available_to: string | null;
}

export interface CharterQuoteRow {
  id: string;
  reference: string;
  category_slug: string;
  asset_name: string;
  duration: number;
  quantity: number;
  total: number;
  currency: string;
  status: string;
  trip: Record<string, unknown>;
  contact: Record<string, unknown>;
  breakdown: Record<string, unknown>;
  created_at: string;
}

export interface CharterWebhookEndpoint {
  id: string;
  label: string;
  url: string;
  events: string[];
  active: boolean;
  description: string | null;
  last_status: string | null;
  last_delivered_at: string | null;
  created_at: string;
}

export interface CharterWebhookDelivery {
  id: string;
  endpoint_id: string | null;
  event_type: string;
  event_id: string;
  reference: string | null;
  status: string;
  response_status: number | null;
  error: string | null;
  created_at: string;
}

export interface CharterBookingRow {
  id: string;
  reference: string;
  quote_id: string | null;
  category_slug: string;
  asset_name: string;
  amount: number;
  currency: string;
  payment_method: string;
  payment_status: string;
  status: string;
  flight_status: string;
  flight_events: Array<{
    at: string; status: string; note?: string | null; reason_code?: string | null;
    actor?: string | null; evidence_url?: string | null;
  }>;
  passengers: Array<Record<string, string>>;
  trip: Record<string, unknown>;
  created_at: string;
}

/** Error carrying the machine-readable code so callers can offer a recovery. */
export class CharterApiError extends Error {
  code: string;
  details: unknown;
  /** Every server-side validation message, not just the first one. */
  errors: string[];
  /** Server decision inputs echoed back when payment validation fails. */
  debug: Record<string, unknown> | null;
  constructor(
    code: string,
    message: string,
    details: unknown = null,
    errors: string[] = [],
    debug: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.name = "CharterApiError";
    this.code = code;
    this.details = details;
    this.errors = errors.length ? errors : [message];
    this.debug = debug;
  }
}

/** True for the duplicate-submission codes that have a safe recovery path. */
export function isIdempotencyError(e: unknown): e is CharterApiError {
  return e instanceof CharterApiError &&
    ["idempotency_conflict", "duplicate_in_flight", "still_processing"].includes(e.code);
}

async function call<T>(payload: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("charter-api", { body: payload });
  if (error) {
    // Edge functions return non-2xx for validation errors; surface the body message.
    const ctxRaw = (error as { context?: { body?: unknown; text?: () => Promise<string> } }).context;
    let ctx = ctxRaw?.body;
    if (typeof ctx !== "string" && typeof ctxRaw?.text === "function") {
      ctx = await ctxRaw.text().catch(() => undefined);
    }
    if (typeof ctx === "string") {
      try {
        const parsed = JSON.parse(ctx) as {
          message?: string; error?: string; details?: unknown;
          errors?: string[]; debug?: Record<string, unknown>;
        };
        throw new CharterApiError(
          parsed.error ?? "charter_api_error",
          parsed.message ?? parsed.error ?? error.message,
          parsed.details ?? null,
          Array.isArray(parsed.errors) ? parsed.errors : [],
          parsed.debug ?? null,
        );
      } catch (parseErr) {
        if (parseErr instanceof CharterApiError) throw parseErr;
      }
    }
    throw new CharterApiError("charter_api_error", error.message);
  }
  if (!data?.ok) {
    throw new CharterApiError(
      data?.error ?? "charter_api_error",
      data?.message ?? data?.error ?? "charter_api_error",
      data?.details ?? null,
      Array.isArray(data?.errors) ? (data.errors as string[]) : [],
      (data?.debug as Record<string, unknown>) ?? null,
    );
  }
  return data as T;
}

/** One tamper-evident link in a document or wallet audit chain. */
export interface CharterAuditChainEntry {
  action: string;
  at: string;
  actor_id?: string | null;
  approver_name?: string | null;
  approver_title?: string | null;
  cost_center?: string | null;
  document_kind?: string | null;
  prev_hash: string;
  entry_hash: string;
}

export interface CorporateWalletRow {
  id: string;
  owner_id: string;
  organization_name: string;
  approver_name: string | null;
  approver_title: string | null;
  currency: string;
  balance_kes: number;
  status: string;
  created_at: string;
}

export interface CorporateWalletLedgerRow {
  id: string;
  wallet_id: string;
  direction: "credit" | "debit";
  amount_kes: number;
  balance_after: number;
  reference: string | null;
  booking_id: string | null;
  approver_name: string | null;
  approver_title: string | null;
  cost_center: string | null;
  prev_hash: string | null;
  entry_hash: string;
  created_at: string;
}

export const charterApi = {

  inventory: (category?: string) =>
    call<{ items: CharterInventoryRow[] }>({ action: "inventory", category }).then((r) => r.items),
  createQuote: (payload: Record<string, unknown>) =>
    call<{ quote: CharterQuoteRow }>({ action: "quote_create", ...payload }).then((r) => r.quote),
  listQuotes: () => call<{ quotes: CharterQuoteRow[] }>({ action: "quote_list" }).then((r) => r.quotes),
  createBooking: (payload: Record<string, unknown>) =>
    call<{ booking: CharterBookingRow }>({ action: "booking_create", ...payload }).then((r) => r.booking),
  /** Change the cabin arrangement / seat map after the initial selection. */
  amendCabin: (payload: {
    booking_id: string; cabin_layout: string; cabin_layout_label?: string; seats: string[];
  }) => call<{ booking: CharterBookingRow }>({ action: "booking_amend_cabin", ...payload }).then((r) => r.booking),
  /** Recovers the confirmation a previous submission already created. */
  bookingByKey: (idempotency_key: string) =>
    call<{ booking: CharterBookingRow; recovered: boolean }>({ action: "booking_by_key", idempotency_key })
      .then((r) => r.booking),
  /** Records the payment route an approver picked for a road charter booking. */
  selectRoadPaymentRoute: (payload: { booking_id: string; method: string }) =>
    call<{ booking: CharterBookingRow }>({ action: "road_payment_select", ...payload }).then((r) => r.booking),
  /** Idempotent M-Pesa STK push for a confirmed booking. */
  initiatePayment: (payload: { booking_id: string; phone: string; idempotency_key: string }) =>
    call<{
      amount_kes: number; phone_masked: string; checkout_request_id: string | null;
      message: string; replayed?: boolean;
    }>({ action: "payment_initiate", ...payload }),
  /** Signed webhook fan-out for a finalised booking change. */
  emitEvent: (payload: {
    event_type: string; booking_id?: string | null; reference?: string | null;
    before?: Record<string, unknown>; after?: Record<string, unknown>; changed_fields?: string[];
  }) => call<{ event_id: string }>({ action: "event_emit", ...payload }),
  listWebhooks: () =>
    call<{ endpoints: CharterWebhookEndpoint[]; deliveries: CharterWebhookDelivery[] }>({ action: "webhook_list" }),
  saveWebhook: (payload: Partial<CharterWebhookEndpoint>) =>
    call<{ endpoint: CharterWebhookEndpoint; secret?: string }>({ action: "webhook_save", ...payload }),
  deleteWebhook: (id: string) => call<Record<string, never>>({ action: "webhook_delete", id }),
  testWebhook: () => call<{ event_id: string }>({ action: "webhook_test" }),
  /** Resends the last finalised event (or a specific delivery) to one endpoint. */
  replayWebhook: (payload: { endpoint_id: string; event_type?: string; delivery_id?: string }) =>
    call<{
      delivery: CharterWebhookDelivery | null; replayed_event_id: string;
      status: string; response_status: number | null; error: string | null;
    }>({ action: "webhook_replay", ...payload }),
  /** Live payment state plus the idempotent M-Pesa callback ledger. */
  paymentStatus: (payload: { booking_id?: string; reference?: string }) =>
    call<{
      booking: CharterBookingRow;
      events: {
        result_code: number | null; result_desc: string | null; mpesa_receipt: string | null;
        amount_kes: number | null; applied_status: string; outcome: string; created_at: string;
      }[];
    }>({ action: "payment_status", ...payload }),
  /** Records an issued forensic document and returns its cryptographic seal. */
  registerDocument: (payload: {
    control_number: string; fingerprint: string; template_version: string;
    reference: string; booking_id?: string; document_kind?: string;
    file_name?: string; amount_kes?: number;
    approver_name?: string; approver_title?: string;
    procurement?: Record<string, unknown>;
  }) => call<{
    control_number: string;
    signature: string;
    qr_payload: string;
    validation_token: string;
    verify_url: string;
    audit_chain: CharterAuditChainEntry[];
  }>({ action: "document_register", ...payload }),
  /** Public verification of a printed control number or scanned QR payload. */
  verifyDocument: (payload: {
    control_number: string; fingerprint?: string; template_version?: string;
    reference?: string; token?: string; qr_payload?: string;
  }) => call<{
    found: boolean;
    authentic?: boolean;
    message?: string;
    fraud_confidence?: number;
    verdict?: "authentic" | "review" | "tampered";
    checks?: Record<string, boolean | null>;
    procurement?: Record<string, unknown>;
    audit_chain?: CharterAuditChainEntry[];
    document?: {
      control_number: string; fingerprint: string; template_version: string; document_kind: string;
      reference: string; file_name: string | null; amount_kes: number | null; issued_at: string;
    };
  }>({ action: "document_verify", ...payload }),

  /** Creates (or refreshes) the corporate wallet for an approving authority. */
  ensureCorporateWallet: (payload: {
    organization_name: string; approver_name?: string; approver_title?: string;
  }) => call<{ wallet: CorporateWalletRow; created: boolean }>({ action: "wallet_ensure", ...payload }),
  /**
   * Spends from a corporate wallet (debit only) through a transactional RPC.
   * Credits are rejected by the server — use the funding workflow below, which
   * credits only after a verified M-Pesa STK callback.
   */
  moveCorporateWallet: (payload: {
    wallet_id: string; direction: "credit" | "debit"; amount_kes: number;
    reference?: string; booking_id?: string; cost_center?: string;
    approver_name?: string; approver_title?: string;
  }) => call<{ wallet: CorporateWalletRow; entry: CorporateWalletLedgerRow }>({ action: "wallet_movement", ...payload }),
  listCorporateWallets: () =>
    call<{ wallets: CorporateWalletRow[]; ledger: CorporateWalletLedgerRow[] }>({ action: "wallet_list" }),

  /* ── Callback-gated wallet funding ───────────────────────────────── */
  /** Step 1: records a pending funding request. No money moves. */
  createFundingRequest: (payload: {
    wallet_id: string; amount_kes: number; cost_center: string; purpose?: string;
    approver_name?: string; approver_title?: string; idempotency_key?: string;
  }) => call<{ request: FundingRequestRow; reused: boolean }>({ action: "wallet_funding_create", ...payload }),
  /** Step 2: stamps the STK identifiers so the callback can be matched. */
  markFundingStk: (payload: {
    request_id: string; phone: string; checkout_request_id: string; merchant_request_id?: string;
  }) => call<{ request: FundingRequestRow }>({ action: "wallet_funding_mark_stk", ...payload }),
  /** Step 3: polled while the STK prompt is on the customer's phone. */
  fundingStatus: (request_id: string) =>
    call<{ request: FundingRequestRow; wallet: CorporateWalletRow }>({ action: "wallet_funding_status", request_id }),
  cancelFunding: (request_id: string) =>
    call<{ request: FundingRequestRow }>({ action: "wallet_funding_cancel", request_id }),
  listFundingRequests: (payload: { wallet_id?: string; scope?: "mine" | "all"; limit?: number } = {}) =>
    call<{
      requests: FundingRequestRow[];
      reconciliation: Array<{
        wallet_id: string; organization_name: string; balance_kes: number;
        ledger_balance_kes: number; drift_kes: number; entries: number; paid_funding_kes: number;
      }> | null;
    }>({ action: "wallet_funding_list", ...payload }),


  listBookings: () => call<{ bookings: CharterBookingRow[] }>({ action: "booking_list" }).then((r) => r.bookings),

  flightStatus: (reference: string) =>
    call<{ status: Partial<CharterBookingRow> }>({ action: "flight_status", reference }).then((r) => r.status),
  adminUpdate: (table: string, id: string, patch: Record<string, unknown>) =>
    call<{ row: Record<string, unknown> }>({ action: "admin_update", table, id, patch }).then((r) => r.row),
  adminBulkUpdate: (ids: string[], patch: Record<string, unknown>) =>
    call<{ updated: number }>({ action: "admin_bulk_update", ids, patch }).then((r) => r.updated),
  createInventory: (payload: Record<string, unknown>) =>
    call<{ row: CharterInventoryRow }>({ action: "inventory_create", ...payload }).then((r) => r.row),
  auditTrail: (filters?: CharterAuditFilters) =>
    call<{ entries: CharterAuditRow[] }>({ action: "audit_list", ...(filters ?? {}) }).then((r) => r.entries),
  attachEvidence: (auditId: string, evidenceUrl: string, evidenceNote?: string) =>
    call<{ entry: CharterAuditRow }>({
      action: "audit_attach", audit_id: auditId, evidence_url: evidenceUrl, evidence_note: evidenceNote,
    }).then((r) => r.entry),
  access: () => call<{ access: CharterAccessResponse }>({ action: "access" }).then((r) => r.access),
  recordFlightEvent: (payload: {
    booking_id: string;
    status: string;
    reason_code?: string;
    note?: string;
    occurred_at?: string;
    evidence_url?: string;
    evidence_note?: string;
  }) => call<{ booking: CharterBookingRow }>({ action: "flight_event", ...payload }).then((r) => r.booking),
  getPrefs: () => call<{ prefs: CharterNotificationPrefs }>({ action: "prefs_get" }).then((r) => r.prefs),
  savePrefs: (prefs: CharterNotificationPrefs) =>
    call<{ prefs: CharterNotificationPrefs }>({ action: "prefs_save", ...prefs }).then((r) => r.prefs),
  /** Published pricing configuration currently in force (public). */
  activePricing: () =>
    call<{ config: Record<string, unknown> | null }>({ action: "pricing_active" }).then((r) => r.config),
  /** Publish a new governed pricing version (admin only). */
  publishPricing: (payload: Record<string, unknown>) =>
    call<{ config: Record<string, unknown> }>({ action: "pricing_publish", ...payload }).then((r) => r.config),
  /** Published pricing version history (admin only). */
  pricingVersions: () =>
    call<{ versions: Array<Record<string, unknown>> }>({ action: "pricing_versions" }).then((r) => r.versions),
};


export interface CharterAuditFilters {
  entity_id?: string;
  reference?: string;
  actor?: string;
  from?: string;
  to?: string;
}

export interface CharterAccessResponse {
  roles: string[];
  isAdmin: boolean;
  isOperator: boolean;
  canManageInventory: boolean;
  canManageFlightStatus: boolean;
  canManageCommercial: boolean;
  canViewPricingAudit: boolean;
}

export interface CharterNotificationPrefs {
  contact_email?: string | null;
  quote_emails: boolean;
  booking_emails: boolean;
  status_emails: boolean;
  downloadable_summaries: boolean;
}

export const DEFAULT_CHARTER_PREFS: CharterNotificationPrefs = {
  quote_emails: true,
  booking_emails: true,
  status_emails: true,
  downloadable_summaries: true,
};


export interface CharterAuditRow {
  id: string;
  entity_type: string;
  entity_id: string | null;
  reference: string | null;
  actor_email: string | null;
  action: string;
  category_slug: string | null;
  asset_name: string | null;
  changed_fields: Array<{ field: string; from: unknown; to: unknown }>;
  cost_settings: Record<string, unknown>;
  breakdown: Record<string, unknown>;
  currency: string;
  total: number;
  evidence_hash: string;
  evidence_url: string | null;
  evidence_note: string | null;
  created_at: string;
}

/** Canonical charter flight lifecycle used by the confirmation timeline. */
export const CHARTER_FLIGHT_STAGES = ["requested", "scheduled", "departed", "arrived"] as const;
export type CharterFlightStage = (typeof CHARTER_FLIGHT_STAGES)[number];

export const CHARTER_STAGE_LABELS: Record<CharterFlightStage, string> = {
  requested: "Requested",
  scheduled: "Confirmed",
  departed: "Departed",
  arrived: "Arrived",
};

