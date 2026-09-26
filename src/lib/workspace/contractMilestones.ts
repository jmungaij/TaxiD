/**
 * CONTRACT MILESTONES.
 *
 * Reads the next thing owed on a contract from the contract's own recorded
 * state. Nothing is inferred: where the contract carries no date, the deadline
 * stays blank rather than being guessed, and a passed date is shown as overdue.
 */
import type { AccountContract } from "./account360";

export interface ContractMilestone {
  /** Plain-language next action owed on this contract. */
  action: string;
  /** Deadline the contract itself records, or null when it records none. */
  deadline: string | null;
  /** Whole days from today to the deadline; null when there is no deadline. */
  daysRemaining: number | null;
  overdue: boolean;
}

const DAY = 86_400_000;

function days(deadline: string, now: Date): number {
  const d = new Date(deadline);
  if (Number.isNaN(d.getTime())) return 0;
  return Math.round((d.setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / DAY);
}

/** Parses the term string only when it plainly ends with an ISO date. */
function termEnd(term: string | null): string | null {
  const hit = term?.match(/(\d{4}-\d{2}-\d{2})\s*$/);
  return hit ? hit[1] : null;
}

export function contractMilestone(contract: AccountContract, now: Date = new Date()): ContractMilestone {
  const status = (contract.status ?? "").toLowerCase();
  const effective = contract.effective_date;

  const at = (action: string, deadline: string | null): ContractMilestone => {
    const remaining = deadline ? days(deadline, now) : null;
    return { action, deadline, daysRemaining: remaining, overdue: remaining !== null && remaining < 0 };
  };

  if (["draft", "legal_review_required", "internal_review"].includes(status)) {
    return at("Finish internal review and issue the contract to the customer", null);
  }
  if (["shared", "sent", "awaiting_signature", "pending_signature"].includes(status)) {
    return at("Signed copy outstanding — no revenue until it is returned", effective);
  }
  if (["signed", "executed"].includes(status)) {
    return at("Activate the contract, then raise the invoice", effective);
  }
  if (status === "active") {
    const end = termEnd(contract.contract_term);
    return end ? at("Term ending — agree renewal or closure", end) : at("Running — no term end recorded", null);
  }
  if (["expired", "terminated", "cancelled", "superseded"].includes(status)) {
    return at("Closed — no action owed", null);
  }
  return at("No action recorded for this state", null);
}
