/**
 * TaxiD WHITE-LABEL PARTNERS — canonical platform contract.
 *
 * Every public claim on `/partners/white-label` is rendered from this module.
 * Each capability carries an explicit `status`, so the page can never present
 * a roadmap item, a contractual arrangement or a desk-operated process as a
 * live self-serve product surface.
 *
 * Status vocabulary (also used by the claim matrix):
 *   LIVE          — implemented in the platform today and exercised in production.
 *   CONFIGURED    — exists, but switched on per programme by the TaxiD desk.
 *   CONTRACTUAL   — governed by the signed agreement, not by software configuration.
 *   PARTIAL       — partially implemented; usable with named limitations.
 *   ROADMAP       — committed direction, not available today.
 *
 * If a capability cannot be evidenced against a real route, table, edge
 * function or contract clause, it does not belong in this file.
 */

export type CapabilityStatus = "LIVE" | "CONFIGURED" | "CONTRACTUAL" | "PARTIAL" | "ROADMAP";

export const STATUS_LABEL: Record<CapabilityStatus, string> = {
  LIVE: "Live",
  CONFIGURED: "Configured per programme",
  CONTRACTUAL: "Contractual",
  PARTIAL: "Partial",
  ROADMAP: "Roadmap",
};

export const STATUS_TONE: Record<CapabilityStatus, string> = {
  LIVE: "border-status-success/30 bg-status-success/10 text-status-success",
  CONFIGURED: "border-info/30 bg-info/10 text-info",
  CONTRACTUAL: "border-border bg-muted text-muted-foreground",
  PARTIAL: "border-status-warning/30 bg-status-warning/10 text-status-warning",
  ROADMAP: "border-border bg-muted/60 text-muted-foreground",
};

export type Owner = "PARTNER" | "TaxiD" | "SHARED";

export const OWNER_LABEL: Record<Owner, string> = {
  PARTNER: "Partner",
  TaxiD: "TaxiD",
  SHARED: "Shared",
};

/* ------------------------------------------------------------------ *
 * 1. What white-label means — brandable surfaces
 * ------------------------------------------------------------------ */

export interface BrandSurface {
  surface: string;
  detail: string;
  status: CapabilityStatus;
  owner: Owner;
}

export const BRAND_SURFACES: BrandSurface[] = [
  { surface: "Brand identity", detail: "Logo, colour tokens, typography and tone applied to the partner-facing surfaces in scope.", status: "CONFIGURED", owner: "SHARED" },
  { surface: "Booking experience", detail: "Branded quote-and-book journey for the services admitted to the programme.", status: "CONFIGURED", owner: "SHARED" },
  { surface: "Customer portal", detail: "Order history, tracking and documents under the partner brand.", status: "PARTIAL", owner: "SHARED" },
  { surface: "Partner Workspace", detail: "Operational workspace at /partner/workspace for the partner's own staff.", status: "LIVE", owner: "TaxiD" },
  { surface: "Transactional email", detail: "Partner sender name and template content; authenticated sending domain is agreed during provisioning.", status: "CONFIGURED", owner: "SHARED" },
  { surface: "Receipts and invoices", detail: "Partner brand on documents, with statutory identifiers and tax data fixed by the issuing entity.", status: "CONFIGURED", owner: "SHARED" },
  { surface: "Custom domain", detail: "Partner-owned hostname with DNS verification and managed TLS.", status: "ROADMAP", owner: "SHARED" },
  { surface: "Native mobile application", detail: "A store-published branded app is not part of the white-label programme today.", status: "ROADMAP", owner: "PARTNER" },
  { surface: "SMS sender identity", detail: "Alphanumeric sender IDs depend on the operator and market and are arranged per programme.", status: "ROADMAP", owner: "SHARED" },
];

/** Things branding configuration must never be able to override. */
export const BRAND_IMMUTABLES: string[] = [
  "Statutory identifiers on tax documents (issuing entity, tax identity, invoice numbering).",
  "Safety, emergency and incident-reporting information shown to a traveller.",
  "The lawful basis, privacy notice and data-controller identity presented at collection.",
  "Security surfaces: authentication screens, credential handling and consent prompts.",
  "Audit, event and settlement records — branded in presentation, never in substance.",
];

/* ------------------------------------------------------------------ *
 * 2. Multi-tenant model
 * ------------------------------------------------------------------ */

export interface TenantEntity {
  entity: string;
  scope: string;
  isolation: string;
}

export const TENANT_MODEL: TenantEntity[] = [
  { entity: "Partner", scope: "The contracting legal entity.", isolation: "Root of every scope below; created by the partner desk on admission." },
  { entity: "Tenant", scope: "One operating configuration of a partner (brand, services, markets, environment).", isolation: "Sandbox and production are separate tenants; credentials never cross them." },
  { entity: "Users and roles", scope: "The partner's own staff and their permissions.", isolation: "Row-level security scopes every read and write to the caller's partner membership." },
  { entity: "Customers", scope: "End customers of the partner brand.", isolation: "Visible only inside the owning tenant; never pooled across partners." },
  { entity: "Orders", scope: "Canonical mobility orders raised under the tenant.", isolation: "Tenant-scoped; cross-tenant reads are rejected server-side, not hidden in the UI." },
  { entity: "Credentials", scope: "API keys and webhook secrets.", isolation: "Issued per tenant and environment, revocable, with an append-only audit trail." },
  { entity: "Documents", scope: "Receipts, invoices and statements.", isolation: "Tenant-scoped, hash-sealed and verifiable independently of the UI." },
  { entity: "Settlement records", scope: "Charges, fees, statements and reconciliation.", isolation: "Tenant-scoped, append-only; corrections are adjustments, never edits." },
];

/* ------------------------------------------------------------------ *
 * 3. Responsibility matrix
 * ------------------------------------------------------------------ */

export interface Responsibility {
  area: string;
  owner: Owner;
  detail: string;
}

export const RESPONSIBILITY_MATRIX: Responsibility[] = [
  { area: "Brand and creative", owner: "PARTNER", detail: "Marks, tone and approved customer-facing presentation." },
  { area: "Customer relationship", owner: "PARTNER", detail: "Acquisition, first-line commercial contact and retention." },
  { area: "Distribution", owner: "PARTNER", detail: "Channels, campaigns and demand generation." },
  { area: "Mobility infrastructure", owner: "TaxiD", detail: "Quoting, ordering, tracking, documents and the operating platform." },
  { area: "Fulfilment and dispatch", owner: "TaxiD", detail: "Supply admission, assignment and completion of journeys in scope." },
  { area: "Settlement infrastructure", owner: "TaxiD", detail: "Charge capture, statement generation and reconciliation records." },
  { area: "Pricing", owner: "SHARED", detail: "TaxiD governs the rate structure; partner margin is contracted per programme." },
  { area: "Customer support", owner: "SHARED", detail: "Partner takes first line; TaxiD operates mobility escalation in scope." },
  { area: "Governance and performance", owner: "SHARED", detail: "Joint review cadence against the agreed measures." },
  { area: "Compliance", owner: "SHARED", detail: "Each party is accountable for its own regulated obligations under the agreement." },
];

/* ------------------------------------------------------------------ *
 * 4. Service catalogue and markets
 * ------------------------------------------------------------------ */

export interface WhiteLabelService {
  service: string;
  status: CapabilityStatus;
  note: string;
}

export const SERVICE_CATALOGUE: WhiteLabelService[] = [
  { service: "Ride-hailing", status: "CONFIGURED", note: "Admitted per market and vehicle class." },
  { service: "Airport transfers", status: "CONFIGURED", note: "Scheduled pickups with flight reference on the order." },
  { service: "Corporate mobility", status: "CONFIGURED", note: "Employee travel with cost-centre attribution." },
  { service: "Executive chauffeur", status: "CONFIGURED", note: "Assigned chauffeur supply, contracted per programme." },
  { service: "Charter (road, air, marine)", status: "CONFIGURED", note: "Quotation-led; priced from the governed charter rate card." },
  { service: "Shuttle and staff transport", status: "CONFIGURED", note: "Recurring routed movements agreed with operations." },
  { service: "Parcel and courier delivery", status: "PARTIAL", note: "Available in Nairobi operations; other markets by agreement." },
  { service: "Car rental and self-drive", status: "PARTIAL", note: "Inventory-dependent; availability confirmed at quoting." },
  { service: "Leasing", status: "CONTRACTUAL", note: "Handled as a contracted arrangement, not as a booking flow." },
  { service: "School transport", status: "ROADMAP", note: "Not admitted to the white-label programme today." },
];

export interface MarketAvailability {
  market: string;
  services: string;
  status: CapabilityStatus;
  restrictions: string;
}

export const MARKETS: MarketAvailability[] = [
  { market: "Kenya — Nairobi", services: "Full catalogue in scope", status: "LIVE", restrictions: "Payments settle in KES via M-Pesa and card rails." },
  { market: "Kenya — Mombasa, Nakuru, Kisumu", services: "Ride, transfer, charter, shuttle", status: "CONFIGURED", restrictions: "Supply density confirmed before launch." },
  { market: "Kenya — other counties", services: "Charter and contracted movements", status: "PARTIAL", restrictions: "By agreement, with lead time on supply." },
  { market: "Outside Kenya", services: "—", status: "ROADMAP", restrictions: "No white-label availability today; expansion is assessed per market." },
];

/* ------------------------------------------------------------------ *
 * 5. Canonical order model
 * ------------------------------------------------------------------ */

export interface OrderState {
  state: string;
  meaning: string;
  next: string[];
}

export const ORDER_STATES: OrderState[] = [
  { state: "QUOTED", meaning: "A priced, time-bounded offer exists.", next: ["PENDING", "EXPIRED"] },
  { state: "PENDING", meaning: "Accepted by the customer, awaiting confirmation of supply or payment authority.", next: ["CONFIRMED", "CANCELLED", "FAILED"] },
  { state: "CONFIRMED", meaning: "Commitment made; the order is owned by operations.", next: ["ASSIGNED", "CANCELLED"] },
  { state: "ASSIGNED", meaning: "Supply is allocated to the order.", next: ["STARTED", "CANCELLED"] },
  { state: "STARTED", meaning: "Fulfilment is in progress.", next: ["COMPLETED", "FAILED"] },
  { state: "COMPLETED", meaning: "Fulfilment finished; charge and documents are raised.", next: [] },
  { state: "CANCELLED", meaning: "Terminated before completion; cancellation terms apply.", next: [] },
  { state: "FAILED", meaning: "Could not be fulfilled; exception handling applies.", next: [] },
  { state: "EXPIRED", meaning: "A quote lapsed before acceptance.", next: [] },
];

/* ------------------------------------------------------------------ *
 * 6. Security, privacy, finance
 * ------------------------------------------------------------------ */

export interface Control {
  name: string;
  detail: string;
  status: CapabilityStatus;
}

export const SECURITY_CONTROLS: Control[] = [
  { name: "Tenant isolation", detail: "Row-level security scopes every partner read and write to the caller's membership; cross-tenant access is denied in the database, not the UI.", status: "LIVE" },
  { name: "Scoped credentials", detail: "API credentials are issued per tenant and environment by the integration desk, with revoke and rotation history.", status: "LIVE" },
  { name: "Role-based access control", detail: "Partner staff hold explicit roles; privileged actions are checked server-side on every call.", status: "LIVE" },
  { name: "Webhook signing", detail: "HMAC-SHA256 over `${timestamp}.${rawBody}` with a bounded replay window and a verification console.", status: "LIVE" },
  { name: "Audit logging", detail: "Credential, lifecycle and document events are recorded append-only with actor and timestamp.", status: "LIVE" },
  { name: "Encryption in transit", detail: "TLS on every partner-facing endpoint; plaintext transport is refused.", status: "LIVE" },
  { name: "Secrets management", detail: "Platform secrets are held in managed secret storage and never returned to a browser.", status: "LIVE" },
  { name: "Sandbox separation", detail: "Sandbox credentials cannot reach production data, and production credentials cannot reach sandbox.", status: "LIVE" },
  { name: "Single sign-on for partner staff", detail: "Enterprise IdP federation for partner workspace users.", status: "ROADMAP" },
  { name: "Multi-factor authentication", detail: "Second-factor enrolment for partner workspace users.", status: "ROADMAP" },
  { name: "IP allow-listing", detail: "Restricting production credentials to declared egress ranges.", status: "ROADMAP" },
];

export const PRIVACY_CONTROLS: Control[] = [
  { name: "Data minimisation", detail: "Only the traveller data required to quote, fulfil, document and settle a journey is collected.", status: "LIVE" },
  { name: "Access logging", detail: "Privileged reads of partner and customer records are recorded with the acting identity.", status: "LIVE" },
  { name: "Data residency", detail: "Platform data is held in the managed cloud region agreed at provisioning.", status: "CONFIGURED" },
  { name: "Retention and deletion", detail: "Retention periods and deletion handling are set in the data-processing terms of the agreement.", status: "CONTRACTUAL" },
  { name: "Data subject requests", detail: "Requests are routed through the partner as first line and executed by TaxiD for platform-held data.", status: "CONTRACTUAL" },
  { name: "Subprocessors and incident notification", detail: "Named in the agreement, with notification obligations on both parties.", status: "CONTRACTUAL" },
];

export interface FinancialStep {
  step: string;
  detail: string;
  sourceOfTruth: string;
}

export const FINANCIAL_CHAIN: FinancialStep[] = [
  { step: "Order", detail: "A completed order fixes the billable scope.", sourceOfTruth: "Canonical order record" },
  { step: "Charge", detail: "Fare, surcharges, waiting and tolls are computed from governed pricing.", sourceOfTruth: "Pricing engine output stored on the order" },
  { step: "Payment", detail: "Captured from the customer or drawn from a pre-funded partner wallet.", sourceOfTruth: "Verified payment-provider callback" },
  { step: "Fees and tax", detail: "Platform fee, partner margin and applicable tax are applied to the charge.", sourceOfTruth: "Contracted commercial schedule" },
  { step: "Settlement", detail: "Amounts due are accumulated over the agreed settlement period.", sourceOfTruth: "Append-only settlement ledger" },
  { step: "Partner statement", detail: "A sealed statement is issued for the period.", sourceOfTruth: "Issued document with content hash" },
  { step: "Reconciliation", detail: "Statement, payments and orders are matched line by line.", sourceOfTruth: "Reconciliation run output" },
  { step: "Exception management", detail: "Refunds, reversals, adjustments and disputes are raised as new entries.", sourceOfTruth: "Adjustment entries — no ledger row is ever edited" },
];

/* ------------------------------------------------------------------ *
 * 7. Commercial model and service levels
 * ------------------------------------------------------------------ */

export interface CommercialTerm {
  term: string;
  basis: string;
  status: CapabilityStatus;
}

export const COMMERCIAL_MODEL: CommercialTerm[] = [
  { term: "Implementation and setup", basis: "One-off, sized from the agreed scope of services, markets and integration work.", status: "CONTRACTUAL" },
  { term: "Transaction fee", basis: "Per completed order, tiered by monthly volume.", status: "CONTRACTUAL" },
  { term: "Partner margin", basis: "Applied on top of the governed rate, agreed per service and market.", status: "CONTRACTUAL" },
  { term: "Payment terms", basis: "Settlement period and payment window fixed in the agreement.", status: "CONTRACTUAL" },
  { term: "Minimum volumes", basis: "Where a programme carries dedicated supply or operations capacity.", status: "CONTRACTUAL" },
  { term: "Refunds and chargebacks", basis: "Allocated by cause between partner and TaxiD under the agreement.", status: "CONTRACTUAL" },
  { term: "Taxes", basis: "Charged and remitted by the issuing entity per Kenyan tax law.", status: "CONTRACTUAL" },
  { term: "Support and service levels", basis: "Selected support tier and the associated response targets.", status: "CONTRACTUAL" },
];

export interface ServiceLevel {
  measure: string;
  kind: "TARGET" | "SLO" | "CONTRACTUAL";
  value: string;
}

export const SERVICE_LEVELS: ServiceLevel[] = [
  { measure: "Booking API availability", kind: "SLO", value: "Internal service-level objective, reported monthly to the partner." },
  { measure: "Quote latency", kind: "TARGET", value: "Operational target tracked in the developer console; not a contractual commitment." },
  { measure: "Webhook delivery", kind: "TARGET", value: "Retried with backoff; every attempt is recorded with a correlation ID." },
  { measure: "Incident response", kind: "CONTRACTUAL", value: "Severity definitions and response targets are set in the agreement." },
  { measure: "Planned maintenance", kind: "CONTRACTUAL", value: "Advance notice window agreed per programme." },
  { measure: "Service credits", kind: "CONTRACTUAL", value: "Where agreed, credits attach to the contracted measures only." },
];

/* ------------------------------------------------------------------ *
 * 8. Lifecycle, go-live, operations
 * ------------------------------------------------------------------ */

export interface LifecycleStage {
  step: number;
  name: string;
  owner: Owner;
  entryCriteria: string;
  activities: string;
  deliverables: string;
  exitCriteria: string;
  approval: string;
}

export const LIFECYCLE: LifecycleStage[] = [
  { step: 1, name: "Partner qualification", owner: "TaxiD", entryCriteria: "Application submitted with company, market and volume profile.", activities: "Eligibility, brand and market screening.", deliverables: "Qualification decision.", exitCriteria: "Partner accepted into discovery.", approval: "Partner desk" },
  { step: 2, name: "Solution discovery", owner: "SHARED", entryCriteria: "Qualified partner.", activities: "Services, markets, customer journey and branding scope.", deliverables: "Solution outline.", exitCriteria: "Scope agreed in writing.", approval: "Commercial lead" },
  { step: 3, name: "Technical and operational feasibility", owner: "SHARED", entryCriteria: "Solution outline.", activities: "Integration pattern, supply feasibility, data flows, security review.", deliverables: "Feasibility record and risk list.", exitCriteria: "No unresolved blocking risk.", approval: "Integration desk" },
  { step: 4, name: "Commercial and operating agreement", owner: "SHARED", entryCriteria: "Feasibility cleared.", activities: "Pricing, margin, settlement, support, governance, data terms.", deliverables: "Signed agreement.", exitCriteria: "Agreement executed.", approval: "Both parties" },
  { step: 5, name: "Tenant and configuration provisioning", owner: "TaxiD", entryCriteria: "Signed agreement.", activities: "Tenant creation, brand profile, services, markets, roles, sandbox credentials.", deliverables: "Sandbox tenant and workspace access.", exitCriteria: "Partner can authenticate and quote in sandbox.", approval: "Integration desk" },
  { step: 6, name: "Build and integration", owner: "PARTNER", entryCriteria: "Sandbox tenant issued.", activities: "Booking flow, webhooks, documents, reconciliation handling.", deliverables: "Working integration in sandbox.", exitCriteria: "Agreed scenarios implemented.", approval: "Partner engineering" },
  { step: 7, name: "Certification", owner: "TaxiD", entryCriteria: "Sandbox integration complete.", activities: "Happy-path and failure-path scenarios, signature verification, idempotency, cancellation, reconciliation.", deliverables: "Certification record.", exitCriteria: "All mandatory scenarios pass.", approval: "Integration desk" },
  { step: 8, name: "Controlled production launch", owner: "SHARED", entryCriteria: "Certification passed and production credentials issued.", activities: "Staged traffic exposure against rollback triggers.", deliverables: "Live programme at full exposure.", exitCriteria: "100% exposure held without a rollback trigger.", approval: "Both parties" },
  { step: 9, name: "Hypercare", owner: "SHARED", entryCriteria: "Programme live.", activities: "Heightened monitoring of bookings, payments, webhooks and settlement.", deliverables: "Hypercare exit report.", exitCriteria: "Agreed stability window met.", approval: "Operations" },
  { step: 10, name: "Joint performance governance", owner: "SHARED", entryCriteria: "Hypercare exited.", activities: "Scheduled review of volume, quality, incidents, settlement and change.", deliverables: "Review record and actions.", exitCriteria: "Continuous — the programme stays in governance.", approval: "Both parties" },
];

export const ROLLOUT_STEPS = ["0%", "5%", "25%", "50%", "100%"] as const;

export const ROLLBACK_TRIGGERS: string[] = [
  "API error rate above the agreed threshold for the exposure window",
  "Quote or booking latency beyond the operational target",
  "Booking failure rate above baseline",
  "Payment capture or callback failure",
  "Webhook delivery failure that is not clearing on retry",
  "Settlement mismatch detected in reconciliation",
  "Any safety incident linked to the programme",
];

export const HYPERCARE_SIGNALS: string[] = [
  "Transaction volume against forecast",
  "Booking failures by cause",
  "Customer issues raised to first line",
  "Fulfilment and assignment performance",
  "Payment capture and refund activity",
  "Webhook delivery and retry chains",
  "Settlement and reconciliation exceptions",
  "Latency and availability of partner-facing endpoints",
];

export const OPERATING_LOOP = ["Launch", "Hypercare", "Monitor", "Measure", "Optimise", "Change", "Recertify", "Scale"] as const;

export interface ChangeClass {
  change: string;
  notice: string;
  requiresRecertification: boolean;
}

export const CHANGE_CLASSES: ChangeClass[] = [
  { change: "Breaking API change", notice: "Advance notice with a dated migration window and a supported previous version.", requiresRecertification: true },
  { change: "Additive API change", notice: "Published in the changelog; no partner action required.", requiresRecertification: false },
  { change: "Pricing change", notice: "Notice period as set in the agreement.", requiresRecertification: false },
  { change: "Service or market change", notice: "Agreed with the partner before configuration changes.", requiresRecertification: true },
  { change: "Policy or legal change", notice: "Notified with the effective date.", requiresRecertification: false },
  { change: "Security change", notice: "Notified; may be applied immediately where a risk requires it.", requiresRecertification: false },
  { change: "Brand change", notice: "Partner-initiated, reviewed against the brand immutables before publication.", requiresRecertification: false },
];

export interface IncidentStage {
  stage: string;
  detail: string;
}

export const INCIDENT_PROCESS: IncidentStage[] = [
  { stage: "Detection", detail: "Platform monitoring, partner report or customer escalation opens an incident." },
  { stage: "Severity", detail: "Classified by customer impact and financial exposure using the agreed severity scale." },
  { stage: "Escalation", detail: "Routed to the accountable operations and engineering owners." },
  { stage: "Partner notification", detail: "Issued for incidents that affect the partner's customers or settlement." },
  { stage: "Mitigation and recovery", detail: "Containment first, then service restoration, with staged re-exposure where traffic was withdrawn." },
  { stage: "Root cause analysis", detail: "Documented cause, contributing factors and detection gap." },
  { stage: "Corrective action", detail: "Tracked to completion with an owner and a date." },
  { stage: "Post-incident review", detail: "Reviewed jointly at the next governance session." },
];

export interface ContinuityScenario {
  scenario: string;
  posture: string;
}

export const CONTINUITY: ContinuityScenario[] = [
  { scenario: "Partner-facing API outage", posture: "Requests fail closed with typed errors; no order is silently created or lost." },
  { scenario: "Dispatch degradation", posture: "Orders remain valid and queued; operations fall back to manual assignment." },
  { scenario: "Payment provider outage", posture: "Capture is deferred and retried; orders are not marked paid without a verified callback." },
  { scenario: "Mapping provider outage", posture: "Quoting degrades to agreed fallback pricing rather than producing an unpriced order." },
  { scenario: "Database or regional incident", posture: "Managed platform recovery; recovery objectives are agreed contractually rather than published." },
  { scenario: "Webhook delivery failure", posture: "Retry with backoff plus a delivery log with correlation IDs for replay." },
  { scenario: "Cyber incident", posture: "Credential revocation, containment and partner notification under the agreed notification terms." },
];

/* ------------------------------------------------------------------ *
 * 9. Performance, governance, developer experience
 * ------------------------------------------------------------------ */

export const PERFORMANCE_METRICS: string[] = [
  "Bookings created and completed",
  "Cancellation rate by cause",
  "Fulfilment and assignment performance",
  "Revenue and partner margin",
  "Settlement and reconciliation status",
  "Support volume and first-line resolution",
  "Service quality and customer ratings",
  "API usage, error rate and latency",
];

export interface GovernanceDomain {
  domain: string;
  forum: string;
  detail: string;
}

export const GOVERNANCE: GovernanceDomain[] = [
  { domain: "Partner eligibility", forum: "Partner desk", detail: "Admission, suspension and exit criteria." },
  { domain: "Brand approval", forum: "Brand review", detail: "Customer-facing presentation checked against the brand immutables." },
  { domain: "Service and market approval", forum: "Operations", detail: "What the tenant may sell, and where." },
  { domain: "Security", forum: "Security review", detail: "Credentials, access, isolation findings and remediation." },
  { domain: "Data governance", forum: "Privacy review", detail: "Processing scope, retention and data subject handling." },
  { domain: "Commercial governance", forum: "Commercial review", detail: "Pricing, margin, volume and settlement performance." },
  { domain: "Change governance", forum: "Change board", detail: "Notice, impact, testing, recertification and rollback." },
  { domain: "Performance governance", forum: "Joint review", detail: "Scheduled review of the agreed measures and actions." },
];

export interface DeveloperResource {
  name: string;
  to: string;
  detail: string;
  status: CapabilityStatus;
}

export const DEVELOPER_RESOURCES: DeveloperResource[] = [
  { name: "API platform overview", to: "/partners/api", detail: "Capability domains, endpoints, scopes and webhook catalogue.", status: "LIVE" },
  { name: "Developer console", to: "/partners/api/console", detail: "Usage, quotas, OpenAPI versions, webhook verification, delivery log and credential rotation.", status: "LIVE" },
  { name: "API documentation", to: "/api-docs", detail: "Reference material for the published surface.", status: "LIVE" },
  { name: "Developer portal", to: "/developers", detail: "Entry point for partner engineering teams.", status: "LIVE" },
  { name: "Partner Workspace", to: "/partner/workspace", detail: "Operational workspace for an admitted partner.", status: "LIVE" },
  { name: "TaxiD Enterprise", to: "/enterprise", detail: "The enterprise proposition this programme sits inside.", status: "LIVE" },
];

/* ------------------------------------------------------------------ *
 * 10. Claim matrix — the audit spine behind every public statement
 * ------------------------------------------------------------------ */

export interface Claim {
  claim: string;
  category: string;
  status: CapabilityStatus;
  evidence: string;
  publiclyVisible: boolean;
}

export const CLAIM_MATRIX: Claim[] = [
  { claim: "Partner data is isolated per tenant", category: "Security", status: "LIVE", evidence: "Row-level security policies scoped to partner membership, exercised by authorization tests.", publiclyVisible: true },
  { claim: "Webhooks are signed and replay-bounded", category: "Security", status: "LIVE", evidence: "HMAC-SHA256 signature scheme with a tolerance window and a verification console.", publiclyVisible: true },
  { claim: "Credentials can be rotated and revoked with history", category: "Security", status: "LIVE", evidence: "Credential audit records written on create, rotate and revoke.", publiclyVisible: true },
  { claim: "Settlement records are append-only", category: "Finance", status: "LIVE", evidence: "Corrections are recorded as adjustment entries; no ledger row is updated in place.", publiclyVisible: true },
  { claim: "Branded booking experience", category: "Product", status: "CONFIGURED", evidence: "Brand profile applied per tenant during provisioning.", publiclyVisible: true },
  { claim: "Custom partner domain", category: "Product", status: "ROADMAP", evidence: "Not implemented; shown as roadmap on the public page.", publiclyVisible: true },
  { claim: "Branded native mobile application", category: "Product", status: "ROADMAP", evidence: "No store-published white-label app exists.", publiclyVisible: true },
  { claim: "SSO and MFA for partner staff", category: "Security", status: "ROADMAP", evidence: "Not implemented; explicitly labelled as roadmap.", publiclyVisible: true },
  { claim: "Availability and latency commitments", category: "Service levels", status: "CONTRACTUAL", evidence: "Targets and objectives are reported; commitments exist only in a signed agreement.", publiclyVisible: true },
  { claim: "Commercial pricing", category: "Commercial", status: "CONTRACTUAL", evidence: "No published price list; structure only.", publiclyVisible: true },
];

/* ------------------------------------------------------------------ *
 * 11. FAQ
 * ------------------------------------------------------------------ */

export interface Faq {
  q: string;
  a: string;
}

export const WHITE_LABEL_FAQ: Faq[] = [
  { q: "What exactly is white-labelled?", a: "The customer-facing surfaces in scope — brand identity, booking experience, notifications and documents — carry the partner brand. Fulfilment, dispatch, payments and settlement run on TaxiD's operating platform. Statutory identifiers, safety information and privacy notices are never overridden by branding." },
  { q: "Can we use our own domain?", a: "Not today. Custom partner domains are on the roadmap and are labelled as such throughout the programme material; the branded experience is served on a TaxiD-operated hostname until then." },
  { q: "Is there a branded mobile app?", a: "No. The white-label programme covers web and API surfaces. A store-published branded application is not part of the programme today." },
  { q: "How is our data kept separate from other partners?", a: "Every partner record is scoped to a tenant and enforced by row-level security in the database. Sandbox and production are separate tenants, and credentials cannot cross either boundary." },
  { q: "How do we integrate?", a: "Through the same API platform published for API partners — quoting, orders, tracking, documents and settlement, with scoped credentials, idempotency keys and signed webhooks. Sandbox comes first, then certification, then production credentials." },
  { q: "How does money flow?", a: "Order to charge to payment to fees and tax to settlement to statement to reconciliation. Payments are only recognised on a verified provider callback, and corrections are made as adjustments rather than edits." },
  { q: "What service levels apply?", a: "Availability and latency are published as objectives and targets and reported to the partner. Contractual commitments, including any service credits, exist only where the signed agreement states them." },
  { q: "How long does launch take?", a: "It depends on scope. The lifecycle has ten stages with explicit entry and exit criteria; the gating items are usually the operating agreement and certification rather than the build." },
  { q: "Who supports the customer?", a: "The partner takes first line, because the customer relationship is the partner's. TaxiD operates mobility escalation for orders in scope under the agreed support tier." },
];

/* ------------------------------------------------------------------ *
 * Derived helpers
 * ------------------------------------------------------------------ */

/** Capabilities safe to present as available today. */
export function availableSurfaces(): BrandSurface[] {
  return BRAND_SURFACES.filter((s) => s.status !== "ROADMAP");
}

/** Anything explicitly not available yet — must stay labelled on the page. */
export function roadmapSurfaces(): BrandSurface[] {
  return BRAND_SURFACES.filter((s) => s.status === "ROADMAP");
}

export function responsibilitiesFor(owner: Owner): Responsibility[] {
  return RESPONSIBILITY_MATRIX.filter((r) => r.owner === owner);
}

export function terminalOrderStates(): OrderState[] {
  return ORDER_STATES.filter((s) => s.next.length === 0);
}
