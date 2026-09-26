/**
 * STAGE REMINDERS — derived from the dates already recorded on the lead.
 *
 * Nothing invents work: a reminder exists only because a step has a recorded
 * date and the next step does not, past the number of days leadership set in
 * the sales engine settings. Reminders can be snoozed to a date or dismissed
 * with a reason, and both are recorded against the lead.
 */
import { untypedDb } from "@/integrations/supabase/untyped";

export const REMINDER_KINDS = [
  "NO_MEETING",
  "NO_QUOTE",
  "NO_CONTRACT",
  "NOT_SIGNED",
  "CLIENT_OVERDUE",
] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];

export const REMINDER_TITLE: Record<ReminderKind, string> = {
  NO_MEETING: "No meeting held yet",
  NO_QUOTE: "Meeting held, quote not shared",
  NO_CONTRACT: "Quote shared, no contract yet",
  NOT_SIGNED: "Contract shared, not signed",
  CLIENT_OVERDUE: "The client is past their date",
};

export const REMINDER_ACTION: Record<ReminderKind, string> = {
  NO_MEETING: "Get the meeting booked",
  NO_QUOTE: "Send the quote",
  NO_CONTRACT: "Share the contract",
  NOT_SIGNED: "Chase the signature",
  CLIENT_OVERDUE: "Follow up on what you are waiting for",
};

export interface LeadReminder {
  lead_id: string;
  lead_ref: string;
  organisation_name: string;
  contact_name: string | null;
  sales_staff_id: string | null;
  staff_name: string;
  stage: string;
  reminder_kind: ReminderKind;
  days_overdue: number;
  waiting_on: string | null;
  awaiting_item: string | null;
  awaiting_due_date: string | null;
  snoozed_until: string | null;
  dismissed_at: string | null;
}

export async function listReminders(): Promise<LeadReminder[]> {
  const { data, error } = await untypedDb
    .from("v_sales_lead_reminders")
    .select("*")
    .order("days_overdue", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as LeadReminder[];
}

async function call<T>(fn: string, p: Record<string, unknown>): Promise<T> {
  const { data, error } = await untypedDb.rpc(fn, { p });
  if (error) throw new Error(error.message);
  return data as T;
}

export const snoozeReminder = (leadId: string, kind: ReminderKind, until: string) =>
  call("sales_lead_reminder_ack", { lead_id: leadId, reminder_kind: kind, snoozed_until: until });

export const dismissReminder = (leadId: string, kind: ReminderKind, note: string) =>
  call("sales_lead_reminder_ack", { lead_id: leadId, reminder_kind: kind, dismiss: true, note });

export const REMINDER_ERROR: Record<string, string> = {
  SNOOZE_DATE_REQUIRED: "Choose the date you will come back to this.",
  SNOOZE_DATE_MUST_BE_FUTURE: "Pick a date later than today.",
  DISMISS_NOTE_REQUIRED: "Say why this reminder no longer applies (at least a few words).",
  LEAD_NOT_YOURS: "This lead belongs to someone else.",
};

export const reminderError = (message: string) => REMINDER_ERROR[message] ?? message;
