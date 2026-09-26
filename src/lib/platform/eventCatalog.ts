/**
 * Canonical Enterprise Event Catalog.
 *
 * Single source of truth for every business event the platform may publish or
 * consume. Capability contracts are validated AGAINST this catalog, so a module
 * cannot invent private event names or drift on payload shape.
 *
 * Pure configuration — no network, no state.
 */

export type EventDomain =
  | "mobility"
  | "delivery"
  | "finance"
  | "customer_operations"
  | "trust_safety"
  | "fleet"
  | "corporate"
  | "marketplace";

export interface CanonicalEvent {
  /** Canonical dotted name. Immutable once published. */
  name: string;
  domain: EventDomain;
  description: string;
  /** Required payload keys. Producers may add keys, never omit these. */
  payload: string[];
  criticality: "critical" | "standard";
  /** Delivery budget in minutes from emit to consumer ack. */
  latencyBudgetMinutes: number;
  /** Capability that owns the definition (single writer). */
  owner: string;
  version: 1;
}

export const ENTERPRISE_EVENT_CATALOG: readonly CanonicalEvent[] = [
  // ── Mobility ──────────────────────────────────────────────────────────────
  { name: "ride.booked", domain: "mobility", description: "Rider confirmed a trip request", payload: ["ride_id", "rider_id", "trip_intent"], criticality: "standard", latencyBudgetMinutes: 5, owner: "mobility", version: 1 },
  { name: "ride.started", domain: "mobility", description: "Driver began the trip", payload: ["ride_id", "driver_id", "started_at"], criticality: "standard", latencyBudgetMinutes: 5, owner: "mobility", version: 1 },
  { name: "ride.completed", domain: "mobility", description: "Trip completed and fare finalised", payload: ["ride_id", "fare_kes", "completed_at"], criticality: "critical", latencyBudgetMinutes: 5, owner: "mobility", version: 1 },
  { name: "ride.cancelled", domain: "mobility", description: "Trip cancelled by rider, driver or system", payload: ["ride_id", "cancelled_by", "reason_code"], criticality: "standard", latencyBudgetMinutes: 10, owner: "mobility", version: 1 },
  { name: "supply.gap.published", domain: "mobility", description: "Zone level supply shortfall detected", payload: ["zone", "delay_case_count", "window"], criticality: "standard", latencyBudgetMinutes: 60, owner: "customer_operations", version: 1 },

  // ── Delivery & Logistics ──────────────────────────────────────────────────
  { name: "package.dispatched", domain: "delivery", description: "Parcel assigned to a courier and left origin", payload: ["order_id", "courier_id", "dispatched_at"], criticality: "standard", latencyBudgetMinutes: 15, owner: "delivery_logistics", version: 1 },
  { name: "package.delivered", domain: "delivery", description: "Parcel delivered and proof captured", payload: ["order_id", "delivered_at", "pod_id"], criticality: "critical", latencyBudgetMinutes: 10, owner: "delivery_logistics", version: 1 },
  { name: "shipment.exception", domain: "delivery", description: "Delivery exception raised against an order", payload: ["order_id", "exception_type", "sla_state"], criticality: "critical", latencyBudgetMinutes: 15, owner: "delivery_logistics", version: 1 },
  { name: "pod.captured", domain: "delivery", description: "Proof of delivery captured and verified", payload: ["order_id", "pod_id", "otp_verified"], criticality: "critical", latencyBudgetMinutes: 10, owner: "delivery_logistics", version: 1 },
  { name: "warehouse.capacity.signal", domain: "delivery", description: "Warehouse backlog / capacity snapshot", payload: ["warehouse_id", "backlog", "window"], criticality: "standard", latencyBudgetMinutes: 60, owner: "delivery_logistics", version: 1 },
  { name: "partner.performance.snapshot", domain: "delivery", description: "Logistics partner scorecard snapshot", payload: ["partner_id", "on_time_rate", "exception_rate"], criticality: "standard", latencyBudgetMinutes: 1440, owner: "delivery_logistics", version: 1 },
  { name: "parcel.investigation.opened", domain: "delivery", description: "Parcel loss/damage investigation opened", payload: ["case_id", "order_id", "evidence_required"], criticality: "standard", latencyBudgetMinutes: 15, owner: "customer_operations", version: 1 },

  { name: "surge.zone.published", domain: "mobility", description: "Approved surge multiplier published for a zone", payload: ["zone_id", "multiplier", "version"], criticality: "standard", latencyBudgetMinutes: 5, owner: "mobility", version: 1 },
  { name: "partner.activated", domain: "mobility", description: "Marketplace partner activated into live supply", payload: ["partner_id", "supply_type", "city"], criticality: "standard", latencyBudgetMinutes: 60, owner: "marketplace", version: 1 },
  { name: "marketplace.incentive.applied", domain: "mobility", description: "Incentive campaign applied to a zone", payload: ["campaign_id", "zone_id", "budget_kes"], criticality: "standard", latencyBudgetMinutes: 30, owner: "marketplace", version: 1 },

  // ── Finance ───────────────────────────────────────────────────────────────
  { name: "wallet.credited", domain: "finance", description: "Wallet balance increased (top-up, refund, payout)", payload: ["wallet_id", "amount_kes", "source"], criticality: "critical", latencyBudgetMinutes: 5, owner: "finance_refunds", version: 1 },
  { name: "wallet.debited", domain: "finance", description: "Wallet balance decreased", payload: ["wallet_id", "amount_kes", "reason"], criticality: "critical", latencyBudgetMinutes: 5, owner: "finance_refunds", version: 1 },
  { name: "refund.requested", domain: "finance", description: "Refund raised from a case or dispute", payload: ["case_id", "amount_kes", "evidence_refs"], criticality: "critical", latencyBudgetMinutes: 5, owner: "customer_operations", version: 1 },
  { name: "refund.approved", domain: "finance", description: "Refund approved under maker-checker", payload: ["refund_id", "case_id", "status"], criticality: "critical", latencyBudgetMinutes: 30, owner: "finance_refunds", version: 1 },
  { name: "refund.rejected", domain: "finance", description: "Refund declined with reason code", payload: ["refund_id", "case_id", "reason_code"], criticality: "standard", latencyBudgetMinutes: 30, owner: "finance_refunds", version: 1 },
  { name: "corporate.invoice.issued", domain: "corporate", description: "Corporate invoice generated for a billing period", payload: ["invoice_id", "company_id", "amount_kes", "period"], criticality: "critical", latencyBudgetMinutes: 60, owner: "corporate", version: 1 },
  { name: "corporate.ride.approved", domain: "corporate", description: "Corporate-billed trip approved under policy and budget", payload: ["approval_id", "employee_id", "company_id"], criticality: "critical", latencyBudgetMinutes: 10, owner: "corporate", version: 1 },
  { name: "corporate.policy.violation", domain: "corporate", description: "Corporate travel policy breached on a trip", payload: ["violation_id", "policy_rule", "employee_id"], criticality: "standard", latencyBudgetMinutes: 30, owner: "corporate", version: 1 },
  { name: "corporate.wallet.topped_up", domain: "corporate", description: "Corporate pre-funded wallet credited", payload: ["company_id", "amount_kes", "reference"], criticality: "critical", latencyBudgetMinutes: 15, owner: "corporate", version: 1 },
  { name: "settlement.completed", domain: "finance", description: "Partner / driver settlement run completed", payload: ["settlement_id", "amount_kes", "period"], criticality: "critical", latencyBudgetMinutes: 60, owner: "finance_refunds", version: 1 },

  // ── Customer Operations ───────────────────────────────────────────────────
  { name: "case.opened", domain: "customer_operations", description: "Support case created from any channel", payload: ["case_id", "case_type", "channel"], criticality: "standard", latencyBudgetMinutes: 5, owner: "customer_operations", version: 1 },
  { name: "case.escalated", domain: "customer_operations", description: "Case escalated to another domain or tier", payload: ["case_id", "tier", "target_domain"], criticality: "critical", latencyBudgetMinutes: 10, owner: "customer_operations", version: 1 },
  { name: "case.resolved", domain: "customer_operations", description: "Case resolved with disposition and root cause", payload: ["case_id", "disposition", "root_cause"], criticality: "standard", latencyBudgetMinutes: 30, owner: "customer_operations", version: 1 },
  { name: "customerops.kpi.snapshot", domain: "customer_operations", description: "Daily operations KPI snapshot", payload: ["sla_compliance", "mttr", "frt", "root_cause_distribution"], criticality: "standard", latencyBudgetMinutes: 1440, owner: "customer_operations", version: 1 },

  // ── Trust & Safety / Fleet ────────────────────────────────────────────────
  { name: "safety.escalation.published", domain: "trust_safety", description: "Safety incident escalated for rapid response", payload: ["case_id", "driver_id", "severity"], criticality: "critical", latencyBudgetMinutes: 5, owner: "customer_operations", version: 1 },
  { name: "conduct.signal.published", domain: "trust_safety", description: "Driver / rider conduct signal recorded", payload: ["driver_id", "reason_code", "severity"], criticality: "standard", latencyBudgetMinutes: 30, owner: "customer_operations", version: 1 },
  { name: "fraud.signal.raised", domain: "trust_safety", description: "Fraud engine raised a scored signal", payload: ["subject_id", "score", "signal_type"], criticality: "critical", latencyBudgetMinutes: 10, owner: "trust_safety", version: 1 },
  { name: "driver.suspended", domain: "trust_safety", description: "Driver suspended pending investigation", payload: ["driver_id", "reason_code", "suspended_until"], criticality: "critical", latencyBudgetMinutes: 10, owner: "trust_safety", version: 1 },
  { name: "driver.incident.recorded", domain: "fleet", description: "Driver incident logged against the fleet record", payload: ["driver_id", "incident_type", "severity"], criticality: "standard", latencyBudgetMinutes: 60, owner: "fleet", version: 1 },
  { name: "vehicle.defect.reported", domain: "fleet", description: "Vehicle defect reported from inspection or trip", payload: ["vehicle_id", "defect_type", "severity"], criticality: "standard", latencyBudgetMinutes: 120, owner: "fleet", version: 1 },
] as const;

const INDEX = new Map(ENTERPRISE_EVENT_CATALOG.map((e) => [e.name, e]));

export function canonicalEvent(name: string): CanonicalEvent | undefined {
  return INDEX.get(name);
}

export interface EventConformanceIssue {
  event: string;
  severity: "p0" | "p1";
  message: string;
}

export interface EventConformanceReport {
  passed: boolean;
  score: number;
  checked: number;
  issues: EventConformanceIssue[];
}

interface DeclaredEvent {
  name: string;
  payload: string[];
  latencyBudgetMinutes: number;
  criticality: "critical" | "standard";
}

/**
 * Verify a capability's declared publish/consume events against the catalog:
 * unknown names are P0, payload/latency/criticality drift is P1.
 */
export function certifyEventConformance(declared: DeclaredEvent[]): EventConformanceReport {
  const issues: EventConformanceIssue[] = [];

  for (const d of declared) {
    const c = INDEX.get(d.name);
    if (!c) {
      issues.push({ event: d.name, severity: "p0", message: "not registered in the canonical event catalog" });
      continue;
    }
    const missing = c.payload.filter((k) => !d.payload.includes(k));
    if (missing.length > 0) {
      issues.push({ event: d.name, severity: "p1", message: `payload missing canonical keys: ${missing.join(", ")}` });
    }
    if (d.latencyBudgetMinutes > c.latencyBudgetMinutes) {
      issues.push({ event: d.name, severity: "p1", message: `latency budget ${d.latencyBudgetMinutes}m exceeds canonical ${c.latencyBudgetMinutes}m` });
    }
    if (d.criticality !== c.criticality) {
      issues.push({ event: d.name, severity: "p1", message: `criticality '${d.criticality}' differs from canonical '${c.criticality}'` });
    }
  }

  const p0 = issues.filter((i) => i.severity === "p0").length;
  const p1 = issues.length - p0;
  const score = Math.max(0, 100 - p0 * 25 - p1 * 5);
  return { passed: p0 === 0 && p1 === 0, score, checked: declared.length, issues };
}
