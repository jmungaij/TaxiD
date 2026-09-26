/**
 * DRIVER AND VEHICLE REGISTER.
 *
 * The real people and vehicles that run a contract: names, licences, photos,
 * registrations and vehicle papers. Activation assignments point at these
 * records, so no driver name or registration is ever typed in free text.
 */
import { supabase } from "@/integrations/supabase/client";
import { untypedDb } from "@/integrations/supabase/untyped";

export const DRIVER_STATUSES = ["draft", "pending", "active", "suspended", "deactivated", "blacklisted"] as const;
export const DRIVER_TYPES = ["individual", "fleet_driver", "corporate_driver"] as const;
export const VEHICLE_STATUSES = ["draft", "pending", "active", "inactive", "suspended", "retired"] as const;
export const VEHICLE_TYPES = ["car", "van", "bus", "truck", "motorcycle", "courier"] as const;

export interface RegisterDriver {
  driver_id: string;
  label: string | null;
  first_name: string | null;
  last_name: string | null;
  driver_code: string | null;
  status: string | null;
  driver_type: string | null;
  phone_number: string | null;
  national_id: string | null;
  photo_url: string | null;
  licence_number: string | null;
  licence_expiry: string | null;
  licence_status: string | null;
  licence_file_url: string | null;
  assignments: number;
}

export interface RegisterVehicleDocument {
  code: string;
  name: string;
  number: string | null;
  expiry: string | null;
  file_url: string | null;
}

export interface RegisterVehicle {
  vehicle_id: string;
  label: string | null;
  number_plate: string | null;
  vehicle_code: string | null;
  vehicle_type: string | null;
  vehicle_category: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  seating_capacity: number | null;
  status: string | null;
  documents: RegisterVehicleDocument[];
  assignments: number;
}

export interface FleetRegister {
  generated_at: string;
  may_write: boolean;
  drivers: RegisterDriver[];
  vehicles: RegisterVehicle[];
  vehicle_document_types: { id: string; code: string; name: string; expiry_required: boolean }[];
}

const REFUSALS: Record<string, string> = {
  NOT_AUTHENTICATED: "Sign in again to read the fleet register.",
  NOT_FLEET_STAFF: "You do not have access to the fleet register.",
  NOT_FLEET_MANAGER: "Only fleet management can add or change drivers and vehicles.",
  DRIVER_NAME_REQUIRED: "A driver needs a first and last name.",
  LICENCE_NUMBER_REQUIRED: "Record the licence number alongside its expiry date.",
  UNKNOWN_DRIVER_STATUS: "That driver status is not recognised.",
  UNKNOWN_DRIVER_TYPE: "That driver type is not recognised.",
  UNKNOWN_VEHICLE_STATUS: "That vehicle status is not recognised.",
  UNKNOWN_VEHICLE_DOCUMENT_TYPE: "That vehicle document type is not recognised.",
  NUMBER_PLATE_REQUIRED: "A vehicle needs its registration number.",
  VEHICLE_TYPE_REQUIRED: "Choose the type of vehicle.",
  NUMBER_PLATE_ALREADY_ON_REGISTER: "That registration is already on the fleet register.",
  DRIVER_NOT_ON_REGISTER: "That driver is not on the register.",
  VEHICLE_NOT_ON_REGISTER: "That vehicle is not on the register.",
};

export function fleetRefusal(message: string): string {
  const hit = Object.keys(REFUSALS).find((k) => message.includes(k));
  return hit ? REFUSALS[hit] : message;
}

export async function loadFleetRegister(): Promise<FleetRegister> {
  const { data, error } = await untypedDb.rpc("fleet_register_read", { p: {} });
  if (error) throw new Error(fleetRefusal(error.message));
  const r = (data ?? {}) as Partial<FleetRegister>;
  return {
    generated_at: r.generated_at ?? new Date().toISOString(),
    may_write: r.may_write ?? false,
    drivers: r.drivers ?? [],
    vehicles: r.vehicles ?? [],
    vehicle_document_types: r.vehicle_document_types ?? [],
  };
}

/** Files go under the uploader's own folder in the private fleet buckets. */
export async function uploadFleetFile(
  bucket: "driver-photos" | "driver-documents" | "vehicle-documents",
  file: File,
): Promise<string> {
  const { data: session } = await supabase.auth.getUser();
  const uid = session.user?.id;
  if (!uid) throw new Error("Sign in again to upload.");
  const safe = file.name.replace(/[^\w.\-]+/g, "_");
  const path = `${uid}/${Date.now()}-${safe}`;
  const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: false });
  if (error) throw new Error(error.message);
  return path;
}

export async function saveDriver(input: {
  driverId?: string;
  firstName?: string;
  lastName?: string;
  phoneNumber?: string;
  nationalId?: string;
  kraPin?: string;
  driverType?: string;
  status?: string;
  photoUrl?: string;
  licenceNumber?: string;
  licenceExpiry?: string;
  licenceFileUrl?: string;
  licenceFileName?: string;
}): Promise<string> {
  const { data, error } = await untypedDb.rpc("fleet_driver_upsert", {
    p: {
      driver_id: input.driverId ?? null,
      first_name: input.firstName ?? null,
      last_name: input.lastName ?? null,
      phone_number: input.phoneNumber ?? null,
      national_id: input.nationalId ?? null,
      kra_pin: input.kraPin ?? null,
      driver_type: input.driverType ?? null,
      status: input.status ?? null,
      photo_url: input.photoUrl ?? null,
      licence_number: input.licenceNumber ?? null,
      licence_expiry: input.licenceExpiry ?? null,
      licence_file_url: input.licenceFileUrl ?? null,
      licence_file_name: input.licenceFileName ?? null,
    },
  });
  if (error) throw new Error(fleetRefusal(error.message));
  return (data as { driver_id: string }).driver_id;
}

export async function saveVehicle(input: {
  vehicleId?: string;
  numberPlate?: string;
  vehicleType?: string;
  vehicleCategory?: string;
  make?: string;
  model?: string;
  year?: string;
  color?: string;
  seatingCapacity?: string;
  status?: string;
  documentTypeId?: string;
  documentNumber?: string;
  documentIssueDate?: string;
  documentExpiryDate?: string;
  documentFileUrl?: string;
  documentFileName?: string;
}): Promise<string> {
  const { data, error } = await untypedDb.rpc("fleet_vehicle_upsert", {
    p: {
      vehicle_id: input.vehicleId ?? null,
      number_plate: input.numberPlate ?? null,
      vehicle_type: input.vehicleType ?? null,
      vehicle_category: input.vehicleCategory ?? null,
      make: input.make ?? null,
      model: input.model ?? null,
      year: input.year ?? null,
      color: input.color ?? null,
      seating_capacity: input.seatingCapacity ?? null,
      status: input.status ?? null,
      document_type_id: input.documentTypeId ?? null,
      document_number: input.documentNumber ?? null,
      document_issue_date: input.documentIssueDate ?? null,
      document_expiry_date: input.documentExpiryDate ?? null,
      document_file_url: input.documentFileUrl ?? null,
      document_file_name: input.documentFileName ?? null,
    },
  });
  if (error) throw new Error(fleetRefusal(error.message));
  return (data as { vehicle_id: string }).vehicle_id;
}
