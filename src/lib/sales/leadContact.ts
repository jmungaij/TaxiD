/**
 * LEAD CONTACT PERSON.
 *
 * The client list TaxiD imported carried organisations, phone numbers and
 * emails but no contact people, so those fields were filled with the literal
 * text "NOT STATED". That is a placeholder, not a name: it is treated here as
 * an empty field so the workspace asks for the real person instead of showing
 * a fake one.
 */
import { untypedDb } from "@/integrations/supabase/untyped";

/** Placeholders that mean "nothing was recorded". */
const PLACEHOLDERS = new Set(["not stated", "not provided", "unknown", "n/a", "na", "-", "—", "tbc", "tbd"]);

/** The recorded contact person, or null when nothing real is recorded. */
export function contactPerson(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  return PLACEHOLDERS.has(v.toLowerCase()) ? null : v;
}

export interface LeadContactInput {
  contactName: string;
  contactEmail?: string | null;
  contactPhone?: string | null;
}

/**
 * Records or corrects the contact person on a lead. Only the owner of the lead
 * (or a colleague holding the CRM management permission) can write it — that is
 * decided by the database, not here.
 */
export async function saveLeadContact(leadId: string, input: LeadContactInput): Promise<void> {
  const name = input.contactName.trim();
  if (name.length < 2) throw new Error("Enter the contact person's name.");
  if (contactPerson(name) === null) throw new Error("Enter a real name rather than a placeholder.");

  const patch: Record<string, string | null> = { contact_name: name };
  if (input.contactEmail !== undefined) patch.contact_email = input.contactEmail?.trim() || null;
  if (input.contactPhone !== undefined) patch.contact_phone = input.contactPhone?.trim() || null;

  const { error } = await untypedDb.from("sales_leads").update(patch).eq("id", leadId);
  if (error) throw new Error(error.message);
}
