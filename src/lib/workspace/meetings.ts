/**
 * STAGE 4 — CALENDAR & MEETING INTELLIGENCE.
 *
 * A meeting is not a diary entry: it is a workflow with three phases.
 *   BEFORE  — what you must know, drawn from that customer's live records.
 *   DURING  — the agenda the records themselves dictate.
 *   AFTER   — Meeting → Decision → Action → Owner → Deadline.
 *
 * Meetings are read from the authoritative work spine (a scheduled work item
 * whose recorded action is to hold a meeting). Nothing is invented: when a
 * customer has no live records, the preparation panel says so.
 *
 * Pure functions.
 */
import type { DecoratedWork } from "@/lib/orchestration/api";
import type { WorkspaceItem } from "./intelligence";

export interface ScheduledMeeting {
  workId: string;
  title: string;
  /** Customer / account label as recorded on the work item. */
  subject: string | null;
  accountId: string | null;
  /** Scheduled time from the work item's committed time. */
  startsAt: string | null;
  minutes: number;
  state: DecoratedWork["lifecycle_state"];
  phase: "before" | "due" | "after";
  requiredAction: string | null;
}

const MEETING_HINT = /\bmeeting\b|\bmeet\b|\bcall with\b|\bsite visit\b|\bpresentation\b/i;

/** A meeting is a work item whose recorded title or action is to meet someone. */
export function isMeetingWork(w: DecoratedWork): boolean {
  return MEETING_HINT.test(`${w.title} ${w.required_action ?? ""}`);
}

export function toMeeting(w: DecoratedWork, now: Date = new Date()): ScheduledMeeting {
  const startsAt = w.sla_due_at;
  const closed = w.lifecycle_state === "resolved" || w.lifecycle_state === "closed";
  const started = startsAt ? new Date(startsAt).getTime() <= now.getTime() : false;
  return {
    workId: w.id,
    title: w.title,
    subject: w.entity_ref ?? null,
    accountId: w.entity_type === "account" ? w.entity_id : null,
    startsAt,
    minutes: w.sla_minutes ?? 60,
    state: w.lifecycle_state,
    phase: closed || started ? "after" : startsAt && new Date(startsAt).toDateString() === now.toDateString() ? "due" : "before",
    requiredAction: w.required_action,
  };
}

export function listMeetings(work: readonly DecoratedWork[], now: Date = new Date()): ScheduledMeeting[] {
  return work
    .filter(isMeetingWork)
    .map((w) => toMeeting(w, now))
    .sort((a, b) => {
      if (a.startsAt && b.startsAt) return a.startsAt.localeCompare(b.startsAt);
      if (a.startsAt) return -1;
      if (b.startsAt) return 1;
      return a.title.localeCompare(b.title);
    });
}

export interface MeetingPreparation {
  /** Live records for the same customer that the meeting should cover. */
  related: WorkspaceItem[];
  /** What to know before walking in — one line per recorded fact. */
  knowBefore: string[];
  /** Agenda points the records demand. */
  agenda: string[];
  /** Stated when the customer has no live commercial records. */
  note: string | null;
}

export function prepareMeeting(meeting: ScheduledMeeting, items: readonly WorkspaceItem[]): MeetingPreparation {
  const key = meeting.subject?.trim().toLowerCase();
  const related = key
    ? items.filter((i) => (i.subject ?? "").trim().toLowerCase() === key || (meeting.accountId && i.accountId === meeting.accountId))
    : [];

  const knowBefore = related.map((i) => `${i.title} — ${i.why}${i.impact ? ` (${i.impact})` : ""}`);
  const agenda = related
    .filter((i) => i.signal !== "healthy")
    .slice(0, 5)
    .map((i) =>
      i.signal === "awaiting_customer"
        ? `Ask for the outstanding response: ${i.title}`
        : i.signal === "expiring"
          ? `Confirm or reissue before it lapses: ${i.title}`
          : i.signal === "stalled"
            ? `Unblock and agree a date: ${i.title}`
            : `Progress: ${i.title}`,
    );

  return {
    related,
    knowBefore,
    agenda,
    note:
      related.length === 0
        ? meeting.subject
          ? `No live opportunity, quote, contract or promise is recorded for ${meeting.subject}, so there is nothing to brief you on yet.`
          : "This meeting has no customer recorded against it, so no account context can be drawn."
        : null,
  };
}

/** Meeting → Decision → Action → Owner → Deadline. */
export interface MeetingOutcome {
  decision: string;
  action: string;
  /** Owner is always the recording employee — coordination, never authority. */
  ownerLabel: string;
  deadline: string | null;
  notes?: string | null;
}

export interface FollowUpDraft {
  title: string;
  requiredAction: string;
  priority: "critical" | "high" | "medium" | "low";
  minutes: number;
  dueAt: string | null;
  accountId: string | null;
  description: string;
}

/**
 * The follow-up a recorded outcome creates. This is what makes the queue update
 * itself after a meeting: the outcome becomes real work on the spine, and the
 * intelligence layer re-triages it on the next read.
 */
export function followUpFromOutcome(meeting: ScheduledMeeting, outcome: MeetingOutcome): FollowUpDraft {
  const who = meeting.subject ? ` — ${meeting.subject}` : "";
  const days = outcome.deadline ? Math.ceil((new Date(outcome.deadline).getTime() - Date.now()) / 86_400_000) : null;
  return {
    title: `${outcome.action.trim()}${who}`,
    requiredAction: outcome.action.trim(),
    priority: days != null && days <= 1 ? "high" : "medium",
    minutes: 20,
    dueAt: outcome.deadline,
    accountId: meeting.accountId,
    description: [
      `Agreed in: ${meeting.title}`,
      `Decision: ${outcome.decision.trim()}`,
      outcome.notes?.trim() ? `Notes: ${outcome.notes.trim()}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

export interface CalendarDay {
  date: string;
  label: string;
  meetings: ScheduledMeeting[];
}

export function groupByDay(meetings: readonly ScheduledMeeting[], locale = "en-KE"): CalendarDay[] {
  const map = new Map<string, ScheduledMeeting[]>();
  for (const m of meetings) {
    const date = m.startsAt ? m.startsAt.slice(0, 10) : "unscheduled";
    map.set(date, [...(map.get(date) ?? []), m]);
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] === "unscheduled" ? 1 : b[0] === "unscheduled" ? -1 : a[0].localeCompare(b[0])))
    .map(([date, list]) => ({
      date,
      label:
        date === "unscheduled"
          ? "No date recorded"
          : new Date(`${date}T00:00:00`).toLocaleDateString(locale, {
              weekday: "long",
              day: "numeric",
              month: "long",
            }),
      meetings: list,
    }));
}
