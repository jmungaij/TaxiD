/**
 * Phase D7.6 — Cross-Domain Workflow Certification.
 *
 * Pure, network-free certification that models end-to-end business
 * workflows spanning multiple 360 workspaces. Where D7.5 asked
 * "does each domain use the canonical financial engine?", this asks
 * "do the workflows we run in production traverse only canonical
 * services, or do they fork into private ones?".
 *
 * Adding a workflow here immediately ratchets the readiness gate.
 * A workflow is CANONICAL when every declared step maps to a table
 * that is either shared infrastructure or a domain-owned table
 * belonging to the adopted 360 workspace registry.
 */
import { WORKSPACE360_HEALTH } from "./health";
import { WORKSPACE360_DOMAINS, isDeferredWorkspace360Domain, type Workspace360Domain } from "./domains";

/** Shared infrastructure tables — the enterprise operating core. */
export const CANONICAL_SHARED_SERVICES = [
  "wallets",
  "wallet_transactions",
  "journals",
  "journal_lines",
  "ledger_accounts",
  "payment_attempts",
  "mpesa_transactions",
  "trip_bookings",
  "driver_payouts",
  "corporate_invoices",
] as const;

export interface Workspace360WorkflowStep {
  domain: Workspace360Domain | "shared";
  table: string;
  label: string;
}

export interface Workspace360Workflow {
  id: string;
  title: string;
  steps: Workspace360WorkflowStep[];
}

export const WORKSPACE360_WORKFLOWS: Workspace360Workflow[] = [
  {
    id: "rider-trip-settlement",
    title: "Rider → Trip → Driver → Wallet → Ledger → Journal → Timeline",
    steps: [
      { domain: "rider",   table: "rider_profiles",       label: "Rider profile" },
      { domain: "shared",  table: "trip_bookings",        label: "Trip booking" },
      { domain: "driver",  table: "drivers",              label: "Driver assignment" },
      { domain: "shared",  table: "wallet_transactions",  label: "Wallet credit" },
      { domain: "shared",  table: "ledger_accounts",      label: "Ledger posting" },
      { domain: "shared",  table: "journal_lines",        label: "Journal line" },
    ],
  },
  {
    id: "corporate-approval-invoice",
    title: "Corporate → Approval → Trip → Invoice → Payment → Ledger",
    steps: [
      { domain: "corporate", table: "corporate_accounts",         label: "Corporate account" },
      { domain: "corporate", table: "corporate_ride_approvals",   label: "Ride approval" },
      { domain: "shared",    table: "trip_bookings",              label: "Trip booking" },
      { domain: "shared",    table: "corporate_invoices",         label: "Invoice" },
      { domain: "shared",    table: "payment_attempts",           label: "Payment" },
      { domain: "shared",    table: "journal_lines",              label: "Journal line" },
    ],
  },
  {
    id: "fleet-vehicle-earnings",
    title: "Fleet → Vehicle → Driver → Trip → Earnings",
    steps: [
      { domain: "fleet",  table: "fleet_companies",     label: "Fleet company" },
      { domain: "fleet",  table: "fleet_vehicles",      label: "Vehicle assignment" },
      { domain: "driver", table: "drivers",             label: "Driver" },
      { domain: "shared", table: "trip_bookings",       label: "Trip" },
      { domain: "shared", table: "driver_payouts",      label: "Earnings payout" },
      { domain: "shared", table: "journal_lines",       label: "Journal line" },
    ],
  },
  // Phase B1.1 — canonical workflows that exercise the newly adopted
  // Courier / Package / Logistics domains through the shared ledger.
  {
    id: "package-cod-settlement",
    title: "Package → Chain of custody → POD → Wallet credit → Journal",
    steps: [
      { domain: "package", table: "packages",                 label: "Package created" },
      { domain: "package", table: "package_chain_of_custody", label: "Custody handoff" },
      { domain: "package", table: "proof_of_delivery",        label: "Proof of delivery" },
      { domain: "shared",  table: "wallet_transactions",      label: "COD credit" },
      { domain: "shared",  table: "journal_lines",            label: "Journal line" },
    ],
  },
  {
    id: "courier-earnings-payout",
    title: "Courier onboarding → Delivery order → Score → Wallet → Payout",
    steps: [
      { domain: "courier", table: "delivery_onboarding",     label: "Courier onboarding" },
      { domain: "courier", table: "delivery_orders",         label: "Delivery order" },
      { domain: "courier", table: "delivery_driver_scores",  label: "Performance score" },
      { domain: "shared",  table: "wallet_transactions",     label: "Earnings credit" },
      { domain: "shared",  table: "driver_payouts",          label: "Payout" },
      { domain: "shared",  table: "journal_lines",           label: "Journal line" },
    ],
  },
  {
    id: "logistics-dispatch-settlement",
    title: "Dispatch request → Assignment → Route → Wallet → Ledger",
    steps: [
      { domain: "logistics", table: "dispatch_requests",       label: "Dispatch request" },
      { domain: "logistics", table: "dispatch_assignments",    label: "Assignment" },
      { domain: "logistics", table: "delivery_route_segments", label: "Route segments" },
      { domain: "shared",    table: "wallet_transactions",     label: "Settlement credit" },
      { domain: "shared",    table: "ledger_accounts",         label: "Ledger posting" },
      { domain: "shared",    table: "journal_lines",           label: "Journal line" },
    ],
  },
];

export interface WorkflowStepReport {
  step: Workspace360WorkflowStep;
  canonical: boolean;
  reason?: string;
}

export interface WorkflowReport {
  id: string;
  title: string;
  passed: boolean;
  /** Every non-shared domain in this workflow has a documented adoption deferral. */
  deferred: boolean;
  deferredDomains: string[];
  steps: WorkflowStepReport[];
}

export interface CrossDomainWorkflowReport {
  passed: boolean;
  score: number;
  workflows: WorkflowReport[];
  /** Workflows excluded from pass/score because their domains are deferred. */
  deferredWorkflows: string[];
}

const SHARED_SET: ReadonlySet<string> = new Set(CANONICAL_SHARED_SERVICES);

function isCanonical(step: Workspace360WorkflowStep, adopted: Set<string>): { ok: boolean; reason?: string } {
  if (step.domain === "shared") {
    if (SHARED_SET.has(step.table)) return { ok: true };
    return { ok: false, reason: `Shared step references non-canonical table "${step.table}"` };
  }
  if (!WORKSPACE360_DOMAINS.includes(step.domain as Workspace360Domain)) {
    return { ok: false, reason: `Unknown domain "${step.domain}"` };
  }
  if (!adopted.has(step.domain)) {
    return { ok: false, reason: `Domain "${step.domain}" not adopted onto Workspace360Shell` };
  }
  const spec = WORKSPACE360_HEALTH[step.domain as Workspace360Domain];
  if (!spec) return { ok: false, reason: `No health spec for domain "${step.domain}"` };
  if (!spec.tables.includes(step.table)) {
    return { ok: false, reason: `Table "${step.table}" not declared by ${step.domain} workspace` };
  }
  return { ok: true };
}

export function certifyCrossDomainWorkflows(
  adoptedDomains: string[],
  workflows: Workspace360Workflow[] = WORKSPACE360_WORKFLOWS,
): CrossDomainWorkflowReport {
  const adopted = new Set(adoptedDomains);
  const reports: WorkflowReport[] = workflows.map((wf) => {
    const steps: WorkflowStepReport[] = wf.steps.map((s) => {
      const r = isCanonical(s, adopted);
      return { step: s, canonical: r.ok, reason: r.reason };
    });
    const domainSteps = wf.steps.filter((s) => s.domain !== "shared");
    const deferredDomains = Array.from(
      new Set(domainSteps.map((s) => s.domain).filter((d) => isDeferredWorkspace360Domain(d))),
    );
    // A workflow is deferred only when EVERY business domain it traverses has a
    // documented adoption deferral — it is reported, not counted as a failure.
    const deferred =
      domainSteps.length > 0 &&
      domainSteps.every((s) => isDeferredWorkspace360Domain(s.domain));
    return {
      id: wf.id,
      title: wf.title,
      passed: steps.every((s) => s.canonical),
      deferred,
      deferredDomains,
      steps,
    };
  });
  const scored = reports.filter((r) => !r.deferred);
  const passedCount = scored.filter((r) => r.passed).length;
  const score = scored.length === 0 ? 0 : Math.round((passedCount / scored.length) * 100);
  return {
    passed: scored.every((r) => r.passed),
    score,
    workflows: reports,
    deferredWorkflows: reports.filter((r) => r.deferred).map((r) => r.id),
  };
}

