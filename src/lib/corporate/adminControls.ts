import { supabase } from "@/integrations/supabase/client";

/**
 * Organisation admin controls (trip limits, booking hours, allowed services).
 *
 * All controls are stored as rules on a single managed policy per scope so the
 * existing server-side policy engine (evaluate_corporate_ride_policy) enforces
 * them at ride-request time. Over-limit requests are routed to an approver,
 * so every managed rule is written with severity "approval".
 */

export const MANAGED_POLICY_NAME = "Managed controls";
export const MANAGED_SEVERITY = "approval";

export type ManagedRuleKind =
  | "max_trips_per_day"
  | "max_trips_per_month"
  | "time_window"
  | "day_of_week"
  | "ride_type_allow";

export interface ManagedRule {
  id: string;
  rule_kind: string;
  max_trips: number | null;
  time_start: string | null;
  time_end: string | null;
  days_of_week: number[] | null;
  allowed_ride_types: string[] | null;
  severity: string;
}

export interface ManagedScope {
  corporateId: string;
  departmentId?: string | null;
}

/** Find the managed policy for a scope, creating it on first use. */
export async function ensureManagedPolicy(scope: ManagedScope, actorUserId: string): Promise<string> {
  const scopeKind = scope.departmentId ? "department" : "corporate";
  let query = supabase
    .from("corporate_ride_policies")
    .select("id")
    .eq("corporate_id", scope.corporateId)
    .eq("name", MANAGED_POLICY_NAME)
    .eq("scope", scopeKind);
  query = scope.departmentId
    ? query.eq("department_id", scope.departmentId)
    : query.is("department_id", null);

  const { data: existing, error: findError } = await query.maybeSingle();
  if (findError) throw new Error(findError.message);
  if (existing?.id) return existing.id;

  const { data, error } = await supabase
    .from("corporate_ride_policies")
    .insert({
      corporate_id: scope.corporateId,
      name: MANAGED_POLICY_NAME,
      description: "Trip limits, booking hours and allowed services set by your organisation admin.",
      scope: scopeKind as "corporate" | "department",
      department_id: scope.departmentId ?? null,
      priority: 10,
      created_by: actorUserId,
      active: true,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

export async function loadManagedRules(scope: ManagedScope): Promise<{ policyId: string | null; rules: ManagedRule[] }> {
  const scopeKind = scope.departmentId ? "department" : "corporate";
  let query = supabase
    .from("corporate_ride_policies")
    .select("id")
    .eq("corporate_id", scope.corporateId)
    .eq("name", MANAGED_POLICY_NAME)
    .eq("scope", scopeKind);
  query = scope.departmentId
    ? query.eq("department_id", scope.departmentId)
    : query.is("department_id", null);

  const { data: policy } = await query.maybeSingle();
  if (!policy?.id) return { policyId: null, rules: [] };

  const { data: rules, error } = await supabase
    .from("corporate_policy_rules")
    .select("id,rule_kind,max_trips,time_start,time_end,days_of_week,allowed_ride_types,severity")
    .eq("policy_id", policy.id);
  if (error) throw new Error(error.message);
  return { policyId: policy.id, rules: (rules ?? []) as ManagedRule[] };
}

/** Replace (or remove) a single managed rule kind for a scope. */
export async function setManagedRule(
  scope: ManagedScope,
  actorUserId: string,
  kind: ManagedRuleKind,
  values: Partial<Pick<ManagedRule, "max_trips" | "time_start" | "time_end" | "days_of_week" | "allowed_ride_types">> | null,
): Promise<void> {
  const policyId = await ensureManagedPolicy(scope, actorUserId);

  const { error: delError } = await supabase
    .from("corporate_policy_rules")
    .delete()
    .eq("policy_id", policyId)
    .eq("rule_kind", kind);
  if (delError) throw new Error(delError.message);

  if (values) {
    const { error } = await supabase.from("corporate_policy_rules").insert({
      policy_id: policyId,
      rule_kind: kind,
      severity: MANAGED_SEVERITY,
      max_trips: values.max_trips ?? null,
      time_start: values.time_start ?? null,
      time_end: values.time_end ?? null,
      days_of_week: values.days_of_week ?? null,
      allowed_ride_types: values.allowed_ride_types ?? null,
    } as never);
    if (error) throw new Error(error.message);
  }

  await supabase.from("corporate_policy_audit_log").insert({
    corporate_id: scope.corporateId,
    actor_user_id: actorUserId,
    action: values ? "control.set" : "control.clear",
    target_type: "policy_rule",
    target_id: policyId,
    after: { rule_kind: kind, department_id: scope.departmentId ?? null, ...(values ?? {}) },
  } as never);
}

export interface DepartmentBudgetRow {
  department_id: string;
  department_name: string;
  monthly_budget_cents: number;
  spend_cents: number;
  trip_count: number;
  employee_count: number;
}

export async function loadDepartmentBudgets(corporateId: string): Promise<DepartmentBudgetRow[]> {
  const { data, error } = await supabase.rpc("corporate_department_budget_report", {
    _corporate_id: corporateId,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as DepartmentBudgetRow[];
}

export async function setDepartmentBudget(
  corporateId: string,
  actorUserId: string,
  departmentId: string,
  budgetCents: number | null,
): Promise<void> {
  const { error } = await supabase
    .from("corporate_departments")
    .update({ monthly_budget_cents: budgetCents })
    .eq("id", departmentId)
    .eq("corporate_id", corporateId);
  if (error) throw new Error(error.message);

  await supabase.from("corporate_policy_audit_log").insert({
    corporate_id: corporateId,
    actor_user_id: actorUserId,
    action: "department.budget.set",
    target_type: "department",
    target_id: departmentId,
    after: { monthly_budget_cents: budgetCents },
  } as never);
}

export const money = (cents: number) => `KES ${(cents / 100).toLocaleString()}`;
