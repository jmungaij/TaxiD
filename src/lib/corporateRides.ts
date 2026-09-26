/**
 * Corporate ride requests — the single client entry point into the
 * policy → approval → dispatch pipeline.
 *
 * Both calls are thin wrappers over SECURITY DEFINER database routines that
 * re-check organisation membership, evaluate the spending policy and write the
 * audit trail server-side. The client never decides the outcome.
 */
import { supabase } from "@/integrations/supabase/client";

export type RideRequestDecision = "allow" | "requires_approval" | "block";

export interface RideRequestResult {
  decision: RideRequestDecision;
  reason: string;
  approval_id?: string | null;
  booking_id?: string | null;
  booking_number?: string | null;
  policy_id?: string | null;
  rule_id?: string | null;
}

export interface RideRequestInput {
  corporateId: string;
  employeeId: string;
  rideType: string;
  pickupAddress: string;
  dropoffAddress: string;
  fareCents: number;
  scheduledFor?: string | null;
  passengerCount?: number;
  departmentId?: string | null;
  costCenterCode?: string | null;
  purpose?: string | null;
  distanceKm?: number | null;
  rideTypeId?: string | null;
}

export async function requestCorporateRide(input: RideRequestInput): Promise<RideRequestResult> {
  const { data, error } = await supabase.rpc("request_corporate_ride", {
    _corporate_id: input.corporateId,
    _employee_id: input.employeeId,
    _ride_type: input.rideType,
    _pickup_address: input.pickupAddress,
    _dropoff_address: input.dropoffAddress,
    _fare_cents: input.fareCents,
    _scheduled_for: input.scheduledFor ?? null,
    _passenger_count: input.passengerCount ?? 1,
    _department_id: input.departmentId ?? null,
    _cost_center_code: input.costCenterCode ?? null,
    _purpose: input.purpose ?? null,
    _distance_km: input.distanceKm ?? null,
    _ride_type_id: input.rideTypeId ?? null,
  });
  if (error) throw error;
  return data as unknown as RideRequestResult;
}

export interface RideDecisionResult {
  status: "approved" | "rejected" | "expired";
  booking_id?: string | null;
  booking_number?: string | null;
  reason?: string | null;
}

export async function decideCorporateRideRequest(
  approvalId: string,
  decision: "approved" | "rejected",
  note?: string,
): Promise<RideDecisionResult> {
  const { data, error } = await supabase.rpc("decide_corporate_ride_request", {
    _approval_id: approvalId,
    _decision: decision,
    _note: note ?? null,
  });
  if (error) throw error;
  return data as unknown as RideDecisionResult;
}
