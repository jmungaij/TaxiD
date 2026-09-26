/**
 * ACTIVATION TRACKING.
 *
 * The activation plan already records the date service starts and who owns
 * onboarding. This layer records who and what is actually assigned to the
 * contract — account manager, coordinator, supervisor, drivers and vehicles,
 * with their dates — and reads the service actually delivered against the same
 * contract so a plan can be compared with reality rather than assumed.
 */
import { untypedDb } from "@/integrations/supabase/untyped";

export const ASSIGNMENT_ROLES = ["ACCOUNT_MANAGER", "COORDINATOR", "SUPERVISOR", "DRIVER", "VEHICLE"] as const;
export type AssignmentRole = (typeof ASSIGNMENT_ROLES)[number];

export const ASSIGNMENT_ROLE_LABEL: Record<AssignmentRole, string> = {
  ACCOUNT_MANAGER: "Account manager",
  COORDINATOR: "Coordinator",
  SUPERVISOR: "Supervisor",
  DRIVER: "Driver",
  VEHICLE: "Vehicle",
};

export const ASSIGNMENT_STATUSES = ["PLANNED", "ACTIVE", "COMPLETED", "CANCELLED"] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

export interface ActivationAssignment {
  assignment_id: string;
  assignment_role: AssignmentRole;
  person: string | null;
  staff_member_id: string | null;
  driver_id?: string | null;
  vehicle_id?: string | null;
  vehicle_label: string | null;
  start_date: string | null;
  end_date: string | null;
  status: AssignmentStatus;
  notes: string | null;
}


export interface ActivationContract {
  contract_id: string;
  contract_number: string | null;
  customer: string | null;
  account_id: string | null;
  status: string;
  value_amount: number | null;
  currency: string | null;
  activated_at: string | null;
  term_start: string | null;
  term_end: string | null;
  assignments: ActivationAssignment[];
  services_delivered: number;
  services_failed: number;
  invoice: {
    invoice_id: string;
    invoice_no: string | null;
    status: string;
    total_cents: number;
    paid_cents: number;
  } | null;
}

export interface ActivationBoard {
  staff_id: string;
  generated_at: string;
  contracts: ActivationContract[];
  colleagues: { staff_id: string; full_name: string | null }[];
}

export const ACTIVATION_REFUSALS: Record<string, string> = {
  NOT_AUTHENTICATED: "Sign in again to read activation.",
  NOT_COMMERCIAL_STAFF: "Only staff can read or record activation.",
  NO_STAFF_IDENTITY: "Your staff record is not linked yet.",
  NOT_AUTHORISED: "You can only read your own contracts unless you manage the customer records.",
  CONTRACT_NOT_FOUND: "That contract no longer exists.",
  ROLE_REQUIRED: "Choose what this person or vehicle is assigned as.",
  WHO_OR_WHAT_IS_ASSIGNED_REQUIRED: "Name the colleague, the person or the vehicle being assigned.",
  ASSIGNMENT_NOT_FOUND: "That assignment no longer exists.",
  DATES_OUTSIDE_CONTRACT_TERM: "Those dates fall outside the contract's own term, so nothing was recorded.",
  END_BEFORE_START: "The end date is before the start date.",
  DRIVER_NOT_ON_REGISTER: "That driver is not on the driver register.",
  VEHICLE_NOT_ON_REGISTER: "That vehicle is not on the fleet register.",
  DRIVER_LICENCE_EXPIRED: "That driver's licence expires before this assignment starts, so nothing was recorded.",
  DRIVER_FROM_REGISTER_REQUIRED: "Choose the driver from the driver register.",
  VEHICLE_FROM_REGISTER_REQUIRED: "Choose the vehicle from the fleet register.",
};

export function activationRefusal(message: string): string {
  const hit = Object.keys(ACTIVATION_REFUSALS).find((k) => message.includes(k));
  return hit ? ACTIVATION_REFUSALS[hit] : message;
}

export interface FleetDriver {
  driver_id: string;
  label: string | null;
  driver_code: string | null;
  status: string | null;
  driver_type?: string | null;
  phone_number?: string | null;
  photo_url?: string | null;
  licence_number?: string | null;
  licence_expiry?: string | null;
  licence_status?: string | null;
}

export interface FleetVehicle {
  vehicle_id: string;
  label: string | null;
  description: string | null;
  vehicle_type?: string | null;
  vehicle_category?: string | null;
  seating_capacity: number | null;
  status: string | null;
  insurance_expiry?: string | null;
  inspection_expiry?: string | null;
}

export interface ActivationFleet {
  generated_at: string;
  drivers: FleetDriver[];
  vehicles: FleetVehicle[];
}


/** The real driver and vehicle records — nothing is typed by hand. */
export async function loadActivationFleet(): Promise<ActivationFleet> {
  const { data, error } = await untypedDb.rpc("sales_activation_fleet", { p: {} });
  if (error) throw new Error(activationRefusal(error.message));
  const f = (data ?? {}) as Partial<ActivationFleet>;
  return {
    generated_at: f.generated_at ?? new Date().toISOString(),
    drivers: f.drivers ?? [],
    vehicles: f.vehicles ?? [],
  };
}

export async function loadActivationBoard(staffId?: string | null): Promise<ActivationBoard> {
  const { data, error } = await untypedDb.rpc("sales_activation_board", { p: { staff: staffId ?? null } });
  if (error) throw new Error(activationRefusal(error.message));
  return data as unknown as ActivationBoard;
}

/**
 * Places the contract's own recorded owner and term dates on the board. Nothing
 * is invented: if the contract has no owner or dates, they stay blank.
 */
export async function seedActivationFromContract(contractId: string): Promise<string> {
  const { data, error } = await untypedDb.rpc("sales_activation_seed", { p: { contract_id: contractId } });
  if (error) throw new Error(activationRefusal(error.message));
  return (data as { assignment_id: string }).assignment_id;
}

export async function upsertAssignment(input: {
  assignmentId?: string;
  contractId?: string;
  assignmentRole?: AssignmentRole;
  staffMemberId?: string | null;
  driverId?: string | null;
  vehicleId?: string | null;
  personLabel?: string;
  vehicleLabel?: string;
  startDate?: string;
  endDate?: string;
  status?: AssignmentStatus;
  notes?: string;
}): Promise<string> {
  const { data, error } = await untypedDb.rpc("sales_activation_assignment_upsert", {
    p: {
      assignment_id: input.assignmentId ?? null,
      contract_id: input.contractId ?? null,
      assignment_role: input.assignmentRole ?? null,
      staff_member_id: input.staffMemberId ?? null,
      driver_id: input.driverId ?? null,
      vehicle_id: input.vehicleId ?? null,
      person_label: input.personLabel ?? null,
      vehicle_label: input.vehicleLabel ?? null,

      start_date: input.startDate ?? null,
      end_date: input.endDate ?? null,
      status: input.status ?? null,
      notes: input.notes ?? null,
    },
  });
  if (error) throw new Error(activationRefusal(error.message));
  return (data as { assignment_id: string }).assignment_id;
}
