import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

/**
 * Password-reset links can land on any page (e.g. /auth when the redirect URL
 * falls back). Without this, the sign-in page treats the recovery session as a
 * normal login and the new password is never set. Always route recovery
 * sessions to /reset-password.
 */
export function RecoveryRedirect() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const hash = window.location.hash;
    if (/(^|[#&])type=recovery(&|$)/.test(hash) && location.pathname !== "/reset-password") {
      navigate(`/reset-password${hash}`, { replace: true });
    }
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" && window.location.pathname !== "/reset-password") {
        try { sessionStorage.setItem("taxid.recovery", "1"); } catch { /* ignore */ }
        navigate("/reset-password", { replace: true });
      }
    });
    return () => data.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
