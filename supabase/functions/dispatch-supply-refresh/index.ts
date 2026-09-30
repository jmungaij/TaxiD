// dispatch-supply-refresh: rebuild dispatch_supply_cells from driver_locations
// and recent dispatch_requests. Designed to run on a 1-minute cron.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { requireInternalOrStaff } from "../_shared/internal-auth.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Coarse cell key: round lat/lng to 2 decimals (~1.1km).
export function cellKey(lat: number, lng: number): string {
  return `${lat.toFixed(2)}:${lng.toFixed(2)}`;
}
export function cellCenter(key: string): { lat: number; lng: number } {
  const [a, b] = key.split(":");
  return { lat: Number(a), lng: Number(b) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Privileged worker: cron/service-role callers, or an admin "run now" button.
  try {
    await requireInternalOrStaff(req, ["admin", "super_admin"]);
  } catch (guardError) {
    const status = (guardError as { status?: number }).status ?? 401;
    return new Response(JSON.stringify({ error: (guardError as Error).message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: drivers } = await supabase
    .from("driver_locations")
    .select("lat,lng,is_online,is_available")
    .eq("is_online", true);

  const supplyMap = new Map<string, { online: number; available: number }>();
  for (const d of drivers ?? []) {
    const key = cellKey((d as any).lat, (d as any).lng);
    const cur = supplyMap.get(key) ?? { online: 0, available: 0 };
    cur.online++;
    if ((d as any).is_available) cur.available++;
    supplyMap.set(key, cur);
  }

  const since5 = new Date(Date.now() - 5 * 60_000).toISOString();
  const since1 = new Date(Date.now() - 60_000).toISOString();
  const since15 = new Date(Date.now() - 15 * 60_000).toISOString();
  const { data: reqs } = await supabase
    .from("dispatch_requests")
    .select("pickup_lat,pickup_lng,requested_at")
    .gte("requested_at", since15);

  const dmap = new Map<string, { d1: number; d5: number; d15: number }>();
  for (const r of reqs ?? []) {
    const key = cellKey((r as any).pickup_lat, (r as any).pickup_lng);
    const cur = dmap.get(key) ?? { d1: 0, d5: 0, d15: 0 };
    cur.d15++;
    if ((r as any).requested_at >= since5) cur.d5++;
    if ((r as any).requested_at >= since1) cur.d1++;
    dmap.set(key, cur);
  }

  const allKeys = new Set([...supplyMap.keys(), ...dmap.keys()]);
  let upserts = 0;
  for (const key of allKeys) {
    const s = supplyMap.get(key) ?? { online: 0, available: 0 };
    const d = dmap.get(key) ?? { d1: 0, d5: 0, d15: 0 };
    const { lat, lng } = cellCenter(key);
    await supabase.from("dispatch_supply_cells").upsert(
      {
        cell_key: key,
        center_lat: lat,
        center_lng: lng,
        online_drivers: s.online,
        available_drivers: s.available,
        demand_1m: d.d1,
        demand_5m: d.d5,
        demand_15m: d.d15,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "cell_key" },
    );
    upserts++;
  }

  return new Response(JSON.stringify({ ok: true, cells: upserts }), {
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
});
