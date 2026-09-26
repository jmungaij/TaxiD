import { AlertTriangle } from "lucide-react";

interface DataErrorBannerProps {
  /** Any query error(s); the first truthy one is surfaced. */
  error?: unknown;
  /** What failed to load, e.g. "Trust cases". */
  label?: string;
}

function messageOf(error: unknown): string | null {
  if (!error) return null;
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  const m = (error as { message?: unknown }).message;
  return typeof m === "string" ? m : "Unknown error";
}

/**
 * Operational safety banner: when a privileged console fails to read its data,
 * empty tables and zero counters must never be presented as authoritative.
 */
export function DataErrorBanner({ error, label = "Data" }: DataErrorBannerProps) {
  const message = messageOf(error);
  if (!message) return null;
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>
        {label} failed to load — counters and lists below are <strong>not authoritative</strong>. {message}
      </span>
    </div>
  );
}

export default DataErrorBanner;
