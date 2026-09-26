/**
 * DRIVER FINANCE CLEARANCE — client API.
 *
 * A driver account must be cleared by finance before any withdrawal can be
 * requested. The decision, the queue and the payout gate all live in the
 * database (`driver_finance_clearance_*`); nothing is decided here.
 */
import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type ClearanceState = "PENDING" | "CLEARED" | "SUSPENDED";

export const CLEARANCE_LABEL: Record<ClearanceState, string> = {
  PENDING: "Waiting for finance",
  CLEARED: "Cleared for payouts",
  SUSPENDED: "Payouts suspended",
};

export interface ClearanceEvent {
  action: string;
  state_from: string | null;
  state_to: string | null;
  note: string | null;
  created_at: string;
}

export interface ClearanceRow {
  id: string;
  driver_user_id: string;
  state: ClearanceState;
  note: string | null;
  decided_at: string | null;
  created_at: string;
  application_reference: string | null;
  driver_code: string | null;
  driver_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  available_cents: number;
  held_cents: number;
  currency: string;
  payout_account_state: string | null;
  history: ClearanceEvent[];
}

export interface ClearanceConsole {
  clearances: ClearanceRow[];
  summary: { pending: number; cleared: number; suspended: number; total: number };
}

export async function loadDriverClearanceConsole(): Promise<ClearanceConsole> {
  const { data, error } = await db.rpc("driver_finance_clearance_console", {});
  if (error) throw new Error(error.message);
  return data as ClearanceConsole;
}

export async function decideDriverClearance(
  clearanceId: string,
  state: ClearanceState,
  note?: string,
): Promise<void> {
  const { data, error } = await db.rpc("driver_finance_clearance_decide", {
    p: { clearance_id: clearanceId, state, note: note ?? null },
  });
  if (error) throw new Error(error.message);
  const out = data as { error?: boolean; code?: string } | null;
  if (out?.error) throw new Error(out.code ?? "DECISION_REFUSED");
}

export async function loadMyDriverClearance(): Promise<{
  exists: boolean;
  state?: ClearanceState;
  note?: string | null;
  decided_at?: string | null;
}> {
  const { data, error } = await db.rpc("driver_finance_clearance_self", {});
  if (error) throw new Error(error.message);
  return data as { exists: boolean; state?: ClearanceState };
}

export const clearanceMoney = (cents: number, currency = "KES") =>
  `${currency === "KES" ? "KSh" : currency} ${(cents / 100).toLocaleString("en-KE", {
    maximumFractionDigits: 0,
  })}`;
