import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";
import { authzLog } from "@/lib/authzLog";
import { setAuthPresence } from "@/lib/authPresenceCookie";

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [roles, setRoles] = useState<string[]>([]);
  const [rolesLoading, setRolesLoading] = useState(true);
  const [rolesError, setRolesError] = useState<string | null>(null);

  const fetchRoles = useCallback(async (u: User | null) => {
    if (!u) {
      setRoles([]);
      setRolesError(null);
      setRolesLoading(false);
      return;
    }
    setRolesLoading(true);
    try {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", u.id);
      const fetched = data?.map((r) => r.role) ?? [];
      authzLog("roles_fetched", {
        user_id: u.id,
        email: u.email,
        roles: fetched,
        error: error?.message ?? null,
      });
      setRoles(fetched);
      setRolesError(error?.message ?? null);
    } catch (e) {
      // A thrown (network) failure must never leave guards stuck on a skeleton:
      // surface the error and fall through to rolesLoading=false.
      const message = e instanceof Error ? e.message : "Role lookup failed";
      authzLog("roles_fetched", { user_id: u.id, email: u.email, roles: [], error: message });
      setRoles([]);
      setRolesError(message);
    } finally {
      setRolesLoading(false);
    }
  }, []);

  /** Manually re-fetch roles (e.g. right after sign-in or role grant). */
  const refreshRoles = useCallback(async () => {
    const { data } = await supabase.auth.getUser();
    setUser(data.user ?? null);
    await fetchRoles(data.user ?? null);
  }, [fetchRoles]);

  useEffect(() => {
    // Deferred role re-fetches are tracked so unmount cancels them instead of
    // firing setState on a torn-down consumer.
    const timers = new Set<ReturnType<typeof setTimeout>>();

    // The stored session is read LOCALLY first. getUser() calls the auth server,
    // so on a flaky mobile connection it fails and a perfectly valid session
    // looked "signed out" — which bounced people back to the login screen
    // seconds after signing in. getSession() never depends on the network;
    // the token itself is still verified server-side on every data request.
    supabase.auth.getSession().then(({ data, error }) => {
      const u = !error && data.session?.user ? data.session.user : null;
      setUser(u);
      // Mirror session presence for the server-side charter portal guard.
      setAuthPresence(!!u);
      setAuthLoading(false);
      // Fire-and-forget; keeps roles in sync with the restored session.
      void fetchRoles(u);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      authzLog("auth_event", { event, user_id: session?.user?.id ?? null, email: session?.user?.email ?? null });
      setUser(session?.user ?? null);
      setAuthPresence(!!session?.user);
      if (!session?.user) {
        setRoles([]);
        setRolesError(null);
        setRolesLoading(false);
      } else if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
        // Automatic role re-fetch so fresh grants (e.g. super_admin) are
        // recognized immediately after sign-in — no manual reload needed.
        // Deferred to avoid deadlocks inside onAuthStateChange.
        const t = setTimeout(() => {
          timers.delete(t);
          void fetchRoles(session.user);
        }, 0);
        timers.add(t);
      }
    });

    return () => {
      timers.forEach(clearTimeout);
      timers.clear();
      listener.subscription.unsubscribe();
    };
  }, [fetchRoles]);

  // Guards must wait until BOTH the session AND role query have resolved,
  // otherwise a signed-in admin briefly renders with roles=[] and gets
  // bounced to /unauthorized on first paint.
  const loading = authLoading || rolesLoading;

  const isAdmin = roles.includes("admin");
  const isSuperAdmin = roles.includes("super_admin");
  const isFinanceAdmin = roles.includes("finance_admin");
  const isAnyAdmin = isAdmin || isSuperAdmin || isFinanceAdmin;
  const isDriver = roles.includes("driver");
  const isRider = roles.includes("rider");
  const isCorporateAdmin = roles.includes("corporate_admin");
  const isCorporateEmployee = roles.includes("corporate_employee");

  return {
    user,
    loading,
    authLoading,
    rolesLoading,
    rolesError,
    roles,
    refreshRoles,
    isAdmin,
    isSuperAdmin,
    isFinanceAdmin,
    isAnyAdmin,
    isDriver,
    isRider,
    isCorporateAdmin,
    isCorporateEmployee,
  };
}
