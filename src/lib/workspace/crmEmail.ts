/**
 * STAGE 10 — EMAIL → CRM.
 *
 * Opening an email in the workspace records it as a CRM interaction through
 * `crm_log_email_interaction`. The server checks the reader is allowed to see
 * that email, matches the account from the sender address or company domain and
 * stores one record per email — the browser never writes the CRM row itself.
 */
import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface EmailCrmRecord {
  interactionId: string;
  created: boolean;
  /** True when the sender was matched to a customer account. */
  matched: boolean;
  error: string | null;
}

export async function logEmailToCrm(messageId: string): Promise<EmailCrmRecord> {
  const { data, error } = await db.rpc("crm_log_email_interaction", { p_message_id: messageId });
  if (error)
    return { interactionId: "", created: false, matched: false, error: error.message };
  const row = (data ?? {}) as { interaction_id?: string; created?: boolean; matched?: boolean };
  return {
    interactionId: String(row.interaction_id ?? ""),
    created: Boolean(row.created),
    matched: Boolean(row.matched),
    error: null,
  };
}

/** Records every message of an opened conversation, oldest first. */
export async function logThreadToCrm(messageIds: string[]): Promise<{ recorded: number; matched: number; error: string | null }> {
  let recorded = 0;
  let matched = 0;
  let error: string | null = null;
  for (const id of messageIds) {
    const result = await logEmailToCrm(id);
    if (result.error) {
      error = result.error;
      break;
    }
    if (result.created) recorded += 1;
    if (result.matched) matched += 1;
  }
  return { recorded, matched, error };
}
