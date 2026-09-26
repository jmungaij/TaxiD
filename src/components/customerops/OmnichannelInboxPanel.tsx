/**
 * Customer Operations — Omnichannel unified inbox panel.
 *
 * Merges every touchpoint into one conversation thread per customer + topic so
 * an agent sees a single history instead of channel silos.
 */
import { useMemo, useState } from "react";
import { MessageSquare, Radio, Inbox, Layers } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import StatCard from "@/components/common/StatCard";
import { SectionErrorBoundary } from "@/components/dashboard/SectionErrorBoundary";
import {
  activeChatCount,
  channelLabel,
  channelMix,
  unifyThreads,
  type Interaction,
} from "@/lib/customerops/channels";
import {
  THREAD_STATUS_LABEL,
  triageQueue,
  triageSummary,
  type ThreadPriority,
} from "@/lib/customerops/threadTriage";

const fmt = (iso: string) => new Date(iso).toLocaleString();

const priorityTone: Record<ThreadPriority, string> = {
  urgent: "border-destructive/40 text-destructive",
  high: "border-status-warning/40 text-status-warning",
  medium: "border-primary/40 text-primary",
  low: "border-border text-muted-foreground",
};

export function OmnichannelInboxPanel({ interactions }: { interactions: Interaction[] }) {
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const threads = useMemo(() => unifyThreads(interactions), [interactions]);
  const mix = useMemo(() => channelMix(interactions), [interactions]);
  const live = useMemo(() => activeChatCount(threads), [threads]);
  const triaged = useMemo(() => triageQueue(threads), [threads]);
  const triageStats = useMemo(() => triageSummary(triaged), [triaged]);
  const triageByKey = useMemo(() => new Map(triaged.map((r) => [r.key, r])), [triaged]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const ordered = triaged.map((r) => r.thread);
    if (!q) return ordered;
    return ordered.filter(
      (t) =>
        t.subject.toLowerCase().includes(q) ||
        t.customerKey.toLowerCase().includes(q) ||
        t.caseIds.some((id) => id.toLowerCase().includes(q)),
    );
  }, [triaged, query]);

  const selected = visible.find((t) => t.key === selectedKey) ?? visible[0] ?? null;

  return (
    <SectionErrorBoundary sectionName="Omnichannel Inbox">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            title="Unified threads"
            value={threads.length}
            icon={<Inbox className="h-5 w-5 text-primary" />}
            description="One thread per customer topic"
          />
          <StatCard
            title="Cross-channel threads"
            value={threads.filter((t) => t.crossChannel).length}
            icon={<Layers className="h-5 w-5 text-primary" />}
            description="Merged from two or more channels"
          />
          <StatCard
            title="Awaiting agent reply"
            value={threads.filter((t) => t.awaitingReply).length}
            icon={<MessageSquare className="h-5 w-5 text-primary" />}
            description="Last message came from the customer"
          />
          <StatCard
            title="Live conversations"
            value={live}
            icon={<Radio className="h-5 w-5 text-primary" />}
            description="Open on a realtime channel"
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Triage status</CardTitle>
            <p className="text-xs text-muted-foreground">
              One consistent status, priority and next-best-action across every channel.
            </p>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm sm:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">Urgent</p>
              <p className="text-lg font-semibold">{triageStats.urgent}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Awaiting agent</p>
              <p className="text-lg font-semibold">{triageStats.awaitingAgent}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">SLA at risk</p>
              <p className="text-lg font-semibold">{triageStats.slaAtRisk}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Longest wait</p>
              <p className="text-lg font-semibold">{triageStats.longestWaitMinutes}m</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Channel mix</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {mix.map((row) => (
              <div key={row.channel} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 font-medium">
                    {row.label}
                    {row.realtime && <Badge variant="outline">live</Badge>}
                  </span>
                  <span className="text-muted-foreground">
                    {row.count} · {row.share}%
                  </span>
                </div>
                <Progress value={row.share} />
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_1fr]">
          <Card>
            <CardHeader className="gap-2">
              <CardTitle className="text-base">Conversations</CardTitle>
              <div>
                <Label htmlFor="cops-thread-search" className="sr-only">
                  Search conversations
                </Label>
                <Input
                  id="cops-thread-search"
                  placeholder="Search customer, subject or case"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[420px]">
                <div className="divide-y">
                  {visible.length === 0 ? (
                    <p className="p-4 text-sm text-muted-foreground">No conversations match this filter.</p>
                  ) : (
                    visible.map((t) => (
                      <Button
                        key={t.key}
                        type="button"
                        variant="ghost"
                        onClick={() => setSelectedKey(t.key)}
                        className={`h-auto w-full justify-start rounded-none px-4 py-3 text-left ${
                          selected?.key === t.key ? "bg-muted" : ""
                        }`}
                      >
                        <span className="block w-full space-y-1">
                          <span className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-medium">{t.subject}</span>
                            {triageByKey.get(t.key) && (
                              <Badge
                                variant="outline"
                                className={priorityTone[triageByKey.get(t.key)!.priority]}
                              >
                                {triageByKey.get(t.key)!.priority}
                              </Badge>
                            )}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {t.customerKey} · {t.interactions.length} messages
                            {triageByKey.get(t.key)?.waitingMinutes
                              ? ` · waiting ${triageByKey.get(t.key)!.waitingMinutes}m`
                              : ""}
                          </span>
                          <span className="flex flex-wrap gap-1">
                            {triageByKey.get(t.key) && (
                              <Badge variant="secondary" className="text-[10px]">
                                {THREAD_STATUS_LABEL[triageByKey.get(t.key)!.status]}
                              </Badge>
                            )}
                            {triageByKey.get(t.key)?.slaAtRisk && (
                              <Badge variant="destructive" className="text-[10px]">
                                SLA at risk
                              </Badge>
                            )}
                            {t.channels.map((c) => (
                              <Badge key={c} variant="outline" className="text-[10px]">
                                {channelLabel(c)}
                              </Badge>
                            ))}
                          </span>
                        </span>
                      </Button>
                    ))
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {selected ? selected.subject : "Unified conversation"}
              </CardTitle>
              {selected && (
                <p className="text-xs text-muted-foreground">
                  {selected.customerKey} · {selected.inbound} inbound · {selected.outbound} outbound ·
                  {" "}first contact {fmt(selected.firstAt)}
                  {selected.caseIds.length > 0 ? ` · cases ${selected.caseIds.join(", ")}` : ""}
                </p>
              )}
              {selected && triageByKey.get(selected.key) && (
                <div className="space-y-2 pt-2">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary">
                      {THREAD_STATUS_LABEL[triageByKey.get(selected.key)!.status]}
                    </Badge>
                    <Badge variant="outline" className={priorityTone[triageByKey.get(selected.key)!.priority]}>
                      {triageByKey.get(selected.key)!.priority} priority
                    </Badge>
                    <Badge variant="outline">
                      reply on {channelLabel(triageByKey.get(selected.key)!.replyChannel)}
                    </Badge>
                    {triageByKey.get(selected.key)!.slaAtRisk && (
                      <Badge variant="destructive">SLA at risk</Badge>
                    )}
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-sm font-medium">Next best action</p>
                    <p className="text-sm text-muted-foreground">
                      {triageByKey.get(selected.key)!.nextBestAction}
                    </p>
                    {triageByKey.get(selected.key)!.reasons.length > 0 && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Why: {triageByKey.get(selected.key)!.reasons.join(" · ")}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </CardHeader>
            <CardContent>
              {!selected ? (
                <p className="text-sm text-muted-foreground">
                  Select a conversation to see the merged cross-channel history.
                </p>
              ) : (
                <ScrollArea className="h-[420px] pr-3">
                  <ol className="space-y-3">
                    {selected.interactions.map((it) => (
                      <li
                        key={it.id}
                        className={`rounded-lg border p-3 ${
                          it.direction === "inbound" ? "bg-muted/40" : "bg-background"
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                          <span className="flex items-center gap-2">
                            <Badge variant={it.direction === "inbound" ? "secondary" : "outline"}>
                              {it.direction}
                            </Badge>
                            <Badge variant="outline">{channelLabel(it.channel)}</Badge>
                            {it.authorName && <span>{it.authorName}</span>}
                          </span>
                          <span>{fmt(it.at)}</span>
                        </div>
                        {it.subject && <p className="mt-2 text-sm font-medium">{it.subject}</p>}
                        {it.body && <p className="mt-1 whitespace-pre-wrap text-sm">{it.body}</p>}
                      </li>
                    ))}
                  </ol>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </SectionErrorBoundary>
  );
}

export default OmnichannelInboxPanel;
