// Shared types + hook + api for the Corporate Self-Registration Portal.
// Draft state is persisted through the corporate-registration-draft edge fn
// so anonymous applicants can resume later without an account (opaque
// session_key stored in localStorage).
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type BusinessRegistrationType = "limited_company" | "registered_business";

export interface PersonalInfo {
  title?: string;
  first_name?: string;
  middle_name?: string;
  last_name?: string;
  corporate_email?: string;
  personal_email?: string;
  corporate_phone?: string;
  personal_phone?: string;
  position?: string;
  department?: string;
  employee_number?: string;
  country?: string;
  county?: string;
  town?: string;
  street?: string;
  building?: string;
  floor?: string;
  office?: string;
  postal_code?: string;
  landmark?: string;
  latitude?: number;
  longitude?: number;
}

export interface BusinessInfo {
  registered_name?: string;
  trading_name?: string;
  registration_number?: string;         // Registered business
  certificate_of_incorporation_number?: string; // Limited company
  kra_pin?: string;
  vat_number?: string;
  category?: string;
  industry?: string;
  employees?: number;
  monthly_trips?: number;
  monthly_budget?: number;
  business_type?: string;
  county?: string;
  town?: string;
  street?: string;
  building?: string;
  floor?: string;
  office?: string;
  postal_address?: string;
}

export interface Documents {
  // Limited company
  certificate_of_incorporation?: DocRef;
  cr12?: DocRef;
  // Registered business
  single_business_permit?: DocRef;
  business_registration_certificate?: DocRef; // optional
  // Shared
  letter_of_authority?: DocRef;
  national_id_front?: DocRef;
  national_id_back?: DocRef;
  passport?: DocRef;
  kra_pin_certificate?: DocRef;
  company_logo?: DocRef;
}
export interface DocRef {
  name: string;
  size: number;
  mime: string;
  storage_path?: string;
  uploaded_at: string;
}

export interface Draft {
  id: string;
  session_key: string;
  status: "draft" | "submitted" | "abandoned";
  current_step: number;
  completed_steps: number[];
  business_registration_type: BusinessRegistrationType | null;
  personal_info: PersonalInfo;
  business_info: BusinessInfo;
  documents: Documents;
  updated_at: string;
}

const SESSION_KEY_STORAGE = "yalla.corp_reg.session_key";

function ensureSessionKey(): string {
  let k = localStorage.getItem(SESSION_KEY_STORAGE);
  if (!k) {
    k = (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)) +
        (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2));
    localStorage.setItem(SESSION_KEY_STORAGE, k);
  }
  return k;
}

async function callDraftApi<T>(op: "load" | "save" | "submit", extra: Record<string, unknown> = {}): Promise<T> {
  const session_key = ensureSessionKey();
  const { data, error } = await supabase.functions.invoke("corporate-registration-draft", {
    body: { op, session_key, ...extra },
  });
  if (error) throw error;
  return data as T;
}

export function useRegistrationDraft() {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await callDraftApi<{ draft: Draft | null }>("load");
        if (!cancelled) setDraft(res.draft);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const save = useCallback(async (patch: Partial<Pick<Draft, "current_step" | "completed_steps" | "business_registration_type" | "personal_info" | "business_info" | "documents">>) => {
    setSaving(true);
    const task = saveQueue.current.then(async () => {
      try {
        const res = await callDraftApi<{ draft: Draft; already_submitted?: boolean }>("save", { patch });
        // Server is idempotent: on an already-submitted draft it returns
        // already_submitted=true instead of REG-409. We reflect that in state
        // so the layout can redirect and the UI can show a banner.
        if (res.draft) setDraft(res.draft);
        setLastSavedAt(new Date());
        return res.draft;
      } catch (e: unknown) {
        // Defensive fallback for older backends that still throw REG-409.
        const msg = (e as { message?: string; context?: { body?: string } })?.message ?? "";
        const body = (e as { context?: { body?: string } })?.context?.body ?? "";
        if (msg.includes("REG-409") || body.includes("already_submitted") || msg.includes("409")) {
          return null as unknown as Draft;
        }
        throw e;
      } finally {
        setSaving(false);
      }
    });
    saveQueue.current = task.catch(() => {}); // don't break the chain on error
    return task;
  }, []);


  const submit = useCallback(async () => {
    return callDraftApi<{ ok: boolean; id: string; already_submitted?: boolean; submission?: { id: string; status: string; decision: string | null; submitted_at: string | null } }>("submit");
  }, []);

  return { draft, loading, saving, lastSavedAt, save, submit };
}

// Steps → route paths (allow resume-later via ?step=N or direct URL).
export const STEP_PATHS = ["personal", "business", "verification", "documents", "review"] as const;
export const STEP_LABELS: Record<number, string> = {
  1: "Personal Information",
  2: "Corporate Information",
  3: "Business Verification",
  4: "Document Upload",
  5: "Review & Submit",
};
