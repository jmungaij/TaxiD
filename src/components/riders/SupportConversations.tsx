import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SupportThreadView } from "@/components/support/SupportThreadView";

interface Thread { id: string; rider_email: string; subject: string; status: string; updated_at: string }

/** Staff view of rider support conversations, including rider replies. */
export function SupportConversations() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.from("support_threads")
        .select("id, rider_email, subject, status, updated_at")
        .order("updated_at", { ascending: false }).limit(100);
      setThreads((data ?? []) as Thread[]);
    })();
  }, [tick]);

  async function toggle(t: Thread) {
    await supabase.from("support_threads").update({ status: t.status === "open" ? "closed" : "open" }).eq("id", t.id);
    setTick((n) => n + 1);
  }

  const current = threads.find((t) => t.id === selected);
  if (threads.length === 0) return <p className="text-sm text-muted-foreground">No conversations yet. Send a draft to a rider to start one.</p>;

  return (
    <div className="grid gap-4 md:grid-cols-[18rem_1fr]">
      <ul className="rounded-lg border p-2">
        {threads.map((t) => (
          <li key={t.id}>
            <button onClick={() => setSelected(t.id)}
              className={`w-full rounded-md p-2 text-left text-sm ${t.id === selected ? "bg-muted" : "hover:bg-muted/50"}`}>
              <div className="font-medium line-clamp-1">{t.subject}</div>
              <div className="text-xs text-muted-foreground">{t.rider_email}</div>
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
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="font-semibold">{current.subject}</h3>
              <Button size="sm" variant="outline" onClick={() => void toggle(current)}>
                {current.status === "open" ? "Close" : "Reopen"}
              </Button>
            </div>
            <SupportThreadView key={current.id} threadId={current.id} viewer="staff" canReply={current.status === "open"} />
          </>
        ) : <p className="text-sm text-muted-foreground">Pick a conversation to read the rider's replies.</p>}
      </div>
    </div>
  );
}
