/**
 * Versioned itinerary PDF templates.
 *
 * Branding (logo, address, contacts) and the template version live server-side
 * in `charter_pdf_templates`, so a future redesign publishes a new version
 * instead of mutating the one that historic PDFs were printed from. Every
 * generated document stamps its template version, which keeps the audit trail
 * of previously issued PDFs reproducible.
 */
import { untypedDb } from "@/integrations/supabase/untyped";

export interface PdfBranding {
  name: string;
  division: string;
  address: string;
  phone: string;
  email: string;
  web: string;
  logo_url?: string | null;
}

export interface PdfTemplate {
  id: string;
  version: string;
  label: string;
  active: boolean;
  brand: PdfBranding;
  layout: Record<string, unknown>;
  notes: string | null;
  created_at: string;
}

export const FALLBACK_BRANDING: PdfBranding = {
  name: "SAFARID",
  division: "SAFARID Air · Charter, Leasing & Rentals",
  address: "Nairobi, Kenya",
  phone: "+254 142 970050",
  email: "support@yalla.africa",
  web: "yalla.africa",
  logo_url: null,
};

export const FALLBACK_TEMPLATE: PdfTemplate = {
  id: "fallback",
  version: "v1",
  label: "SAFARID Air secure itinerary v1",
  active: true,
  brand: FALLBACK_BRANDING,
  layout: {},
  notes: null,
  created_at: new Date(0).toISOString(),
};

const db = untypedDb;

/** Active template; falls back to the built-in v1 branding when unavailable. */
export async function fetchActivePdfTemplate(): Promise<PdfTemplate> {
  try {
    const { data } = await db
      .from("charter_pdf_templates")
      .select("*")
      .eq("active", true)
      .maybeSingle();
    if (!data) return FALLBACK_TEMPLATE;
    return { ...FALLBACK_TEMPLATE, ...data, brand: { ...FALLBACK_BRANDING, ...(data.brand ?? {}) } };
  } catch {
    return FALLBACK_TEMPLATE;
  }
}

export async function listPdfTemplates(): Promise<PdfTemplate[]> {
  const { data } = await db
    .from("charter_pdf_templates")
    .select("*")
    .order("created_at", { ascending: false });
  return (data ?? []).map((t: PdfTemplate) => ({
    ...t,
    brand: { ...FALLBACK_BRANDING, ...(t.brand ?? {}) },
  }));
}
