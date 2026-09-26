/**
 * DRIVER RIDES — a driver's own work, read straight from recorded trips.
 *
 * Nothing here is invented: rides waiting for dispatch come from bookings that
 * no driver holds yet, booked trips are the driver's own bookings, and earnings
 * are the recorded trip value less SAFARID's commission share on the booking.
 */
import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface DriverAvailableRide {
  id: string;
  booking_number: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  passenger_count: number | null;
  intent: string | null;
  status: string;
  currency: string;
  scheduled_for: string | null;
  gross_cents: number;
  net_cents: number;
}

export interface DriverTrip extends DriverAvailableRide {
  payment_status: string | null;
  payment_method: string | null;
  pickup_eta: string | null;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  commission_cents: number;
}

export interface DriverRidesSummary {
  available: number;
  assigned: number;
  in_progress: number;
  completed: number;
  gross_cents: number;
  commission_cents: number;
  net_cents: number;
  upcoming_net_cents: number;
}

export interface DriverRides {
  is_driver: boolean;
  driver?: {
    id: string;
    driver_code: string | null;
    status: string | null;
    driver_type: string | null;
    rating: number | null;
  };
  currency: string;
  commission_bps: number;
  available: DriverAvailableRide[];
  trips: DriverTrip[];
  summary: DriverRidesSummary;
}

export async function loadDriverRides(): Promise<DriverRides> {
  const { data, error } = await db.rpc("driver_rides_self", {});
  if (error) throw new Error(error.message);
  return data as DriverRides;
}

export const rideMoney = (cents: number, currency = "KES") =>
  `${currency === "KES" ? "KSh" : currency} ${(cents / 100).toLocaleString("en-KE", {
    maximumFractionDigits: 0,
  })}`;

export const rideWhen = (v: string | null) =>
  v ? new Date(v).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" }) : "time to confirm";

const OPEN = ["assigned", "scheduled", "pending", "in_progress", "started", "arrived"];
export const isOpenTrip = (t: DriverTrip) => OPEN.includes(t.status);
