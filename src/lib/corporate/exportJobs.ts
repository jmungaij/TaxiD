/**
 * Export job history — download links, retries and failure alerting for the
 * scheduled CSV/PDF report deliveries produced by `report-export-dispatcher`.
 */
import { supabase } from "@/integrations/supabase/client";
import { untypedDb } from "@/integrations/supabase/untyped";

const db = () => untypedDb;

export const EXPORT_ARTIFACT_BUCKET = "report-exports";

export interface ExportJob {
  id: string;
  schedule_id: string | null;
  report_key: string;
  format: string;
  recipients: string[];
  range_from: string | null;
  range_to: string | null;
  row_count: number;
  csv_bytes: number;
  artifact_path: string | null;
  artifact_bytes: number;
  content_hash: string | null;
  download_count: number;
  attempt: number;
  max_attempts: number;
  next_retry_at: string | null;
  status: string;
  error: string | null;
  last_error_code: string | null;
  completed_at: string | null;
  created_at: string;
}

export const TERMINAL_STATUSES = ["delivered", "generated", "failed"];

export const isRetryable = (job: Pick<ExportJob, "status" | "attempt" | "max_attempts">): boolean =>
  (job.status === "failed" || job.status === "retry_scheduled") && job.attempt <= job.max_attempts;

/** Human label for a job's lifecycle state. */
export function jobStateLabel(job: Pick<ExportJob, "status" | "attempt" | "max_attempts">): string {
  if (job.status === "retry_scheduled") return `Retry ${job.attempt}/${job.max_attempts} scheduled`;
  if (job.status === "failed") return `Failed after ${job.attempt} attempt${job.attempt === 1 ? "" : "s"}`;
  if (job.status === "delivered") return "Delivered";
  if (job.status === "generated") return "Generated (no recipients)";
  return job.status;
}

export function formatBytes(n: number): string {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export async function loadExportJobs(limit = 100): Promise<ExportJob[]> {
  const { data, error } = await db()
    .from("report_export_runs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as ExportJob[]).map((j) => ({
    ...j,
    recipients: Array.isArray(j.recipients) ? j.recipients.map(String) : [],
  }));
}

/** Signed, time-boxed download URL for a stored artifact. */
export async function artifactDownloadUrl(job: ExportJob): Promise<{ url?: string; error?: string }> {
  if (!job.artifact_path) return { error: "This run has no stored artifact" };
  const { data, error } = await supabase.storage
    .from(EXPORT_ARTIFACT_BUCKET)
    .createSignedUrl(job.artifact_path, 300);
  if (error) return { error: error.message };
  await db()
    .from("report_export_runs")
    .update({ download_count: job.download_count + 1 })
    .eq("id", job.id);
  return { url: data?.signedUrl };
}

/** Re-runs a failed job's schedule immediately. */
export async function retryExportJob(job: ExportJob): Promise<{ error?: string }> {
  if (!job.schedule_id) return { error: "Ad-hoc runs cannot be retried automatically" };
  const { error } = await supabase.functions.invoke("report-export-dispatcher", {
    body: { schedule_id: job.schedule_id, force: true, retry_of: job.id },
  });
  return error ? { error: error.message } : {};
}

/** Processes every run whose backoff window has elapsed. */
export async function runPendingRetries(): Promise<{ error?: string; processed?: number }> {
  const { data, error } = await supabase.functions.invoke("report-export-dispatcher", {
    body: { mode: "retries" },
  });
  if (error) return { error: error.message };
  return { processed: (data as { processed?: number } | null)?.processed ?? 0 };
}
