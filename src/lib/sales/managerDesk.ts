/**
 * SALES MANAGER DESK.
 *
 * One read of the whole sales department: every specialist who reports to the
 * manager, their target from the target register, the book they hold, what they
 * have won, what has been invoiced and collected, what is outstanding, and the
 * service exceptions sitting open against their customers. Nothing is estimated
 * — the figures come from the same records the specialists work in.
 */
import { untypedDb } from "@/integrations/supabase/untyped";

export interface ManagerDeskDay {
  new_customers: number;
  outreach: number;
  replies: number;
  won_kes: number;
  collected_cents: number;
  services_completed: number;
  service_issues: number;
}

export interface ManagerDeskPerson {
  staff_id: string;
  full_name: string | null;
  position: string | null;
  target_kes: number | null;
  leads_total: number;
  leads_open: number;
  leads_untouched: number;
  open_pipeline_kes: number;
  won_month_kes: number;
  invoiced_month_cents: number;
  collected_month_cents: number;
  outstanding_cents: number;
  service_exceptions_open: number;
  contracts_awaiting_signature: number;
  day_closes_month: number;
  closed_revenue_month_kes: number;
  last_close_on: string | null;
  closed_today: boolean;
  today: ManagerDeskDay;
  last_activity_at: string | null;
}

export interface ManagerOwnKpis {
  staff_id: string | null;
  full_name: string | null;
  own_target_kes: number | null;
  team_size: number;
  team_leads_open: number;
  team_new_customers_today: number;
  team_outreach_today: number;
  team_won_month_kes: number;
  team_collected_month_cents: number;
  team_outstanding_cents: number;
  team_exceptions_open: number;
  team_services_completed_today: number;
  team_contracts_awaiting_signature: number;
  team_day_closes_month: number;
  team_closed_revenue_month_kes: number;
  team_closes_today: number;
}

export interface ManagerDesk {
  manager_staff_id: string | null;
  generated_at: string;
  month_start: string;
  today: string;
  team_target_kes: number;
  my_kpis: ManagerOwnKpis;
  people: ManagerDeskPerson[];
}

export const MANAGER_REFUSALS: Record<string, string> = {
  NOT_AUTHENTICATED: "Sign in again to read the sales desk.",
  NO_STAFF_IDENTITY: "Your staff record is not linked yet.",
  NOT_A_SALES_MANAGER: "This desk is for the sales manager and above.",
};

export function managerRefusal(message: string): string {
  const hit = Object.keys(MANAGER_REFUSALS).find((k) => message.includes(k));
  return hit ? MANAGER_REFUSALS[hit] : message;
}

export async function loadManagerDesk(): Promise<ManagerDesk> {
  const { data, error } = await untypedDb.rpc("sales_manager_desk", { p: {} });
  if (error) throw new Error(managerRefusal(error.message));
  return data as unknown as ManagerDesk;
}

/** The shortfall a person still has to find this month, or null when no target is registered. */
export function gapKes(p: ManagerDeskPerson): number | null {
  if (p.target_kes === null || p.target_kes === undefined) return null;
  const recognised = p.won_month_kes + p.collected_month_cents / 100;
  return Math.max(0, p.target_kes - recognised);
}
