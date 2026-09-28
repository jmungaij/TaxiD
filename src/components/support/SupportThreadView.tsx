import { useCallback, useEffect, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export interface SupportMessage {
  id: string;
  sender_role: "staff" | "rider";
  body: string;
  created_at: string;
}

/** Message history + reply box for one support conversation. */
export function SupportThreadView({
  threadId, viewer, canReply,
}: { threadId: string; viewer: "staff" | "rider"; canReply: boolean }) {
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: err } = await supabase
      .from("support_messages")
      .select("id, sender_role, body, created_at")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true });
    if (err) setError(err.message);
    else setMessages((data ?? []) as SupportMessage[]);
    setLoading(false);
  }, [threadId]);

  useEffect(() => {
    setLoading(true);
    void load();
    const t = setInterval(() => void load(), 15000);
    return () => clearInterval(t);
  }, [load]);

  async function send() {
    const body = reply.trim();
    if (!body) return;
    setSending(true);
    setError(null);
    const { data: u } = await supabase.auth.getUser();
    const { error: err } = await supabase.from("support_messages").insert({
      thread_id: threadId, sender_role: viewer, body, sender_id: u.user?.id,
    });
    setSending(false);
    if (err) { setError("Couldn't send your reply. Please try again."); return; }
    setReply("");
    void load();
  }

  if (loading) return <div className="p-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>;

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3">
        {messages.map((m) => {
          const mine = m.sender_role === viewer;
          return (
            <li key={m.id} className={`max-w-[85%] rounded-lg border p-3 text-sm ${mine ? "self-end bg-primary/10" : "self-start bg-muted/40"}`}>
              <div className="mb-1 text-xs text-muted-foreground">
                {m.sender_role === "staff" ? "TaxiD Support" : "Rider"} · {formatDistanceToNow(new Date(m.created_at), { addSuffix: true })}
              </div>
              <p className="whitespace-pre-wrap">{m.body}</p>
            </li>
          );
        })}
        {messages.length === 0 && <li className="text-sm text-muted-foreground">No messages yet.</li>}
      </ul>
      {canReply ? (
        <div className="flex flex-col gap-2">
          <Textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={3} maxLength={8000}
            placeholder="Write a reply…" aria-label="Reply" />
          <Button className="self-end gap-2" onClick={() => void send()} disabled={sending || !reply.trim()}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send reply
          </Button>
        </div>
      ) : <p className="text-sm text-muted-foreground">This conversation is closed.</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
