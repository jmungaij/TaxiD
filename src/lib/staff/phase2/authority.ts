/**
 * Phase 2 — TaxiD Authority Engine.
 *
 * Identity → Role → Position → Department → Permission → Authority.
 *
 * This module is the *configurable* client-side view of authority so the UI
 * never offers an action the caller cannot perform. It is NOT the boundary:
 * RLS policies and the privileged-update / approval edge functions remain the
 * enforcement layer. Where TaxiD already defines authority (admin capability
 * matrix, governance grants), those definitions are reused rather than
 * re-invented; anything else is expressed as a configurable rule with no
 * hardcoded monetary limit.
 */
import { MATRIX_ROLES, type MatrixRole } from "@/lib/corporate/adminCapabilities";

export const AUTHORITY_ACTIONS = [
  "view",
  "create",
  "edit",
  "approve",
  "execute",
  "administer",
] as const;

export type AuthorityAction = (typeof AUTHORITY_ACTIONS)[number];

/** Subjects are coarse business object classes, not table names. */
export const AUTHORITY_SUBJECTS = [
  { key: "customer", label: "Customer / account" },
  { key: "opportunity", label: "Opportunity & quote" },
  { key: "contract", label: "Contract" },
  { key: "booking", label: "Booking / order" },
  { key: "partner", label: "Partner & resource" },
  { key: "payment", label: "Payment & settlement" },
  { key: "employee", label: "Employee & position" },
  { key: "policy", label: "Policy & configuration" },
  { key: "audit", label: "Audit & governance" },
] as const;

export type AuthoritySubject = (typeof AUTHORITY_SUBJECTS)[number]["key"];

export type AuthorityRule = {
  /** Actions permitted outright. */
  allow: readonly AuthorityAction[];
  /** Actions permitted only under a configurable condition (shown as ✓*). */
  conditional?: Partial<Record<AuthorityAction, string>>;
};

type Row = Partial<Record<AuthoritySubject, AuthorityRule>>;

const CONDITION_SCOPE = "Own department / assigned records only";
const CONDITION_LIMIT = "Within configured approval limit (corporate_designations)";
const CONDITION_DUAL = "Requires second approver (approval_workflows)";

/**
 * Baseline authority. Deliberately conservative: unlisted subject/action pairs
 * are denied. Conditions reference configuration, never invented thresholds.
 */
const MATRIX: Record<MatrixRole, Row> = {
  super_admin: {
    customer: { allow: ["view", "create", "edit", "approve", "execute", "administer"] },
    opportunity: { allow: ["view", "create", "edit", "approve", "administer"] },
    contract: { allow: ["view", "create", "edit", "approve", "administer"] },
    booking: { allow: ["view", "create", "edit", "approve", "execute", "administer"] },
    partner: { allow: ["view", "create", "edit", "approve", "execute", "administer"] },
    payment: { allow: ["view", "edit", "administer"], conditional: { approve: CONDITION_DUAL, execute: CONDITION_DUAL } },
    employee: { allow: ["view", "create", "edit", "approve", "administer"] },
    policy: { allow: ["view", "create", "edit", "approve", "administer"] },
    audit: { allow: ["view", "administer"] },
  },
  admin: {
    customer: { allow: ["view", "create", "edit"], conditional: { approve: CONDITION_LIMIT } },
    opportunity: { allow: ["view", "create", "edit"], conditional: { approve: CONDITION_LIMIT } },
    contract: { allow: ["view"], conditional: { approve: CONDITION_LIMIT } },
    booking: { allow: ["view", "create", "edit", "execute"] },
    partner: { allow: ["view", "edit"], conditional: { approve: CONDITION_DUAL } },
    payment: { allow: ["view"], conditional: { approve: CONDITION_LIMIT } },
    employee: { allow: ["view"], conditional: { edit: CONDITION_SCOPE } },
    policy: { allow: ["view", "edit"] },
    audit: { allow: ["view"] },
  },
  finance_admin: {
    customer: { allow: ["view"] },
    opportunity: { allow: ["view"] },
    contract: { allow: ["view"] },
    booking: { allow: ["view"] },
    partner: { allow: ["view"] },
    payment: { allow: ["view", "edit"], conditional: { approve: CONDITION_LIMIT, execute: CONDITION_DUAL } },
    employee: { allow: [] },
    policy: { allow: ["view"] },
    audit: { allow: ["view"] },
  },
  compliance_admin: {
    customer: { allow: ["view"] },
    opportunity: { allow: ["view"] },
    contract: { allow: ["view"], conditional: { approve: "Compliance sign-off step only" } },
    booking: { allow: ["view"] },
    partner: { allow: ["view"], conditional: { approve: "Verification stages only" } },
    payment: { allow: ["view"] },
    employee: { allow: [] },
    policy: { allow: ["view", "create", "edit"] },
    audit: { allow: ["view"] },
  },
  operations_admin: {
    customer: { allow: ["view"] },
    opportunity: { allow: ["view"] },
    contract: { allow: ["view"] },
    booking: { allow: ["view", "create", "edit", "execute"] },
    partner: { allow: ["view", "edit"] },
    payment: { allow: ["view"] },
    employee: { allow: [] },
    policy: { allow: ["view"] },
    audit: { allow: ["view"] },
  },
};

export type AuthorityVerdict = "allow" | "conditional" | "deny";

export interface AuthorityDecision {
  verdict: AuthorityVerdict;
  condition?: string;
  /** Roles that produced the verdict, for the audit trail. */
  basis: string[];
}

/** Evaluate whether any held role permits action on subject. */
export function evaluateAuthority(
  roles: readonly string[],
  subject: AuthoritySubject,
  action: AuthorityAction,
): AuthorityDecision {
  const held = roles.filter((r): r is MatrixRole => (MATRIX_ROLES as readonly string[]).includes(r));
  let conditional: { condition: string; role: string } | null = null;
  for (const role of held) {
    const rule = MATRIX[role][subject];
    if (!rule) continue;
    if (rule.allow.includes(action)) return { verdict: "allow", basis: [role] };
    const cond = rule.conditional?.[action];
    if (cond && !conditional) conditional = { condition: cond, role };
  }
  if (conditional) {
    return { verdict: "conditional", condition: conditional.condition, basis: [conditional.role] };
  }
  return { verdict: "deny", basis: held };
}

export function can(roles: readonly string[], subject: AuthoritySubject, action: AuthorityAction): boolean {
  return evaluateAuthority(roles, subject, action).verdict !== "deny";
}

/** Dense matrix for the authority screen. */
export function authorityGrid(): Record<MatrixRole, Record<AuthoritySubject, Record<AuthorityAction, AuthorityVerdict>>> {
  const out = {} as ReturnType<typeof authorityGrid>;
  for (const role of MATRIX_ROLES) {
    out[role] = {} as Record<AuthoritySubject, Record<AuthorityAction, AuthorityVerdict>>;
    for (const s of AUTHORITY_SUBJECTS) {
      out[role][s.key] = {} as Record<AuthorityAction, AuthorityVerdict>;
      for (const a of AUTHORITY_ACTIONS) {
        out[role][s.key][a] = evaluateAuthority([role], s.key, a).verdict;
      }
    }
  }
  return out;
}

export const VERDICT_MARK: Record<AuthorityVerdict, string> = {
  allow: "✓",
  conditional: "✓*",
  deny: "—",
};
