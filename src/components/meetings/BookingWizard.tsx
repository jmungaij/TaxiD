import * as React from "react";
import { CheckCircle2, Loader2, Video, Users, CalendarDays, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import SlotPicker from "./SlotPicker";
import { bookingCall, dateTimeLabel, errText, timeLabel, type PublicType } from "@/lib/meetings/booking";

type Done = { starts_at: string; join_url: string | null; host: string; type: string; lead_linked?: boolean; lead_created?: boolean; routing?: string; manage_url?: string };

/**
 * One booking flow for both channels. mode="client" is the public page;
 * mode="staff" books on behalf of a client (same availability and locking rules).
 */
export default function BookingWizard({ mode = "client", defaults, onBooked }: {
  mode?: "client" | "staff";
  defaults?: Partial<{ client_name: string; client_email: string; company: string; phone: string; lead_id: string }>;
  onBooked?: (d: Done) => void;
}) {
  const [types, setTypes] = React.useState<PublicType[] | null>(null);
  const [typeId, setTypeId] = React.useState<string | null>(null);
  const [host, setHost] = React.useState("any");
  const [slot, setSlot] = React.useState<string | null>(null);
  const [form, setForm] = React.useState({
    client_name: defaults?.client_name ?? "", client_email: defaults?.client_email ?? "", company: defaults?.company ?? "",
    phone: defaults?.phone ?? "", country: "Kenya", topic: "", website: "",
  });
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<Done | null>(null);

  React.useEffect(() => {
    bookingCall<{ types: PublicType[] }>({ action: "types" }).then((d) => setTypes(d.types ?? [])).catch((e) => { setTypes([]); setErr(errText(e)); });
  }, []);
  const type = types?.find((t) => t.id === typeId) ?? null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!slot || !typeId) return;
    setBusy(true); setErr(null);
    try {
      const body: Record<string, unknown> = { action: mode === "staff" ? "staff_book" : "book", type: typeId, host, starts_at: slot, ...form };
      if (mode === "staff") { delete body.website; if (defaults?.lead_id) body.lead_id = defaults.lead_id; }
      const d = await bookingCall<Done>(body);
      setDone(d); onBooked?.(d);
    } catch (e) { setErr(errText(e, "Booking failed. Please try again.")); }
    finally { setBusy(false); }
  };
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  if (done) return (
    <Card><CardContent className="space-y-3 p-8 text-center">
      <CheckCircle2 className="mx-auto h-10 w-10 text-primary" />
      <h2 className="text-2xl font-semibold">Meeting confirmed</h2>
      <p className="text-muted-foreground">{done.type} with {done.host}<br />{dateTimeLabel(done.starts_at)} (Nairobi time)</p>
      <p className="text-sm text-muted-foreground">A confirmation with the Google Meet link and a link to reschedule or cancel has been emailed to {form.client_email}.</p>
      {mode === "staff" && <p className="text-sm">{done.lead_created ? "New lead created and assigned to the host." : done.lead_linked ? "Linked to the client's existing lead record." : "Not linked to a lead."} A preparation task is in the host's work queue.</p>}
      <div className="flex flex-wrap justify-center gap-2">
        {done.join_url && <Button asChild><a href={done.join_url} target="_blank" rel="noreferrer"><Video className="mr-2 h-4 w-4" />Join Google Meet</a></Button>}
        {mode === "staff" && <Button variant="outline" onClick={() => { setDone(null); setSlot(null); }}>Book another</Button>}
      </div>
    </CardContent></Card>
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Users className="h-5 w-5" />1. What would you like to discuss?</CardTitle></CardHeader>
        <CardContent>
          {types === null ? <Loader2 className="h-5 w-5 animate-spin" /> : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {types.map((t) => (
                <button key={t.id} type="button" onClick={() => { setTypeId(t.id); setHost("any"); setSlot(null); }}
                  className={cn("rounded-lg border p-3 text-left transition-colors hover:border-primary", t.id === typeId && "border-primary bg-accent")}>
                  <div className="font-medium">{t.name}</div>
                  <div className="text-xs text-muted-foreground">{t.duration_minutes} min{t.description ? ` · ${t.description}` : ""}</div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {type && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><UserRound className="h-5 w-5" />2. Who would you like to meet?</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant={host === "any" ? "default" : "outline"} onClick={() => setHost("any")}>Best-matched specialist</Button>
            {type.hosts.map((h) => (
              <Button key={h.id} type="button" size="sm" variant={host === h.id ? "default" : "outline"} onClick={() => setHost(h.id)}>
                {h.name}{h.role ? <span className="ml-1 opacity-70">· {h.role}</span> : null}
              </Button>
            ))}
            {type.hosts.length === 0 && <p className="text-sm text-muted-foreground">Our team will pick the right person.</p>}
          </CardContent>
        </Card>
      )}

      {type && (
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><CalendarDays className="h-5 w-5" />3. Choose a time</CardTitle></CardHeader>
            <CardContent><SlotPicker typeId={type.id} host={host} value={slot} onChange={setSlot} /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-lg">4. {mode === "staff" ? "Client details" : "Your details"}</CardTitle></CardHeader>
            <CardContent>
              <form onSubmit={submit} className="space-y-3">
                <div><Label htmlFor="bw-n">Full name</Label><Input id="bw-n" required maxLength={120} value={form.client_name} onChange={set("client_name")} /></div>
                <div><Label htmlFor="bw-e">Email</Label><Input id="bw-e" type="email" required maxLength={200} value={form.client_email} onChange={set("client_email")} /></div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div><Label htmlFor="bw-c">Organisation</Label><Input id="bw-c" maxLength={160} value={form.company} onChange={set("company")} /></div>
                  <div><Label htmlFor="bw-p">Phone</Label><Input id="bw-p" maxLength={30} value={form.phone} onChange={set("phone")} /></div>
                </div>
                <div><Label htmlFor="bw-co">Country</Label><Input id="bw-co" maxLength={80} value={form.country} onChange={set("country")} /></div>
                <div><Label htmlFor="bw-t">Meeting purpose</Label><Textarea id="bw-t" required minLength={3} maxLength={500} value={form.topic} onChange={set("topic")} /></div>
                {mode === "client" && <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden className="hidden" value={form.website} onChange={set("website")} />}
                {err && <p className="text-sm text-destructive" role="alert">{err}</p>}
                <Button type="submit" className="w-full" disabled={!slot || busy}>
                  {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {slot ? `Confirm ${timeLabel(slot)}` : "Pick a time first"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
      {!type && err && <p className="text-sm text-destructive">{err}</p>}
    </div>
  );
}
