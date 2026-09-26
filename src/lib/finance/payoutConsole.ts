/**
 * PAYOUT CONSOLE — staff read model + decisions.
 *
 * Reads the authoritative records only: carrier_profiles / partner_wallets /
 * carrier_payable_lines / carrier_withdrawal_requests for Fleet Owners, and
 * drivers / wallets / driver_trip_earnings / driver_payouts for drivers.
 * Decisions delegate to the existing RPCs (`carrier_withdrawal_decide`,
 * `driver_withdrawal_decide`, `driver_earning_accrue`, `driver_earning_release`).
 */
import { supabase } from "@/integrations/supabase/client";

export interface Outcome {
  ok?: boolean; error?: boolean; code?: string; message?: string; [k: string]: unknown;
}

async function rpc<T = Outcome>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn as never, (args ?? {}) as never);
  if (error) return { error: true, code: "RPC_FAILED", message: error.message } as T;
  return (data ?? { error: true, code: "EMPTY_RESPONSE" }) as T;
}

function unwrap<T>(data: T, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  return data;
}

/* ----------------------------------------------------------- fleet owners */

export interface FleetOwnerMoneyRow {
  carrier_id: string;
  carrier_code: string;
  legal_entity_name: string;
  operating_status: string;
  partner_id: string | null;
  currency: string;
  balance: number;
  reserved: number;
  available: number;
  accrued_payables: number;
  released_payables: number;
  payable_count: number;
  destination_verified: boolean;
  withdrawals_in_flight: number;
  last_withdrawal_state: string | null;
  last_withdrawal_reference: string | null;
}

export async function listFleetOwnerMoney(): Promise<FleetOwnerMoneyRow[]> {
  const [carriers, wallets, payables, destinations, withdrawals] = await Promise.all([
    supabase.from("carrier_profiles" as never)
      .select("id,carrier_code,legal_entity_name,operating_status,partner_id,settlement_currency"),
    supabase.from("partner_wallets" as never).select("partner_id,currency,balance,reserved"),
    supabase.from("carrier_payable_lines" as never).select("carrier_id,state,net_payable"),
    supabase.from("carrier_settlement_destinations" as never).select("carrier_id,verification_state"),
    supabase.from("carrier_withdrawal_requests" as never)
      .select("carrier_id,state,amount_kes,request_reference,requested_at")
      .order("requested_at", { ascending: false }),
  ]);

  const cRows = unwrap((carriers.data ?? []) as unknown as {
    id: string; carrier_code: string; legal_entity_name: string; operating_status: string;
    partner_id: string | null; settlement_currency: string | null;
  }[], carriers.error);
  const wRows = (wallets.data ?? []) as unknown as { partner_id: string; currency: string; balance: number; reserved: number }[];
  const pRows = (payables.data ?? []) as unknown as { carrier_id: string; state: string; net_payable: number }[];
  const dRows = (destinations.data ?? []) as unknown as { carrier_id: string; verification_state: string }[];
  const xRows = (withdrawals.data ?? []) as unknown as {
    carrier_id: string; state: string; amount_kes: number; request_reference: string;
  }[];

  return cRows.map((c) => {
    const w = wRows.find((x) => x.partner_id === c.partner_id);
    const mine = pRows.filter((x) => x.carrier_id === c.id);
    const xs = xRows.filter((x) => x.carrier_id === c.id);
    const balance = Number(w?.balance ?? 0);
    const reserved = Number(w?.reserved ?? 0);
    return {
      carrier_id: c.id,
      carrier_code: c.carrier_code,
      legal_entity_name: c.legal_entity_name,
      operating_status: c.operating_status,
      partner_id: c.partner_id,
      currency: w?.currency ?? c.settlement_currency ?? "KES",
      balance, reserved, available: balance - reserved,
      accrued_payables: mine.filter((x) => x.state === "ACCRUED").reduce((s, x) => s + Number(x.net_payable ?? 0), 0),
      released_payables: mine.filter((x) => ["RELEASED", "PAID", "SETTLED"].includes(x.state))
        .reduce((s, x) => s + Number(x.net_payable ?? 0), 0),
      payable_count: mine.length,
      destination_verified: dRows.some((x) => x.carrier_id === c.id && x.verification_state === "VERIFIED"),
      withdrawals_in_flight: xs.filter((x) => ["REQUESTED", "UNDER_REVIEW", "APPROVED", "EXECUTED"].includes(x.state))
        .reduce((s, x) => s + Number(x.amount_kes ?? 0), 0),
      last_withdrawal_state: xs[0]?.state ?? null,
      last_withdrawal_reference: xs[0]?.request_reference ?? null,
    };
  });
}

/* ----------------------------------------------------------------- drivers */

export interface DriverMoneyRow {
  driver_id: string;
  user_id: string | null;
  driver_code: string | null;
  name: string;
  status: string;
  verification_status: string | null;
  carrier_id: string | null;
  wallet_cents: number;
  earned_cents: number;
  available_cents: number;
  withdrawn_cents: number;
  earning_count: number;
  in_flight_cents: number;
  paid_cents: number;
}

export async function listDriverMoney(): Promise<DriverMoneyRow[]> {
  const [drivers, wallets, earnings, payouts] = await Promise.all([
    supabase.from("drivers" as never)
      .select("id,user_id,driver_code,first_name,last_name,status,verification_status,carrier_id"),
    supabase.from("wallets" as never).select("user_id,balance_cents,wallet_type").eq("wallet_type", "driver"),
    supabase.from("driver_trip_earnings" as never).select("driver_id,state,net_cents"),
    supabase.from("driver_payouts" as never).select("driver_id,status,amount_cents"),
  ]);

  const dRows = unwrap((drivers.data ?? []) as unknown as {
    id: string; user_id: string | null; driver_code: string | null; first_name: string | null;
    last_name: string | null; status: string; verification_status: string | null; carrier_id: string | null;
  }[], drivers.error);
  const wRows = (wallets.data ?? []) as unknown as { user_id: string; balance_cents: number }[];
  const eRows = (earnings.data ?? []) as unknown as { driver_id: string; state: string; net_cents: number }[];
  const pRows = (payouts.data ?? []) as unknown as { driver_id: string; status: string; amount_cents: number }[];

  return dRows.map((d) => {
    const mine = eRows.filter((x) => x.driver_id === d.id);
    const po = pRows.filter((x) => x.driver_id === d.user_id);
    const sum = (f: (x: { state: string }) => boolean) =>
      mine.filter(f).reduce((s, x) => s + Number(x.net_cents ?? 0), 0);
    return {
      driver_id: d.id,
      user_id: d.user_id,
      driver_code: d.driver_code,
      name: `${d.first_name ?? ""} ${d.last_name ?? ""}`.trim() || "—",
      status: d.status,
      verification_status: d.verification_status,
      carrier_id: d.carrier_id,
      wallet_cents: Number(wRows.find((w) => w.user_id === d.user_id)?.balance_cents ?? 0),
      earned_cents: sum(() => true),
      available_cents: sum((x) => x.state === "AVAILABLE"),
      withdrawn_cents: sum((x) => ["WITHDRAWN", "PAID"].includes(x.state)),
      earning_count: mine.length,
      in_flight_cents: po.filter((x) => ["PENDING", "QUEUED", "PROCESSING"].includes(x.status))
        .reduce((s, x) => s + Number(x.amount_cents ?? 0), 0),
      paid_cents: po.filter((x) => x.status === "SUCCESS").reduce((s, x) => s + Number(x.amount_cents ?? 0), 0),
    };
  });
}

export interface DriverPayoutQueueRow {
  id: string;
  reference: string | null;
  driver_id: string;
  amount_cents: number;
  status: string;
  provider_txn_id: string | null;
  journal_id: string | null;
  created_at: string;
  approved_at: string | null;
  paid_at: string | null;
  metadata: Record<string, unknown> | null;
}

export async function listDriverPayoutQueue(): Promise<DriverPayoutQueueRow[]> {
  const { data, error } = await supabase
    .from("driver_payouts" as never)
    .select("id,reference,driver_id,amount_cents,status,provider_txn_id,journal_id,created_at,approved_at,paid_at,metadata")
    .order("created_at", { ascending: false })
    .limit(200);
  return unwrap((data ?? []) as unknown as DriverPayoutQueueRow[], error);
}

export interface StaffEarningRow {
  id: string;
  earning_reference: string;
  booking_id: string;
  driver_id: string;
  service_line: string;
  gross_cents: number;
  commission_bps: number;
  commission_cents: number;
  net_cents: number;
  state: string;
  data_class: string;
  journal_id: string | null;
  accrued_at: string;
}

export async function listAllEarnings(limit = 200): Promise<StaffEarningRow[]> {
  const { data, error } = await supabase
    .from("driver_trip_earnings" as never)
    .select("id,earning_reference,booking_id,driver_id,service_line,gross_cents,commission_bps,commission_cents,net_cents,state,data_class,journal_id,accrued_at")
    .order("accrued_at", { ascending: false })
    .limit(limit);
  return unwrap((data ?? []) as unknown as StaffEarningRow[], error);
}

export const accrueDriverEarning = (bookingId: string) =>
  rpc("driver_earning_accrue", { _booking_id: bookingId });

export const releaseDriverEarning = (earningId: string) =>
  rpc("driver_earning_release", { _earning_id: earningId });

export const decideDriverWithdrawal = (input: {
  payoutId: string; action: "APPROVE" | "REJECT"; reason?: string;
}) => rpc("driver_withdrawal_decide", {
  p: { payout_id: input.payoutId, action: input.action, reason: input.reason ?? null },
});
