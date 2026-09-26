/**
 * LEAD JOURNEY — the specialist-facing projection of a lead.
 *
 * Six visible steps, one button each. The step is a *projection* over the
 * authoritative `stage` machine in the database: logging a step asks the
 * database to walk the stage graph, so no stage can be skipped and every hop
 * stays on the audit trail. Won never closes on a verbal yes — the database
 * requires a signed contract and a recorded revenue figure.
 */
import { untypedDb } from "@/integrations/supabase/untyped";
import type { SalesLead } from "@/lib/sales/pipeline";

export const JOURNEY_STEPS = ["NEW", "MEETING", "QUOTE", "CONTRACT", "WON", "LOST"] as const;
export type JourneyStep = (typeof JOURNEY_STEPS)[number];

export const JOURNEY_LABEL: Record<JourneyStep, string> = {
  NEW: "New lead",
  MEETING: "Meeting held",
  QUOTE: "Quote shared",
  CONTRACT: "Contract shared / signed",
  WON: "Won",
  LOST: "Lost",
};

/**
 * Loss reasons carry the detail that makes reporting usable. `requires` names
 * the extra field the database will insist on for that reason — the form asks
 * for it, the database enforces it, so no loss is ever recorded as a bare
 * "lost".
 */
export const LOSS_REASONS = [
  { code: "PRICE_TOO_HIGH", label: "Price too high", requires: "PRICE" },
  { code: "LOST_TO_COMPETITOR", label: "Lost to a competitor", requires: "COMPETITOR" },
  { code: "TIMING", label: "Timing / postponed", requires: "REVISIT_DATE" },
  { code: "NO_BUDGET", label: "No budget", requires: "NOTE" },
  { code: "NO_RESPONSE", label: "No response", requires: "NOTE" },
  { code: "OTHER", label: "Other", requires: "NOTE" },
] as const;
export type LossReasonCode = (typeof LOSS_REASONS)[number]["code"];
export type LossRequirement = (typeof LOSS_REASONS)[number]["requires"];

export const LOSS_REASON_LABEL: Record<string, string> = {
  ...Object.fromEntries(LOSS_REASONS.map((r) => [r.code, r.label])),
  UNRECORDED: "Reason not recorded",
};

export const lossRequirement = (code: LossReasonCode): LossRequirement =>
  LOSS_REASONS.find((r) => r.code === code)!.requires;

export interface LossDetail {
  competitor?: string;
  expected_price_kes?: string;
  revisit_date?: string;
  note?: string;
}

/** What the form still needs before the database will accept the loss. */
export function lossDetailProblem(code: LossReasonCode | "", detail: LossDetail): string | null {
  if (!code) return "Choose why this was lost.";
  const need = lossRequirement(code);
  if (need === "COMPETITOR" && !detail.competitor?.trim()) return "Name the competitor who won it.";
  if (need === "PRICE") {
    const v = Number(detail.expected_price_kes);
    if (!detail.expected_price_kes?.trim() || !Number.isFinite(v) || v <= 0)
      return "Record the price the client expected or was quoted elsewhere.";
  }
  if (need === "REVISIT_DATE") {
    if (!detail.revisit_date) return "Choose the date to revisit this client.";
    if (detail.revisit_date <= new Date().toISOString().slice(0, 10))
      return "The revisit date must be later than today.";
  }
  if (need === "NOTE" && (detail.note?.trim().length ?? 0) < 5)
    return "Add a short explanation (at least a few words).";
  return null;
}

export const LOSS_ERROR: Record<string, string> = {
  COMPETITOR_NAME_REQUIRED: "Name the competitor who won it.",
  EXPECTED_PRICE_REQUIRED: "Record the price the client expected or was quoted elsewhere.",
  REVISIT_DATE_REQUIRED: "Choose the date to revisit this client.",
  REVISIT_DATE_MUST_BE_FUTURE: "The revisit date must be later than today.",
  EXPLANATION_REQUIRED: "Add a short explanation (at least a few words).",
  LOSS_REASON_REQUIRED: "Choose why this was lost.",
  LEAD_ALREADY_CLOSED: "This lead is already closed.",
  LEAD_NOT_YOURS: "This lead belongs to someone else.",
};

/** Journey fields added on top of the pipeline record. */
export interface JourneyLead extends SalesLead {
  lost_reason_code: string | null;
  lost_competitor: string | null;
  lost_expected_price_kes: number | null;
  lost_revisit_date: string | null;
  waiting_on: "US" | "CLIENT" | null;
  awaiting_item: string | null;
  awaiting_due_date: string | null;
  meeting_held_at: string | null;
  quote_shared_at: string | null;
  contract_shared_at: string | null;
  contract_signed_at: string | null;
  won_revenue_kes: number | null;
}

/** Quick search over the fields a specialist would actually type. */
export function matchesLeadSearch(lead: JourneyLead, term: string): boolean {
  const q = term.trim().toLowerCase();
  if (!q) return true;
  return [
    lead.organisation_name,
    lead.contact_name,
    lead.lead_ref,
    lead.service_interest,
    lead.contact_email,
    lead.contact_phone,
  ]
    .filter(Boolean)
    .some((v) => String(v).toLowerCase().includes(q));
}

export function journeyStep(lead: JourneyLead): JourneyStep {
  if (lead.stage === "CLOSED_WON") return "WON";
  if (lead.stage === "CLOSED_LOST" || lead.stage === "DISQUALIFIED") return "LOST";
  if (lead.contract_shared_at || lead.contract_signed_at) return "CONTRACT";
  if (lead.quote_shared_at) return "QUOTE";
  if (lead.meeting_held_at) return "MEETING";
  return "NEW";
}

/** What the specialist can do next, in the order they would naturally do it. */
export function nextSteps(lead: JourneyLead): { kind: LogStepKind; label: string }[] {
  if (lead.stage === "CLOSED_WON" || lead.stage === "CLOSED_LOST" || lead.stage === "DISQUALIFIED")
    return [];
  const out: { kind: LogStepKind; label: string }[] = [];
  if (!lead.meeting_held_at) out.push({ kind: "MEETING", label: "Meeting held" });
  if (!lead.quote_shared_at) out.push({ kind: "QUOTE_SHARED", label: "Quote shared" });
  if (!lead.contract_shared_at) out.push({ kind: "CONTRACT_SHARED", label: "Contract shared" });
  if (!lead.contract_signed_at) out.push({ kind: "CONTRACT_SIGNED", label: "Contract signed" });
  return out;
}

export type LogStepKind = "MEETING" | "QUOTE_SHARED" | "CONTRACT_SHARED" | "CONTRACT_SIGNED";

interface RpcError {
  message: string;
}

async function call<T>(fn: string, p: Record<string, unknown>): Promise<T> {
  const { data, error } = await untypedDb.rpc(fn, { p });
  if (error) throw new Error((error as RpcError).message);
  return data as T;
}

export async function listJourneyLeads(): Promise<JourneyLead[]> {
  const { data, error } = await untypedDb
    .from("sales_leads")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as JourneyLead[];
}

export const logStep = (leadId: string, kind: LogStepKind, note?: string) =>
  call("sales_lead_log_step", { lead_id: leadId, kind, note });

export const markWon = (leadId: string, revenueKes: number, note?: string) =>
  call("sales_lead_mark_won", { lead_id: leadId, revenue_kes: revenueKes, note });

export const markLost = (leadId: string, reasonCode: LossReasonCode, detail: LossDetail = {}) =>
  call("sales_lead_mark_lost", {
    lead_id: leadId,
    reason_code: reasonCode,
    note: detail.note,
    competitor: detail.competitor,
    expected_price_kes: detail.expected_price_kes,
    revisit_date: detail.revisit_date,
  });

export const setWaiting = (
  leadId: string,
  waitingOn: "US" | "CLIENT" | null,
  awaitingItem?: string,
  dueDate?: string,
) =>
  call("sales_lead_set_waiting", {
    lead_id: leadId,
    waiting_on: waitingOn,
    awaiting_item: awaitingItem,
    awaiting_due_date: dueDate || null,
  });

export interface BulkImportRow {
  organisation_name: string;
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
  service_interest?: string;
  estimated_value_kes?: string;
  notes?: string;
  owner_staff_id?: string;
}

export interface BulkImportResult {
  batch_id: string;
  submitted: number;
  created: number;
  skipped: number;
  skips: { row: number; organisation?: string; reason: string }[];
}

export const bulkImportLeads = (
  rows: BulkImportRow[],
  ownerStaffIds: string[],
  opts: { source?: string; label?: string } = {},
) =>
  call<BulkImportResult>("sales_lead_bulk_import", {
    rows,
    owner_staff_ids: ownerStaffIds,
    source: opts.source ?? "PASTE",
    label: opts.label,
  });

export const reassignLead = (leadId: string, staffId: string, reason: string) =>
  call("sales_lead_assign", { lead_id: leadId, staff_id: staffId, reason });

/**
 * Correcting a lead's own details (a missing email, a wrong phone number, the
 * service the client actually asked about). Only the keys sent are touched, so
 * an edit never blanks a field the specialist did not open. Allowed at every
 * step — a won or lost lead still needs a reachable contact.
 */
export interface LeadDetailsPatch {
  organisation_name?: string;
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
  service_interest?: string;
  estimated_value_kes?: string;
  notes?: string;
  reason?: string;
}

export const DETAILS_ERROR: Record<string, string> = {
  ORGANISATION_NAME_REQUIRED: "The company name cannot be left empty.",
  EMAIL_NOT_VALID: "That email address does not look right (example: name@company.co.ke).",
  PHONE_NOT_VALID: "That phone number does not look right (example: 0712 345678).",
  VALUE_NOT_VALID: "The estimated value must be a positive number.",
  LEAD_NOT_YOURS: "This lead belongs to someone else.",
  LEAD_NOT_FOUND: "This lead no longer exists.",
};

export const updateLeadDetails = (leadId: string, patch: LeadDetailsPatch) =>
  call<{ lead_id: string; changed: Record<string, unknown> }>("sales_lead_update_details", {
    lead_id: leadId,
    ...patch,
  });

/** What a lead is still missing before anyone can actually contact it. */
export function missingContact(lead: JourneyLead): string[] {
  const gaps: string[] = [];
  if (!lead.contact_name?.trim()) gaps.push("contact name");
  if (!lead.contact_email?.trim()) gaps.push("email");
  if (!lead.contact_phone?.trim()) gaps.push("phone");
  return gaps;
}

export interface DeskFigures {
  sales_staff_id: string | null;
  staff_name: string;
  leads_working: number;
  meetings_held: number;
  quotes_shared: number;
  contracts_signed: number;
  won: number;
  lost: number;
  revenue_won_kes: number;
  waiting_on_us: number;
  waiting_on_client: number;
  waiting_overdue: number;
}

export async function deskFigures(): Promise<DeskFigures[]> {
  const { data, error } = await untypedDb
    .from("v_sales_desk_simple")
    .select("*")
    .order("revenue_won_kes", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as DeskFigures[];
}

export interface LossReasonRow {
  reason_code: string;
  leads_lost: number;
  value_lost_kes: number;
}

export async function lossReasons(): Promise<LossReasonRow[]> {
  const { data, error } = await untypedDb
    .from("v_sales_lead_loss_reasons")
    .select("*")
    .order("leads_lost", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as LossReasonRow[];
}

/** Parse pasted rows or CSV text. Tab, comma or semicolon separated. */
export function parseLeadRows(text: string): { rows: BulkImportRow[]; ignored: number } {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const rows: BulkImportRow[] = [];
  let ignored = 0;
  for (const [i, line] of lines.entries()) {
    const cells = line.split(/\t|;|,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((c) => c.replace(/^"|"$/g, "").trim());
    if (i === 0 && /organisation|company/i.test(cells[0] ?? "")) continue;
    const [organisation_name, contact_name, contact_email, contact_phone, service_interest, estimated_value_kes, notes] =
      cells;
    if (!organisation_name) {
      ignored += 1;
      continue;
    }
    rows.push({
      organisation_name,
      contact_name,
      contact_email,
      contact_phone,
      service_interest,
      estimated_value_kes: estimated_value_kes?.replace(/[^\d.]/g, "") || undefined,
      notes,
    });
  }
  return { rows, ignored };
}

export const KES = (n: number) =>
  new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(n);
