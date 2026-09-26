/**
 * SALES MANAGER OPERATIONS BOARD.
 *
 * What operations has raised against the team's customers, what service ran
 * today, and who/which vehicle is committed on each activation plan. Every row
 * is read from the operational records themselves — nothing is estimated here.
 */
import { untypedDb } from "@/integrations/supabase/untyped";
import { managerRefusal } from "./managerDesk";

export interface ManagerException {
  signal_id: string;
  account_id: string | null;
  customer_label: string | null;
  headline: string | null;
  severity: string | null;
  status: string | null;
  source: string | null;
  recommended_action: string | null;
  evidence: Record<string, unknown> | null;
  created_at: string;
  owner_name: string | null;
}

export interface ManagerServiceRow {
  execution_id: string;
  execution_ref: string | null;
  account_id: string | null;
  service_type: string;
  status: string;
  scheduled_at: string | null;
  value_kes: number | null;
  exception_reason: string | null;
  owner_name: string | null;
}

export interface ManagerActivationRow {
  assignment_id: string;
  account_id: string | null;
  contract_id: string | null;
  assignment_role: string;
  person_label: string | null;
  vehicle_label: string | null;
  start_date: string | null;
  end_date: string | null;
  status: string;
  owner_name: string | null;
}

export interface ManagerOperationsBoard {
  generated_at: string;
  today: string;
  exceptions: ManagerException[];
  services_today: ManagerServiceRow[];
  activation: ManagerActivationRow[];
}

export async function loadManagerOperationsBoard(): Promise<ManagerOperationsBoard> {
  const { data, error } = await untypedDb.rpc("sales_manager_operations_board", { p: {} });
  if (error) throw new Error(managerRefusal(error.message));
  const b = (data ?? {}) as Partial<ManagerOperationsBoard>;
  return {
    generated_at: b.generated_at ?? new Date().toISOString(),
    today: b.today ?? new Date().toISOString().slice(0, 10),
    exceptions: b.exceptions ?? [],
    services_today: b.services_today ?? [],
    activation: b.activation ?? [],
  };
}

export const SERVICE_LABELS: Record<string, string> = {
  AIRPORT_TRANSFER: "Airport transfer",
  STAFF_TRANSPORT: "Staff transport",
  PARCEL_DELIVERY: "Parcel delivery",
  CHARTER: "Charter",
};

export const ROLE_LABELS: Record<string, string> = {
  ACCOUNT_MANAGER: "Account manager",
  COORDINATOR: "Coordinator",
  SUPERVISOR: "Supervisor",
  DRIVER: "Driver",
  VEHICLE: "Vehicle",
};
