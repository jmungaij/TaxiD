/**
 * Enterprise export auditing.
 *
 * Every admin "Download / Export" action MUST route through `auditedExport()`.
 * It records:
 *   • actor (user id + email)
 *   • dataset (logical name, e.g. "payments.mpesa")
 *   • export_type (pdf | csv | json | xlsx | zip)
 *   • row_count + byte_size
 *   • client IP (best-effort via window) and user_agent
 *   • applied filters
 *   • status (success | failed | partial)
 *
 * It also emits the AnalyticsEvents.ADMIN_EXPORT_DOWNLOAD CTA event so the
 * unified analytics warehouse stays in sync.
 *
 * Failures inside the audit pipeline NEVER block the export — the user still
 * gets their file. Errors are logged for the NOC to chase.
 */
import { supabase } from "@/integrations/supabase/client";
import { trackCta } from "@/lib/cta";
import { AnalyticsEvents } from "@/lib/analyticsEvents";

export type ExportType = "pdf" | "csv" | "json" | "xlsx" | "zip";

export interface ExportAuditInput {
  dataset: string;
  exportType: ExportType;
  rowCount?: number;
  byteSize?: number;
  filters?: Record<string, unknown>;
  status?: "success" | "failed" | "partial";
  error?: string;
}

let cachedIp: string | null = null;
async function getClientIp(): Promise<string | null> {
  if (cachedIp) return cachedIp;
  try {
    // Best-effort: do not block exports. 800ms ceiling.
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 800);
    const r = await fetch("https://api.ipify.org?format=json", { signal: ctl.signal });
    clearTimeout(t);
    const j = await r.json();
    cachedIp = (j?.ip as string) ?? null;
    return cachedIp;
  } catch {
    return null;
  }
}

export async function logExportAudit(input: ExportAuditInput): Promise<void> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const user = auth?.user;
    const ip = await getClientIp();
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : null;

    // Fire analytics in parallel — non-blocking.
    void trackCta({
      buttonName: AnalyticsEvents.ADMIN_EXPORT_DOWNLOAD,
      actionType: "submit",
      target: input.dataset,
      metadata: {
        export_type: input.exportType,
        row_count: input.rowCount,
        byte_size: input.byteSize,
        status: input.status ?? "success",
        ...input.filters,
      },
    });

    await supabase.from("export_audit_log").insert({
      actor_id: user?.id ?? null,
      actor_email: user?.email ?? null,
      dataset: input.dataset,
      export_type: input.exportType,
      row_count: input.rowCount ?? null,
      byte_size: input.byteSize ?? null,
      ip_address: ip,
      user_agent: ua,
      filters: (input.filters ?? {}) as never,
      status: input.status ?? "success",
      error: input.error ?? null,
    });
  } catch (err) {
    console.warn("[exportAudit] failed to record", err);
  }
}

/**
 * Wrap an export producer. Calls `producer()`, then logs the audit row with
 * the resulting byte size. Use this for any sync/async export.
 *
 * @example
 *   await auditedExport(
 *     { dataset: "payments.mpesa", exportType: "csv", rowCount: rows.length, filters: { status } },
 *     () => downloadCsv("payments.csv", csvText)
 *   );
 */
export async function auditedExport<T>(
  meta: Omit<ExportAuditInput, "status" | "error" | "byteSize"> & { byteSize?: number },
  producer: () => T | Promise<T>,
): Promise<T> {
  try {
    const result = await producer();
    let bytes = meta.byteSize;
    if (bytes == null) {
      if (typeof result === "string") bytes = new Blob([result]).size;
      else if (result instanceof Blob) bytes = result.size;
    }
    await logExportAudit({ ...meta, byteSize: bytes, status: "success" });
    return result;
  } catch (e) {
    await logExportAudit({ ...meta, status: "failed", error: e?.message ?? String(e) });
    throw e;
  }
}
