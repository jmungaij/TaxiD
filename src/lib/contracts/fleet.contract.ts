/**
 * Business Capability Contract — Fleet Operations.
 *
 * Stage 0 (Platform Integrity Closure): resolves every declared dependency on
 * `fleet` and binds the Fleet and Drivers business objects into the knowledge
 * graph.
 */
import type { CapabilityContract } from "./capabilityContract";

export const FLEET_CONTRACT: CapabilityContract = {
  module: "fleet",
  title: "Fleet & Driver Operations",
  version: "1.0.0",
  route: "/dashboard/admin/fleet",
  owner: "Fleet Operations",
  workflows: [
    {
      id: "driver_onboarding",
      name: "Driver onboarding and activation",
      trigger: "Driver application submitted",
      stages: ["Identity and KRA verification", "Document review", "Vehicle inspection", "Training and assessment", "Activation"],
      approvals: ["Compliance reviewer for documents", "Fleet manager for activation"],
      targetMinutes: 4320,
    },
    {
      id: "vehicle_compliance",
      name: "Vehicle compliance lifecycle",
      trigger: "Inspection due, insurance expiry or defect reported",
      stages: ["Detect expiry or defect", "Notify owner", "Schedule inspection or repair", "Verify evidence", "Restore availability"],
      approvals: ["Fleet manager to return a vehicle to service"],
      targetMinutes: 2880,
    },
    {
      id: "incident_management",
      name: "Driver incident management",
      trigger: "Incident reported by driver, rider or telematics",
      stages: ["Record incident", "Assess severity", "Insurance notification", "Corrective action", "Close with root cause"],
      approvals: ["Fleet manager for insurance claim submission"],
      targetMinutes: 1440,
    },
  ],
  publishes: [
    { name: "driver.incident.recorded", payload: ["driver_id", "incident_type", "severity", "vehicle_id"], latencyBudgetMinutes: 60, criticality: "standard" },
    { name: "vehicle.defect.reported", payload: ["vehicle_id", "defect_type", "severity", "reported_by"], latencyBudgetMinutes: 120, criticality: "standard" },
  ],
  consumes: [
    { name: "ride.started", payload: ["ride_id", "driver_id", "started_at"], latencyBudgetMinutes: 5, criticality: "standard" },
    { name: "ride.completed", payload: ["ride_id", "fare_kes", "completed_at"], latencyBudgetMinutes: 5, criticality: "critical" },
    { name: "driver.suspended", payload: ["driver_id", "reason_code", "suspended_until"], latencyBudgetMinutes: 10, criticality: "critical" },
    { name: "package.dispatched", payload: ["order_id", "courier_id", "dispatched_at"], latencyBudgetMinutes: 15, criticality: "standard" },
    { name: "settlement.completed", payload: ["settlement_id", "amount_kes", "period"], latencyBudgetMinutes: 60, criticality: "critical" },
  ],
  dependencies: [
    { module: "trust_safety", reason: "Suspension and enforcement decisions affecting availability", degradedBehaviour: "Availability computed from last-known enforcement state" },
    { module: "finance_refunds", reason: "Driver earnings, deductions and settlement outcomes", degradedBehaviour: "Earnings views show the last certified settlement snapshot" },
    { module: "customer_operations", reason: "Driver-related complaints and support cases", degradedBehaviour: "Conduct scores exclude open case signals" },
    { module: "delivery_logistics", reason: "Courier assignment and vehicle utilisation for delivery", degradedBehaviour: "Utilisation reported for mobility only" },
  ],
  kpis: [
    { id: "compliance_rate", name: "Document and inspection compliance rate", unit: "percent", target: "≥ 98%", source: "driver_documents + vehicle inspections" },
    { id: "activation_cycle", name: "Onboarding activation cycle", unit: "minutes", target: "≤ 4320 minutes p90", source: "driver onboarding timestamps" },
    { id: "utilisation", name: "Fleet utilisation", unit: "percent", target: "≥ 65%", source: "online hours vs available hours" },
    { id: "incident_rate", name: "Incidents per 1,000 trips", unit: "count", target: "≤ 2", source: "driver_incidents vs completed trips" },
    { id: "vehicle_downtime", name: "Vehicle downtime", unit: "minutes", target: "≤ 5% of available time", source: "defect to restoration intervals" },
  ],
  aiRoadmap: [
    { service: "forecasting", status: "live", description: "Vehicle maintenance and document-expiry forecasting per asset", evaluation: "Lead-time accuracy against realised expiries and breakdowns" },
    { service: "risk_detection", status: "live", description: "Unsafe driving and telematics anomaly detection", evaluation: "Correlation with confirmed incidents, shadow-scored before enforcement" },
    { service: "classification", status: "planned", description: "Automatic document type and defect classification at upload", evaluation: "Agreement with reviewer-confirmed labels" },
    { service: "prioritization", status: "planned", description: "Compliance review queue ranking by expiry exposure", evaluation: "Reduction in expired-document operating hours" },
  ],
  failureModes: [
    { id: "expired_document_operating", mode: "Driver operates with an expired document", detection: "Compliance scan finds an active driver with an expired record", impact: "Regulatory breach and uninsured exposure", mitigation: "Automatic availability block at expiry; escalate to compliance" },
    { id: "orphan_driver", mode: "Driver record without a linked profile or vehicle", detection: "Orphan classification job", impact: "Payouts and compliance checks silently skip the driver", mitigation: "Quarantine the record and require reconciliation before activation" },
    { id: "telematics_gap", mode: "Telematics or GPS feed lost for a vehicle", detection: "No location updates during an active session", impact: "Safety and utilisation reporting degrade", mitigation: "Fall back to trip events; flag the device for service" },
    { id: "inspection_backlog", mode: "Inspection backlog exceeds capacity", detection: "Pending inspections above the window tolerance", impact: "Fleet availability falls and compliance decays", mitigation: "Rebalance inspection slots; prioritise assets nearest expiry" },
  ],
  escalationPaths: [
    { trigger: "Active driver found non-compliant", tier: "Tier 3", owner: "Compliance officer", responseMinutes: 60 },
    { trigger: "Serious road incident", tier: "Tier 3", owner: "Fleet manager + Trust & Safety", responseMinutes: 30 },
    { trigger: "Inspection backlog critical", tier: "Tier 2", owner: "Fleet operations lead", responseMinutes: 1440 },
    { trigger: "Vehicle defect rated severe", tier: "Tier 2", owner: "Maintenance lead", responseMinutes: 240 },
  ],
};
