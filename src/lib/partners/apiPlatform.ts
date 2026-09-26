/**
 * SAFARID API PARTNERS — canonical platform contract.
 *
 * Single source of truth for everything the public API Partners experience
 * claims: capability domains, the API surface, webhook catalogue, integration
 * lifecycle, security controls, service levels and commercial tiers.
 *
 * Rules this module enforces by construction (see the accompanying test):
 *   • every endpoint belongs to a declared capability domain
 *   • every endpoint has at least one runnable sample and a stated scope
 *   • no endpoint claims self-serve credentials — access is desk-issued
 *     (consistent with the taxonomy entry for the `api` segment)
 */

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface ApiCapabilityDomain {
  key: string;
  name: string;
  summary: string;
  outcomes: string[];
}

export interface ApiSample {
  lang: "cURL" | "TypeScript" | "Python";
  code: string;
}

export interface ApiEndpoint {
  domain: string;
  method: HttpMethod;
  path: string;
  name: string;
  purpose: string;
  scope: string;
  idempotent: boolean;
  samples: ApiSample[];
}

export interface WebhookEvent {
  event: string;
  description: string;
  payloadKeys: string[];
}

export interface LifecycleStage {
  step: number;
  name: string;
  duration: string;
  detail: string;
  exitCriteria: string;
}

export interface SecurityControl {
  name: string;
  detail: string;
}

export interface ServiceLevel {
  metric: string;
  sandbox: string;
  production: string;
}

export interface CommercialTier {
  key: string;
  name: string;
  positioning: string;
  rateLimit: string;
  support: string;
  commercials: string;
  inclusions: string[];
}

export const API_BASE_URL = "https://api.yalla.africa/v1";
export const API_SANDBOX_URL = "https://sandbox.api.yalla.africa/v1";

export const CAPABILITY_DOMAINS: ApiCapabilityDomain[] = [
  {
    key: "quoting",
    name: "Quoting & Availability",
    summary:
      "Server-priced quotes for rides, charter, delivery and rental. Prices are computed by the governed pricing engine — never assembled client-side.",
    outcomes: [
      "Deterministic, reproducible quotes with a versioned rate card reference",
      "Availability and capacity checks before you show a price",
      "Immutable quote snapshots you can cite in your own audit trail",
    ],
  },
  {
    key: "orders",
    name: "Booking & Orders",
    summary:
      "Create and manage mobility orders from inside your own product journey, with idempotent writes and explicit lifecycle states.",
    outcomes: [
      "Idempotent order creation keyed on your own reference",
      "Cancellation, amendment and rebooking with policy enforcement",
      "One canonical order state machine across every service line",
    ],
  },
  {
    key: "tracking",
    name: "Tracking & Telemetry",
    summary:
      "Live assignment, position and ETA for in-flight orders, plus signed public tracking links you can hand to end customers.",
    outcomes: [
      "Assignment and ETA events pushed by webhook, not polled",
      "Shareable tracking tokens scoped to a single order",
      "Proof-of-delivery and completion evidence on close-out",
    ],
  },
  {
    key: "documents",
    name: "Documents & Evidence",
    summary:
      "Receipts, invoices, trip evidence and compliance documents issued with cryptographic seals and independently verifiable.",
    outcomes: [
      "Sealed PDF receipts and eTIMS-compliant tax invoices",
      "Hash-verifiable document identity for dispute defence",
      "Evidence bundles retrievable for the retention period you contract",
    ],
  },
  {
    key: "settlement",
    name: "Settlement & Reconciliation",
    summary:
      "Ledger-grade financial data: transaction records, statements, fees and payout positions that reconcile to the cent.",
    outcomes: [
      "Append-only transaction ledger exposed read-only",
      "Period statements with opening, movement and closing balances",
      "Reconciliation exceptions surfaced instead of silently netted",
    ],
  },
  {
    key: "identity",
    name: "Identity & Governance",
    summary:
      "Scoped credentials, actor attribution and policy checks so every API action is traceable to a named integration and purpose.",
    outcomes: [
      "OAuth 2.0 client-credentials with least-privilege scopes",
      "Per-request actor attribution retained in the audit trail",
      "Policy and spend controls enforced server-side for corporate programmes",
    ],
  },
];

export const API_ENDPOINTS: ApiEndpoint[] = [
  {
    domain: "quoting",
    method: "POST",
    path: "/quotes",
    name: "Create a quote",
    purpose: "Price a journey against the governed rate card and return a citable snapshot reference.",
    scope: "quotes:write",
    idempotent: true,
    samples: [
      {
        lang: "cURL",
        code: `curl -X POST ${API_BASE_URL}/quotes \\
  -H "Authorization: Bearer $YALLA_ACCESS_TOKEN" \\
  -H "Idempotency-Key: qt_2026_08_24_0001" \\
  -H "Content-Type: application/json" \\
  -d '{
    "service": "ride",
    "vehicle_class": "comfort",
    "pickup":  { "lat": -1.2921, "lng": 36.8219 },
    "dropoff": { "lat": -1.3192, "lng": 36.8910 },
    "scheduled_for": "2026-08-25T07:30:00Z"
  }'`,
      },
      {
        lang: "TypeScript",
        code: `const quote = await yalla.quotes.create({
  service: "ride",
  vehicleClass: "comfort",
  pickup:  { lat: -1.2921, lng: 36.8219 },
  dropoff: { lat: -1.3192, lng: 36.8910 },
  scheduledFor: "2026-08-25T07:30:00Z",
}, { idempotencyKey: "qt_2026_08_24_0001" });

console.log(quote.total, quote.currency, quote.snapshotRef);`,
      },
      {
        lang: "Python",
        code: `quote = yalla.quotes.create(
    service="ride",
    vehicle_class="comfort",
    pickup={"lat": -1.2921, "lng": 36.8219},
    dropoff={"lat": -1.3192, "lng": 36.8910},
    idempotency_key="qt_2026_08_24_0001",
)
print(quote.total, quote.currency, quote.snapshot_ref)`,
      },
    ],
  },
  {
    domain: "orders",
    method: "POST",
    path: "/orders",
    name: "Create an order",
    purpose: "Convert an accepted quote into a confirmed mobility order under your partner account.",
    scope: "orders:write",
    idempotent: true,
    samples: [
      {
        lang: "cURL",
        code: `curl -X POST ${API_BASE_URL}/orders \\
  -H "Authorization: Bearer $YALLA_ACCESS_TOKEN" \\
  -H "Idempotency-Key: ord_your_ref_88213" \\
  -H "Content-Type: application/json" \\
  -d '{
    "quote_ref": "qsnap_01J8ZK...",
    "partner_reference": "BOOKING-88213",
    "passenger": { "name": "A. Mwangi", "phone": "+254700000000" },
    "cost_centre": "CC-TRAVEL-KE"
  }'`,
      },
      {
        lang: "TypeScript",
        code: `const order = await yalla.orders.create({
  quoteRef: quote.snapshotRef,
  partnerReference: "BOOKING-88213",
  passenger: { name: "A. Mwangi", phone: "+254700000000" },
  costCentre: "CC-TRAVEL-KE",
}, { idempotencyKey: "ord_your_ref_88213" });`,
      },
      {
        lang: "Python",
        code: `order = yalla.orders.create(
    quote_ref=quote.snapshot_ref,
    partner_reference="BOOKING-88213",
    passenger={"name": "A. Mwangi", "phone": "+254700000000"},
    idempotency_key="ord_your_ref_88213",
)`,
      },
    ],
  },
  {
    domain: "orders",
    method: "POST",
    path: "/orders/{id}/cancel",
    name: "Cancel an order",
    purpose: "Cancel with policy evaluation — the response states any fee actually applied.",
    scope: "orders:write",
    idempotent: true,
    samples: [
      {
        lang: "cURL",
        code: `curl -X POST ${API_BASE_URL}/orders/ord_01J8ZK.../cancel \\
  -H "Authorization: Bearer $YALLA_ACCESS_TOKEN" \\
  -H "Idempotency-Key: cxl_88213" \\
  -d '{ "reason": "customer_request" }'`,
      },
      {
        lang: "TypeScript",
        code: `const result = await yalla.orders.cancel(order.id, { reason: "customer_request" });
console.log(result.status, result.cancellationFee);`,
      },
    ],
  },
  {
    domain: "tracking",
    method: "GET",
    path: "/orders/{id}/tracking",
    name: "Read live tracking",
    purpose: "Current assignment, position and ETA, plus a scoped share token for end-customer tracking.",
    scope: "tracking:read",
    idempotent: true,
    samples: [
      {
        lang: "cURL",
        code: `curl ${API_BASE_URL}/orders/ord_01J8ZK.../tracking \\
  -H "Authorization: Bearer $YALLA_ACCESS_TOKEN"`,
      },
      {
        lang: "TypeScript",
        code: `const tracking = await yalla.orders.tracking(order.id);
// tracking.shareUrl is safe to hand to the end customer
render(<TrackingMap eta={tracking.etaSeconds} url={tracking.shareUrl} />);`,
      },
    ],
  },
  {
    domain: "documents",
    method: "GET",
    path: "/orders/{id}/documents",
    name: "List order documents",
    purpose: "Sealed receipts, tax invoices and delivery evidence with verifiable content hashes.",
    scope: "documents:read",
    idempotent: true,
    samples: [
      {
        lang: "cURL",
        code: `curl ${API_BASE_URL}/orders/ord_01J8ZK.../documents \\
  -H "Authorization: Bearer $YALLA_ACCESS_TOKEN"`,
      },
      {
        lang: "TypeScript",
        code: `const docs = await yalla.orders.documents(order.id);
const invoice = docs.find((d) => d.kind === "tax_invoice");
// invoice.contentHash can be verified at /verify/document
`,
      },
    ],
  },
  {
    domain: "settlement",
    method: "GET",
    path: "/settlement/statements",
    name: "List settlement statements",
    purpose: "Period statements with opening balance, movements, fees and closing position.",
    scope: "settlement:read",
    idempotent: true,
    samples: [
      {
        lang: "cURL",
        code: `curl "${API_BASE_URL}/settlement/statements?period=2026-08" \\
  -H "Authorization: Bearer $YALLA_ACCESS_TOKEN"`,
      },
      {
        lang: "Python",
        code: `statement = yalla.settlement.statement(period="2026-08")
assert statement.closing_balance == statement.opening_balance + statement.net_movement`,
      },
    ],
  },
  {
    domain: "identity",
    method: "POST",
    path: "/oauth/token",
    name: "Exchange client credentials",
    purpose: "Mint a short-lived access token from desk-issued client credentials and requested scopes.",
    scope: "—",
    idempotent: false,
    samples: [
      {
        lang: "cURL",
        code: `curl -X POST ${API_BASE_URL}/oauth/token \\
  -u "$YALLA_CLIENT_ID:$YALLA_CLIENT_SECRET" \\
  -d "grant_type=client_credentials" \\
  -d "scope=quotes:write orders:write tracking:read"`,
      },
      {
        lang: "TypeScript",
        code: `const yalla = createYallaClient({
  baseUrl: process.env.YALLA_BASE_URL,       // sandbox or production
  clientId: process.env.YALLA_CLIENT_ID!,
  clientSecret: process.env.YALLA_CLIENT_SECRET!,
  scopes: ["quotes:write", "orders:write", "tracking:read"],
});`,
      },
    ],
  },
];

export const WEBHOOK_EVENTS: WebhookEvent[] = [
  { event: "order.confirmed", description: "Order accepted and entered the fulfilment pipeline.", payloadKeys: ["order_id", "partner_reference", "service", "total"] },
  { event: "order.assigned", description: "A driver, vehicle or operator has been assigned.", payloadKeys: ["order_id", "assignment", "eta_seconds"] },
  { event: "order.started", description: "Journey or delivery has begun.", payloadKeys: ["order_id", "started_at"] },
  { event: "order.completed", description: "Fulfilment closed; documents are being sealed.", payloadKeys: ["order_id", "completed_at", "final_total"] },
  { event: "order.cancelled", description: "Order cancelled, with the policy outcome and any fee.", payloadKeys: ["order_id", "reason", "cancellation_fee"] },
  { event: "payment.settled", description: "Funds settled against the order or wallet.", payloadKeys: ["order_id", "amount", "method", "reference"] },
  { event: "document.issued", description: "A sealed receipt, invoice or evidence document is available.", payloadKeys: ["order_id", "document_id", "kind", "content_hash"] },
  { event: "reconciliation.exception", description: "A financial exception was raised and needs partner attention.", payloadKeys: ["exception_id", "severity", "order_id"] },
];

export const LIFECYCLE_STAGES: LifecycleStage[] = [
  {
    step: 1,
    name: "Technical discovery",
    duration: "3–5 business days",
    detail:
      "Architecture session with the integration desk: your product journey, the service lines you need, data residency, volumes and settlement model.",
    exitCriteria: "Signed integration scope naming the endpoints, webhooks and environments you will use.",
  },
  {
    step: 2,
    name: "Scoped credentials",
    duration: "1–2 business days",
    detail:
      "Sandbox client credentials issued with least-privilege scopes, webhook signing secret and a dedicated integration channel.",
    exitCriteria: "Successful client-credentials exchange and a verified webhook signature in sandbox.",
  },
  {
    step: 3,
    name: "Build in sandbox",
    duration: "You set the pace",
    detail:
      "Full-fidelity sandbox with deterministic scenario seeds: happy path, driver reassignment, cancellation with fee, payment failure and reconciliation exception.",
    exitCriteria: "Every contracted scenario implemented against the sandbox, including failure handling.",
  },
  {
    step: 4,
    name: "Certification",
    duration: "2–4 business days",
    detail:
      "The desk replays the agreed scenario matrix against your integration and reviews idempotency, retry behaviour, webhook acknowledgement and evidence handling.",
    exitCriteria: "Certification record passed, with any findings closed and re-tested.",
  },
  {
    step: 5,
    name: "Controlled go-live",
    duration: "Same week",
    detail:
      "Production credentials issued, traffic ramped under agreed limits, with joint monitoring of error rates, latency and settlement accuracy.",
    exitCriteria: "Ramp completed at full rate limit with SLOs met and a named support route in place.",
  },
];

export const SECURITY_CONTROLS: SecurityControl[] = [
  { name: "OAuth 2.0 client credentials", detail: "Short-lived bearer tokens minted from desk-issued client credentials. No long-lived static API keys." },
  { name: "Least-privilege scopes", detail: "Each credential carries only the scopes named in your integration scope document; scope changes are a governed request." },
  { name: "Signed webhooks", detail: "Every delivery carries an HMAC-SHA-256 signature and timestamp; reject unsigned or stale payloads and reply 2xx to acknowledge." },
  { name: "Idempotent writes", detail: "All write endpoints accept an Idempotency-Key so retries and network partitions cannot create duplicate orders." },
  { name: "Transport security", detail: "TLS 1.2+ only, HSTS enforced, and optional mutual TLS or IP allow-listing for enterprise tiers." },
  { name: "Audit attribution", detail: "Every request is attributed to a named integration and actor, retained in an append-only audit trail." },
  { name: "Data minimisation", detail: "Only the passenger and payment fields required for fulfilment are accepted; card data never touches partner integrations." },
  { name: "Verifiable documents", detail: "Receipts and invoices are sealed with content hashes that you or your customer can verify independently." },
];

export const SERVICE_LEVELS: ServiceLevel[] = [
  { metric: "Availability target", sandbox: "Best effort", production: "99.9% monthly" },
  { metric: "Quote latency (p95)", sandbox: "< 800 ms", production: "< 400 ms" },
  { metric: "Order write latency (p95)", sandbox: "< 1.2 s", production: "< 700 ms" },
  { metric: "Webhook delivery", sandbox: "Immediate, 3 retries", production: "Exponential backoff up to 24h" },
  { metric: "Rate limit", sandbox: "1,000 req/min", production: "10,000 req/min (tier-dependent)" },
  { metric: "Incident acknowledgement", sandbox: "Next business day", production: "15 min for Sev-1" },
];

export const COMMERCIAL_TIERS: CommercialTier[] = [
  {
    key: "integrate",
    name: "Integrate",
    positioning: "Single-market platforms adding SAFARID mobility to an existing product journey.",
    rateLimit: "2,000 req/min",
    support: "Business-hours desk, shared integration channel",
    commercials: "Fee per completed transaction, agreed before certification.",
    inclusions: ["Quoting, orders and tracking", "Signed webhooks", "Sealed receipts", "Sandbox scenario seeds"],
  },
  {
    key: "scale",
    name: "Scale",
    positioning: "Aggregators and multi-brand platforms running material daily volume.",
    rateLimit: "10,000 req/min",
    support: "Named integration engineer, Sev-1 15-minute acknowledgement",
    commercials: "Contracted margin with volume tiers and monthly statements.",
    inclusions: ["Everything in Integrate", "Settlement & reconciliation API", "Multi-brand account structure", "Quarterly architecture review"],
  },
  {
    key: "infrastructure",
    name: "Infrastructure",
    positioning: "Enterprise, institutional and government programmes embedding SAFARID as core mobility infrastructure.",
    rateLimit: "Negotiated, dedicated capacity",
    support: "Joint operating model with executive escalation",
    commercials: "Master services agreement with committed volumes and custom settlement.",
    inclusions: ["Everything in Scale", "Mutual TLS & IP allow-listing", "Data residency and retention terms", "Custom SLOs and joint change control"],
  },
];

export const API_FAQ: { q: string; a: string }[] = [
  {
    q: "Can I generate API keys myself?",
    a: "No. Credentials are issued by the integration desk after technical discovery, and scoped to the endpoints in your integration scope document. This is deliberate: every credential is traceable to a named integration and purpose.",
  },
  {
    q: "Is there a sandbox before commercials are signed?",
    a: "Yes. Sandbox credentials are issued at stage two, before certification and before production commercials are finalised, so your engineers can validate feasibility early.",
  },
  {
    q: "How do you prevent duplicate bookings on retry?",
    a: "Every write endpoint accepts an Idempotency-Key. Replaying the same key returns the original result rather than creating a second order, so timeouts and retries are safe.",
  },
  {
    q: "How are prices calculated?",
    a: "Entirely server-side by the governed pricing engine against a versioned rate card. Your integration never assembles a total, and every quote returns an immutable snapshot reference you can cite in a dispute.",
  },
  {
    q: "What happens when a webhook delivery fails?",
    a: "Deliveries are retried with exponential backoff for up to 24 hours in production, and every attempt is recorded. You can also reconcile state by polling the order resource.",
  },
  {
    q: "Which markets and service lines are available?",
    a: "Kenya is live across rides, corporate travel, charter, delivery and rental. Additional markets are opened through the expansion programme and named in your integration scope.",
  },
];

/** Endpoints grouped by capability domain, in domain declaration order. */
export function endpointsByDomain(): { domain: ApiCapabilityDomain; endpoints: ApiEndpoint[] }[] {
  return CAPABILITY_DOMAINS.map((domain) => ({
    domain,
    endpoints: API_ENDPOINTS.filter((e) => e.domain === domain.key),
  })).filter((g) => g.endpoints.length > 0);
}
