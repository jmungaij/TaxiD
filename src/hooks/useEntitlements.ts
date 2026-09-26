import { useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { entitlementsFromRoles, type Entitlements } from "@/lib/platform/entitlements";

/**
 * Tier + entitlement view of the signed-in user, derived from server-granted
 * roles. Use for hiding/disabling premium navigation and gating tier pages.
 */
export function useEntitlements(): Entitlements & { loading: boolean } {
  const { roles, loading } = useAuth();
  const entitlements = useMemo(() => entitlementsFromRoles(roles), [roles]);
  return { ...entitlements, loading };
}
