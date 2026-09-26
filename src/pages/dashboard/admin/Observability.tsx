import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Activity, AlertTriangle, CheckCircle2, RefreshCcw, PlayCircle } from "lucide-react";
import { ResponsiveContainer, LineChart, Line, YAxis, XAxis, Tooltip as RTooltip, CartesianGrid } from "recharts";

type SLO = {
  id: string; slo_key: string; name: string; category: string; description: string | null;
  target_value: number; unit: string; comparator: string; window_minutes: number;
  severity: string; active: boolean;
};
type Measurement = {
  id: string; slo_id: string; measured_at: string; window_start?: string; window_end?: string;
  actual_value: number | null; target_value: number | null; compliant: boolean | null;
  burn_rate: number | null; numerator?: number | null; denominator?: number | null;
  details?: Record<string, unknown> | null;
};
type Alert = {
  id: string; slo_id: string | null; alert_key: string; severity: string; status: string;
  title: string; message: string | null; details: Record<string, unknown> | null;
  fired_at: string; acknowledged_at: string | null; acknowledged_by: string | null;
  resolved_at: string | null; resolved_by: string | null;
  acknowledgement_note: string | null; resolution_note: string | null;
  pagerduty_delivered: boolean | null;
};

const SEV_BADGE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  info: "secondary", warning: "outline", critical: "destructive",
};

function fmtValue(v: number | null | undefined, unit: string) {
  if (v == null) return "—";
  if (unit === "percent") return `${Number(v).toFixed(2)}%`;
  if (unit === "ms") return `${Math.round(Number(v))} ms`;
  if (unit === "seconds") return `${Number(v).toFixed(2)} s`;
  return Number(v).toFixed(2);
}
function compliantFn(actual: number | null, target: number, comparator: string) {
  if (actual == null) return null;
  switch (comparator) {
    case "gte": case ">=": return actual >= target;
    case "lte": case "<=": return actual <= target;
    case "gt": case ">": return actual > target;
    case "lt": case "<": return actual < target;
    case "eq": case "=": return actual === target;
    default: return null;
  }
}

export default function Observability() {
  const [slos, setSlos] = useState<SLO[]>([]);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [drill, setDrill] = useState<SLO | null>(null);
  const [drillMeasurements, setDrillMeasurements] = useState<Measurement[]>([]);
  const [drillAlerts, setDrillAlerts] = useState<Alert[]>([]);
  const [dialog, setDialog] = useState<{ alert: Alert; kind: "ack" | "resolve" } | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    const [slosRes, measRes, alertsRes] = await Promise.all([
      supabase.from("payment_slos").select("*").order("category"),
      supabase.from("payment_slo_measurements").select("*").gte("measured_at", since).order("measured_at"),
      supabase.from("payment_alerts").select("*").order("fired_at", { ascending: false }).limit(100),
    ]);
    const firstErr = slosRes.error ?? measRes.error ?? alertsRes.error;
    if (firstErr) {
      // Never present partial SLO data as authoritative — an empty alert list would
      // otherwise read as "all healthy".
      setLoadError(firstErr.message);
      setSlos([]); setMeasurements([]); setAlerts([]);
      setLoading(false);
      return;
    }
    setLoadError(null);
    setSlos((slosRes.data ?? []) as SLO[]);
    setMeasurements((measRes.data ?? []) as Measurement[]);
    setAlerts((alertsRes.data ?? []) as Alert[]);
    setLoading(false);
  }

  useEffect(() => { void load(); const t = setInterval(load, 60_000); return () => clearInterval(t); }, []);

  const bySlo = useMemo(() => {
    const map = new Map<string, Measurement[]>();
    for (const m of measurements) {
      const arr = map.get(m.slo_id) ?? []; arr.push(m); map.set(m.slo_id, arr);
    }
    return map;
  }, [measurements]);

  const activeAlerts = alerts.filter((a) => a.status.toLowerCase() !== "resolved");
  const criticalActive = activeAlerts.filter((a) => a.severity === "critical").length;

  async function openDrill(slo: SLO) {
    setDrill(slo); setDrillMeasurements([]); setDrillAlerts([]);
    const since24 = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const [{ data: ms }, { data: al }] = await Promise.all([
      supabase.from("payment_slo_measurements").select("*").eq("slo_id", slo.id).gte("measured_at", since24).order("measured_at"),
      supabase.from("payment_alerts").select("*").eq("slo_id", slo.id).order("fired_at", { ascending: false }).limit(50),
    ]);
    setDrillMeasurements((ms ?? []) as Measurement[]);
    setDrillAlerts((al ?? []) as Alert[]);
  }

  async function runEvaluator() {
    setEvaluating(true);
    try {
      const { data, error } = await supabase.functions.invoke("observability-evaluator", { body: {} });
      if (error) toast.error(error.message);
      else toast.success(`Evaluated ${data?.evaluated ?? 0} SLOs`);
      await load();
    } finally { setEvaluating(false); }
  }

  async function submitAlertAction() {
    if (!dialog) return;
    if (!note.trim() || note.trim().length < 5) {
      toast.error("Note is required (min 5 chars) for audit trail");
      return;
    }
    setSubmitting(true);
    const { data: userRes } = await supabase.auth.getUser();
    const uid = userRes.user?.id;
    const now = new Date().toISOString();
    const update: Record<string, unknown> = dialog.kind === "ack"
      ? { acknowledged_at: now, acknowledged_by: uid, acknowledgement_note: note.trim() }
      : { status: "RESOLVED", resolved_at: now, resolved_by: uid, resolution_note: note.trim(),
          ...(dialog.alert.acknowledged_at ? {} : { acknowledged_at: now, acknowledged_by: uid, acknowledgement_note: "auto-ack on resolve" }) };
    // Optimistic lock: don't let two operators ack/resolve the same alert.
    let q = supabase.from("payment_alerts").update(update as never).eq("id", dialog.alert.id);
    q = dialog.kind === "ack" ? q.is("acknowledged_at", null) : q.neq("status", "RESOLVED");
    const { data: changed, error } = await q.select("id");
    if (error) toast.error(error.message);
    else if (!changed || changed.length === 0) {
      toast.error(dialog.kind === "ack" ? "Alert was already acknowledged" : "Alert was already resolved");
      setDialog(null); setNote("");
      await load();
    } else {
      await supabase.from("audit_logs").insert({
        actor_user_id: uid, actor_role: "admin",
        entity_type: "payment_alerts", entity_id: dialog.alert.id,
        action: dialog.kind === "ack" ? "alert_ack" : "alert_resolve",
        after_data: { alert_key: dialog.alert.alert_key, note: note.trim() },
      });
      toast.success(dialog.kind === "ack" ? "Alert acknowledged" : "Alert resolved");
      setDialog(null); setNote("");
      await load();
      if (drill) await openDrill(drill);
    }
    setSubmitting(false);
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Payments Observability</h1>
          <p className="text-sm text-muted-foreground">Live SLOs, burn rates, and alerting for the payment subsystem.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => load()} disabled={loading}>
            <RefreshCcw className="h-4 w-4 mr-2" />Refresh
          </Button>
          <Button onClick={runEvaluator} disabled={evaluating}>
            <PlayCircle className="h-4 w-4 mr-2" />{evaluating ? "Evaluating…" : "Run evaluator"}
          </Button>
        </div>
      </div>

      {loadError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          SLO telemetry failed to load — these metrics are <strong>not authoritative</strong>. {loadError}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="SLOs tracked" value={slos.filter((s) => s.active).length} icon={<Activity className="h-4 w-4" />} />
        <Stat label="Compliant" value={slos.filter((s) => {
          const last = (bySlo.get(s.id) ?? []).slice(-1)[0];
          return compliantFn(last?.actual_value ?? null, s.target_value, s.comparator) === true;
        }).length} tone="ok" icon={<CheckCircle2 className="h-4 w-4" />} />
        <Stat label="Active alerts" value={activeAlerts.length} tone={activeAlerts.length > 0 ? "warn" : "ok"} icon={<AlertTriangle className="h-4 w-4" />} />
        <Stat label="Critical" value={criticalActive} tone={criticalActive > 0 ? "danger" : "ok"} icon={<AlertTriangle className="h-4 w-4" />} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {slos.map((s) => {
          const ms = bySlo.get(s.id) ?? [];
          const last = ms[ms.length - 1];
          const ok = compliantFn(last?.actual_value ?? null, s.target_value, s.comparator);
          const spark = ms.slice(-30).map((m) => ({ t: m.measured_at, v: Number(m.actual_value ?? 0) }));
          return (
            <Card key={s.id} className="cursor-pointer hover:border-primary/50 transition" onClick={() => openDrill(s)}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">{s.name}</CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">{s.description}</p>
                  </div>
                  <Badge variant={ok === false ? "destructive" : ok === true ? "default" : "outline"}>
                    {ok === null ? "no data" : ok ? "healthy" : "breach"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <div className="text-3xl font-semibold">{fmtValue(last?.actual_value ?? null, s.unit)}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      target {s.comparator} {fmtValue(s.target_value, s.unit)} · {s.window_minutes}m window
                    </div>
                    {last?.burn_rate != null && (
                      <div className="text-xs mt-1">Burn rate: <span className="font-mono">{Number(last.burn_rate).toFixed(2)}x</span></div>
                    )}
                  </div>
                  <div className="w-40 h-16">
                    {spark.length > 1 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={spark}>
                          <YAxis hide domain={["auto", "auto"]} />
                          <RTooltip formatter={(v: number) => fmtValue(v, s.unit)} labelFormatter={() => ""} />
                          <Line type="monotone" dataKey="v" stroke={ok === false ? "hsl(var(--destructive))" : "hsl(var(--primary))"} strokeWidth={2} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="text-xs text-muted-foreground">no trend</div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
        {slos.length === 0 && !loading && (
          <Card><CardContent className="p-6 text-sm text-muted-foreground">No SLOs configured.</CardContent></Card>
        )}
      </div>

      <Card>
        <CardHeader><CardTitle>Alerts ({alerts.length})</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Severity</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>PagerDuty</TableHead>
                <TableHead>Fired</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {alerts.map((a) => {
                const isResolved = a.status.toLowerCase() === "resolved";
                return (
                  <TableRow key={a.id}>
                    <TableCell><Badge variant={SEV_BADGE[a.severity] ?? "outline"}>{a.severity}</Badge></TableCell>
                    <TableCell>
                      <div className="font-medium text-sm">{a.title}</div>
                      <div className="text-xs text-muted-foreground">{a.message}</div>
                      {a.acknowledgement_note && (
                        <div className="text-xs mt-1"><span className="text-muted-foreground">Ack:</span> {a.acknowledgement_note}</div>
                      )}
                      {a.resolution_note && (
                        <div className="text-xs mt-1"><span className="text-muted-foreground">Resolution:</span> {a.resolution_note}</div>
                      )}
                    </TableCell>
                    <TableCell><Badge variant={isResolved ? "default" : "outline"}>{a.status}</Badge></TableCell>
                    <TableCell className="text-xs">{a.pagerduty_delivered ? "✓ sent" : "—"}</TableCell>
                    <TableCell className="text-xs">{new Date(a.fired_at).toLocaleString()}</TableCell>
                    <TableCell className="text-right space-x-2">
                      {!a.acknowledged_at && !isResolved && (
                        <Button size="sm" variant="outline" onClick={() => { setDialog({ alert: a, kind: "ack" }); setNote(""); }}>Ack</Button>
                      )}
                      {!isResolved && (
                        <Button size="sm" variant="ghost" onClick={() => { setDialog({ alert: a, kind: "resolve" }); setNote(""); }}>Resolve</Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {alerts.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No alerts.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Drill-down sheet */}
      <Sheet open={!!drill} onOpenChange={(o) => !o && setDrill(null)}>
        <SheetContent side="right" className="w-full sm:max-w-3xl overflow-y-auto">
          {drill && (
            <>
              <SheetHeader>
                <SheetTitle>{drill.name}</SheetTitle>
                <SheetDescription>{drill.description}</SheetDescription>
              </SheetHeader>
              <div className="mt-6 space-y-6">
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <Card><CardContent className="p-3">
                    <div className="text-xs text-muted-foreground">Target</div>
                    <div className="font-semibold">{drill.comparator} {fmtValue(drill.target_value, drill.unit)}</div>
                  </CardContent></Card>
                  <Card><CardContent className="p-3">
                    <div className="text-xs text-muted-foreground">Window</div>
                    <div className="font-semibold">{drill.window_minutes} min</div>
                  </CardContent></Card>
                  <Card><CardContent className="p-3">
                    <div className="text-xs text-muted-foreground">Severity</div>
                    <div className="font-semibold capitalize">{drill.severity}</div>
                  </CardContent></Card>
                </div>

                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">24h trend ({drillMeasurements.length} samples)</CardTitle></CardHeader>
                  <CardContent>
                    <div className="h-56">
                      {drillMeasurements.length > 1 ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={drillMeasurements.map((m) => ({ t: new Date(m.measured_at).getTime(), v: Number(m.actual_value ?? 0), target: Number(m.target_value ?? drill.target_value) }))}>
                            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                            <XAxis dataKey="t" tickFormatter={(t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} fontSize={10} />
                            <YAxis fontSize={10} />
                            <RTooltip labelFormatter={(t) => new Date(Number(t)).toLocaleString()} formatter={(v: number) => fmtValue(v, drill.unit)} />
                            <Line type="monotone" dataKey="v" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} name="actual" />
                            <Line type="monotone" dataKey="target" stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" strokeWidth={1} dot={false} name="target" />
                          </LineChart>
                        </ResponsiveContainer>
                      ) : <div className="text-xs text-muted-foreground p-6 text-center">Not enough data.</div>}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Recent measurements</CardTitle></CardHeader>
                  <CardContent className="max-h-72 overflow-y-auto">
                    <Table>
                      <TableHeader><TableRow>
                        <TableHead>Measured</TableHead><TableHead>Value</TableHead>
                        <TableHead>Compliant</TableHead><TableHead>Burn</TableHead>
                        <TableHead>n / d</TableHead>
                      </TableRow></TableHeader>
                      <TableBody>
                        {drillMeasurements.slice().reverse().slice(0, 50).map((m) => (
                          <TableRow key={m.id}>
                            <TableCell className="text-xs">{new Date(m.measured_at).toLocaleString()}</TableCell>
                            <TableCell className="text-xs font-mono">{fmtValue(m.actual_value, drill.unit)}</TableCell>
                            <TableCell>{m.compliant == null ? "—" : m.compliant ? <Badge variant="default">yes</Badge> : <Badge variant="destructive">no</Badge>}</TableCell>
                            <TableCell className="text-xs">{m.burn_rate != null ? `${Number(m.burn_rate).toFixed(2)}x` : "—"}</TableCell>
                            <TableCell className="text-xs">{m.numerator ?? "?"} / {m.denominator ?? "?"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Violations & alerts</CardTitle></CardHeader>
                  <CardContent className="max-h-72 overflow-y-auto space-y-3">
                    {drillAlerts.length === 0 && <div className="text-xs text-muted-foreground">No alerts for this SLO.</div>}
                    {drillAlerts.map((a) => (
                      <div key={a.id} className="border rounded p-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Badge variant={SEV_BADGE[a.severity] ?? "outline"}>{a.severity}</Badge>
                            <Badge variant={a.status.toLowerCase() === "resolved" ? "default" : "outline"}>{a.status}</Badge>
                          </div>
                          <div className="text-xs text-muted-foreground">{new Date(a.fired_at).toLocaleString()}</div>
                        </div>
                        <div className="text-sm font-medium mt-1">{a.title}</div>
                        <div className="text-xs text-muted-foreground">{a.message}</div>
                        {a.acknowledgement_note && <div className="text-xs mt-1">Ack: {a.acknowledgement_note}</div>}
                        {a.resolution_note && <div className="text-xs mt-1">Resolution: {a.resolution_note}</div>}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Ack/Resolve dialog with required note */}
      <Dialog open={!!dialog} onOpenChange={(o) => { if (!o) { setDialog(null); setNote(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog?.kind === "ack" ? "Acknowledge alert" : "Resolve alert"}</DialogTitle>
            <DialogDescription>
              {dialog?.alert.title} — a note is required and stored in the immutable audit log.
            </DialogDescription>
          </DialogHeader>
          <Textarea rows={4} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did you observe, and what action was taken?" />
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setDialog(null); setNote(""); }}>Cancel</Button>
            <Button disabled={submitting || note.trim().length < 5} onClick={submitAlertAction}>
              {submitting ? "Saving…" : dialog?.kind === "ack" ? "Acknowledge" : "Resolve"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value, tone, icon }: { label: string; value: number; tone?: "ok" | "warn" | "danger"; icon?: React.ReactNode }) {
  const color = tone === "danger" ? "text-destructive" : tone === "warn" ? "text-status-warning" : tone === "ok" ? "text-status-success" : "text-foreground";
  return (
    <Card><CardContent className="p-4">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase text-muted-foreground">{label}</div>
        <div className={color}>{icon}</div>
      </div>
      <div className={`text-2xl font-semibold mt-1 ${color}`}>{value}</div>
    </CardContent></Card>
  );
}
