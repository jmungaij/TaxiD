/**
 * Canonical Business Process Catalog — Enterprise Operating Model, Layer 1.
 *
 * A capability answers "what can the platform do". A process answers
 * "how does the business run end to end". Every process is an ordered chain of
 * stages, each owned by a capability and observable through canonical events.
 *
 * Pure configuration + certification. No state, no network.
 */
import { CAPABILITY_CONTRACTS } from "@/lib/contracts";
import { canonicalEvent } from "./eventCatalog";

export type ProcessId =
  | "ride_to_cash"
  | "booking_to_settlement"
  | "delivery_to_cash"
  | "procure_to_pay"
  | "refund_to_resolution"
  | "support_to_closure"
  | "driver_onboard_to_active"
  | "corporate_lead_to_invoice";

export interface ProcessStage {
  id: string;
  name: string;
  /** Capability module accountable for the stage. */
  capability: string;
  /** Canonical events that evidence stage entry/exit. */
  events: string[];
  /** Stage cycle-time budget in minutes. */
  slaMinutes: number;
  /** Preventive/detective controls applied at this stage. */
  controls: string[];
}

export interface ProcessKpi {
  id: string;
  name: string;
  target: string;
  source: string;
}

export interface BusinessProcess {
  id: ProcessId;
  name: string;
  description: string;
  owner: string;
  /** Value stream classification. */
  valueStream: "revenue" | "cost" | "risk" | "growth";
  stages: ProcessStage[];
  kpis: ProcessKpi[];
  /** End-to-end SLA in minutes. */
  endToEndSlaMinutes: number;
  /** Regulatory or financial controls that span the whole process. */
  controls: string[];
  version: string;
}

export const BUSINESS_PROCESS_CATALOG: BusinessProcess[] = [
  {
    id: "ride_to_cash",
    name: "Ride to Cash",
    description: "Rider books a trip, driver completes it, fare is captured, settled and reconciled.",
    owner: "mobility_operations",
    valueStream: "revenue",
    endToEndSlaMinutes: 1440,
    version: "1.0.0",
    controls: ["fare certification", "wallet double-entry", "settlement reconciliation"],
    stages: [
      { id: "book", name: "Book", capability: "mobility", events: ["ride.booked"], slaMinutes: 5, controls: ["rider KYC state", "payment method validity"] },
      { id: "dispatch", name: "Dispatch & Start", capability: "mobility", events: ["ride.started"], slaMinutes: 15, controls: ["driver compliance check", "vehicle defect block"] },
      { id: "complete", name: "Complete & Fare", capability: "mobility", events: ["ride.completed"], slaMinutes: 5, controls: ["fare recomputation", "surge policy bounds"] },
      { id: "collect", name: "Collect", capability: "finance_refunds", events: ["wallet.debited"], slaMinutes: 10, controls: ["idempotent charge", "M-Pesa callback verification"] },
      { id: "settle", name: "Settle", capability: "finance_refunds", events: ["settlement.completed"], slaMinutes: 1440, controls: ["maker-checker payout", "ledger balance proof"] },
    ],
    kpis: [
      { id: "completion_rate", name: "Trip completion rate", target: "≥ 94%", source: "fact_trips" },
      { id: "collection_rate", name: "Fare collection rate", target: "≥ 99%", source: "payment_attempts" },
      { id: "settlement_lag", name: "Settlement lag", target: "≤ 24h", source: "settlements" },
    ],
  },
  {
    id: "booking_to_settlement",
    name: "Booking to Settlement",
    description: "Corporate and scheduled bookings through to partner/driver settlement.",
    owner: "corporate_operations",
    valueStream: "revenue",
    endToEndSlaMinutes: 2880,
    version: "1.0.0",
    controls: ["corporate wallet pre-funding", "cost centre allocation", "trip intent validation"],
    stages: [
      { id: "authorise", name: "Authorise booking", capability: "corporate", events: ["ride.booked"], slaMinutes: 5, controls: ["policy check", "budget availability"] },
      { id: "deliver", name: "Deliver trip", capability: "mobility", events: ["ride.completed"], slaMinutes: 240, controls: ["trip intent categorisation"] },
      { id: "invoice", name: "Invoice", capability: "corporate", events: ["corporate.invoice.issued"], slaMinutes: 1440, controls: ["KRA compliance", "invoice reconciliation"] },
      { id: "settle", name: "Settle partners", capability: "finance_refunds", events: ["settlement.completed"], slaMinutes: 1440, controls: ["dual approval", "bank/M-Pesa proof"] },
    ],
    kpis: [
      { id: "policy_compliance", name: "Travel policy compliance", target: "≥ 97%", source: "trip_bookings" },
      { id: "invoice_accuracy", name: "Invoice accuracy", target: "≥ 99.5%", source: "corporate_invoices" },
      { id: "dso", name: "Days sales outstanding", target: "≤ 30d", source: "corporate_invoices" },
    ],
  },
  {
    id: "delivery_to_cash",
    name: "Delivery to Cash",
    description: "Parcel dispatch, proof of delivery, exception handling and partner payout.",
    owner: "delivery_logistics",
    valueStream: "revenue",
    endToEndSlaMinutes: 2880,
    version: "1.0.0",
    controls: ["POD OTP verification", "exception SLA clock", "partner scorecard"],
    stages: [
      { id: "dispatch", name: "Dispatch", capability: "delivery_logistics", events: ["package.dispatched"], slaMinutes: 15, controls: ["courier compliance", "route feasibility"] },
      { id: "deliver", name: "Deliver", capability: "delivery_logistics", events: ["package.delivered", "pod.captured"], slaMinutes: 10, controls: ["POD capture", "geofence match"] },
      { id: "exception", name: "Exception handling", capability: "delivery_logistics", events: ["shipment.exception"], slaMinutes: 15, controls: ["SLA breach escalation", "investigation opening"] },
      { id: "payout", name: "Partner payout", capability: "finance_refunds", events: ["settlement.completed"], slaMinutes: 1440, controls: ["scorecard gating", "maker-checker payout"] },
    ],
    kpis: [
      { id: "otd", name: "On-time delivery", target: "≥ 95%", source: "delivery_orders" },
      { id: "pod_capture", name: "POD capture rate", target: "≥ 99%", source: "delivery_pod" },
      { id: "exception_rate", name: "Exception rate", target: "≤ 3%", source: "delivery_exceptions" },
    ],
  },
  {
    id: "refund_to_resolution",
    name: "Refund to Resolution",
    description: "Refund raised from a case, risk-scored, approved under maker-checker and paid.",
    owner: "finance_refunds",
    valueStream: "risk",
    endToEndSlaMinutes: 2880,
    version: "1.0.0",
    controls: ["maker-checker", "risk score gate", "evidence sufficiency"],
    stages: [
      { id: "raise", name: "Raise", capability: "customer_operations", events: ["refund.requested"], slaMinutes: 5, controls: ["evidence checklist", "duplicate detection"] },
      { id: "assess", name: "Assess risk", capability: "trust_safety", events: ["fraud.signal.raised"], slaMinutes: 30, controls: ["composite risk score", "contradiction detection"] },
      { id: "decide", name: "Decide", capability: "finance_refunds", events: ["refund.approved", "refund.rejected"], slaMinutes: 30, controls: ["policy limits", "dual approval above threshold"] },
      { id: "pay", name: "Pay", capability: "finance_refunds", events: ["wallet.credited"], slaMinutes: 5, controls: ["idempotent credit", "ledger proof"] },
    ],
    kpis: [
      { id: "refund_cycle", name: "Refund cycle time", target: "≤ 24h", source: "refund_requests" },
      { id: "leakage", name: "Refund leakage", target: "≤ 0.5%", source: "refund_requests" },
      { id: "reversal_rate", name: "Post-payment reversal rate", target: "≤ 1%", source: "wallet_transactions" },
    ],
  },
  {
    id: "support_to_closure",
    name: "Support to Closure",
    description: "Omnichannel case intake, routing, resolution, root cause and CAPA closure.",
    owner: "customer_operations",
    valueStream: "cost",
    endToEndSlaMinutes: 2880,
    version: "1.0.0",
    controls: ["SLA policy", "escalation matrix", "root cause required at closure"],
    stages: [
      { id: "intake", name: "Intake", capability: "customer_operations", events: ["case.opened"], slaMinutes: 5, controls: ["channel authentication", "classification"] },
      { id: "route", name: "Route & escalate", capability: "customer_operations", events: ["case.escalated"], slaMinutes: 10, controls: ["tier routing", "safety fast-path"] },
      { id: "resolve", name: "Resolve", capability: "customer_operations", events: ["case.resolved"], slaMinutes: 1440, controls: ["disposition taxonomy", "maker-checker on financial outcomes"] },
      { id: "improve", name: "Learn & improve", capability: "customer_operations", events: ["customerops.kpi.snapshot"], slaMinutes: 1440, controls: ["CAPA verification", "knowledge article update"] },
    ],
    kpis: [
      { id: "frt", name: "First response time", target: "≤ 15m", source: "support_case_events" },
      { id: "mttr", name: "Mean time to resolve", target: "≤ 24h", source: "support_cases" },
      { id: "sla_compliance", name: "SLA compliance", target: "≥ 95%", source: "support_sla_policies" },
    ],
  },
  {
    id: "driver_onboard_to_active",
    name: "Driver Onboard to Active",
    description: "Applicant capture, compliance verification, academy completion and activation.",
    owner: "fleet",
    valueStream: "growth",
    endToEndSlaMinutes: 4320,
    version: "1.0.0",
    controls: ["NTSA/KRA document verification", "background check", "vehicle inspection"],
    stages: [
      { id: "apply", name: "Apply", capability: "fleet", events: ["driver.incident.recorded"], slaMinutes: 60, controls: ["identity verification"] },
      { id: "verify", name: "Verify compliance", capability: "trust_safety", events: ["conduct.signal.published"], slaMinutes: 1440, controls: ["document expiry policy", "sanctions screening"] },
      { id: "inspect", name: "Inspect vehicle", capability: "fleet", events: ["vehicle.defect.reported"], slaMinutes: 1440, controls: ["defect blocklist"] },
      { id: "activate", name: "Activate", capability: "fleet", events: ["supply.gap.published"], slaMinutes: 60, controls: ["supply balance check"] },
    ],
    kpis: [
      { id: "onboard_cycle", name: "Onboarding cycle time", target: "≤ 72h", source: "driver_applications" },
      { id: "doc_validity", name: "Document validity rate", target: "≥ 98%", source: "driver_documents" },
      { id: "activation_rate", name: "Applicant activation rate", target: "≥ 60%", source: "drivers" },
    ],
  },
  {
    id: "corporate_lead_to_invoice",
    name: "Corporate Lead to Invoice",
    description: "Corporate acquisition through KYB, wallet funding, usage and first invoice.",
    owner: "corporate",
    valueStream: "growth",
    endToEndSlaMinutes: 10080,
    version: "1.0.0",
    controls: ["CR12/KRA KYB", "credit policy", "pre-funded wallet"],
    stages: [
      { id: "kyb", name: "KYB verification", capability: "corporate", events: ["case.opened"], slaMinutes: 2880, controls: ["document authenticity", "beneficial ownership"] },
      { id: "fund", name: "Fund wallet", capability: "finance_refunds", events: ["wallet.credited"], slaMinutes: 30, controls: ["M-Pesa reconciliation"] },
      { id: "use", name: "Consume services", capability: "mobility", events: ["ride.completed"], slaMinutes: 10080, controls: ["policy enforcement", "budget alerts"] },
      { id: "invoice", name: "Invoice", capability: "corporate", events: ["corporate.invoice.issued"], slaMinutes: 1440, controls: ["tax compliance", "statement reconciliation"] },
    ],
    kpis: [
      { id: "kyb_cycle", name: "KYB cycle time", target: "≤ 48h", source: "corporate_documents" },
      { id: "wallet_funded", name: "Accounts funded within 7d", target: "≥ 80%", source: "corporate_wallets" },
      { id: "first_invoice", name: "Time to first invoice", target: "≤ 35d", source: "corporate_invoices" },
    ],
  },
  {
    id: "procure_to_pay",
    name: "Procure to Pay",
    description: "Vendor and logistics partner procurement through goods/service receipt and payment.",
    owner: "finance_refunds",
    valueStream: "cost",
    endToEndSlaMinutes: 20160,
    version: "1.0.0",
    controls: ["vendor due diligence", "three-way match", "segregation of duties"],
    stages: [
      { id: "onboard_vendor", name: "Onboard vendor", capability: "marketplace", events: ["partner.performance.snapshot"], slaMinutes: 4320, controls: ["tax compliance", "sanctions screening"] },
      { id: "receive", name: "Receive goods/services", capability: "delivery_logistics", events: ["warehouse.capacity.signal"], slaMinutes: 1440, controls: ["goods receipt note"] },
      { id: "pay", name: "Pay", capability: "finance_refunds", events: ["settlement.completed"], slaMinutes: 4320, controls: ["three-way match", "dual approval"] },
    ],
    kpis: [
      { id: "match_rate", name: "Three-way match rate", target: "≥ 98%", source: "vendor_invoices" },
      { id: "on_time_payment", name: "On-time payment rate", target: "≥ 95%", source: "settlements" },
      { id: "vendor_compliance", name: "Vendor compliance rate", target: "100%", source: "vendors" },
    ],
  },
];

export interface ProcessIssue {
  process: ProcessId;
  stage?: string;
  severity: "p0" | "p1" | "p2";
  message: string;
}

export interface ProcessCertification {
  process: ProcessId;
  name: string;
  passed: boolean;
  score: number;
  /** Fraction of stages backed by a registered capability contract. */
  capabilityCoverage: number;
  eventCoverage: number;
  issues: ProcessIssue[];
}

const CONTRACT_MODULES = new Set(CAPABILITY_CONTRACTS.map((c) => c.module as string));

export function certifyProcess(process: BusinessProcess): ProcessCertification {
  const issues: ProcessIssue[] = [];
  let stagesWithContract = 0;
  let eventsKnown = 0;
  let eventsTotal = 0;

  for (const stage of process.stages) {
    if (CONTRACT_MODULES.has(stage.capability)) stagesWithContract += 1;
    else issues.push({ process: process.id, stage: stage.id, severity: "p2", message: `capability '${stage.capability}' has no published capability contract yet` });

    if (stage.events.length === 0) {
      issues.push({ process: process.id, stage: stage.id, severity: "p1", message: "stage emits no canonical event — not observable" });
    }
    for (const e of stage.events) {
      eventsTotal += 1;
      if (canonicalEvent(e)) eventsKnown += 1;
      else issues.push({ process: process.id, stage: stage.id, severity: "p0", message: `event '${e}' is not in the canonical catalog` });
    }
    if (stage.controls.length === 0) {
      issues.push({ process: process.id, stage: stage.id, severity: "p1", message: "stage declares no control" });
    }
  }

  const stageBudget = process.stages.reduce((n, s) => n + s.slaMinutes, 0);
  if (stageBudget > process.endToEndSlaMinutes) {
    issues.push({ process: process.id, severity: "p1", message: `stage budgets (${stageBudget}m) exceed the end-to-end SLA (${process.endToEndSlaMinutes}m)` });
  }
  if (process.kpis.length < 3) issues.push({ process: process.id, severity: "p1", message: "fewer than 3 process KPIs declared" });
  if (!process.owner.trim()) issues.push({ process: process.id, severity: "p0", message: "process has no accountable owner" });

  const p0 = issues.filter((i) => i.severity === "p0").length;
  const p1 = issues.filter((i) => i.severity === "p1").length;
  const p2 = issues.filter((i) => i.severity === "p2").length;
  const score = Math.max(0, 100 - p0 * 30 - p1 * 8 - p2 * 2);

  return {
    process: process.id,
    name: process.name,
    passed: p0 === 0 && p1 === 0,
    score,
    capabilityCoverage: process.stages.length === 0 ? 0 : Math.round((stagesWithContract / process.stages.length) * 100),
    eventCoverage: eventsTotal === 0 ? 0 : Math.round((eventsKnown / eventsTotal) * 100),
    issues,
  };
}

export interface ProcessCatalogReport {
  passed: boolean;
  score: number;
  processes: ProcessCertification[];
  blockers: string[];
}

export function certifyProcessCatalog(
  processes: BusinessProcess[] = BUSINESS_PROCESS_CATALOG,
): ProcessCatalogReport {
  const results = processes.map(certifyProcess);
  const score = results.length === 0 ? 0 : Math.round(results.reduce((s, r) => s + r.score, 0) / results.length);
  return {
    passed: results.every((r) => r.issues.every((i) => i.severity !== "p0")),
    score,
    processes: results,
    blockers: results.flatMap((r) => r.issues.filter((i) => i.severity === "p0").map((i) => `${r.name}: ${i.message}`)),
  };
}

export function processesForCapability(module: string): BusinessProcess[] {
  return BUSINESS_PROCESS_CATALOG.filter((p) => p.stages.some((s) => s.capability === module));
}
