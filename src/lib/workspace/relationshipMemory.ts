import { listInteractions } from "@/lib/crm/api";
import type { CrmInteraction } from "@/lib/crm/types";
import type { PersonalCommitment } from "@/lib/workspace/personalOs";

/**
 * RELATIONSHIP MEMORY.
 *
 * Before the employee speaks to a customer the cockpit reminds them what has
 * already happened with that account — the last interactions, the sentiment
 * trend, and the promises still open. Everything is read from the CRM record;
 * nothing is inferred or invented. Because outcomes are written to
 * `crm_interactions` at the moment they are recorded, this memory refreshes
 * itself as the employee works.
 */

export type MemoryEntry = {
  id: string;
  at: string;
  type: string;
  subject: string;
  summary: string | null;
  outcome: string | null;
  sentiment: CrmInteraction["sentiment"];
};

export type RelationshipMemory = {
  accountId: string;
  accountName: string | null;
  lastContactAt: string | null;
  daysSinceContact: number | null;
  entries: MemoryEntry[];
  openPromises: { commitment: string; dueAt: string | null }[];
  /** Deterministic talking points derived from the record above. */
  suggestions: string[];
};

export async function fetchRelationshipMemory(
  accountId: string,
  opts: { accountName?: string | null; commitments?: PersonalCommitment[]; limit?: number } = {},
): Promise<RelationshipMemory> {
  const all = await listInteractions(accountId);
  const entries: MemoryEntry[] = all.slice(0, opts.limit ?? 5).map((i) => ({
    id: i.id,
    at: i.occurred_at,
    type: i.interaction_type,
    subject: i.subject,
    summary: i.summary,
    outcome: i.outcome,
    sentiment: i.sentiment,
  }));

  const lastContactAt = entries[0]?.at ?? null;
  const daysSinceContact = lastContactAt
    ? Math.max(0, Math.round((Date.now() - new Date(lastContactAt).getTime()) / 86_400_000))
    : null;

  const openPromises = (opts.commitments ?? [])
    .filter(
      (c) => c.account_id === accountId && (c.status === "open" || c.status === "in_progress"),
    )
    .map((c) => ({ commitment: c.commitment, dueAt: c.due_at ?? null }));

  return {
    accountId,
    accountName: opts.accountName ?? null,
    lastContactAt,
    daysSinceContact,
    entries,
    openPromises,
    suggestions: suggestionsFrom(entries, openPromises, daysSinceContact),
  };
}

function suggestionsFrom(
  entries: MemoryEntry[],
  openPromises: { commitment: string }[],
  daysSinceContact: number | null,
): string[] {
  const out: string[] = [];
  if (openPromises.length)
    out.push(`Open with the promise you owe them: ${openPromises[0].commitment}.`);

  const last = entries[0];
  if (last) {
    out.push(
      `Reference the last ${last.type.replace(/_/g, " ")}: ${last.outcome ?? last.subject}.`,
    );
    if (last.sentiment === "negative")
      out.push("Last contact ended negatively — acknowledge it before asking for anything.");
    if (last.sentiment === "positive")
      out.push("Momentum is positive — it is a reasonable moment to ask for the next commitment.");
  }
  if (daysSinceContact !== null && daysSinceContact >= 21)
    out.push(`No contact for ${daysSinceContact} days — re-establish context before pitching.`);
  if (!entries.length) out.push("No recorded interaction yet — this is a first contact.");
  return out.slice(0, 4);
}
