/**
 * OPERATIONAL REALITY PER CUSTOMER, PER DAY.
 *
 * Airport transfers, staff transport trips and parcel deliveries are entered by
 * the person who owns the account, for one customer on one day. The database
 * holds one record per customer per day, so re-entering a day corrects it rather
 * than double-counting it.
 *
 * The board reads those records back with the month to date, the monthly target
 * from the target register, revenue already recognised and the remaining gap. A
 * projection is only stated when at least one day has actually been recorded.
 */
import { supabase } from "@/integrations/supabase/client";

export type AccountDayVolume = {
  airport_transfers: number;
  staff_transport_trips: number;
  parcel_deliveries: number;
  declared_value_kes: number | null;
  notes: string | null;
};

export type AccountMonthVolume = {
  airport_transfers: number;
  staff_transport_trips: number;
  parcel_deliveries: number;
  declared_value_kes: number | null;
  days_recorded: number;
};

export type VolumeAccount = {
  account_id: string;
  name: string;
  lifecycle_stage: string;
  today: AccountDayVolume | null;
  month: AccountMonthVolume | null;
};

export type VolumeBoard = {
  staff_id: string;
  date: string;
  month_start: string;
  accounts: VolumeAccount[];
  month: AccountMonthVolume & { projected_month_value_kes: number | null };
  target_kes: number | null;
  target_source: string | null;
  recognised_revenue_kes: number;
  gap_revenue_only_kes: number | null;
  gap_after_operations_kes: number | null;
};

export async function loadVolumeBoard(date?: string): Promise<VolumeBoard> {
  const { data, error } = await supabase.rpc("sales_account_volume_board", {
    p: date ? { date } : {},
  });
  if (error) throw error;
  return data as unknown as VolumeBoard;
}

export type VolumeEntry = {
  accountId: string;
  serviceDate?: string;
  airportTransfers: number;
  staffTransportTrips: number;
  parcelDeliveries: number;
  declaredValueKes?: number | null;
  notes?: string | null;
};

export async function recordAccountVolumes(entry: VolumeEntry): Promise<void> {
  const { error } = await supabase.rpc("sales_account_volume_record", {
    p: {
      account_id: entry.accountId,
      service_date: entry.serviceDate ?? null,
      airport_transfers: entry.airportTransfers,
      staff_transport_trips: entry.staffTransportTrips,
      parcel_deliveries: entry.parcelDeliveries,
      declared_value_kes: entry.declaredValueKes ?? null,
      notes: entry.notes ?? null,
    },
  });
  if (error) throw error;
}

/** Plain-language reading of why a figure cannot be stated. */
export function volumeRefusal(code: string): string {
  if (code.includes("NOTHING_TO_RECORD")) return "Enter at least one trip, transfer or parcel, or the value for the day.";
  if (code.includes("DATE_IN_THE_FUTURE")) return "A day that has not happened yet cannot be recorded.";
  if (code.includes("NOT_COMMERCIAL_STAFF")) return "Only a linked commercial employee can record service volumes.";
  if (code.includes("ACCOUNT_NOT_FOUND")) return "That customer account no longer exists.";
  return code;
}
