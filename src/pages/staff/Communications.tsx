/**
 * COMMUNICATION COMMAND CENTRE.
 *
 * Two separated experiences on one surface:
 *   • Management Centre — organisational oversight, limited to the mailboxes the
 *     caller's role or name has been granted (administrators see all).
 *   • My communications — only conversations assigned to the caller or where the
 *     caller is a participant.
 *
 * Nothing is computed from guesswork: every figure and row comes from
 * `comms_overview`, and opening a conversation calls `comms_thread_detail`,
 * which authorises and audits the read server-side.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  Building2,
  Globe2,
  Inbox,
  Loader2,
  Mail,
  MailCheck,
  PenLine,
  Send,
  RefreshCw,
  Search,
  ShieldCheck,
  Siren,
  UserRound,
  Users,
} from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge } from "@/components/ui/badge";
import { AttachmentsEditor, ThreadResources, type DraftFile, type DraftLink } from "@/components/communications/CommsResources";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AsyncState } from "@/components/dashboard/AsyncState";
import { useToast } from "@/hooks/use-toast";
import {
  CATEGORY_LABEL,
  PROVIDER_LABEL,
  STATUS_TONE,
  fetchAccessAudit,
  fetchCommsOverview,
  fetchThreadDetail,
  importPlatformHistory,
  syncMailbox,
  updateThread,
  type CommsAuditEvent,
  type CommsOverview,
  type CommsScope,
  type CommsThreadDetail,
  type CommsThreadRow,
  isCommsManager,
  amIUnifiedReader,
  ensureMyMailbox,
  sendWorkspaceEmail,
  type MyMailbox,
} from "@/lib/staff/communications";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";

type Panel = "inbox" | "compose" | "outbox" | "enquiries" | "notifications" | "accounts" | "audit";

const glass =
  "rounded-2xl border border-border/60 bg-card/70 backdrop-blur-xl shadow-[0_18px_50px_-30px_hsl(var(--primary)/0.55)]";

function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return `${Math.round(hrs / 24)} d ago`;
}

function Tile({
  label,
  value,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  icon: typeof Inbox;
  tone?: "neutral" | "info" | "warning" | "critical" | "positive";
}) {
  const ring: Record<string, string> = {
    neutral: "ring-border/60",
    info: "ring-[hsl(var(--status-info)/0.45)]",
    warning: "ring-[hsl(var(--status-warning)/0.5)]",
    critical: "ring-destructive/50",
    positive: "ring-[hsl(var(--status-success)/0.45)]",
  };
  return (
    <div className={`${glass} p-4 ring-1 ${ring[tone]}`}>
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <Icon className="h-4 w-4 text-primary" aria-hidden />
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

export default function Communications() {
  const { toast } = useToast();
  const { roles } = useAuth();
  // Privileged mail (management, finance, people, platform notifications) is a
  // manager-level surface. An ordinary employee only ever sees the mailboxes
  // explicitly granted to them, so the scope switch is not offered at all.
  const isManager = isCommsManager(roles);
  const [scope, setScope] = useState<CommsScope>(isManager ? "management" : "mine");
  const [panel, setPanel] = useState<Panel>("inbox");
  const [data, setData] = useState<CommsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [openThread, setOpenThread] = useState<CommsThreadDetail | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [audit, setAudit] = useState<CommsAuditEvent[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  // Only the named readers of the shared company mailboxes see a unified inbox.
  const [unifiedReader, setUnifiedReader] = useState(false);
  const [myMailbox, setMyMailbox] = useState<MyMailbox | null>(null);
  const [mailboxError, setMailboxError] = useState<string | null>(null);
  const [compose, setCompose] = useState({ to: "", cc: "", subject: "", body: "" });
  const [sending, setSending] = useState(false);
  const [draftFiles, setDraftFiles] = useState<DraftFile[]>([]);
  const [draftLinks, setDraftLinks] = useState<DraftLink[]>([]);

  useEffect(() => {
    void amIUnifiedReader().then(setUnifiedReader);
    ensureMyMailbox()
      .then((m) => {
        setMyMailbox(m);
        setMailboxError(null);
      })
      .catch((e: Error) => setMailboxError(e.message));
  }, []);

  const myFirstName = (myMailbox?.display_name ?? "").split(" ")[0];
  const inboxLabel = unifiedReader
    ? "Unified inbox"
    : myFirstName
      ? `${myFirstName}'s box`
      : "My box";

  const panels: { key: Panel; label: string; icon: typeof Inbox }[] = useMemo(
    () => [
      { key: "inbox", label: inboxLabel, icon: Inbox },
      { key: "compose", label: "Compose", icon: PenLine },
      { key: "outbox", label: "Sent / outbox", icon: MailCheck },
      { key: "enquiries", label: "Website enquiries", icon: Globe2 },
      { key: "notifications", label: "Notifications", icon: Bell },
      { key: "accounts", label: "Communication accounts", icon: Building2 },
      { key: "audit", label: "Access audit", icon: ShieldCheck },
    ],
    [inboxLabel],
  );

  const sendCompose = async () => {
    if (!myMailbox) return;
    setSending(true);
    try {
      await sendWorkspaceEmail({
        accountId: myMailbox.account_id,
        to: compose.to,
        cc: compose.cc,
        subject: compose.subject,
        body: compose.body,
        attachments: draftFiles.map(({ path, filename, mime }) => ({ path, filename, mime })),
        links: draftLinks,
      });
      setDraftFiles([]);
      setDraftLinks([]);
      toast({ title: "Email sent", description: `Delivered from ${myMailbox.mailbox_address}.` });
      setCompose({ to: "", cc: "", subject: "", body: "" });
      await load();
    } catch (e) {
      toast({ title: "Not sent", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };


  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchCommsOverview(scope));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    if (!isManager && scope !== "mine") setScope("mine");
  }, [isManager, scope]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (panel !== "audit") return;
    fetchAccessAudit().then(setAudit).catch(() => setAudit([]));
  }, [panel]);

  const threads = useMemo(() => {
    const all = data?.threads ?? [];
    const byPanel = all.filter((t) => {
      if (panel === "enquiries") return t.category === "enquiry";
      if (panel === "notifications") return t.category === "notification";
      if (panel === "outbox") return t.last_direction === "outbound";
      if (panel === "inbox") return t.category !== "notification";
      return true;
    });
    const q = query.trim().toLowerCase();
    if (!q) return byPanel;
    return byPanel.filter((t) =>
      [t.subject, t.counterparty_email, t.counterparty_name, t.mailbox_address, t.account_name]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [data, panel, query]);

  const series = useMemo(() => {
    const days: { day: string; inbound: number; outbound: number }[] = [];
    for (let i = 13; i >= 0; i -= 1) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push({ day: d.toISOString().slice(5, 10), inbound: 0, outbound: 0 });
    }
    for (const t of data?.threads ?? []) {
      const key = t.last_activity_at.slice(5, 10);
      const bucket = days.find((d) => d.day === key);
      if (!bucket) continue;
      bucket.inbound += t.inbound_count;
      bucket.outbound += t.outbound_count;
    }
    return days;
  }, [data]);

  const open = async (id: string) => {
    setThreadLoading(true);
    try {
      setOpenThread(await fetchThreadDetail(id));
    } catch (e) {
      toast({ title: "Cannot open", description: (e as Error).message, variant: "destructive" });
    } finally {
      setThreadLoading(false);
    }
  };

  const setStatus = async (threadId: string, status: string) => {
    try {
      await updateThread({ threadId, status });
      toast({ title: "Conversation updated" });
      await load();
      if (openThread?.thread?.id === threadId) await open(threadId);
    } catch (e) {
      toast({ title: "Update failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  const runSync = async (accountId: string) => {
    setBusy(accountId);
    try {
      const res = await syncMailbox(accountId);
      toast({
        title: res.status === "completed" ? "Mailbox synchronised" : "Mailbox not connected yet",
        description:
          res.status === "completed"
            ? `${res.ingested} message(s) brought in.`
            : "Connect this mailbox's provider account first, then synchronise again.",
        variant: res.status === "completed" ? undefined : "destructive",
      });
      await load();
    } catch (e) {
      toast({ title: "Synchronisation failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const runImport = async () => {
    setBusy("import");
    try {
      const res = await importPlatformHistory(90);
      toast({
        title: "Platform history imported",
        description: `${res.sent} sent message(s) and ${res.enquiries} website enquiry(ies).`,
      });
      await load();
    } catch (e) {
      toast({ title: "Import failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const tiles = data?.tiles;

  return (
    <div className="space-y-6">
      {/* Cinematic header */}
      <header className="relative overflow-hidden rounded-3xl border border-border/60 p-6 md:p-8">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(120%_120%_at_0%_0%,hsl(var(--primary)/0.35),transparent_60%),radial-gradient(100%_100%_at_100%_0%,hsl(var(--accent)/0.25),transparent_55%)]" />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
              <Activity className="h-3.5 w-3.5" aria-hidden /> Communication engine
            </p>
            <h1 className="mt-2 text-2xl font-semibold md:text-3xl">
              {scope === "management" && isManager ? "Management Communication Centre" : "My communications"}
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              {scope === "management" && isManager
                ? "Every authorised incoming and outgoing conversation across the organisation's mailboxes, with owner, status and a full access audit."
                : "Only the mailboxes assigned to you. Management, finance, people and platform notification mail is not shown here."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isManager && (
            <div className="flex rounded-xl border border-border/60 bg-card/60 p-1">
              {(["management", "mine"] as CommsScope[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setScope(s);
                    setOpenThread(null);
                  }}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition ${
                    scope === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {s === "management" ? <Users className="h-3.5 w-3.5" /> : <UserRound className="h-3.5 w-3.5" />}
                  {s === "management" ? "Management centre" : "My communications"}
                </button>
              ))}
            </div>
            )}
            <Button variant="outline" size="sm" className="gap-2" onClick={() => void load()}>
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </Button>
          </div>
        </div>
      </header>

      <AsyncState loading={loading} error={error} onRetry={() => void load()}>
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <Tile label="Conversations" value={tiles?.total ?? 0} icon={Mail} />
            <Tile label="Unread" value={tiles?.unread ?? 0} icon={Inbox} tone="info" />
            <Tile label="Pending" value={tiles?.pending ?? 0} icon={Bell} tone="warning" />
            <Tile label="Escalated" value={tiles?.escalated ?? 0} icon={Siren} tone="critical" />
            <Tile label="Incoming messages" value={tiles?.inbound ?? 0} icon={ArrowDownLeft} tone="info" />
            <Tile label="Outgoing messages" value={tiles?.outbound ?? 0} icon={ArrowUpRight} tone="positive" />
          </div>

          <div className={`${glass} mt-4 p-4`}>
            <p className="text-sm font-medium">Fourteen-day communication flow</p>
            <div className="mt-3 h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={series}>
                  <defs>
                    <linearGradient id="inFlow" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--status-info))" stopOpacity={0.55} />
                      <stop offset="100%" stopColor="hsl(var(--status-info))" stopOpacity={0.04} />
                    </linearGradient>
                    <linearGradient id="outFlow" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.04} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 12,
                      fontSize: 12,
                    }}
                  />
                  <Area type="monotone" dataKey="inbound" name="Incoming" stroke="hsl(var(--status-info))" fill="url(#inFlow)" />
                  <Area type="monotone" dataKey="outbound" name="Outgoing" stroke="hsl(var(--primary))" fill="url(#outFlow)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Panel switcher */}
          <div className="mt-4 flex flex-wrap gap-2">
            {panels
              .filter((p) => (isManager && scope === "management") || !["accounts", "audit"].includes(p.key))
              .map((p) => {
              const Icon = p.icon;
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setPanel(p.key)}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition ${
                    panel === p.key
                      ? "border-primary/60 bg-primary/10 text-foreground"
                      : "border-border/60 bg-card/50 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4" aria-hidden /> {p.label}
                </button>
              );
            })}
          </div>

          {panel === "compose" && (
            <div className={`${glass} mt-4 max-w-3xl overflow-hidden`}>
              <div className="border-b border-border/60 p-4">
                <p className="font-medium">Compose</p>
                <p className="text-xs text-muted-foreground">
                  {myMailbox
                    ? `Sent from your own mailbox, ${myMailbox.mailbox_address}. Replies come back to you.`
                    : mailboxError ?? "Preparing your mailbox…"}
                </p>
              </div>
              <div className="space-y-3 p-4">
                <Input
                  value={compose.to}
                  onChange={(e) => setCompose((c) => ({ ...c, to: e.target.value }))}
                  placeholder="To (separate several addresses with a comma)"
                />
                <Input
                  value={compose.cc}
                  onChange={(e) => setCompose((c) => ({ ...c, cc: e.target.value }))}
                  placeholder="Copy to (optional)"
                />
                <Input
                  value={compose.subject}
                  onChange={(e) => setCompose((c) => ({ ...c, subject: e.target.value }))}
                  placeholder="Subject"
                />
                <Textarea
                  value={compose.body}
                  onChange={(e) => setCompose((c) => ({ ...c, body: e.target.value }))}
                  placeholder="Write your message"
                  rows={10}
                />
                <AttachmentsEditor files={draftFiles} links={draftLinks} onFiles={setDraftFiles} onLinks={setDraftLinks} />
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    Every email you send is recorded on the conversation history.
                  </p>
                  <Button className="gap-2" disabled={sending || !myMailbox} onClick={() => void sendCompose()}>
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    Send email
                  </Button>
                </div>
                {mailboxError && <p className="text-sm text-destructive">{mailboxError}</p>}
              </div>
            </div>
          )}

          {panel === "accounts" && (
            <div className={`${glass} mt-4 overflow-hidden`}>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 p-4">
                <div>
                  <p className="font-medium">Communication accounts</p>
                  <p className="text-xs text-muted-foreground">
                    Mailbox credentials are never stored here — providers are connected through secure credentials.
                  </p>
                </div>
                <Button size="sm" variant="outline" className="gap-2" disabled={busy === "import"} onClick={() => void runImport()}>
                  {busy === "import" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Import platform history
                </Button>
              </div>
              <div className="divide-y divide-border/60">
                {(data?.accounts ?? []).map((a) => (
                  <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{a.display_name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {a.mailbox_address} · {PROVIDER_LABEL[a.provider]}
                        {a.department ? ` · ${a.department}` : ""}
                      </p>
                      {a.last_sync_error && (
                        <p className="mt-1 text-xs text-destructive">Last attempt: {a.last_sync_error}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="capitalize">
                        {a.status.replace("_", " ")}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {a.last_sync_at ? `Synced ${timeAgo(a.last_sync_at)}` : "Never synced"}
                      </span>
                      <Button size="sm" variant="outline" className="gap-2" disabled={busy === a.id} onClick={() => void runSync(a.id)}>
                        {busy === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                        Synchronise
                      </Button>
                    </div>
                  </div>
                ))}
                {(data?.accounts ?? []).length === 0 && (
                  <p className="p-6 text-sm text-muted-foreground">No mailbox is authorised for your role.</p>
                )}
              </div>
            </div>
          )}

          {panel === "audit" && (
            <div className={`${glass} mt-4 overflow-hidden`}>
              <div className="border-b border-border/60 p-4">
                <p className="font-medium">Access audit</p>
                <p className="text-xs text-muted-foreground">
                  Every conversation opened, assigned or exported — including privileged access — is recorded and cannot be edited.
                </p>
              </div>
              <div className="max-h-[28rem] divide-y divide-border/60 overflow-auto">
                {audit.map((e) => (
                  <div key={e.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                    <span className="truncate">
                      <span className="font-medium">{e.actor_email ?? "unknown"}</span>{" "}
                      <span className="text-muted-foreground">{e.action.replace(/_/g, " ")}</span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(e.created_at)}</span>
                  </div>
                ))}
                {audit.length === 0 && <p className="p-6 text-sm text-muted-foreground">No access events recorded yet.</p>}
              </div>
            </div>
          )}

          {panel !== "accounts" && panel !== "audit" && panel !== "compose" && (
            <div className="mt-4 grid gap-4 lg:grid-cols-[1.15fr_1fr]">
              <div className={`${glass} overflow-hidden`}>
                <div className="flex items-center gap-2 border-b border-border/60 p-3">
                  <Search className="h-4 w-4 text-muted-foreground" aria-hidden />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search subject, sender or mailbox"
                    className="h-9 border-0 bg-transparent focus-visible:ring-0"
                  />
                  <Badge variant="outline">{threads.length}</Badge>
                </div>
                <div className="max-h-[34rem] divide-y divide-border/60 overflow-auto">
                  {threads.map((t: CommsThreadRow) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => void open(t.id)}
                      className={`w-full p-4 text-left transition hover:bg-primary/5 ${
                        openThread?.thread?.id === t.id ? "bg-primary/10" : ""
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{t.subject}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {t.counterparty_name || t.counterparty_email || "—"} · {t.account_name}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <Badge className={STATUS_TONE[t.status]} variant="outline">
                            {t.status}
                          </Badge>
                          <span className="text-[11px] text-muted-foreground">{timeAgo(t.last_activity_at)}</span>
                        </div>
                      </div>
                      <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <ArrowDownLeft className="h-3 w-3" /> {t.inbound_count}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <ArrowUpRight className="h-3 w-3" /> {t.outbound_count}
                        </span>
                        <span>{CATEGORY_LABEL[t.category]}</span>
                        <span>{t.owner_name ? `Owner: ${t.owner_name}` : "Unassigned"}</span>
                      </div>
                    </button>
                  ))}
                  {threads.length === 0 && (
                    <p className="p-6 text-sm text-muted-foreground">
                      Nothing here yet for this view.
                    </p>
                  )}
                </div>
              </div>

              <div className={`${glass} overflow-hidden`}>
                {threadLoading && (
                  <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Opening conversation…
                  </div>
                )}
                {!threadLoading && !openThread && (
                  <div className="flex h-full flex-col items-center justify-center gap-2 p-10 text-center text-muted-foreground">
                    <Mail className="h-6 w-6" aria-hidden />
                    <p className="text-sm">Select a conversation to see every message on both sides.</p>
                  </div>
                )}
                {!threadLoading && openThread?.thread && (
                  <>
                    <div className="border-b border-border/60 p-4">
                      <p className="font-medium">{openThread.thread.subject}</p>
                      <p className="text-xs text-muted-foreground">
                        {openThread.thread.counterparty_email ?? "—"} · {openThread.thread.account_name} ·{" "}
                        {openThread.thread.mailbox_address}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {["pending", "replied", "escalated", "closed"].map((s) => (
                          <Button
                            key={s}
                            size="sm"
                            variant={openThread.thread?.status === s ? "default" : "outline"}
                            onClick={() => void setStatus(openThread.thread!.id, s)}
                          >
                            {s === "escalated" ? "Escalate" : s === "closed" ? "Close" : `Mark ${s}`}
                          </Button>
                        ))}
                      </div>
                    </div>
                    <ThreadResources threadId={openThread.thread.id} />
                    <div className="max-h-[30rem] space-y-3 overflow-auto p-4">
                      {openThread.messages.map((m) => (
                        <div
                          key={m.id}
                          className={`rounded-xl border p-3 text-sm ${
                            m.direction === "inbound"
                              ? "border-[hsl(var(--status-info)/0.4)] bg-[hsl(var(--status-info)/0.06)]"
                              : "border-primary/40 bg-primary/5"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                            <span className="inline-flex items-center gap-1">
                              {m.direction === "inbound" ? (
                                <ArrowDownLeft className="h-3 w-3" />
                              ) : (
                                <ArrowUpRight className="h-3 w-3" />
                              )}
                              {m.from_address ?? "—"} → {m.to_addresses.join(", ") || "—"}
                            </span>
                            <span>{new Date(m.occurred_at).toLocaleString()}</span>
                          </div>
                          {m.subject && <p className="mt-1 font-medium">{m.subject}</p>}
                          <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{m.body_preview || "(no preview)"}</p>
                          {m.delivery_status && (
                            <p className="mt-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                              Delivery: {m.delivery_status}
                            </p>
                          )}
                        </div>
                      ))}
                      {openThread.messages.length === 0 && (
                        <p className="text-sm text-muted-foreground">No messages recorded on this conversation.</p>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </>
      </AsyncState>
    </div>
  );
}
