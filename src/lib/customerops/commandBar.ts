/**
 * Unified Case Command Bar — the single action surface for a case.
 *
 * Every operational action a case can take is declared once, with its
 * governance policy, approval chain, reversibility and target domain. Executing
 * an action produces an append-only audit record carrying the case correlation
 * ID, and an approval request when the action needs maker-checker.
 */
import { authorize, type AuthorizeContext } from "./governance";
import type { OrchestrationPlan } from "./orchestration";
import type { BusinessDomain, CaseType } from "./taxonomy";

export type ActionGroup = "ownership" | "resolution" | "financial" | "safety" | "communication" | "governance";

export interface CommandAction {
  id: string;
  label: string;
  group: ActionGroup;
  /** Governance policy that gates the action (api level). */
  policyId: string;
  domain: BusinessDomain;
  /** Case types the action applies to. Empty = all. */
  caseTypes: CaseType[];
  /** Ordered approver chain — empty means no approval needed. */
  approvalChain: string[];
  irreversible: boolean;
  description: string;
}

export const COMMAND_ACTIONS: CommandAction[] = [
  { id: "assign", label: "Assign / reassign", group: "ownership", policyId: "api:case.assign", domain: "support", caseTypes: [], approvalChain: [], irreversible: false, description: "Set the owning agent or team." },
  { id: "escalate", label: "Escalate", group: "ownership", policyId: "api:case.escalate", domain: "support", caseTypes: [], approvalChain: [], irreversible: false, description: "Raise to the next tier with the auto-routed destination." },
  { id: "request_evidence", label: "Request evidence", group: "communication", policyId: "api:case.assign", domain: "support", caseTypes: [], approvalChain: [], irreversible: false, description: "Ask the customer or an upstream domain for missing evidence." },
  { id: "refund", label: "Initiate refund", group: "financial", policyId: "api:case.refund", domain: "finance", caseTypes: ["refund_dispute", "payment_issue", "lost_parcel", "delivery_failure"], approvalChain: ["Finance approver", "Finance controller (≥ KES 50,000)"], irreversible: true, description: "Reverse a settled payment through the finance refund workflow." },
  { id: "goodwill_credit", label: "Issue goodwill credit", group: "financial", policyId: "api:case.goodwill_credit", domain: "finance", caseTypes: ["delayed_ride", "delivery_failure", "vehicle_issue", "general_enquiry"], approvalChain: ["Tier 2 supervisor"], irreversible: false, description: "Credit the customer wallet as a service recovery gesture." },
  { id: "suspend_driver", label: "Suspend driver", group: "safety", policyId: "api:case.suspend_driver", domain: "driver_ops", caseTypes: ["safety_incident", "driver_conduct", "fraud"], approvalChain: ["Trust & Safety lead"], irreversible: true, description: "Immediately remove the driver from dispatch pending investigation." },
  { id: "preserve_evidence", label: "Preserve evidence", group: "safety", policyId: "api:case.escalate", domain: "trust_safety", caseTypes: ["safety_incident", "fraud", "lost_parcel"], approvalChain: [], irreversible: false, description: "Legal hold on trip, GPS, media and payment evidence." },
  { id: "close", label: "Resolve & close", group: "resolution", policyId: "api:case.close", domain: "support", caseTypes: [], approvalChain: [], irreversible: true, description: "Close the case once all mandatory domains are complete." },
];

export interface ActionAvailability {
  action: CommandAction;
  enabled: boolean;
  reason: string;
  needsApproval: boolean;
}

/** Actions applicable to a case, annotated with the caller's authorization. */
export function availableActions(plan: OrchestrationPlan, ctx: AuthorizeContext): ActionAvailability[] {
  return COMMAND_ACTIONS
    .filter((a) => a.caseTypes.length === 0 || a.caseTypes.includes(plan.caseType))
    .map((action) => {
      const decision = authorize(action.policyId, ctx);
      return {
        action,
        enabled: decision.allowed,
        reason: decision.reason,
        needsApproval: action.approvalChain.length > 0,
      };
    });
}

export interface CommandAuditEntry {
  readonly id: string;
  readonly actionId: string;
  readonly caseId: string;
  readonly correlationId: string;
  readonly actor: string;
  readonly actorRoles: string[];
  readonly at: string;
  readonly domain: BusinessDomain;
  readonly outcome: "executed" | "pending_approval" | "denied";
  readonly detail: string;
  readonly note?: string;
}

export interface ApprovalRequestDraft {
  actionId: string;
  caseId: string;
  correlationId: string;
  chain: string[];
  currentStage: string;
  justification: string;
  irreversible: boolean;
}

export interface ExecuteInput {
  plan: OrchestrationPlan;
  actionId: string;
  actor: string;
  ctx: AuthorizeContext;
  note?: string;
  /** Closure gate result — required for the close action. */
  canClose?: boolean;
  at?: string;
}

export interface ExecuteResult {
  ok: boolean
  outcome: CommandAuditEntry["outcome"];
  audit: CommandAuditEntry;
  approval?: ApprovalRequestDraft;
  error?: "unknown_action" | "forbidden" | "note_required" | "closure_blocked";
}

/** Executes a command-bar action. Pure: returns the audit entry to append. */
export function executeCommand(input: ExecuteInput): ExecuteResult {
  const { plan, actionId, actor, ctx } = input;
  const at = input.at ?? new Date().toISOString();
  const action = COMMAND_ACTIONS.find((a) => a.id === actionId);
  const audit = (outcome: CommandAuditEntry["outcome"], detail: string, domain: BusinessDomain = "support"): CommandAuditEntry =>
    Object.freeze({
      id: `${plan.correlationId}:${actionId}:${at}`,
      actionId, caseId: plan.caseId, correlationId: plan.correlationId, actor,
      actorRoles: [...(ctx.roles ?? [])], at, domain, outcome, detail, note: input.note,
    });

  if (!action) return { ok: false, outcome: "denied", error: "unknown_action", audit: audit("denied", `Unknown action ${actionId}`) };

  const decision = authorize(action.policyId, ctx);
  if (!decision.allowed) {
    return { ok: false, outcome: "denied", error: "forbidden", audit: audit("denied", `${action.label} denied — ${decision.reason}`, action.domain) };
  }
  if (action.irreversible && !input.note?.trim()) {
    return { ok: false, outcome: "denied", error: "note_required", audit: audit("denied", `${action.label} requires a justification note`, action.domain) };
  }
  if (action.id === "close" && input.canClose === false) {
    return { ok: false, outcome: "denied", error: "closure_blocked", audit: audit("denied", "Closure blocked — mandatory domains incomplete", action.domain) };
  }
  if (action.approvalChain.length > 0) {
    return {
      ok: true, outcome: "pending_approval",
      audit: audit("pending_approval", `${action.label} submitted to ${action.approvalChain[0]}`, action.domain),
      approval: {
        actionId: action.id, caseId: plan.caseId, correlationId: plan.correlationId,
        chain: action.approvalChain, currentStage: action.approvalChain[0],
        justification: input.note?.trim() || `${action.label} on ${plan.title}`,
        irreversible: action.irreversible,
      },
    };
  }
  return { ok: true, outcome: "executed", audit: audit("executed", `${action.label} executed`, action.domain) };
}

/** Append-only audit log. Returns a new frozen array; history is never mutated. */
export function appendAudit(log: readonly CommandAuditEntry[], entry: CommandAuditEntry): readonly CommandAuditEntry[] {
  return Object.freeze([...log, Object.freeze(entry)]);
}

export interface CommandBarCertification {
  actions: number;
  groupsCovered: ActionGroup[];
  everyActionGoverned: boolean;
  irreversibleRequireNote: boolean;
  financialRequireApproval: boolean;
  certified: boolean;
  findings: string[];
}

export function certifyCommandBar(): CommandBarCertification {
  const findings: string[] = [];
  const everyActionGoverned = COMMAND_ACTIONS.every((a) => a.policyId.startsWith("api:"));
  if (!everyActionGoverned) findings.push("An action is not bound to an api-level governance policy");

  const financial = COMMAND_ACTIONS.filter((a) => a.group === "financial");
  const financialRequireApproval = financial.every((a) => a.approvalChain.length > 0);
  if (!financialRequireApproval) findings.push("A financial action has no approval chain");

  const groups = Array.from(new Set(COMMAND_ACTIONS.map((a) => a.group)));
  for (const g of ["ownership", "resolution", "financial", "safety", "communication"] as ActionGroup[]) {
    if (!groups.includes(g)) findings.push(`No action in the ${g} group`);
  }
  return {
    actions: COMMAND_ACTIONS.length, groupsCovered: groups, everyActionGoverned,
    irreversibleRequireNote: true, financialRequireApproval,
    certified: findings.length === 0, findings,
  };
}
