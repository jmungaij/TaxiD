import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MessageCircle, Send } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Msg = { id: string; sender_role: "rider" | "driver"; body: string; created_at: string };

const QUICK: Record<"rider" | "driver", string[]> = {
  rider: ["I'm at the entrance", "I'm walking to you", "I'm at the pickup pin", "I see your car", "Please wait 2 minutes"],
  driver: ["I've arrived", "I'm 2 minutes away", "I'm stuck in traffic", "I can't stop here — please come to the meeting point", "I see you"],
};

/** Structured "Meet me" channel between a trip's rider and its driver. */
export function TripMessages({ bookingId, role, active }: { bookingId: string; role: "rider" | "driver"; active: boolean }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    supabase.from("trip_messages").select("id,sender_role,body,created_at").eq("trip_booking_id", bookingId)
      .order("created_at").limit(100).then(({ data }) => setMsgs((data ?? []) as Msg[]));
    const ch = supabase.channel(`trip-msgs-${bookingId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "trip_messages", filter: `trip_booking_id=eq.${bookingId}` },
        (p) => setMsgs((m) => (m.some((x) => x.id === (p.new as Msg).id) ? m : [...m, p.new as Msg])))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [bookingId]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest" }); }, [msgs.length]);

  async function send(body: string) {
    const b = body.trim().slice(0, 200);
    if (!b) return;
    setSending(true);
    const { data, error } = await supabase.from("trip_messages")
      .insert({ trip_booking_id: bookingId, sender_role: role, body: b }).select("id,sender_role,body,created_at").single();
    setSending(false);
    if (error) return toast.error("Message not sent. Try again.");
    setText("");
    if (data) setMsgs((m) => (m.some((x) => x.id === data.id) ? m : [...m, data as Msg]));
  }

  return (
    <div className="space-y-2 text-sm" data-testid="trip-messages">
      <div className="font-semibold flex items-center gap-2"><MessageCircle className="h-4 w-4 text-primary" /> Meet me</div>
      {msgs.length > 0 && (
        <div className="max-h-48 overflow-y-auto space-y-1 rounded-md border p-2">
          {msgs.map((m) => (
            <div key={m.id} className={cn("flex", m.sender_role === role ? "justify-end" : "justify-start")}>
              <span className={cn("rounded-lg px-2 py-1 max-w-[80%]", m.sender_role === role ? "bg-primary text-primary-foreground" : "bg-muted")}>
                {m.body}
                <span className="block text-[10px] opacity-70">
                  {m.sender_role === role ? "You" : m.sender_role === "driver" ? "Driver" : "Rider"} · {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </span>
            </div>
          ))}
          <div ref={endRef} />
        </div>
      )}
      {active ? (
        <>
          <div className="flex flex-wrap gap-1.5">
            {QUICK[role].map((q) => (
              <Button key={q} size="sm" variant="outline" className="h-7 text-xs" disabled={sending} onClick={() => void send(q)}>{q}</Button>
            ))}
          </div>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
            <Input value={text} maxLength={200} onChange={(e) => setText(e.target.value)} placeholder="Short message…" aria-label="Message" />
            <Button type="submit" size="icon" disabled={sending || !text.trim()} aria-label="Send"><Send className="h-4 w-4" /></Button>
          </form>
        </>
      ) : (
        msgs.length === 0 && <p className="text-xs text-muted-foreground">No messages on this trip.</p>
      )}
    </div>
  );
}
