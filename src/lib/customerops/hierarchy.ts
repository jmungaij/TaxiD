/**
 * Customer Operations — hierarchical case taxonomy (Improvement #1).
 *
 * Replaces the flat 11-type list with the full analytics chain:
 *
 *   Case Type → Category → Sub-category → Reason Code → Disposition → Root Cause
 *
 * Pure configuration. The flat `CaseType` remains the routing key (nothing
 * downstream breaks); the hierarchy adds the reporting dimensions that
 * enterprise analytics needs.
 */
import type { CaseType } from "./taxonomy";

export type Disposition =
  | "resolved"
  | "resolved_with_compensation"
  | "rejected"
  | "escalated_external"
  | "duplicate"
  | "no_fault_found";

export type RootCauseCode =
  | "scheduling_failure"
  | "process_gap"
  | "system_defect"
  | "partner_performance"
  | "driver_behaviour"
  | "customer_error"
  | "third_party"
  | "capacity_shortfall"
  | "policy_ambiguity"
  | "fraudulent_intent";

export const DISPOSITION_LABEL: Record<Disposition, string> = {
  resolved: "Resolved",
  resolved_with_compensation: "Resolved with compensation",
  rejected: "Rejected",
  escalated_external: "Escalated externally",
  duplicate: "Duplicate",
  no_fault_found: "No fault found",
};

export const ROOT_CAUSE_LABEL: Record<RootCauseCode, string> = {
  scheduling_failure: "Scheduling failure",
  process_gap: "Process gap",
  system_defect: "System defect",
  partner_performance: "Partner performance",
  driver_behaviour: "Driver behaviour",
  customer_error: "Customer error",
  third_party: "Third-party dependency",
  capacity_shortfall: "Capacity shortfall",
  policy_ambiguity: "Policy ambiguity",
  fraudulent_intent: "Fraudulent intent",
};

export interface ReasonCode {
  /** Stable analytics key — never renamed once shipped. */
  code: string;
  label: string;
  /** Dispositions this reason code is allowed to close with. */
  dispositions: Disposition[];
  /** Root causes this reason code can be attributed to. */
  rootCauses: RootCauseCode[];
}

export interface SubCategory {
  key: string;
  label: string;
  reasonCodes: ReasonCode[];
}

export interface CaseCategory {
  key: string;
  label: string;
  caseType: CaseType;
  subCategories: SubCategory[];
}

const rc = (
  code: string,
  label: string,
  dispositions: Disposition[],
  rootCauses: RootCauseCode[],
): ReasonCode => ({ code, label, dispositions, rootCauses });

export const CASE_HIERARCHY: CaseCategory[] = [
  {
    key: "delivery",
    label: "Delivery",
    caseType: "delivery_failure",
    subCategories: [
      {
        key: "late_delivery",
        label: "Late delivery",
        reasonCodes: [
          rc("warehouse_delay", "Warehouse delay", ["resolved", "resolved_with_compensation"], ["scheduling_failure", "capacity_shortfall", "process_gap"]),
          rc("courier_unavailable", "Courier unavailable", ["resolved", "resolved_with_compensation"], ["capacity_shortfall", "partner_performance"]),
          rc("route_disruption", "Route disruption", ["resolved", "no_fault_found"], ["third_party"]),
        ],
      },
      {
        key: "failed_attempt",
        label: "Failed delivery attempt",
        reasonCodes: [
          rc("wrong_address", "Wrong or incomplete address", ["resolved", "rejected"], ["customer_error", "process_gap"]),
          rc("recipient_absent", "Recipient unavailable", ["resolved", "no_fault_found"], ["customer_error"]),
          rc("pod_missing", "Proof of delivery missing", ["resolved", "resolved_with_compensation"], ["process_gap", "system_defect"]),
        ],
      },
      {
        key: "damaged",
        label: "Damaged goods",
        reasonCodes: [
          rc("handling_damage", "Handling damage", ["resolved_with_compensation"], ["partner_performance", "process_gap"]),
          rc("packaging_failure", "Packaging failure", ["resolved_with_compensation", "rejected"], ["process_gap", "customer_error"]),
        ],
      },
    ],
  },
  {
    key: "parcel_loss",
    label: "Parcel loss",
    caseType: "lost_parcel",
    subCategories: [
      {
        key: "custody_break",
        label: "Chain-of-custody break",
        reasonCodes: [
          rc("scan_missing", "Warehouse scan missing", ["resolved", "resolved_with_compensation"], ["process_gap", "system_defect"]),
          rc("handover_unverified", "Handover not OTP-verified", ["resolved_with_compensation"], ["process_gap", "driver_behaviour"]),
          rc("suspected_theft", "Suspected theft", ["escalated_external"], ["fraudulent_intent", "driver_behaviour"]),
        ],
      },
    ],
  },
  {
    key: "payments",
    label: "Payments",
    caseType: "payment_issue",
    subCategories: [
      {
        key: "collection_failure",
        label: "Collection failure",
        reasonCodes: [
          rc("stk_timeout", "STK push timeout", ["resolved"], ["system_defect", "third_party"]),
          rc("insufficient_funds", "Insufficient funds", ["rejected", "resolved"], ["customer_error"]),
          rc("callback_lost", "Callback lost / DLQ", ["resolved"], ["system_defect"]),
        ],
      },
      {
        key: "double_charge",
        label: "Duplicate charge",
        reasonCodes: [
          rc("retry_duplicate", "Retry produced duplicate", ["resolved_with_compensation"], ["system_defect", "process_gap"]),
        ],
      },
    ],
  },
  {
    key: "refunds",
    label: "Refunds & disputes",
    caseType: "refund_dispute",
    subCategories: [
      {
        key: "service_not_rendered",
        label: "Service not rendered",
        reasonCodes: [
          rc("trip_not_completed", "Trip never completed", ["resolved_with_compensation"], ["partner_performance", "system_defect"]),
          rc("order_not_delivered", "Order never delivered", ["resolved_with_compensation"], ["partner_performance", "process_gap"]),
        ],
      },
      {
        key: "pricing_dispute",
        label: "Pricing dispute",
        reasonCodes: [
          rc("fare_disagreement", "Fare disagreement", ["resolved", "rejected"], ["policy_ambiguity", "customer_error"]),
          rc("surge_dispute", "Surge pricing dispute", ["resolved", "rejected"], ["policy_ambiguity"]),
        ],
      },
      {
        key: "abuse",
        label: "Refund abuse",
        reasonCodes: [
          rc("serial_refunder", "Serial refund pattern", ["rejected", "escalated_external"], ["fraudulent_intent"]),
        ],
      },
    ],
  },
  {
    key: "driver",
    label: "Driver conduct",
    caseType: "driver_conduct",
    subCategories: [
      {
        key: "behaviour",
        label: "Behaviour",
        reasonCodes: [
          rc("rudeness", "Rudeness / unprofessional conduct", ["resolved"], ["driver_behaviour"]),
          rc("route_manipulation", "Route manipulation", ["resolved", "escalated_external"], ["driver_behaviour", "fraudulent_intent"]),
          rc("ride_refusal", "Ride refusal", ["resolved"], ["driver_behaviour", "policy_ambiguity"]),
        ],
      },
      {
        key: "compliance",
        label: "Compliance",
        reasonCodes: [
          rc("unlicensed_operation", "Operating outside compliance", ["escalated_external"], ["process_gap", "driver_behaviour"]),
        ],
      },
    ],
  },
  {
    key: "safety",
    label: "Safety",
    caseType: "safety_incident",
    subCategories: [
      {
        key: "physical",
        label: "Physical safety",
        reasonCodes: [
          rc("collision", "Collision / accident", ["escalated_external"], ["third_party", "driver_behaviour"]),
          rc("assault", "Assault or threat", ["escalated_external"], ["driver_behaviour", "third_party"]),
        ],
      },
      {
        key: "harassment",
        label: "Harassment",
        reasonCodes: [
          rc("verbal_harassment", "Verbal harassment", ["escalated_external", "resolved"], ["driver_behaviour"]),
        ],
      },
    ],
  },
  {
    key: "fraud",
    label: "Fraud",
    caseType: "fraud",
    subCategories: [
      {
        key: "account",
        label: "Account takeover",
        reasonCodes: [
          rc("credential_compromise", "Credential compromise", ["escalated_external"], ["fraudulent_intent", "system_defect"]),
        ],
      },
      {
        key: "payment_fraud",
        label: "Payment fraud",
        reasonCodes: [
          rc("stolen_instrument", "Stolen payment instrument", ["escalated_external"], ["fraudulent_intent"]),
          rc("collusion", "Rider/driver collusion", ["escalated_external"], ["fraudulent_intent"]),
        ],
      },
    ],
  },
  {
    key: "marketplace",
    label: "Marketplace",
    caseType: "delayed_ride",
    subCategories: [
      {
        key: "supply",
        label: "Supply availability",
        reasonCodes: [
          rc("no_driver_found", "No driver found", ["resolved", "resolved_with_compensation"], ["capacity_shortfall"]),
          rc("long_eta", "ETA far above promise", ["resolved"], ["capacity_shortfall", "scheduling_failure"]),
        ],
      },
    ],
  },
  {
    key: "corporate",
    label: "Corporate",
    caseType: "corporate_policy",
    subCategories: [
      {
        key: "policy",
        label: "Policy & approvals",
        reasonCodes: [
          rc("budget_block", "Budget limit blocked the trip", ["resolved", "rejected"], ["policy_ambiguity", "process_gap"]),
          rc("approval_delay", "Approval chain delay", ["resolved"], ["process_gap", "capacity_shortfall"]),
        ],
      },
      {
        key: "billing",
        label: "Invoicing",
        reasonCodes: [
          rc("invoice_mismatch", "Invoice mismatch", ["resolved", "resolved_with_compensation"], ["system_defect", "process_gap"]),
        ],
      },
    ],
  },
  {
    key: "fleet",
    label: "Fleet & rentals",
    caseType: "vehicle_issue",
    subCategories: [
      {
        key: "condition",
        label: "Vehicle condition",
        reasonCodes: [
          rc("mechanical_defect", "Mechanical defect", ["resolved", "resolved_with_compensation"], ["partner_performance", "process_gap"]),
          rc("cleanliness", "Cleanliness standard", ["resolved"], ["partner_performance"]),
        ],
      },
    ],
  },
  {
    key: "general",
    label: "General",
    caseType: "general_enquiry",
    subCategories: [
      {
        key: "information",
        label: "Information request",
        reasonCodes: [
          rc("how_to", "How-to question", ["resolved"], ["policy_ambiguity"]),
          rc("duplicate_contact", "Duplicate contact", ["duplicate"], ["process_gap"]),
        ],
      },
    ],
  },
];

export interface HierarchyPath {
  category: CaseCategory;
  subCategory: SubCategory;
  reasonCode: ReasonCode;
}

/** Every reason code, flattened — used for analytics pivots and pickers. */
export const REASON_CODE_INDEX: HierarchyPath[] = CASE_HIERARCHY.flatMap((category) =>
  category.subCategories.flatMap((subCategory) =>
    subCategory.reasonCodes.map((reasonCode) => ({ category, subCategory, reasonCode })),
  ),
);

export function categoriesForType(type: CaseType): CaseCategory[] {
  return CASE_HIERARCHY.filter((c) => c.caseType === type);
}

/** Default hierarchy path for a case type — the first reason code under it. */
export function defaultPathForType(type: CaseType): HierarchyPath | null {
  return REASON_CODE_INDEX.find((p) => p.category.caseType === type) ?? null;
}

export function findReasonCode(code: string): HierarchyPath | null {
  return REASON_CODE_INDEX.find((p) => p.reasonCode.code === code) ?? null;
}

/** Human-readable chain, e.g. "Delivery → Late delivery → Warehouse delay". */
export function formatPath(path: HierarchyPath): string {
  return `${path.category.label} → ${path.subCategory.label} → ${path.reasonCode.label}`;
}
