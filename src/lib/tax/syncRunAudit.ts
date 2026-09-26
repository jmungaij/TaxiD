/**
 * Immutable audit log client for tax report sync runs.
 *
 * Every load, automatic backoff retry and manual retry of a tax report is
 * appended through `tax_record_report_sync_run`, which stamps the actor
 * server-side (the browser cannot spoof `triggered_by`). Rows can never be
 * updated or deleted.
 */
import { supabase } from "@/integrations/supabase/client";
import type { TaxLoadFailure } from "@/lib/tax/reportErrors";

export type TaxReportKey =
  | "tax_report_overview"
  | "tax_report_invoices"
  | "tax_report_vat_summary"
  | "tax_report_corporate_billing"
  | "tax_report_sync_health";

export type TaxTriggerSource = "initial_load" | "auto_retry" | "manual_retry" | "retry_job" | "scheduled";

export interface TaxSyncRunInput {
  requestId: string;
  report: TaxReportKey;
  triggerSource: TaxTriggerSource;
  status: "success" | "failed";
  attempt?: number;
  backoffMs?: number | null;
  durationMs?: number | null;
  from?: string | null;
  to?: string | null;
  failure?: TaxLoadFailure | null;
}

export interface TaxSyncRun {
  id: string;
  request_id: string;
  report: string;
  trigger_source: string;
  attempt: number;
  backoff_ms: number | null;
  duration_ms: number | null;
  status: string;
  window_from: string | null;
  window_to: string | null;
  last_error: Record<string, unknown> | null;
  triggered_by: string | null;
  triggered_by_email: string | null;
  created_at: string;
}

/** Correlation id shared by a load and all of its retries. */
export function newTaxRequestId(report: TaxReportKey, now = Date.now()): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${report}:${now.toString(36)}:${rand}`;
}

/** Serialises the classified failure into the audit `last_error` payload. */
export function lastErrorPayload(failure?: TaxLoadFailure | null, extra?: Record<string, unknown>) {
  if (!failure) return null;
  return {
    kind: failure.kind,
    code: failure.code ?? null,
    title: failure.title,
    reason: failure.reason,
    hint: failure.hint,
    retryable: failure.retryable,
    ...(extra ?? {}),
  };
}

/** Appends one run. Never throws — auditing must not break report loading. */
export async function recordTaxSyncRun(input: TaxSyncRunInput): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc("tax_record_report_sync_run", {
      _request_id: input.requestId,
      _report: input.report,
      _trigger_source: input.triggerSource,
      _status: input.status,
      _attempt: Math.max(1, Math.floor(input.attempt ?? 1)),
      _backoff_ms: input.backoffMs ?? null,
      _duration_ms: input.durationMs ?? null,
      _window_from: input.from ?? null,
      _window_to: input.to ?? null,
      _last_error: lastErrorPayload(input.failure) as never,
    });
    if (error) {
      console.warn("[tax-audit] failed to record sync run", error.message);
      return null;
    }
    return (data as string) ?? null;
  } catch (e) {
    console.warn("[tax-audit] sync run audit unavailable", e);
    return null;
  }
}

export async function fetchTaxSyncRuns(report?: TaxReportKey, limit = 50): Promise<TaxSyncRun[]> {
  const { data, error } = await supabase.rpc("tax_report_sync_run_history", {
    _report: report ?? null,
    _limit: limit,
  });
  if (error) throw error;
  return (data as unknown as TaxSyncRun[]) ?? [];
}
