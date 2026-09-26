import { supabase } from "@/integrations/supabase/client";
import type {
  DispatchCandidate,
  DispatchEngineRun,
  DispatchRequestInput,
  SupplyCell,
  SurgeZone,
} from "./types";

/**
 * Create a dispatch request and immediately invoke the engine.
 */
export async function requestDispatch(
  input: DispatchRequestInput,
): Promise<{ requestId: string; run: DispatchEngineRun | null }> {
  const { data: req, error } = await supabase
    .from("dispatch_requests")
    .insert({
      rider_id: input.rider_id,
      corporate_id: input.corporate_id,
      pickup_lat: input.pickup_lat,
      pickup_lng: input.pickup_lng,
      pickup_address: input.pickup_address,
      dropoff_lat: input.dropoff_lat,
      dropoff_lng: input.dropoff_lng,
      dropoff_address: input.dropoff_address,
      vehicle_category: input.vehicle_category,
      estimated_fare_cents: input.estimated_fare_cents,
      currency: input.currency ?? "KES",
    })
    .select("id")
    .single();
  if (error || !req) throw error ?? new Error("failed to create request");

  const { data: invoke, error: invokeErr } = await supabase.functions.invoke(
    "dispatch-engine",
    { body: { request_id: req.id } },
  );
  if (invokeErr) throw invokeErr;
  return { requestId: req.id, run: (invoke?.run ?? null) as DispatchEngineRun | null };
}

export async function respondToOffer(
  candidateId: string,
  accept: boolean,
  reason?: string,
): Promise<void> {
  const { error } = await supabase
    .from("dispatch_candidates")
    .update({
      status: accept ? "ACCEPTED" : "REJECTED",
      responded_at: new Date().toISOString(),
      reason: reason ?? null,
    })
    .eq("id", candidateId);
  if (error) throw error;
}

export function subscribeToOffers(
  driverId: string,
  onOffer: (c: DispatchCandidate) => void,
) {
  const channel = supabase
    .channel(`dispatch:driver:${driverId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "dispatch_candidates",
        filter: `driver_id=eq.${driverId}` },
      (payload) => onOffer(payload.new as DispatchCandidate),
    )
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}

export async function getSupplyHeatmap(): Promise<SupplyCell[]> {
  const { data, error } = await supabase
    .from("dispatch_supply_cells")
    .select(
      "cell_key,center_lat,center_lng,online_drivers,available_drivers,demand_1m,demand_5m,demand_15m,updated_at",
    )
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as SupplyCell[];
}

export async function getSurgeZones(): Promise<SurgeZone[]> {
  const { data, error } = await supabase
    .from("dispatch_surge_zones")
    .select("*")
    .eq("active", true)
    .order("valid_from", { ascending: false });
  if (error) throw error;
  return (data ?? []) as SurgeZone[];
}

export async function getEngineRun(
  runId: string,
): Promise<DispatchEngineRun | null> {
  const { data, error } = await supabase
    .from("dispatch_engine_runs")
    .select("*")
    .eq("id", runId)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as DispatchEngineRun | null;
}

// ---------------- Phase 3: approval workflow ----------------

/** Propose a surge override that requires approval before going live. */
export async function requestSurgeOverride(input: {
  cell_key: string;
  multiplier: number;
  reason: string;
  proposed_by?: string;
}): Promise<{ zone_id: string }> {
  const { data, error } = await supabase
    .from("dispatch_surge_zones")
    .insert({
      cell_key: input.cell_key,
      multiplier: input.multiplier,
      reason: `[PENDING] ${input.reason}${input.proposed_by ? ` (by ${input.proposed_by})` : ""}`,
      source: "manual",
      active: false,
    })
    .select("id").single();
  if (error || !data) throw error ?? new Error("failed to propose override");
  return { zone_id: data.id as string };
}

/** Fetch pending surge override proposals awaiting approval. */
export async function getPendingSurgeApprovals(): Promise<SurgeZone[]> {
  const { data, error } = await supabase
    .from("dispatch_surge_zones")
    .select("*")
    .eq("active", false)
    .ilike("reason", "[PENDING]%")
    .order("valid_from", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as SurgeZone[];
}

export async function decideSurgeApproval(
  zoneId: string,
  action: "approve" | "reject",
  note?: string,
): Promise<void> {
  const { error } = await supabase.functions.invoke("dispatch-approval-apply", {
    body: { zone_id: zoneId, action, note },
  });
  if (error) throw error;
}

/** Heatmap drilldown: per-cell context. */
export async function getCellDrilldown(cellKey: string) {
  const [signals, surgeHistory, drivers, requests] = await Promise.all([
    supabase.from("dispatch_demand_signals")
      .select("*").eq("cell_key", cellKey)
      .order("created_at", { ascending: false }).limit(30),
    supabase.from("dispatch_surge_zones")
      .select("*").eq("cell_key", cellKey)
      .order("valid_from", { ascending: false }).limit(20),
    supabase.from("driver_locations")
      .select("driver_id,lat,lng,is_online,is_available,updated_at,vehicle_id")
      .eq("is_online", true).limit(50),
    supabase.from("dispatch_requests")
      .select("id,pickup_lat,pickup_lng,status,surge_multiplier,requested_at,assigned_driver_id,vehicle_category")
      .order("requested_at", { ascending: false }).limit(20),
  ]);
  return {
    signals: signals.data ?? [],
    surgeHistory: surgeHistory.data ?? [],
    drivers: drivers.data ?? [],
    requests: requests.data ?? [],
  };
}
