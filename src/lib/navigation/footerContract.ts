/**
 * Footer-to-platform synchronization contract.
 *
 * The footer is PROJECTED from the canonical navigation registry
 * (primaryNav.ts) — it is never hand-maintained. This contract declares, per
 * footer destination, what the platform must actually be able to do, so a
 * label can never outlive (or overstate) its capability.
 *
 * classification
 *   product        marketing / capability page describing a service
 *   transactional  performs a real action (book, apply, register, quote)
 *   account        authentication or account creation surface
 *   informational  help, docs, pricing guides, FAQ
 *   legal          policy documents
 *
 * Adding a footer link without an entry here fails footer-sync.test.ts.
 */
export type FooterClassification =
  | "product"
  | "transactional"
  | "account"
  | "informational"
  | "legal";

export interface FooterContractEntry {
  classification: FooterClassification;
  /** Human statement of the capability the label promises. */
  capability: string;
}

export const FOOTER_CONTRACT: Record<string, FooterContractEntry> = {
  // ---- Rides
  "/rider": { classification: "transactional", capability: "Live ride booking: pickup, drop-off, fare estimate, request" },
  "/rider/airport": { classification: "transactional", capability: "Airport transfer booking" },
  "/riders/individual": { classification: "product", capability: "Rider value proposition and safety story" },
  "/pricing": { classification: "informational", capability: "Published fare and category guide" },
  "/auth": { classification: "account", capability: "Account creation and sign-in" },
  "/support": { classification: "informational", capability: "Help centre and support routing" },

  // ---- Business
  "/riders/corporate": { classification: "product", capability: "Employee mobility programme overview" },
  "/rentals/chauffeur": { classification: "product", capability: "Executive chauffeur service overview" },
  "/corporates": { classification: "product", capability: "Corporate programme overview" },
  "/corporate/register": { classification: "transactional", capability: "Corporate KYB registration wizard" },
  "/enterprise": { classification: "product", capability: "Enterprise mobility and logistics platform overview" },
  "/enterprise/demo": { classification: "informational", capability: "Guided walkthrough of corporate booking, policy checks, approval and spend control" },
  "/corporate": { classification: "informational", capability: "Company profile document: read online and download" },
  "/logistics/solutions": { classification: "product", capability: "Managed B2B logistics capability overview" },

  // ---- Charter
  "/charter": { classification: "product", capability: "Charter category catalogue" },
  "/charter/bus-charter": { classification: "product", capability: "Bus, van and coach charter catalogue and enquiry" },
  "/charter/aircraft-charter": { classification: "product", capability: "Aircraft charter catalogue and enquiry" },
  "/charter/helicopter-charter": { classification: "product", capability: "Helicopter charter catalogue and enquiry" },
  "/charter/marine-charter": { classification: "product", capability: "Marine charter catalogue and enquiry" },
  "/charter/smartfare": { classification: "transactional", capability: "SmartFare charter mission pricing workspace" },
  "/charter/search": { classification: "transactional", capability: "Cross-operator fleet search and compare" },
  "/marketplace": { classification: "transactional", capability: "Unified capacity search by service, city, date and vehicle with request handoff" },

  // ---- Rentals & leasing
  "/rentals/self-drive": { classification: "product", capability: "Self-drive car and SUV rental overview" },
  "/charter/car-rentals": { classification: "product", capability: "Executive and luxury car rental catalogue" },
  "/rentals/bus-coach": { classification: "product", capability: "Bus and coach rental / leasing overview" },
  "/rentals/corporate-leasing": { classification: "product", capability: "Corporate fleet leasing overview" },
  "/charter/truck-hauler-leasing": { classification: "product", capability: "Truck and hauler leasing catalogue" },
  "/charter/heavy-machinery-leasing": { classification: "product", capability: "Heavy equipment leasing catalogue" },
  "/rentals/marketplace": { classification: "product", capability: "Rental marketplace discovery" },

  // ---- Logistics
  "/delivery/package": { classification: "transactional", capability: "Parcel and express delivery request" },
  "/delivery/courier": { classification: "transactional", capability: "On-demand courier request" },
  "/delivery/logistics": { classification: "product", capability: "Freight and cargo capability overview" },
  "/delivery/fleet": { classification: "product", capability: "Dedicated truck dispatch overview" },
  "/delivery": { classification: "product", capability: "Delivery network overview" },
  "/logistics": { classification: "product", capability: "National logistics network, hubs and coverage" },

  // ---- Drivers
  "/driver/onboarding": { classification: "informational", capability: "Driver eligibility, vehicle requirements and onboarding standards" },
  "/driver/start": { classification: "transactional", capability: "Driver account creation, payout number confirmation and portal orientation" },
  "/driver/earnings": { classification: "informational", capability: "Driver earnings, incentives and payout guidance" },

  // ---- Partners
  "/drivers": { classification: "product", capability: "Driver partner proposition" },
  // ---- Yalla Partners: one entry per Partner Capability Registry segment
  "/partners/travel-tourism": { classification: "product", capability: "Travel & tourism partner proposition and application route" },
  "/partners/hospitality": { classification: "product", capability: "Hospitality partner proposition and application route" },
  "/partners/corporate": { classification: "product", capability: "Corporate & institutional distribution partner proposition" },
  "/partners/commerce-retail": { classification: "product", capability: "Commerce & retail delivery distribution proposition" },
  "/partners/events-destinations": { classification: "product", capability: "Events & destination mobility partner proposition" },
  "/partners/referral-distribution": { classification: "product", capability: "Referral partner proposition and commission model" },
  "/partners/drivers": { classification: "product", capability: "Driver partner supply proposition and registration route" },
  "/partners/fleet-operators": { classification: "product", capability: "Fleet operator supply proposition and admission route" },
  "/partners/charter-operators": { classification: "product", capability: "Charter operator supply proposition and admission route" },
  "/partners/logistics-carriers": { classification: "product", capability: "Logistics & carrier supply proposition and admission route" },
  "/partners/rental-leasing": { classification: "product", capability: "Rental & leasing supply proposition, partner-desk admitted" },
  "/partners/api": { classification: "product", capability: "API integration partner proposition and certification path" },
  "/partners/white-label": { classification: "product", capability: "White-label partner proposition and programme path" },
  "/partners/technology": { classification: "product", capability: "Technology & platform partner proposition" },
  "/driver/apply": { classification: "transactional", capability: "Driver / courier application submission" },
  "/driver/training": { classification: "informational", capability: "Driver academy and training programmes" },
  "/driver/support": { classification: "informational", capability: "Driver support and escalation" },
  "/charter/login": { classification: "account", capability: "Fleet and charter operator sign-in" },

  // ---- Resources
  "/faq": { classification: "informational", capability: "Frequently asked questions" },
  "/safety": { classification: "informational", capability: "Safety commitments and programmes" },
  "/developers": { classification: "informational", capability: "Developer platform overview" },
  "/api-docs": { classification: "informational", capability: "API reference documentation" },
  "/careers": { classification: "transactional", capability: "Published vacancies and candidate application submission (Recruitment 360)" },
  "/blog/corporate-travel-management-guide": { classification: "informational", capability: "Corporate travel management guidance article" },
  "/contact": { classification: "transactional", capability: "Sales, concierge and partner enquiry submission" },
  "/charter/equipment-rentals": { classification: "product", capability: "Equipment rental catalogue and enquiry" },

  // ---- Legal
  "/legal/privacy": { classification: "legal", capability: "Privacy policy" },
  "/legal/terms": { classification: "legal", capability: "Terms of service" },
  "/legal/cookies": { classification: "legal", capability: "Cookie policy" },
  "/legal/data-protection": { classification: "legal", capability: "Data protection commitments" },
  "/legal/accessibility": { classification: "legal", capability: "Accessibility statement" },
  "/legal/community": { classification: "legal", capability: "Community guidelines" },
};

/** Labels that promise a transaction and therefore require a transactional page. */
export const TRANSACTIONAL_LABEL_PATTERNS: RegExp[] = [
  /^book\b/i,
  /^send\b/i,
  /^track\b/i,
  /^apply\b/i,
  /\bregistration$/i,
  /^open .*account$/i,
  /^create .*account$/i,
  /^search\b/i,
  /^compare\b/i,
];
