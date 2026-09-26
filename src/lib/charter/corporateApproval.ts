/**
 * Corporate organisation approval for charter missions.
 *
 * Charter travel is never approved by the passenger — it is authorised by the
 * *approving authority* of the corporate organisation that carries the cost.
 * This module derives the organisation identity from what the booker already
 * typed (so nothing has to be re-entered and no mismatch can creep in) and
 * defines the enterprise procurement fields that print onto the order and
 * receipt.
 */

export interface ApprovalContact {
  name?: string;
  email?: string;
  phone?: string;
  company?: string;
}

/** Titles an approving authority can hold — ordered by typical spend mandate. */
export const APPROVER_TITLES = [
  "Chief Executive Officer",
  "Chief Operating Officer",
  "Chief Finance Officer",
  "Finance Director",
  "Procurement Manager",
  "Operations Manager",
  "Human Resources Manager",
  "Administration Manager",
  "Travel Desk Manager",
  "Authorised Signatory",
] as const;

const GENERIC_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "outlook.com", "hotmail.com",
  "live.com", "icloud.com", "protonmail.com", "aol.com", "me.com",
]);

const titleCase = (value: string) =>
  value
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((w) => (w.length <= 3 && w === w.toUpperCase() ? w : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");

/**
 * Deduces the corporate organisation name: an explicitly typed company always
 * wins, otherwise the corporate email domain is used. Personal mail domains are
 * never treated as an organisation.
 */
export function deriveOrganizationName(contact: ApprovalContact): string {
  const typed = (contact.company ?? "").trim();
  if (typed.length >= 2) return typed;
  const domain = (contact.email ?? "").split("@")[1]?.trim().toLowerCase();
  if (!domain || GENERIC_DOMAINS.has(domain)) return "";
  const root = domain.split(".").filter((p) => !["co", "com", "ke", "org", "net", "africa", "io"].includes(p));
  const base = root[0] ?? domain.split(".")[0];
  return base ? titleCase(base) : "";
}

/** True when the organisation could not be deduced and must be typed. */
export const needsOrganizationName = (contact: ApprovalContact) =>
  deriveOrganizationName(contact).length < 2;

export interface ProcurementDetails {
  organizationName: string;
  approverName: string;
  approverTitle: string;
  costCenter: string;
  purchaseOrder: string;
  /** How the organisation wants to be billed for this authorisation. */
  invoiceSchedule: "on_authorization" | "net_15" | "net_30" | "monthly_consolidated";
  /** Optional second signatory for missions above an internal threshold. */
  secondApprover: string;
  budgetNote: string;
  /** Settle the authorised invoice from the pre-funded corporate wallet. */
  useCorporateWallet: boolean;
  /** Accounts-payable contact that receives the invoice and statements. */
  billingContactName: string;
  billingContactEmail: string;
}

export const INVOICE_SCHEDULES: Array<{ value: ProcurementDetails["invoiceSchedule"]; label: string }> = [
  { value: "on_authorization", label: "Invoice on authorisation (immediate)" },
  { value: "net_15", label: "Net 15 days" },
  { value: "net_30", label: "Net 30 days" },
  { value: "monthly_consolidated", label: "Monthly consolidated statement" },
];

export const emptyProcurement = (contact: ApprovalContact): ProcurementDetails => ({
  organizationName: deriveOrganizationName(contact),
  approverName: (contact.name ?? "").trim(),
  approverTitle: "",
  costCenter: "",
  purchaseOrder: "",
  invoiceSchedule: "on_authorization",
  secondApprover: "",
  budgetNote: "",
  useCorporateWallet: false,
  billingContactName: "",
  billingContactEmail: (contact.email ?? "").trim(),
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Field-level blockers preventing the organisation from authorising travel. */
export function procurementBlockers(p: ProcurementDetails): Record<string, string> {
  const errors: Record<string, string> = {};
  if (p.organizationName.trim().length < 2) {
    errors.organizationName = "Enter the corporate organisation carrying this cost.";
  }
  if (p.approverName.trim().length < 3) {
    errors.approverName = "Enter the full name of the approving authority.";
  }
  if (!p.approverTitle.trim()) {
    errors.approverTitle = "Select the title of the approving authority.";
  }
  if (p.costCenter.trim().length < 2) {
    errors.costCenter = "Enter the cost centre or department code to be charged.";
  }
  const billingEmail = (p.billingContactEmail ?? "").trim();
  if (billingEmail && !EMAIL_RE.test(billingEmail)) {
    errors.billingContactEmail = "Enter a deliverable accounts-payable email address.";
  }
  return errors;
}

export const procurementReady = (p: ProcurementDetails) =>
  Object.keys(procurementBlockers(p)).length === 0;

/** Flattened payload printed on documents and stored on the registry. */
export function procurementPayload(p: ProcurementDetails) {
  return {
    organization_name: p.organizationName.trim(),
    approver_name: p.approverName.trim(),
    approver_title: p.approverTitle.trim(),
    cost_center: p.costCenter.trim(),
    purchase_order: p.purchaseOrder.trim() || null,
    invoice_schedule: p.invoiceSchedule,
    second_approver: p.secondApprover.trim() || null,
    budget_note: p.budgetNote.trim() || null,
    settlement_route: p.useCorporateWallet ? "corporate_wallet" : "invoice",
    billing_contact_name: (p.billingContactName ?? "").trim() || null,
    billing_contact_email: (p.billingContactEmail ?? "").trim() || null,
  };
}

/** Human-readable approval chain used on the dossier and in the audit trail. */
export function approvalChain(p: ProcurementDetails): string[] {
  const chain = [`${p.approverName.trim() || "Approving authority"} — ${p.approverTitle.trim() || "Authorised signatory"}`];
  if (p.secondApprover.trim()) chain.push(`${p.secondApprover.trim()} — Counter-signatory`);
  chain.push(`${p.organizationName.trim() || "Corporate organisation"} — Cost centre ${p.costCenter.trim() || "unassigned"}`);
  return chain;
}
