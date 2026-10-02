import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertTriangle, Check, CheckCheck, Clock, Flag, MessageCircle, RotateCw, Send, ShieldAlert, ThumbsUp } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Role = "rider" | "driver";
type Kind = "text" | "quick" | "ack" | "vehicle_mismatch" | "safety";
type Msg = {
  id: string; sender_role: Role; body: string; created_at: string;
  kind?: Kind; priority?: string; read_at?: string | null; client_msg_id?: string | null;
  _state?: "sending" | "queued" | "failed";
};

/** Categorised quick messages — short, structured, one tap. */
const QUICK: Record<Role, { label: string; items: string[] }[]> = {
  rider: [
    { label: "Pickup", items: ["I'm at the entrance", "I'm at the pickup pin", "I'm walking to you", "Please wait 2 minutes"] },
    { label: "Location", items: ["I'm across the road", "I'm at the main gate", "Please come to the meeting point", "I'm inside — coming out now"] },
    { label: "Identify", items: ["I see your car", "I'm wearing a blue top", "I'm with luggage", "I'm waving"] },
    { label: "Access", items: ["I need help with my bags", "I'm travelling with a child", "I have a mobility aid", "Please call out when you arrive"] },
  ],
  driver: [
    { label: "Arrival", items: ["I'm 2 minutes away", "I've arrived", "I see you", "I'm at the meeting point"] },
    { label: "Location", items: ["I can't stop here — please come to the meeting point", "I'm stuck in traffic", "I'm at the main gate", "I'm parked just ahead"] },
    { label: "Wait", items: ["No problem, I'll wait", "I can wait 3 more minutes", "Please come out when ready"] },
  ],
};

const QUEUE_KEY = (b: string) => `taxid:trip-msg-queue:${b}`;
const ERR: Record<string, string> = {
  RATE_LIMITED: "You're sending messages too fast. Wait a moment.",
  CONTACT_DETAILS_BLOCKED: "For your privacy, phone numbers and links can't be shared here.",
  MESSAGE_LENGTH: "Messages must be 1–200 characters.",
};

function errText(msg?: string) {
  const code = Object.keys(ERR).find((k) => msg?.includes(k));
  return code ? ERR[code] : "Message not sent.";
}

/**
 * Trip-scoped rider ↔ driver channel. One authority (trip_messages + RLS),
 * with delivery/read states, offline queue, duplicate protection, reporting
 * and a safety escalation path.
 */
export function TripMessages({ bookingId, role, active }: { bookingId: string; role: Role; active: boolean }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [tab, setTab] = useState(0);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const endRef = useRef<HTMLDivElement | null>(null);
  const loaded = useRef(false);
  const other = role === "rider" ? "Driver" : "Rider";

  const merge = useCallback((incoming: Msg) => setMsgs((m) => {
    const i = m.findIndex((x) => x.id === incoming.id || (incoming.client_msg_id && x.client_msg_id === incoming.client_msg_id));
    if (i === -1) return [...m, incoming];
    const copy = m.slice(); copy[i] = { ...copy[i], ...incoming, _state: undefined }; return copy;
  }), []);

  const markRead = useCallback(() => {
    if (document.visibilityState === "visible") void supabase.rpc("trip_messages_mark_read", { _booking_id: bookingId });
  }, [bookingId]);

  useEffect(() => {
    supabase.from("trip_messages").select("id,sender_role,body,created_at,kind,priority,read_at,client_msg_id")
      .eq("trip_booking_id", bookingId).order("created_at").limit(200)
      .then(({ data }) => {
        const queued: Msg[] = JSON.parse(localStorage.getItem(QUEUE_KEY(bookingId)) || "[]");
        setMsgs([...((data ?? []) as Msg[]), ...queued.map((q) => ({ ...q, _state: "queued" as const }))]);
        loaded.current = true; markRead();
      });
    const ch = supabase.channel(`trip-msgs-${bookingId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "trip_messages", filter: `trip_booking_id=eq.${bookingId}` },
        (p) => {
          const m = p.new as Msg; if (!m?.id) return;
          merge(m);
          if (p.eventType === "INSERT" && m.sender_role !== role) {
            if (m.priority === "safety") toast.error(`${other}: ${m.body}`); else toast(`${other}: ${m.body}`);
            navigator.vibrate?.(m.priority === "safety" ? [200, 100, 200] : 120);
            markRead();
          }
        })
      .subscribe();
    const onVis = () => markRead();
    document.addEventListener("visibilitychange", onVis);
    return () => { supabase.removeChannel(ch); document.removeEventListener("visibilitychange", onVis); };
  }, [bookingId, role, other, merge, markRead]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest" }); }, [msgs.length]);

  const persistQueue = (list: Msg[]) => localStorage.setItem(QUEUE_KEY(bookingId),
    JSON.stringify(list.filter((m) => m._state === "queued").map(({ _state, ...r }) => r)));

  const deliver = useCallback(async (m: Msg) => {
    const { data: u } = await supabase.auth.getUser();
    const { data, error } = await supabase.from("trip_messages").insert({
      trip_booking_id: bookingId, sender_role: role, sender_user_id: u.user?.id, body: m.body,
      kind: m.kind ?? "text", priority: m.priority ?? "normal", client_msg_id: m.client_msg_id,
    }).select("id,sender_role,body,created_at,kind,priority,read_at,client_msg_id").single();
    if (error) {
      // Duplicate key = already delivered on an earlier attempt.
      if (error.code === "23505") { setMsgs((l) => l.map((x) => x.client_msg_id === m.client_msg_id ? { ...x, _state: undefined } : x)); return true; }
      if (!navigator.onLine) { setMsgs((l) => { const n = l.map((x) => x.client_msg_id === m.client_msg_id ? { ...x, _state: "queued" as const } : x); persistQueue(n); return n; }); return false; }
      toast.error(errText(error.message));
      setMsgs((l) => l.map((x) => x.client_msg_id === m.client_msg_id ? { ...x, _state: "failed" as const } : x));
      return false;
    }
    merge(data as Msg);
    setMsgs((l) => { persistQueue(l); return l; });
    return true;
  }, [bookingId, role, merge]); // eslint-disable-line react-hooks/exhaustive-deps

  // Flush offline queue on reconnect.
  useEffect(() => {
    const up = () => { setOnline(true); msgs.filter((m) => m._state === "queued").forEach((m) => void deliver(m)); };
    const down = () => setOnline(false);
    window.addEventListener("online", up); window.addEventListener("offline", down);
    if (navigator.onLine && loaded.current) msgs.filter((m) => m._state === "queued").forEach((m) => void deliver(m));
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, [deliver, loaded.current]); // eslint-disable-line react-hooks/exhaustive-deps

  function send(body: string, kind: Kind = "text", priority = "normal") {
    const b = body.trim().slice(0, 200);
    if (!b) return;
    const local: Msg = {
      id: `local-${crypto.randomUUID()}`, client_msg_id: crypto.randomUUID(), sender_role: role, body: b,
      created_at: new Date().toISOString(), kind, priority, _state: navigator.onLine ? "sending" : "queued",
    };
    setMsgs((l) => { const n = [...l, local]; if (local._state === "queued") persistQueue(n); return n; });
    if (kind === "text") setText("");
    if (local._state === "sending") void deliver(local);
    else toast("You're offline — your message will send when you reconnect.");
  }

  async function report(m: Msg) {
    const reason = window.prompt("Why are you reporting this message? (e.g. abusive, unsafe, spam)");
    if (reason === null) return;
    const { data, error } = await supabase.rpc("trip_message_report", { _message_id: m.id, _reason: reason });
    if (error || !(data as { ok?: boolean })?.ok) return toast.error("Couldn't report the message.");
    toast.success("Reported to TaxiD Safety. Thank you.");
  }

  const unreadFromOther = useMemo(() => msgs.filter((m) => m.sender_role !== role && !m.read_at).length, [msgs, role]);
  const lastTheirs = [...msgs].reverse().find((m) => m.sender_role !== role);
  const groups = QUICK[role];

  return (
    <div className="space-y-2 text-sm" data-testid="trip-messages">
      <div className="flex items-center justify-between">
        <div className="font-semibold flex items-center gap-2">
          <MessageCircle className="h-4 w-4 text-primary" /> Message your {other.toLowerCase()}
          {unreadFromOther > 0 && <span className="rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground" aria-label={`${unreadFromOther} unread`}>{unreadFromOther}</span>}
        </div>
        <span className="text-[10px] text-muted-foreground">Private · trip only</span>
      </div>
      {!online && active && <p className="text-xs text-warning" role="status">Offline — messages will send when you reconnect.</p>}

      {msgs.length > 0 && (
        <div className="max-h-56 overflow-y-auto space-y-1 rounded-md border p-2" aria-live="polite">
          {msgs.map((m) => {
            const mine = m.sender_role === role;
            const safety = m.priority === "safety";
            return (
              <div key={m.id} className={cn("group flex", mine ? "justify-end" : "justify-start")}>
                <span className={cn("rounded-lg px-2 py-1 max-w-[80%]",
                  safety ? "border border-destructive bg-destructive/10 text-destructive"
                  : mine ? "bg-primary text-primary-foreground" : "bg-muted")}>
                  {safety && <ShieldAlert className="inline h-3 w-3 mr-1" />}{m.body}
                  <span className="flex items-center gap-1 text-[10px] opacity-70">
                    {mine ? "You" : other} · {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    {mine && (m._state === "sending" ? <Clock className="h-3 w-3" aria-label="Sending" />
                      : m._state === "queued" ? <Clock className="h-3 w-3" aria-label="Waiting for connection" />
                      : m._state === "failed" ? <button type="button" className="underline inline-flex items-center gap-0.5" onClick={() => { setMsgs((l) => l.map((x) => x.id === m.id ? { ...x, _state: "sending" } : x)); void deliver(m); }}><RotateCw className="h-3 w-3" />Retry</button>
                      : m.read_at ? <CheckCheck className="h-3 w-3" aria-label="Read" /> : <Check className="h-3 w-3" aria-label="Delivered" />)}
                    {!mine && !m.id.startsWith("local-") && (
                      <button type="button" className="opacity-0 group-hover:opacity-100 focus:opacity-100" aria-label="Report message" onClick={() => void report(m)}>
                        <Flag className="h-3 w-3" />
                      </button>
                    )}
                  </span>
                </span>
              </div>
            );
          })}
          <div ref={endRef} />
        </div>
      )}

      {active ? (
        <>
          {lastTheirs && lastTheirs.kind !== "ack" && (
            <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => send("👍 Got it", "ack")}>
              <ThumbsUp className="h-3 w-3" /> Got it
            </Button>
          )}
          <div className="flex gap-1 border-b" role="tablist">
            {groups.map((g, i) => (
              <button key={g.label} role="tab" aria-selected={tab === i} onClick={() => setTab(i)}
                className={cn("px-2 py-1 text-xs", tab === i ? "border-b-2 border-primary font-medium" : "text-muted-foreground")}>{g.label}</button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {groups[tab]?.items.map((q) => (
              <Button key={q} size="sm" variant="outline" className={cn("text-xs", role === "driver" ? "h-9" : "h-7")} onClick={() => send(q, "quick")}>{q}</Button>
            ))}
          </div>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); send(text); }}>
            <Input value={text} maxLength={200} onChange={(e) => setText(e.target.value)}
              placeholder={role === "driver" ? "Short message (only when parked)…" : "Short message…"} aria-label="Message" />
            <Button type="submit" size="icon" disabled={!text.trim()} aria-label="Send"><Send className="h-4 w-4" /></Button>
          </form>
          <div className="text-[10px] text-muted-foreground text-right">{text.length}/200</div>
          {role === "rider" && (
            <div className="flex flex-wrap gap-2 pt-1">
              <Button size="sm" variant="outline" className="h-7 gap-1 text-xs border-destructive/50 text-destructive"
                onClick={() => { if (window.confirm("Tell your driver and TaxiD that the car or driver doesn't match? Don't get in.")) send("The vehicle or driver doesn't match the app — I won't get in yet.", "vehicle_mismatch"); }}>
                <AlertTriangle className="h-3 w-3" /> Vehicle doesn't match
              </Button>
              <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs text-destructive" asChild>
                <Link to="/rider/safety"><ShieldAlert className="h-3 w-3" /> Safety concern</Link>
              </Button>
            </div>
          )}
          <p className="text-[10px] text-muted-foreground">Phone numbers and links are hidden for your privacy. Messages close when the trip ends.</p>
        </>
      ) : (
        msgs.length === 0 ? <p className="text-xs text-muted-foreground">No messages on this trip.</p>
          : <p className="text-[10px] text-muted-foreground">This trip has ended — messages are read-only.</p>
      )}
    </div>
  );
}
