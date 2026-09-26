/**
 * Reconciliation finance RBAC.
 *
 * Permissions are resolved server-side by `public.has_recon_permission`
 * against the `recon_permission_roles` matrix — the client never decides
 * who may export, rerun, resolve or reverse. The hook below only mirrors
 * the server answer so the UI can disable controls the user cannot use.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const RECON_PERMISSIONS = [
  "recon.export",
  "recon.rerun",
  "recon.resolve",
  "recon.reverse",
  "recon.alerts.manage",
  "ops.cron.monitor",
] as const;

export type ReconPermission = (typeof RECON_PERMISSIONS)[number];

export type ReconPermissionMap = Record<ReconPermission, boolean>;

export const NO_RECON_PERMISSIONS: ReconPermissionMap = {
  "recon.export": false,
  "recon.rerun": false,
  "recon.resolve": false,
  "recon.reverse": false,
  "recon.alerts.manage": false,
  "ops.cron.monitor": false,
};

export const RECON_PERMISSION_LABEL: Record<ReconPermission, string> = {
  "recon.export": "Export findings",
  "recon.rerun": "Trigger reruns",
  "recon.resolve": "Acknowledge & resolve findings",
  "recon.reverse": "Confirm reversal ledger entries",
  "recon.alerts.manage": "Manage alert routing",
  "ops.cron.monitor": "Monitor scheduled jobs",
};

/** Message shown when a control is blocked by the permission matrix. */
export function reconDeniedReason(perm: ReconPermission): string {
  return `Your finance role does not include “${RECON_PERMISSION_LABEL[perm]}”. Ask a super admin to grant ${perm}.`;
}

export async function fetchReconPermissions(): Promise<ReconPermissionMap> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth?.user?.id;
  if (!userId) return { ...NO_RECON_PERMISSIONS };

  const results = await Promise.all(
    RECON_PERMISSIONS.map(async (perm) => {
      const { data, error } = await supabase.rpc("has_recon_permission", {
        _user_id: userId,
        _perm: perm,
      } as never);
      if (error) return [perm, false] as const;
      return [perm, data === true] as const;
    }),
  );

  return results.reduce<ReconPermissionMap>(
    (acc, [perm, allowed]) => ({ ...acc, [perm]: allowed }),
    { ...NO_RECON_PERMISSIONS },
  );
}

export function useReconPermissions() {
  const [permissions, setPermissions] = useState<ReconPermissionMap>(NO_RECON_PERMISSIONS);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setPermissions(await fetchReconPermissions());
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const can = useCallback(
    (perm: ReconPermission) => permissions[perm] === true,
    [permissions],
  );

  return { permissions, loading, can, refresh };
}
