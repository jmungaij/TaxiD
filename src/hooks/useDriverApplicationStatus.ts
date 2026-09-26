/**
 * Read-only view of the signed-in user's existing driver onboarding draft.
 * Reuses the `driver_onboarding_drafts` table already written by
 * `OnboardingWizard` — no new business logic, no new tables.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface DriverApplicationStatus {
  loading: boolean;
  signedIn: boolean;
  /** 1..7 — same stage numbering as the onboarding wizard */
  stage: number;
  status: "NONE" | "DRAFT" | "SUBMITTED" | string;
  submittedAt: string | null;
  /** Locally cached (offline) draft exists even when signed out */
  hasLocalDraft: boolean;
}

const LOCAL_KEY = "yr_driver_onboarding_draft";

export function useDriverApplicationStatus(): DriverApplicationStatus {
  const [state, setState] = useState<DriverApplicationStatus>({
    loading: true,
    signedIn: false,
    stage: 1,
    status: "NONE",
    submittedAt: null,
    hasLocalDraft: false,
  });

  useEffect(() => {
    let alive = true;
    let localStage = 1;
    let hasLocalDraft = false;
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        hasLocalDraft = !!parsed?.data;
        if (parsed?.stage) localStage = Number(parsed.stage) || 1;
      }
    } catch { /* noop */ }

    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!alive) return;
      if (!user) {
        setState({ loading: false, signedIn: false, stage: localStage, status: hasLocalDraft ? "DRAFT" : "NONE", submittedAt: null, hasLocalDraft });
        return;
      }
      const { data } = await supabase
        .from("driver_onboarding_drafts")
        .select("current_stage,status,submitted_at")
        .eq("driver_id", user.id)
        .maybeSingle();
      if (!alive) return;
      setState({
        loading: false,
        signedIn: true,
        stage: data?.current_stage ?? localStage,
        status: (data?.status as string) ?? (hasLocalDraft ? "DRAFT" : "NONE"),
        submittedAt: data?.submitted_at ?? null,
        hasLocalDraft,
      });
    }).catch(() => {
      if (alive) setState((s) => ({ ...s, loading: false, hasLocalDraft, stage: localStage }));
    });

    return () => { alive = false; };
  }, []);

  return state;
}
