/**
 * STAGE 7 — COMMAND CENTRE INDEX (Ctrl/Cmd + K).
 *
 * One keystroke, one index. The palette searches the SAME authoritative records
 * the queue triages — opportunities, quotes, contracts, meetings, work items —
 * plus the workspace destinations. It never invents a record and never returns
 * something the account was not allowed to read: withheld domains are simply
 * absent, and the caller declares them.
 *
 * Pure functions only.
 */
import type { WorkspaceItem } from "./intelligence";
import type { MyContract, MyOpportunity, MyQuote } from "./lenses";
import type { ScheduledMeeting } from "./meetings";
import type { InboxEmail } from "./inbox";

export type CommandKind = "opportunity" | "quote" | "contract" | "meeting" | "email" | "work" | "destination";

export interface CommandEntry {
  id: string;
  kind: CommandKind;
  /** Primary searchable label. */
  label: string;
  /** Context line: customer, status, date — only what the record stated. */
  sublabel: string | null;
  /** Extra searchable terms (reference numbers, customer, status). */
  keywords: string[];
  /** Where selecting it goes — always a system of record or a real surface. */
  to: string;
  /** Small right-hand tag, e.g. a stage or status. */
  tag: string | null;
}

export const COMMAND_KIND_LABEL: Record<CommandKind, string> = {
  opportunity: "Opportunities",
  quote: "Quotes & proposals",
  contract: "Contracts",
  meeting: "Meetings",
  email: "Mail",
  work: "My work queue",
  destination: "Go to",
};

const clean = (value: string | null | undefined): string[] => (value ? [value] : []);

const dateLabel = (iso: string | null): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

export const WORKSPACE_DESTINATIONS: CommandEntry[] = [
  {
    id: "dest:book",
    kind: "destination",
    label: "Commercial book",
    sublabel: "Create accounts, opportunities, proposals, contracts and service orders",
    keywords: ["new", "create", "account", "deal", "proposal", "contract", "order", "book"],
    to: "/staff/workspace/book",
    tag: null,
  },
  {
    id: "dest:work-queue",
    kind: "destination",
    label: "Work queue",
    sublabel: "Everything triaged for you now",
    keywords: ["now", "today", "queue", "priorities", "tasks"],
    to: "/staff/workspace/work-queue",
    tag: null,
  },
  {
    id: "dest:exceptions",
    kind: "destination",
    label: "Exception centre",
    sublabel: "What has left its expected path",
    keywords: ["risk", "overdue", "breach", "escalation", "problems"],
    to: "/staff/workspace/exceptions",
    tag: null,
  },
  {
    id: "dest:meetings",
    kind: "destination",
    label: "Meetings",
    sublabel: "Prepare, run and record outcomes",
    keywords: ["calendar", "agenda", "call", "visit"],
    to: "/staff/workspace/meetings",
    tag: null,
  },
  {
    id: "dest:inbox",
    kind: "destination",
    label: "Inbox",
    sublabel: "Your real mail, with sender, subject and body",
    keywords: ["email", "mail", "messages", "inbox"],
    to: "/staff/workspace/inbox",
    tag: null,
  },
  {
    id: "dest:accounts",
    kind: "destination",
    label: "My commercial book",
    sublabel: "Accounts, opportunities, quotes, contracts",
    keywords: ["accounts", "customers", "pipeline", "lenses"],
    to: "/staff/workspace",
    tag: null,
  },
];

export interface CommandIndexInput {
  items?: WorkspaceItem[];
  opportunities?: MyOpportunity[];
  quotes?: MyQuote[];
  contracts?: MyContract[];
  meetings?: ScheduledMeeting[];
  emails?: InboxEmail[];
  /** Include workspace destinations. Defaults to true. */
  destinations?: boolean;
}

export function buildCommandIndex(input: CommandIndexInput): CommandEntry[] {
  const entries: CommandEntry[] = [];

  for (const o of input.opportunities ?? []) {
    entries.push({
      id: `opportunity:${o.id}`,
      kind: "opportunity",
      label: o.title,
      sublabel: [o.customer, o.value].filter(Boolean).join(" · ") || null,
      keywords: [...clean(o.ref), ...clean(o.customer), o.stage, ...o.signals.map((s) => s.label)],
      to: o.sourcePath,
      tag: o.stage,
    });
  }

  for (const q of input.quotes ?? []) {
    entries.push({
      id: `quote:${q.id}`,
      kind: "quote",
      label: q.number ? `Quote ${q.number}` : "Quotation",
      sublabel: [q.value, q.validUntil ? `valid to ${dateLabel(q.validUntil)}` : null].filter(Boolean).join(" · ") || null,
      keywords: [...clean(q.number), q.status, ...clean(q.approvalStatus), ...q.signals.map((s) => s.label), "quote", "proposal"],
      to: q.sourcePath,
      tag: q.status,
    });
  }

  for (const c of input.contracts ?? []) {
    entries.push({
      id: `contract:${c.id}`,
      kind: "contract",
      label: c.customer ? `Contract — ${c.customer}` : "Contract",
      sublabel: [c.term, c.effectiveDate ? `effective ${dateLabel(c.effectiveDate)}` : null].filter(Boolean).join(" · ") || null,
      keywords: [...clean(c.customer), c.status, ...c.signals.map((s) => s.label), "contract", "agreement"],
      to: c.sourcePath,
      tag: c.status,
    });
  }

  for (const m of input.meetings ?? []) {
    entries.push({
      id: `meeting:${m.workId}`,
      kind: "meeting",
      label: m.title,
      sublabel: [m.subject, m.startsAt ? dateLabel(m.startsAt) : null].filter(Boolean).join(" · ") || null,
      keywords: [...clean(m.subject), ...clean(m.requiredAction), m.phase, "meeting"],
      to: `/staff/workspace/meetings?work=${m.workId}`,
      tag: m.phase === "after" ? "Record outcome" : m.phase === "due" ? "Now" : "Upcoming",
    });
  }

  for (const item of input.items ?? []) {
    entries.push({
      id: `work:${item.key}`,
      kind: "work",
      label: item.title,
      sublabel: [item.subject, item.why].filter(Boolean).join(" · ") || null,
      keywords: [...clean(item.subject), item.signal.replace(/_/g, " "), item.lane, item.tier],
      to: item.primaryAction.to,
      tag: item.lane === "now" ? "Now" : item.lane === "waiting" ? "Waiting" : "Upcoming",
    });
  }

  for (const e of input.emails ?? []) {
    entries.push({
      id: `email:${e.threadId}`,
      kind: "email",
      label: e.subject,
      sublabel:
        [e.senderName || e.senderEmail, dateLabel(e.receivedAt)].filter(Boolean).join(" · ") || null,
      keywords: [
        ...clean(e.senderName),
        ...clean(e.senderEmail),
        e.mailbox,
        e.mailboxName,
        e.category,
        e.status,
        "email",
        "mail",
        "inbox",
      ],
      to: `/staff/workspace/inbox?thread=${e.threadId}`,
      tag: e.unread ? "Unread" : null,
    });
  }

  if (input.destinations !== false) entries.push(...WORKSPACE_DESTINATIONS);

  // De-duplicate: the same record can arrive from a lens and from the queue.
  const seen = new Set<string>();
  return entries.filter((e) => {
    const fingerprint = `${e.kind}|${e.label.toLowerCase()}|${e.to}`;
    if (seen.has(fingerprint)) return false;
    seen.add(fingerprint);
    return true;
  });
}

const KIND_WEIGHT: Record<CommandKind, number> = {
  opportunity: 6,
  quote: 5,
  contract: 5,
  meeting: 4,
  email: 4,
  work: 3,
  destination: 1,
};

/** Deterministic relevance: prefix beats word-start beats contains. */
export function scoreEntry(entry: CommandEntry, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return KIND_WEIGHT[entry.kind];
  const label = entry.label.toLowerCase();
  const haystacks = [label, (entry.sublabel ?? "").toLowerCase(), ...entry.keywords.map((k) => k.toLowerCase())];

  let best = 0;
  if (label === q) best = 100;
  else if (label.startsWith(q)) best = 80;
  else if (label.includes(` ${q}`)) best = 65;
  else if (label.includes(q)) best = 50;

  if (best === 0) {
    for (const h of haystacks.slice(1)) {
      if (h.startsWith(q)) best = Math.max(best, 40);
      else if (h.includes(q)) best = Math.max(best, 25);
    }
  }

  // Every query token must appear somewhere, so "acme quote" narrows properly.
  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length > 1) {
    const all = haystacks.join(" ");
    if (!tokens.every((t) => all.includes(t))) return 0;
    best = Math.max(best, 45);
  }

  return best === 0 ? 0 : best + KIND_WEIGHT[entry.kind];
}

export interface CommandGroup {
  kind: CommandKind;
  label: string;
  entries: CommandEntry[];
}

/** Search and group. Empty query returns the most useful starting set. */
export function searchCommands(index: CommandEntry[], query: string, limit = 24): CommandGroup[] {
  const scored = index
    .map((entry) => ({ entry, score: scoreEntry(entry, query) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.label.localeCompare(b.entry.label))
    .slice(0, limit);

  const order: CommandKind[] = ["work", "email", "opportunity", "quote", "contract", "meeting", "destination"];
  const groups: CommandGroup[] = [];
  for (const kind of order) {
    const entries = scored.filter((r) => r.entry.kind === kind).map((r) => r.entry);
    if (entries.length > 0) groups.push({ kind, label: COMMAND_KIND_LABEL[kind], entries });
  }
  return groups;
}
