/**
 * Manifest validation for the charter booking flow.
 *
 * Regulators accept a national ID on domestic sectors, but a passport is
 * mandatory once the sector crosses a border. Independently of the travel
 * document, every named passenger must be reachable — a telephone number and
 * a deliverable email address are required before payment is taken.
 */
import { isValidKenyanMsisdn } from "@/lib/kenyaPhone";

export interface ManifestPassenger {
  name: string;
  idNumber: string;
  passportNumber: string;
  phone: string;
  email: string;
}

/** Conservative RFC-5322 subset: no spaces, single @, dotted TLD of 2+ chars. */
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

/** Reject obvious throwaway/undeliverable domains before payment. */
const BLOCKED_DOMAINS = new Set([
  "example.com", "example.org", "test.com", "mailinator.com",
  "yopmail.com", "tempmail.com", "10minutemail.com", "guerrillamail.com",
]);

export function isVerifiableEmail(raw: string): boolean {
  const value = (raw ?? "").trim().toLowerCase();
  if (value.length < 6 || value.length > 254) return false;
  if (!EMAIL_RE.test(value)) return false;
  const domain = value.split("@")[1] ?? "";
  return !BLOCKED_DOMAINS.has(domain);
}

/**
 * Accepts Kenyan MSISDNs through the platform normalizer, and any other
 * international number in E.164-ish form (8–15 digits with a country code).
 */
export function isValidContactPhone(raw: string): boolean {
  const value = (raw ?? "").trim();
  if (!value) return false;
  if (isValidKenyanMsisdn(value)) return true;
  const digits = value.replace(/[\s\-()]/g, "").replace(/^\+/, "");
  return /^\d{8,15}$/.test(digits) && value.trim().startsWith("+");
}

export type ManifestIssue =
  | "name"
  | "document"
  | "passport"
  | "phone"
  | "email";

export const MANIFEST_ISSUE_LABEL: Record<ManifestIssue, string> = {
  name: "Full name as printed on the travel document",
  document: "A national ID or passport number",
  passport: "A passport number (international sector)",
  phone: "A reachable telephone number",
  email: "A valid, verifiable email address",
};

/** Returns the outstanding requirements for one passenger row. */
export function passengerIssues(p: ManifestPassenger, internationalSector: boolean): ManifestIssue[] {
  const issues: ManifestIssue[] = [];
  if (!p.name.trim()) issues.push("name");
  if (internationalSector) {
    if (!p.passportNumber.trim()) issues.push("passport");
  } else if (!p.passportNumber.trim() && !p.idNumber.trim()) {
    issues.push("document");
  }
  if (!isValidContactPhone(p.phone)) issues.push("phone");
  if (!isVerifiableEmail(p.email)) issues.push("email");
  return issues;
}

/** The manifest is payable only when at least one passenger exists and all rows clear. */
export function manifestIsValid(passengers: ManifestPassenger[], internationalSector: boolean): boolean {
  const named = passengers.filter((p) => p.name.trim() || p.idNumber.trim() || p.passportNumber.trim() || p.phone.trim() || p.email.trim());
  if (!named.length) return false;
  return named.every((p) => passengerIssues(p, internationalSector).length === 0);
}
