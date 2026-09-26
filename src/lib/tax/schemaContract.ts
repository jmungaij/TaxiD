/**
 * Tax reporting schema contract.
 *
 * A single source of truth for the database objects the Tax Command Center
 * depends on. It is used in three places:
 *   1. Runtime preflight — `checkTaxSchema()` calls `tax_report_schema_check()`
 *      before the overview renders, so operators see a precise "migration
 *      missing" message instead of a raw 42703 / 42883 mid-render.
 *   2. Deploy guardrail — `scripts/check-report-migrations.mjs` asserts the
 *      same contract is present in `supabase/migrations` before shipping.
 *   3. Tests — the contract is asserted so drift is caught in CI.
 */
import { supabase } from "@/integrations/supabase/client";
import { classifyTaxError, type TaxLoadFailure } from "@/lib/tax/reportErrors";

export const TAX_SCHEMA_CONTRACT_VERSION = 1;

/** Reporting RPCs the Tax Command Center calls. */
export const REQUIRED_TAX_FUNCTIONS = [
  "tax_report_overview",
  "tax_report_invoices",
  "tax_report_vat_summary",
  "tax_report_sync_health",
  "tax_report_corporate_billing",
  "tax_record_report_sync_run",
  "tax_report_schema_check",
] as const;

/** Columns those RPC bodies read — the exact drift that caused 42703 in production. */
export const REQUIRED_TAX_COLUMNS = [
  "etims_invoices.status",
  "etims_invoices.kra_invoice_number",
  "etims_invoices.tax_total_cents",
  "etims_invoices.total_cents",
  "etims_invoices.issued_at",
  "etims_invoices.last_error",
  "etims_retry_queue.abandoned",
  "etims_retry_queue.attempt",
  "etims_retry_queue.next_retry_at",
  "etims_webhooks.signature_verified",
  "tax_report_sync_runs.request_id",
  "report_schema_alerts.request_id",
] as const;

export interface TaxSchemaReport {
  ok: boolean;
  contractVersion: number;
  checkedAt: string;
  missingFunctions: string[];
  missingColumns: string[];
  /** Set when the preflight itself could not run (permission, network, missing check fn). */
  failure: TaxLoadFailure | null;
}

export const emptySchemaReport = (): TaxSchemaReport => ({
  ok: false,
  contractVersion: TAX_SCHEMA_CONTRACT_VERSION,
  checkedAt: new Date().toISOString(),
  missingFunctions: [],
  missingColumns: [],
  failure: null,
});

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

export function normalizeSchemaReport(raw: unknown): TaxSchemaReport {
  const row = (raw ?? {}) as Record<string, unknown>;
  const missingFunctions = asStringArray(row.missing_functions);
  const missingColumns = asStringArray(row.missing_columns);
  return {
    ok: row.ok === true && missingFunctions.length === 0 && missingColumns.length === 0,
    contractVersion: Number(row.contract_version ?? TAX_SCHEMA_CONTRACT_VERSION),
    checkedAt: typeof row.checked_at === "string" ? row.checked_at : new Date().toISOString(),
    missingFunctions,
    missingColumns,
    failure: null,
  };
}

/** Human summary used by the fallback UI and by alerting. */
export function describeSchemaReport(report: TaxSchemaReport): string {
  if (report.failure) return report.failure.reason;
  const parts: string[] = [];
  if (report.missingFunctions.length) parts.push(`missing functions: ${report.missingFunctions.join(", ")}`);
  if (report.missingColumns.length) parts.push(`missing columns: ${report.missingColumns.join(", ")}`);
  return parts.length ? parts.join(" · ") : "Reporting schema matches the contract.";
}

/** Runs the backend preflight. Never throws. */
export async function checkTaxSchema(): Promise<TaxSchemaReport> {
  try {
    const { data, error } = await supabase.rpc("tax_report_schema_check" as never);
    if (error) {
      const failure = classifyTaxError(error);
      return {
        ...emptySchemaReport(),
        failure:
          failure.kind === "missing_function"
            ? {
                ...failure,
                title: "Reporting schema check is not deployed",
                hint: "The tax_report_schema_check migration has not been applied to this environment. Apply the pending backend migrations, then retry.",
              }
            : failure,
      };
    }
    return normalizeSchemaReport(data);
  } catch (e) {
    return { ...emptySchemaReport(), failure: classifyTaxError(e) };
  }
}
