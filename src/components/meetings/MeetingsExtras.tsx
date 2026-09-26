import * as React from "react";
import { Link } from "react-router-dom";
import { Loader2, Video, Trash2, CheckCircle2, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { dateTimeLabel } from "@/lib/meetings/booking";

import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const db = supabase as any;

function OpsDashboard() {
  const [days, setDays] = React.useState(30);
  const [d, setD] = React.useState<any>(null);
  React.useEffect(() => { setD(null); db.rpc("meeting_ops_dashboard", { _days: days }).then(({ data }: any) => setD(data ?? {})); }, [days]);
  if (!d) return <Loader2 className="h-5 w-5 animate-spin" />;
  const series = (d.series ?? []).map((r: any) => ({ ...r, day: r.day.slice(5) }));
  const sum = (k: string) => series.reduce((a: number, r: any) => a + Number(r[k] ?? 0), 0);
  const load = (d.calendar_load ?? []).map((h: any) => ({ name: h.name, Meetings: h.meetings_next_7, Blocks: h.blocks_next_7, Capacity: h.max_per_day * 5, shared: h.shared }));
  const Tile = ({ label, value }: { label: string; value: string | number }) => (
    <Card><CardContent className="p-4"><p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p></CardContent></Card>
  );
  const Chips = ({ title, obj }: { title: string; obj: Record<string, number> }) => (
    <Card><CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader><CardContent className="flex flex-wrap gap-2">
      {Object.keys(obj ?? {}).length ? Object.entries(obj).map(([k, v]) => <Badge key={k} variant="secondary">{k}: {v}</Badge>) : <span className="text-sm text-muted-foreground">None.</span>}
    </CardContent></Card>
  );
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">Operations dashboard</p>
        <div className="flex gap-1">{[7, 30, 90].map((n) => <Button key={n} size="sm" variant={days === n ? "default" : "outline"} onClick={() => setDays(n)}>{n} days</Button>)}</div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Meetings" value={sum("meetings")} />
        <Tile label="New leads" value={sum("leads")} />
        <Tile label="Confirmed payments" value={sum("payments")} />
        <Tile label="Payments received" value={`KES ${sum("payments_kes").toLocaleString("en-KE")}`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader><CardTitle className="text-base">Meetings and new leads per day</CardTitle></CardHeader><CardContent className="h-64">
          <ResponsiveContainer><LineChart data={series}><CartesianGrid strokeDasharray="3 3" className="stroke-border" /><XAxis dataKey="day" fontSize={11} /><YAxis allowDecimals={false} fontSize={11} /><Tooltip /><Legend />
            <Line type="monotone" dataKey="meetings" name="Meetings" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="leads" name="New leads" stroke="hsl(var(--status-info, var(--accent)))" strokeWidth={2} dot={false} />
          </LineChart></ResponsiveContainer></CardContent></Card>
        <Card><CardHeader><CardTitle className="text-base">Confirmed M-Pesa payments per day (KES)</CardTitle></CardHeader><CardContent className="h-64">
          <ResponsiveContainer><BarChart data={series}><CartesianGrid strokeDasharray="3 3" className="stroke-border" /><XAxis dataKey="day" fontSize={11} /><YAxis fontSize={11} /><Tooltip />
            <Bar dataKey="payments_kes" name="KES" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
          </BarChart></ResponsiveContainer></CardContent></Card>
        <Card className="lg:col-span-2"><CardHeader><CardTitle className="text-base">Calendar load — next 7 days per host</CardTitle></CardHeader><CardContent className="h-72">
          <ResponsiveContainer><BarChart data={load}><CartesianGrid strokeDasharray="3 3" className="stroke-border" /><XAxis dataKey="name" fontSize={11} /><YAxis allowDecimals={false} fontSize={11} /><Tooltip /><Legend />
            <Bar dataKey="Meetings" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
            <Bar dataKey="Blocks" name="SAFARID calendar blocks" fill="hsl(var(--muted-foreground))" radius={[4, 4, 0, 0]} />
            <Bar dataKey="Capacity" name="Weekly limit" fill="hsl(var(--border))" radius={[4, 4, 0, 0]} />
          </BarChart></ResponsiveContainer>
        </CardContent></Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Chips title="Meetings by status" obj={d.meeting_status} />
        <Chips title="Leads by stage" obj={d.lead_stages} />
        <Chips title="Payments by status" obj={d.payment_status} />
      </div>
    </div>
  );
}
export const YALLA_CALENDAR = "yallabeenaride@gmail.com";

export function useMyStaffId() {
  const [id, setId] = React.useState<string | null | undefined>(undefined);
  React.useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return setId(null);
      const { data } = await db.from("staff_members").select("id").eq("user_id", u.user.id).maybeSingle();
      setId(data?.id ?? null);
    })();
  }, []);
  return id;
}

/** SAFARID native calendar: the staff member's own busy blocks, leave, prep and travel time. */
export function YallaCalendar() {
  const staffId = useMyStaffId();
  const { toast } = useToast();
  const [rows, setRows] = React.useState<any[] | null>(null);
  const [f, setF] = React.useState({ kind: "block", title: "", date: "", from: "09:00", to: "10:00" });
  const load = React.useCallback(async () => {
    if (!staffId) return;
    const { data } = await db.from("staff_calendar_blocks").select("*").eq("staff_id", staffId).gte("ends_at", new Date().toISOString()).order("starts_at").limit(100);
    setRows(data ?? []);
  }, [staffId]);
  React.useEffect(() => { load(); }, [load]);
  if (staffId === undefined) return <Loader2 className="h-5 w-5 animate-spin" />;
  if (!staffId) return <p className="text-sm text-muted-foreground">Your staff profile is not linked to this sign-in, so there is no SAFARID calendar to show.</p>;
  const add = async () => {
    if (!f.date) return toast({ title: "Pick a date", variant: "destructive" });
    const s = new Date(`${f.date}T${f.from}:00+03:00`), e = new Date(`${f.date}T${f.to}:00+03:00`);
    if (e <= s) return toast({ title: "End must be after start", variant: "destructive" });
    const { error } = await db.from("staff_calendar_blocks").insert({ staff_id: staffId, kind: f.kind, title: f.title || "Busy", starts_at: s.toISOString(), ends_at: e.toISOString() });
    if (error) toast({ title: "Not saved", description: error.message, variant: "destructive" }); else { setF({ ...f, title: "" }); load(); }
  };
  const del = async (id: string) => { await db.from("staff_calendar_blocks").delete().eq("id", id); load(); };
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Your SAFARID calendar is the main source of your availability. Anything you add here hides those times from clients and colleagues booking you. Meetings booked through SAFARID appear automatically.</p>
      <Card><CardContent className="grid items-end gap-3 p-4 sm:grid-cols-6">
        <label className="text-xs text-muted-foreground">Type
          <select className="mt-1 h-10 w-full rounded-md border bg-background px-2 text-sm" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
            {[["block", "Busy"], ["leave", "Leave"], ["prep", "Preparation"], ["follow_up", "Follow-up time"], ["internal", "Internal"], ["travel", "Travel"]].map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select></label>
        <label className="text-xs text-muted-foreground sm:col-span-2">Title<Input value={f.title} maxLength={160} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Site visit, Jhpiego" /></label>
        <label className="text-xs text-muted-foreground">Date<Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
        <label className="text-xs text-muted-foreground">From – to<div className="flex gap-1"><Input type="time" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /><Input type="time" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></div></label>
        <Button onClick={add}>Add to my calendar</Button>
      </CardContent></Card>
      {!rows ? <Loader2 className="h-5 w-5 animate-spin" /> : rows.length === 0 ? <p className="text-sm text-muted-foreground">No upcoming blocks. Your working hours apply.</p> :
        rows.map((r) => (
          <Card key={r.id}><CardContent className="flex items-center justify-between p-3 text-sm">
            <div><Badge variant="outline" className="mr-2">{r.kind}</Badge>{r.title} · {dateTimeLabel(r.starts_at)} – {new Date(r.ends_at).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Nairobi" })}</div>
            <Button size="icon" variant="ghost" aria-label="Remove" onClick={() => del(r.id)}><Trash2 className="h-4 w-4" /></Button>
          </CardContent></Card>
        ))}
    </div>
  );
}

/** Host follow-up: upcoming meetings with a prepare checklist, and overdue outcomes. */
export function HostFollowUp() {
  const staffId = useMyStaffId();
  const [rows, setRows] = React.useState<any[] | null>(null);
  const [done, setDone] = React.useState<Record<string, boolean>>(() => JSON.parse(localStorage.getItem("meeting-prep") ?? "{}"));
  React.useEffect(() => {
    if (!staffId) return;
    db.from("public_meeting_bookings").select("id,client_name,company,topic,starts_at,duration_minutes,status,outcome,join_url,lead_id,prep_work_item_id,meeting_types(name),sales_leads(lead_ref,organisation_name,stage,estimated_value_kes,updated_at)")
      .eq("host_staff_id", staffId).eq("status", "confirmed").gte("starts_at", new Date(Date.now() - 14 * 86400_000).toISOString()).order("starts_at").limit(100)
      .then(({ data }: any) => setRows(data ?? []));
  }, [staffId]);
  const tick = (k: string) => { const n = { ...done, [k]: !done[k] }; setDone(n); localStorage.setItem("meeting-prep", JSON.stringify(n)); };
  if (staffId === undefined || (staffId && !rows)) return <Loader2 className="h-5 w-5 animate-spin" />;
  if (!staffId) return <p className="text-sm text-muted-foreground">Your staff profile is not linked to this sign-in.</p>;
  const now = Date.now();
  const overdue = rows!.filter((b) => !b.outcome && Date.parse(b.starts_at) + b.duration_minutes * 60_000 < now);
  const upcoming = rows!.filter((b) => Date.parse(b.starts_at) > now);
  const steps = [["lead", "Review the lead"], ["contact", "Check the last contact"], ["quotes", "Check open quotes"], ["agenda", "Set the agenda"]];
  return (
    <div className="space-y-4">
      {overdue.length > 0 && <Card className="border-destructive"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-4 w-4" />Overdue: {overdue.length} meeting{overdue.length > 1 ? "s" : ""} without an outcome</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-sm">{overdue.map((b) => <div key={b.id}>{b.company || b.client_name} · {dateTimeLabel(b.starts_at)} — record the outcome in <b>My meetings</b>.</div>)}</CardContent></Card>}
      {upcoming.length === 0 ? <p className="text-sm text-muted-foreground">No upcoming meetings to prepare for.</p> : upcoming.map((b) => (
        <Card key={b.id}><CardContent className="space-y-2 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><div className="font-medium">Prepare: {b.company || b.client_name} · {b.meeting_types?.name ?? "Meeting"}</div><div className="text-sm text-muted-foreground">{dateTimeLabel(b.starts_at)} · {b.topic.split("\n")[0]}</div></div>
            {b.join_url && <Button size="sm" asChild><a href={b.join_url} target="_blank" rel="noreferrer"><Video className="mr-1 h-4 w-4" />Join</a></Button>}
          </div>
          {b.sales_leads && <p className="text-xs text-muted-foreground">Lead {b.sales_leads.lead_ref} · {b.sales_leads.organisation_name} · stage {b.sales_leads.stage}{b.sales_leads.estimated_value_kes ? ` · KES ${Number(b.sales_leads.estimated_value_kes).toLocaleString()}` : ""} · last updated {new Date(b.sales_leads.updated_at).toLocaleDateString("en-KE")}</p>}
          <div className="flex flex-wrap gap-3">{steps.map(([k, l]) => { const key = `${b.id}:${k}`; return (
            <button key={k} onClick={() => tick(key)} className="flex items-center gap-1 text-sm"><CheckCircle2 className={`h-4 w-4 ${done[key] ? "text-primary" : "text-muted-foreground"}`} />{l}</button>); })}</div>
          <div className="flex gap-3 text-xs">{b.prep_work_item_id && <Link className="underline" to="/staff/workspace">Prepare task in my work queue</Link>}<Link className="underline" to="/staff/meetings?tab=mine">Open in My meetings</Link></div>
        </CardContent></Card>
      ))}
    </div>
  );
}

/** Calendar Connections: status per provider plus the free/busy sharing guide. */
export function CalendarConnections() {
  const staffId = useMyStaffId();
  const { toast } = useToast();
  const [rows, setRows] = React.useState<any[]>([]);
  const [host, setHost] = React.useState<any>(null);
  const load = React.useCallback(async () => {
    if (!staffId) return;
    const { data } = await db.from("staff_calendar_connections").select("*").eq("staff_id", staffId);
    setRows(data ?? []);
    const { data: h } = await db.from("meeting_type_hosts").select("calendar_status,calendar_checked_at").eq("staff_id", staffId).limit(1).maybeSingle();
    setHost(h);
  }, [staffId]);
  React.useEffect(() => { load(); }, [load]);
  const markShared = async () => {
    const { error } = await db.from("staff_calendar_connections").upsert({ staff_id: staffId, provider: "shared_freebusy", status: "pending", updated_at: new Date().toISOString() }, { onConflict: "staff_id,provider" });
    if (error) toast({ title: "Not saved", description: error.message, variant: "destructive" });
    else { toast({ title: "Thanks — we'll confirm it on the next availability check" }); load(); }
  };
  if (staffId === undefined) return <Loader2 className="h-5 w-5 animate-spin" />;
  if (!staffId) return <p className="text-sm text-muted-foreground">Your staff profile is not linked to this sign-in.</p>;
  const st = (p: string) => rows.find((r) => r.provider === p)?.status ?? "not_connected";
  const shared = host?.calendar_status === "verified" ? "verified" : st("shared_freebusy");
  const label: Record<string, string> = { verified: "Working", pending: "Waiting for check", not_connected: "Not connected", error: "Problem", not_shared: "Not shared yet" };
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        {[["SAFARID calendar", "verified", "Always on: working hours, your blocks and SAFARID bookings."],
          ["Shared Google free/busy", shared, host?.calendar_checked_at ? `Last checked ${new Date(host.calendar_checked_at).toLocaleString("en-KE")}` : "Not checked yet"],
          ["Google Calendar sign-in", st("google"), "Coming once the Google sign-in setup is finished."]].map(([t, s, d]) => (
          <Card key={t}><CardContent className="space-y-1 p-4"><div className="text-sm font-medium">{t}</div><Badge variant={s === "verified" ? "default" : "secondary"}>{label[s] ?? s}</Badge><p className="text-xs text-muted-foreground">{d}</p></CardContent></Card>
        ))}
      </div>
      <Card><CardHeader><CardTitle className="text-base">Share your Google Calendar free/busy with SAFARID (2 minutes)</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <ol className="list-decimal space-y-1 pl-5">
            <li>Open <a className="underline" href="https://calendar.google.com" target="_blank" rel="noreferrer">calendar.google.com</a> on a computer and sign in with the Google account you use for work.</li>
            <li>On the left, under <b>My calendars</b>, point at your calendar, click the three dots, then <b>Settings and sharing</b>.</li>
            <li>Scroll to <b>Share with specific people or groups</b> and click <b>Add people and groups</b>.</li>
            <li>Type <b>{YALLA_CALENDAR}</b>.</li>
            <li>Under permissions choose <b>See only free/busy (hide details)</b>, then click <b>Send</b>.</li>
            <li>Come back here and press <b>I've shared it</b>. The next availability check confirms it.</li>
          </ol>
          <p className="text-xs text-muted-foreground">SAFARID only sees when you are busy, never the event titles or details. Busy elsewhere? Add those times to your SAFARID calendar.</p>
          <Button onClick={markShared}>I've shared it</Button>
        </CardContent></Card>
    </div>
  );
}

/** Operations health: failed bookings, missing links, overdue outcomes, host connection status. */
export function MeetingsHealth() {
  const [d, setD] = React.useState<any>(null);
  const [err, setErr] = React.useState<string | null>(null);
  React.useEffect(() => { db.rpc("meeting_ops_health").then(({ data, error }: any) => error ? setErr(error.message) : setD(data)); }, []);
  if (err) return <p className="text-sm text-muted-foreground">{err.includes("NOT_AUTHORISED") ? "Only admins and the sales manager can see operations health." : "Could not load health."}</p>;
  if (!d) return <Loader2 className="h-5 w-5 animate-spin" />;
  const List = ({ title, rows, render }: { title: string; rows: any[]; render: (r: any) => React.ReactNode }) => (
    <Card><CardHeader><CardTitle className="text-base">{title} <span className="text-sm font-normal text-muted-foreground">({rows.length})</span></CardTitle></CardHeader>
      <CardContent className="space-y-1 text-sm">{rows.length ? rows.map((r, i) => <div key={i}>{render(r)}</div>) : <p className="text-muted-foreground">None.</p>}</CardContent></Card>
  );
  return (
    <div className="space-y-4">
      <OpsDashboard />
    <div className="grid gap-4 lg:grid-cols-2">
      <List title="Hosts and calendar status" rows={d.hosts} render={(h) => <span>{h.name} · Google free/busy: <b>{h.calendar_status ?? "unknown"}</b> · Google sign-in: {h.google ?? "not connected"} · {h.upcoming} upcoming · limit {h.max_per_day}/day</span>} />
      <List title="Meetings passed without an outcome" rows={d.no_outcome} render={(r) => <span>{r.client} · {dateTimeLabel(r.starts_at)} · {r.host ?? "no host"}</span>} />
      <List title="Failed bookings (30 days)" rows={d.failed_bookings} render={(r) => <span>{r.client} · {dateTimeLabel(r.starts_at)} · {r.reason ?? "no reason recorded"}</span>} />
      <List title="Upcoming meetings without a joining link" rows={d.no_meet_link} render={(r) => <span>{r.client} · {dateTimeLabel(r.starts_at)}</span>} />
    </div>
    </div>
  );
}
