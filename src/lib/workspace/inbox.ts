/**
 * STAGE 7b — THE WORKSPACE INBOX.
 *
 * Real email, read through the SAME authorised server functions the
 * Communication centre uses (`comms_overview`, `comms_thread_detail`). The
 * workspace never widens its own scope: it always asks for the caller's own
 * mailboxes, so a privileged mailbox can never leak into an employee's
 * workspace. Nothing is cached or rewritten — sender, subject, date and body
 * are exactly what the mail server delivered.
 */
import {
  fetchCommsOverview,
  fetchThreadDetail,
  type CommsMessage,
  type CommsThreadRow,
} from "@/lib/staff/communications";

export interface InboxEmail {
  threadId: string;
  subject: string;
  /** Who it is from, as recorded on the conversation. */
  senderName: string | null;
  senderEmail: string | null;
  mailbox: string;
  mailboxName: string;
  receivedAt: string;
  category: CommsThreadRow["category"];
  status: CommsThreadRow["status"];
  messageCount: number;
  unread: boolean;
  lastDirection: CommsThreadRow["last_direction"];
}

export interface InboxResult {
  emails: InboxEmail[];
  /** Mailboxes released to this account. */
  mailboxes: { address: string; name: string }[];
  authorised: boolean;
  error: string | null;
}

const toEmail = (row: CommsThreadRow): InboxEmail => ({
  threadId: row.id,
  subject: row.subject || "(no subject)",
  senderName: row.counterparty_name ?? null,
  senderEmail: row.counterparty_email ?? null,
  mailbox: row.mailbox_address,
  mailboxName: row.account_name,
  receivedAt: row.last_activity_at,
  category: row.category,
  status: row.status,
  messageCount: row.message_count,
  unread: row.status === "unread",
  lastDirection: row.last_direction,
});

/** Always scoped to "mine" — the workspace never requests the management view. */
export async function fetchWorkspaceInbox(): Promise<InboxResult> {
  try {
    const overview = await fetchCommsOverview("mine");
    const emails = (overview.threads ?? [])
      .map(toEmail)
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
    return {
      emails,
      mailboxes: (overview.accounts ?? []).map((a) => ({ address: a.mailbox_address, name: a.display_name })),
      authorised: true,
      error: null,
    };
  } catch (error) {
    return {
      emails: [],
      mailboxes: [],
      authorised: false,
      error: error instanceof Error ? error.message : "The mail service could not be reached.",
    };
  }
}

export interface EmailBody {
  messageId: string;
  direction: CommsMessage["direction"];
  fromLabel: string;
  toLabel: string;
  subject: string | null;
  /** Plain text body as delivered; HTML is reduced to text, never rendered raw. */
  body: string;
  occurredAt: string;
  hasAttachments: boolean;
}

/** HTML is never injected into the DOM — it is reduced to readable text. */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function bodyOf(message: CommsMessage): string {
  if (message.body_html) {
    const text = htmlToText(message.body_html);
    if (text) return text;
  }
  return message.body_preview?.trim() || "This message arrived without a readable body.";
}

export interface EmailThread {
  subject: string;
  senderName: string | null;
  senderEmail: string | null;
  mailbox: string;
  messages: EmailBody[];
  authorised: boolean;
  error: string | null;
}

export async function fetchEmailThread(threadId: string): Promise<EmailThread> {
  try {
    const detail = await fetchThreadDetail(threadId);
    return {
      subject: detail.thread?.subject ?? "(no subject)",
      senderName: detail.thread?.counterparty_name ?? null,
      senderEmail: detail.thread?.counterparty_email ?? null,
      mailbox: detail.thread?.mailbox_address ?? "",
      messages: (detail.messages ?? []).map((m) => ({
        messageId: m.id,
        direction: m.direction,
        fromLabel: [m.from_name, m.from_address].filter(Boolean).join(" · ") || "Unknown sender",
        toLabel: m.to_addresses?.join(", ") || "—",
        subject: m.subject,
        body: bodyOf(m),
        occurredAt: m.occurred_at,
        hasAttachments: m.has_attachments,
      })),
      authorised: true,
      error: null,
    };
  } catch (error) {
    return {
      subject: "",
      senderName: null,
      senderEmail: null,
      mailbox: "",
      messages: [],
      authorised: false,
      error: error instanceof Error ? error.message : "This conversation could not be opened.",
    };
  }
}
