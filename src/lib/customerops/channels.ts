/**
 * Customer Operations — omnichannel conversation unification.
 *
 * Every inbound touchpoint (email, chat, WhatsApp, SMS, phone log, portal
 * message, AI chat) is normalised into one `Interaction` and merged into a
 * single conversation thread per customer + topic, so an agent never has to
 * reconcile channels by hand.
 *
 * Deterministic and dependency-free — safe to unit test and to run on either
 * live rows or realtime payloads.
 */

export type ChannelId =
  | "email"
  | "live_chat"
  | "whatsapp"
  | "sms"
  | "phone"
  | "corporate_portal"
  | "charter_portal"
  | "driver_portal"
  | "rider_app"
  | "web_app"
  | "ai_chat"
  | "social";

export type ChannelGroup = "messaging" | "voice" | "portal" | "assistant";

export interface ChannelDefinition {
  id: ChannelId;
  label: string;
  group: ChannelGroup;
  /** Realtime channels drive the "active chats" KPI. */
  realtime: boolean;
  /** Agents can reply outbound on this channel. */
  outbound: boolean;
  /** Reserved capacity — visible but not yet accepting traffic. */
  planned?: boolean;
}

export const CHANNELS: ChannelDefinition[] = [
  { id: "live_chat", label: "Live chat", group: "messaging", realtime: true, outbound: true },
  { id: "whatsapp", label: "WhatsApp", group: "messaging", realtime: true, outbound: true },
  { id: "sms", label: "SMS", group: "messaging", realtime: false, outbound: true },
  { id: "email", label: "Email", group: "messaging", realtime: false, outbound: true },
  { id: "phone", label: "Phone call log", group: "voice", realtime: true, outbound: true },
  { id: "corporate_portal", label: "Corporate portal", group: "portal", realtime: false, outbound: true },
  { id: "charter_portal", label: "Charter portal", group: "portal", realtime: false, outbound: true },
  { id: "driver_portal", label: "Driver portal", group: "portal", realtime: false, outbound: true },
  { id: "rider_app", label: "Rider app", group: "portal", realtime: true, outbound: true },
  { id: "web_app", label: "Web app", group: "portal", realtime: false, outbound: true },
  { id: "ai_chat", label: "AI chat", group: "assistant", realtime: true, outbound: true },
  { id: "social", label: "Social channels", group: "messaging", realtime: false, outbound: false, planned: true },
];

export const CHANNEL_BY_ID = new Map(CHANNELS.map((c) => [c.id, c]));

const ALIASES: Record<string, ChannelId> = {
  mail: "email", "e-mail": "email", inbox: "email",
  chat: "live_chat", livechat: "live_chat", webchat: "live_chat",
  wa: "whatsapp", whats_app: "whatsapp",
  text: "sms", ussd: "sms",
  call: "phone", voice: "phone", telephone: "phone", ivr: "phone",
  corporate: "corporate_portal", corporate_admin: "corporate_portal",
  charter: "charter_portal", portal: "web_app", web: "web_app",
  driver: "driver_portal", driver_app: "driver_portal",
  rider: "rider_app", app: "rider_app",
  ai: "ai_chat", copilot: "ai_chat", assistant: "ai_chat", concierge_ai: "ai_chat",
  twitter: "social", x: "social", facebook: "social", instagram: "social", tiktok: "social",
};

/** Maps any legacy or free-form channel value onto a canonical channel id. */
export function normalizeChannel(raw: string | null | undefined): ChannelId {
  const key = (raw ?? "").toLowerCase().trim().replace(/[\s-]+/g, "_");
  if (!key) return "web_app";
  if (CHANNEL_BY_ID.has(key as ChannelId)) return key as ChannelId;
  return ALIASES[key] ?? "web_app";
}

export const channelLabel = (raw: string | null | undefined): string =>
  CHANNEL_BY_ID.get(normalizeChannel(raw))!.label;

export interface Interaction {
  id: string;
  /** Stable customer key: user id, email or phone — whichever is available. */
  customerKey: string;
  channel: string;
  subject?: string | null;
  body?: string | null;
  direction: "inbound" | "outbound";
  at: string;
  caseId?: string | null;
  authorName?: string | null;
}

export interface ConversationThread {
  key: string;
  customerKey: string;
  subject: string;
  channels: ChannelId[];
  interactions: Interaction[];
  caseIds: string[];
  firstAt: string;
  lastAt: string;
  inbound: number;
  outbound: number;
  /** True when the thread was assembled from more than one channel. */
  crossChannel: boolean;
  /** True when the newest interaction is still awaiting an agent reply. */
  awaitingReply: boolean;
}

/** Normalises a subject into a topic key so re: / fwd: noise merges. */
export function topicKey(subject?: string | null): string {
  const cleaned = (subject ?? "")
    .toLowerCase()
    .replace(/^((re|fw|fwd|ref)\s*:\s*)+/g, "")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "general";
  // Topic identity is the first 6 significant words — enough to bind a thread
  // without merging two unrelated issues from the same customer.
  return cleaned.split(" ").filter((w) => w.length > 2).slice(0, 6).join(" ") || "general";
}

/**
 * Merges interactions into unified threads.
 *
 * Binding rule: interactions sharing a case id always merge; otherwise they
 * merge on customer + topic. Result is newest-activity first, and each
 * thread's interactions are oldest first (reading order).
 */
export function unifyThreads(interactions: Interaction[]): ConversationThread[] {
  const caseThread = new Map<string, string>();
  const groups = new Map<string, Interaction[]>();

  const sorted = [...interactions].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  for (const it of sorted) {
    let key: string;
    if (it.caseId) {
      key = caseThread.get(it.caseId) ?? `case:${it.caseId}`;
      caseThread.set(it.caseId, key);
    } else {
      key = `topic:${it.customerKey}:${topicKey(it.subject)}`;
    }
    groups.set(key, [...(groups.get(key) ?? []), it]);
  }

  return [...groups.entries()]
    .map(([key, list]) => {
      const channels = [...new Set(list.map((i) => normalizeChannel(i.channel)))];
      const last = list[list.length - 1];
      const subject = list.find((i) => i.subject)?.subject ?? "General enquiry";
      return {
        key,
        customerKey: list[0].customerKey,
        subject,
        channels,
        interactions: list,
        caseIds: [...new Set(list.map((i) => i.caseId).filter(Boolean) as string[])],
        firstAt: list[0].at,
        lastAt: last.at,
        inbound: list.filter((i) => i.direction === "inbound").length,
        outbound: list.filter((i) => i.direction === "outbound").length,
        crossChannel: channels.length > 1,
        awaitingReply: last.direction === "inbound",
      } satisfies ConversationThread;
    })
    .sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt));
}

export interface ChannelMixRow {
  channel: ChannelId;
  label: string;
  count: number;
  share: number;
  realtime: boolean;
}

/** Channel distribution for the overview strip. Zero-volume channels included. */
export function channelMix(interactions: Array<{ channel: string }>): ChannelMixRow[] {
  const counts = new Map<ChannelId, number>(CHANNELS.map((c) => [c.id, 0]));
  for (const it of interactions) {
    const id = normalizeChannel(it.channel);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const total = interactions.length || 1;
  return CHANNELS.map((c) => ({
    channel: c.id,
    label: c.label,
    count: counts.get(c.id) ?? 0,
    share: Math.round(((counts.get(c.id) ?? 0) / total) * 100),
    realtime: c.realtime,
  })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** Count of threads currently live on a realtime channel and awaiting a reply. */
export function activeChatCount(threads: ConversationThread[]): number {
  return threads.filter(
    (t) => t.awaitingReply && t.channels.some((c) => CHANNEL_BY_ID.get(c)?.realtime),
  ).length;
}
