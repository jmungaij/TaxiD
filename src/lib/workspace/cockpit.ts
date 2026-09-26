/**
 * Personal Operating System — role adaptation, approvals, change digest and the
 * deterministic Ask SAFARID answering layer.
 *
 * Every function here is PURE and derives its answer from records the employee
 * already owns. Nothing is invented, guessed or fetched from a model.
 */
import type { DecoratedWork } from "@/lib/orchestration/api";
import { dueLabel, humanizeMinutes, relativeTime } from "./humanTime";
import type {
  AccountMomentum,
  DayPlan,
  FocusTarget,
  PersonalCommitment,
  ScoredPersonalWork,
  WaitingCustomer,
} from "./personalOs";

/* ----------------------------------------------------------- role adaptation */

export type RoleProfileKey = "commercial" | "operations" | "finance" | "general";

export interface RoleProfile {
  key: RoleProfileKey;
  label: string;
  /** What this role should see first, in order. */
  emphasis: string[];
  /** Queue / work-kind fragments that matter most to this role. */
  signals: string[];
}

export const ROLE_PROFILES: Record<RoleProfileKey, RoleProfile> = {
  commercial: {
    key: "commercial",
    label: "Commercial",
    emphasis: ["Customers", "Opportunities", "Meetings", "Follow-ups", "Commitments", "Proposals", "Revenue"],
    signals: ["commercial", "crm", "sales", "quotation", "opportunity", "contract", "account", "customer"],
  },
  operations: {
    key: "operations",
    label: "Operations",
    emphasis: ["Exceptions", "Active services", "SLA", "Supply", "Incidents", "Capacity"],
    signals: ["ops", "dispatch", "incident", "exception", "trip", "fleet", "driver", "sla", "supply"],
  },
  finance: {
    key: "finance",
    label: "Finance",
    emphasis: ["Approvals", "Reconciliation", "Receivables", "Settlements", "Exceptions", "Cash exposure"],
    signals: ["finance", "payment", "settlement", "reconcil", "invoice", "refund", "dispute", "tax", "wallet"],
  },
  general: {
    key: "general",
    label: "Operating",
    emphasis: ["Now", "Next", "Today", "Waiting", "Approvals", "Capacity"],
    signals: [],
  },
};

/** Resolves the role profile from the employee's recorded position/unit/roles. */
export function resolveRoleProfile(
  input: { position?: string | null; unit?: string | null; roles?: string[] } = {},
): RoleProfile {
  const hay = [input.position, input.unit, ...(input.roles ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (!hay) return ROLE_PROFILES.general;
  const order: RoleProfileKey[] = ["finance", "commercial", "operations"];
  for (const key of order) {
    if (ROLE_PROFILES[key].signals.some((s) => hay.includes(s))) return ROLE_PROFILES[key];
  }
  if (/sale|account manager|business development|partnership/.test(hay)) return ROLE_PROFILES.commercial;
  if (/operation|control|noc|logistic/.test(hay)) return ROLE_PROFILES.operations;
  return ROLE_PROFILES.general;
}

/** Deterministic role emphasis: matching work sorts ahead at equal urgency. */
export function roleEmphasisWeight(work: DecoratedWork, profile: RoleProfile): number {
  if (!profile.signals.length) return 0;
  const hay = [work.ops_queue, work.work_kind, work.service_line, work.entity_type, work.title]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return profile.signals.some((s) => hay.includes(s)) ? 1 : 0;
}

/** Reorders scored work for the role without changing the recorded scores. */
export function applyRoleEmphasis(
  scored: ScoredPersonalWork[],
  profile: RoleProfile,
): ScoredPersonalWork[] {
  return [...scored].sort((a, b) => {
    const breach = (s: ScoredPersonalWork) => (s.work.sla.status === "breached" ? 1 : 0);
    if (breach(b) !== breach(a)) return breach(b) - breach(a);
    const w = roleEmphasisWeight(b.work, profile) - roleEmphasisWeight(a.work, profile);
    if (w !== 0) return w;
    return b.score - a.score || a.effortMinutes - b.effortMinutes;
  });
}

/* -------------------------------------------------------- priority confidence */

export type Confidence = "High" | "Medium" | "Low";

/**
 * Confidence replaces the raw score in the UI: it reflects how many independent
 * recorded factors agree, plus whether the item can actually be acted on now.
 */
export function priorityConfidence(scored: ScoredPersonalWork | null): {
  level: Confidence;
  because: string;
} {
  if (!scored) return { level: "Low", because: "No prioritised work is currently assigned to you." };
  const positive = scored.contributions.filter((c) => c.points > 0);
  const unknown = scored.contributions.some((c) => c.factor === "missing_next_action");
  if (positive.length >= 3 && !unknown)
    return { level: "High", because: `${positive.length} recorded factors agree on this item.` };
  if (positive.length >= 2)
    return {
      level: "Medium",
      because: unknown
        ? "Several factors agree, but no next action is recorded yet."
        : `${positive.length} recorded factors agree on this item.`,
    };
  return {
    level: "Low",
    because: "Only one recorded factor supports this ranking — confirm before committing time.",
  };
}

/* ------------------------------------------------------------------ approvals */

export interface ApprovalItem {
  work: DecoratedWork;
  requestedAgo: string;
  reason: string;
}

/** Work waiting on THIS employee's decision — never a duplicate approval store. */
export function approvalQueue(work: DecoratedWork[]): ApprovalItem[] {
  return work
    .filter((w) => w.needs_approval && (w.approval_state === "requested" || w.approval_state === "pending"))
    .map((w) => ({
      work: w,
      requestedAgo: relativeTime(w.approval_requested_at ?? w.created_at),
      reason: w.approval_reason ?? w.required_action ?? "Decision required before this work can proceed.",
    }));
}

/* ------------------------------------------------- since your last session */

export interface SessionChange {
  label: string;
  detail: string;
  tone: "info" | "warning" | "success";
  workId?: string;
}

/** Only materially meaningful changes since the employee's previous session. */
export function changesSinceLastSession(
  work: DecoratedWork[],
  commitments: PersonalCommitment[],
  sinceIso: string | null,
  now: Date = new Date(),
): SessionChange[] {
  if (!sinceIso) return [];
  const since = new Date(sinceIso).getTime();
  if (Number.isNaN(since)) return [];
  const changes: SessionChange[] = [];

  const fresh = work.filter((w) => new Date(w.created_at).getTime() > since);
  if (fresh.length)
    changes.push({
      label: "New work",
      detail: `${fresh.length} item${fresh.length === 1 ? "" : "s"} were assigned to you.`,
      tone: "info",
      workId: fresh[0].id,
    });

  const breached = work.filter((w) => w.sla.status === "breached");
  if (breached.length)
    changes.push({
      label: "Commitment overdue",
      detail: `${breached.length} item${breached.length === 1 ? "" : "s"} passed their committed time.`,
      tone: "warning",
      workId: breached[0].id,
    });

  const approvals = approvalQueue(work);
  if (approvals.length)
    changes.push({
      label: "Decision required",
      detail: `${approvals.length} item${approvals.length === 1 ? "" : "s"} await your approval.`,
      tone: "warning",
      workId: approvals[0].work.id,
    });

  const kept = commitments.filter(
    (c) => c.status === "fulfilled" && !!c.due_at && new Date(c.due_at).getTime() > since,
  );
  if (kept.length)
    changes.push({
      label: "Promises kept",
      detail: `${kept.length} customer promise${kept.length === 1 ? "" : "s"} closed out.`,
      tone: "success",
    });

  const dueNow = commitments.filter(
    (c) => (c.status === "open" || c.status === "in_progress") && c.due_at && new Date(c.due_at) <= now,
  );
  if (dueNow.length)
    changes.push({
      label: "Customers waiting",
      detail: `${dueNow.length} promise${dueNow.length === 1 ? "" : "s"} are past the time you committed.`,
      tone: "warning",
    });

  return changes;
}

/* ------------------------------------------------------- structured outcomes */

export const WORK_OUTCOMES = [
  "Customer responded",
  "Procurement reviewing",
  "Pricing requested",
  "Negotiation requested",
  "Clarification requested",
  "Contract amendment requested",
  "Meeting scheduled",
  "No response",
  "Not interested",
  "Other",
] as const;

export type WorkOutcome = (typeof WORK_OUTCOMES)[number];

/** Whether the recorded outcome means the business process still needs a push. */
export function outcomeNeedsNextAction(outcome: WorkOutcome): boolean {
  return outcome !== "Not interested";
}

/** The next action the orchestration layer recommends for a recorded outcome. */
export function recommendedNextAction(outcome: WorkOutcome, subject: string): string | null {
  switch (outcome) {
    case "Customer responded":
      return `Agree the next commercial step with ${subject}`;
    case "Procurement reviewing":
      return `Check procurement progress with ${subject}`;
    case "Pricing requested":
      return `Prepare pricing for ${subject}`;
    case "Negotiation requested":
      return `Prepare negotiation position for ${subject}`;
    case "Clarification requested":
      return `Send the requested clarification to ${subject}`;
    case "Contract amendment requested":
      return `Route the requested contract amendment for ${subject}`;
    case "Meeting scheduled":
      return `Prepare for the scheduled meeting with ${subject}`;
    case "No response":
      return `Follow up again with ${subject}`;
    case "Not interested":
      return null;
    default:
      return `Confirm the next step with ${subject}`;
  }
}

/* --------------------------------------------------------------- Ask SAFARID */

export interface AskYallaContext {
  focus: FocusTarget | null;
  scored: ScoredPersonalWork[];
  plan: DayPlan;
  waiting: WaitingCustomer[];
  commitments: PersonalCommitment[];
  momentum: AccountMomentum[];
  approvals: ApprovalItem[];
  changes: SessionChange[];
  now?: Date;
}

export interface AskYallaAnswer {
  question: string;
  headline: string;
  lines: string[];
  workId?: string;
}

export const ASK_YALLA_SUGGESTIONS = [
  "What should I do next?",
  "Why is this my priority?",
  "What changed since I last logged in?",
  "Which customers are waiting for me?",
  "What commitments are at risk?",
  "Help me plan my afternoon.",
  "What is a quick win right now?",
  "Replan my remaining day.",
  "What needs my approval?",
] as const;

/**
 * Answers an employee question using ONLY the authorised records already loaded
 * into their cockpit. If the records cannot answer it, it says so.
 */
export function answerAskYalla(question: string, ctx: AskYallaContext): AskYallaAnswer {
  const q = question.trim().toLowerCase();
  const now = ctx.now ?? new Date();
  const ask = (headline: string, lines: string[], workId?: string): AskYallaAnswer => ({
    question,
    headline,
    lines,
    workId,
  });

  if (!q) return ask("Ask me about your day", [...ASK_YALLA_SUGGESTIONS]);

  if (/(changed|since|last (log|session))/.test(q)) {
    if (!ctx.changes.length)
      return ask("Nothing material changed", ["No new work, decisions or customer responses since your last session."]);
    return ask("Since your last session", ctx.changes.map((c) => `${c.label}: ${c.detail}`));
  }

  if (/(waiting|who.*me)/.test(q)) {
    if (!ctx.waiting.length)
      return ask("No customer is waiting on you", ["Every promise you own has been delivered or has a future date."]);
    return ask(
      `${ctx.waiting.length} customer${ctx.waiting.length === 1 ? "" : "s"} waiting on you`,
      ctx.waiting.map((w) => `${w.accountName} — ${w.openPromises} open promise(s), ${w.overduePromises} overdue (next: ${dueLabel(w.nextDueAt, now).text})`),
    );
  }

  if (/(risk|commitment|promise)/.test(q)) {
    const atRisk = ctx.commitments.filter(
      (c) => (c.status === "open" || c.status === "in_progress") && (!c.due_at || new Date(c.due_at) <= now),
    );
    if (!atRisk.length) return ask("No commitment is at risk", ["All open promises still sit inside their committed time."]);
    return ask(
      `${atRisk.length} commitment${atRisk.length === 1 ? "" : "s"} at risk`,
      atRisk.map((c) => `${c.account_name ?? "Account"} — ${c.commitment} (${dueLabel(c.due_at, now).text})`),
    );
  }

  if (/(approv|decision|sign)/.test(q)) {
    if (!ctx.approvals.length) return ask("Nothing awaits your decision", ["No work in your queue requires an approval."]);
    return ask(
      `${ctx.approvals.length} decision${ctx.approvals.length === 1 ? "" : "s"} required`,
      ctx.approvals.map((a) => `${a.work.title} — requested ${a.requestedAgo}`),
      ctx.approvals[0].work.id,
    );
  }

  const windowMatch = q.match(/(\d{1,3})\s*(min|minute)/);
  if (windowMatch || /(quick win|finish in|short task)/.test(q)) {
    const budget = windowMatch ? Number(windowMatch[1]) : 15;
    const fits = ctx.scored.filter((s) => s.effortMinutes <= budget);
    if (!fits.length)
      return ask(`Nothing fits ${budget} minutes`, [
        ctx.scored.length
          ? `The smallest open item you own needs ${humanizeMinutes(Math.min(...ctx.scored.map((s) => s.effortMinutes)))}.`
          : "No open work is assigned to you.",
      ]);
    let used = 0;
    const picked = fits.filter((s) => {
      if (used + s.effortMinutes > budget) return false;
      used += s.effortMinutes;
      return true;
    });
    return ask(
      `${picked.length} item(s) fit your ${budget} minutes`,
      [
        ...picked.map((s) => `${s.work.title} — ${humanizeMinutes(s.effortMinutes)} (${s.reasons[0]})`),
        `${humanizeMinutes(used)} of ${humanizeMinutes(budget)} committed.`,
      ],
      picked[0]?.work.id,
    );
  }

  if (/(replan|re-plan|reorganise|reorder)/.test(q)) {
    if (!ctx.plan.blocks.length)
      return ask("Nothing to replan", ["No open work fits the remainder of the working day."]);
    return ask(
      "Proposed order for the rest of your day",
      [
        ...ctx.plan.blocks.map((b) => `${b.title} — ${humanizeMinutes(b.minutes)} (${b.why.toLowerCase()})`),
        ctx.plan.note,
      ],
      ctx.plan.blocks[0].workId,
    );
  }

  if (/(capacity|time left|how much)/.test(q)) {
    const free = Math.max(0, ctx.plan.capacityMinutes - ctx.plan.plannedMinutes);
    return ask(
      ctx.plan.overCommitted ? "You are over-committed today" : "Today's capacity",
      [
        `Usable time left: ${humanizeMinutes(ctx.plan.capacityMinutes)}`,
        `Already planned: ${humanizeMinutes(ctx.plan.plannedMinutes)}`,
        `Unplanned: ${humanizeMinutes(free)}`,
        ctx.plan.note,
      ],
    );
  }

  if (/(afternoon|my day|plan|prepare my)/.test(q)) {
    if (!ctx.plan.blocks.length)
      return ask("No plan can be built yet", ["No open work is assigned to you for the remainder of the day."]);
    return ask(
      "Your remaining day",
      ctx.plan.blocks.map(
        (b) =>
          `${new Date(b.startAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} — ${b.title} (${humanizeMinutes(b.minutes)}, ${b.why.toLowerCase()})`,
      ),
      ctx.plan.blocks[0].workId,
    );
  }

  if (/(why)/.test(q)) {
    if (!ctx.focus) return ask("No priority to explain", ["Nothing is currently ranked first because no open work is assigned to you."]);
    const conf = priorityConfidence(ctx.focus.scored);
    return ask(
      `Why ${ctx.focus.scored.work.title} is first`,
      [
        ...ctx.focus.scored.contributions.filter((c) => c.points > 0).map((c) => c.label),
        `Priority confidence: ${conf.level} — ${conf.because}`,
      ],
      ctx.focus.scored.work.id,
    );
  }

  if (/(cooling|stalled|momentum|relationship|pipeline)/.test(q)) {
    if (!ctx.momentum.length) return ask("No relationship signals", ["No accounts are currently assigned to you."]);
    return ask(
      "Relationship momentum",
      ctx.momentum.map((m) => `${m.accountName} — ${m.state}${m.staleDays === null ? "" : ` · last movement ${m.staleDays}d ago`}`),
    );
  }

  if (/(next|now|do)/.test(q)) {
    if (!ctx.focus) return ask("You're clear", ["No open work is currently assigned to you."]);
    const next = ctx.scored[1];
    return ask(
      ctx.focus.scored.work.title,
      [
        ctx.focus.because,
        `Done means: ${ctx.focus.definitionOfDone}`,
        next ? `After that: ${next.work.title}` : "Nothing else is queued after this.",
      ],
      ctx.focus.scored.work.id,
    );
  }

  return ask("I can only answer from your recorded work", [
    "I did not recognise that question. Try one of these:",
    ...ASK_YALLA_SUGGESTIONS,
  ]);
}
