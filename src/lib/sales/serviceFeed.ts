/**
 * SERVICE EXECUTION FEED.
 *
 * Every trip, staff transport run, airport transfer and parcel is recorded
 * against a customer account with the status it is actually at. Each status
 * change is written to an append-only history, and a delay, failure or
 * cancellation raises a service exception against that account automatically —
 * the operations side of the Exception Centre.
 *
 * The daily close reads completed services from here, so the figures on the
 * close and the work that really ran can never disagree.
 */
import { untypedDb } from "@/integrations/supabase/untyped";

export const SERVICE_TYPES = ["AIRPORT_TRANSFER", "STAFF_TRANSPORT", "PARCEL_DELIVERY", "CHARTER"] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];

export const SERVICE_TYPE_LABEL: Record<ServiceType, string> = {
  AIRPORT_TRANSFER: "Airport transfer",
  STAFF_TRANSPORT: "Staff transport",
  PARCEL_DELIVERY: "Parcel delivery",
  CHARTER: "Charter",
};

export const EXECUTION_STATUSES = [
  "SCHEDULED",
  "DISPATCHED",
  "IN_PROGRESS",
  "COMPLETED",
  "DELAYED",
  "FAILED",
  "CANCELLED",
] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export const EXECUTION_STATUS_LABEL: Record<ExecutionStatus, string> = {
  SCHEDULED: "Scheduled",
  DISPATCHED: "Driver assigned",
  IN_PROGRESS: "On the road",
  COMPLETED: "Completed",
  DELAYED: "Running late",
  FAILED: "Did not happen",
  CANCELLED: "Cancelled",
};

/** Statuses that raise an exception on the customer's account automatically. */
export const EXCEPTION_STATUSES: ExecutionStatus[] = ["DELAYED", "FAILED", "CANCELLED"];

export interface ServiceExecution {
  execution_id: string;
  execution_ref: string;
  account_id: string;
  account_name: string | null;
  service_type: ServiceType;
  status: ExecutionStatus;
  scheduled_at: string;
  started_at: string | null;
  completed_at: string | null;
  passenger_or_recipient: string | null;
  origin: string | null;
  destination: string | null;
  driver_label: string | null;
  vehicle_label: string | null;
  value_kes: number | null;
  exception_reason: string | null;
}

export interface ServiceFeedAccount {
  account_id: string;
  account_name: string | null;
  completed_month: number;
  exceptions_month: number;
  value_month_kes: number;
}

export interface ServiceFeed {
  staff_id: string;
  generated_at: string;
  today: {
    total: number;
    completed: number;
    in_flight: number;
    exceptions: number;
    airport_transfers: number;
    staff_transport: number;
    parcels: number;
    value_kes: number;
  };
  month: { completed: number; exceptions: number; value_kes: number };
  by_account: ServiceFeedAccount[];
  feed: ServiceExecution[];
}

export const SERVICE_REFUSALS: Record<string, string> = {
  NOT_AUTHENTICATED: "Sign in again to read the service feed.",
  NOT_COMMERCIAL_STAFF: "Only staff can record or read service execution.",
  NO_STAFF_IDENTITY: "Your staff record is not linked yet.",
  NOT_AUTHORISED: "You can only read your own service feed unless you manage the customer records.",
  ACCOUNT_NOT_FOUND: "Create the customer account first, then record service against it.",
  SERVICE_TYPE_REQUIRED: "Choose what kind of service this was.",
  SCHEDULED_TIME_REQUIRED: "Say when the service was due.",
  EXECUTION_NOT_FOUND: "That service record no longer exists.",
  BOOKING_BLOCKED_BY_ESCALATION:
    "This customer has an open escalation that holds new bookings. The team named on the escalation must close it first, or a supervisor must record an override reason.",
};

export function serviceRefusal(message: string): string {
  const hit = Object.keys(SERVICE_REFUSALS).find((k) => message.includes(k));
  return hit ? SERVICE_REFUSALS[hit] : message;
}

export async function loadServiceFeed(staffId?: string | null): Promise<ServiceFeed> {
  const { data, error } = await untypedDb.rpc("sales_service_feed", { p: { staff: staffId ?? null } });
  if (error) throw new Error(serviceRefusal(error.message));
  return data as unknown as ServiceFeed;
}

export async function recordServiceExecution(input: {
  accountId: string;
  contractId?: string | null;
  serviceType: ServiceType;
  scheduledAt: string;
  status?: ExecutionStatus;
  passengerOrRecipient?: string;
  origin?: string;
  destination?: string;
  driverLabel?: string;
  vehicleLabel?: string;
  valueKes?: number | null;
  externalReference?: string;
}): Promise<{ execution_id: string; execution_ref: string }> {
  const { data, error } = await untypedDb.rpc("sales_service_execution_record", {
    p: {
      account_id: input.accountId,
      contract_id: input.contractId ?? null,
      service_type: input.serviceType,
      scheduled_at: input.scheduledAt,
      status: input.status ?? "SCHEDULED",
      passenger_or_recipient: input.passengerOrRecipient ?? null,
      origin: input.origin ?? null,
      destination: input.destination ?? null,
      driver_label: input.driverLabel ?? null,
      vehicle_label: input.vehicleLabel ?? null,
      value_kes: input.valueKes ?? null,
      external_reference: input.externalReference ?? null,
    },
  });
  if (error) throw new Error(serviceRefusal(error.message));
  return data as unknown as { execution_id: string; execution_ref: string };
}

export interface OperationsSyncResult {
  synced_at: string;
  rides_recorded: number;
  parcels_recorded: number;
  unmatched_operations: number;
}

export interface UnmatchedOperation {
  kind: string;
  reference: string | null;
  status: string;
  when: string | null;
  booked_by_domain: string | null;
  reason: string;
}

/**
 * Brings the rides and parcel orders operations actually ran into this feed.
 * A record is attached to a customer only when the booker's email domain is the
 * domain on that customer's account — never by resemblance of names.
 */
export async function syncOperations(): Promise<OperationsSyncResult> {
  const { data, error } = await untypedDb.rpc("sales_operations_bridge_sync", { p: {} });
  if (error) throw new Error(serviceRefusal(error.message));
  return data as unknown as OperationsSyncResult;
}

export async function listUnmatchedOperations(): Promise<UnmatchedOperation[]> {
  const { data, error } = await untypedDb.rpc("sales_operations_bridge_review", { p: {} });
  if (error) throw new Error(serviceRefusal(error.message));
  return ((data as { items?: UnmatchedOperation[] })?.items ?? []) as UnmatchedOperation[];
}

export async function updateServiceStatus(input: {
  executionId: string;
  status: ExecutionStatus;
  exceptionReason?: string;
  driverLabel?: string;
  vehicleLabel?: string;
  valueKes?: number | null;
}): Promise<void> {
  const { error } = await untypedDb.rpc("sales_service_execution_record", {
    p: {
      execution_id: input.executionId,
      status: input.status,
      exception_reason: input.exceptionReason ?? null,
      driver_label: input.driverLabel ?? null,
      vehicle_label: input.vehicleLabel ?? null,
      value_kes: input.valueKes ?? null,
    },
  });
  if (error) throw new Error(serviceRefusal(error.message));
}
