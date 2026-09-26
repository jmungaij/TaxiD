/**
 * PHASE 4 — canonical integration event catalogue (frontend mirror).
 *
 * The database table `logistics_event_catalogue` is authoritative; this module
 * mirrors it so the console can render, group and validate without a round-trip,
 * and so a drift between the two is caught by a unit test rather than by a
 * partner receiving an event Yalla never declared.
 *
 * Versioning law: an existing event's schema is never changed in place. A
 * breaking change ships as a new `event_version` while the old one keeps being
 * delivered to subscribers who have not migrated.
 */

export type IntegrationAggregate =
  | "order"
  | "shipment"
  | "package"
  | "route"
  | "delivery_attempt"
  | "pod"
  | "exception"
  | "return"
  | "payment"
  | "settlement";

export interface IntegrationEventDefinition {
  eventType: string;
  aggregate: IntegrationAggregate;
  version: string;
  description: string;
  /** Position in the lifecycle; used to validate ordering. */
  lifecycleRank: number;
}

const E = (
  eventType: string,
  aggregate: IntegrationAggregate,
  lifecycleRank: number,
  description: string,
): IntegrationEventDefinition => ({ eventType, aggregate, version: "v1", lifecycleRank, description });

export const INTEGRATION_EVENTS: IntegrationEventDefinition[] = [
  E("order.created", "order", 10, "A logistics order was accepted."),
  E("order.cancelled", "order", 90, "A logistics order was cancelled."),
  E("shipment.created", "shipment", 10, "A shipment was created for an order."),
  E("shipment.confirmed", "shipment", 20, "Shipment confirmed and ready for collection."),
  E("shipment.in_transit", "shipment", 40, "Shipment is moving."),
  E("shipment.partially_delivered", "shipment", 60, "Some packages delivered, others outstanding."),
  E("shipment.delivered", "shipment", 70, "All packages in the shipment were delivered."),
  E("shipment.failed", "shipment", 80, "Shipment failed."),
  E("shipment.returned", "shipment", 85, "Shipment returned to origin."),
  E("package.created", "package", 10, "A package was registered."),
  E("package.picked_up", "package", 20, "Package collected from sender."),
  E("package.scanned", "package", 30, "Package scanned at a hub or handover."),
  E("package.in_transit", "package", 40, "Package in transit."),
  E("package.out_for_delivery", "package", 50, "Package out for final-mile delivery."),
  E("package.delivery_failed", "package", 60, "Delivery attempt failed."),
  E("package.delivered", "package", 70, "Package delivered."),
  E("package.return_initiated", "package", 80, "A return was started for the package."),
  E("package.returned", "package", 90, "Package returned."),
  E("route.created", "route", 10, "A planned route was created."),
  E("route.dispatched", "route", 20, "Route dispatched to a driver."),
  E("route.started", "route", 30, "Driver started the route."),
  E("route.deviated", "route", 40, "Route deviation recorded."),
  E("route.completed", "route", 50, "Route completed."),
  E("delivery.attempted", "delivery_attempt", 10, "A delivery attempt was recorded."),
  E("delivery.failed", "delivery_attempt", 20, "A delivery attempt failed."),
  E("delivery.completed", "delivery_attempt", 30, "A delivery attempt succeeded."),
  E("pod.created", "pod", 10, "Proof of delivery captured."),
  E("pod.verified", "pod", 20, "Proof of delivery verified."),
  E("exception.opened", "exception", 10, "An operational exception was opened."),
  E("exception.updated", "exception", 20, "An exception was updated."),
  E("exception.resolved", "exception", 30, "An exception was resolved."),
  E("return.authorized", "return", 10, "A return was authorized."),
  E("return.dispatched", "return", 20, "A return movement started."),
  E("return.received", "return", 30, "A return was received at a hub."),
  E("return.inspected", "return", 40, "A return was inspected."),
  E("return.dispositioned", "return", 50, "A return disposition was set."),
  E("return.resolved", "return", 60, "A return was resolved."),
  E("payment.completed", "payment", 10, "Payment for a logistics order completed."),
  E("settlement.completed", "settlement", 10, "Settlement for a logistics order completed."),
];

export const INTEGRATION_EVENT_TYPES = INTEGRATION_EVENTS.map((e) => e.eventType);

export function eventsByAggregate(): { aggregate: IntegrationAggregate; events: IntegrationEventDefinition[] }[] {
  const groups = new Map<IntegrationAggregate, IntegrationEventDefinition[]>();
  for (const e of INTEGRATION_EVENTS) {
    const list = groups.get(e.aggregate) ?? [];
    list.push(e);
    groups.set(e.aggregate, list);
  }
  return [...groups.entries()]
    .map(([aggregate, events]) => ({ aggregate, events: [...events].sort((a, b) => a.lifecycleRank - b.lifecycleRank) }))
    .sort((a, b) => a.aggregate.localeCompare(b.aggregate));
}

export function findEvent(eventType: string): IntegrationEventDefinition | undefined {
  return INTEGRATION_EVENTS.find((e) => e.eventType === eventType);
}

/**
 * Ordering contract. A delayed event must never overwrite a newer state, so a
 * consumer (and our own dispatcher) treats a lower sequence arriving after a
 * higher one as stale, not as a state change.
 */
export type OrderingVerdict = "apply" | "stale" | "out_of_lifecycle_order" | "unknown_event";

export function evaluateOrdering(input: {
  eventType: string;
  sequence: number;
  lastAppliedSequence: number | null;
  lastAppliedEventType?: string | null;
}): OrderingVerdict {
  const def = findEvent(input.eventType);
  if (!def) return "unknown_event";
  if (input.lastAppliedSequence !== null && input.sequence <= input.lastAppliedSequence) return "stale";
  const previous = input.lastAppliedEventType ? findEvent(input.lastAppliedEventType) : undefined;
  if (previous && previous.aggregate === def.aggregate && def.lifecycleRank < previous.lifecycleRank) {
    return "out_of_lifecycle_order";
  }
  return "apply";
}

// ------------------------------------------------------------------ scopes
export const LOGISTICS_API_SCOPES = [
  { scope: "logistics.orders.read", summary: "Read orders you created or that belong to a tenant you are entitled to." },
  { scope: "logistics.orders.write", summary: "Create orders. Pricing is always Yalla's; orders are created unpaid." },
  { scope: "logistics.shipments.read", summary: "Read shipments and their package states." },
  { scope: "logistics.shipments.write", summary: "Create shipments." },
  { scope: "logistics.packages.read", summary: "Read packages, milestones and delivery attempts." },
  { scope: "logistics.tracking.read", summary: "Track by tracking number or your own reference." },
  { scope: "logistics.routes.read", summary: "Read routes, restricted to stops carrying your packages." },
  { scope: "logistics.pod.read", summary: "Read proof-of-delivery metadata and integrity hashes." },
  { scope: "logistics.exceptions.read", summary: "Read operational exceptions raised on your shipments." },
  { scope: "logistics.returns.read", summary: "Read returns and their lifecycle state." },
  { scope: "logistics.returns.write", summary: "Request return authorisations." },
  { scope: "logistics.webhooks.manage", summary: "List and configure your webhook endpoints." },
] as const;

export type LogisticsApiScope = (typeof LOGISTICS_API_SCOPES)[number]["scope"];

export function hasScope(granted: string[] | null | undefined, required: string): boolean {
  if (!granted?.length) return false;
  if (granted.includes(required)) return true;
  const family = required.split(".").slice(0, -1).join(".");
  return granted.includes(`${family}.*`) || granted.includes("logistics.*");
}

// ------------------------------------------------------- integration health
export type IntegrationHealth = "CONFIGURED" | "ACTIVE" | "DEGRADED" | "FAILING" | "SUSPENDED" | "REVOKED";

export interface EndpointTelemetry {
  status: IntegrationHealth;
  consecutiveFailures: number;
  deliveredCount: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
}

/**
 * Health is DERIVED from delivery telemetry. An endpoint is never ACTIVE merely
 * because a row exists: until it has actually delivered, it stays CONFIGURED.
 */
export function deriveIntegrationHealth(t: EndpointTelemetry): IntegrationHealth {
  if (t.status === "SUSPENDED" || t.status === "REVOKED") return t.status;
  if (t.consecutiveFailures >= 10) return "FAILING";
  if (t.consecutiveFailures >= 3) return "DEGRADED";
  if (t.deliveredCount > 0 && t.lastSuccessAt) return "ACTIVE";
  return "CONFIGURED";
}

export const HEALTH_TONE: Record<IntegrationHealth, "success" | "info" | "warning" | "danger" | "muted"> = {
  ACTIVE: "success",
  CONFIGURED: "info",
  DEGRADED: "warning",
  FAILING: "danger",
  SUSPENDED: "danger",
  REVOKED: "muted",
};

// -------------------------------------------------- destination safety (SSRF)
/** Mirror of `public.logistics_webhook_url_valid` for immediate form feedback. */
export function validateWebhookUrl(raw: string): { valid: boolean; reason?: string } {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { valid: false, reason: "Enter a full https URL." };
  }
  if (u.protocol !== "https:") return { valid: false, reason: "Only https destinations are accepted." };
  if (u.username || u.password) return { valid: false, reason: "Credentials in the URL are not accepted." };
  const host = u.hostname.toLowerCase();
  if (["localhost", "169.254.169.254", "metadata.google.internal", "0.0.0.0"].includes(host)) {
    return { valid: false, reason: "Internal destinations are refused." };
  }
  if (/\.(local|internal|localdomain)$/.test(host)) return { valid: false, reason: "Internal domains are refused." };
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split(".").map(Number);
    const isPrivate =
      a === 127 || a === 10 || a === 0 ||
      (a === 169 && b === 254) ||
      (a === 192 && b === 168) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 100 && b >= 64 && b <= 127);
    if (isPrivate) return { valid: false, reason: "Private network addresses are refused." };
  }
  return { valid: true };
}

// ------------------------------------------------------------ retry contract
/** Exponential backoff, matching `logistics_webhook_record_attempt`. */
export function backoffDelaySeconds(attempt: number, baseMs = 2000): number {
  return Math.min(3600, (baseMs / 1000) * Math.pow(2, Math.max(0, attempt - 1)));
}

export function isTerminalDeliveryStatus(status: string): boolean {
  return status === "delivered" || status === "dead_letter";
}
