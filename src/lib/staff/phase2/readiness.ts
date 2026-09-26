/**
 * Phase 2 — Business Readiness Scorecard, Data Integrity Audit and Production
 * Blocker Register.
 *
 * Scores are CALCULATED from acceptance criteria, never displayed as a flat
 * 100%. Three kinds of criteria:
 *  - `record`   : an authoritative table must exist and be readable (probed).
 *  - `structural`: a declarative check over the Phase 2 model (lifecycles,
 *                  authority, notification rules) evaluated locally.
 *  - `pending`  : an integration criterion that Phase 3 must satisfy; it counts
 *                 as unmet, which is why domains legitimately score below 100.
 */
import { untypedDb } from "@/integrations/supabase/untyped";
import {
  CANONICAL_ENTITIES,
  recordTables,
  unbackedEntities,
  type CanonicalEntity,
} from "./systemOfRecord";
import { LIFECYCLES, lifecycleDefects } from "./lifecycles";
import { AUTHORITY_SUBJECTS, authorityGrid } from "./authority";
import { NOTIFICATION_RULES, unwiredRules } from "./signals";

/* ------------------------------------------------------------ table probing */

export type TableProbe = { table: string; rows: number | null; error?: string };
export type Coverage = Record<string, TableProbe>;

/**
 * Head-count probe per authoritative table. RLS denial or a missing table
 * yields `rows: null` with the reason — an honest DATA NOT AVAILABLE signal.
 */
export async function probeRecordCoverage(tables = recordTables()): Promise<Coverage> {
  const results = await Promise.all(
    tables.map(async (table): Promise<TableProbe> => {
      try {
        const { count, error } = await (untypedDb)
          .from(table)
          .select("*", { count: "exact", head: true });
        if (error) return { table, rows: null, error: error.message };
        return { table, rows: count ?? 0 };
      } catch (e) {
        return { table, rows: null, error: e instanceof Error ? e.message : "probe failed" };
      }
    }),
  );
  return Object.fromEntries(results.map((r) => [r.table, r]));
}

/* --------------------------------------------------------------- scorecard */

export const READINESS_DOMAINS = [
  "Organisation", "Identity & access", "People", "Sales", "Customer",
  "Marketplace", "Operations", "Delivery", "Charter", "Rentals & leasing",
  "Finance", "Revenue assurance", "Risk", "Compliance", "Knowledge",
  "Performance", "Learning", "AI governance", "Auditability", "Data quality",
] as const;

export type ReadinessDomain = (typeof READINESS_DOMAINS)[number];

type Criterion =
  | { label: string; kind: "record"; table: string; requireRows?: boolean }
  | { label: string; kind: "structural"; check: () => boolean }
  | { label: string; kind: "pending"; note: string };

const ent = (key: string): CanonicalEntity | undefined => CANONICAL_ENTITIES.find((e) => e.key === key);
const hasLifecycle = (key: string) => () => LIFECYCLES.some((l) => l.key === key);
const backed = (key: string) => () => !!ent(key)?.table;

const CRITERIA: Record<ReadinessDomain, Criterion[]> = {
  Organisation: [
    { label: "Department system of record", kind: "record", table: "corporate_departments" },
    { label: "Position system of record", kind: "record", table: "corporate_designations" },
    { label: "Cost centre system of record", kind: "record", table: "cost_centers" },
    { label: "Position lifecycle defined", kind: "structural", check: hasLifecycle("position") },
  ],
  "Identity & access": [
    { label: "Role store enforced server-side", kind: "record", table: "user_roles" },
    { label: "Authority matrix covers every subject", kind: "structural", check: () => {
      const grid = authorityGrid();
      return AUTHORITY_SUBJECTS.every((s) => Object.values(grid).some((row) => row[s.key].view !== "deny"));
    } },
    { label: "Capability grants persisted", kind: "record", table: "corporate_admin_permission_grants" },
  ],
  People: [
    { label: "Employee system of record", kind: "record", table: "corporate_employees" },
    { label: "Employee lifecycle defined", kind: "structural", check: hasLifecycle("employee") },
    { label: "Recruitment → appointment records", kind: "pending", note: "No recruitment table — Phase 3" },
  ],
  Sales: [
    { label: "Lead system of record", kind: "record", table: "contact_submissions" },
    { label: "Quote system of record", kind: "record", table: "charter_quotes" },
    { label: "Sales lifecycle defined", kind: "structural", check: hasLifecycle("sales") },
    { label: "Opportunity system of record", kind: "structural", check: backed("opportunity") },
  ],
  Customer: [
    { label: "Account system of record", kind: "record", table: "corporate_accounts" },
    { label: "Activation gate defined", kind: "structural", check: hasLifecycle("customer_activation") },
    { label: "Customer success signals stored", kind: "record", table: "client_journey_events" },
  ],
  Marketplace: [
    { label: "Partner applications stored", kind: "record", table: "charter_partner_applications" },
    { label: "Resource inventory stored", kind: "record", table: "charter_inventory" },
    { label: "Partner activation lifecycle", kind: "structural", check: hasLifecycle("partner_activation") },
    { label: "Resource supply lifecycle", kind: "structural", check: hasLifecycle("resource_supply") },
  ],
  Operations: [
    { label: "Assignment / dispatch records", kind: "record", table: "dispatch_assignments" },
    { label: "Booking records", kind: "record", table: "charter_bookings" },
    { label: "SLA alerting wired", kind: "record", table: "alerts_events" },
  ],
  Delivery: [
    { label: "Delivery order records", kind: "record", table: "delivery_orders" },
    { label: "Dispatch jobs records", kind: "record", table: "delivery_dispatch_jobs" },
  ],
  Charter: [
    { label: "Charter bookings", kind: "record", table: "charter_bookings" },
    { label: "Charter quotes", kind: "record", table: "charter_quotes" },
    { label: "Charter settlement actions", kind: "record", table: "charter_wallet_finance_actions" },
  ],
  "Rentals & leasing": [
    { label: "Rental reservation system of record", kind: "structural", check: backed("rental") },
    { label: "Lease lifecycle defined", kind: "pending", note: "Rentals lifecycle awaits reservation records" },
  ],
  Finance: [
    { label: "Invoice records", kind: "record", table: "corporate_invoices" },
    { label: "Append-only ledger", kind: "record", table: "charter_wallet_ledger" },
    { label: "Payment events", kind: "record", table: "charter_payment_events" },
    { label: "Revenue lifecycle defined", kind: "structural", check: hasLifecycle("revenue") },
  ],
  "Revenue assurance": [
    { label: "Reconciliation findings", kind: "record", table: "charter_wallet_reconciliation_findings" },
    { label: "Reconciliation runs", kind: "record", table: "charter_wallet_reconciliation_runs" },
    { label: "Exception lifecycle defined", kind: "structural", check: hasLifecycle("reconciliation") },
  ],
  Risk: [
    { label: "Risk / incident events", kind: "record", table: "alerts_events" },
    { label: "Risk lifecycle with escalation", kind: "structural", check: hasLifecycle("risk") },
  ],
  Compliance: [
    { label: "Document registry", kind: "record", table: "corporate_documents" },
    { label: "Document audit log", kind: "record", table: "corporate_document_audit_log" },
    { label: "Policy rules", kind: "record", table: "corporate_policy_rules" },
  ],
  Knowledge: [
    { label: "Versioned documents", kind: "record", table: "corporate_document_versions" },
    { label: "SOP control lifecycle", kind: "structural", check: hasLifecycle("knowledge") },
  ],
  Performance: [
    { label: "Goal / KPI system of record", kind: "structural", check: backed("goal_kpi") },
    { label: "Evidence-based performance cycle", kind: "structural", check: () =>
      (LIFECYCLES.find((l) => l.key === "employee")?.states ?? []).some((s) => s.key === "performance" && !!s.gate) },
  ],
  Learning: [
    { label: "Certification workflows", kind: "record", table: "certification_workflows" },
    { label: "Capability closed loop", kind: "structural", check: hasLifecycle("capability") },
  ],
  "AI governance": [
    { label: "Insight feedback stored", kind: "record", table: "staff_insight_feedback" },
    { label: "Governed AI loop with human authorisation", kind: "structural", check: () =>
      (LIFECYCLES.find((l) => l.key === "ai_action")?.states ?? []).some((s) => s.key === "authorised") },
  ],
  Auditability: [
    { label: "Platform audit log", kind: "record", table: "audit_logs" },
    { label: "Approval decisions recorded", kind: "record", table: "approval_decisions" },
    { label: "Every lifecycle has audited transitions", kind: "structural", check: () =>
      LIFECYCLES.every((l) => l.states.some((s) => s.audited)) },
  ],
  "Data quality": [
    { label: "Every entity has an owner", kind: "structural", check: () => CANONICAL_ENTITIES.every((e) => !!e.owner) },
    { label: "No lifecycle structural defects", kind: "structural", check: () => lifecycleDefects().length === 0 },
    { label: "Every entity backed by a system of record", kind: "structural", check: () => unbackedEntities().length === 0 },
    { label: "Every notification rule has a source event", kind: "structural", check: () => unwiredRules().length === 0 },
  ],
};

export interface CriterionResult {
  label: string;
  kind: Criterion["kind"];
  met: boolean;
  detail: string;
}

export interface DomainScore {
  domain: ReadinessDomain;
  score: number;
  met: number;
  total: number;
  criteria: CriterionResult[];
}

function evaluateCriterion(c: Criterion, coverage: Coverage): CriterionResult {
  if (c.kind === "structural") {
    let ok = false;
    try { ok = c.check(); } catch { ok = false; }
    return { label: c.label, kind: c.kind, met: ok, detail: ok ? "Model check passed" : "Model check failed" };
  }
  if (c.kind === "pending") {
    return { label: c.label, kind: c.kind, met: false, detail: c.note };
  }
  const probe = coverage[c.table];
  if (!probe) return { label: c.label, kind: c.kind, met: false, detail: `${c.table}: not probed` };
  if (probe.rows === null) return { label: c.label, kind: c.kind, met: false, detail: `${c.table}: ${probe.error ?? "unreadable"}` };
  if (c.requireRows && probe.rows === 0) {
    return { label: c.label, kind: c.kind, met: false, detail: `${c.table}: readable but empty` };
  }
  return { label: c.label, kind: c.kind, met: true, detail: `${c.table}: ${probe.rows} rows readable` };
}

export function computeReadiness(coverage: Coverage): DomainScore[] {
  return READINESS_DOMAINS.map((domain) => {
    const criteria = CRITERIA[domain].map((c) => evaluateCriterion(c, coverage));
    const met = criteria.filter((c) => c.met).length;
    return {
      domain,
      criteria,
      met,
      total: criteria.length,
      score: criteria.length ? Math.round((met / criteria.length) * 100) : 0,
    };
  });
}

export function overallReadiness(scores: DomainScore[]): number {
  const met = scores.reduce((a, s) => a + s.met, 0);
  const total = scores.reduce((a, s) => a + s.total, 0);
  return total ? Math.round((met / total) * 100) : 0;
}

/* ------------------------------------------------------- blocker register */

export type BlockerSeverity = "P0" | "P1" | "P2" | "P3";

export interface Blocker {
  id: string;
  severity: BlockerSeverity;
  domain: string;
  title: string;
  impact: string;
  owner: string;
}

/**
 * Derive the production blocker register from the same evidence as the
 * scorecard. Unreadable authoritative tables are P0 (the system cannot safely
 * operate on them); missing systems of record and unwired notification rules
 * are P1/P2; lifecycle model defects are P1.
 */
export function deriveBlockers(coverage: Coverage, scores: DomainScore[]): Blocker[] {
  const out: Blocker[] = [];

  for (const probe of Object.values(coverage)) {
    if (probe.rows === null) {
      out.push({
        id: `read:${probe.table}`,
        severity: "P0",
        domain: "Data quality",
        title: `Authoritative table unreadable: ${probe.table}`,
        impact: probe.error ?? "Read denied — dependent workflows cannot operate",
        owner: "Platform Engineering",
      });
    }
  }

  for (const d of lifecycleDefects()) {
    out.push({
      id: `lifecycle:${d.lifecycle}:${d.defect}`,
      severity: "P1",
      domain: "Data quality",
      title: `Lifecycle defect in ${d.lifecycle}`,
      impact: d.defect,
      owner: "Business Systems",
    });
  }

  for (const e of unbackedEntities()) {
    out.push({
      id: `record:${e.key}`,
      severity: e.domain === "commercial" || e.domain === "financial" ? "P1" : "P2",
      domain: e.label,
      title: `No system of record for ${e.label}`,
      impact: e.note ?? "Workflow state cannot persist",
      owner: e.owner,
    });
  }

  for (const r of unwiredRules()) {
    out.push({
      id: `rule:${r.key}`,
      severity: "P2",
      domain: r.domain,
      title: `Notification rule not wired: ${r.event}`,
      impact: "Event cannot fire, so no work is created",
      owner: r.domain,
    });
  }

  for (const s of scores) {
    for (const c of s.criteria) {
      if (c.kind === "pending" && !c.met) {
        out.push({
          id: `pending:${s.domain}:${c.label}`,
          severity: "P3",
          domain: s.domain,
          title: c.label,
          impact: c.detail,
          owner: "Phase 3 integration",
        });
      }
    }
  }

  const order: BlockerSeverity[] = ["P0", "P1", "P2", "P3"];
  return out.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
}

export function productionVerdict(blockers: Blocker[]): { ready: boolean; reason: string } {
  const p0 = blockers.filter((b) => b.severity === "P0").length;
  const p1 = blockers.filter((b) => b.severity === "P1").length;
  if (p0 || p1) {
    return { ready: false, reason: `${p0} P0 and ${p1} P1 blockers outstanding — production cannot be declared ready` };
  }
  return { ready: true, reason: "No P0/P1 blockers outstanding" };
}

/* ------------------------------------------------- seed scenario definitions */

export interface SeedScenario {
  key: string;
  label: string;
  chain: readonly string[];
  /** Tables that must all be readable for the scenario to be executable. */
  requires: readonly string[];
}

export const SEED_SCENARIOS: readonly SeedScenario[] = [
  { key: "corporate", label: "Corporate mobility", chain: ["Lead", "Account", "Booking", "Invoice", "Payment", "Customer success"], requires: ["contact_submissions", "corporate_accounts", "charter_bookings", "corporate_invoices", "client_journey_events"] },
  { key: "logistics", label: "Logistics", chain: ["Customer", "Shipment", "Fulfilment", "Invoice"], requires: ["corporate_accounts", "delivery_orders", "delivery_dispatch_jobs", "corporate_invoices"] },
  { key: "charter", label: "Charter", chain: ["Request", "Operator", "Mission", "Completion", "Settlement"], requires: ["charter_quotes", "charter_partner_applications", "charter_bookings", "charter_wallet_finance_actions"] },
  { key: "employee", label: "Employee", chain: ["Position", "Employee", "Goal", "Performance", "Development"], requires: ["corporate_designations", "corporate_employees", "capabilities"] },
  { key: "partner", label: "Marketplace partner", chain: ["Application", "Verification", "Activation", "Transaction", "Settlement"], requires: ["charter_partner_applications", "charter_document_registry", "charter_inventory", "charter_bookings"] },
];

export function scenarioStatus(scenario: SeedScenario, coverage: Coverage): { executable: boolean; missing: string[] } {
  const missing = scenario.requires.filter((t) => !coverage[t] || coverage[t].rows === null);
  return { executable: missing.length === 0, missing };
}

export const ZERO_TRUST_PROBES = [
  { label: "Another department's HR records", table: "corporate_employees", expectation: "Denied unless staff scope permits" },
  { label: "Unauthorised financial information", table: "charter_wallet_ledger", expectation: "Finance scope only" },
  { label: "Restricted customer information", table: "corporate_accounts", expectation: "Commercial scope only" },
  { label: "Executive-only information", table: "admin_audit_log", expectation: "Platform admin only" },
  { label: "Administrative configuration", table: "corporate_admin_permission_grants", expectation: "Super admin only" },
] as const;

export const NOTIFICATION_RULE_COUNT = NOTIFICATION_RULES.length;
