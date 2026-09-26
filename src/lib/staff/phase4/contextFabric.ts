/**
 * Phase 4 — SAFARID Context Fabric.
 *
 * An agent must never act on a prompt alone. Before any action it requests a
 * context envelope; the fabric returns only the classes the agent declared and
 * the signed-in identity is entitled to, and marks every other class WITHHELD
 * with a reason. Withheld context is visible to the agent as an absence — it
 * must never be silently substituted with an assumption.
 *
 * Every fact carried in an envelope is tagged with its epistemic status, so
 * downstream reasoning can distinguish fact from inference from recommendation
 * from simulation. This is the mechanism that stops a modelled figure being
 * presented as a measured one.
 */
import { hasScope, type StaffScope } from "@/lib/staff/access";
import { AGENTS, agentByKey } from "./agents";

export type Epistemic = "fact" | "inference" | "recommendation" | "simulation";

export const EPISTEMIC_LABEL: Record<Epistemic, string> = {
  fact: "Fact — recorded in a system of record",
  inference: "Inference — derived from recorded facts",
  recommendation: "Recommendation — proposed course of action",
  simulation: "Simulation — modelled, not observed",
};

export interface ContextClass {
  key: string;
  label: string;
  /** Authoritative table(s) that supply this class. */
  tables: readonly string[];
  /** Staff data-sensitivity scope required to read it. */
  scope: StaffScope;
  sensitive?: boolean;
}

export const CONTEXT_CLASSES: readonly ContextClass[] = [
  { key: "customer", label: "Customer", tables: ["corporate_accounts"], scope: "commercial" },
  { key: "account", label: "Account & hierarchy", tables: ["corporate_accounts", "corporate_departments"], scope: "commercial" },
  { key: "contract", label: "Contract", tables: ["corporate_documents"], scope: "commercial" },
  { key: "transaction", label: "Transaction", tables: ["charter_bookings", "delivery_orders"], scope: "department" },
  { key: "service", label: "Service & fulfilment", tables: ["dispatch_events", "delivery_dispatch_jobs"], scope: "department" },
  { key: "marketplace", label: "Marketplace supply", tables: ["charter_inventory", "charter_partner_applications"], scope: "department" },
  { key: "employee", label: "Employee", tables: ["corporate_employees"], scope: "people_sensitive", sensitive: true },
  { key: "capability", label: "Capability", tables: ["capabilities"], scope: "department" },
  { key: "department", label: "Department", tables: ["corporate_departments"], scope: "department" },
  { key: "policies", label: "Policies & SOPs", tables: ["corporate_policy_rules"], scope: "self" },
  { key: "financial_state", label: "Financial state", tables: ["corporate_invoices", "charter_wallet_ledger"], scope: "financial", sensitive: true },
  { key: "historical_actions", label: "Historical actions", tables: ["admin_audit_log", "client_journey_events"], scope: "enterprise" },
  { key: "current_state", label: "Current operating state", tables: ["availability_metrics", "alerts_events"], scope: "department" },
  { key: "knowledge", label: "Institutional knowledge", tables: ["corporate_policy_rules"], scope: "self" },
  { key: "risk", label: "Risk & controls", tables: ["alerts_events", "compliance_alerts"], scope: "enterprise" },
  { key: "revenue", label: "Revenue", tables: ["corporate_invoices"], scope: "financial", sensitive: true },
  { key: "enterprise_kpis", label: "Enterprise KPIs", tables: ["dashboard_metrics"], scope: "enterprise" },
  { key: "strategy", label: "Strategy & objectives", tables: [], scope: "enterprise" },
];

export function contextClass(key: string): ContextClass | undefined {
  return CONTEXT_CLASSES.find((c) => c.key === key);
}

export interface ContextSlot {
  key: string;
  label: string;
  granted: boolean;
  reason: string;
  tables: readonly string[];
  sensitive: boolean;
}

export interface ContextEnvelope {
  agent: string;
  slots: ContextSlot[];
  granted: string[];
  withheld: string[];
  /** True when every class the agent declared is available to this identity. */
  complete: boolean;
}

/**
 * Assemble the authorised context envelope for an agent run. Scope comes from
 * the signed-in identity's staff roles — an agent can never read wider than
 * the human operating it, and row-level security remains the real boundary.
 */
export function assembleContext(agentKey: string, roles: readonly string[]): ContextEnvelope {
  const agent = agentByKey(agentKey);
  if (!agent) {
    return { agent: agentKey, slots: [], granted: [], withheld: [], complete: false };
  }
  const slots: ContextSlot[] = agent.contextScopes.map((key) => {
    const cls = contextClass(key);
    if (!cls) {
      return { key, label: key, granted: false, reason: "Unknown context class", tables: [], sensitive: false };
    }
    if (cls.tables.length === 0) {
      return { key, label: cls.label, granted: false, reason: "No system of record — DATA NOT AVAILABLE", tables: [], sensitive: !!cls.sensitive };
    }
    const allowed = hasScope(roles, cls.scope);
    return {
      key,
      label: cls.label,
      granted: allowed,
      reason: allowed ? `Readable under ${cls.scope} scope` : `WITHHELD — requires ${cls.scope} scope`,
      tables: cls.tables,
      sensitive: !!cls.sensitive,
    };
  });
  const granted = slots.filter((s) => s.granted).map((s) => s.key);
  const withheld = slots.filter((s) => !s.granted).map((s) => s.key);
  return { agent: agentKey, slots, granted, withheld, complete: withheld.length === 0 };
}

/** Context classes no agent declares — dead weight in the fabric. */
export function unusedContextClasses(): string[] {
  const used = new Set(AGENTS.flatMap((a) => a.contextScopes));
  return CONTEXT_CLASSES.filter((c) => !used.has(c.key)).map((c) => c.key);
}

/** Context classes an agent declares that the fabric cannot supply. */
export function contextFabricDefects(): { agent: string; defect: string }[] {
  const out: { agent: string; defect: string }[] = [];
  for (const a of AGENTS) {
    for (const key of a.contextScopes) {
      if (!contextClass(key)) out.push({ agent: a.key, defect: `declares unknown context class ${key}` });
    }
  }
  return out;
}
