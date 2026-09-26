import { CONTACT } from "./contact";

/**
 * SAFARID brand configuration — single source of truth for product identity.
 * Legal entity stays Yalla Beena Limited; SAFARID is the trading/product brand.
 * Contact addresses and web domain intentionally still point at the existing
 * yalla.africa mailboxes until the SAFARID domain and email are verified.
 */
export const BRAND = {
  name: "SAFARID",
  legalName: "Yalla Beena Limited",
  legalLine: "SAFARID is operated by Yalla Beena Limited.",
  productDescriptor: "Mobility & Travel Platform",
  tagline: "Move with confidence.",
  supportName: "SAFARID Support",
  defaultSenderName: "SAFARID",
  supportEmail: CONTACT.supportEmail,
  website: CONTACT.webUrl,
  primaryColor: "#143490",
  accentColor: "#F7931E",
} as const;
