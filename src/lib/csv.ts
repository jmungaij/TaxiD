// Minimal CSV exporter — no deps. Quotes values that contain commas, quotes, or newlines.
export function toCsv<T extends object>(rows: T[], columns?: (keyof T)[]): string {
  if (rows.length === 0) return "";
  const cols = (columns ?? (Object.keys(rows[0]) as (keyof T)[])) as string[];
  const head = cols.join(",");
  const body = rows.map((r) => cols.map((c) => escapeCell((r as Record<string, unknown>)[c])).join(",")).join("\n");
  return `${head}\n${body}`;
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  triggerDownload(filename, blob);
}

function escapeCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function triggerDownload(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export interface StreamCsvOptions<T> {
  columns?: (keyof T)[];
  chunkSize?: number;
  /** Called after each successful chunk write, including the header row. */
  onProgress?: (done: number, total: number) => void;
  /** Total retry attempts when the stream errors mid-flight (default 2). */
  maxRetries?: number;
  /** Base backoff between retries in ms (default 200). */
  retryBackoffMs?: number;
  /** Called when a retry is scheduled — useful for surfacing progress in UI. */
  onRetry?: (attempt: number, error: unknown) => void;
  /**
   * Optional injection hook for tests / failure simulation. Called before each
   * chunk is appended; throw to simulate a stream error.
   */
  beforeChunk?: (index: number) => void | Promise<void>;
}

/**
 * Stream a large row set to a CSV download without blocking the main thread.
 *
 * - Chunks rows, encodes each chunk into a Uint8Array, and yields to the event
 *   loop between chunks so the browser stays responsive.
 * - Reports progress via `onProgress` so the UI can render a progress bar.
 * - Retries up to `maxRetries` times when a chunk write throws (transient
 *   encoder / allocator / quota errors), restarting from the beginning so the
 *   produced file is always coherent.
 */
export async function streamDownloadCsv<T extends object>(
  filename: string,
  rows: T[],
  options?: StreamCsvOptions<T>,
): Promise<void> {
  const chunkSize = options?.chunkSize ?? 500;
  const maxRetries = options?.maxRetries ?? 2;
  const backoff = options?.retryBackoffMs ?? 200;
  const encoder = new TextEncoder();

  if (rows.length === 0) {
    triggerDownload(filename, new Blob([""], { type: "text/csv;charset=utf-8;" }));
    return;
  }

  const cols = (options?.columns ?? (Object.keys(rows[0]) as (keyof T)[])) as string[];

  // Each attempt builds the full file from scratch. If a chunk fails, the
  // partial buffer is discarded — a half-streamed CSV is worse than retrying.
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const parts: BlobPart[] = [];
      parts.push(encoder.encode(cols.join(",") + "\n"));
      options?.onProgress?.(0, rows.length);

      for (let i = 0; i < rows.length; i += chunkSize) {
        const idx = i / chunkSize;
        if (options?.beforeChunk) await options.beforeChunk(idx);
        const slice = rows.slice(i, i + chunkSize);
        const text = slice
          .map((r) => cols.map((c) => escapeCell((r as Record<string, unknown>)[c])).join(","))
          .join("\n") + (i + chunkSize < rows.length ? "\n" : "");
        parts.push(encoder.encode(text));
        options?.onProgress?.(Math.min(i + chunkSize, rows.length), rows.length);
        // Yield so the UI stays responsive on large exports.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }

      triggerDownload(filename, new Blob(parts, { type: "text/csv;charset=utf-8;" }));
      return;
    } catch (err) {
      lastError = err;
      if (attempt >= maxRetries) break;
      options?.onRetry?.(attempt + 1, err);
      await new Promise<void>((resolve) => setTimeout(resolve, backoff * (attempt + 1)));
    }
  }
  throw lastError ?? new Error("streamDownloadCsv failed");
}
