/**
 * Server-authoritative operating-context resolution and switching.
 *
 * The browser NEVER decides authority. `resolve_operating_contexts()` reads the
 * caller's roles from `user_roles` (SECURITY DEFINER, keyed on auth.uid()) and
 * returns the contexts that identity may enter plus its organisation and
 * resolved role for the header indicator. `switch_operating_context()` re-checks
 * the same authority server-side and writes an immutable audit row for every
 * attempt — allowed or denied.
 */
import { supabase } from "@/integrations/supabase/client";
import type { OperatingContextKey } from "./operatingContexts";

export interface ResolvedIdentity {
  authenticated: boolean;
  user_id?: string;
  identity?: string | null;
  roles: string[];
  contexts: OperatingContextKey[];
  organisation_id?: string | null;
  organisation?: string | null;
  unit?: string | null;
  position?: string | null;
  resolved_role?: string | null;
}

const EMPTY: ResolvedIdentity = { authenticated: false, roles: [], contexts: [] };

/** Reads the authoritative identity/context envelope from the database. */
export async function resolveOperatingContexts(): Promise<ResolvedIdentity> {
  const { data, error } = await supabase.rpc("resolve_operating_contexts");
  if (error || !data) return EMPTY;
  const raw = data as Record<string, unknown>;
  return {
    authenticated: raw.authenticated === true,
    user_id: (raw.user_id as string) ?? undefined,
    identity: (raw.identity as string) ?? null,
    roles: Array.isArray(raw.roles) ? (raw.roles as string[]) : [],
    contexts: Array.isArray(raw.contexts) ? (raw.contexts as OperatingContextKey[]) : [],
    organisation_id: (raw.organisation_id as string) ?? null,
    organisation: (raw.organisation as string) ?? null,
    unit: (raw.unit as string) ?? null,
    position: (raw.position as string) ?? null,
    resolved_role: (raw.resolved_role as string) ?? null,
  };
}

export interface SwitchResult {
  ok: boolean;
  error?: string;
}

/**
 * Requests a context switch. Resolves `{ ok: true }` only when the server
 * authorised it; the audit record is written server-side either way.
 */
export async function requestContextSwitch(params: {
  next: OperatingContextKey;
  previous?: OperatingContextKey | null;
  correlationId?: string;
}): Promise<SwitchResult> {
  const { data: sess } = await supabase.auth.getSession();
  const { error } = await supabase.rpc("switch_operating_context", {
    _new_context: params.next,
    _previous_context: params.previous ?? null,
    _correlation_id: params.correlationId ?? crypto.randomUUID(),
    _session_id: sess.session?.access_token?.slice(-12) ?? null,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
