/**
 * SECOND FACTOR (time-based one-time codes).
 *
 * Enrolment, verification and removal all happen on the auth server. The
 * browser holds no secret beyond the moment of enrolment and cannot mark itself
 * verified: the assurance level of the session is decided server-side and the
 * only way to raise it is a correct code.
 *
 * Every action is recorded on the account's own activity trail through
 * identity_record_mfa_event, so the Security Centre shows the real history.
 */
import { supabase } from "@/integrations/supabase/client";
import { untypedDb } from "@/integrations/supabase/untyped";

export type MfaEvent =
  | "mfa_enrolled"
  | "mfa_verified"
  | "mfa_failed"
  | "mfa_removed"
  | "step_up_verified"
  | "step_up_failed";

async function record(event: MfaEvent, success = true, reason?: string) {
  try {
    await untypedDb.rpc("identity_record_mfa_event", {
      _event_type: event,
      _method: "totp",
      _success: success,
      _reason: reason ?? null,
    });
  } catch {
    /* activity recording must never block the security action itself */
  }
}

export interface MfaFactor {
  id: string;
  friendlyName: string | null;
  status: "verified" | "unverified";
  createdAt: string | null;
}

export interface MfaState {
  factors: MfaFactor[];
  /** A verified factor exists on this account. */
  enrolled: boolean;
  /** The current session has already satisfied the second factor. */
  sessionVerified: boolean;
  /** The session must satisfy a second factor before privileged use. */
  stepUpRequired: boolean;
}

export async function loadMfaState(): Promise<MfaState> {
  const { data, error } = await supabase.auth.mfa.listFactors();
  const factors: MfaFactor[] = error
    ? []
    : [...(data?.totp ?? []), ...((data?.all ?? []).filter((f) => f.factor_type !== "totp"))].map(
        (f) => ({
          id: f.id,
          friendlyName: f.friendly_name ?? null,
          status: (f.status as MfaFactor["status"]) ?? "unverified",
          createdAt: f.created_at ?? null,
        }),
      );

  const levels = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const current = levels.data?.currentLevel ?? null;
  const next = levels.data?.nextLevel ?? null;

  return {
    factors,
    enrolled: factors.some((f) => f.status === "verified"),
    sessionVerified: current === "aal2",
    stepUpRequired: Boolean(next === "aal2" && current !== "aal2"),
  };
}

export interface EnrolmentStart {
  factorId: string;
  qrSvg: string | null;
  secret: string | null;
  uri: string | null;
}

/** Starts enrolment; the factor stays unverified until a code is confirmed. */
export async function startEnrolment(friendlyName = "Authenticator app"): Promise<EnrolmentStart> {
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `${friendlyName} · ${new Date().toISOString().slice(0, 10)}`,
  });
  if (error) throw new Error(error.message);
  return {
    factorId: data.id,
    qrSvg: data.totp?.qr_code ?? null,
    secret: data.totp?.secret ?? null,
    uri: data.totp?.uri ?? null,
  };
}

/** Confirms enrolment (or raises an existing session) with a one-time code. */
export async function verifyCode(factorId: string, code: string, kind: "enrol" | "step_up") {
  const challenge = await supabase.auth.mfa.challenge({ factorId });
  if (challenge.error) {
    await record(kind === "enrol" ? "mfa_failed" : "step_up_failed", false, challenge.error.message);
    throw new Error(challenge.error.message);
  }
  const verify = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.data.id,
    code: code.replace(/\s+/g, ""),
  });
  if (verify.error) {
    await record(kind === "enrol" ? "mfa_failed" : "step_up_failed", false, verify.error.message);
    throw new Error(
      /invalid/i.test(verify.error.message)
        ? "That code was not accepted. Codes change every 30 seconds — try the current one."
        : verify.error.message,
    );
  }
  await record(kind === "enrol" ? "mfa_enrolled" : "step_up_verified");
}

export async function removeFactor(factorId: string) {
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) throw new Error(error.message);
  await record("mfa_removed");
}

/** The factor to challenge for a step-up, if any. */
export function challengeableFactor(state: MfaState): MfaFactor | null {
  return state.factors.find((f) => f.status === "verified") ?? null;
}
