/**
 * Batch activity controller.
 *
 * UI → controller → `logistics_batch_begin` (authorisation, idempotency,
 * per-item ledger) → bounded-concurrency calls to
 * `logistics_order_set_activity` (authorisation + transition validation +
 * persistence + audit per order) → `logistics_batch_complete` (aggregation).
 *
 * There is no client-side status mutation anywhere in this path: the client
 * only asks; the database decides, persists and audits. Re-running the same
 * batch id never re-applies a succeeded item, so a double click, a refresh or
 * a retry cannot double-update an order.
 */
import { supabase } from "@/integrations/supabase/client";
import { activityErrorCopy, isRetryable } from "./activityModel";

export type BatchItemStatus = "pending" | "succeeded" | "failed";

export interface BatchItemResult {
  orderId: string;
  orderNumber?: string | null;
  status: BatchItemStatus;
  code?: string | null;
  message?: string | null;
  retryable: boolean;
}

export interface BatchProgress {
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  remaining: number;
}

export interface BatchOutcome {
  batchId: string | null;
  correlationId: string;
  replayed: boolean;
  results: BatchItemResult[];
  progress: BatchProgress;
  /** Set when the batch could not even be started (authorisation, validation). */
  fatal?: { code: string; message: string };
}

export interface RunBatchOptions {
  orderIds: string[];
  orderNumbers?: Record<string, string>;
  targetActivity: string;
  reason?: string;
  /** Stable per-attempt key — the same key never applies the work twice. */
  idempotencyKey: string;
  correlationId?: string;
  concurrency?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  onProgress?: (progress: BatchProgress, results: BatchItemResult[]) => void;
}

interface RpcEnvelope {
  ok?: boolean;
  code?: string;
  message?: string;
  batch_id?: string;
  correlation_id?: string;
  replayed?: boolean;
  target_count?: number;
}

export function newCorrelationId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `corr-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | { __timeout: true }> {
  return Promise.race([
    promise,
    new Promise<{ __timeout: true }>((resolve) => setTimeout(() => resolve({ __timeout: true }), ms)),
  ]);
}

export async function runBulkActivityUpdate(opts: RunBatchOptions): Promise<BatchOutcome> {
  const {
    orderIds,
    orderNumbers = {},
    targetActivity,
    reason,
    idempotencyKey,
    concurrency = 4,
    timeoutMs = 20000,
    signal,
    onProgress,
  } = opts;
  const correlationId = opts.correlationId ?? newCorrelationId();

  const results: BatchItemResult[] = orderIds.map((id) => ({
    orderId: id,
    orderNumber: orderNumbers[id] ?? null,
    status: "pending",
    retryable: false,
  }));
  const progress = (): BatchProgress => {
    const succeeded = results.filter((r) => r.status === "succeeded").length;
    const failed = results.filter((r) => r.status === "failed").length;
    return {
      total: results.length,
      processed: succeeded + failed,
      succeeded,
      failed,
      remaining: results.length - succeeded - failed,
    };
  };

  const { data: beginData, error: beginError } = await supabase.rpc("logistics_batch_begin", {
    _operation: "bulk_activity_update",
    _target_activity: targetActivity,
    _order_ids: orderIds,
    _idempotency_key: idempotencyKey,
    _correlation_id: correlationId,
    _reason: reason ?? null,
  });

  const begin = (beginData ?? {}) as RpcEnvelope;
  if (beginError || begin.ok === false) {
    const code = begin.code ?? "PROVIDER_ERROR";
    return {
      batchId: null,
      correlationId,
      replayed: false,
      results,
      progress: progress(),
      fatal: { code, message: begin.message ?? activityErrorCopy(code, beginError?.message) },
    };
  }

  const batchId = begin.batch_id ?? null;

  // Bounded-concurrency worker pool: never an unbounded fan-out.
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      if (signal?.aborted) return;
      const index = cursor++;
      if (index >= results.length) return;
      const item = results[index];
      try {
        type RpcResult = { data: unknown; error: { message: string } | null };
        const raced = await withTimeout<RpcResult>(
          (async (): Promise<RpcResult> => {
            const res = await supabase.rpc("logistics_order_set_activity", {
              _order_id: item.orderId,
              _target_activity: targetActivity,
              _reason: reason ?? null,
              _correlation_id: correlationId,
              _batch_id: batchId,
            });
            return { data: res.data, error: res.error ? { message: res.error.message } : null };
          })(),
          timeoutMs,
        );
        if ("__timeout" in raced) {
          item.status = "failed";
          item.code = "TIMEOUT";
          item.message = activityErrorCopy("TIMEOUT");
          item.retryable = true;
        } else {
          const { data, error } = raced;

          const env = (data ?? {}) as RpcEnvelope & { order_number?: string };
          if (error) {
            item.status = "failed";
            item.code = "PROVIDER_ERROR";
            item.message = activityErrorCopy("PROVIDER_ERROR", error.message);
            item.retryable = true;
          } else if (env.ok) {
            item.status = "succeeded";
            item.code = env.code ?? "UPDATED";
            item.orderNumber = env.order_number ?? item.orderNumber;
            item.message = null;
            item.retryable = false;
          } else {
            item.status = "failed";
            item.code = env.code ?? "PERMANENT_FAILURE";
            item.message = env.message ?? activityErrorCopy(env.code);
            item.retryable = isRetryable(env.code);
          }
        }
      } catch (err) {
        item.status = "failed";
        item.code = "PROVIDER_ERROR";
        item.message = err instanceof Error ? err.message : activityErrorCopy("PROVIDER_ERROR");
        item.retryable = true;
      }
      onProgress?.(progress(), [...results]);
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, 8)) }, worker));

  if (batchId) await supabase.rpc("logistics_batch_complete", { _batch_id: batchId });

  return {
    batchId,
    correlationId,
    replayed: !!begin.replayed,
    results,
    progress: progress(),
  };
}

/** Retry only the failed, retryable rows — succeeded work is never repeated. */
export function retryableFailures(results: readonly BatchItemResult[]): BatchItemResult[] {
  return results.filter((r) => r.status === "failed" && r.retryable);
}

export function permanentFailures(results: readonly BatchItemResult[]): BatchItemResult[] {
  return results.filter((r) => r.status === "failed" && !r.retryable);
}
