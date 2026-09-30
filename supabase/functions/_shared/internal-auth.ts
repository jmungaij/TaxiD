// Shared guard for system-only edge functions triggered by cron or by other
// trusted server-side callers. Requires the caller to present a shared secret
// (INTERNAL_JOB_SECRET) in the `x-internal-secret` header, OR to present the
// service-role JWT in the Authorization header.
//
// Fails closed: if INTERNAL_JOB_SECRET is not configured, all callers are
// rejected — no accidental "open" mode.
import { createClient } from "npm:@supabase/supabase-js@2";
import { HttpError } from "./framework.ts";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

export function requireInternalCaller(req: Request): void {
  const expected = Deno.env.get("INTERNAL_JOB_SECRET") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  const provided = req.headers.get("x-internal-secret") ?? "";
  if (expected && provided && timingSafeEqual(provided, expected)) return;

  // Accept service-role bearer as an alternative trust anchor for internal
  // callers that already have privileged credentials (e.g. other functions).
  const authz = req.headers.get("authorization") ?? "";
  if (serviceRoleKey && authz.toLowerCase().startsWith("bearer ")) {
    const token = authz.slice(7).trim();
    if (timingSafeEqual(token, serviceRoleKey)) return;
  }

  throw new HttpError(401, "Internal caller required", "UNAUTHORIZED");
}

export interface CallerIdentity {
  /** "internal" — cron/service-role caller; "staff" — authenticated staff user. */
  kind: "internal" | "staff";
  /** Verified auth user id for staff callers (null for internal callers). */
  userId: string | null;
}

/**
 * Dual-trust guard for functions that are invoked BOTH by pg_cron/other
 * functions AND by a "run now" button in a staff console:
 *   1. internal callers — x-internal-secret or the service-role bearer, OR
 *   2. staff callers    — a verified user JWT whose user_roles intersect
 *      `allowedRoles`.
 *
 * The staff branch verifies the JWT against the auth server and reads roles
 * with the service client, so client-supplied role claims are never trusted.
 * Fails closed with 401 (unauthenticated) or 403 (wrong role).
 */
export async function requireInternalOrStaff(
  req: Request,
  allowedRoles: readonly string[],
): Promise<CallerIdentity> {
  try {
    requireInternalCaller(req);
    return { kind: "internal", userId: null };
  } catch { /* fall through to the staff branch */ }

  const authz = req.headers.get("authorization") ?? "";
  if (authz.toLowerCase().startsWith("bearer ")) {
    const token = authz.slice(7).trim();
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (url && anonKey && serviceKey && token) {
      const userClient = createClient(url, anonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: { user } } = await userClient.auth.getUser();
      if (user) {
        const admin = createClient(url, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data: roles } = await admin
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id);
        const held = new Set((roles ?? []).map((r: { role: string }) => r.role));
        if (allowedRoles.some((r) => held.has(r))) {
          return { kind: "staff", userId: user.id };
        }
        throw new HttpError(403, "Insufficient role for this internal function", "FORBIDDEN");
      }
    }
  }

  throw new HttpError(401, "Internal caller required", "UNAUTHORIZED");
}
