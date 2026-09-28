import { CONTACT } from "./contact";

/**
 * TaxiD brand configuration — single source of truth for product identity.
 * Legal entity stays Yalla Beena Limited; TaxiD is the trading/product brand.
 * Contact addresses and web domain intentionally still point at the existing
 * taxid.us mailboxes until the TaxiD domain and email are verified.
 */
export const BRAND = {
  name: "TaxiD",
  legalName: "Yalla Beena Limited",
  legalLine: "TaxiD is operated by Yalla Beena Limited.",
  productDescriptor: "Integrated Mobility & Transport Platform",
  tagline: "Move Smarter. Go Further.",
  supportName: "TaxiD Support",
  defaultSenderName: "TaxiD",
  supportEmail: CONTACT.supportEmail,
  website: CONTACT.webUrl,
  primaryColor: "#0068FD",
  accentColor: "#FDBB03",
} as const;
