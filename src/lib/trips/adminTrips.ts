/**
 * ADMIN TRIP READS — real booking records only.
 *
 * Every figure here comes from `trip_bookings` and its own child records
 * (status history, route stops). Nothing is generated: if a trip has no
 * timeline or no stops recorded, the caller is told so rather than shown a
 * plausible-looking one. `total_fare` is the canonical fare field — no other
 * fare alias is read (see src/lib/workspace360/dataContract.ts).
 */
import { supabase } from "@/integrations/supabase/client";

export interface AdminTripRow {
  id: string;
  booking_number: string | null;
  status: string;
  pickup_address: string | null;
  dropoff_address: string | null;
  passenger_count: number | null;
  intent: string | null;
  total_fare: number | null;
  currency: string | null;
  payment_status: string | null;
  payment_method: string | null;
  rider_user_id: string | null;
  driver_id: string | null;
  scheduled_for: string | null;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
}

export interface AdminTripDetail extends AdminTripRow {
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  surge_multiplier: number | null;
  commission_cents: number | null;
  payment_provider: string | null;
  payment_reference: string | null;
  paid_at: string | null;
  pickup_eta: string | null;
  cancellation_reason: string | null;
  cancelled_by: string | null;
  vehicle_id: string | null;
  updated_at: string | null;
}

export interface TripStatusEvent {
  id: string;
  from_status: string | null;
  to_status: string;
  reason: string | null;
  created_at: string;
}

export interface TripWaypoint {
  id: string;
  seq: number;
  address: string | null;
  arrived_at: string | null;
  departed_at: string | null;
}

const LIST_COLUMNS =
  "id,booking_number,status,pickup_address,dropoff_address,passenger_count,intent," +
  "total_fare,currency,payment_status,payment_method,rider_user_id,driver_id," +
  "scheduled_for,started_at,completed_at,cancelled_at,created_at";

/** Most recent real bookings, newest first. */
export async function listTrips(limit = 200): Promise<AdminTripRow[]> {
  const { data, error } = await supabase
    .from("trip_bookings")
    .select(LIST_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as AdminTripRow[];
}

export async function getTrip(tripId: string): Promise<AdminTripDetail | null> {
  const { data, error } = await supabase
    .from("trip_bookings")
    .select(
      LIST_COLUMNS +
        ",pickup_lat,pickup_lng,dropoff_lat,dropoff_lng,surge_multiplier,commission_cents," +
        "payment_provider,payment_reference,paid_at,pickup_eta,cancellation_reason,cancelled_by," +
        "vehicle_id,updated_at",
    )
    .eq("id", tripId)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as AdminTripDetail) ?? null;
}

export async function tripTimeline(tripId: string): Promise<TripStatusEvent[]> {
  const { data, error } = await supabase
    .from("trip_status_history")
    .select("id,from_status,to_status,reason,created_at")
    .eq("trip_booking_id", tripId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as TripStatusEvent[];
}

export async function tripWaypoints(tripId: string): Promise<TripWaypoint[]> {
  const { data, error } = await supabase
    .from("trip_waypoints")
    .select("id,seq,address,arrived_at,departed_at")
    .eq("trip_booking_id", tripId)
    .order("seq", { ascending: true });
  if (error) throw error;
  return (data ?? []) as TripWaypoint[];
}

export function formatMoney(amount: number | null, currency: string | null): string {
  if (amount === null || amount === undefined) return "NOT RECORDED";
  return `${currency || "KES"} ${Number(amount).toLocaleString("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatWhen(value: string | null | undefined): string {
  if (!value) return "NOT RECORDED";
  return new Date(value).toLocaleString("en-KE", { timeZone: "Africa/Nairobi" });
}
