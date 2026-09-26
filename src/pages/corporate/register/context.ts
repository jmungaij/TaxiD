import { createContext, useContext } from "react";
import type { Draft } from "./useRegistrationDraft";

export interface RegistrationDraftContextValue {
  draft: Draft | null;
  loading: boolean;
  saving: boolean;
  lastSavedAt: Date | null;
  save: (patch: Partial<Pick<Draft, "current_step" | "completed_steps" | "business_registration_type" | "personal_info" | "business_info" | "documents">>) => Promise<Draft>;
  submit: () => Promise<{ ok: boolean; id: string; already_submitted?: boolean; submission?: { id: string; status: string; decision: string | null; submitted_at: string | null } }>;
}

export const RegistrationDraftContext = createContext<RegistrationDraftContextValue | null>(null);

export function useDraftCtx(): RegistrationDraftContextValue {
  const v = useContext(RegistrationDraftContext);
  if (!v) throw new Error("useDraftCtx must be used inside RegisterWizardLayout");
  return v;
}
