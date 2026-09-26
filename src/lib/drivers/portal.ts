/**
 * DRIVER PORTAL — read model over the authoritative services.
 *
 * This module owns NO financial logic. Every money figure comes from
 * `driver_portal_summary()` (server-computed) or from the authoritative
 * records themselves: `driver_trip_earnings`, `wallets`, `wallet_transactions`,
 * `driver_payouts`, `driver_documents`, `trip_bookings`.
 *
 * The only mutation exposed here is `requestDriverWithdrawal`, which delegates
 * to `driver_withdrawal_request` — the existing payout engine decides.
 */
import { supabase } from "@/integrations/supabase/client";

export interface Outcome {
  ok?: boolean;
  error?: boolean;
  code?: string;
  message?: string;
  [k: string]: unknown;
}

export type EarningState =
  | "PENDING" | "ELIGIBLE" | "EARNED" | "AVAILABLE"
  | "WITHDRAWN" | "PAID" | "REVERSED" | "DISPUTED";

export interface DriverPortalSummary {
  is_driver: boolean;
  driver?: {
    id: string;
    driver_code: string | null;
    name: string;
    status: string;
    application_status: string | null;
    verification_status: string | null;
    carrier_id: string | null;
    carrier_name: string | null;
    rating: number | null;
    activation_date: string | null;
  };
  wallet?: { currency: string; balance_cents: number; exists: boolean };
  earnings?: {
    today_cents: number; week_cents: number; month_cents: number;
    lifetime_cents: number; pending_cents: number; available_cents: number;
    withdrawn_cents: number; reversed_cents: number; test_cents: number; count: number;
  };
  trips?: { total: number; completed: number; cancelled: number };
  payouts?: { in_flight_cents: number; paid_cents: number; count: number };
  documents?: { total: number; verified: number; expiring_soon: number; expired: number };
  generated_at?: string;
}

export interface DriverEarningRow {
  id: string;
  earning_reference: string;
  booking_id: string;
  service_line: string;
  currency: string;
  gross_cents: number;
  commission_bps: number;
  commission_cents: number;
  deductions_cents: number;
  net_cents: number;
  state: EarningState;
  data_class: "PRODUCTION" | "TEST";
  journal_id: string | null;
  wallet_transaction_id: string | null;
  payout_id: string | null;
  accrued_at: string;
  released_at: string | null;
}

export interface DriverTripRow {
  id: string;
  booking_number: string | null;
  status: string;
  pickup_address: string | null;
  dropoff_address: string | null;
  intent: string | null;
  total_fare: number | null;
  currency: string | null;
  payment_status: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface DriverPayoutRow {
  id: string;
  reference: string | null;
  amount_cents: number;
  net_payout_cents: number | null;
  currency: string;
  status: string;
  provider_txn_id: string | null;
  journal_id: string | null;
  approved_at: string | null;
  paid_at: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
}

export interface DriverPayoutMethodRow {
  id: string;
  method_type: string;
  msisdn: string | null;
  bank_account: string | null;
  account_name: string | null;
  verified: boolean;
  is_default: boolean;
}

export interface DriverDocumentRow {
  id: string;
  doc_type: string | null;
  doc_label: string | null;
  document_number: string | null;
  status: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  verified_at: string | null;
  rejection_reason: string | null;
  created_at: string;
}

function unwrap<T>(data: T, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  return data;
}

export async function driverPortalSummary(): Promise<DriverPortalSummary> {
  const { data, error } = await supabase.rpc("driver_portal_summary" as never);
  if (error) throw new Error(error.message);
  return (data ?? { is_driver: false }) as unknown as DriverPortalSummary;
}

export async function listMyEarnings(limit = 100): Promise<DriverEarningRow[]> {
  const { data, error } = await supabase
    .from("driver_trip_earnings" as never)
    .select("*")
    .order("accrued_at", { ascending: false })
    .limit(limit);
  return unwrap((data ?? []) as unknown as DriverEarningRow[], error);
}

export async function listMyTrips(driverId: string, limit = 50): Promise<DriverTripRow[]> {
  const { data, error } = await supabase
    .from("trip_bookings" as never)
    .select("id,booking_number,status,pickup_address,dropoff_address,intent,total_fare,currency,payment_status,completed_at,created_at")
    .eq("driver_id", driverId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return unwrap((data ?? []) as unknown as DriverTripRow[], error);
}

export async function listMyPayouts(limit = 50): Promise<DriverPayoutRow[]> {
  const { data, error } = await supabase
    .from("driver_payouts" as never)
    .select("id,reference,amount_cents,net_payout_cents,currency,status,provider_txn_id,journal_id,approved_at,paid_at,created_at,metadata")
    .order("created_at", { ascending: false })
    .limit(limit);
  return unwrap((data ?? []) as unknown as DriverPayoutRow[], error);
}

export async function listMyPayoutMethods(): Promise<DriverPayoutMethodRow[]> {
  const { data, error } = await supabase
    .from("driver_payout_methods" as never)
    .select("id,method_type,msisdn,bank_account,account_name,verified,is_default")
    .order("created_at", { ascending: false });
  return unwrap((data ?? []) as unknown as DriverPayoutMethodRow[], error);
}

export async function listMyDriverDocuments(): Promise<DriverDocumentRow[]> {
  const { data, error } = await supabase
    .from("driver_documents" as never)
    .select("id,doc_type,doc_label,document_number,status,issue_date,expiry_date,verified_at,rejection_reason,created_at")
    .order("created_at", { ascending: false });
  return unwrap((data ?? []) as unknown as DriverDocumentRow[], error);
}

export async function listMyWalletTransactions(limit = 50) {
  const { data, error } = await supabase
    .from("wallet_transactions" as never)
    .select("id,direction,amount_cents,kind,status,reference,created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  return unwrap((data ?? []) as unknown as {
    id: string; direction: string; amount_cents: number; kind: string;
    status: string; reference: string | null; created_at: string;
  }[], error);
}

/** Ask the existing payout engine for a withdrawal. Idempotency key is mandatory. */
export async function requestDriverWithdrawal(input: {
  amountCents: number;
  methodId: string;
  idempotencyKey: string;
}): Promise<Outcome> {
  const { data, error } = await supabase.rpc("driver_withdrawal_request" as never, {
    p: {
      amount_cents: input.amountCents,
      method_id: input.methodId,
      idempotency_key: input.idempotencyKey,
    },
  } as never);
  if (error) return { error: true, code: "RPC_FAILED", message: error.message };
  return (data ?? { error: true, code: "EMPTY_RESPONSE" }) as Outcome;
}

export const kes = (cents: number | null | undefined) =>
  `KES ${((cents ?? 0) / 100).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
