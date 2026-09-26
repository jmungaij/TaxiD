/**
 * STAGE 24 — EXCEPTION CENTRE.
 *
 * An exception is a record that has left its expected path: a deal that stopped
 * moving, a customer we owe something to and are late on, a contract or price
 * about to lapse, work that breached its committed time. The centre does not
 * hold state — it is a prioritised lens over the canonical work model, so
 * resolving an exception in its system of record removes it here.
 *
 * Pure functions. Every exception carries the evidence that produced it.
 */
import type { SignalKind, WorkspaceItem } from "./intelligence";

export type ExceptionClass =
  | "customer_promise_broken"
  | "commitment_breached"
  | "stalled_opportunity"
  | "expiring_commercial"
  | "blocked_decision"
  | "missing_next_action"
  | "unowned_record";

export const EXCEPTION_CLASS_LABEL: Record<ExceptionClass, string> = {
  customer_promise_broken: "Customer promise not kept",
  commitment_breached: "Committed time breached",
  stalled_opportunity: "Opportunity stopped moving",
  expiring_commercial: "Price or contract about to lapse",
  blocked_decision: "Decision blocking others",
  missing_next_action: "No next step recorded",
  unowned_record: "Nobody owns it",
};

/** How the customer experiences it — used to surface unhappy customers first. */
export const CUSTOMER_FACING: Record<ExceptionClass, boolean> = {
  customer_promise_broken: true,
  commitment_breached: true,
  stalled_opportunity: false,
  expiring_commercial: true,
  blocked_decision: false,
  missing_next_action: false,
  unowned_record: false,
};

const CLASS_OF: Partial<Record<SignalKind, ExceptionClass>> = {
  overdue: "customer_promise_broken",
  sla_risk: "commitment_breached",
  stalled: "stalled_opportunity",
  expiring: "expiring_commercial",
  decision_required: "blocked_decision",
  no_next_action: "missing_next_action",
  unowned: "unowned_record",
};

const CLASS_WEIGHT: Record<ExceptionClass, number> = {
  customer_promise_broken: 100,
  commitment_breached: 88,
  expiring_commercial: 74,
  blocked_decision: 70,
  stalled_opportunity: 60,
  missing_next_action: 40,
  unowned_record: 34,
};

export type ExceptionSeverity = "act_now" | "act_today" | "monitor";

export interface WorkspaceException {
  key: string;
  exceptionClass: ExceptionClass;
  customerFacing: boolean;
  /** Account / customer label as recorded, or null when the record has none. */
  customer: string | null;
  title: string;
  why: string;
  consequence: string;
  /** 0-100 intervention priority — class weight plus the item's own urgency. */
  priority: number;
  severity: ExceptionSeverity;
  dueAt: string | null;
  impact: string | null;
  action: { label: string; to: string };
  evidence: { fact: string; from: string }[];
  item: WorkspaceItem;
}

export function toException(item: WorkspaceItem): WorkspaceException | null {
  const exceptionClass = CLASS_OF[item.signal];
  if (!exceptionClass) return null;
  const priority = Math.max(0, Math.min(100, Math.round(CLASS_WEIGHT[exceptionClass] * 0.7 + item.urgency * 0.3)));
  return {
    key: item.key,
    exceptionClass,
    customerFacing: CUSTOMER_FACING[exceptionClass],
    customer: item.subject,
    title: item.title,
    why: item.why,
    consequence: item.consequence ?? "Left alone it keeps degrading the record's chance of a good outcome.",
    priority,
    severity: priority >= 80 ? "act_now" : priority >= 55 ? "act_today" : "monitor",
    dueAt: item.dueAt,
    impact: item.impact,
    action: item.primaryAction,
    evidence: item.evidence,
    item,
  };
}

export interface ExceptionAccount {
  customer: string;
  exceptions: WorkspaceException[];
  /** Worst severity present for this customer. */
  severity: ExceptionSeverity;
  /** True when at least one exception is felt by the customer. */
  unhappy: boolean;
}

export interface ExceptionRegister {
  items: WorkspaceException[];
  actNow: number;
  /** Exceptions the customer can feel — the "unhappy customers" view. */
  customerFacing: WorkspaceException[];
  byClass: { exceptionClass: ExceptionClass; label: string; count: number }[];
  accounts: ExceptionAccount[];
  headline: string;
}

const SEVERITY_RANK: Record<ExceptionSeverity, number> = { act_now: 3, act_today: 2, monitor: 1 };

export function buildExceptionRegister(items: readonly WorkspaceItem[]): ExceptionRegister {
  const exceptions = items
    .map(toException)
    .filter((e): e is WorkspaceException => e !== null)
    .sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title));

  const counts = new Map<ExceptionClass, number>();
  for (const e of exceptions) counts.set(e.exceptionClass, (counts.get(e.exceptionClass) ?? 0) + 1);

  const accountMap = new Map<string, WorkspaceException[]>();
  for (const e of exceptions) {
    if (!e.customer) continue;
    accountMap.set(e.customer, [...(accountMap.get(e.customer) ?? []), e]);
  }

  const accounts: ExceptionAccount[] = [...accountMap.entries()]
    .map(([customer, list]) => ({
      customer,
      exceptions: list,
      severity: list.reduce<ExceptionSeverity>(
        (worst, e) => (SEVERITY_RANK[e.severity] > SEVERITY_RANK[worst] ? e.severity : worst),
        "monitor",
      ),
      unhappy: list.some((e) => e.customerFacing),
    }))
    .sort(
      (a, b) =>
        SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
        b.exceptions.length - a.exceptions.length ||
        a.customer.localeCompare(b.customer),
    );

  const actNow = exceptions.filter((e) => e.severity === "act_now").length;
  const customerFacing = exceptions.filter((e) => e.customerFacing);
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return {
    items: exceptions,
    actNow,
    customerFacing,
    byClass: [...counts.entries()]
      .sort((a, b) => CLASS_WEIGHT[b[0]] - CLASS_WEIGHT[a[0]])
      .map(([exceptionClass, count]) => ({ exceptionClass, label: EXCEPTION_CLASS_LABEL[exceptionClass], count })),
    accounts,
    headline:
      exceptions.length === 0
        ? "No record in your book has left its expected path."
        : `${actNow} of ${exceptions.length} exception(s) need action now${
            dominant ? `; ${EXCEPTION_CLASS_LABEL[dominant].toLowerCase()} is the most common cause` : ""
          }.`,
  };
}
