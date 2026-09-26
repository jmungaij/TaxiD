/**
 * Order activity model — read from the database, never hand-rolled in the UI.
 *
 * `logistics_order_activities` and `logistics_order_activity_transitions` are
 * the authoritative transition matrix. The server RPC
 * `logistics_order_set_activity` enforces the same rows, so the UI can only
 * ever *offer* a transition the server will accept — it can never invent one.
 */
import { supabase } from "@/integrations/supabase/client";

export interface OrderActivity {
  code: string;
  label: string;
  description: string | null;
  sequence: number;
  terminal: boolean;
  exceptionState: boolean;
}

export interface ActivityTransition {
  from: string;
  to: string;
  requiresReason: boolean;
  warning: string | null;
  event: string;
}

export interface ActivityModel {
  activities: OrderActivity[];
  transitions: ActivityTransition[];
}

export const EMPTY_ACTIVITY_MODEL: ActivityModel = { activities: [], transitions: [] };

export async function loadActivityModel(): Promise<ActivityModel> {
  const [{ data: activities, error: aErr }, { data: transitions, error: tErr }] = await Promise.all([
    supabase
      .from("logistics_order_activities")
      .select("code,label,description,sequence,terminal,exception_state")
      .order("sequence", { ascending: true }),
    supabase
      .from("logistics_order_activity_transitions")
      .select("from_code,to_code,requires_reason,warning,event_name"),
  ]);
  if (aErr) throw aErr;
  if (tErr) throw tErr;
  return {
    activities: (activities ?? []).map((a) => ({
      code: a.code,
      label: a.label,
      description: a.description,
      sequence: a.sequence,
      terminal: a.terminal,
      exceptionState: a.exception_state,
    })),
    transitions: (transitions ?? []).map((t) => ({
      from: t.from_code,
      to: t.to_code,
      requiresReason: t.requires_reason,
      warning: t.warning,
      event: t.event_name,
    })),
  };
}

export function activityLabel(model: ActivityModel, code: string | null | undefined): string {
  if (!code) return "—";
  return model.activities.find((a) => a.code === code)?.label ?? code;
}

export function transitionFor(
  model: ActivityModel,
  from: string,
  to: string,
): ActivityTransition | null {
  return model.transitions.find((t) => t.from === from && t.to === to) ?? null;
}

export interface BulkTarget {
  activity: OrderActivity;
  /** How many of the selected orders may legally move to this activity. */
  eligible: number;
  /** Selected orders already sitting in the target activity. */
  alreadyThere: number;
  /** Selected orders whose current activity forbids the move. */
  blocked: number;
  requiresReason: boolean;
  warnings: string[];
}

/**
 * Candidate bulk targets for a mixed selection. An activity is offered when at
 * least one selected order can legally reach it; per-order legality is still
 * re-validated server-side for every single item.
 */
export function bulkTargets(model: ActivityModel, currentActivities: string[]): BulkTarget[] {
  return model.activities
    .map((activity) => {
      let eligible = 0;
      let alreadyThere = 0;
      let blocked = 0;
      let requiresReason = false;
      const warnings = new Set<string>();
      for (const current of currentActivities) {
        if (current === activity.code) {
          alreadyThere += 1;
          continue;
        }
        const t = transitionFor(model, current, activity.code);
        if (!t) {
          blocked += 1;
          continue;
        }
        eligible += 1;
        if (t.requiresReason) requiresReason = true;
        if (t.warning) warnings.add(t.warning);
      }
      return { activity, eligible, alreadyThere, blocked, requiresReason, warnings: [...warnings] };
    })
    .filter((t) => t.eligible > 0);
}

/** Operator-facing copy for the structured error codes returned by the RPCs. */
export const ACTIVITY_ERROR_COPY: Record<string, string> = {
  VALIDATION_ERROR: "The request was rejected as invalid.",
  AUTHORIZATION_ERROR: "You are not permitted to perform this operation.",
  NOT_FOUND: "Order not found.",
  TENANT_MISMATCH: "This order belongs to another account.",
  INVALID_TRANSITION: "That activity change is not allowed from the current activity.",
  ALREADY_IN_TARGET_STATE: "The order is already in this activity.",
  CONFLICT: "The order changed while the operation was running.",
  DUPLICATE: "Already applied — the duplicate submission was ignored.",
  PROVIDER_ERROR: "An operational service failed. Please retry.",
  TIMEOUT: "The operation timed out before the server confirmed it.",
  RATE_LIMIT: "Too many operations at once. Retry the failed rows shortly.",
  RETRYABLE_FAILURE: "A temporary failure occurred. Retrying is safe.",
  PERMANENT_FAILURE: "This row cannot be processed and will not succeed on retry.",
};

export function activityErrorCopy(code: string | null | undefined, fallback?: string | null): string {
  if (!code) return fallback || "The operation failed.";
  return ACTIVITY_ERROR_COPY[code] ?? fallback ?? code;
}

const RETRYABLE = new Set(["TIMEOUT", "PROVIDER_ERROR", "RATE_LIMIT", "RETRYABLE_FAILURE", "CONFLICT"]);

export function isRetryable(code: string | null | undefined): boolean {
  return !!code && RETRYABLE.has(code);
}
