/**
 * Customer Operations — conversation triage.
 *
 * Gives every unified conversation thread (email, live chat, WhatsApp, SMS,
 * phone log, portal, AI chat) one consistent status, priority and
 * next-best-action so agents work a single queue instead of channel silos.
 *
 * Deterministic and dependency-free.
 */
import {
  CHANNEL_BY_ID,
  type ConversationThread,
} from "./channels";

export type ThreadStatus =
  | "new"
  | "awaiting_agent"
  | "awaiting_customer"
  | "in_progress"
  | "resolved";

export type ThreadPriority = "urgent" | "high" | "medium" | "low";

export const THREAD_STATUS_LABEL: Record<ThreadStatus, string> = {
  new: "New",
  awaiting_agent: "Awaiting agent",
  awaiting_customer: "Awaiting customer",
  in_progress: "In progress",
  resolved: "Resolved",
};

export interface ThreadTriage {
  key: string;
  status: ThreadStatus;
  priority: ThreadPriority;
  /** Minutes since the last customer message went unanswered (0 when answered). */
  waitingMinutes: number;
  /** Single recommended next step for the agent. */
  nextBestAction: string;
  /** Why the priority landed where it did. */
  reasons: string[];
  /** Channel the reply should go out on (last realtime/inbound channel). */
  replyChannel: string;
  slaAtRisk: boolean;
}

const URGENT_TERMS = [
  "accident", "crash", "assault", "unsafe", "stranded", "police",
  "lawyer", "legal", "fraud", "stolen", "hospital", "emergency",
];
const HIGH_TERMS = [
  "refund", "charged", "double", "overcharge", "cancel", "delay",
  "late", "missing", "invoice", "driver", "complaint", "escalate",
];

const textOf = (t: ConversationThread): string =>
  [t.subject, ...t.interactions.map((i) => `${i.subject ?? ""} ${i.body ?? ""}`)]
    .join(" ")
    .toLowerCase();

/** Minutes the customer has been waiting on an agent reply. */
export function waitingMinutes(t: ConversationThread, now = Date.now()): number {
  if (!t.awaitingReply) return 0;
  return Math.max(0, Math.round((now - Date.parse(t.lastAt)) / 60_000));
}

/**
 * Derives the consistent triage view for one thread.
 *
 * Priority blends waiting time, realtime channel pressure, cross-channel
 * repetition (a customer chasing on three channels is escalating) and
 * risk language in the conversation body.
 */
export function triageThread(t: ConversationThread, now = Date.now()): ThreadTriage {
  const waiting = waitingMinutes(t, now);
  const realtime = t.channels.some((c) => CHANNEL_BY_ID.get(c)?.realtime);
  const haystack = textOf(t);
  const reasons: string[] = [];

  const urgentHit = URGENT_TERMS.find((w) => haystack.includes(w));
  const highHit = HIGH_TERMS.find((w) => haystack.includes(w));

  let score = 0;
  if (urgentHit) { score += 60; reasons.push(`safety/legal language: "${urgentHit}"`); }
  if (highHit) { score += 20; reasons.push(`commercial impact: "${highHit}"`); }
  if (realtime && t.awaitingReply) { score += 25; reasons.push("live channel awaiting reply"); }
  if (t.crossChannel) { score += 15; reasons.push(`chasing on ${t.channels.length} channels`); }
  if (waiting >= 240) { score += 30; reasons.push(`waiting ${waiting} min`); }
  else if (waiting >= 60) { score += 15; reasons.push(`waiting ${waiting} min`); }
  if (t.inbound >= 3 && t.outbound === 0) { score += 20; reasons.push("no agent response yet"); }

  const priority: ThreadPriority =
    score >= 70 ? "urgent" : score >= 40 ? "high" : score >= 15 ? "medium" : "low";

  const status: ThreadStatus = t.awaitingReply
    ? t.outbound === 0
      ? "new"
      : "awaiting_agent"
    : t.caseIds.length > 0
      ? "in_progress"
      : "awaiting_customer";

  const slaAtRisk =
    t.awaitingReply && ((realtime && waiting >= 5) || waiting >= 60 || priority === "urgent");

  const replyChannel =
    [...t.interactions].reverse().find((i) => i.direction === "inbound")?.channel ??
    t.interactions[t.interactions.length - 1]?.channel ??
    "email";

  const nextBestAction = nextAction({ t, status, priority, waiting, realtime, urgentHit, highHit });

  return { key: t.key, status, priority, waitingMinutes: waiting, nextBestAction, reasons, replyChannel, slaAtRisk };
}

function nextAction(args: {
  t: ConversationThread;
  status: ThreadStatus;
  priority: ThreadPriority;
  waiting: number;
  realtime: boolean;
  urgentHit?: string;
  highHit?: string;
}): string {
  const { t, status, priority, waiting, realtime, urgentHit, highHit } = args;
  if (urgentHit) return "Escalate to Trust & Safety now and acknowledge on the live channel.";
  if (t.caseIds.length === 0 && status !== "awaiting_customer") {
    return "Create a support case so the SLA clock and audit trail start.";
  }
  if (realtime && status !== "awaiting_customer" && waiting >= 5) {
    return "Reply on the live channel — realtime response target is 5 minutes.";
  }
  if (priority === "urgent" || priority === "high") {
    return highHit?.match(/refund|charged|double|overcharge|invoice/)
      ? "Verify the payment ledger, then send a resolution with the refund decision."
      : "Send a substantive update with a committed resolution time.";
  }
  if (status === "awaiting_customer") return "Awaiting customer — follow up if quiet for 24 hours.";
  if (t.crossChannel) return "Consolidate onto one channel and confirm the merged thread with the customer.";
  return "Acknowledge and set expectations for the next update.";
}

export interface TriageQueueRow extends ThreadTriage {
  thread: ConversationThread;
}

const PRIORITY_RANK: Record<ThreadPriority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

/** Triage every thread and sort into the working order agents should follow. */
export function triageQueue(threads: ConversationThread[], now = Date.now()): TriageQueueRow[] {
  return threads
    .map((t) => ({ ...triageThread(t, now), thread: t }))
    .sort(
      (a, b) =>
        PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
        b.waitingMinutes - a.waitingMinutes,
    );
}

/** Counts for the triage status strip. */
export function triageSummary(rows: TriageQueueRow[]) {
  return {
    total: rows.length,
    urgent: rows.filter((r) => r.priority === "urgent").length,
    awaitingAgent: rows.filter((r) => r.status === "new" || r.status === "awaiting_agent").length,
    slaAtRisk: rows.filter((r) => r.slaAtRisk).length,
    longestWaitMinutes: rows.reduce((m, r) => Math.max(m, r.waitingMinutes), 0),
  };
}
