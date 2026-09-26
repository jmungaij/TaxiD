/**
 * Pricing 360 audit stream.
 *
 * Every consequential Pricing 360 action — approve, publish, save, export,
 * dispatch, reconcile, simulate-with-effect, legacy redirect — is recorded in
 * `pricing_audit_events` with:
 *   • actor identity (user id + email)
 *   • server timestamp (`created_at` default now())
 *   • payload diff (previous_value / new_value, field-level)
 *   • RBAC outcome (allowed | denied | error) carried in the reason and payload
 *
 * The write is best-effort for the UX (a failed audit insert never blocks the
 * operator) but never silent: failures are logged and returned to the caller so
 * governance surfaces can flag an unauditable action.
 */
import { supabase } from "@/integrations/supabase/client";
import { untypedDb } from "@/integrations/supabase/untyped";

export type PricingAuditAction =
  | "approve"
  | "reject"
  | "publish"
  | "save"
  | "export"
  | "dispatch"
  | "reconcile"
  | "simulate"
  | "redirect"
  | "view";

export type RbacOutcome = "allowed" | "denied" | "error";

export interface PricingAuditInput {
  action: PricingAuditAction;
  /** Logical entity, e.g. "pricing_rule_sets", "asset_pricing_versions". */
  entity: string;
  entityId?: string | null;
  /** State before the action (omit for creates / reads). */
  before?: Record<string, unknown> | null;
  /** State after the action (omit for deletes / reads). */
  after?: Record<string, unknown> | null;
  reason?: string;
  rbac?: RbacOutcome;
  /** Extra context merged into the recorded payload (route, filters, counts). */
  context?: Record<string, unknown>;
}

export interface FieldDiff {
  field: string;
  from: unknown;
  to: unknown;
}

/** Field-level diff of two payloads. Stable ordering, JSON-comparable values. */
export function diffPayload(
  before?: Record<string, unknown> | null,
  after?: Record<string, unknown> | null,
): FieldDiff[] {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const out: FieldDiff[] = [];
  for (const field of [...keys].sort()) {
    const from = before?.[field];
    const to = after?.[field];
    if (JSON.stringify(from) !== JSON.stringify(to)) out.push({ field, from, to });
  }
  return out;
}

export interface PricingAuditResult {
  ok: boolean;
  reason?: string;
}

export async function logPricingAction(input: PricingAuditInput): Promise<PricingAuditResult> {
  const rbac: RbacOutcome = input.rbac ?? "allowed";
  const diff = diffPayload(input.before, input.after);
  try {
    const { data: auth } = await supabase.auth.getUser();
    const actor = auth?.user ?? null;

    const { error } = await supabase.from("pricing_audit_events").insert({
      actor_id: actor?.id ?? null,
      actor_email: actor?.email ?? null,
      action: input.action,
      entity: input.entity,
      entity_id: input.entityId ?? null,
      previous_value: (input.before ?? null) as never,
      new_value: ({
        ...(input.after ?? {}),
        __diff: diff,
        __rbac: rbac,
        __route: typeof window !== "undefined" ? window.location.pathname + window.location.search : null,
        ...(input.context ?? {}),
      }) as never,
      reason: `${input.reason ?? input.action} [rbac:${rbac}]`,
    });
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
     
    console.error(`[pricing360.audit] unauditable action ${input.action}/${input.entity}: ${reason}`);
    return { ok: false, reason };
  }
}

/**
 * Wraps a Pricing 360 mutation so the audit row is written whether the action
 * succeeds (rbac: allowed) or is rejected by the server (rbac: denied/error).
 */
export async function auditedPricingAction<T>(
  input: Omit<PricingAuditInput, "rbac">,
  run: () => Promise<T>,
): Promise<T> {
  try {
    const result = await run();
    await logPricingAction({ ...input, rbac: "allowed" });
    return result;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const denied = /row-level security|permission denied|not authori[sz]ed|forbidden/i.test(message);
    await logPricingAction({
      ...input,
      rbac: denied ? "denied" : "error",
      reason: `${input.reason ?? input.action} failed: ${message}`,
    });
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Audit query surface (Pricing 360 Audit Log page)
// ---------------------------------------------------------------------------

export interface PricingAuditRow {
  id: string;
  created_at: string;
  actor_id: string | null;
  actor_email: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  reason: string;
  previous_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
}

export interface PricingAuditFilters {
  /** Empty means "every action". */
  actions?: PricingAuditAction[];
  /** Case-insensitive match on actor email. */
  actor?: string;
  /** Inclusive ISO date (yyyy-mm-dd) lower bound. */
  from?: string;
  /** Inclusive ISO date (yyyy-mm-dd) upper bound. */
  to?: string;
  /** Empty means "every outcome". */
  outcomes?: RbacOutcome[];
  entity?: string;
  /** Exact entity id (one governed record's full history). */
  entityId?: string;
  /** Withheld-quote event types, e.g. NO_PUBLISHED_VERSION. Empty means all. */
  events?: string[];
  /** Case-insensitive substring match on the recorded blockedReason. */
  blockedReason?: string;
  limit?: number;
}

/** Reads the RBAC outcome recorded on a row. Falls back to the reason suffix. */
export function rowOutcome(row: Pick<PricingAuditRow, "reason" | "new_value">): RbacOutcome {
  const tagged = (row.new_value as { __rbac?: string } | null)?.__rbac;
  if (tagged === "allowed" || tagged === "denied" || tagged === "error") return tagged;
  const m = /\[rbac:(allowed|denied|error)\]/.exec(row.reason ?? "");
  return (m?.[1] as RbacOutcome) ?? "allowed";
}

/** Field-level diff recorded with the row, recomputed when absent. */
export function rowDiff(row: Pick<PricingAuditRow, "previous_value" | "new_value">): FieldDiff[] {
  const stored = (row.new_value as { __diff?: FieldDiff[] } | null)?.__diff;
  if (Array.isArray(stored)) return stored;
  const after = { ...(row.new_value ?? {}) } as Record<string, unknown>;
  delete after.__diff; delete after.__rbac; delete after.__route;
  return diffPayload(row.previous_value, after);
}

/**
 * Filtered audit read. Action, actor, entity and date range are pushed to the
 * server; RBAC outcome is applied client-side because it lives inside the
 * recorded payload (the table is append-only, so no schema change is safe here).
 */
export async function queryPricingAudit(filters: PricingAuditFilters = {}): Promise<PricingAuditRow[]> {
  const limit = filters.limit ?? 200;
  let q = (untypedDb)
    .from("pricing_audit_events")
    .select("id,created_at,actor_id,actor_email,action,entity,entity_id,reason,previous_value,new_value")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (filters.actions?.length) q = q.in("action", filters.actions);
  if (filters.actor?.trim()) q = q.ilike("actor_email", `%${filters.actor.trim()}%`);
  if (filters.entity?.trim()) q = q.ilike("entity", `%${filters.entity.trim()}%`);
  if (filters.entityId?.trim()) q = q.eq("entity_id", filters.entityId.trim());
  if (filters.from) q = q.gte("created_at", `${filters.from}T00:00:00.000Z`);
  if (filters.to) q = q.lte("created_at", `${filters.to}T23:59:59.999Z`);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  let rows = (data ?? []) as PricingAuditRow[];
  if (filters.outcomes?.length) rows = rows.filter((r) => filters.outcomes!.includes(rowOutcome(r)));
  // Event type and blockedReason live inside the appended payload, so they are
  // filtered here rather than in SQL — the table is append-only and unindexed
  // on payload keys.
  if (filters.events?.length) rows = rows.filter((r) => filters.events!.includes(rowEvent(r) ?? ""));
  const needle = filters.blockedReason?.trim().toLowerCase();
  if (needle) rows = rows.filter((r) => (rowBlockedReason(r) ?? "").toLowerCase().includes(needle));
  return rows;
}

/** Deterministic CSV of an audit result set, for the audited export path. */
export function auditRowsToCsv(rows: PricingAuditRow[]): string {
  const head = ["timestamp", "actor_email", "action", "entity", "entity_id", "rbac_outcome", "reason", "changed_fields"];
  const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = rows.map((r) =>
    [
      r.created_at,
      r.actor_email ?? "",
      r.action,
      r.entity,
      r.entity_id ?? "",
      rowOutcome(r),
      r.reason,
      rowDiff(r).map((d) => d.field).join(" "),
    ].map(cell).join(","),
  );
  return [head.map(cell).join(","), ...lines].join("\n");
}

// ---------------------------------------------------------------------------
// Withheld-quote forensics (AP360 pricing gates)
// ---------------------------------------------------------------------------

/**
 * The quote outcomes that withhold an authoritative price. `useAp360Quote`
 * records one audit row per distinct withheld outcome, carrying the raw
 * `event` and the operator-facing `blockedReason`.
 */
export const WITHHELD_EVENTS = [
  "NO_PUBLISHED_VERSION",
  "PRICE_EXCEPTION_REQUIRED",
  "QUOTE_REQUIRED",
  "QUOTE_ERROR",
] as const;

export type WithheldEvent = (typeof WITHHELD_EVENTS)[number];

/** The recorded event type, when the row came from a pricing gate. */
export function rowEvent(row: Pick<PricingAuditRow, "new_value">): string | null {
  const v = (row.new_value as { event?: unknown } | null)?.event;
  return typeof v === "string" && v ? v : null;
}

/** The plain-language reason the price was withheld, as shown to the operator. */
export function rowBlockedReason(row: Pick<PricingAuditRow, "new_value">): string | null {
  const v = (row.new_value as { blockedReason?: unknown } | null)?.blockedReason;
  return typeof v === "string" && v ? v : null;
}

export interface AuditRelatedTarget {
  label: string;
  /** In-app path. Null when the row carries no navigable origin. */
  to: string | null;
}

/**
 * Where this audit row came from. The gate rows record the originating route
 * (`__route`) — the booking wizard or quote surface the operator was on — plus
 * the asset category the quote was requested for. Nothing is guessed: when no
 * route was recorded the viewer says so instead of inventing a link.
 */
export function rowRelatedTarget(row: Pick<PricingAuditRow, "new_value" | "entity" | "entity_id">): AuditRelatedTarget {
  const route = (row.new_value as { __route?: unknown } | null)?.__route;
  const quoteRef = (row.new_value as { quote_ref?: unknown } | null)?.quote_ref;
  const category = (row.new_value as { category_code?: unknown } | null)?.category_code;
  const label =
    typeof quoteRef === "string" && quoteRef
      ? `Quote ${quoteRef}`
      : typeof category === "string" && category
        ? `Booking · ${category}`
        : row.entity_id
          ? `${row.entity} · ${row.entity_id.slice(0, 8)}`
          : row.entity;
  const to = typeof route === "string" && route.startsWith("/") ? route : null;
  return { label, to };
}
