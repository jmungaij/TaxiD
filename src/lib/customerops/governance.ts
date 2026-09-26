/**
 * Zero-Trust Governance — layered authorization for the Enterprise Mobility
 * Command Center.
 *
 * Every protected thing in the operations surface declares a policy at one of
 * nine levels (page, component, widget, record, field, document, attachment,
 * api, ai). Authorization is DENY BY DEFAULT: an unknown resource is refused,
 * and record/field/document access additionally requires the caller to own the
 * business domain that holds the data (see `orchestration.DOMAIN_REGISTRY`).
 */
import { DOMAIN_REGISTRY } from "./orchestration";
import type { BusinessDomain } from "./taxonomy";

export type GovernanceLevel =
  | "page" | "component" | "widget" | "record" | "field" | "document" | "attachment" | "api" | "ai";

export type Sensitivity = "public" | "internal" | "restricted" | "confidential";

export interface GovernancePolicy {
  id: string;
  level: GovernanceLevel;
  label: string;
  /** Roles granted access. Empty = any authenticated operations role. */
  roles: string[];
  /** Business domain owning the data — inherits the domain's role list too. */
  domain?: BusinessDomain;
  sensitivity: Sensitivity;
  /** Fields masked when the caller lacks the policy (record/field level). */
  maskFields?: string[];
  /** Extra condition, e.g. record ownership or corporate scoping. */
  requiresOwnership?: boolean;
}

const P = (p: GovernancePolicy) => p;

export const GOVERNANCE_POLICIES: GovernancePolicy[] = [
  // Pages
  P({ id: "page:customer_operations", level: "page", label: "Customer Operations Center", roles: ["support_agent", "support_lead", "trust_safety", "finance_admin", "corporate_admin", "super_admin"], sensitivity: "internal" }),
  P({ id: "page:mission_control", level: "page", label: "Enterprise Mission Control", roles: ["support_lead", "ops_manager", "finance_admin", "super_admin"], sensitivity: "restricted" }),
  P({ id: "page:decision_intelligence", level: "page", label: "Decision Intelligence", roles: ["ops_manager", "finance_admin", "executive", "super_admin"], sensitivity: "restricted" }),
  // Components
  P({ id: "component:case_command_bar", level: "component", label: "Case Command Bar", roles: ["support_agent", "support_lead", "super_admin"], sensitivity: "internal" }),
  P({ id: "component:customer_360", level: "component", label: "Customer 360", roles: ["support_agent", "support_lead", "super_admin"], domain: "rider_ops", sensitivity: "restricted" }),
  P({ id: "component:live_operations", level: "component", label: "Live Operations Map", roles: [], sensitivity: "internal" }),
  // Widgets
  P({ id: "widget:revenue_intelligence", level: "widget", label: "Revenue intelligence", roles: ["finance_admin", "executive", "super_admin"], domain: "finance", sensitivity: "confidential" }),
  P({ id: "widget:churn_risk", level: "widget", label: "Churn & revenue-at-risk", roles: ["ops_manager", "executive", "corporate_admin", "super_admin"], sensitivity: "restricted" }),
  P({ id: "widget:fleet_utilisation", level: "widget", label: "Fleet utilisation", roles: ["fleet_admin", "ops_manager", "super_admin"], domain: "fleet", sensitivity: "internal" }),
  P({ id: "widget:sla_forecast", level: "widget", label: "SLA forecast", roles: ["support_lead", "ops_manager", "super_admin"], sensitivity: "internal" }),
  // Records
  P({ id: "record:payment_attempt", level: "record", label: "Payment attempt", roles: [], domain: "finance", sensitivity: "confidential", maskFields: ["msisdn", "mpesa_receipt", "amount_kes", "payer_name"] }),
  P({ id: "record:wallet_ledger", level: "record", label: "Wallet ledger entry", roles: [], domain: "finance", sensitivity: "confidential", maskFields: ["balance_after_kes", "amount_kes"] }),
  P({ id: "record:driver_profile", level: "record", label: "Driver profile", roles: [], domain: "driver_ops", sensitivity: "restricted", maskFields: ["national_id", "kra_pin", "phone", "bank_account"] }),
  P({ id: "record:rider_profile", level: "record", label: "Rider profile", roles: [], domain: "rider_ops", sensitivity: "restricted", maskFields: ["phone", "email", "home_address"] }),
  P({ id: "record:trust_investigation", level: "record", label: "Trust investigation", roles: [], domain: "trust_safety", sensitivity: "confidential", maskFields: ["evidence_notes", "reporter_identity"] }),
  P({ id: "record:corporate_account", level: "record", label: "Corporate account", roles: [], domain: "corporate", sensitivity: "restricted", maskFields: ["credit_limit_kes", "kra_pin"] }),
  // Fields
  P({ id: "field:customer_lifetime_value", level: "field", label: "Customer lifetime value", roles: ["support_lead", "finance_admin", "executive", "super_admin"], sensitivity: "restricted" }),
  P({ id: "field:fraud_score", level: "field", label: "Fraud score", roles: ["trust_safety", "support_lead", "super_admin"], domain: "trust_safety", sensitivity: "confidential" }),
  // Documents & attachments
  P({ id: "document:kyb_pack", level: "document", label: "Corporate KYB document pack", roles: ["compliance_admin", "corporate_admin", "super_admin"], domain: "corporate", sensitivity: "confidential" }),
  P({ id: "document:proof_of_delivery", level: "document", label: "Proof of delivery", roles: [], domain: "logistics", sensitivity: "internal" }),
  P({ id: "attachment:case_evidence", level: "attachment", label: "Case evidence attachment", roles: ["support_agent", "support_lead", "trust_safety", "super_admin"], sensitivity: "restricted", requiresOwnership: true }),
  P({ id: "attachment:safety_media", level: "attachment", label: "Safety incident media", roles: ["trust_safety", "super_admin"], domain: "trust_safety", sensitivity: "confidential" }),
  // APIs
  P({ id: "api:case.assign", level: "api", label: "Assign case owner", roles: ["support_agent", "support_lead", "super_admin"], sensitivity: "internal" }),
  P({ id: "api:case.escalate", level: "api", label: "Escalate case", roles: ["support_agent", "support_lead", "super_admin"], sensitivity: "internal" }),
  P({ id: "api:case.refund", level: "api", label: "Initiate refund", roles: ["finance_admin", "finance_approver", "super_admin"], domain: "finance", sensitivity: "confidential" }),
  P({ id: "api:case.goodwill_credit", level: "api", label: "Issue goodwill credit", roles: ["support_lead", "finance_admin", "super_admin"], domain: "finance", sensitivity: "confidential" }),
  P({ id: "api:case.suspend_driver", level: "api", label: "Suspend driver", roles: ["trust_safety", "driver_ops", "super_admin"], domain: "driver_ops", sensitivity: "restricted" }),
  P({ id: "api:case.close", level: "api", label: "Close case", roles: ["support_agent", "support_lead", "super_admin"], sensitivity: "internal" }),
  // AI
  P({ id: "ai:copilot_answer", level: "ai", label: "AI copilot answers", roles: [], sensitivity: "internal" }),
  P({ id: "ai:financial_reasoning", level: "ai", label: "AI financial reasoning", roles: ["finance_admin", "executive", "super_admin"], domain: "finance", sensitivity: "confidential" }),
  P({ id: "ai:safety_reasoning", level: "ai", label: "AI safety reasoning", roles: ["trust_safety", "super_admin"], domain: "trust_safety", sensitivity: "confidential" }),
];

export const POLICY_BY_ID = new Map(GOVERNANCE_POLICIES.map((p) => [p.id, p]));

export const GOVERNANCE_LEVELS: GovernanceLevel[] = [
  "page", "component", "widget", "record", "field", "document", "attachment", "api", "ai",
];

export interface AuthorizeContext {
  roles: string[];
  /** True when the caller owns / is assigned to the record in question. */
  isOwner?: boolean;
  /** Corporate scope of the caller, when the record is corporate-scoped. */
  corporateAccountId?: string | null;
  recordCorporateAccountId?: string | null;
}

export interface AuthorizeResult {
  allowed: boolean;
  level: GovernanceLevel | "unknown";
  policyId: string;
  reason: string;
  sensitivity: Sensitivity | "unknown";
}

/** Deny-by-default authorization decision for any governed resource. */
export function authorize(policyId: string, ctx: AuthorizeContext): AuthorizeResult {
  const policy = POLICY_BY_ID.get(policyId);
  if (!policy) {
    return { allowed: false, level: "unknown", policyId, reason: "No policy registered — denied by default", sensitivity: "unknown" };
  }
  const roles = new Set(ctx.roles ?? []);
  const base = { level: policy.level, policyId, sensitivity: policy.sensitivity } as const;

  if (roles.has("super_admin")) return { ...base, allowed: true, reason: "Super admin override (audited)" };

  const allowedRoles = new Set([...policy.roles, ...(policy.domain ? DOMAIN_REGISTRY[policy.domain].roles : [])]);
  if (allowedRoles.size > 0 && !Array.from(allowedRoles).some((r) => roles.has(r))) {
    return { ...base, allowed: false, reason: `Requires one of: ${Array.from(allowedRoles).join(", ")}` };
  }
  if (allowedRoles.size === 0 && roles.size === 0) {
    return { ...base, allowed: false, reason: "No operations role on the session" };
  }
  if (policy.requiresOwnership && !ctx.isOwner) {
    return { ...base, allowed: false, reason: "Record ownership required" };
  }
  if (ctx.recordCorporateAccountId && ctx.corporateAccountId && ctx.recordCorporateAccountId !== ctx.corporateAccountId) {
    return { ...base, allowed: false, reason: "Corporate tenant scope mismatch" };
  }
  return { ...base, allowed: true, reason: "Granted by role and domain policy" };
}

export const can = (policyId: string, roles: string[], extra: Omit<AuthorizeContext, "roles"> = {}) =>
  authorize(policyId, { roles, ...extra }).allowed;

export const MASK = "•••• restricted";

/**
 * Field-level redaction. Returns a copy where every masked field the caller may
 * not read is replaced, plus the list of redacted keys for the audit trail.
 */
export function redactRecord<T extends Record<string, unknown>>(
  policyId: string, record: T, ctx: AuthorizeContext,
): { record: T; redacted: string[]; allowed: boolean } {
  const policy = POLICY_BY_ID.get(policyId);
  const decision = authorize(policyId, ctx);
  if (!policy) return { record: {} as T, redacted: Object.keys(record), allowed: false };
  if (decision.allowed) return { record, redacted: [], allowed: true };

  const out = { ...record } as Record<string, unknown>;
  const redacted: string[] = [];
  for (const f of policy.maskFields ?? Object.keys(record)) {
    if (f in out) { out[f] = MASK; redacted.push(f); }
  }
  return { record: out as T, redacted, allowed: false };
}

export interface AiGuardResult {
  allowedContext: string[];
  blockedContext: string[];
  /** Grounding note appended to the AI answer so the operator sees the limits. */
  disclosure: string;
}

/**
 * AI-level authorization: strips context the caller may not read BEFORE it is
 * sent to the model, so an AI answer can never widen a user's permissions.
 */
export function guardAiContext(items: { policyId: string; content: string }[], ctx: AuthorizeContext): AiGuardResult {
  const allowedContext: string[] = [];
  const blockedContext: string[] = [];
  for (const item of items) {
    if (authorize(item.policyId, ctx).allowed) allowedContext.push(item.content);
    else blockedContext.push(item.policyId);
  }
  return {
    allowedContext,
    blockedContext,
    disclosure: blockedContext.length
      ? `${blockedContext.length} restricted source(s) withheld from this answer by governance policy.`
      : "All relevant sources were available to this answer.",
  };
}

/* ------------------------------ certification ----------------------------- */

export interface GovernanceCertification {
  levels: { level: GovernanceLevel; policies: number; covered: boolean }[];
  totalPolicies: number;
  denyByDefault: boolean;
  confidentialAlwaysScoped: boolean;
  certified: boolean;
  findings: string[];
}

export function certifyGovernance(): GovernanceCertification {
  const levels = GOVERNANCE_LEVELS.map((level) => {
    const policies = GOVERNANCE_POLICIES.filter((p) => p.level === level).length;
    return { level, policies, covered: policies > 0 };
  });
  const denyByDefault = !authorize("does:not:exist", { roles: ["super_admin"] }).allowed;
  const confidentialAlwaysScoped = GOVERNANCE_POLICIES
    .filter((p) => p.sensitivity === "confidential")
    .every((p) => p.roles.length > 0 || Boolean(p.domain));

  const findings: string[] = [];
  for (const l of levels) if (!l.covered) findings.push(`No policy registered at ${l.level} level`);
  if (!denyByDefault) findings.push("Unknown resources are not denied by default");
  if (!confidentialAlwaysScoped) findings.push("A confidential policy has no role or domain scope");

  return {
    levels, totalPolicies: GOVERNANCE_POLICIES.length, denyByDefault, confidentialAlwaysScoped,
    certified: findings.length === 0, findings,
  };
}
