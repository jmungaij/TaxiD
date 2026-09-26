/**
 * Tax report loader with automatic exponential-backoff retry.
 *
 * Behaviour:
 *   • Loads via the caller-supplied fetcher (a `supabase.rpc(...)` call).
 *   • On a retryable failure, reads `tax_report_sync_health` and asks
 *     `planTaxRetry` when to try again — degraded eTIMS sync and a pending
 *     backend retry both stretch the delay.
 *   • The manual Retry button keeps working at all times and resets the curve.
 *   • Every attempt (success or failure) is appended to the immutable
 *     tax_report_sync_runs audit log with its request id and actor.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { classifyTaxError, type TaxLoadFailure } from "@/lib/tax/reportErrors";
import { planTaxRetry, type RetryPlan, type SyncHealthSnapshot } from "@/lib/tax/retryPolicy";
import {
  newTaxRequestId, recordTaxSyncRun, type TaxReportKey, type TaxTriggerSource,
} from "@/lib/tax/syncRunAudit";

export interface UseTaxReportResult<T> {
  data: T | null;
  busy: boolean;
  failure: TaxLoadFailure | null;
  /** Countdown to the next automatic attempt, in seconds (null when idle). */
  retryInSeconds: number | null;
  retryPlan: RetryPlan | null;
  attempt: number;
  requestId: string;
  /** Manual reload — resets the backoff curve. */
  reload: () => Promise<void>;
}

export function useTaxReport<T>(options: {
  report: TaxReportKey;
  from?: string;
  to?: string;
  fetcher: () => PromiseLike<{ data: unknown; error: unknown }>;
  autoRetry?: boolean;
  onFailure?: (failure: TaxLoadFailure) => void;
}): UseTaxReportResult<T> {
  const { report, from, to, fetcher, autoRetry = true, onFailure } = options;

  const [data, setData] = useState<T | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<TaxLoadFailure | null>(null);
  const [retryPlan, setRetryPlan] = useState<RetryPlan | null>(null);
  const [retryInSeconds, setRetryInSeconds] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(1);
  const [requestId, setRequestId] = useState(() => newTaxRequestId(report));

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const failureRef = useRef(onFailure);
  failureRef.current = onFailure;

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);
  const mounted = useRef(true);

  const clearTimers = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (ticker.current) { clearInterval(ticker.current); ticker.current = null; }
    setRetryInSeconds(null);
  }, []);

  useEffect(() => () => { mounted.current = false; if (timer.current) clearTimeout(timer.current); if (ticker.current) clearInterval(ticker.current); }, []);

  const readHealth = useCallback(async (): Promise<SyncHealthSnapshot | null> => {
    if (report === "tax_report_sync_health") return null;
    try {
      const { data: h, error } = await supabase.rpc("tax_report_sync_health", { _from: from ?? null, _to: to ?? null } as never);
      if (error) return null;
      return (h ?? null) as SyncHealthSnapshot | null;
    } catch {
      return null;
    }
  }, [report, from, to]);

  const run = useCallback(async (source: TaxTriggerSource, attemptNo: number, rid: string, backoffMs?: number | null) => {
    clearTimers();
    setBusy(true);
    const started = Date.now();
    let res: { data: unknown; error: unknown };
    try {
      res = await fetcherRef.current();
    } catch (e) {
      res = { data: null, error: e };
    }
    const durationMs = Date.now() - started;
    if (!mounted.current) return;
    setBusy(false);

    if (!res.error) {
      setFailure(null);
      setRetryPlan(null);
      setAttempt(1);
      setData((res.data ?? null) as T | null);
      void recordTaxSyncRun({ requestId: rid, report, triggerSource: source, status: "success", attempt: attemptNo, backoffMs, durationMs, from, to });
      return;
    }

    const classified = classifyTaxError(res.error);
    setFailure(classified);
    failureRef.current?.(classified);
    void recordTaxSyncRun({
      requestId: rid, report, triggerSource: source, status: "failed",
      attempt: attemptNo, backoffMs, durationMs, from, to, failure: classified,
    });

    if (!autoRetry) { setRetryPlan(null); return; }

    const health = await readHealth();
    if (!mounted.current) return;
    const plan = planTaxRetry({ failure: classified, attempt: attemptNo + 1, health, jitter: Math.random() });
    setRetryPlan(plan);
    if (!plan.retry) return;

    setAttempt(plan.attempt);
    setRetryInSeconds(Math.ceil(plan.delayMs / 1000));
    ticker.current = setInterval(() => {
      setRetryInSeconds((s) => (s == null ? null : Math.max(0, s - 1)));
    }, 1000);
    timer.current = setTimeout(() => { void run("auto_retry", plan.attempt, rid, plan.delayMs); }, plan.delayMs);
  }, [autoRetry, clearTimers, from, readHealth, report, to]);

  const reload = useCallback(async () => {
    const rid = newTaxRequestId(report);
    setRequestId(rid);
    setAttempt(1);
    setRetryPlan(null);
    await run("manual_retry", 1, rid);
  }, [report, run]);

  useEffect(() => {
    const rid = newTaxRequestId(report);
    setRequestId(rid);
    void run("initial_load", 1, rid);
    return clearTimers;
    // Intentionally mount-only: window changes are applied via the Refresh button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { data, busy, failure, retryInSeconds, retryPlan, attempt, requestId, reload };
}
