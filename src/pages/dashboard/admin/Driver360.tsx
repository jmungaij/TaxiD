import type { LooseRow } from "@/lib/types/loose";
import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  ArrowLeft, Phone, MessageSquare, MapPin, Star, Wallet as WalletIcon,
  Car, ShieldCheck, GraduationCap, TrendingUp, LifeBuoy, Clock, Activity,
  FileText, AlertTriangle,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import {
  isDriver360Tab,
  normalizeDriver360Tab,
  trackDriver360TabLanding,
} from "@/lib/driver360Links";
import { readLastDriver360Tab, writeLastDriver360Tab } from "@/lib/driver360Prefs";

type Driver = LooseRow;

const kes = (c: number | null | undefined) =>
  `KES ${Math.abs((c ?? 0) / 100).toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;

export default function Driver360() {
  const { driverId = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTabParam = searchParams.get("tab");
  // If URL omitted ?tab= entirely, honour the last opened tab from localStorage.
  const effectiveRaw = rawTabParam ?? readLastDriver360Tab();
  const tabParam = normalizeDriver360Tab(effectiveRaw);

  // If ?tab= was invalid, replace URL so the workspace state stays truthful.
  useEffect(() => {
    if (rawTabParam !== null && !isDriver360Tab(rawTabParam)) {
      setSearchParams(
        (p) => {
          p.delete("tab");
          return p;
        },
        { replace: true },
      );
    }
  }, [rawTabParam, setSearchParams]);

  // Log every tab landing so we can measure workspace tab usage.
  useEffect(() => {
    if (!driverId) return;
    trackDriver360TabLanding(driverId, tabParam, rawTabParam);
    writeLastDriver360Tab(tabParam);
  }, [driverId, tabParam, rawTabParam]);
  const [driver, setDriver] = useState<Driver | null>(null);
  const [wallet, setWallet] = useState<{ id: string; balance_cents: number } | null>(null);
  const [txns, setTxns] = useState<LooseRow[]>([]);
  const [trips, setTrips] = useState<LooseRow[]>([]);
  const [docs, setDocs] = useState<LooseRow[]>([]);
  const [vehicles, setVehicles] = useState<LooseRow[]>([]);
  const [payouts, setPayouts] = useState<LooseRow[]>([]);
  const [alerts, setAlerts] = useState<LooseRow[]>([]);
  const [scores, setScores] = useState<LooseRow | null>(null);
  const [canonicalTimeline, setCanonicalTimeline] = useState<LooseRow[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!driverId) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverId]);

  async function load() {
    setLoading(true);
    const c: LooseRow = supabase;
    const { data: d } = await c.from("drivers").select("*").eq("id", driverId).maybeSingle();
    setDriver(d);
    const userId = d?.user_id;
    const [w, t, tr, dv, vh, po, al, sc, tl] = await Promise.all([
      userId ? c.from("wallets").select("id,balance_cents").eq("user_id", userId).eq("wallet_type", "driver").maybeSingle() : { data: null },
      userId ? c.from("wallet_transactions").select("id,direction,amount_cents,kind,status,reference,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(50) : { data: [] },
      c.from("trip_bookings").select("id,status,total_fare,pickup_address,dropoff_address,created_at").eq("driver_id", driverId).order("created_at", { ascending: false }).limit(50),
      // driver_documents.driver_id → auth.users(id); filter by userId, not drivers.id.
      userId ? c.from("driver_documents").select("id,doc_type,status,expires_at,updated_at").eq("driver_id", userId).order("updated_at", { ascending: false }).limit(50) : { data: [] },
      c.from("driver_vehicle_assignments").select("id,vehicle_id,assigned_at,ended_at,vehicles(plate_number,make,model,year)").eq("driver_id", driverId).order("assigned_at", { ascending: false }).limit(10),
      // driver_payouts.driver_id → auth.users(id); no `method` column — channel lives in metadata.
      userId ? c.from("driver_payouts").select("id,amount_cents,status,reference,metadata,created_at").eq("driver_id", userId).order("created_at", { ascending: false }).limit(25) : { data: [] },
      c.from("compliance_alerts").select("id,severity,status,message,created_at").eq("driver_id", driverId).order("created_at", { ascending: false }).limit(25),
      c.from("driver_scores").select("*").eq("driver_id", driverId).maybeSingle(),
      c.rpc("driver_timeline", { _driver_id: driverId, _limit: 200 }),
    ]);
    setWallet((w as LooseRow)?.data ?? null);
    setTxns(((t as LooseRow)?.data as LooseRow[]) ?? []);
    setTrips(((tr as LooseRow)?.data as LooseRow[]) ?? []);
    setDocs(((dv as LooseRow)?.data as LooseRow[]) ?? []);
    setVehicles(((vh as LooseRow)?.data as LooseRow[]) ?? []);
    setPayouts(((po as LooseRow)?.data as LooseRow[]) ?? []);
    setAlerts(((al as LooseRow)?.data as LooseRow[]) ?? []);
    setScores((sc as LooseRow)?.data ?? null);
    const tlEvents = ((tl as LooseRow)?.data?.events as LooseRow[]) ?? null;
    setCanonicalTimeline(tlEvents);
    setLoading(false);
  }

  const clientTimeline = useMemo(() => {
    const events: { at: string; type: string; label: string; meta?: string }[] = [];
    for (const t of txns) events.push({ at: t.created_at, type: "wallet", label: `${t.direction === "credit" ? "+" : "-"}${kes(t.amount_cents)} · ${t.kind}`, meta: t.reference ?? undefined });
    for (const t of trips) events.push({ at: t.created_at, type: "trip", label: `Trip · ${t.status}`, meta: t.pickup_address ?? undefined });
    for (const d of docs) events.push({ at: d.updated_at, type: "doc", label: `${d.doc_type} · ${d.status}` });
    for (const p of payouts) events.push({ at: p.created_at, type: "payout", label: `Payout ${kes(p.amount_cents)} · ${p.status}`, meta: p.metadata?.channel ?? "mpesa" });
    for (const a of alerts) events.push({ at: a.created_at, type: "alert", label: `Alert · ${a.severity}`, meta: a.message });
    return events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 100);
  }, [txns, trips, docs, payouts, alerts]);

  // Prefer the canonical, server-aggregated timeline when available; fall back to client-derived.
  const timeline = useMemo(() => {
    if (canonicalTimeline && canonicalTimeline.length > 0) {
      return canonicalTimeline.map((e: LooseRow) => ({
        at: e.at,
        type: e.type,
        label: e.label,
        meta: e.correlation_id ?? e.source,
      }));
    }
    return clientTimeline;
  }, [canonicalTimeline, clientTimeline]);


  if (loading) return <div className="p-8 text-muted-foreground">Loading driver…</div>;
  if (!driver) return <div className="p-8">Driver not found. <Link className="underline" to="/dashboard/admin/drivers">Back</Link></div>;

  const initials = `${driver.first_name?.[0] ?? ""}${driver.last_name?.[0] ?? ""}`.toUpperCase();

  async function updateStatus(status: string) {
    const { error } = await supabase.from("drivers").update({ status } as LooseRow).eq("id", driverId);
    if (error) return toast.error(error.message);
    toast.success(`Driver ${status}`);
    void load();
  }

  return (
    <div className="space-y-6">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b -mx-6 px-6 py-4">
        <div className="flex flex-wrap items-center gap-4">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/dashboard/admin/drivers"><ArrowLeft className="h-4 w-4 mr-1" /> Directory</Link>
          </Button>
          <Avatar className="h-12 w-12"><AvatarFallback>{initials}</AvatarFallback></Avatar>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold">{driver.first_name} {driver.last_name}</h1>
              <Badge variant="outline" className="font-mono text-[10px]">{driver.driver_code}</Badge>
              <Badge className={
                driver.status === "active" ? "bg-status-success/15 text-status-success" :
                driver.status === "suspended" ? "bg-status-danger/15 text-status-danger" :
                "bg-status-warning/15 text-status-warning"
              }>{driver.status}</Badge>
              <Badge variant="secondary">{driver.verification_status}</Badge>
            </div>
            <div className="text-xs text-muted-foreground">
              {driver.city ?? "—"} · {driver.phone_number ?? "—"} · {driver.email ?? "—"}
            </div>
          </div>
          <div className="ml-auto flex gap-2 flex-wrap">
            <Kpi icon={WalletIcon} label="Wallet" value={kes(wallet?.balance_cents)} />
            <Kpi icon={Star} label="Rating" value={Number(driver.driver_rating ?? 0).toFixed(2)} />
            <Kpi icon={Activity} label="Risk" value={Number(driver.risk_score ?? 0).toFixed(1)} />
            <div className="flex gap-1">
              <Button size="sm" variant="outline" disabled title="Contact channels ship with the Communications module (D12.x)"><Phone className="h-4 w-4" /></Button>
              <Button size="sm" variant="outline" disabled title="Contact channels ship with the Communications module (D12.x)"><MessageSquare className="h-4 w-4" /></Button>
              <Button size="sm" variant="outline" disabled title="Live locate ships with the Dispatch GPS module (D12.x)"><MapPin className="h-4 w-4" /></Button>
              {driver.status !== "suspended" ? (
                <Button size="sm" variant="destructive" onClick={() => updateStatus("suspended")}>Suspend</Button>
              ) : (
                <Button size="sm" onClick={() => updateStatus("active")}>Reactivate</Button>
              )}
            </div>
          </div>
        </div>
      </div>

      <Tabs value={tabParam} onValueChange={(v) => setSearchParams((p) => { p.set("tab", v); return p; }, { replace: true })}>
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="wallet">Wallet</TabsTrigger>
          <TabsTrigger value="earnings">Earnings</TabsTrigger>
          <TabsTrigger value="withdrawals">Withdrawals</TabsTrigger>
          <TabsTrigger value="trips">Trips</TabsTrigger>
          <TabsTrigger value="vehicles">Vehicles</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="compliance">Compliance</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="academy">Academy</TabsTrigger>
          <TabsTrigger value="support">Support</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="twin">Digital Twin</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid md:grid-cols-4 gap-3">
            <StatCard icon={Car} label="Trips (recent)" value={trips.length.toString()} />
            <StatCard icon={WalletIcon} label="Wallet balance" value={kes(wallet?.balance_cents)} />
            <StatCard icon={ShieldCheck} label="Documents" value={`${docs.filter(d=>d.status==="approved").length}/${docs.length} approved`} />
            <StatCard icon={AlertTriangle} label="Open alerts" value={alerts.filter(a=>a.status==="OPEN").length.toString()} tone="rose" />
          </div>
          <Card>
            <CardHeader><CardTitle className="text-base">Recent activity</CardTitle></CardHeader>
            <CardContent className="space-y-1">
              {timeline.slice(0, 15).map((e, i) => (
                <div key={i} className="flex items-center gap-3 py-1.5 border-b last:border-0 text-sm">
                  <Badge variant="outline" className="capitalize text-[10px]">{e.type}</Badge>
                  <div className="flex-1 min-w-0 truncate">{e.label}<span className="text-muted-foreground"> · {e.meta ?? ""}</span></div>
                  <span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(e.at), { addSuffix: true })}</span>
                </div>
              ))}
              {timeline.length === 0 && <div className="text-sm text-muted-foreground py-6 text-center">No activity yet.</div>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="wallet">
          <SimpleList title="Wallet transactions" rows={txns.map(t => ({
            key: t.id,
            left: `${t.direction === "credit" ? "+" : "-"}${kes(t.amount_cents)}`,
            mid: t.kind,
            right: t.reference ?? "—",
            at: t.created_at,
          }))} />
        </TabsContent>

        <TabsContent value="earnings">
          <EarningsPanel txns={txns} />
        </TabsContent>

        <TabsContent value="withdrawals">
          <SimpleList title="Payout history" rows={payouts.map(p => ({
            key: p.id,
            left: kes(p.amount_cents),
            mid: `${p.metadata?.channel ?? "mpesa"} · ${p.status}`,
            right: p.reference ?? "—",
            at: p.created_at,
          }))} />
        </TabsContent>

        <TabsContent value="trips">
          <Card><CardContent className="pt-4">
            <Table><TableHeader><TableRow>
              <TableHead>When</TableHead><TableHead>Status</TableHead><TableHead>Fare</TableHead><TableHead>From → To</TableHead>
            </TableRow></TableHeader><TableBody>
              {trips.map(t => (
                <TableRow key={t.id}>
                  <TableCell className="text-xs">{new Date(t.created_at).toLocaleString()}</TableCell>
                  <TableCell><Badge variant="outline">{t.status}</Badge></TableCell>
                  <TableCell>{`KES ${Number(t.total_fare ?? 0).toLocaleString("en-KE", { maximumFractionDigits: 0 })}`}</TableCell>
                  <TableCell className="text-xs">{t.pickup_address ?? "—"} → {t.dropoff_address ?? "—"}</TableCell>
                </TableRow>
              ))}
              {trips.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No trips.</TableCell></TableRow>}
            </TableBody></Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="vehicles">
          <Card><CardContent className="pt-4">
            <Table><TableHeader><TableRow>
              <TableHead>Plate</TableHead><TableHead>Vehicle</TableHead><TableHead>Assigned</TableHead><TableHead>Ended</TableHead>
            </TableRow></TableHeader><TableBody>
              {vehicles.map(v => (
                <TableRow key={v.id}>
                  <TableCell className="font-mono text-xs">{v.vehicles?.plate_number ?? "—"}</TableCell>
                  <TableCell>{v.vehicles ? `${v.vehicles.year ?? ""} ${v.vehicles.make ?? ""} ${v.vehicles.model ?? ""}` : "—"}</TableCell>
                  <TableCell className="text-xs">{v.assigned_at ? new Date(v.assigned_at).toLocaleDateString() : "—"}</TableCell>
                  <TableCell className="text-xs">{v.ended_at ? new Date(v.ended_at).toLocaleDateString() : "active"}</TableCell>
                </TableRow>
              ))}
              {vehicles.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No vehicles assigned.</TableCell></TableRow>}
            </TableBody></Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="documents">
          <Card><CardContent className="pt-4">
            <Table><TableHeader><TableRow>
              <TableHead>Type</TableHead><TableHead>Status</TableHead><TableHead>Expires</TableHead><TableHead>Updated</TableHead>
            </TableRow></TableHeader><TableBody>
              {docs.map(d => (
                <TableRow key={d.id}>
                  <TableCell>{d.doc_type}</TableCell>
                  <TableCell><Badge variant="outline">{d.status}</Badge></TableCell>
                  <TableCell className="text-xs">{d.expires_at ? new Date(d.expires_at).toLocaleDateString() : "—"}</TableCell>
                  <TableCell className="text-xs">{new Date(d.updated_at).toLocaleDateString()}</TableCell>
                </TableRow>
              ))}
              {docs.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No documents.</TableCell></TableRow>}
            </TableBody></Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="compliance">
          <SimpleList title="Compliance alerts" rows={alerts.map(a => ({
            key: a.id, left: a.severity, mid: a.status, right: a.message ?? "—", at: a.created_at,
          }))} />
        </TabsContent>

        <TabsContent value="performance">
          <div className="grid md:grid-cols-4 gap-3">
            <StatCard icon={Star} label="Rating" value={Number(driver.driver_rating ?? 0).toFixed(2)} />
            <StatCard icon={TrendingUp} label="Acceptance" value={`${Number(scores?.acceptance_rate ?? 0).toFixed(0)}%`} />
            <StatCard icon={ShieldCheck} label="Completion" value={`${Number(scores?.completion_rate ?? 0).toFixed(0)}%`} />
            <StatCard icon={Activity} label="Safety" value={Number(scores?.safety_score ?? 0).toFixed(1)} />
          </div>
        </TabsContent>

        <TabsContent value="academy">
          <Card><CardContent className="pt-4 text-sm text-muted-foreground">
            <GraduationCap className="h-5 w-5 mb-2 text-primary" />
            Academy progress for this driver is available in the <Link className="underline" to="/dashboard/admin/academy">Driver Academy</Link> module.
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="support">
          <Card><CardContent className="pt-4 text-sm text-muted-foreground">
            <LifeBuoy className="h-5 w-5 mb-2 text-primary" />
            Support cases for this driver are surfaced in the <Link className="underline" to="/dashboard/admin/contact-submissions">Support Console</Link>.
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="timeline">
          <Card><CardHeader><CardTitle className="text-base flex items-center gap-2"><Clock className="h-4 w-4" /> Unified timeline</CardTitle></CardHeader>
            <CardContent className="space-y-1">
              {timeline.map((e, i) => (
                <div key={i} className="flex items-center gap-3 py-1.5 border-b last:border-0 text-sm">
                  <Badge variant="outline" className="capitalize text-[10px]">{e.type}</Badge>
                  <div className="flex-1 min-w-0 truncate">{e.label}<span className="text-muted-foreground"> · {e.meta ?? ""}</span></div>
                  <span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(e.at), { addSuffix: true })}</span>
                </div>
              ))}
              {timeline.length === 0 && <div className="text-sm text-muted-foreground py-6 text-center">No events yet.</div>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="twin">
          <Card><CardContent className="pt-4 text-sm text-muted-foreground">
            <FileText className="h-5 w-5 mb-2 text-primary" />
            Live Digital Twin projections for this driver are synchronized through the platform&apos;s <Link className="underline" to="/dashboard/admin/digital-twin">Digital Twin</Link> module.
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Kpi({ icon: Icon, label, value }: { icon: LooseRow; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs">
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, tone }: { icon: LooseRow; label: string; value: string; tone?: string }) {
  const cls = tone === "rose" ? "text-status-danger" : "text-primary";
  return (
    <Card><CardContent className="p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <Icon className={`h-4 w-4 ${cls}`} />
      </div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </CardContent></Card>
  );
}

function SimpleList({ title, rows }: { title: string; rows: { key: string; left: string; mid: string; right: string; at: string }[] }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent className="space-y-1">
        {rows.length === 0 && <div className="text-sm text-muted-foreground py-6 text-center">No records.</div>}
        {rows.map(r => (
          <div key={r.key} className="flex items-center gap-3 py-2 border-b last:border-0 text-sm">
            <div className="font-semibold w-28 shrink-0">{r.left}</div>
            <div className="w-40 shrink-0 text-muted-foreground truncate">{r.mid}</div>
            <div className="flex-1 min-w-0 truncate">{r.right}</div>
            <div className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(r.at), { addSuffix: true })}</div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function EarningsPanel({ txns }: { txns: LooseRow[] }) {
  const periods: ("today" | "week" | "month" | "all")[] = ["today", "week", "month", "all"];
  const [p, setP] = useState<typeof periods[number]>("month");
  const cutoff = (() => {
    const d = new Date();
    if (p === "today") { d.setHours(0,0,0,0); return d.getTime(); }
    if (p === "week") { d.setDate(d.getDate() - 7); return d.getTime(); }
    if (p === "month") { d.setMonth(d.getMonth() - 1); return d.getTime(); }
    return 0;
  })();
  const scoped = txns.filter(t => new Date(t.created_at).getTime() >= cutoff);
  let gross = 0, commission = 0, tips = 0, bonuses = 0, net = 0;
  for (const t of scoped) {
    if (t.kind === "ride_earning") gross += t.amount_cents;
    else if (t.kind === "commission") commission += t.amount_cents;
    else if (t.kind === "tip") tips += t.amount_cents;
    else if (t.kind === "bonus" || t.kind === "incentive") bonuses += t.amount_cents;
  }
  net = gross - commission + tips + bonuses;
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {periods.map(x => (
          <Button key={x} size="sm" variant={p === x ? "default" : "outline"} onClick={() => setP(x)} className="capitalize">
            {x === "all" ? "Lifetime" : x}
          </Button>
        ))}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard icon={TrendingUp} label="Gross" value={kes(gross)} />
        <StatCard icon={FileText} label="Commission" value={`-${kes(commission)}`} />
        <StatCard icon={Star} label="Tips" value={kes(tips)} />
        <StatCard icon={Activity} label="Bonuses" value={kes(bonuses)} />
        <StatCard icon={WalletIcon} label="Net" value={kes(net)} />
      </div>
    </div>
  );
}
