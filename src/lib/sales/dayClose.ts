/**
 * SALES DAY CLOSE — the commercial half of an employee's end-of-day account.
 *
 * Everything here is computed by the database from the records themselves: what
 * moved today, where the month stands against the target register, which
 * response clocks are still running, and the ranked next best actions. Nothing
 * is estimated in the browser, and a figure with no underlying record comes back
 * as null rather than a zero that would read as a result.
 */
import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface DayCloseMovement {
  lead_ref: string | null;
  organisation: string | null;
  action: string;
  stage_from: string | null;
  stage_to: string | null;
  note: string | null;
  at: string;
}

export interface DayCloseClock {
  process: string;
  entity_ref: string | null;
  organisation: string | null;
  due_at: string;
  breached: boolean;
  escalation_level: number;
  minutes_remaining: number;
}

export interface DayCloseAction {
  lead_id: string;
  lead_ref: string | null;
  organisation: string | null;
  stage: string;
  value_kes: number | null;
  weighted_kes: number | null;
  why: string;
  due_at: string | null;
  breached: boolean;
  idle_days: number | null;
  score: number;
}

/** One activated contract, as recorded in the contract register. */
export interface DayCloseActivatedContract {
  contract_id: string;
  contract_number: string | null;
  organisation: string | null;
  status: string;
  value_kes: number | null;
  currency: string | null;
  activated_at: string | null;
  revenue_recorded_kes: number;
}

/** A contract still waiting on a signed copy or on activation. */
export interface DayCloseWaitingContract {
  contract_id: string;
  contract_number: string | null;
  organisation: string | null;
  status: string;
  value_kes: number | null;
  waiting_on: string;
}

/** The contract half of the commercial day close. */
export interface DayCloseContracts {
  signed_today: number;
  activated_today: number;
  activated_this_month: number;
  revenue_recorded_today_kes: number;
  revenue_recorded_month_kes: number;
  awaiting_signature: number;
  awaiting_activation: number;
  awaiting_activation_value_kes: number;
  activated: DayCloseActivatedContract[];
  waiting: DayCloseWaitingContract[];
}

export interface SalesDayClose {
  staff_id: string;
  staff_name: string | null;
  position: string | null;
  date: string;
  today: {
    leads_created: number;
    stages_advanced: number;
    information_requests: number;
    notes_recorded: number;
    clocks_completed: number;
    won_count: number;
    revenue_won_kes: number;
    contracts_signed: number;
    contracts_activated: number;
    contract_revenue_kes: number;
    movements: DayCloseMovement[];
  };
  month: {
    period_start: string;
    target_kes: number | null;
    target_source: string | null;
    currency: string | null;
    attainment_pct: number | null;
    remaining_kes: number | null;
    figures: {
      revenue_won_kes: number;
      won_count: number;
      open_count: number;
      open_pipeline_kes: number;
      weighted_pipeline_kes: number;
      win_rate_pct: number | null;
      stale_count: number;
      awaiting_customer_count: number;
      closing_soon_count: number;
    };
  };
  sla: {
    open: number;
    approaching: number;
    breached: number;
    escalated: number;
    clocks: DayCloseClock[];
  };
  contracts: DayCloseContracts;
  next_actions: DayCloseAction[];
  tasks_placed: number;
}

/**
 * Reads the employee's commercial day close. Pass `materialise` to also place
 * the top three next best actions on their task list for tomorrow's open.
 */
export async function fetchSalesDayClose(
  staffId?: string | null,
  materialise = false,
): Promise<SalesDayClose | null> {
  const { data, error } = await db.rpc("sales_day_close", {
    _staff: staffId ?? null,
    _materialise: materialise,
  });
  if (error) {
    // A person outside the commercial desk simply has no commercial day close.
    if (/NO_STAFF_IDENTITY|NOT_IN_YOUR_REPORTING_LINE/.test(error.message)) return null;
    throw new Error(error.message);
  }
  return data as SalesDayClose;
}

/** True when the person has any commercial record worth reporting on. */
export function hasCommercialActivity(d: SalesDayClose | null): boolean {
  if (!d) return false;
  const c = d.contracts;
  return (
    d.month.figures.open_count > 0 ||
    d.month.figures.won_count > 0 ||
    d.today.movements.length > 0 ||
    d.sla.open > 0 ||
    d.next_actions.length > 0 ||
    (!!c &&
      (c.activated.length > 0 ||
        c.waiting.length > 0 ||
        c.revenue_recorded_month_kes > 0))
  );
}

export const KES = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "—"
    : new Intl.NumberFormat("en-KE", {
        style: "currency",
        currency: "KES",
        maximumFractionDigits: 0,
      }).format(n);
