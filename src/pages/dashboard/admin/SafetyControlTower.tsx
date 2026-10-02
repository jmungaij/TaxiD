import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Siren, MapPin, Phone, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { INCIDENT_STATUS_LABEL, INCIDENT_TYPES } from "@/components/safety/SafetyCenter";

interface Incident {
  id: string; reference: string; status: string; severity: string; incident_type: string; reporter_role: string;
  booking_number: string | null; driver_name: string | null; driver_phone: string | null; vehicle_plate: string | null; vehicle_desc: string | null;
  pickup_address: string | null; dropoff_address: string | null; trip_status: string | null; message: string | null;
  lat: number | null; lng: number | null; accuracy_m: number | null; location_at: string | null;
  created_at: string; acknowledged_at: string | null; ack_due_at: string; resolved_at: string | null; escalation_level: number;
}
interface Ev { id: string; event_type: string; note: string | null; created_at: string; actor_kind: string }
interface Notice { id: string; contact_name: string | null; contact_phone: string | null; status: string }

const ACTIVE = ["open", "acknowledged", "responding", "escalated"];
const RESOLUTIONS = ["rider_safe", "emergency_services_dispatched", "false_alarm", "driver_action_taken", "referred_to_police", "other"];
const typeLabel = (t: string) => INCIDENT_TYPES.find((x) => x.id === t)?.label ?? t;
const sevVariant = (s: string) => (s === "critical" ? "destructive" : s === "high" ? "default" : "secondary") as "destructive" | "default" | "secondary";

export default function SafetyControlTower() {
  const [rows, setRows] = useState<Incident[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [events, setEvents] = useState<Ev[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [note, setNote] = useState("");
  const [resolution, setResolution] = useState(RESOLUTIONS[0]);
  const [filter, setFilter] = useState<"active" | "all">("active");
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    let q = supabase.from("safety_incidents").select("*").order("created_at", { ascending: false }).limit(200);
    if (filter === "active") q = q.in("status", ACTIVE);
    const { data, error } = await q;
    if (error) toast.error(error.message);
    setRows((data as Incident[]) ?? []);
  }, [filter]);

  const loadDetail = useCallback(async (id: string) => {
    const [{ data: e }, { data: n }] = await Promise.all([
      supabase.from("safety_incident_events").select("id,event_type,note,created_at,actor_kind").eq("incident_id", id).order("created_at"),
      supabase.from("safety_contact_notifications").select("id,contact_name,contact_phone,status").eq("incident_id", id),
    ]);
    setEvents((e as Ev[]) ?? []); setNotices((n as Notice[]) ?? []);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (sel) loadDetail(sel); }, [sel, loadDetail]);
  useEffect(() => {
    const ch = supabase.channel("safety-tower")
      .on("postgres_changes", { event: "*", schema: "public", table: "safety_incidents" }, (p) => {
        if (p.eventType === "INSERT") toast.error(`New SOS ${(p.new as Incident).reference}`, { duration: 15000 });
        load();
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "safety_incident_events" }, () => { if (sel) loadDetail(sel); })
      .subscribe();
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => { supabase.removeChannel(ch); clearInterval(t); };
  }, [load, loadDetail, sel]);

  const current = rows.find((r) => r.id === sel) ?? null;
  const stats = useMemo(() => ({
    active: rows.filter((r) => ACTIVE.includes(r.status)).length,
    unacked: rows.filter((r) => r.status === "open").length,
    breached: rows.filter((r) => ACTIVE.includes(r.status) && !r.acknowledged_at && new Date(r.ack_due_at).getTime() < now).length,
    critical: rows.filter((r) => ACTIVE.includes(r.status) && r.severity === "critical").length,
  }), [rows, now]);

  async function act(action: string) {
    if (!current) return;
    const { error } = await supabase.rpc("safety_incident_action", {
      _incident_id: current.id, _action: action, _note: note.trim() || null, _resolution_type: action === "resolve" ? resolution : null,
    });
    if (error) return toast.error(error.message);
    toast.success("Saved");
    setNote(""); load(); loadDetail(current.id);
  }

  const age = (iso: string) => { const s = Math.floor((now - new Date(iso).getTime()) / 1000); return s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h`; };

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Siren className="h-6 w-6 text-destructive" /> Safety Control Tower</h1>
        <div className="flex gap-2">
          <Button size="sm" variant={filter === "active" ? "default" : "outline"} onClick={() => setFilter("active")}>Active</Button>
          <Button size="sm" variant={filter === "all" ? "default" : "outline"} onClick={() => setFilter("all")}>All</Button>
          <Button size="sm" variant="ghost" onClick={load}><RefreshCw className="h-4 w-4" /></Button>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[["Active incidents", stats.active], ["Waiting for answer", stats.unacked], ["Response time missed", stats.breached], ["Critical", stats.critical]].map(([l, v]) => (
          <Card key={l as string} className="p-3"><div className="text-xs text-muted-foreground">{l}</div><div className="text-2xl font-bold">{v}</div></Card>
        ))}
      </div>
      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-4">
        <Card className="divide-y max-h-[70vh] overflow-auto">
          {rows.length === 0 && <div className="p-6 text-sm text-muted-foreground text-center">No incidents.</div>}
          {rows.map((r) => {
            const breach = ACTIVE.includes(r.status) && !r.acknowledged_at && new Date(r.ack_due_at).getTime() < now;
            return (
              <button key={r.id} onClick={() => setSel(r.id)} className={`w-full text-left p-3 hover:bg-muted/50 ${sel === r.id ? "bg-muted" : ""}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm font-semibold">{r.reference}</span>
                  <Badge variant={sevVariant(r.severity)}>{r.severity}</Badge>
                </div>
                <div className="text-sm">{typeLabel(r.incident_type)} · {r.reporter_role}{r.booking_number ? ` · ${r.booking_number}` : ""}</div>
                <div className="text-xs text-muted-foreground">{INCIDENT_STATUS_LABEL[r.status]} · {age(r.created_at)} ago
                  {breach && <span className="text-destructive font-semibold"> · RESPONSE OVERDUE</span>}</div>
              </button>
            );
          })}
        </Card>
        <Card className="p-4 space-y-3">
          {!current ? <div className="text-sm text-muted-foreground">Select an incident.</div> : (
            <>
              <div className="flex items-center justify-between">
                <div className="font-mono font-bold">{current.reference}</div>
                <Badge variant={sevVariant(current.severity)}>{INCIDENT_STATUS_LABEL[current.status]}</Badge>
              </div>
              <div className="grid sm:grid-cols-2 gap-2 text-sm">
                <div><span className="text-muted-foreground">Type:</span> {typeLabel(current.incident_type)}</div>
                <div><span className="text-muted-foreground">Raised by:</span> {current.reporter_role}</div>
                <div><span className="text-muted-foreground">Trip:</span> {current.booking_number ?? "No trip"} {current.trip_status && `(${current.trip_status})`}</div>
                <div><span className="text-muted-foreground">Escalation level:</span> {current.escalation_level}</div>
                <div><span className="text-muted-foreground">Driver:</span> {current.driver_name ?? "—"} {current.driver_phone && <a className="underline" href={`tel:${current.driver_phone}`}>{current.driver_phone}</a>}</div>
                <div><span className="text-muted-foreground">Vehicle:</span> {current.vehicle_plate ?? "—"} {current.vehicle_desc}</div>
                <div className="sm:col-span-2"><span className="text-muted-foreground">Route:</span> {current.pickup_address ?? "—"} → {current.dropoff_address ?? "—"}</div>
                {current.message && <div className="sm:col-span-2"><span className="text-muted-foreground">Message:</span> {current.message}</div>}
                <div className="sm:col-span-2 flex items-center gap-1">
                  <MapPin className="h-4 w-4" />
                  {current.lat != null ? (
                    <a className="underline" target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${current.lat},${current.lng}`}>
                      {Number(current.lat).toFixed(5)}, {Number(current.lng).toFixed(5)}
                    </a>
                  ) : "No location"}
                  {current.accuracy_m != null && <span className="text-muted-foreground"> ±{Math.round(Number(current.accuracy_m))}m</span>}
                  {current.location_at && <span className="text-muted-foreground"> · updated {age(current.location_at)} ago</span>}
                </div>
              </div>
              <div>
                <div className="text-sm font-medium mb-1">Emergency contacts</div>
                {notices.length === 0 ? <div className="text-xs text-muted-foreground">None on file.</div> : notices.map((n) => (
                  <div key={n.id} className="text-sm flex justify-between">
                    <span>{n.contact_name} {n.contact_phone && <a className="underline" href={`tel:${n.contact_phone}`}><Phone className="inline h-3 w-3" /> {n.contact_phone}</a>}</span>
                    <Badge variant="outline">{n.status.replace(/_/g, " ")}</Badge>
                  </div>
                ))}
              </div>
              {ACTIVE.includes(current.status) && (
                <div className="space-y-2">
                  <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} rows={2} placeholder="Note for the timeline" />
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => act("acknowledge")} disabled={!!current.acknowledged_at}>Acknowledge</Button>
                    <Button size="sm" variant="secondary" onClick={() => act("respond")}>Responding</Button>
                    <Button size="sm" variant="secondary" onClick={() => act("contacts_called")} disabled={!notices.length}>Contacts called</Button>
                    <Button size="sm" variant="destructive" onClick={() => act("escalate")}>Escalate</Button>
                    <Button size="sm" variant="outline" onClick={() => act("note")} disabled={!note.trim()}>Add note</Button>
                  </div>
                  <div className="flex gap-2 items-center">
                    <select className="border rounded-md bg-background text-sm h-9 px-2" value={resolution} onChange={(e) => setResolution(e.target.value)}>
                      {RESOLUTIONS.map((r) => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}
                    </select>
                    <Button size="sm" onClick={() => act("resolve")}><ShieldCheck className="h-4 w-4 mr-1" /> Resolve</Button>
                  </div>
                </div>
              )}
              <div>
                <div className="text-sm font-medium mb-1">Timeline</div>
                <ol className="text-xs border-l pl-3 space-y-1">
                  {events.map((e) => (
                    <li key={e.id}><span className="text-muted-foreground">{new Date(e.created_at).toLocaleString()}</span> · <b>{e.actor_kind}</b> · {e.event_type.replace(/_/g, " ")}{e.note ? ` — ${e.note}` : ""}</li>
                  ))}
                </ol>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
