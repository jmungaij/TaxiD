import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SupportThreadView } from "@/components/support/SupportThreadView";
import { BRAND } from "@/config/brand";

interface Case {
  id: string; subject: string; rider_email: string; status: string; category: string;
  last_message_at: string | null; updated_at: string;
}
const STAFF = ["support", "admin", "super_admin"];

/** Agent portal: only the cases assigned to the signed-in agent, with a chat thread per case. */
export default function AgentPortal() {
  const navigate = useNavigate();
  const [me, setMe] = useState<{ id: string; email: string } | null>(null);
  const [cases, setCases] = useState<Case[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) { navigate("/agent/login", { replace: true }); return; }
      const { data: rows } = await supabase.from("user_roles").select("role").eq("user_id", data.user.id);
      if (!(rows ?? []).some((r: { role: string }) => STAFF.includes(r.role))) { navigate("/agent/login", { replace: true }); return; }
      setMe({ id: data.user.id, email: data.user.email ?? "" });
    })();
  }, [navigate]);

  useEffect(() => {
    if (!me) return;
    void (async () => {
      const { data } = await supabase.from("support_threads")
        .select("id, subject, rider_email, status, category, last_message_at, updated_at")
        .eq("assigned_agent_id", me.id).order("updated_at", { ascending: false }).limit(100);
      setCases((data ?? []) as Case[]);
    })();
    const ch = supabase.channel(`agent-${me.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "support_messages" }, () => setTick((n) => n + 1))
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [me, tick]);

  async function setStatus(c: Case, status: string) {
    await supabase.from("support_threads").update({ status }).eq("id", c.id).eq("assigned_agent_id", me?.id ?? "");
    setTick((n) => n + 1);
  }

  async function signOut() { await supabase.auth.signOut(); navigate("/agent/login", { replace: true }); }

  const current = cases.find((c) => c.id === selected);
  if (!me) return <main className="p-8 text-sm text-muted-foreground">Loading…</main>;

  return (
    <main className="min-h-screen bg-muted/30">
      <header className="flex items-center justify-between border-b bg-card px-6 py-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">{BRAND.name} Agent Portal</p>
          <p className="text-sm text-muted-foreground">{me.email}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void signOut()}>Sign out</Button>
      </header>
      <div className="grid gap-4 p-6 md:grid-cols-[20rem_1fr]">
        <section className="rounded-xl border bg-card p-2">
          <h2 className="px-2 py-1 text-sm font-semibold">My cases ({cases.length})</h2>
          {cases.length === 0 && <p className="p-2 text-sm text-muted-foreground">No cases are assigned to you yet.</p>}
          <ul>
            {cases.map((c) => (
              <li key={c.id}>
                <button onClick={() => setSelected(c.id)}
                  className={`w-full rounded-md p-2 text-left text-sm ${c.id === selected ? "bg-muted" : "hover:bg-muted/50"}`}>
                  <div className="font-medium line-clamp-1">{c.subject}</div>
                  <div className="text-xs text-muted-foreground">{c.rider_email}</div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant={c.status === "open" ? "default" : "secondary"}>{c.status}</Badge>
                    {formatDistanceToNow(new Date(c.last_message_at ?? c.updated_at), { addSuffix: true })}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </section>
        <section className="rounded-xl border bg-card p-4">
          {current ? (
            <>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-semibold">{current.subject}</h3>
                  <p className="text-xs text-muted-foreground">{current.rider_email} · {current.category}</p>
                </div>
                <div className="flex gap-2">
                  {current.status !== "resolved" && <Button size="sm" variant="outline" onClick={() => void setStatus(current, "resolved")}>Mark resolved</Button>}
                  <Button size="sm" variant="outline" onClick={() => void setStatus(current, current.status === "open" ? "closed" : "open")}>
                    {current.status === "open" ? "Close" : "Reopen"}
                  </Button>
                </div>
              </div>
              <SupportThreadView key={`${current.id}-${tick}`} threadId={current.id} viewer="staff" canReply={current.status === "open"} />
            </>
          ) : <p className="text-sm text-muted-foreground">Pick a case to read the rider's messages and reply.</p>}
        </section>
      </div>
    </main>
  );
}
