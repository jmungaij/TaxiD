/**
 * PROVIDER ESCALATION PATH.
 *
 * A service issue on a customer account is routed to the team that can actually
 * fix it — fleet operations, dispatch, safety and compliance, finance or capacity
 * planning — with a response deadline taken from the route register. Routes
 * marked as blocking hold new bookings for that customer until the team closes
 * the escalation, so a broken service is never sold again on the same day.
 */
import { untypedDb } from "@/integrations/supabase/untyped";

export interface EscalationRoute {
  code: string;
  label: string;
  category: string;
  responsible_team: string;
  response_minutes: number;
  blocks_booking: boolean;
  guidance: string | null;
}

export interface Escalation {
  escalation_id: string;
  escalation_ref: string;
  account_id: string | null;
  customer_label: string | null;
  route_code: string;
  route_label: string;
  assigned_team: string;
  summary: string;
  severity: string;
  status: "raised" | "acknowledged" | "resolved" | "withdrawn";
  provider_label: string | null;
  due_at: string;
  overdue: boolean;
  blocks_booking: boolean;
  raised_by: string | null;
  created_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
}

export interface EscalationBoard {
  generated_at: string;
  routes: EscalationRoute[];
  escalations: Escalation[];
  open_count: number;
  overdue_count: number;
  blocking_count: number;
}

export const ESCALATION_REFUSALS: Record<string, string> = {
  NOT_AUTHENTICATED: "Sign in again to use the escalation path.",
  NOT_AUTHORISED: "Escalations are raised by commercial and operations staff.",
  ROUTE_NOT_FOUND: "Choose a team to escalate to.",
  SUMMARY_REQUIRED: "Describe the issue before escalating it.",
  ACCOUNT_REQUIRED: "Choose the customer this affects.",
  ACCOUNT_NOT_FOUND: "That customer is not on the account register.",
  ESCALATION_NOT_FOUND: "That escalation no longer exists.",
  ALREADY_CLOSED: "This escalation is already closed.",
  NOTE_REQUIRED: "Record what was done before closing the escalation.",
  STATUS_INVALID: "Choose acknowledge, resolve or withdraw.",
  BOOKING_BLOCKED_BY_ESCALATION: "This customer has an open escalation that blocks new bookings.",
};

export function escalationRefusal(message: string): string {
  const hit = Object.keys(ESCALATION_REFUSALS).find((k) => message.includes(k));
  return hit ? ESCALATION_REFUSALS[hit] : message;
}

export async function loadEscalationBoard(opts?: {
  accountId?: string | null;
  includeClosed?: boolean;
}): Promise<EscalationBoard> {
  const { data, error } = await untypedDb.rpc("provider_escalation_board", {
    p: { account_id: opts?.accountId ?? null, include_closed: opts?.includeClosed ?? false },
  });
  if (error) throw new Error(escalationRefusal(error.message));
  return data as unknown as EscalationBoard;
}

export async function raiseEscalation(input: {
  accountId: string;
  routeCode: string;
  summary: string;
  severity?: string;
  providerLabel?: string | null;
  signalId?: string | null;
  executionId?: string | null;
}): Promise<{ escalation_ref: string; assigned_team: string; due_at: string; blocks_booking: boolean }> {
  const { data, error } = await untypedDb.rpc("provider_escalation_raise", {
    p: {
      account_id: input.accountId,
      route_code: input.routeCode,
      summary: input.summary,
      severity: input.severity ?? "medium",
      provider_label: input.providerLabel ?? null,
      signal_id: input.signalId ?? null,
      execution_id: input.executionId ?? null,
    },
  });
  if (error) throw new Error(escalationRefusal(error.message));
  return data as { escalation_ref: string; assigned_team: string; due_at: string; blocks_booking: boolean };
}

export async function advanceEscalation(
  escalationId: string,
  status: "acknowledged" | "resolved" | "withdrawn",
  note?: string,
): Promise<void> {
  const { error } = await untypedDb.rpc("provider_escalation_advance", {
    p: { escalation_id: escalationId, status, note: note ?? null },
  });
  if (error) throw new Error(escalationRefusal(error.message));
}

/** Called before a trip is booked: names the escalations holding this customer. */
export async function bookingCheck(accountId: string): Promise<{
  blocked: boolean;
  blockers: { escalation_ref: string; assigned_team: string; summary: string; due_at: string }[];
}> {
  const { data, error } = await untypedDb.rpc("provider_escalation_booking_check", {
    p: { account_id: accountId },
  });
  if (error) throw new Error(escalationRefusal(error.message));
  return data as { blocked: boolean; blockers: { escalation_ref: string; assigned_team: string; summary: string; due_at: string }[] };
}
