/**
 * Staff security audit feed.
 *
 * Read-only consolidation of two authoritative server-side trails:
 *  • `admin_login_events` — authentication outcomes (written only by the
 *    server-side `record_login_event` routine, so it cannot be forged).
 *  • `admin_audit_log`    — privileged mutations, including role grants and
 *    revocations stamped by the `user_roles` audit trigger.
 *
 * Both tables are readable only by admin / super_admin / compliance_admin at
 * the RLS layer; this module never widens that boundary.
 */
import { untypedDb } from "@/integrations/supabase/untyped";

export type AuditEventKind =
  | "login_success"
  | "login_failure"
  | "role_change"
  | "permission_change"
  | "policy_change"
  | "portal_transition";

export const AUDIT_EVENT_LABEL: Record<AuditEventKind, string> = {
  login_success: "Login success",
  login_failure: "Login failure",
  role_change: "Role change",
  permission_change: "Permission change",
  policy_change: "Security policy change",
  portal_transition: "Portal transition",
};

export interface StaffAuditEvent {
  id: string;
  at: string;
  kind: AuditEventKind;
  /** Email of the person who caused the event. */
  actorEmail: string | null;
  /** Who/what the event was applied to (target user, role, resource). */
  subject: string | null;
  detail: string | null;
  source: "admin_login_events" | "admin_audit_log" | "portal_transition_audit";
}

const db = untypedDb;

function classifyAction(action: string): AuditEventKind | null {
  const a = action.toLowerCase();
  if (a.startsWith("user_roles.")) return "role_change";
  // Security-policy surface: RLS policy edits, grant guards, allowlist changes.
  if (a.includes("policy") || a.includes("rls") || a.includes("allowlist") || a.includes("security_definer")) {
    return "policy_change";
  }
  if (a.includes("permission") || a.includes("grant") || a.includes("entitlement")) {
    return "permission_change";
  }
  return null;
}

/** Newest-first merged feed of the four audited event kinds. */
export async function fetchStaffAuditEvents(limit = 100): Promise<StaffAuditEvent[]> {
  const [logins, mutations, portal] = await Promise.all([
    db
      .from("admin_login_events")
      .select("id, created_at, email, event_type, reason, decision, risk_score, browser, operating_system")
      .in("event_type", ["login_success", "login_failure"])
      .order("created_at", { ascending: false })
      .limit(limit),
    db
      .from("admin_audit_log")
      .select("id, created_at, actor_email, actor_id, action, resource_id, metadata")
      .order("created_at", { ascending: false })
      .limit(limit * 2),
    db
      .from("portal_transition_audit")
      .select("id, created_at, actor_email, kind, previous_route, new_route, previous_context, new_context, remembered")
      .order("created_at", { ascending: false })
      .limit(limit),
  ]);

  if (logins.error) throw new Error(logins.error.message);
  if (mutations.error) throw new Error(mutations.error.message);

  const events: StaffAuditEvent[] = [];

  for (const r of logins.data ?? []) {
    events.push({
      id: `login:${r.id}`,
      at: r.created_at,
      kind: r.event_type === "login_success" ? "login_success" : "login_failure",
      actorEmail: r.email ?? null,
      subject: [r.browser, r.operating_system].filter(Boolean).join(" · ") || null,
      detail:
        r.event_type === "login_failure"
          ? (r.reason ?? "Authentication rejected")
          : `Decision ${r.decision} · risk ${r.risk_score}`,
      source: "admin_login_events",
    });
  }

  for (const r of mutations.data ?? []) {
    const kind = classifyAction(String(r.action ?? ""));
    if (!kind) continue;
    const md = (r.metadata ?? {}) as Record<string, unknown>;
    const role = md.role ?? md.requested_role ?? null;
    events.push({
      id: `audit:${r.id}`,
      at: r.created_at,
      kind,
      actorEmail: r.actor_email ?? r.actor_id ?? null,
      subject: String(md.target_user_id ?? r.resource_id ?? "—"),
      detail: [String(r.action), role ? `role “${String(role)}”` : null].filter(Boolean).join(" · "),
      source: "admin_audit_log",
    });
  }

  // Portal switches and post-login redirects (user id, old/new route, timestamp).
  for (const r of portal.data ?? []) {
    events.push({
      id: `portal:${r.id}`,
      at: r.created_at,
      kind: "portal_transition",
      actorEmail: r.actor_email ?? null,
      subject: `${r.previous_route || "—"} → ${r.new_route}`,
      detail: [
        String(r.kind).replace(/_/g, " "),
        r.new_context ? `context ${r.previous_context ?? "—"} → ${r.new_context}` : null,
        r.remembered ? "remembered portal" : null,
      ].filter(Boolean).join(" · "),
      source: "portal_transition_audit",
    });
  }

  return events
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, limit * 2);
}
