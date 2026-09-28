/**
 * Day Close report — a downloadable, evidence-only account of the working day.
 *
 * Pure: it turns already-recorded facts (work outcomes, focus effort actuals,
 * customer promises, queue movement) into a `ReportTable`, which the shared
 * exporter renders as CSV or PDF. Nothing is estimated in this file.
 */
import type { ReportTable } from "@/lib/corporate/executiveExports";
import type { SalesDayClose } from "@/lib/sales/dayClose";
import type { DecoratedWork } from "@/lib/orchestration/api";
import { isOpen } from "@/lib/orchestration/workLifecycle";
import type { FocusSession } from "./api";
import type { TomorrowPrep } from "./prepareTomorrow";
import { openReasonGroups } from "./prepareTomorrow";
import type {
  DayCloseSummary,
  PersonalCommitment,
  ReplanChange,
  ScoredPersonalWork,
} from "./personalOs";

export interface DayCloseReportInput {
  staffName: string | null;
  position: string | null;
  /** Commercial account of the day, when the person carries commercial work. */
  sales?: SalesDayClose | null;
  close: DayCloseSummary;
  work: DecoratedWork[];
  scored: ScoredPersonalWork[];
  commitments: PersonalCommitment[];
  sessions: FocusSession[];
  replan: ReplanChange[];
  /** Carry-forward plan — what remains open, why, and what moves to tomorrow. */
  tomorrow?: TomorrowPrep;
  now?: Date;
}

const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "");
const time = (iso: string | null | undefined) =>
  iso ? new Date(iso).toISOString().slice(11, 16) : "";

export function focusMinutesToday(sessions: FocusSession[]): number {
  return sessions.reduce((t, s) => t + (s.actual_minutes ?? 0), 0);
}

export function buildDayCloseReport(input: DayCloseReportInput): ReportTable {
  const now = input.now ?? new Date();
  const today = now.toISOString().slice(0, 10);
  const { close, work, commitments, sessions, replan, scored } = input;

  const completed = work.filter((w) => day(w.completed_at ?? w.closed_at) === today);
  const openWork = work.filter((w) => isOpen(w.lifecycle_state));
  const effort = focusMinutesToday(sessions);

  const rows: (string | number | null)[][] = [];

  // 1 — outcomes recorded today
  for (const w of completed) {
    const mine = sessions.filter((s) => s.work_item_id === w.id);
    rows.push([
      "Outcome",
      w.title,
      w.writeback_outcome ?? w.lifecycle_state,
      w.entity_ref ?? w.entity_id ?? "",
      mine.reduce((t, s) => t + (s.actual_minutes ?? 0), 0) || "",
      day(w.completed_at ?? w.closed_at),
    ]);
  }

  // 2 — focused effort actuals
  for (const s of sessions) {
    const w = work.find((x) => x.id === s.work_item_id);
    rows.push([
      "Focus session",
      w?.title ?? s.work_item_id,
      s.ended_at ? (s.interrupted ? "interrupted" : "closed") : "still running",
      s.outcome_note ?? "",
      s.actual_minutes ?? "",
      `${time(s.started_at)}–${time(s.ended_at)}`,
    ]);
  }

  // 3 — customer promises
  for (const c of commitments) {
    rows.push([
      "Promise",
      `${c.account_name ?? c.account_id}: ${c.commitment}`,
      c.status,
      c.expected_outcome ?? "",
      "",
      day(c.due_at) || "no date",
    ]);
  }

  // 4 — queue changes the engine proposed
  for (const r of replan) {
    rows.push(["Queue change", r.title, r.kind, r.detail, "", today]);
  }

  // 5 — tomorrow's opening moves
  for (const t of close.tomorrowFirstThree) {
    rows.push(["Tomorrow", t.title, "planned first", t.why, "", ""]);
  }

  // 6 — why work is still open, grouped by the recorded reason
  if (input.tomorrow) {
    for (const g of openReasonGroups(input.tomorrow)) {
      for (const item of g.items) {
        rows.push(["Still open", item.title, g.category, g.reason, "", today]);
      }
    }
    for (const c of input.tomorrow.carry) {
      rows.push([
        "Carry forward",
        c.title,
        c.alreadyScheduled ? "already scheduled" : "to schedule",
        c.why,
        c.effortMinutes,
        input.tomorrow.date,
      ]);
    }
    for (const p of input.tomorrow.promisesDueTomorrow) {
      rows.push([
        "Promise tomorrow",
        `${p.account ?? "customer"}: ${p.commitment}`,
        "due",
        "",
        "",
        input.tomorrow.date,
      ]);
    }
  }

  // 7 — blockers that stop an honest close
  for (const b of close.blockers) {
    rows.push(["Blocker", b, "unresolved", "", "", today]);
  }

  // 8 — the commercial account of the day, from the recorded lead history
  const sales = input.sales ?? null;
  if (sales) {
    for (const m of sales.today.movements) {
      rows.push([
        "Commercial movement",
        `${m.organisation ?? m.lead_ref ?? "customer"}${m.lead_ref ? ` (${m.lead_ref})` : ""}`,
        m.stage_to ?? m.action,
        m.note ?? "",
        "",
        time(m.at),
      ]);
    }
    for (const c of sales.sla.clocks) {
      rows.push([
        "Response clock",
        `${c.organisation ?? c.entity_ref ?? "customer"} · ${c.process}`,
        c.breached ? "overdue" : "running",
        c.escalation_level > 0 ? `escalated (level ${c.escalation_level})` : "",
        c.minutes_remaining,
        day(c.due_at),
      ]);
    }
    for (const a of sales.next_actions) {
      rows.push([
        "Next best action",
        `${a.organisation ?? a.lead_ref ?? "customer"}`,
        a.stage,
        a.why,
        "",
        a.due_at ? day(a.due_at) : "",
      ]);
    }
  }

  return {
    id: "day-close",
    title: "TaxiD · day close",
    subtitle: `${input.staffName ?? "Employee"}${input.position ? ` · ${input.position}` : ""} — ${today}`,
    meta: [
      ["Completed today", String(close.completedToday)],
      ["Still open", String(close.stillOpen)],
      ["Carried over", String(close.carriedOver)],
      ["Breached and open", String(close.breachedOpen)],
      ["Focused minutes recorded", String(effort)],
      ["Focus sessions", String(sessions.length)],
      ["Promises due tomorrow", String(close.promisesDueTomorrow)],
      ["Open work items", String(openWork.length)],
      ["Queue changes proposed", String(replan.length)],
      ["Next item tomorrow", scored[0]?.work.title ?? "none"],
      ["Carried into tomorrow", String(input.tomorrow?.carry.length ?? 0)],
      ["Tomorrow planned minutes", String(input.tomorrow?.plannedMinutes ?? 0)],
      ...(sales
        ? ([
            ["Enquiries opened today", String(sales.today.leads_created)],
            ["Stages advanced today", String(sales.today.stages_advanced)],
            ["Responses closed today", String(sales.today.clocks_completed)],
            [
              "Won today",
              sales.today.won_count
                ? `KSh ${Math.round(sales.today.revenue_won_kes).toLocaleString("en-KE")}`
                : "none",
            ],
            [
              "Month revenue",
              `KSh ${Math.round(sales.month.figures.revenue_won_kes).toLocaleString("en-KE")}`,
            ],
            [
              "Month target",
              sales.month.target_kes === null
                ? "not recorded"
                : `KSh ${Math.round(sales.month.target_kes).toLocaleString("en-KE")}`,
            ],
            [
              "Attainment",
              sales.month.attainment_pct === null ? "not stated" : `${sales.month.attainment_pct}%`,
            ],
            [
              "Open pipeline",
              `KSh ${Math.round(sales.month.figures.open_pipeline_kes).toLocaleString("en-KE")}`,
            ],
            [
              "Weighted pipeline",
              `KSh ${Math.round(sales.month.figures.weighted_pipeline_kes).toLocaleString("en-KE")}`,
            ],
            ["Response clocks running", String(sales.sla.open)],
            ["Response clocks overdue", String(sales.sla.breached)],
            ["Escalated to manager", String(sales.sla.escalated)],
            ["Commercial next actions placed", String(sales.tasks_placed)],
          ] as [string, string][])
        : ([["Commercial day close", "no commercial records for this employee"]] as [string, string][])),
    ],
    columns: ["Section", "Item", "State", "Detail", "Minutes", "When"],
    rows,
  };
}
