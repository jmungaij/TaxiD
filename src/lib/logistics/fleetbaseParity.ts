/**
 * Fleetbase feature-parity register.
 *
 * Fleetbase is used strictly as a *capability benchmark*. Each row records what
 * Yalla actually executes today, with the authoritative module that proves it.
 *
 * The status vocabulary is deliberately narrow, and a row may only be `parity`
 * when the capability can be created, authorised, executed, persisted, tracked,
 * recovered, reconciled and audited — a rendered page is never evidence.
 */

export type ParityStatus =
  | "parity" // executes end-to-end on server-authoritative state
  | "partial" // executes, but a named part of the chain is missing
  | "gap"; // not executable yet

export interface ParityRow {
  capability: string;
  benchmark: string;
  status: ParityStatus;
  /** Authoritative implementation (file / table / RPC) — the proof. */
  authority: string[];
  /** What remains before this row can become `parity`. Empty when parity. */
  remaining: string[];
}

export const FLEETBASE_PARITY_REGISTER: ParityRow[] = [
  {
    capability: "Order lifecycle",
    benchmark: "Create → schedule → dispatch → start → complete",
    status: "partial",
    authority: ["delivery_orders", "logistics_order_activities", "logistics_order_set_activity"],
    remaining: ["Order edit/duplicate primitives", "pause/resume semantics per service type"],
  },
  {
    capability: "Activity engine",
    benchmark: "Configurable, server-authoritative activity updates",
    status: "parity",
    authority: [
      "logistics_order_activities",
      "logistics_order_activity_transitions",
      "logistics_order_set_activity",
      "src/lib/logistics/orders/activityModel.ts",
    ],
    remaining: [],
  },
  {
    capability: "Bulk operations",
    benchmark: "Bulk assign / dispatch / activity update with per-item results",
    status: "parity",
    authority: [
      "logistics_batch_operations",
      "logistics_batch_begin",
      "logistics_batch_complete",
      "src/lib/logistics/orders/batchController.ts",
    ],
    remaining: [],
  },
  {
    capability: "Multi-ID search & scanning",
    benchmark: "Comma/space/newline IDs, barcode, QR, camera and HID scanners",
    status: "parity",
    authority: ["src/lib/logistics/orders/idFilter.ts", "src/components/logistics/orders/OrderIdFilter.tsx"],
    remaining: [],
  },
  {
    capability: "Scheduling",
    benchmark: "Schedule / reschedule with time windows",
    status: "partial",
    authority: ["src/lib/logistics/orders/schedule.ts", "delivery_orders.pickup_window_start"],
    remaining: ["Bulk reschedule RPC", "capacity-aware window validation"],
  },
  {
    capability: "Delivery attempt engine",
    benchmark: "Numbered attempts with reason, evidence and outcome",
    status: "parity",
    authority: [
      "logistics_delivery_attempts",
      "logistics_record_delivery_attempt",
      "src/lib/logistics/orders/attempts.ts",
    ],
    remaining: [],
  },
  {
    capability: "Exception control centre",
    benchmark: "Classified exceptions with severity, owner, SLA and resolution",
    status: "parity",
    authority: [
      "logistics_exceptions",
      "logistics_exception_events",
      "logistics_exception_transition",
      "src/pages/dashboard/admin/LogisticsExceptions.tsx",
    ],
    remaining: [],
  },
  {
    capability: "Package-level / partial delivery",
    benchmark: "Per-entity outcomes inside one shipment",
    status: "parity",
    authority: ["packages", "logistics_order_delivery_summary", "classifyFulfilment()"],
    remaining: [],
  },
  {
    capability: "Manifest management",
    benchmark: "Create, scan, close, assign, dispatch, receive, reconcile",
    status: "parity",
    authority: [
      "logistics_manifests",
      "logistics_manifest_lines",
      "logistics_manifest_scan",
      "logistics_manifest_transition",
      "logistics_manifest_reconciliation",
      "src/pages/dashboard/admin/LogisticsManifests.tsx",
    ],
    remaining: [],
  },
  {
    capability: "Hub / cross-dock custody",
    benchmark: "Inbound, scan, sort, outbound with continuous custody",
    status: "partial",
    authority: ["logistics_hubs", "package_chain_of_custody", "logistics_manifest_scan"],
    remaining: ["Sort/staging step inside a hub", "hub admin configuration screen"],
  },
  {
    capability: "Physical/system reconciliation",
    benchmark: "Expected vs actual per manifest line",
    status: "parity",
    authority: ["logistics_manifest_reconciliation", "reconciliationVerdict()"],
    remaining: [],
  },
  {
    capability: "Driver assignment eligibility",
    benchmark: "Only eligible drivers offered and accepted",
    status: "partial",
    authority: ["logistics_driver_eligible", "logistics_eligible_drivers"],
    remaining: ["Vehicle capacity + service-area factors", "workload balancing"],
  },
  {
    capability: "Proof of delivery",
    benchmark: "Signature, photo, QR/barcode, SMS verification",
    status: "parity",
    authority: [
      "logistics_pod_policies",
      "logistics_pod_records",
      "logistics_pod_evidence_files",
      "logistics_pod_capture",
      "src/lib/logistics/delivery/finalMileEngine.ts",
    ],
    remaining: [],
  },
  {
    capability: "Recipient OTP verification",
    benchmark: "Hashed, expiring, rate-limited passcode bound to one attempt",
    status: "partial",
    authority: ["logistics_delivery_otps", "logistics_otp_issue", "logistics_otp_verify"],
    remaining: ["SMS provider credentials (PROVIDER_CONFIGURATION_REQUIRED)"],
  },
  {
    capability: "Custody chain",
    benchmark: "Scan-level custody handovers",
    status: "parity",
    authority: ["package_chain_of_custody", "src/lib/logistics/domain/custody.ts"],
    remaining: [],
  },
  {
    capability: "Returns",
    benchmark: "Return decision → movement → hub receipt → resolution",
    status: "parity",
    authority: [
      "package_returns",
      "logistics_return_events",
      "logistics_return_receipts",
      "logistics_return_inspections",
      "logistics_return_dispositions",
      "src/pages/dashboard/admin/LogisticsDelivery.tsx",
    ],
    remaining: [],
  },

  {
    capability: "Dispatch board",
    benchmark: "Orders queue + drivers + vehicles with real transactions",
    status: "partial",
    authority: ["delivery_dispatch_jobs", "delivery_driver_candidates", "src/pages/dashboard/admin/DispatchOps.tsx"],
    remaining: ["Vehicle capacity lane", "recall action"],
  },
  {
    capability: "Multi-stop routing",
    benchmark: "Route with ordered stops, windows, ETA, optimisation",
    status: "partial",
    authority: [
      "logistics_routes",
      "logistics_route_versions",
      "logistics_route_stops",
      "logistics_stop_packages",
      "logistics_route_optimization_runs",
      "src/pages/dashboard/admin/LogisticsRoutes.tsx",
    ],
    remaining: [
      "External optimisation provider adapter execution (manual fallback live)",
      "Telemetry-driven automatic deviation detection",
    ],
  },
  {
    capability: "Live operations map",
    benchmark: "Driver markers, route overlays, ETA, realtime location",
    status: "partial",
    authority: ["driver_locations", "src/pages/dashboard/admin/DeliveryOperationsControlTower.tsx"],
    remaining: ["Stop/waypoint overlays", "click-through driver → order → next stop → ETA"],
  },
  {
    capability: "Realtime events",
    benchmark: "Push updates for assignment, location, status, POD",
    status: "partial",
    authority: ["src/lib/security/realtimeAllowlist.ts", "package_tracking", "delivery_dispatch_jobs"],
    remaining: ["Exception + attempt channels on the allowlist"],
  },
  {
    capability: "Tracking (customer)",
    benchmark: "Public tracking link with status, progress, ETA, POD",
    status: "partial",
    authority: ["logistics-track edge function", "src/pages/delivery/TrackParcel.tsx"],
    remaining: ["Attempt history exposure (redacted)", "POD access policy"],
  },
  {
    capability: "Financial integration",
    benchmark: "Quote → invoice → payment → settlement → reconciliation",
    status: "partial",
    authority: ["logistics_settle_order_payment", "logistics-payment-settle", "commercial_transactions"],
    remaining: ["Partial-delivery billing rule", "partner settlement leg"],
  },
  {
    capability: "REST API",
    benchmark: "Programmatic access to all core logistics resources",
    status: "partial",
    authority: ["logistics-quote", "logistics-book", "logistics-track", "partner API platform"],
    remaining: ["Attempts, exceptions, returns and routes endpoints"],
  },
  {
    capability: "Webhooks",
    benchmark: "Signed lifecycle webhooks with retries and replay",
    status: "partial",
    authority: ["charter_webhook_endpoints", "src/lib/logistics/domain/webhookSecurity.ts"],
    remaining: ["Logistics lifecycle event bindings", "dead-letter replay surface"],
  },
  {
    capability: "Partner operations",
    benchmark: "Capacity, job accept/reject, POD submission, settlements",
    status: "partial",
    authority: ["partner workspace", "capacity_commitments"],
    remaining: ["Partner-submitted POD path", "capacity → serviceability feedback"],
  },
  {
    capability: "Audit trail",
    benchmark: "Immutable audit for every critical operation",
    status: "parity",
    authority: ["audit_logs", "logistics_exception_events", "append-only triggers"],
    remaining: [],
  },
  {
    capability: "RBAC",
    benchmark: "Role/permission-scoped operational access",
    status: "parity",
    authority: ["has_staff_permission", "logistics_ops_actor_authorised", "RLS policies"],
    remaining: [],
  },
];

export interface ParitySummary {
  total: number;
  parity: number;
  partial: number;
  gap: number;
  /** Percent of benchmark rows at full parity — never rounded up. */
  parityPercent: number;
  openActions: number;
}

export function summariseParity(rows: ParityRow[] = FLEETBASE_PARITY_REGISTER): ParitySummary {
  const total = rows.length;
  const parity = rows.filter((r) => r.status === "parity").length;
  const partial = rows.filter((r) => r.status === "partial").length;
  const gap = rows.filter((r) => r.status === "gap").length;
  return {
    total,
    parity,
    partial,
    gap,
    parityPercent: total === 0 ? 0 : Math.floor((parity / total) * 100),
    openActions: rows.reduce((n, r) => n + r.remaining.length, 0),
  };
}

/** A `parity` row with outstanding actions is a register defect. */
export function parityRegisterDefects(rows: ParityRow[] = FLEETBASE_PARITY_REGISTER): string[] {
  const defects: string[] = [];
  for (const row of rows) {
    if (row.status === "parity" && row.remaining.length > 0) {
      defects.push(`${row.capability}: marked parity but has ${row.remaining.length} outstanding action(s)`);
    }
    if (row.status !== "gap" && row.authority.length === 0) {
      defects.push(`${row.capability}: claims implementation without an authoritative module`);
    }
    if (row.status !== "parity" && row.remaining.length === 0) {
      defects.push(`${row.capability}: not at parity but no remaining action declared`);
    }
  }
  return defects;
}
