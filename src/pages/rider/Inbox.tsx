import { useEffect, useState } from "react";
import { Inbox as InboxIcon, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { RiderShell } from "@/components/rider/RiderShell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { SupportThreadView } from "@/components/support/SupportThreadView";

interface Thread { id: string; subject: string; status: string; updated_at: string }

export default function RiderInboxPage() {
  const { user } = useAuth();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data, error: err } = await supabase
        .from("support_threads")
        .select("id, subject, status, updated_at")
        .order("updated_at", { ascending: false });
      if (err) setError("Couldn't load your messages.");
      const rows = (data ?? []) as Thread[];
      setThreads(rows);
      setSelected((s) => s ?? rows[0]?.id ?? null);
      setLoading(false);
    })();
  }, [user]);

  const current = threads.find((t) => t.id === selected);

  return (
    <RiderShell>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <InboxIcon className="h-5 w-5 text-primary" />
          <h1 className="text-2xl font-semibold">Support inbox</h1>
        </div>
        <p className="text-sm text-muted-foreground">Replies from SAFARID Support about your trips. You can answer here directly.</p>
        {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : error ? (
          <p role="alert" className="text-sm text-destructive">{error}</p>
        ) : threads.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground">You have no support messages yet.</Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-[18rem_1fr]">
            <Card className="p-2">
              <ul>
                {threads.map((t) => (
                  <li key={t.id}>
                    <button onClick={() => setSelected(t.id)}
                      className={`w-full rounded-md p-3 text-left text-sm ${t.id === selected ? "bg-muted" : "hover:bg-muted/50"}`}>
                      <div className="font-medium line-clamp-1">{t.subject}</div>
                      <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant={t.status === "open" ? "default" : "secondary"}>{t.status}</Badge>
                        {formatDistanceToNow(new Date(t.updated_at), { addSuffix: true })}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
            <Card className="p-4">
              {current && (
                <>
                  <h2 className="mb-3 font-semibold">{current.subject}</h2>
                  <SupportThreadView key={current.id} threadId={current.id} viewer="rider" canReply={current.status === "open"} />
                </>
              )}
            </Card>
          </div>
        )}
      </div>
    </RiderShell>
  );
}
