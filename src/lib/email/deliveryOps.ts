/**
 * Email delivery operations data layer.
 *
 * Read authority is the database:
 *  - `email_send_log` is the append-only delivery history (one row per attempt);
 *    the UI deduplicates by `message_id` to show the latest state per email.
 *  - `email_dead_letters` mirrors the pgmq dead-letter queue so failed sends can
 *    be inspected and re-queued through the admin-only `email_dlq_reprocess` RPC.
 *  - `email_templates` / `email_template_versions` hold admin-authored, versioned
 *    subject + body content that overrides the compiled templates.
 */
import { supabase } from "@/integrations/supabase/client";
import { untypedDb } from "@/integrations/supabase/untyped";

export type DeliveryStatus =
  | "pending"
  | "sent"
  | "failed"
  | "dlq"
  | "rate_limited"
  | "suppressed"
  | "bounced"
  | "complained";

export interface DeliveryRow {
  id: string;
  message_id: string | null;
  template_name: string | null;
  recipient_email: string | null;
  status: string;
  error_message: string | null;
  provider: string | null;
  provider_message_id: string | null;
  route: string | null;
  subject: string | null;
  attempt: number | null;
  next_attempt_at: string | null;
  created_at: string;
}

export interface DeadLetterRow {
  id: string;
  queue: string;
  message_id: string | null;
  template_name: string | null;
  recipient_email: string | null;
  route: string | null;
  attempts: number;
  reason: string | null;
  status: string;
  reprocessed_at: string | null;
  created_at: string;
  payload: Record<string, unknown>;
}

export interface TemplateRow {
  name: string;
  display_name: string;
  description: string | null;
  active_version: number | null;
  updated_at: string;
}

export interface TemplateVersionRow {
  id: string;
  template_name: string;
  version: number;
  subject: string;
  html_body: string;
  text_body: string | null;
  notes: string | null;
  created_at: string;
}

/** Latest attempt per message, so one email is one row. */
export function dedupeByMessage(rows: DeliveryRow[]): DeliveryRow[] {
  const latest = new Map<string, DeliveryRow>();
  for (const row of rows) {
    const key = row.message_id ?? row.id;
    const seen = latest.get(key);
    if (!seen || new Date(row.created_at) > new Date(seen.created_at)) latest.set(key, row);
  }
  return [...latest.values()].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

export async function fetchDeliveryLog(opts: {
  recipient?: string;
  route?: string;
  status?: string;
  sinceDays?: number;
  limit?: number;
}): Promise<DeliveryRow[]> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - (opts.sinceDays ?? 7));

  let q = untypedDb
    .from("email_send_log")
    .select(
      "id, message_id, template_name, recipient_email, status, error_message, provider, provider_message_id, route, subject, attempt, next_attempt_at, created_at",
    )
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 600);

  if (opts.recipient?.trim()) q = q.ilike("recipient_email", `%${opts.recipient.trim()}%`);
  if (opts.route?.trim()) q = q.or(`route.eq.${opts.route},template_name.eq.${opts.route}`);

  const { data, error } = await q;
  if (error) throw error;
  const rows = dedupeByMessage((data ?? []) as DeliveryRow[]);
  return opts.status && opts.status !== "all"
    ? rows.filter((r) => r.status === opts.status)
    : rows;
}

export async function fetchDeadLetters(includeDone = false): Promise<DeadLetterRow[]> {
  let q = untypedDb
    .from("email_dead_letters")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(300);
  if (!includeDone) q = q.eq("status", "pending");
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as DeadLetterRow[];
}

/** Re-queues a dead-lettered email. Server-side role check is authoritative. */
export async function reprocessDeadLetter(id: string): Promise<void> {
  const { data, error } = await untypedDb.rpc("email_dlq_reprocess", { p_id: id });
  if (error) throw error;
  if (data && data.ok === false) throw new Error(String(data.reason ?? "reprocess refused"));
}

export async function fetchTemplates(): Promise<TemplateRow[]> {
  const { data, error } = await untypedDb
    .from("email_templates")
    .select("*")
    .order("display_name");
  if (error) throw error;
  return (data ?? []) as TemplateRow[];
}

export async function fetchTemplateVersions(name: string): Promise<TemplateVersionRow[]> {
  const { data, error } = await untypedDb
    .from("email_template_versions")
    .select("*")
    .eq("template_name", name)
    .order("version", { ascending: false });
  if (error) throw error;
  return (data ?? []) as TemplateVersionRow[];
}

/** Saves a new immutable version; existing versions are never edited in place. */
export async function createTemplateVersion(input: {
  templateName: string;
  subject: string;
  htmlBody: string;
  textBody?: string | null;
  notes?: string | null;
  activate: boolean;
}): Promise<number> {
  const versions = await fetchTemplateVersions(input.templateName);
  const nextVersion = (versions[0]?.version ?? 0) + 1;
  const { data: user } = await supabase.auth.getUser();

  const { error } = await untypedDb.from("email_template_versions").insert({
    template_name: input.templateName,
    version: nextVersion,
    subject: input.subject,
    html_body: input.htmlBody,
    text_body: input.textBody ?? null,
    notes: input.notes ?? null,
    created_by: user?.user?.id ?? null,
  });
  if (error) throw error;

  if (input.activate) await activateTemplateVersion(input.templateName, nextVersion);
  return nextVersion;
}

export async function activateTemplateVersion(name: string, version: number | null): Promise<void> {
  const { error } = await untypedDb
    .from("email_templates")
    .update({ active_version: version, updated_at: new Date().toISOString() })
    .eq("name", name);
  if (error) throw error;
}

const escapeHtml = (v: string) =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Client-side mirror of the edge `{{token}}` merge, used for live preview.
 * Must stay behaviourally identical to supabase/functions/_shared/email-template-store.ts.
 */
export function mergeTokens(source: string, data: Record<string, unknown>, escape = true): string {
  return source.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => {
    const raw = key
      .split(".")
      .reduce<unknown>(
        (acc, part) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[part] : undefined),
        data,
      );
    if (raw === undefined || raw === null) return "";
    return escape ? escapeHtml(String(raw)) : String(raw);
  });
}

/** Tokens referenced by a body, for the editor's token helper. */
export function extractTokens(source: string): string[] {
  return [...new Set([...source.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]))];
}

/** Sample data per managed template, used for preview. */
export const PREVIEW_DATA: Record<string, Record<string, string>> = {
  "contact-confirmation": {
    name: "Charles Gateru",
    subject: "Corporate mobility enquiry",
    category: "corporate",
    message: "We would like a quotation for staff transport.",
    supportEmail: "support@safarid.org",
  },
  "staff-access-credentials": {
    email: "jmungai@safarid.org",
    password: "Yalla2026",
    accessUrl: "https://safarid.org/staff/access",
    roleLabel: "Director",
  },
};

export const STATUS_TONE: Record<string, string> = {
  sent: "bg-success/10 text-success",
  pending: "bg-info/10 text-info",
  failed: "bg-warning/10 text-warning",
  rate_limited: "bg-warning/10 text-warning",
  dlq: "bg-destructive/10 text-destructive",
  suppressed: "bg-muted text-muted-foreground",
  bounced: "bg-destructive/10 text-destructive",
  complained: "bg-destructive/10 text-destructive",
};
