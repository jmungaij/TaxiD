import * as React from "react";
import { useParams } from "react-router-dom";
import { Loader2, Video } from "lucide-react";
import { MarketingPage, PageHero } from "@/components/marketing/PageHero";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import SlotPicker from "@/components/meetings/SlotPicker";
import { bookingCall, dateTimeLabel, errText } from "@/lib/meetings/booking";

type B = { client_name: string; starts_at: string; duration: number; status: string; join_url: string | null; type: string; type_id: string | null; host: string; host_id: string | null };

export default function ManageMeeting() {
  const { token = "" } = useParams();
  const [b, setB] = React.useState<B | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<"view" | "move" | "cancel">("view");
  const [slot, setSlot] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);

  const load = React.useCallback(() => bookingCall<{ booking: B }>({ action: "manage", token }).then((d) => setB(d.booking)).catch((e) => setErr(errText(e))), [token]);
  React.useEffect(() => { load(); }, [load]);

  const act = async (body: Record<string, unknown>, done: string) => {
    setBusy(true); setErr(null);
    try { await bookingCall({ ...body, token }); setMsg(done); setMode("view"); await load(); }
    catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };

  return (
    <MarketingPage>
      <PageHero eyebrow="Your meeting" title="Manage your meeting" subtitle="Join, move or cancel your TaxiD meeting." />
      <section className="container mx-auto max-w-3xl px-4 py-12 space-y-4">
        {!b && !err && <Loader2 className="h-6 w-6 animate-spin" />}
        {err && <p className="text-destructive" role="alert">{err}</p>}
        {msg && <p className="text-primary">{msg}</p>}
        {b && (
          <Card>
            <CardHeader><CardTitle>{b.type} with {b.host}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <p>{dateTimeLabel(b.starts_at)} (Nairobi time) · {b.duration} min</p>
              <p className="text-sm text-muted-foreground">Status: {b.status === "confirmed" ? "Confirmed" : b.status === "cancelled" ? "Cancelled" : b.status}</p>
              {b.status === "confirmed" && mode === "view" && (
                <div className="flex flex-wrap gap-2">
                  {b.join_url && <Button asChild><a href={b.join_url} target="_blank" rel="noreferrer"><Video className="mr-2 h-4 w-4" />Join Google Meet</a></Button>}
                  <Button variant="outline" onClick={() => setMode("move")}>Reschedule</Button>
                  <Button variant="outline" onClick={() => setMode("cancel")}>Cancel meeting</Button>
                </div>
              )}
              {mode === "move" && b.type_id && b.host_id && (
                <div className="space-y-3">
                  <SlotPicker typeId={b.type_id} host={b.host_id} value={slot} onChange={setSlot} />
                  <div className="flex gap-2">
                    <Button disabled={!slot || busy} onClick={() => act({ action: "reschedule", starts_at: slot }, "Your meeting has been moved. A new invitation is on its way.")}>
                      {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Move to this time</Button>
                    <Button variant="ghost" onClick={() => setMode("view")}>Back</Button>
                  </div>
                </div>
              )}
              {mode === "move" && (!b.type_id || !b.host_id) && <p className="text-sm">This older booking can't be moved online. Please cancel and book a new time.</p>}
              {mode === "cancel" && (
                <div className="space-y-3">
                  <Textarea placeholder="Reason (optional)" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
                  <div className="flex gap-2">
                    <Button variant="destructive" disabled={busy} onClick={() => act({ action: "cancel", reason }, "Your meeting has been cancelled.")}>Confirm cancellation</Button>
                    <Button variant="ghost" onClick={() => setMode("view")}>Back</Button>
                  </div>
                </div>
              )}
              {b.status === "cancelled" && <Button asChild variant="outline"><a href="/book-a-meeting">Book a new time</a></Button>}
            </CardContent>
          </Card>
        )}
      </section>
    </MarketingPage>
  );
}
