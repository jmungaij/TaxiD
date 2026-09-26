/**
 * DAILY MONEY FLOW — day by day, for any date range.
 *
 * The manager desk month figures answer "where is the month", this answers
 * "what happened on each day". Every value is read from the records themselves:
 * deals won that day, money received that day, service value delivered that day
 * and the operational volumes declared on the account's daily close. A day with
 * no record comes back as zero with an explicit "not closed" state, never as a
 * result.
 */
import { untypedDb } from "@/integrations/supabase/untyped";
import { managerRefusal } from "./managerDesk";

export interface DailyFlowDay {
  day: string;
  recognised_kes: number;
  won_kes: number;
  collected_cents: number;
  service_value_kes: number;
  services_completed: number;
  declared_value_kes: number;
  declared_units: number;
  closed_revenue_kes: number | null;
  day_closed?: boolean;
  closes?: number;
  people_expected?: number;
  daily_target_kes: number | null;
  gap_kes: number | null;
}

export interface DailyFlowPerson {
  staff_id: string;
  full_name: string | null;
  position: string | null;
  month_target_kes: number | null;
  recognised_range_kes: number;
  declared_value_range_kes: number;
  service_value_range_kes: number;
  closes_in_range: number;
  days_in_range: number;
  days: DailyFlowDay[];
}

export interface DailyFlow {
  generated_at: string;
  from: string;
  to: string;
  today: string;
  days: DailyFlowDay[];
  people: DailyFlowPerson[];
}

export const DAILY_FLOW_REFUSALS: Record<string, string> = {
  RANGE_INVALID: "The start date must fall on or before the end date.",
  RANGE_TOO_WIDE: "Choose a range of up to 92 days.",
};

export async function loadDailyFlow(range?: { from?: string; to?: string }): Promise<DailyFlow> {
  const { data, error } = await untypedDb.rpc("sales_manager_daily_flow", {
    p: { from: range?.from ?? null, to: range?.to ?? null },
  });
  if (error) {
    const key = Object.keys(DAILY_FLOW_REFUSALS).find((k) => error.message.includes(k));
    throw new Error(key ? DAILY_FLOW_REFUSALS[key] : managerRefusal(error.message));
  }
  return data as unknown as DailyFlow;
}

/** The days in the range, newest first, that still carry a shortfall. */
export function shortfallDays(flow: DailyFlow): DailyFlowDay[] {
  return flow.days.filter((d) => d.gap_kes !== null && d.gap_kes > 0);
}
