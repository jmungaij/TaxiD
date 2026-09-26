/**
 * STAGE 7b — WORKSPACE INBOX surface.
 *
 * Real mail in the workspace: sender, subject, date and body, read through the
 * authorised server functions only. Privileged mailboxes never appear here
 * because the read is always scoped to the caller's own mailboxes.
 */
import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { Inbox, Loader2, Mail, RefreshCw, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { WorkspaceEmptyState } from "@/components/staff/workspace/WorkspaceEmptyState";
import { CATEGORY_LABEL, STATUS_TONE } from "@/lib/staff/communications";
import {
  fetchEmailThread,
  fetchWorkspaceInbox,
  type EmailThread,
  type InboxEmail,
  type InboxResult,
} from "@/lib/workspace/inbox";
import { logThreadToCrm } from "@/lib/workspace/crmEmail";
import { cn } from "@/lib/utils";

const when = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

const senderLabel = (email: InboxEmail): string =>
  email.senderName || email.senderEmail || `${email.mailboxName} mailbox`;

export default function WorkspaceInbox() {
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("thread");
  const [inbox, setInbox] = React.useState<InboxResult | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [query, setQuery] = React.useState("");
  const [thread, setThread] = React.useState<EmailThread | null>(null);
  const [threadLoading, setThreadLoading] = React.useState(false);
  const [crmNote, setCrmNote] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    setLoading(true);
    void fetchWorkspaceInbox().then((result) => {
      setInbox(result);
      setLoading(false);
    });
  }, []);

  React.useEffect(load, [load]);

  React.useEffect(() => {
    if (!selectedId) {
      setThread(null);
      setCrmNote(null);
      return;
    }
    setThreadLoading(true);
    setCrmNote(null);
    void fetchEmailThread(selectedId).then(async (t) => {
      setThread(t);
      setThreadLoading(false);
      if (!t.authorised || t.messages.length === 0) return;
      // Every email read here becomes a CRM interaction, recorded once, by the server.
      const result = await logThreadToCrm(t.messages.map((m) => m.messageId));
      setCrmNote(
        result.error
          ? `Not recorded in the customer record: ${result.error}`
          : result.matched > 0
            ? `Saved to the customer record${result.recorded > 0 ? ` — ${result.recorded} new entry(ies)` : " (already saved)"}.`
            : "Not linked to a customer yet — this sender does not match any account or contact.",
      );
    });
  }, [selectedId]);

  const select = (threadId: string) => {
    const next = new URLSearchParams(params);
    next.set("thread", threadId);
    setParams(next, { replace: true });
  };

  const emails = React.useMemo(() => {
    const all = inbox?.emails ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((e) =>
      [e.subject, e.senderName, e.senderEmail, e.mailbox, e.mailboxName]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [inbox, query]);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
          <p className="text-sm text-muted-foreground">
            Your real mail, in the workspace — sender, subject, date and body. Only the mailboxes released to your
            account.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          {loading ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden />
          )}
          Refresh
        </Button>
      </header>

      {inbox && !inbox.authorised ? (
        <WorkspaceEmptyState
          title="Mail could not be read for your account"
          message={inbox.error ?? "No mailbox is released to your login yet, so nothing is shown here."}
          actions={[{ label: "Back to my work queue", to: "/staff/workspace/work-queue" }]}
        />
      ) : (
        <>
          {inbox && inbox.mailboxes.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Mail className="h-3.5 w-3.5" aria-hidden />
              Reading:
              {inbox.mailboxes.map((m) => (
                <Badge key={m.address} variant="outline" className="text-[10px]">
                  {m.name} · {m.address}
                </Badge>
              ))}
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
            <Card>
              <CardContent className="space-y-3 p-3">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search sender or subject"
                    className="pl-8"
                    aria-label="Search your mail"
                  />
                </div>

                {loading && !inbox ? (
                  <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Reading your mail…
                  </div>
                ) : emails.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    {query ? "No message matches that." : "No mail has arrived in your mailboxes yet."}
                  </p>
                ) : (
                  <ScrollArea className="h-[28rem] pr-2">
                    <ul className="space-y-1">
                      {emails.map((email) => (
                        <li key={email.threadId}>
                          <button
                            type="button"
                            onClick={() => select(email.threadId)}
                            aria-current={selectedId === email.threadId}
                            className={cn(
                              "w-full rounded-md border p-2.5 text-left transition-colors",
                              selectedId === email.threadId ? "border-primary bg-primary/5" : "hover:bg-muted/60",
                            )}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <p className={cn("min-w-0 truncate text-sm", email.unread && "font-semibold")}>
                                {senderLabel(email)}
                              </p>
                              <span className="shrink-0 text-[11px] text-muted-foreground">
                                {when(email.receivedAt)}
                              </span>
                            </div>
                            <p className="mt-0.5 truncate text-sm text-foreground">{email.subject}</p>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              <Badge variant="outline" className={cn("text-[10px]", STATUS_TONE[email.status])}>
                                {email.status}
                              </Badge>
                              <span className="text-[11px] text-muted-foreground">
                                {CATEGORY_LABEL[email.category]} · {email.mailboxName} · {email.messageCount} message(s)
                              </span>
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                {!selectedId ? (
                  <div className="flex h-full min-h-[20rem] flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
                    <Inbox className="h-6 w-6" aria-hidden />
                    Choose a message to read it here in full.
                  </div>
                ) : threadLoading ? (
                  <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Opening the conversation…
                  </div>
                ) : thread && !thread.authorised ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">{thread.error}</p>
                ) : thread ? (
                  <div className="space-y-3">
                    <div>
                      <h2 className="text-lg font-semibold leading-snug">{thread.subject}</h2>
                      <p className="text-xs text-muted-foreground">
                        {[thread.senderName, thread.senderEmail].filter(Boolean).join(" · ") || "Unknown sender"}
                        {thread.mailbox ? ` → ${thread.mailbox}` : ""}
                      </p>
                      {crmNote && (
                        <p className="mt-1.5 text-[11px] text-muted-foreground">{crmNote}</p>
                      )}
                    </div>
                    <Separator />
                    <ScrollArea className="h-[26rem] pr-2">
                      <div className="space-y-3">
                        {thread.messages.map((m) => (
                          <div key={m.messageId} className="rounded-md border p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-sm font-medium">{m.fromLabel}</p>
                              <span className="text-[11px] text-muted-foreground">{when(m.occurredAt)}</span>
                            </div>
                            <p className="mt-0.5 text-[11px] text-muted-foreground">
                              To {m.toLabel}
                              {m.hasAttachments ? " · has attachments" : ""}
                              {m.direction === "outbound" ? " · sent" : ""}
                            </p>
                            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                              {m.body}
                            </p>
                          </div>
                        ))}
                        {thread.messages.length === 0 && (
                          <p className="py-6 text-center text-sm text-muted-foreground">
                            This conversation has no readable messages.
                          </p>
                        )}
                      </div>
                    </ScrollArea>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
