/**
 * Tomorrow — what a specialist has already promised for the next working day.
 *
 * Everything is read from `sales_tomorrow_plan`: promises falling due, services
 * booked for tomorrow, contracts still waiting on a signature or activation,
 * and leads untouched for over a week. Nothing is guessed in the browser.
 */
import { untypedDb } from "@/integrations/supabase/untyped";

export interface TomorrowPromise {
  lead_id: string;
  lead_ref: string | null;
  organisation: string | null;
  stage: string;
  awaiting_item: string | null;
  waiting_on: string | null;
  due_date: string;
  overdue: boolean;
  value_kes: number | null;
}

export interface TomorrowService {
  lead_id: string;
  lead_ref: string | null;
  organisation: string | null;
  stage: string;
  service_date: string;
  origin: string | null;
  destination: string | null;
  value_kes: number | null;
}

export interface TomorrowContract {
  contract_number: string | null;
  organisation: string | null;
  status: string | null;
  value_kes: number | null;
  waiting_on: "SIGNATURE" | "ACTIVATION";
}

export interface TomorrowStaleLead {
  lead_id: string;
  lead_ref: string | null;
  organisation: string | null;
  stage: string;
  idle_days: number | null;
  value_kes: number | null;
}

export interface TomorrowPlan {
  staff_id: string;
  today: string;
  tomorrow: string;
  promises: TomorrowPromise[];
  services: TomorrowService[];
  contracts_waiting: TomorrowContract[];
  untouched_over_a_week: TomorrowStaleLead[];
}

export async function fetchTomorrowPlan(staffId?: string | null): Promise<TomorrowPlan> {
  const { data, error } = await untypedDb.rpc("sales_tomorrow_plan", { _staff: staffId ?? null });
  if (error) throw new Error(error.message);
  return data as unknown as TomorrowPlan;
}

export const KES = (n: number | null | undefined) =>
  n === null || n === undefined ? "NOT STATED" : `KSh ${Math.round(Number(n)).toLocaleString("en-KE")}`;

export const dayLabel = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleDateString("en-KE", { weekday: "long", day: "numeric", month: "short" }) : "—";
