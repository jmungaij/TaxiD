/**
 * Business Capability Contract — Module 3 · Delivery & Logistics Command Center.
 *
 * Published ahead of the module build so integration tests, dependency mapping
 * and the certification pipeline can be written against a stable contract.
 */
import type { CapabilityContract } from "./capabilityContract";

export const DELIVERY_LOGISTICS_CONTRACT: CapabilityContract = {
  module: "delivery_logistics",
  title: "Enterprise Logistics Operating System",
  version: "1.0.0-draft",
  route: "/dashboard/admin/logistics-center",
  owner: "Delivery & Logistics",
  workflows: [
    {
      id: "shipment_lifecycle",
      name: "Shipment lifecycle execution",
      trigger: "Delivery order created",
      stages: ["Order intake", "Warehouse allocation", "Dispatch", "In transit", "Handover", "POD/OTP capture", "Settlement"],
      approvals: ["Logistics manager for manual reroute", "Finance approver for compensation"],
      targetMinutes: 480,
    },
    {
      id: "exception_handling",
      name: "Delivery exception handling",
      trigger: "SLA threshold crossed or scan chain broken",
      stages: ["Detect exception", "Classify reason code", "Locate shipment", "Re-dispatch or reroute", "Notify partner and customer", "Close with root cause"],
      approvals: ["Logistics manager for redelivery at platform cost"],
      targetMinutes: 240,
    },
    {
      id: "partner_performance",
      name: "Logistics partner performance review",
      trigger: "Weekly performance cycle",
      stages: ["Aggregate partner SLA", "Compare against agreement", "Issue corrective action", "Verify improvement"],
      approvals: ["Partner manager"],
      targetMinutes: 10080,
    },
  ],
  publishes: [
    { name: "package.dispatched", payload: ["order_id", "courier_id", "dispatched_at"], latencyBudgetMinutes: 15, criticality: "standard" },
    { name: "package.delivered", payload: ["order_id", "delivered_at", "pod_id"], latencyBudgetMinutes: 10, criticality: "critical" },
    { name: "shipment.exception", payload: ["order_id", "exception_type", "sla_state", "zone"], latencyBudgetMinutes: 15, criticality: "critical" },
    { name: "pod.captured", payload: ["order_id", "pod_id", "otp_verified"], latencyBudgetMinutes: 10, criticality: "critical" },
    { name: "warehouse.capacity.signal", payload: ["warehouse_id", "backlog", "window"], latencyBudgetMinutes: 60, criticality: "standard" },
    { name: "partner.performance.snapshot", payload: ["partner_id", "on_time_rate", "exception_rate"], latencyBudgetMinutes: 1440, criticality: "standard" },
  ],
  consumes: [
    { name: "parcel.investigation.opened", payload: ["case_id", "order_id", "evidence_required"], latencyBudgetMinutes: 15, criticality: "standard" },
    { name: "refund.approved", payload: ["refund_id", "case_id", "status", "order_id", "amount_kes"], latencyBudgetMinutes: 30, criticality: "critical" },
    { name: "vehicle.defect.reported", payload: ["vehicle_id", "defect_type", "severity"], latencyBudgetMinutes: 120, criticality: "standard" },
    { name: "fraud.signal.raised", payload: ["subject_id", "score", "signal_type"], latencyBudgetMinutes: 10, criticality: "critical" },
  ],
  dependencies: [
    { module: "customer_operations", reason: "Lost-parcel and delivery-failure investigations", degradedBehaviour: "Exceptions queue locally until the case channel recovers" },
    { module: "fleet", reason: "Vehicle compliance and availability", degradedBehaviour: "Dispatch falls back to last-known compliance state" },
    { module: "finance_refunds", reason: "Compensation and partner settlement", degradedBehaviour: "Compensation decisions recorded but not disbursed" },
    { module: "trust_safety", reason: "Parcel tampering and delivery fraud screening", degradedBehaviour: "High-value shipments require manual release" },
  ],
  kpis: [
    { id: "on_time_rate", name: "On-time delivery rate", unit: "percent", target: "≥ 95%", source: "delivery_orders vs SLA thresholds" },
    { id: "exception_rate", name: "Exception rate", unit: "percent", target: "≤ 3%", source: "delivery exception events" },
    { id: "pod_completeness", name: "POD/OTP completeness", unit: "percent", target: "≥ 99%", source: "proof_of_delivery + OTP verification log" },
    { id: "scan_completeness", name: "Chain-of-custody scan completeness", unit: "percent", target: "≥ 99%", source: "package_chain_of_custody" },
    { id: "cost_per_delivery", name: "Cost per delivery", unit: "kes", target: "Within budget envelope", source: "settlement + route cost data" },
  ],
  aiRoadmap: [
    { service: "forecasting", status: "live", description: "Warehouse backlog and courier capacity forecasting per dispatch window", evaluation: "Forecast error against realised backlog, shadow-scored for two cycles before promotion" },
    { service: "risk_detection", status: "live", description: "Parcel tampering and delivery-fraud pattern detection", evaluation: "Precision against confirmed tampering cases" },
    { service: "classification", status: "planned", description: "Automatic exception reason-code assignment", evaluation: "Agreement with operator-confirmed reason codes" },
    { service: "sop_recommendation", status: "live", description: "Recommend the recovery playbook per exception type", evaluation: "Recovery success rate under the recommended playbook" },
    { service: "executive_summarization", status: "planned", description: "Network performance briefing for executives", evaluation: "Factual grounding against source KPIs" },
  ],
  failureModes: [
    { id: "scan_gap", mode: "Warehouse scan events missing", detection: "Scan completeness KPI falls below target", impact: "Chain of custody unprovable; parcel-loss liability increases", mitigation: "Block handover completion without a scan; raise a process CAPA" },
    { id: "gps_loss", mode: "Courier GPS telemetry loss", detection: "Route segments without location updates", impact: "Delivery evidence and ETA accuracy degrade", mitigation: "Fall back to scan and POD evidence; flag the device" },
    { id: "dispatch_backlog", mode: "Dispatch queue backlog exceeds capacity", detection: "Backlog above the dispatch-window tolerance", impact: "Cascading SLA breaches and support case creation", mitigation: "Rebalance couriers and publish the capacity signal to Marketplace" },
    { id: "partner_degradation", mode: "Partner performance falls below agreement", detection: "On-time rate below contractual floor for two cycles", impact: "Customer churn and contractual exposure", mitigation: "Issue corrective action with verification date; throttle allocation" },
  ],
  escalationPaths: [
    { trigger: "High-value shipment lost", tier: "Tier 3", owner: "Logistics manager + Trust & Safety", responseMinutes: 60 },
    { trigger: "Warehouse backlog critical", tier: "Tier 2", owner: "Warehouse operations lead", responseMinutes: 120 },
    { trigger: "Partner SLA breach (two cycles)", tier: "Tier 2", owner: "Partner manager", responseMinutes: 1440 },
    { trigger: "Suspected parcel tampering", tier: "Tier 3", owner: "Trust & Safety", responseMinutes: 30 },
  ],
};
