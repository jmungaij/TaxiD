/**
 * Platform Capability Registry.
 *
 * A navigation label is a PROMISE ("Book", "Track", "Compare", "Register",
 * "Apply", "Manage", "Request"). A promise is only honest when a real backend
 * capability stands behind it. This registry is the machine-readable list of
 * capabilities the platform actually has, each bound to the service, RPC/API
 * surface and tables that implement it.
 *
 * Nothing in navigation may reference a capability that is absent here, and no
 * label may promise a verb the capability does not declare.
 */

/** Verbs a navigation label can promise. */
export type CapabilityVerb =
  | "read"      // informational content only
  | "compare"   // search / compare inventory
  | "book"      // create a booking or order
  | "track"     // follow the state of an existing order
  | "quote"     // request a priced quotation / RFQ
  | "register"  // create an account / apply / onboard
  | "manage"    // operate existing records (portal / dashboard)
  | "approve"   // authorise something on behalf of an organisation
  | "pay";      // move money, settle, invoice

export interface Capability {
  id: string;
  label: string;
  /** Verbs this capability genuinely supports. */
  verbs: CapabilityVerb[];
  /** Owning business domain (mirrors the navigation domain model). */
  domain:
    | "rides"
    | "business"
    | "charter"
    | "rentals"
    | "logistics"
    | "marketplace"
    | "partners"
    | "resources"
    | "identity"
    | "internal";
  /** Backend surface that implements it: edge functions, RPCs or REST tables. */
  backend: string[];
}

const cap = (c: Capability) => c;

export const CAPABILITIES: Record<string, Capability> = Object.fromEntries(
  [
    /* ---------------- Rides ---------------- */
    cap({
      id: "ride.book",
      label: "Book a ride",
      verbs: ["read", "compare", "book", "quote"],
      domain: "rides",
      backend: ["rpc:pricing360_calculate", "table:trips", "table:trip_requests"],
    }),
    cap({
      id: "ride.history",
      label: "Ride history & receipts",
      verbs: ["read", "track", "manage"],
      domain: "rides",
      backend: ["table:trips", "table:trip_receipts"],
    }),
    cap({
      id: "ride.wallet",
      label: "Rider wallet",
      verbs: ["read", "manage", "pay"],
      domain: "rides",
      backend: ["fn:mpesa-stkpush", "table:wallets", "table:wallet_transactions"],
    }),
    cap({
      id: "ride.loyalty",
      label: "Rewards & saved places",
      verbs: ["read", "manage"],
      domain: "rides",
      backend: ["table:rider_rewards", "table:rider_favorites"],
    }),
    cap({
      id: "ride.portal",
      label: "Rider portal",
      verbs: ["read", "manage", "track"],
      domain: "rides",
      backend: ["table:trips", "table:wallets"],
    }),
    cap({
      id: "ride.marketing",
      label: "Rides information",
      verbs: ["read"],
      domain: "rides",
      backend: ["static:marketing"],
    }),

    /* ---------------- Business / corporate ---------------- */
    cap({
      id: "corporate.onboarding",
      label: "Corporate onboarding (KYB)",
      verbs: ["read", "register"],
      domain: "business",
      backend: ["table:corporate_accounts", "table:corporate_documents", "fn:corporate-kyb-scan"],
    }),
    cap({
      id: "corporate.programme",
      label: "Corporate mobility programme",
      verbs: ["read", "quote", "book"],
      domain: "business",
      backend: ["table:corporate_trip_requests", "rpc:pricing360_calculate"],
    }),
    cap({
      id: "corporate.manage",
      label: "Corporate administration",
      verbs: ["read", "manage", "track"],
      domain: "business",
      backend: ["table:corporate_accounts", "table:corporate_employees"],
    }),
    cap({
      id: "corporate.approvals",
      label: "Corporate approvals & policy",
      verbs: ["read", "manage", "approve"],
      domain: "business",
      backend: ["table:corporate_approvals", "table:corporate_policies"],
    }),
    cap({
      id: "corporate.finance",
      label: "Corporate billing & wallet",
      verbs: ["read", "manage", "pay"],
      domain: "business",
      backend: ["table:corporate_wallets", "table:corporate_invoices", "fn:etims-submit"],
    }),
    cap({
      id: "corporate.marketing",
      label: "Business information",
      verbs: ["read"],
      domain: "business",
      backend: ["static:marketing"],
    }),

    /* ---------------- Charter ---------------- */
    cap({
      id: "charter.compare",
      label: "Charter search & compare",
      verbs: ["read", "compare", "quote"],
      domain: "charter",
      backend: ["table:charter_assets", "rpc:ap360_quote"],
    }),
    cap({
      id: "charter.book",
      label: "Charter booking",
      verbs: ["read", "compare", "quote", "book"],
      domain: "charter",
      backend: ["rpc:ap360_quote", "rpc:ap360_save_quote", "table:charter_bookings"],
    }),
    cap({
      id: "charter.manage",
      label: "Charter management",
      verbs: ["read", "manage", "track", "approve", "pay"],
      domain: "charter",
      backend: ["table:charter_bookings", "table:charter_wallet_ledger"],
    }),
    cap({
      id: "charter.operator",
      label: "Operator portal",
      verbs: ["read", "manage", "track"],
      domain: "charter",
      backend: ["table:charter_operators", "table:charter_assets"],
    }),
    cap({
      id: "charter.marketing",
      label: "Charter information",
      verbs: ["read"],
      domain: "charter",
      backend: ["static:marketing"],
    }),

    /* ---------------- Rentals & leasing ---------------- */
    cap({
      id: "rentals.compare",
      label: "Rental marketplace",
      verbs: ["read", "compare", "quote"],
      domain: "rentals",
      backend: ["table:rental_listings", "rpc:asset_pricing_calculate"],
    }),
    cap({
      id: "rentals.lease",
      label: "Leasing enquiry",
      verbs: ["read", "quote"],
      domain: "rentals",
      backend: ["table:leads", "fn:contact-submission"],
    }),
    cap({
      id: "rentals.marketing",
      label: "Rentals information",
      verbs: ["read"],
      domain: "rentals",
      backend: ["static:marketing"],
    }),

    /* ---------------- Logistics ---------------- */
    cap({
      id: "logistics.send",
      label: "Send a parcel / courier order",
      verbs: ["read", "compare", "quote", "book"],
      domain: "logistics",
      backend: ["table:delivery_jobs", "table:packages", "rpc:pricing360_calculate"],
    }),
    cap({
      id: "logistics.operate",
      label: "Logistics operations",
      verbs: ["read", "manage", "track"],
      domain: "logistics",
      backend: ["table:delivery_jobs", "table:delivery_routes", "table:dispatch_rules"],
    }),
    cap({
      id: "logistics.partner",
      label: "Carrier & partner portal",
      verbs: ["read", "manage", "track", "register"],
      domain: "logistics",
      backend: ["table:delivery_partners", "table:driver_applications"],
    }),
    cap({
      id: "logistics.marketing",
      label: "Logistics information",
      verbs: ["read"],
      domain: "logistics",
      backend: ["static:marketing"],
    }),

    /* ---------------- Marketplace ---------------- */
    cap({
      id: "marketplace.browse",
      label: "Marketplace discovery",
      verbs: ["read", "compare"],
      domain: "marketplace",
      backend: ["table:charter_assets", "table:rental_listings"],
    }),

    /* ---------------- Partners / supply ---------------- */
    cap({
      id: "driver.apply",
      label: "Driver & courier onboarding",
      verbs: ["read", "register"],
      domain: "partners",
      backend: ["table:driver_applications", "fn:driver-application-submit"],
    }),
    cap({
      id: "driver.portal",
      label: "Driver portal",
      verbs: ["read", "manage", "track", "pay"],
      domain: "partners",
      backend: ["table:driver_profiles", "table:driver_earnings"],
    }),
    cap({
      id: "driver.enablement",
      label: "Driver academy & support",
      verbs: ["read"],
      domain: "partners",
      backend: ["table:training_modules", "static:marketing"],
    }),
    cap({
      id: "partner.marketing",
      label: "Partner information",
      verbs: ["read"],
      domain: "partners",
      backend: ["static:marketing"],
    }),
    cap({
      id: "partner.onboarding",
      label: "Partner application & admission",
      verbs: ["read", "register"],
      domain: "partners",
      backend: ["table:partner_applications", "rpc:partner_application_promote"],
    }),
    cap({
      id: "partner.workspace",
      label: "Partner workspace: quote, book, track & settle",
      verbs: ["read", "manage", "quote", "book", "track", "pay"],
      domain: "partners",
      backend: ["table:partners", "table:partner_quotes", "table:partner_wallets", "table:partner_settlements"],
    }),

    /* ---------------- Resources ---------------- */
    cap({
      id: "content.support",
      label: "Help, support & enquiry intake",
      verbs: ["read", "quote", "register"],
      domain: "resources",
      backend: ["fn:contact-submission", "static:marketing"],
    }),
    cap({
      id: "content.pricing",
      label: "Published pricing guide",
      verbs: ["read", "compare"],
      domain: "resources",
      backend: ["rpc:pricing360_public_rates"],
    }),
    cap({
      id: "content.company",
      label: "Company, news & trust content",
      verbs: ["read"],
      domain: "resources",
      backend: ["static:marketing"],
    }),
    cap({
      id: "content.legal",
      label: "Legal & policy documents",
      verbs: ["read"],
      domain: "resources",
      backend: ["static:legal"],
    }),
    cap({
      id: "content.developers",
      label: "Developer documentation",
      verbs: ["read"],
      domain: "resources",
      backend: ["static:docs"],
    }),
    cap({
      id: "careers.apply",
      label: "Careers & applications",
      verbs: ["read", "register"],
      domain: "resources",
      backend: ["rpc:rec_public_apply", "table:rec_vacancies"],
    }),

    /* ---------------- Identity ---------------- */
    cap({
      id: "identity.auth",
      label: "Authentication gateways",
      verbs: ["read", "register", "manage"],
      domain: "identity",
      backend: ["auth:supabase"],
    }),

    /* ---------------- Internal (protected portals) ---------------- */
    cap({
      id: "platform.administer",
      label: "Platform administration console",
      verbs: ["read", "manage", "approve"],
      domain: "internal",
      backend: ["table:app_pages", "table:audit_logs", "table:nav_registry_versions"],
    }),
    cap({
      id: "platform.operate",
      label: "Live mobility operations console",
      verbs: ["read", "manage", "track", "approve"],
      domain: "internal",
      backend: ["table:trips", "table:dispatch_rules", "table:noc_incidents"],
    }),
    cap({
      id: "platform.commercial",
      label: "Commercial & pricing governance",
      verbs: ["read", "manage", "approve", "quote"],
      domain: "internal",
      backend: ["rpc:pricing360_calculate", "rpc:ap360_quote", "table:pricing_rule_sets"],
    }),
    cap({
      id: "platform.finance",
      label: "Finance, settlement & payouts",
      verbs: ["read", "manage", "approve", "pay"],
      domain: "internal",
      backend: ["table:wallet_transactions", "table:settlements", "table:journals"],
    }),
    cap({
      id: "platform.trust",
      label: "Trust, safety & compliance control",
      verbs: ["read", "manage", "approve"],
      domain: "internal",
      backend: ["table:security_findings", "table:kyc_documents"],
    }),
    cap({
      id: "platform.intelligence",
      label: "Analytics & decision intelligence",
      verbs: ["read", "compare"],
      domain: "internal",
      backend: ["table:analytics_snapshots", "rpc:executive_metrics"],
    }),
    cap({
      id: "platform.people",
      label: "Riders, drivers & partner administration",
      verbs: ["read", "manage", "approve", "register"],
      domain: "internal",
      backend: ["table:profiles", "table:driver_profiles", "table:corporate_accounts"],
    }),
    cap({
      id: "platform.assets",
      label: "Fleet, charter & rental asset administration",
      verbs: ["read", "manage", "book", "quote"],
      domain: "internal",
      backend: ["table:vehicles", "table:charter_bookings", "table:rental_assets"],
    }),
    cap({
      id: "platform.logistics",
      label: "Delivery & logistics administration",
      verbs: ["read", "manage", "track", "approve"],
      domain: "internal",
      backend: ["table:delivery_orders", "table:delivery_pods"],
    }),

    /* ---------------- Internal ---------------- */
    cap({
      id: "staff.operate",
      label: "Staff portal operations",
      verbs: ["read", "manage", "track", "approve"],
      domain: "internal",
      backend: ["table:staff_work_items", "table:org_entities"],
    }),
  ].map((c) => [c.id, c]),
);

export const CAPABILITY_IDS = Object.keys(CAPABILITIES);

export function capabilityFor(id: string): Capability | undefined {
  return CAPABILITIES[id];
}

/**
 * Verbs a navigation LABEL promises to the visitor. Deliberately conservative:
 * a pattern only fires when the wording is an explicit commitment.
 */
export const VERB_PATTERNS: { verb: CapabilityVerb; re: RegExp }[] = [
  { verb: "book", re: /\b(book|send a parcel|request a movement|reserve|charter now)\b/i },
  { verb: "track", re: /\b(track|tracking|live status)\b/i },
  { verb: "compare", re: /\b(compare|search)\b/i },
  { verb: "quote", re: /\b(quote|quotation|rfq|get a price)\b/i },
  { verb: "register", re: /\b(register|registration|apply|sign up|open (a )?business account|create .*account|become a)\b/i },
  { verb: "approve", re: /\b(approve|approvals|sign-off)\b/i },
  { verb: "pay", re: /\b(pay|payment|billing|invoic)/i },
  // "portal"/"dashboard" are nouns naming a surface, not promises of a verb.
  { verb: "manage", re: /\b(manage|management|operations|optimisation)\b/i },
];

/** The verbs a label promises. */
export function promisedVerbs(label: string): CapabilityVerb[] {
  return VERB_PATTERNS.filter((p) => p.re.test(label)).map((p) => p.verb);
}
