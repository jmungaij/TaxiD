/**
 * Production alerting for reporting schema drift.
 *
 * Any `missing_function` / `missing_column` (42883 / 42703 / PGRST202) failure in
 * a tax report is captured with its request id so triage does not depend on a
 * user screenshotting the UI. Two sinks:
 *   • structured console log (picked up by the browser log pipeline), and
 *   • the immutable `report_schema_alerts` table for operator dashboards.
 *
 * Alerts are de-duplicated per request id + report so a backoff storm does not
 * flood the sink.
 */
import { supabase } from "@/integrations/supabase/client";
import { isSchemaDrift, type TaxLoadFailure } from "@/lib/tax/reportErrors";
import type { TaxSchemaReport } from "@/lib/tax/schemaContract";

export interface SchemaAlertInput {
  requestId: string;
  report: string;
  failure: TaxLoadFailure;
  missing?: Pick<TaxSchemaReport, "missingFunctions" | "missingColumns"> | null;
  route?: string;
}

const seen = new Set<string>();

/** Exposed for tests. */
export function resetSchemaAlertDedupe(): void {
  seen.clear();
}

export function shouldAlert(failure: TaxLoadFailure): boolean {
  return isSchemaDrift(failure.kind);
}

export async function captureSchemaAlert(input: SchemaAlertInput): Promise<boolean> {
  const { requestId, report, failure, missing, route } = input;
  if (!shouldAlert(failure)) return false;

  const key = `${report}:${requestId}:${failure.code ?? failure.kind}`;
  if (seen.has(key)) return false;
  seen.add(key);

  const payload = {
    request_id: requestId,
    report,
    error_kind: failure.kind,
    error_code: failure.code ?? null,
    message: failure.reason,
    missing: {
      missing_functions: missing?.missingFunctions ?? [],
      missing_columns: missing?.missingColumns ?? [],
    },
    route: route ?? (typeof window !== "undefined" ? window.location.pathname : null),
  };

  // Structured log first — it survives even if the insert is blocked.
  console.error("[tax.schema_drift]", JSON.stringify(payload));

  try {
    const { data: session } = await supabase.auth.getUser();
    await supabase.from("report_schema_alerts" as never).insert({
      ...payload,
      actor_id: session?.user?.id ?? null,
      actor_email: session?.user?.email ?? null,
    } as never);
  } catch (e) {
    console.error("[tax.schema_drift] alert sink unavailable", (e as Error)?.message);
  }
  return true;
}
