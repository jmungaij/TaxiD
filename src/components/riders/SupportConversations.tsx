import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SupportThreadView } from "@/components/support/SupportThreadView";

interface Thread {
  id: string; rider_email: string; subject: string; status: string; updated_at: string;
  assigned_agent_id: string | null; assigned_at: string | null;
}
interface Agent { user_id: string; email: string; open_cases: number }
interface AssignmentEvent {
  id: string; event_type: string; from_agent_id: string | null; to_agent_id: string | null;
  source: string; note: string | null; created_at: string;
}

type Scope = "mine" | "all" | "unassigned";
const UNASSIGNED = "__none__";

/** Staff view of rider support cases: assignment to agents, tracking history and replies. */
export function SupportConversations() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [events, setEvents] = useState<AssignmentEvent[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>("mine");
  const [selected, setSelected] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { data: u } = await supabase.auth.getUser();
      setMe(u.user?.id ?? null);
      const { data: a } = await supabase.rpc("list_support_agents");
      setAgents(((a ?? []) as Agent[]));
    })();
  }, [tick]);

  useEffect(() => {
    void (async () => {
      let q = supabase.from("support_threads")
        .select("id, rider_email, subject, status, updated_at, assigned_agent_id, assigned_at")
        .order("updated_at", { ascending: false }).limit(100);
      if (scope === "mine" && me) q = q.eq("assigned_agent_id", me);
      if (scope === "unassigned") q = q.is("assigned_agent_id", null);
      const { data, error: err } = await q;
      if (err) setError(err.message);
      setThreads((data ?? []) as Thread[]);
    })();
  }, [tick, scope, me]);

  useEffect(() => {
    if (!selected) { setEvents([]); return; }
    void (async () => {
      const { data } = await supabase.from("support_assignment_events")
        .select("id, event_type, from_agent_id, to_agent_id, source, note, created_at")
        .eq("thread_id", selected).order("created_at", { ascending: false }).limit(50);
      setEvents((data ?? []) as AssignmentEvent[]);
    })();
  }, [selected, tick]);

  const agentLabel = (id: string | null) =>
    id ? (agents.find((a) => a.user_id === id)?.email ?? "Unknown agent") : "Unassigned";

  async function toggle(t: Thread) {
    const { error: err } = await supabase.from("support_threads")
      .update({ status: t.status === "open" ? "closed" : "open" }).eq("id", t.id);
    if (err) setError(err.message);
    setTick((n) => n + 1);
  }

  async function assign(t: Thread, value: string) {
    const agentId = value === UNASSIGNED ? null : value;
    const { error: err } = await supabase.from("support_threads")
      .update({ assigned_agent_id: agentId, assigned_at: agentId ? new Date().toISOString() : null })
      .eq("id", t.id);
    if (err) setError(err.message);
    setTick((n) => n + 1);
  }

  const current = threads.find((t) => t.id === selected);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {(["mine", "all", "unassigned"] as Scope[]).map((s) => (
          <Button key={s} size="sm" variant={scope === s ? "default" : "outline"} onClick={() => setScope(s)}>
            {s === "mine" ? "My cases" : s === "all" ? "All cases" : "Unassigned"}
          </Button>
        ))}
        {error && <span className="text-sm text-destructive">{error}</span>}
      </div>

      {threads.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {scope === "mine" ? "No cases are assigned to you right now." : "No conversations yet. Send a draft to a rider to start one."}
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-[18rem_1fr]">
          <ul className="rounded-lg border p-2">
            {threads.map((t) => (
              <li key={t.id}>
                <button onClick={() => setSelected(t.id)}
                  className={`w-full rounded-md p-2 text-left text-sm ${t.id === selected ? "bg-muted" : "hover:bg-muted/50"}`}>
                  <div className="font-medium line-clamp-1">{t.subject}</div>
                  <div className="text-xs text-muted-foreground">{t.rider_email}</div>
                  <div className="text-xs text-muted-foreground line-clamp-1">Agent: {agentLabel(t.assigned_agent_id)}</div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant={t.status === "open" ? "default" : "secondary"}>{t.status}</Badge>
                    {formatDistanceToNow(new Date(t.updated_at), { addSuffix: true })}
                  </div>
                </button>
              </li>
            ))}
          </ul>
          <div className="rounded-lg border p-4">
            {current ? (
              <>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold">{current.subject}</h3>
                  <div className="flex items-center gap-2">
                    <Select value={current.assigned_agent_id ?? UNASSIGNED} onValueChange={(v) => void assign(current, v)}>
                      <SelectTrigger className="h-8 w-56" aria-label="Assigned agent"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                        {agents.map((a) => (
                          <SelectItem key={a.user_id} value={a.user_id}>{a.email} ({a.open_cases} open)</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button size="sm" variant="outline" onClick={() => void toggle(current)}>
                      {current.status === "open" ? "Close" : "Reopen"}
                    </Button>
                  </div>
                </div>
                <SupportThreadView key={current.id} threadId={current.id} viewer="staff" canReply={current.status === "open"} />
                <div className="mt-4 border-t pt-3">
                  <h4 className="mb-2 text-sm font-medium">Case history</h4>
                  {events.length === 0 ? <p className="text-xs text-muted-foreground">No activity recorded yet.</p> : (
                    <ul className="space-y-1 text-xs text-muted-foreground">
                      {events.map((e) => (
                        <li key={e.id}>
                          <span className="text-foreground">{describe(e, agentLabel)}</span>
                          {e.source === "mcp" && <Badge variant="outline" className="ml-2">via AI assistant</Badge>}
                          <span className="ml-2">{formatDistanceToNow(new Date(e.created_at), { addSuffix: true })}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            ) : <p className="text-sm text-muted-foreground">Pick a case to read the rider's replies.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function describe(e: AssignmentEvent, label: (id: string | null) => string): string {
  switch (e.event_type) {
    case "assigned": return `Assigned to ${label(e.to_agent_id)}`;
    case "reassigned": return `Moved from ${label(e.from_agent_id)} to ${label(e.to_agent_id)}`;
    case "unassigned": return `Unassigned from ${label(e.from_agent_id)}`;
    case "status_changed": return `Status: ${e.note ?? "changed"}`;
    case "agent_reply": return `Agent replied${e.note ? `: ${e.note}` : ""}`;
    default: return e.event_type;
  }
}
