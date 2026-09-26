/**
 * Live operational metrics for the delivery control tower.
 *
 * Reads the real Cloud tables (`delivery_orders`, `delivery_dispatch_jobs`) for
 * the current operating day, then keeps them fresh through Supabase Realtime
 * plus a slow safety poll. When the signed-in role can see no rows (public
 * marketing visitor, or an empty operating day) the tower transparently falls
 * back to the deterministic digital-twin model and labels itself "modelled" —
 * it never silently presents modelled numbers as live telemetry.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { DeliveryModule } from "@/components/delivery/ModuleShell";
import { controlTowerKpis, type ControlTowerKpi } from "./controlTower";

const POLL_MS = 30_000;

const ACTIVE_STATUSES = ["assigned", "dispatched", "picked_up", "in_transit", "out_for_delivery", "at_hub"];
const AWAITING_STATUSES = ["created", "pending", "accepted", "awaiting_dispatch", "queued", "scheduled"];
const DELIVERED_STATUSES = ["delivered", "completed", "closed"];
const FAILED_STATUSES = ["failed", "cancelled", "canceled", "returned", "rejected"];

export type LiveOpsStatus = "loading" | "live" | "modelled" | "error";

export interface LiveOpsMetrics {
  activeDeliveries: number;
  awaitingDispatch: number;
  delivered: number;
  failed: number;
  onTimePct: number | null;
  slaCompliancePct: number | null;
  successPct: number | null;
  revenueTodayKes: number;
  openJobs: number;
  breachedJobs: number;
  /** Number of order rows the current role could actually read. */
  sampleSize: number;
}

export interface LiveOpsState {
  status: LiveOpsStatus;
  metrics: LiveOpsMetrics | null;
  /** Previous poll's metrics — used to compute real deltas. */
  previous: LiveOpsMetrics | null;
  updatedAt: Date | null;
  error: string | null;
  refresh: () => void;
}

interface OrderRow {
  status: string | null;
  total_amount: number | null;
  sla_deadline: string | null;
  updated_at: string | null;
  created_at: string | null;
}

interface JobRow {
  status: string | null;
  sla_deadline: string | null;
}

function startOfOperatingDay(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function bucket(status: string | null): "active" | "awaiting" | "delivered" | "failed" | "other" {
  const s = (status ?? "").toLowerCase();
  if (ACTIVE_STATUSES.includes(s)) return "active";
  if (AWAITING_STATUSES.includes(s)) return "awaiting";
  if (DELIVERED_STATUSES.includes(s)) return "delivered";
  if (FAILED_STATUSES.includes(s)) return "failed";
  return "other";
}

const pct1 = (n: number) => Math.round(n * 10) / 10;

export function aggregateLiveOps(orders: OrderRow[], jobs: JobRow[]): LiveOpsMetrics {
  let active = 0;
  let awaiting = 0;
  let delivered = 0;
  let failed = 0;
  let onTime = 0;
  let deliveredWithSla = 0;
  let revenue = 0;

  for (const o of orders) {
    const b = bucket(o.status);
    if (b === "active") active += 1;
    if (b === "awaiting") awaiting += 1;
    if (b === "failed") failed += 1;
    if (b === "delivered") {
      delivered += 1;
      if (o.sla_deadline && o.updated_at) {
        deliveredWithSla += 1;
        if (new Date(o.updated_at).getTime() <= new Date(o.sla_deadline).getTime()) onTime += 1;
      }
    }
    if (b !== "failed") revenue += Number(o.total_amount ?? 0);
  }

  const now = Date.now();
  const openJobs = jobs.filter((j) => !DELIVERED_STATUSES.includes((j.status ?? "").toLowerCase())).length;
  const breachedJobs = jobs.filter(
    (j) =>
      j.sla_deadline &&
      new Date(j.sla_deadline).getTime() < now &&
      !DELIVERED_STATUSES.includes((j.status ?? "").toLowerCase()),
  ).length;

  const handled = delivered + failed;
  const onTimePct = deliveredWithSla > 0 ? pct1((onTime / deliveredWithSla) * 100) : null;
  const slaCompliancePct =
    openJobs > 0 ? pct1(((openJobs - breachedJobs) / openJobs) * 100) : onTimePct;

  return {
    activeDeliveries: active,
    awaitingDispatch: awaiting,
    delivered,
    failed,
    onTimePct,
    slaCompliancePct,
    successPct: handled > 0 ? pct1((delivered / handled) * 100) : null,
    revenueTodayKes: Math.round(revenue),
    openJobs,
    breachedJobs,
    sampleSize: orders.length,
  };
}

/* --------------------------------------------------------------- the hook */

export function useLiveOps(module: DeliveryModule): LiveOpsState {
  const [status, setStatus] = useState<LiveOpsStatus>("loading");
  const [metrics, setMetrics] = useState<LiveOpsMetrics | null>(null);
  const [previous, setPrevious] = useState<LiveOpsMetrics | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const latest = useRef<LiveOpsMetrics | null>(null);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const since = startOfOperatingDay();
      const [ordersRes, jobsRes] = await Promise.all([
        supabase
          .from("delivery_orders")
          .select("status,total_amount,sla_deadline,updated_at,created_at")
          .eq("module", module)
          .gte("created_at", since)
          .limit(2000),
        supabase
          .from("delivery_dispatch_jobs")
          .select("status,sla_deadline")
          .eq("module", module)
          .gte("created_at", since)
          .limit(2000),
      ]);

      if (cancelled) return;

      const failure = ordersRes.error ?? jobsRes.error;
      if (failure) {
        // Permission or connectivity failure: keep the modelled view usable and
        // surface the real upstream reason instead of a blank dashboard.
        setError(failure.message);
        setStatus("modelled");
        setUpdatedAt(new Date());
        return;
      }

      const next = aggregateLiveOps(ordersRes.data ?? [], jobsRes.data ?? []);
      setError(null);
      if (next.sampleSize === 0) {
        setMetrics(null);
        setStatus("modelled");
      } else {
        setPrevious(latest.current);
        latest.current = next;
        setMetrics(next);
        setStatus("live");
      }
      setUpdatedAt(new Date());
    };

    void load();
    const poll = window.setInterval(() => void load(), POLL_MS);

    const channel = supabase
      .channel(`control-tower-${module}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "delivery_orders" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "delivery_dispatch_jobs" }, () => void load())
      .subscribe();

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [module, nonce]);

  return { status, metrics, previous, updatedAt, error, refresh };
}

/* -------------------------------------------------- KPI reconciliation */

function deltaPct(current: number, prev: number | undefined | null): number | null {
  if (prev === undefined || prev === null || prev === 0) return null;
  return Math.round(((current - prev) / prev) * 1000) / 10;
}

/**
 * Overlays live telemetry onto the modelled KPI set. Metrics with real
 * observations are replaced (and marked `live`); everything else keeps the
 * digital-twin projection so the strip stays complete.
 */
export function reconcileKpis(
  module: DeliveryModule,
  live: LiveOpsMetrics | null,
  previous: LiveOpsMetrics | null,
): ControlTowerKpi[] {
  const base = controlTowerKpis(module);
  if (!live) return base;

  const overrides: Record<string, { value: number; prev?: number | null }> = {
    active: { value: live.activeDeliveries, prev: previous?.activeDeliveries },
    awaiting: { value: live.awaitingDispatch, prev: previous?.awaitingDispatch },
    revenue: { value: live.revenueTodayKes, prev: previous?.revenueTodayKes },
    failed: { value: live.failed, prev: previous?.failed },
  };
  if (live.slaCompliancePct !== null) overrides.sla = { value: live.slaCompliancePct, prev: previous?.slaCompliancePct };
  if (live.onTimePct !== null) overrides.ontime = { value: live.onTimePct, prev: previous?.onTimePct };
  if (live.successPct !== null) overrides.success = { value: live.successPct, prev: previous?.successPct };

  return base.map((kpi) => {
    const o = overrides[kpi.key];
    if (!o) return kpi;
    const delta = deltaPct(o.value, o.prev);
    return {
      ...kpi,
      value: o.value,
      delta: delta ?? 0,
      source: "live" as const,
      hint: `${kpi.hint} · live from ${live.sampleSize} order records today`,
    };
  });
}

export function useControlTowerKpis(module: DeliveryModule) {
  const liveOps = useLiveOps(module);
  const kpis = useMemo(
    () => reconcileKpis(module, liveOps.metrics, liveOps.previous),
    [module, liveOps.metrics, liveOps.previous],
  );
  return { kpis, liveOps };
}
