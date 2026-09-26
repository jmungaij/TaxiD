/**
 * COMMUNICATION COMMAND CENTRE — client contract.
 *
 * Every figure, conversation and message on the Communication surfaces arrives
 * from server functions that enforce authorization mailbox-by-mailbox
 * (`comms_overview`, `comms_thread_detail`). The browser never widens its own
 * scope: asking for the management scope without a grant simply returns the
 * mailboxes the caller may reach. Opening a conversation is audited server-side.
 */
import { supabase } from "@/integrations/supabase/client";
import { untypedDb } from "@/integrations/supabase/untyped";

const db = untypedDb;

export type CommsScope = "management" | "mine";

/**
 * Manager level and above. Only these roles may open the organisation-wide
 * ("management centre") view, the mailbox register and the access audit.
 * Mirrors public.comms_is_manager() — the server remains the boundary and
 * silently narrows a wider request back to the caller's own mailboxes.
 */
export const COMMS_MANAGER_ROLES = [
  "admin",
  "super_admin",
  "director",
  "general_manager",
  "finance_admin",
  "compliance_admin",
  "operations_admin",
  "operations_manager",
] as const;

export function isCommsManager(roles: readonly string[] | undefined): boolean {
  const set = new Set(roles ?? []);
  return (COMMS_MANAGER_ROLES as readonly string[]).some((r) => set.has(r));
}

export type CommsAccount = {
  id: string;
  mailbox_address: string;
  display_name: string;
  provider: "microsoft_graph" | "gmail_api" | "imap" | "platform";
  department: string | null;
  status: string;
  sync_enabled: boolean;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
};

export type CommsThreadRow = {
  id: string;
  subject: string;
  counterparty_name: string | null;
  counterparty_email: string | null;
  category: "internal" | "external" | "enquiry" | "notification";
  status: "unread" | "pending" | "replied" | "escalated" | "closed";
  priority: string;
  message_count: number;
  inbound_count: number;
  outbound_count: number;
  last_activity_at: string;
  last_direction: "inbound" | "outbound" | null;
  mailbox_address: string;
  account_name: string;
  owner_name: string | null;
};

export type CommsOverview = {
  scope: CommsScope;
  generated_at: string;
  is_administrator: boolean;
  is_manager?: boolean;
  staff_id: string | null;
  accounts: CommsAccount[];
  threads: CommsThreadRow[];
  tiles: {
    total: number;
    unread: number;
    pending: number;
    escalated: number;
    inbound: number;
    outbound: number;
  };
};

export type CommsMessage = {
  id: string;
  direction: "inbound" | "outbound";
  from_address: string | null;
  from_name: string | null;
  to_addresses: string[];
  cc_addresses: string[];
  subject: string | null;
  body_preview: string | null;
  body_html: string | null;
  delivery_status: string | null;
  has_attachments: boolean;
  occurred_at: string;
  source: string;
};

export type CommsThreadDetail = {
  thread: {
    id: string;
    subject: string;
    counterparty_name: string | null;
    counterparty_email: string | null;
    category: string;
    status: string;
    priority: string;
    last_activity_at: string;
    mailbox_address: string;
    account_name: string;
    owner_name: string | null;
  } | null;
  messages: CommsMessage[];
};

function explain(message: string): string {
  if (message.includes("COMMS_NOT_AUTHORISED")) {
    return "This conversation belongs to a mailbox you are not authorised to read.";
  }
  if (message.includes("COMMS_ADMIN_REQUIRED")) {
    return "Only a platform administrator may change communication accounts or access.";
  }
  if (message.includes("AUTH_REQUIRED")) return "Please sign in again to continue.";
  return message;
}

export async function fetchCommsOverview(scope: CommsScope): Promise<CommsOverview> {
  const { data, error } = await db.rpc("comms_overview", { _scope: scope });
  if (error) throw new Error(explain(error.message));
  return data as CommsOverview;
}

export async function fetchThreadDetail(threadId: string): Promise<CommsThreadDetail> {
  const { data, error } = await db.rpc("comms_thread_detail", { _thread_id: threadId });
  if (error) throw new Error(explain(error.message));
  return data as CommsThreadDetail;
}

export async function updateThread(input: {
  threadId: string;
  status?: string;
  ownerStaffId?: string;
  priority?: string;
}): Promise<void> {
  const { error } = await db.rpc("comms_thread_update", {
    _thread_id: input.threadId,
    _status: input.status ?? null,
    _owner_staff_id: input.ownerStaffId ?? null,
    _priority: input.priority ?? null,
  });
  if (error) throw new Error(explain(error.message));
}

export async function importPlatformHistory(days = 90): Promise<{ sent: number; enquiries: number }> {
  const { data, error } = await db.rpc("comms_import_platform_history", { _days: days });
  if (error) throw new Error(explain(error.message));
  return data as { sent: number; enquiries: number };
}

export async function upsertAccount(input: {
  mailbox: string;
  displayName: string;
  provider: CommsAccount["provider"];
  department?: string;
  syncEnabled?: boolean;
  credentialSecretRef?: string;
}): Promise<string> {
  const { data, error } = await db.rpc("comms_account_upsert", {
    _mailbox_address: input.mailbox,
    _display_name: input.displayName,
    _provider: input.provider,
    _department: input.department ?? null,
    _sync_enabled: input.syncEnabled ?? false,
    _credential_secret_ref: input.credentialSecretRef ?? null,
  });
  if (error) throw new Error(explain(error.message));
  return data as string;
}

/** Asks the server to synchronise a mailbox both ways. Never handles credentials. */
export async function syncMailbox(accountId: string): Promise<{ status: string; ingested: number; detail?: string }> {
  const { data, error } = await supabase.functions.invoke("comms-mailbox-sync", {
    body: { accountId },
  });
  if (error) throw new Error(error.message);
  return data as { status: string; ingested: number; detail?: string };
}

export type CommsAuditEvent = {
  id: string;
  actor_email: string | null;
  action: string;
  thread_id: string | null;
  created_at: string;
  metadata: Record<string, unknown>;
};

export async function fetchAccessAudit(limit = 100): Promise<CommsAuditEvent[]> {
  const { data, error } = await db
    .from("comms_access_events")
    .select("id, actor_email, action, thread_id, created_at, metadata")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(explain(error.message));
  return (data ?? []) as CommsAuditEvent[];
}

/**
 * Named readers of the shared ("unified") company mailboxes. The register is
 * the authority — the browser only asks whether its own row exists, and the
 * server refuses privileged mail to everyone else regardless of this answer.
 */
export async function amIUnifiedReader(): Promise<boolean> {
  const { data, error } = await db.from("comms_unified_readers").select("staff_id").limit(1);
  if (error) return false;
  return (data ?? []).length > 0;
}

export type MyMailbox = { account_id: string; mailbox_address: string; display_name: string };

/** Provisions (or returns) the caller's own personal work mailbox. */
export async function ensureMyMailbox(): Promise<MyMailbox> {
  const { data, error } = await db.rpc("comms_ensure_my_mailbox", {});
  if (error) {
    if (error.message.includes("COMMS_NO_WORK_EMAIL"))
      throw new Error("Your work email address is not on your staff record yet.");
    if (error.message.includes("COMMS_NO_STAFF_RECORD"))
      throw new Error("Your account is not linked to a staff record yet.");
    throw new Error(explain(error.message));
  }
  return data as MyMailbox;
}

/** Sends one email from a mailbox the caller is authorised to send from. */
export async function sendWorkspaceEmail(input: {
  accountId: string;
  to: string;
  cc?: string;
  subject: string;
  body: string;
  attachments?: { path: string; filename: string; mime: string }[];
  links?: { kind: string; label: string; url: string; meeting_booking_id?: string | null }[];
}): Promise<void> {
  const { data, error } = await supabase.functions.invoke("comms-send-email", {
    body: {
      attachments: input.attachments ?? [],
      links: input.links ?? [],
      accountId: input.accountId,
      to: input.to,
      cc: input.cc ?? "",
      subject: input.subject,
      body: input.body,
    },
  });
  if (error) {
    const detail = await (error as unknown as { context?: { text?: () => Promise<string> } })
      .context?.text?.()
      .catch(() => "");
    let message = error.message;
    try {
      const parsed = detail ? (JSON.parse(detail) as { error?: string }) : null;
      if (parsed?.error) message = parsed.error;
    } catch {
      if (detail) message = detail;
    }
    throw new Error(message);
  }
  const failure = (data as { error?: string } | null)?.error;
  if (failure) throw new Error(failure);
}

export const CATEGORY_LABEL: Record<CommsThreadRow["category"], string> = {
  external: "External",
  internal: "Internal",
  enquiry: "Website enquiry",
  notification: "Notification",
};

export const STATUS_TONE: Record<CommsThreadRow["status"], string> = {
  unread: "bg-[hsl(var(--status-info)/0.15)] text-[hsl(var(--status-info))]",
  pending: "bg-[hsl(var(--status-warning)/0.15)] text-[hsl(var(--status-warning))]",
  replied: "bg-[hsl(var(--status-success)/0.15)] text-[hsl(var(--status-success))]",
  escalated: "bg-destructive/15 text-destructive",
  closed: "bg-muted text-muted-foreground",
};

export const PROVIDER_LABEL: Record<CommsAccount["provider"], string> = {
  microsoft_graph: "Microsoft 365",
  gmail_api: "Google Workspace",
  imap: "IMAP / SMTP",
  platform: "SAFARID platform",
};
