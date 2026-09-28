/**
 * AUTHORITATIVE TaxiD COMMUNICATIONS CONFIGURATION
 * ---------------------------------------------------------
 * Single source of truth for every public-facing contact channel.
 * Never hard-code a phone number or contact email address anywhere else —
 * import from here so one change propagates across the whole platform.
 *
 * Approved channels (see also public.notification_settings for server routing):
 *   support@taxid.us  general + customer support + technical assistance
 *   sales@taxid.us    commercial, corporate, enterprise, partnerships, quotes
 *   hr@taxid.us       recruitment / careers enquiries only (Recruitment 360)
 *   +254 142 970050       primary public telephone (voice + WhatsApp)
 */

export const CONTACT = {
  supportEmail: "support@taxid.us",
  salesEmail: "sales@taxid.us",
  /** Recruitment enquiries only. Applications themselves go through Recruitment 360. */
  hrEmail: "hr@taxid.us",
  /** Administrative / platform-governance mailbox. */
  adminEmail: "admin@taxid.us",
  /** Display format. */
  phoneDisplay: "+254 142 970050",
  /** E.164, used for tel: / wa.me links. */
  phoneE164: "+254142970050",
  whatsappNumber: "254142970050",
  addressLocality: "Nairobi, Kenya",
  webDomain: "taxid.us",
  /** Authoritative public web origin. */
  webUrl: "https://www.taxid.us",
} as const;

export const SUPPORT_MAILTO = `mailto:${CONTACT.supportEmail}`;
export const SALES_MAILTO = `mailto:${CONTACT.salesEmail}`;
export const HR_MAILTO = `mailto:${CONTACT.hrEmail}`;
export const ADMIN_MAILTO = `mailto:${CONTACT.adminEmail}`;
export const PHONE_TEL = `tel:${CONTACT.phoneE164}`;
export const WHATSAPP_LINK = `https://wa.me/${CONTACT.whatsappNumber}`;


/**
 * Social profiles are NO LONGER configured here.
 *
 * Ownership, verification, approval and activation of every official TaxiD
 * Mobility social destination is governed by the Social Distribution
 * subsystem (`public.social_accounts` + /dashboard/admin/social-distribution)
 * and read at runtime via `src/lib/social/api.ts`. Hard-coding a handle here
 * bypassed verification and could publish an unowned profile, so the previous
 * `SOCIAL_CHANNELS` constant was migrated into the database as a DRAFT record.
 */



/** Accessible labels — never rely on icons alone. */
export const CONTACT_A11Y = {
  phone: `Call TaxiD at ${CONTACT.phoneDisplay}`,
  support: "Email TaxiD Support",
  sales: "Email TaxiD Sales",
  hr: "Email TaxiD Recruitment",
  whatsapp: `Message TaxiD on WhatsApp at ${CONTACT.phoneDisplay}`,
} as const;

/** Public enquiry categories. Server decides the destination inbox from these. */
export const ENQUIRY_CATEGORIES = [
  { value: "general", label: "General enquiry", routesTo: "support" },
  { value: "customer_support", label: "Customer support", routesTo: "support" },
  { value: "corporate_sales", label: "Corporate sales", routesTo: "sales" },
  { value: "partnership", label: "Partnership", routesTo: "sales" },
  { value: "fleet_services", label: "Vehicle / fleet services", routesTo: "sales" },
  { value: "travel_services", label: "Travel services", routesTo: "sales" },
  { value: "parcel_courier", label: "Parcel / courier", routesTo: "support" },
  { value: "driver_partner", label: "Driver / partner", routesTo: "support" },
  { value: "recruitment", label: "Recruitment / careers", routesTo: "hr" },
  { value: "other", label: "Other", routesTo: "support" },
] as const;

export type EnquiryCategory = (typeof ENQUIRY_CATEGORIES)[number]["value"];

/** Team a category belongs to — display only; the server re-derives the inbox. */
export function categoryTeam(category: string): "support" | "sales" | "hr" {
  return ENQUIRY_CATEGORIES.find((c) => c.value === category)?.routesTo ?? "support";
}

/** User-facing fallback when a submission cannot be delivered. */
export const CONTACT_FAILURE_MESSAGE =
  `Unable to submit your enquiry at this time. Please contact TaxiD Support at ${CONTACT.supportEmail} or call ${CONTACT.phoneDisplay}.`;
