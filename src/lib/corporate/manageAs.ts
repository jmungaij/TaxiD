/**
 * "Manage as corporate" — scoped, time-boxed admin sessions.
 *
 * The session itself is created and closed server-side by the
 * `corporate-admin-console` edge function (which authorises the caller and
 * writes the audit row). This module only mirrors the active session in the
 * browser so surfaces can show the pinned banner and tag their writes.
 *
 * No role or permission is ever derived from this cache — it is presentation
 * state only. Expired sessions are treated as absent.
 */
import { supabase } from "@/integrations/supabase/client";

export interface ManageAsSession {
  id: string;
  corporate_id: string;
  corporate_name: string;
  started_at: string;
  expires_at: string;
}

const STORAGE_KEY = "yalla.corporate.manage_as";

export function isSessionLive(session: ManageAsSession | null, now: Date = new Date()): boolean {
  if (!session) return false;
  const expires = Date.parse(session.expires_at);
  if (Number.isNaN(expires)) return false;
  return expires > now.getTime();
}

export function readManageAsSession(now: Date = new Date()): ManageAsSession | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ManageAsSession;
    if (!parsed?.id || !parsed?.corporate_id) return null;
    if (!isSessionLive(parsed, now)) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeManageAsSession(session: ManageAsSession | null) {
  try {
    if (session) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else window.localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new CustomEvent("yalla:manage-as-changed"));
  } catch {
    /* storage unavailable — banner simply will not persist across reloads */
  }
}

async function callConsole<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("corporate-admin-console", { body });
  if (error) throw new Error(error.message);
  const payload = data as { ok?: boolean; error?: { message?: string } } & T;
  if (payload && payload.ok === false) {
    throw new Error(payload.error?.message ?? "Request failed");
  }
  return payload as T;
}

export async function startManageAs(corporateId: string, reason?: string): Promise<ManageAsSession> {
  const res = await callConsole<{ session: ManageAsSession }>({
    op: "start_manage_as",
    corporate_id: corporateId,
    ...(reason ? { reason } : {}),
  });
  writeManageAsSession(res.session);
  return res.session;
}

export async function endManageAs(sessionId?: string): Promise<void> {
  const active = sessionId ?? readManageAsSession()?.id;
  writeManageAsSession(null);
  if (!active) return;
  await callConsole({ op: "end_manage_as", session_id: active });
}

export { callConsole as invokeCorporateConsole };
