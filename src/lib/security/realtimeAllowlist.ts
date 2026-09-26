/**
 * Realtime broadcast allowlist.
 *
 * Only tables and channel names on this allowlist may be broadcast to browser
 * clients. Anything else is a governance violation: a table added to the
 * `supabase_realtime` publication (or a channel opened from the client) that is
 * not explicitly approved here must be treated as a security finding.
 *
 * Keep this list minimal and reviewed — every entry is a table whose rows are
 * pushed to subscribed clients, gated only by RLS.
 */

/** Tables approved for inclusion in the `supabase_realtime` publication. */
export const APPROVED_REALTIME_TABLES: readonly string[] = [
  // Delivery & logistics operations (RLS-scoped to assigned staff/partners)
  "delivery_orders",
  "delivery_dispatch_jobs",
  "proof_of_delivery",
  // Dispatch / marketplace surfaces
  "dispatch_requests",
  "dispatch_assignments",
  "dispatch_surge_zones",
  "marketplace_surge_multipliers",
  // Rider-facing trip surfaces (owner-scoped)
  "trip_bookings",
  "trip_status_history",
  "rider_notifications",
  // Corporate compliance notifications (tenant-scoped)
  "corporate_document_notifications",
  "corporate_ride_approvals",
  "corporate_ops_alert_events",
  "corporate_support_tickets",
  "corporate_support_ticket_notes",
  // Charter operations (operator/staff scoped)
  "charter_bookings",
  "charter_partner_application_events",
  // Control tower + staff work surfaces (role-scoped to staff/admin)
  "control_tower_alerts",
  "staff_notifications",
  "staff_work_items",
  "staff_focus_sessions",
  // CRM follow-up surfaces (role-scoped to staff/admin)
  "crm_customer_commitments",
  "sales_leads",
  "sales_lead_events",
  "commercial_lifecycle",
  "crm_next_actions",
  // Partner lifecycle surfaces (partner/staff scoped)
  "partner_applications",
  "partner_lifecycle_signals",
  "partner_lifecycle_audit",
  "partner_profile_history",
  "partner_staff_notifications",
];

/** Channel-name prefixes the frontend is allowed to subscribe to. */
export const APPROVED_CHANNEL_PREFIXES: readonly string[] = [
  "delivery-",
  "dispatch-",
  "logistics-",
  "trip-",
  "rider-",
  "corporate-documents",
  "alerts-",
];

export interface RealtimeAllowlistViolation {
  kind: "table" | "channel";
  name: string;
  reason: string;
}

export function isApprovedRealtimeTable(table: string): boolean {
  const bare = table.replace(/^public\./, "");
  if (APPROVED_REALTIME_TABLES.includes(bare)) return true;
  // Declarative partitions inherit their parent's approval (e.g. foo_202607).
  const parent = bare.replace(/_(\d{6}|default)$/, "");
  return parent !== bare && APPROVED_REALTIME_TABLES.includes(parent);
}

export function isApprovedChannel(channel: string): boolean {
  return APPROVED_CHANNEL_PREFIXES.some((p) => channel.startsWith(p));
}

/**
 * Validate a publication snapshot against the allowlist.
 * Returns one violation per non-approved table.
 */
export function validateRealtimePublication(tables: readonly string[]): RealtimeAllowlistViolation[] {
  return tables
    .filter((t) => !isApprovedRealtimeTable(t))
    .map((t) => ({
      kind: "table" as const,
      name: t.replace(/^public\./, ""),
      reason: "Table is in the supabase_realtime publication but is not on the approved broadcast allowlist",
    }));
}

/**
 * Guard used before opening a client subscription. Throws in development so
 * the mistake is caught immediately; logs and denies in production.
 */
export function assertAllowedChannel(channel: string): boolean {
  if (isApprovedChannel(channel)) return true;
  const msg = `[realtime-allowlist] channel "${channel}" is not approved for client broadcast`;
  if (import.meta.env?.DEV) throw new Error(msg);
  console.error(msg);
  return false;
}

/* --------------------------------------------------------------------------
 * Broadcast / Presence / private-channel prohibition.
 *
 * Every live surface in this platform receives data through `postgres_changes`
 * on an approved table, so each subscriber only ever sees rows its own
 * row-level rules allow. Broadcast, Presence and private channels are NOT
 * row-scoped: their authorisation lives in `realtime.messages` policies, and
 * that schema is provider-managed here — we cannot add topic-scoped policies to
 * it. Without them, any signed-in user could join any topic by name.
 *
 * The contract is therefore fail-closed: these transports are prohibited. If a
 * future feature genuinely needs one, the topic authorisation must be solved
 * first; until then the gate below refuses the code.
 * ------------------------------------------------------------------------ */

/** Source patterns that indicate a non-row-scoped realtime transport. */
export const PROHIBITED_REALTIME_TRANSPORTS: readonly { id: string; pattern: RegExp; reason: string }[] = [
  {
    id: "private_channel",
    pattern: /private\s*:\s*true/,
    reason:
      "Private channels authorise per topic through realtime.messages policies, which cannot be added to the provider-managed realtime schema here.",
  },
  {
    id: "broadcast_subscribe",
    pattern: /\.on\(\s*['"`]broadcast['"`]/,
    reason: "Broadcast subscriptions are not row-scoped: any signed-in user could join the topic by name.",
  },
  {
    id: "broadcast_send",
    pattern: /type\s*:\s*['"`]broadcast['"`]/,
    reason: "Broadcast sends deliver to every topic subscriber regardless of row-level rules.",
  },
  {
    id: "presence_subscribe",
    pattern: /\.on\(\s*['"`]presence['"`]/,
    reason: "Presence state is shared with every topic subscriber and carries no row-level scoping.",
  },
  {
    id: "presence_track",
    pattern: /\.track\(/,
    reason: "Presence tracking publishes the caller's state to every topic subscriber.",
  },
  {
    id: "realtime_send_rpc",
    pattern: /realtime\.send\s*\(/,
    reason: "realtime.send() writes to realtime.messages, which has no topic-scoped policies in this project.",
  },
];

export interface RealtimeTransportViolation {
  kind: "transport";
  file: string;
  line: number;
  transport: string;
  reason: string;
  snippet: string;
}

/**
 * Scan source text for prohibited realtime transports.
 * Pure: the caller supplies the file contents, so this runs in tests and in CI.
 */
export function findProhibitedTransports(
  files: readonly { path: string; content: string }[],
): RealtimeTransportViolation[] {
  const out: RealtimeTransportViolation[] = [];
  for (const file of files) {
    const lines = file.content.split("\n");
    lines.forEach((text, index) => {
      // Comments document why these transports are avoided — not usage.
      const code = text.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "").trim();
      if (!code || code.startsWith("*")) return;
      for (const t of PROHIBITED_REALTIME_TRANSPORTS) {
        if (t.pattern.test(code)) {
          out.push({
            kind: "transport",
            file: file.path,
            line: index + 1,
            transport: t.id,
            reason: t.reason,
            snippet: code.slice(0, 160),
          });
        }
      }
    });
  }
  return out;
}

/* --------------------------------------------------------------------------
 * Reviewed publication register.
 *
 * `postgres_changes` delivery re-evaluates row-level rules for each subscriber,
 * so a published table is only as safe as its read policy and its table grants.
 * Every table in the `supabase_realtime` publication is reviewed here with the
 * audience its read policy admits. A published table that is absent from this
 * register, loses RLS, gains a permissive `USING (true)` read policy, gains an
 * anonymous policy, or regains the `anon` SELECT grant is a governance failure:
 * the live gate refuses it.
 * ------------------------------------------------------------------------ */

export type RealtimeAudience =
  | "owner" // the row's own user / staff record
  | "staff" // a staff-permission or staff-membership check
  | "partner" // the partner or applicant the row belongs to
  | "admin"; // platform admin only

export interface ReviewedRealtimeTable {
  table: string;
  audience: RealtimeAudience;
  /** Why this table streams to clients at all. */
  purpose: string;
}

/** Tables reviewed for `supabase_realtime` membership (2026-09-21). */
export const REVIEWED_REALTIME_PUBLICATION: readonly ReviewedRealtimeTable[] = [
  { table: "charter_bookings", audience: "owner", purpose: "Booking owner watches their own charter booking status." },
  { table: "charter_partner_application_events", audience: "partner", purpose: "Applicant follows their own application progress." },
  { table: "commercial_lifecycle", audience: "staff", purpose: "Commercial staff see deal stage changes on their own book." },
  { table: "control_tower_alerts", audience: "staff", purpose: "Control tower operators need alerts as they are raised." },
  { table: "corporate_ops_alert_events", audience: "staff", purpose: "Platform staff monitor corporate operations alerts." },
  { table: "corporate_support_ticket_notes", audience: "staff", purpose: "Support staff follow ticket discussion live." },
  { table: "corporate_support_tickets", audience: "staff", purpose: "Support staff see incoming corporate tickets." },
  { table: "crm_customer_commitments", audience: "staff", purpose: "CRM staff see commitments as they are captured." },
  { table: "crm_next_actions", audience: "staff", purpose: "CRM staff see next actions as they are raised." },
  { table: "partner_applications", audience: "staff", purpose: "Partner intake staff see applications on arrival." },
  { table: "partner_lifecycle_audit", audience: "staff", purpose: "Partner staff follow lifecycle audit entries." },
  { table: "partner_lifecycle_signals", audience: "staff", purpose: "Partner staff react to lifecycle signals." },
  { table: "partner_profile_history", audience: "staff", purpose: "Partner staff see profile changes as they happen." },
  { table: "partner_staff_notifications", audience: "staff", purpose: "Partner staff notification feed." },
  { table: "sales_lead_events", audience: "owner", purpose: "A specialist follows activity on their own leads." },
  { table: "sales_leads", audience: "owner", purpose: "A specialist watches their own lead list update live." },
  { table: "staff_focus_sessions", audience: "staff", purpose: "Focus mode reflects the employee's own session state." },
  { table: "staff_notifications", audience: "owner", purpose: "Each employee receives only their own notifications." },
  { table: "staff_work_items", audience: "owner", purpose: "Each employee sees their own and their queue's work." },
];

/** Live snapshot of one published table, as read from the database. */
export interface RealtimePublicationRow {
  table: string;
  rls_enabled: boolean;
  read_policies: number;
  permissive_true_read_policies: number;
  anon_read_policies: number;
  anon_select_grant: boolean;
}

export interface RealtimePublicationViolation {
  kind: "publication";
  table: string;
  reason: string;
}

/**
 * Validate the live publication against the reviewed register.
 * Pure: the caller supplies the snapshot, so this runs in tests and in CI.
 */
export function realtimePublicationViolations(
  rows: readonly RealtimePublicationRow[],
): RealtimePublicationViolation[] {
  const out: RealtimePublicationViolation[] = [];
  const reviewed = new Map(REVIEWED_REALTIME_PUBLICATION.map((r) => [r.table, r]));
  const seen = new Set<string>();

  for (const row of rows) {
    seen.add(row.table);
    const v = (reason: string) => out.push({ kind: "publication", table: row.table, reason });
    if (!reviewed.has(row.table)) {
      v("Table streams row changes to clients but is not in REVIEWED_REALTIME_PUBLICATION");
    }
    if (!row.rls_enabled) v("Row-level security is disabled: every subscriber would receive every row");
    if (row.read_policies === 0) v("No read policy exists, so the table cannot be safely published");
    if (row.permissive_true_read_policies > 0) {
      v("A read policy is permissive (USING true): all subscribers would receive all rows");
    }
    if (row.anon_read_policies > 0) v("A read policy admits the anonymous role");
    if (row.anon_select_grant) v("The anonymous role still holds the SELECT grant required to subscribe");
  }

  for (const r of reviewed.keys()) {
    if (!seen.has(r)) {
      out.push({
        kind: "publication",
        table: r,
        reason: "Reviewed as published but absent from the live supabase_realtime publication — re-review the register",
      });
    }
  }
  return out;
}
