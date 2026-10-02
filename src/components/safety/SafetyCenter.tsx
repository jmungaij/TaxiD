import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, Phone, ShieldCheck, Loader2, MapPin, WifiOff, Car, HeartPulse, UserX, Gauge, HelpCircle, Siren } from "lucide-react";
import { toast } from "sonner";

export const INCIDENT_TYPES = [
  { id: "immediate_danger", label: "Immediate danger", icon: Siren },
  { id: "accident", label: "Accident", icon: Car },
  { id: "medical", label: "Medical emergency", icon: HeartPulse },
  { id: "harassment", label: "Harassment", icon: UserX },
  { id: "unsafe_driving", label: "Unsafe driving", icon: Gauge },
  { id: "other", label: "Something else", icon: HelpCircle },
] as const;

export const INCIDENT_STATUS_LABEL: Record<string, string> = {
  open: "Waiting for a safety operator",
  acknowledged: "Safety operator has seen your alert",
  responding: "Safety operator is responding",
  escalated: "Escalated to a senior responder",
  resolved: "Resolved",
  cancelled_safe: "You marked yourself safe",
};

const NOTIFY_LABEL: Record<string, string> = {
  queued: "Not yet contacted — an operator will call",
  sent: "Message sent",
  delivered: "Message delivered",
  failed: "Could not reach",
  called_by_operator: "Called by TaxiD operator",
};

const QUEUE_KEY = "taxid:pending-sos";
const ACTIVE = ["open", "acknowledged", "responding", "escalated"];

interface Incident {
  id: string; reference: string; status: string; severity: string; incident_type: string;
  created_at: string; acknowledged_at: string | null; ack_due_at: string; lat: number | null; lng: number | null;
}
interface Notice { id: string; contact_name: string | null; contact_phone: string | null; status: string }
interface Ev { id: string; event_type: string; note: string | null; created_at: string; actor_kind: string }

function getPosition(timeout = 6000): Promise<GeolocationPosition | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition((p) => resolve(p), () => resolve(null), { enableHighAccuracy: true, timeout, maximumAge: 15000 });
  });
}

interface Props {
  bookingId?: string | null;
  role?: "rider" | "driver";
  source: string;
  fallbackLocation?: { lat: number; lng: number } | null;
  compact?: boolean;
}

/** Full SOS orchestration: choose emergency type → backend incident → Safety Mode with live location, honest status, timeline. */
export function SafetyCenter({ bookingId = null, role = "rider", source, fallbackLocation = null, compact = false }: Props) {
  const [incident, setIncident] = useState<Incident | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [events, setEvents] = useState<Ev[]>([]);
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [locOk, setLocOk] = useState<boolean | null>(null);
  const [offlineQueued, setOfflineQueued] = useState(false);
  const [now, setNow] = useState(Date.now());
  const watchRef = useRef<number | null>(null);

  const loadDetails = useCallback(async (id: string) => {
    const [{ data: inc }, { data: n }, { data: e }] = await Promise.all([
      supabase.from("safety_incidents").select("id,reference,status,severity,incident_type,created_at,acknowledged_at,ack_due_at,lat,lng").eq("id", id).maybeSingle(),
      supabase.from("safety_contact_notifications").select("id,contact_name,contact_phone,status").eq("incident_id", id),
      supabase.from("safety_incident_events").select("id,event_type,note,created_at,actor_kind").eq("incident_id", id).order("created_at"),
    ]);
    if (inc) setIncident(inc as Incident);
    setNotices((n as Notice[]) ?? []);
    setEvents((e as Ev[]) ?? []);
  }, []);

  // Resume an active incident after reload
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from("safety_incidents").select("id")
        .eq("reporter_user_id", user.id).in("status", ACTIVE).order("created_at", { ascending: false }).limit(1);
      if (data?.[0]) loadDetails(data[0].id);
    })();
  }, [loadDetails]);

  // Realtime + polling while active
  useEffect(() => {
    if (!incident) return;
    const ch = supabase.channel(`sos-${incident.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "safety_incidents", filter: `id=eq.${incident.id}` }, () => loadDetails(incident.id))
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "safety_incident_events", filter: `incident_id=eq.${incident.id}` }, () => loadDetails(incident.id))
      .subscribe();
    const poll = setInterval(() => loadDetails(incident.id), 20000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { supabase.removeChannel(ch); clearInterval(poll); clearInterval(tick); };
  }, [incident?.id, loadDetails]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live location session while active
  useEffect(() => {
    if (!incident || !ACTIVE.includes(incident.status) || !navigator.geolocation) return;
    let last = 0;
    watchRef.current = navigator.geolocation.watchPosition(
      (p) => {
        setLocOk(true);
        if (Date.now() - last < 15000) return;
        last = Date.now();
        supabase.rpc("safety_sos_ping", { _incident_id: incident.id, _lat: p.coords.latitude, _lng: p.coords.longitude, _accuracy: p.coords.accuracy });
      },
      () => setLocOk(false),
      { enableHighAccuracy: true, maximumAge: 10000 },
    );
    return () => { if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current); };
  }, [incident?.id, incident?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = useCallback(async (type: string, key: string, msg: string | null) => {
    const pos = await getPosition();
    setLocOk(!!pos);
    const lat = pos?.coords.latitude ?? fallbackLocation?.lat ?? null;
    const lng = pos?.coords.longitude ?? fallbackLocation?.lng ?? null;
    const { data, error } = await supabase.rpc("safety_sos_open", {
      _booking_id: bookingId, _incident_type: type, _lat: lat, _lng: lng, _accuracy: pos?.coords.accuracy ?? null,
      _message: msg, _source: source, _idempotency_key: key, _app_version: "web", _reporter_role: role,
    });
    if (error) throw error;
    const res = data as { incident_id: string; reference: string; deduplicated: boolean };
    localStorage.removeItem(QUEUE_KEY);
    setOfflineQueued(false);
    await loadDetails(res.incident_id);
    toast.success(res.deduplicated ? `Your alert ${res.reference} is already open` : `Alert ${res.reference} created`);
  }, [bookingId, fallbackLocation, loadDetails, role, source]);

  // Offline retry
  useEffect(() => {
    const retry = () => {
      const raw = localStorage.getItem(QUEUE_KEY);
      if (!raw) return;
      const q = JSON.parse(raw);
      send(q.type, q.key, q.msg).catch(() => undefined);
    };
    retry();
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [send]);

  async function raise(type: string) {
    const key = crypto.randomUUID();
    const msg = message.trim().slice(0, 1000) || null;
    setBusy(true);
    try {
      if (!navigator.onLine) throw new Error("offline");
      await send(type, key, msg);
      setChoosing(false);
      setMessage("");
    } catch (e) {
      const offline = !navigator.onLine || (e as Error).message === "offline" || (e as Error).message?.includes("fetch");
      if (offline) {
        localStorage.setItem(QUEUE_KEY, JSON.stringify({ type, key, msg }));
        setOfflineQueued(true);
        toast.error("No internet. Call 999 now — your alert will send automatically when you reconnect.");
      } else {
        toast.error((e as Error).message || "Could not send alert. Call 999.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function markSafe() {
    if (!incident) return;
    const { error } = await supabase.rpc("safety_sos_mark_safe", { _incident_id: incident.id, _note: null });
    if (error) return toast.error(error.message);
    toast.success("Thanks — we've recorded that you're safe. A team member may follow up.");
    loadDetails(incident.id);
  }

  const active = incident && ACTIVE.includes(incident.status);
  const overdue = active && !incident!.acknowledged_at && new Date(incident!.ack_due_at).getTime() < now;
  const elapsed = incident ? Math.max(0, Math.floor((now - new Date(incident.created_at).getTime()) / 1000)) : 0;

  if (active && incident) {
    return (
      <Card data-testid="safety-mode" role="status" aria-live="assertive" className="p-4 border-destructive bg-destructive/5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-bold text-destructive"><Siren className="h-5 w-5" /> Safety Mode on</div>
          <Badge variant="destructive" data-testid="sos-reference">{incident.reference}</Badge>
        </div>
        <div className="text-sm font-medium">{INCIDENT_STATUS_LABEL[incident.status]}</div>
        <div className="text-xs text-muted-foreground">
          Alert open {Math.floor(elapsed / 60)}m {elapsed % 60}s · {incident.severity} priority
          {overdue && <span className="text-destructive font-semibold"> · Not yet answered — please call 999 as well</span>}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button asChild variant="destructive"><a href="tel:999"><Phone className="h-4 w-4 mr-1" /> Call 999</a></Button>
          <Button asChild variant="outline"><a href="tel:112"><Phone className="h-4 w-4 mr-1" /> Call 112</a></Button>
        </div>
        <div className="text-xs flex items-center gap-1">
          <MapPin className="h-3 w-3" />
          {locOk === false ? "Location unavailable — allow location access so responders can find you."
            : locOk ? "Sharing your live location with TaxiD Safety." : "Getting your location…"}
        </div>
        <div className="text-sm">
          <div className="font-medium mb-1">Your emergency contacts</div>
          {notices.length === 0 ? (
            <div className="text-xs text-muted-foreground">No emergency contacts saved. Add one in Safety Center.</div>
          ) : notices.map((n) => (
            <div key={n.id} className="text-xs flex justify-between gap-2">
              <span>{n.contact_name} {n.contact_phone && <a className="underline" href={`tel:${n.contact_phone}`}>{n.contact_phone}</a>}</span>
              <span className="text-muted-foreground">{NOTIFY_LABEL[n.status] ?? n.status}</span>
            </div>
          ))}
        </div>
        {!compact && events.length > 0 && (
          <ol className="text-xs border-l pl-3 space-y-1">
            {events.map((e) => (
              <li key={e.id}><span className="text-muted-foreground">{new Date(e.created_at).toLocaleTimeString()}</span> · {e.note ?? e.event_type.replace(/_/g, " ")}</li>
            ))}
          </ol>
        )}
        <Button variant="secondary" className="w-full" onClick={markSafe}><ShieldCheck className="h-4 w-4 mr-1" /> I'm safe now</Button>
      </Card>
    );
  }

  return (
    <Card className="p-4 border-destructive/40 bg-destructive/5 space-y-3">
      <div className="flex items-center gap-2 font-bold text-destructive"><AlertTriangle className="h-5 w-5" /> Emergency</div>
      {offlineQueued && (
        <div className="text-xs flex items-center gap-1 text-destructive"><WifiOff className="h-3 w-3" /> Alert waiting for internet — call 999 now.</div>
      )}
      {incident && !active && (
        <div className="text-xs text-muted-foreground">Last alert {incident.reference}: {INCIDENT_STATUS_LABEL[incident.status]}</div>
      )}
      {!choosing ? (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="destructive" size="lg" onClick={() => setChoosing(true)} data-testid="sos-open"><Siren className="h-4 w-4 mr-1" /> SOS</Button>
          <Button asChild variant="outline" size="lg"><a href="tel:999"><Phone className="h-4 w-4 mr-1" /> Call 999</a></Button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="text-sm">What's happening? Tap one — TaxiD Safety gets your trip, driver, car and location.</div>
          <div className="grid grid-cols-2 gap-2">
            {INCIDENT_TYPES.map((t) => (
              <Button key={t.id} variant={t.id === "immediate_danger" ? "destructive" : "outline"} disabled={busy}
                onClick={() => raise(t.id)} className="justify-start h-auto py-3">
                {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <t.icon className="h-4 w-4 mr-1" />} {t.label}
              </Button>
            ))}
          </div>
          <Textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1000} rows={2} placeholder="Optional details" />
          <Button variant="ghost" size="sm" onClick={() => setChoosing(false)}>Cancel</Button>
        </div>
      )}
      <p className="text-xs text-muted-foreground">For life-threatening emergencies always also call 999 or 112.</p>
    </Card>
  );
}
