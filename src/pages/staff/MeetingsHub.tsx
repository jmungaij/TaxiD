import * as React from "react";
import { Loader2, Video } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import BookingWizard from "@/components/meetings/BookingWizard";
import { dateTimeLabel } from "@/lib/meetings/booking";
import { useSearchParams } from "react-router-dom";
import { YallaCalendar, HostFollowUp, CalendarConnections, MeetingsHealth, useMyStaffId } from "@/components/meetings/MeetingsExtras";

const db = supabase as any;

type Booking = { routing_explanation: any; routing_reason: string | null; availability_confidence: string | null; lead_created: boolean; sales_leads: { lead_ref: string; organisation_name: string; stage: string; estimated_value_kes: number | null } | null; id: string; client_name: string; client_email: string; company: string | null; topic: string; starts_at: string; duration_minutes: number; status: string; join_url: string | null; channel: string; outcome: string | null; outcome_notes: string | null; lead_id: string | null; meeting_types: { name: string } | null; host_staff_id: string | null };
type MType = { id: string; name: string; duration_minutes: number; buffer_minutes: number; min_notice_hours: number; max_advance_days: number; active: boolean; is_public: boolean };

const OUTCOMES = [["held", "Held"], ["no_show", "No-show"], ["follow_up", "Follow-up needed"], ["deal", "Became a deal"]] as const;

function Bookings() {
  const { toast } = useToast();
  const staffId = useMyStaffId();
  const [all, setAll] = React.useState(false);
  const [rows, setRows] = React.useState<Booking[] | null>(null);
  const [hist, setHist] = React.useState<Record<string, any[]>>({});
  const load = React.useCallback(async () => {
    const { data, error } = await db.from("public_meeting_bookings")
      .select("routing_explanation,id,client_name,client_email,company,topic,starts_at,duration_minutes,status,join_url,channel,outcome,outcome_notes,lead_id,host_staff_id,routing_reason,availability_confidence,lead_created,meeting_types(name),sales_leads(lead_ref,organisation_name,stage,estimated_value_kes)")
      .gte("starts_at", new Date(Date.now() - 30 * 86400_000).toISOString()).order("starts_at", { ascending: true }).limit(200);
    if (staffId === undefined) return;
    if (error) toast({ title: "Could not load meetings", description: error.message, variant: "destructive" });
    setRows((data ?? []).filter((b: Booking) => all || !staffId || b.host_staff_id === staffId));
  }, [toast, staffId, all]);
  React.useEffect(() => { load(); }, [load]);

  const setOutcome = async (id: string, outcome: string) => {
    const { error } = await db.from("public_meeting_bookings").update({ outcome, status: outcome === "no_show" ? "no_show" : "completed", updated_at: new Date().toISOString() }).eq("id", id);
    if (error) toast({ title: "Not saved", description: error.message, variant: "destructive" });
    else { toast({ title: "Outcome recorded" }); load(); }
  };
  const showHist = async (id: string) => {
    const { data } = await db.from("meeting_booking_events").select("event,from_status,to_status,actor_label,created_at,detail").eq("booking_id", id).order("created_at");
    setHist((h) => ({ ...h, [id]: data ?? [] }));
  };

  if (!rows) return <Loader2 className="h-5 w-5 animate-spin" />;
  const toggle = <label className="flex items-center gap-2 text-sm"><Switch checked={all} onCheckedChange={setAll} /> Show every host's meetings I'm allowed to see</label>;
  if (!rows.length) return <div className="space-y-3">{toggle}<p className="text-sm text-muted-foreground">No meetings in the last 30 days or upcoming that you host.</p></div>;
  const now = Date.now();
  const debt = rows.filter((b) => b.status === "confirmed" && !b.outcome && Date.parse(b.starts_at) + b.duration_minutes * 60_000 < now);
  return (
    <div className="space-y-3">
      {toggle}
      {debt.length > 0 && <Card className="border-destructive"><CardContent className="p-4 text-sm"><b>{debt.length} meeting{debt.length > 1 ? "s" : ""} without an outcome.</b> Log what happened so follow-ups are created and nothing is lost.</CardContent></Card>}
      {rows.map((b) => {
        const past = Date.parse(b.starts_at) + b.duration_minutes * 60_000 < now;
        return (
          <Card key={b.id}><CardContent className="space-y-2 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-medium">{b.company || b.client_name} · {b.meeting_types?.name ?? "Meeting"}</div>
                <div className="text-sm text-muted-foreground">{dateTimeLabel(b.starts_at)} · {b.client_name} &lt;{b.client_email}&gt;</div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={b.status === "confirmed" ? "default" : "secondary"}>{b.status}</Badge>
                <Badge variant="outline">{b.channel === "staff" ? "Booked by staff" : "Booked by client"}</Badge>
                {b.lead_id && <Badge variant="outline">Lead linked</Badge>}
                {b.join_url && b.status === "confirmed" && <Button size="sm" asChild><a href={b.join_url} target="_blank" rel="noreferrer"><Video className="mr-1 h-4 w-4" />Join</a></Button>}
              </div>
            </div>
            <p className="text-sm">{b.topic}</p>
            {b.sales_leads && <p className="text-xs text-muted-foreground">Brief: {b.sales_leads.organisation_name} · {b.sales_leads.lead_ref} · stage {b.sales_leads.stage}{b.sales_leads.estimated_value_kes ? ` · KES ${Number(b.sales_leads.estimated_value_kes).toLocaleString()}` : ""}{b.lead_created ? " · new lead from this booking" : ""}</p>}
            <p className="text-xs text-muted-foreground">{b.routing_reason ? `Assigned: ${({ client_selected: "client chose this host", existing_relationship: "existing relationship owner", balanced_workload: "balanced workload", only_verified_calendar: "only host with a verified calendar", only_available: "only host free" } as Record<string, string>)[b.routing_reason] ?? b.routing_reason}` : ""}{b.availability_confidence === "working_hours_only" ? " · host calendar not verified, check for clashes" : ""}</p>
            {b.routing_explanation && <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">Why this host</summary>
              <p className="mt-1"><b>{b.routing_explanation.chosen}</b>: {b.routing_explanation.why}</p>
              <p className="text-muted-foreground">Checked in order: {b.routing_explanation.rank?.join(" → ")}</p>
              <ul className="text-muted-foreground">{b.routing_explanation.candidates?.map((c: any) => <li key={c.name}>{c.name}: {c.free ? "free" : "not free"} · calendar {c.calendar} · {c.load ?? "–"} upcoming · today {c.today}</li>)}</ul>
            </details>}
            {past && b.status === "confirmed" && !b.outcome && (
              <div className="flex flex-wrap gap-2"><span className="text-sm font-medium">Log outcome:</span>
                {OUTCOMES.map(([k, l]) => <Button key={k} size="sm" variant="outline" onClick={() => setOutcome(b.id, k)}>{l}</Button>)}
              </div>
            )}
            {b.outcome && <p className="text-sm">Outcome: <b>{OUTCOMES.find(([k]) => k === b.outcome)?.[1]}</b></p>}
            <Button size="sm" variant="link" className="px-0" onClick={() => showHist(b.id)}>History</Button>
            {hist[b.id] && <ul className="text-xs text-muted-foreground">{hist[b.id].map((h, i) => <li key={i}>{new Date(h.created_at).toLocaleString("en-KE")} · {h.event} {h.from_status ? `${h.from_status} → ` : ""}{h.to_status ?? ""} · {h.actor_label}</li>)}</ul>}
          </CardContent></Card>
        );
      })}
    </div>
  );
}

function Settings() {
  const { toast } = useToast();
  const [types, setTypes] = React.useState<MType[] | null>(null);
  const [canEdit, setCanEdit] = React.useState(false);
  const load = React.useCallback(async () => {
    const { data } = await db.from("meeting_types").select("id,name,duration_minutes,buffer_minutes,min_notice_hours,max_advance_days,active,is_public").order("sort_order");
    setTypes(data ?? []);
    const { data: u } = await supabase.auth.getUser();
    const { data: m } = u.user ? await db.rpc("has_any_role", { _user_id: u.user.id, _roles: ["admin", "super_admin", "general_manager"] }) : { data: false };
    setCanEdit(m === true);
  }, []);
  React.useEffect(() => { load(); }, [load]);
  const save = async (t: MType, patch: Partial<MType>) => {
    const { error } = await db.from("meeting_types").update(patch).eq("id", t.id);
    if (error) toast({ title: "Not saved", description: error.message, variant: "destructive" }); else load();
  };
  if (!types) return <Loader2 className="h-5 w-5 animate-spin" />;
  return (
    <div className="space-y-3">
      {!canEdit && <p className="text-sm text-muted-foreground">Only admins and the sales manager can change meeting types.</p>}
      {types.map((t) => (
        <Card key={t.id}><CardContent className="grid items-end gap-3 p-4 sm:grid-cols-6">
          <div className="sm:col-span-2 font-medium">{t.name}</div>
          {(["duration_minutes", "buffer_minutes", "min_notice_hours", "max_advance_days"] as const).map((k) => (
            <label key={k} className="text-xs text-muted-foreground">{{ duration_minutes: "Minutes", buffer_minutes: "Buffer", min_notice_hours: "Notice (h)", max_advance_days: "Window (days)" }[k]}
              <Input type="number" defaultValue={t[k]} disabled={!canEdit} onBlur={(e) => Number(e.target.value) !== t[k] && save(t, { [k]: Number(e.target.value) })} />
            </label>
          ))}
          <label className="flex items-center gap-2 text-sm sm:col-span-6"><Switch checked={t.active} disabled={!canEdit} onCheckedChange={(v) => save(t, { active: v })} /> Offered to clients</label>
        </CardContent></Card>
      ))}
    </div>
  );
}

function Analytics() {
  const [s, setS] = React.useState<Record<string, number> | null>(null);
  React.useEffect(() => {
    db.from("public_meeting_bookings").select("status,outcome,channel").gte("created_at", new Date(Date.now() - 90 * 86400_000).toISOString()).then(({ data }: any) => {
      const r = data ?? [];
      const held = r.filter((x: any) => x.outcome === "held" || x.outcome === "follow_up" || x.outcome === "deal").length;
      const noshow = r.filter((x: any) => x.outcome === "no_show").length;
      setS({ Booked: r.length, "By clients": r.filter((x: any) => x.channel === "client").length, "By staff": r.filter((x: any) => x.channel === "staff").length,
        Cancelled: r.filter((x: any) => x.status === "cancelled").length, Held: held, "No-shows": noshow, "Became deals": r.filter((x: any) => x.outcome === "deal").length,
        "Show rate %": held + noshow ? Math.round((held / (held + noshow)) * 100) : 0 });
    });
  }, []);
  if (!s) return <Loader2 className="h-5 w-5 animate-spin" />;
  return <div className="grid gap-3 sm:grid-cols-4">{Object.entries(s).map(([k, v]) => <Card key={k}><CardContent className="p-4"><div className="text-xs text-muted-foreground">{k}</div><div className="text-2xl font-semibold">{v}</div></CardContent></Card>)}</div>;
}

export default function MeetingsHub() {
  const [sp, setSp] = useSearchParams();
  const tab = sp.get("tab") ?? "mine";
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Meetings</h1>
        <p className="text-sm text-muted-foreground">Your TaxiD calendar and meetings: prepare, join, log outcomes and book for clients. Clients book themselves at /book-a-meeting.</p>
      </div>
      <Tabs value={tab} onValueChange={(v) => setSp({ tab: v })}>
        <TabsList className="flex-wrap h-auto"><TabsTrigger value="mine">My meetings</TabsTrigger><TabsTrigger value="followup">Follow-up</TabsTrigger><TabsTrigger value="calendar">My TaxiD calendar</TabsTrigger><TabsTrigger value="book">Book for a client</TabsTrigger><TabsTrigger value="connections">Calendar connections</TabsTrigger><TabsTrigger value="health">Health</TabsTrigger><TabsTrigger value="settings">Meeting types</TabsTrigger><TabsTrigger value="analytics">Analytics (90 days)</TabsTrigger></TabsList>
        <TabsContent value="book" className="pt-4"><BookingWizard mode="staff" /></TabsContent>
        <TabsContent value="mine" className="pt-4"><Bookings /></TabsContent>
        <TabsContent value="followup" className="pt-4"><HostFollowUp /></TabsContent>
        <TabsContent value="calendar" className="pt-4"><YallaCalendar /></TabsContent>
        <TabsContent value="connections" className="pt-4"><CalendarConnections /></TabsContent>
        <TabsContent value="health" className="pt-4"><MeetingsHealth /></TabsContent>
        <TabsContent value="settings" className="pt-4"><Settings /></TabsContent>
        <TabsContent value="analytics" className="pt-4"><Analytics /></TabsContent>
      </Tabs>
    </div>
  );
}
