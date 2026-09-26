/**
 * FLEET OWNER (CARRIER) APPLICATIONS — client API.
 *
 * Intake, status lookup and staff decisions all run through the authoritative
 * database functions. This module validates nothing that the database does not
 * also validate, and it never decides an outcome.
 */
import { supabase } from "@/integrations/supabase/client";

export type CarrierApplicationStatus =
  | "SUBMITTED" | "UNDER_REVIEW" | "INFO_REQUESTED" | "APPROVED" | "REJECTED" | "WITHDRAWN";

export interface CarrierApplicationRow {
  id: string;
  application_reference: string;
  status: CarrierApplicationStatus;
  legal_entity_name: string;
  trading_name: string | null;
  registration_number: string | null;
  tax_identifier: string | null;
  country: string;
  county: string | null;
  town: string | null;
  contact_name: string;
  contact_position: string | null;
  contact_email: string;
  contact_phone: string;
  fleet_size: number | null;
  vehicle_types: string[];
  service_categories: string[];
  corridors: string[];
  notes: string | null;
  review_notes: string | null;
  reviewed_at: string | null;
  decided_at: string | null;
  partner_id: string | null;
  carrier_id: string | null;
  created_at: string;
}

export interface CarrierApplicationEventRow {
  id: string;
  application_id: string;
  action: string;
  status_from: string | null;
  status_to: string | null;
  note: string | null;
  created_at: string;
}

export interface Outcome {
  ok?: boolean;
  error?: boolean;
  code?: string;
  message?: string;
  [k: string]: unknown;
}

async function rpc<T = Outcome>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) return { error: true, code: "RPC_FAILED", message: error.message } as T;
  return (data ?? { error: true, code: "EMPTY_RESPONSE" }) as T;
}

export interface CarrierApplicationInput {
  legal_entity_name: string;
  trading_name?: string;
  registration_number?: string;
  tax_identifier?: string;
  country?: string;
  county?: string;
  town?: string;
  contact_name: string;
  contact_position?: string;
  contact_email: string;
  contact_phone: string;
  fleet_size?: number;
  vehicle_types?: string[];
  service_categories?: string[];
  corridors?: string[];
  notes?: string;
}

export const submitCarrierApplication = (input: CarrierApplicationInput) =>
  rpc<Outcome & { application_reference?: string; claim_token?: string; duplicate?: boolean }>(
    "carrier_application_submit",
    { p: input as unknown as Record<string, unknown> },
  );

export const carrierApplicationStatus = (reference: string, token: string) =>
  rpc<Outcome & { status?: CarrierApplicationStatus; legal_entity_name?: string; review_notes?: string | null }>(
    "carrier_application_status",
    { _reference: reference, _token: token },
  );

export const decideCarrierApplication = (input: {
  applicationId: string;
  action: "REVIEW" | "REQUEST_INFO" | "REJECT" | "APPROVE";
  note?: string;
}) =>
  rpc<Outcome & { status?: CarrierApplicationStatus; carrier_id?: string; partner_id?: string }>(
    "carrier_application_decide",
    { p: { application_id: input.applicationId, action: input.action, note: input.note ?? null } },
  );

export async function listCarrierApplications(): Promise<CarrierApplicationRow[]> {
  const { data, error } = await supabase
    .from("carrier_applications" as never)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as CarrierApplicationRow[];
}

export async function listCarrierApplicationEvents(applicationId: string): Promise<CarrierApplicationEventRow[]> {
  const { data, error } = await supabase
    .from("carrier_application_events" as never)
    .select("*")
    .eq("application_id", applicationId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as CarrierApplicationEventRow[];
}

/** Service categories a Fleet Owner can offer capacity for. */
export const CARRIER_SERVICE_CATEGORIES = [
  "PARCEL", "COURIER", "FREIGHT", "BULK", "COLD_CHAIN", "MOVING", "SPECIALISED",
] as const;

export const CARRIER_VEHICLE_TYPES = [
  "MOTORCYCLE", "TUKTUK", "VAN", "PICKUP", "3T_TRUCK", "7T_TRUCK", "14T_TRUCK", "TRAILER", "REEFER",
] as const;
