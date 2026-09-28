/**
 * TaxiD PARTNERS 360 — fine-grained staff permissions.
 *
 * The authority lives in the database: `partner_permissions()` resolves the
 * signed-in user's staff standing and whether their role may revert a partner to
 * an earlier intent/profile state (super admin, admin, director, general
 * manager). `partner_profile_revert` re-checks the same rule server-side, so this
 * hook only decides what the UI offers — it can never grant access.
 */
import { useEffect, useState } from "react";
import { untypedDb } from "@/integrations/supabase/untyped";

export interface PartnerPermissions {
  isStaff: boolean;
  canRevertProfile: boolean;
}

export const NO_PARTNER_PERMISSIONS: PartnerPermissions = {
  isStaff: false,
  canRevertProfile: false,
};

export async function fetchPartnerPermissions(): Promise<PartnerPermissions> {
  try {
     
    const { data, error } = await untypedDb.rpc("partner_permissions");
    if (error) return NO_PARTNER_PERMISSIONS;
    const row = (data ?? {}) as Record<string, unknown>;
    return {
      isStaff: row.is_staff === true,
      canRevertProfile: row.can_revert_profile === true,
    };
  } catch {
    return NO_PARTNER_PERMISSIONS;
  }
}

/** Resolved once per mount; `loading` keeps privileged controls hidden until known. */
export function usePartnerPermissions(): PartnerPermissions & { loading: boolean } {
  const [state, setState] = useState<PartnerPermissions>(NO_PARTNER_PERMISSIONS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    void fetchPartnerPermissions().then((p) => {
      if (!live) return;
      setState(p);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, []);

  return { ...state, loading };
}

/** Operator-readable explanation for a refused revert. */
export const REVERT_DENIAL_REASON: Record<string, string> = {
  not_authorised: "Partner desk authorisation is required to change a partner profile.",
  revert_not_permitted:
    "Reverting a partner to an earlier intent state is restricted to super admin, admin, director and general manager roles.",
  history_not_found: "That captured state no longer exists.",
};
