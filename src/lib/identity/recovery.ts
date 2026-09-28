/**
 * ACCOUNT RECOVERY.
 *
 * The server decides whether a recovery email may be requested at all: attempts
 * are counted and refused per address, and every request is appended to an
 * immutable ledger. The answer returned to the browser is the same shape whether
 * or not an account exists, so recovery cannot be used to discover accounts.
 *
 * Recovery only ever sets a password. It never grants a role, changes an email
 * or moves an account between organisations — those paths do not exist here.
 */
import { supabase } from "@/integrations/supabase/client";
import { untypedDb } from "@/integrations/supabase/untyped";

export interface RecoveryOutcome {
  outcome: "ACCEPTED" | "RATE_LIMITED" | "INVALID_EMAIL";
  /** Wording safe to show: never confirms or denies that an account exists. */
  message: string;
}

const MESSAGE: Record<RecoveryOutcome["outcome"], string> = {
  ACCEPTED:
    "If an account exists for that address, a password reset link is on its way. The link expires shortly — request a new one if it does.",
  RATE_LIMITED:
    "Too many reset requests for that address in the last hour. Wait an hour and try again, or contact support@taxid.us.",
  INVALID_EMAIL: "That does not look like an email address. Check it and try again.",
};

export async function requestRecovery(rawEmail: string): Promise<RecoveryOutcome> {
  const email = rawEmail.trim().toLowerCase();

  const { data, error } = await untypedDb.rpc("identity_recovery_begin", { _email: email });
  if (error) {
    return { outcome: "ACCEPTED", message: MESSAGE.ACCEPTED };
  }
  const row = (data ?? {}) as { outcome?: RecoveryOutcome["outcome"]; allowed?: boolean };
  const outcome = row.outcome ?? "ACCEPTED";

  if (row.allowed) {
    // The auth server decides whether an email is actually sent; we never learn.
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
  }

  return { outcome, message: MESSAGE[outcome] ?? MESSAGE.ACCEPTED };
}
