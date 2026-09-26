/**
 * Scheduled report exports.
 *
 * The catalogue of reports that can be delivered automatically, plus the pure
 * cadence maths used by the UI (and mirrored by the
 * `report-export-dispatcher` edge function) to show/compute the next run.
 */
import { supabase } from "@/integrations/supabase/client";
import { untypedDb } from "@/integrations/supabase/untyped";

export type ReportCadence = "daily" | "weekly" | "monthly";
export type ReportFormat = "csv" | "pdf" | "both";

export interface ReportDefinition {
  key: string;
  label: string;
  description: string;
  /** Whether the report is scoped to a single corporate account. */
  requiresCorporate: boolean;
}

export const REPORT_CATALOGUE: ReportDefinition[] = [
  { key: "conversion-funnel", label: "Conversion funnel", description: "Enquiry → invoice funnel with step conversion.", requiresCorporate: false },
  { key: "contract-pipeline", label: "Contract pipeline", description: "Open, weighted and contracted pipeline value.", requiresCorporate: false },
  { key: "monthly-spend", label: "Monthly spend", description: "Invoiced spend trend per account.", requiresCorporate: true },
  { key: "department-budgets", label: "Department budgets", description: "Budget, spend, remaining and utilisation bands.", requiresCorporate: true },
  { key: "invoices-receipts", label: "Invoices & receipts", description: "Invoice and receipt ledger with overdue flags.", requiresCorporate: true },
  { key: "statement", label: "Corporate statement", description: "Full statement with invoiced, paid, outstanding and overdue totals.", requiresCorporate: true },
];

export const REPORT_LABEL: Record<string, string> = Object.fromEntries(
  REPORT_CATALOGUE.map((r) => [r.key, r.label]),
);

export interface ReportSchedule {
  id: string;
  name: string;
  report_key: string;
  cadence: ReportCadence;
  format: ReportFormat;
  recipients: string[];
  corporate_id: string | null;
  range_days: number;
  enabled: boolean;
  last_run_at: string | null;
  next_run_at: string;
  created_at: string;
}

export interface ReportRun {
  id: string;
  schedule_id: string | null;
  report_key: string;
  format: string;
  recipients: string[];
  range_from: string | null;
  range_to: string | null;
  row_count: number;
  csv_bytes: number;
  status: string;
  error: string | null;
  created_at: string;
}

const DAY = 86_400_000;

/** Next run instant for a cadence, matching `advance_report_export_schedule`. */
export function nextRunAt(cadence: ReportCadence, from: Date = new Date()): Date {
  if (cadence === "daily") return new Date(from.getTime() + DAY);
  if (cadence === "weekly") return new Date(from.getTime() + 7 * DAY);
  const d = new Date(from);
  d.setMonth(d.getMonth() + 1);
  return d;
}

export function defaultRangeDays(cadence: ReportCadence): number {
  return cadence === "daily" ? 1 : cadence === "weekly" ? 7 : 30;
}

/** Parses a comma/newline separated recipient list into unique addresses. */
export function parseRecipients(raw: string): string[] {
  const seen = new Set<string>();
  for (const part of raw.split(/[,\n;]/)) {
    const email = part.trim().toLowerCase();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) seen.add(email);
  }
  return Array.from(seen);
}

export function scheduleIsDue(s: Pick<ReportSchedule, "enabled" | "next_run_at">, now = Date.now()): boolean {
  return s.enabled && new Date(s.next_run_at).getTime() <= now;
}

/* -------------------------------------------------------------- data access */

const db = () => untypedDb;

export async function loadReportSchedules(): Promise<ReportSchedule[]> {
  const { data, error } = await db()
    .from("report_export_schedules").select("*").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as ReportSchedule[]).map((s) => ({
    ...s,
    recipients: Array.isArray(s.recipients) ? s.recipients.map(String) : [],
  }));
}

export async function loadReportRuns(limit = 50): Promise<ReportRun[]> {
  const { data, error } = await db()
    .from("report_export_runs").select("*").order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as ReportRun[]).map((r) => ({
    ...r,
    recipients: Array.isArray(r.recipients) ? r.recipients.map(String) : [],
  }));
}

export interface ScheduleDraft {
  name: string;
  report_key: string;
  cadence: ReportCadence;
  format: ReportFormat;
  recipients: string;
  corporate_id?: string | null;
  range_days: number;
}

export async function createReportSchedule(draft: ScheduleDraft): Promise<{ error?: string }> {
  const recipients = parseRecipients(draft.recipients);
  if (!draft.name.trim()) return { error: "Give the schedule a name" };
  if (recipients.length === 0) return { error: "Add at least one valid recipient email" };
  const { data: auth } = await supabase.auth.getUser();
  const { error } = await db().from("report_export_schedules").insert({
    name: draft.name.trim(),
    report_key: draft.report_key,
    cadence: draft.cadence,
    format: draft.format,
    recipients,
    corporate_id: draft.corporate_id || null,
    range_days: draft.range_days,
    next_run_at: nextRunAt(draft.cadence).toISOString(),
    created_by: auth?.user?.id ?? null,
  });
  return error ? { error: error.message } : {};
}

export async function setScheduleEnabled(id: string, enabled: boolean): Promise<{ error?: string }> {
  const { error } = await db().from("report_export_schedules").update({ enabled }).eq("id", id);
  return error ? { error: error.message } : {};
}

export async function deleteReportSchedule(id: string): Promise<{ error?: string }> {
  const { error } = await db().from("report_export_schedules").delete().eq("id", id);
  return error ? { error: error.message } : {};
}

/** Runs the dispatcher immediately (all due schedules, or just this one). */
export async function runReportDispatcher(scheduleId?: string): Promise<{ error?: string; processed?: number }> {
  const { data, error } = await supabase.functions.invoke("report-export-dispatcher", {
    body: scheduleId ? { schedule_id: scheduleId, force: true } : {},
  });
  if (error) return { error: error.message };
  return { processed: (data as { processed?: number } | null)?.processed ?? 0 };
}
