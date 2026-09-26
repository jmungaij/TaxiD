/**
 * Candidate remediation centre + compatibility-block notification.
 *
 * When our own platform stops a candidate (stale bundle, contract
 * incompatibility, infrastructure fault), the candidate's work is preserved in
 * a remediation case and they receive a message containing a private
 * continuation token. `/careers/continue?token=…` is the only way that case can
 * be read: there is deliberately no lookup by email, so nobody can enumerate
 * other people's applications.
 */
import { supabase } from "@/integrations/supabase/client";
import { careersClientIdentity } from "./careersContract";
import type { ApplicationDocumentRef } from "./publicApi";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/** Path the candidate returns to. Also the entry-contract evidence for the route. */
export const CONTINUE_PATH = "/careers/continue";
export const continueUrl = (token: string): string => `${CONTINUE_PATH}?token=${token}`;

export interface RemediationCase {
  found: boolean;
  case_id?: string;
  email?: string;
  vacancy_slug?: string | null;
  vacancy_title?: string | null;
  vacancy_open?: boolean;
  cause?: string;
  error_code?: string | null;
  status?: string;
  missing?: string[];
  documents_preserved?: ApplicationDocumentRef[];
  attempt_count?: number;
  first_failed_at?: string;
  last_failed_at?: string;
  completed_at?: string | null;
}

export async function fetchRemediationCase(token: string): Promise<RemediationCase> {
  const { data, error } = await db.rpc("rec_public_remediation_case", { p_token: token });
  if (error) throw new Error(error.message);
  const row = (data ?? { found: false }) as RemediationCase;
  return {
    ...row,
    missing: Array.isArray(row.missing) ? row.missing : [],
    documents_preserved: Array.isArray(row.documents_preserved) ? row.documents_preserved : [],
  };
}

/** Marks the case as resumed the moment the candidate opens their saved application. */
export async function markRemediationResumed(token: string): Promise<void> {
  try {
    await db.rpc("rec_public_remediation_resume", { p_token: token });
  } catch {
    /* resumption telemetry must never block the candidate */
  }
}

export interface CompatibilityNotice {
  queued: boolean;
  reason?: string;
  continue_url?: string;
  continue_token?: string;
  remediation_case_id?: string;
  email_sent?: boolean;
}

/**
 * Queues (and, when the transport is configured, sends) the candidate message
 * for a compatibility block: their saved application plus the steps to
 * continue. Fire-and-forget from the candidate's point of view — a mail
 * transport problem must never add a second failure to their experience.
 */
export async function notifyCompatibilityBlock(args: {
  slug: string | null;
  email: string;
  verdict: string;
  reason?: string | null;
  documents?: ApplicationDocumentRef[];
}): Promise<CompatibilityNotice> {
  const client = careersClientIdentity();
  const payload = {
    slug: args.slug,
    email: args.email,
    verdict: args.verdict,
    reason: args.reason ?? null,
    build_id: client.build_id,
    session_ref: client.session_ref,
    documents: args.documents ?? [],
  };
  try {
    const { data, error } = await supabase.functions.invoke("careers-candidate-notify", {
      body: payload,
    });
    if (error) throw new Error(error.message);
    return (data ?? { queued: false }) as CompatibilityNotice;
  } catch {
    // Transport unavailable: still record the case so staff and the candidate's
    // own continuation link exist.
    try {
      const { data } = await db.rpc("rec_notify_compatibility_block", {
        p_slug: payload.slug,
        p_email: payload.email,
        p_verdict: payload.verdict,
        p_reason: payload.reason,
        p_build_id: payload.build_id,
        p_session_ref: payload.session_ref,
        p_documents: payload.documents,
      });
      return { ...(data ?? { queued: false }), email_sent: false } as CompatibilityNotice;
    } catch {
      return { queued: false, reason: "unavailable" };
    }
  }
}

export function remediationCauseCopy(cause: string | undefined): { title: string; detail: string } {
  if (cause === "SYSTEM_REMEDIATION_REQUIRED") {
    return {
      title: "We stopped your application, you did nothing wrong",
      detail:
        "A compatibility or infrastructure fault on our side interrupted your submission. Everything you entered has been kept.",
    };
  }
  return {
    title: "Your application is saved and needs a few more items",
    detail: "Complete the outstanding requirements below and submit — nothing you uploaded has been lost.",
  };
}
