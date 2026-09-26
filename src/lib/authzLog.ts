/**
 * End-to-end authorization trace log.
 * Every auth event, role fetch, and route authorization check emits a
 * structured console entry (prefix "[AUTHZ]") and is kept in an in-memory
 * ring buffer readable from the /dashboard/admin/access-debug page.
 */
export interface AuthzEntry {
  ts: string;
  step: string;
  detail: Record<string, unknown>;
}

const buffer: AuthzEntry[] = [];
const MAX = 200;

export function authzLog(step: string, detail: Record<string, unknown>) {
  const entry: AuthzEntry = { ts: new Date().toISOString(), step, detail };
  buffer.push(entry);
  if (buffer.length > MAX) buffer.shift();
  // eslint-disable-next-line no-console
  console.info(`[AUTHZ] ${step}`, detail);
  window.dispatchEvent(new CustomEvent("authz-log", { detail: entry }));
}

export function getAuthzTrace(): AuthzEntry[] {
  return [...buffer];
}

/** Stable per-tab correlation id attached to authz trace exports. */
export const authzTraceCorrelationId: string =
  (globalThis.crypto?.randomUUID?.() ?? `authz-${Date.now()}`);
