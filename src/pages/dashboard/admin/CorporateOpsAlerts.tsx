/**
 * Corporate operations alerting — configurable rules over live corporate
 * signals (approval overdue, wallet risk, booking failures, ticket backlog)
 * plus a realtime feed of fired events an admin can acknowledge.
 *
 * Rules are evaluated server-side by `corporate-admin-console`
 * (`alert_evaluate`); this screen triggers evaluation on an interval and
 * subscribes to `corporate_ops_alert_events` for instant delivery.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { BellRing, CheckCheck, Loader2, Plus, RefreshCw, ShieldAlert, Trash2, Zap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { invokeCorporateConsole } from "@/lib/corporate/manageAs";

interface AlertRule {
  id: string;
  name: string;
  signal: string;
  operator: string;
  threshold: number;
  severity: string;
  enabled: boolean;
  channels?: string[] | null;
  target_roles?: string[] | null;
  cooldown_seconds?: number | null;
}

interface AlertEvent {
  id: string;
  rule_name?: string | null;
  signal: string;
  severity: string;
  corporate_id?: string | null;
  observed_value?: number | null;
  threshold?: number | null;
  message: string;
  acknowledged_at?: string | null;
  created_at?: string | null;
}

const SIGNALS = [
  { key: "approval_overdue", label: "Approval overdue (count)" },
  { key: "wallet_risk", label: "Wallet balance risk (cents)" },
  { key: "booking_failure", label: "Booking failures / 24h" },
  { key: "ticket_backlog", label: "Open support tickets" },
] as const;

const OPERATORS = [
  { key: "gte", label: "≥" }, { key: "gt", label: ">" },
  { key: "lte", label: "≤" }, { key: "lt", label: "<" },
] as const;

const SEVERITIES = ["info", "warning", "critical"] as const;
const CHANNELS = ["toast", "email", "slack"] as const;

const when = (v?: string | null) =>
  v ? new Date(v).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" }) : "—";

const severityVariant = (s: string) =>
  s === "critical" ? "destructive" : s === "warning" ? "secondary" : "outline";

const EMPTY_RULE = {
  id: "" as string,
  name: "",
  signal: "approval_overdue" as string,
  operator: "gte" as string,
  threshold: 1,
  severity: "warning" as string,
  enabled: true,
  channels: ["toast"] as string[],
  cooldown_seconds: 900,
};

export default function CorporateOpsAlerts() {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<typeof EMPTY_RULE | null>(null);
  const seen = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await invokeCorporateConsole<{ rules: AlertRule[]; events: AlertEvent[] }>({
        op: "alert_state", limit: 100,
      });
      setRules(res.rules ?? []);
      setEvents(res.events ?? []);
      for (const e of res.events ?? []) seen.current.add(e.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const evaluate = useCallback(async (announce = false) => {
    try {
      const res = await invokeCorporateConsole<{ fired: AlertEvent[] }>({ op: "alert_evaluate" });
      if (announce) {
        toast({
          title: "Evaluation complete",
          description: `${res.fired?.length ?? 0} alert(s) fired.`,
        });
      }
      if (res.fired?.length) void load();
    } catch (e) {
      if (announce) toast({ title: "Evaluation failed", description: (e as Error).message, variant: "destructive" });
    }
  }, [load]);

  useEffect(() => { void load(); }, [load]);

  // Periodic server-side evaluation while the control tower is open.
  useEffect(() => {
    const timer = window.setInterval(() => { void evaluate(false); }, 120_000);
    return () => window.clearInterval(timer);
  }, [evaluate]);

  // Realtime delivery of newly fired alerts.
  useEffect(() => {
    const channel = supabase
      .channel("corporate-ops-alerts")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "corporate_ops_alert_events" },
        (payload) => {
          const row = payload.new as AlertEvent;
          if (seen.current.has(row.id)) return;
          seen.current.add(row.id);
          setEvents((prev) => [row, ...prev].slice(0, 200));
          const notify = row.severity === "critical" ? "destructive" : undefined;
          toast({ title: row.rule_name ?? "Corporate alert", description: row.message, variant: notify });
        },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, []);

  const unacked = useMemo(() => events.filter((e) => !e.acknowledged_at), [events]);

  async function saveRule() {
    if (!editing || !editing.name.trim()) {
      toast({ title: "Rule name is required", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      await invokeCorporateConsole({
        op: "alert_rule_save",
        ...(editing.id ? { id: editing.id } : {}),
        name: editing.name.trim(),
        signal: editing.signal,
        operator: editing.operator,
        threshold: Number(editing.threshold),
        severity: editing.severity,
        enabled: editing.enabled,
        channels: editing.channels,
        cooldown_seconds: Number(editing.cooldown_seconds),
      });
      setEditing(null);
      void load();
      toast({ title: "Alert rule saved" });
    } catch (e) {
      toast({ title: "Save failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function deleteRule(id: string) {
    setBusy(true);
    try {
      await invokeCorporateConsole({ op: "alert_rule_delete", id });
      void load();
      toast({ title: "Alert rule removed" });
    } catch (e) {
      toast({ title: "Delete failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function acknowledge(id: string) {
    try {
      await invokeCorporateConsole({ op: "alert_ack", event_id: id });
      setEvents((prev) => prev.map((e) => (e.id === id ? { ...e, acknowledged_at: new Date().toISOString() } : e)));
    } catch (e) {
      toast({ title: "Acknowledge failed", description: (e as Error).message, variant: "destructive" });
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Corporate alerting</h1>
          <p className="text-sm text-muted-foreground">
            Rules over approvals, wallet float, booking failures and ticket backlog — delivered in realtime.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setEditing({ ...EMPTY_RULE })}>
            <Plus className="mr-2 h-4 w-4" /> New rule
          </Button>
          <Button variant="outline" size="sm" onClick={() => void evaluate(true)}>
            <Zap className="mr-2 h-4 w-4" /> Evaluate now
          </Button>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <p className="flex items-center gap-2 text-sm text-destructive">
          <ShieldAlert className="h-4 w-4" /> {error}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BellRing className="h-4 w-4" /> Live alerts
            {unacked.length > 0 && <Badge variant="destructive">{unacked.length} unacknowledged</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Alert</TableHead>
                <TableHead>Corporate</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!loading && events.length === 0 && (
                <TableRow><TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                  No alerts fired yet.
                </TableCell></TableRow>
              )}
              {events.map((e) => (
                <TableRow key={e.id} className={e.acknowledged_at ? "opacity-60" : undefined}>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{when(e.created_at)}</TableCell>
                  <TableCell className="text-sm">{e.message}</TableCell>
                  <TableCell className="text-sm">
                    {e.corporate_id ? (
                      <Link className="underline-offset-2 hover:underline" to={`/dashboard/admin/corporates/${e.corporate_id}`}>
                        View account
                      </Link>
                    ) : "Platform"}
                  </TableCell>
                  <TableCell><Badge variant={severityVariant(e.severity)}>{e.severity}</Badge></TableCell>
                  <TableCell className="text-right">
                    {e.acknowledged_at ? (
                      <span className="text-xs text-muted-foreground">Acknowledged</span>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => void acknowledge(e.id)}>
                        <CheckCheck className="mr-1 h-3.5 w-3.5" /> Ack
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Alert rules</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Rule</TableHead>
                <TableHead>Condition</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Channels</TableHead>
                <TableHead>Enabled</TableHead>
                <TableHead className="text-right">Manage</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!loading && rules.length === 0 && (
                <TableRow><TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                  No rules configured — create one to start monitoring.
                </TableCell></TableRow>
              )}
              {rules.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {SIGNALS.find((s) => s.key === r.signal)?.label ?? r.signal}{" "}
                    {OPERATORS.find((o) => o.key === r.operator)?.label ?? r.operator} {r.threshold}
                  </TableCell>
                  <TableCell><Badge variant={severityVariant(r.severity)}>{r.severity}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{(r.channels ?? ["toast"]).join(", ")}</TableCell>
                  <TableCell>{r.enabled ? "Yes" : "No"}</TableCell>
                  <TableCell className="space-x-2 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setEditing({
                        id: r.id, name: r.name, signal: r.signal, operator: r.operator,
                        threshold: Number(r.threshold), severity: r.severity, enabled: r.enabled,
                        channels: r.channels ?? ["toast"], cooldown_seconds: Number(r.cooldown_seconds ?? 900),
                      })}
                    >
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => void deleteRule(r.id)}>
                      <Trash2 className="h-4 w-4" />
                      <span className="sr-only">Delete {r.name}</span>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit alert rule" : "New alert rule"}</DialogTitle>
            <DialogDescription>Evaluated per corporate account with a cooldown to prevent alert storms.</DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="ar-name">Rule name</Label>
                <Input id="ar-name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ar-signal">Signal</Label>
                <Select value={editing.signal} onValueChange={(v) => setEditing({ ...editing, signal: v })}>
                  <SelectTrigger id="ar-signal"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SIGNALS.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="ar-op">Operator</Label>
                  <Select value={editing.operator} onValueChange={(v) => setEditing({ ...editing, operator: v })}>
                    <SelectTrigger id="ar-op"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {OPERATORS.map((o) => <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ar-threshold">Threshold</Label>
                  <Input
                    id="ar-threshold"
                    type="number"
                    value={editing.threshold}
                    onChange={(e) => setEditing({ ...editing, threshold: Number(e.target.value) })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ar-sev">Severity</Label>
                  <Select value={editing.severity} onValueChange={(v) => setEditing({ ...editing, severity: v })}>
                    <SelectTrigger id="ar-sev"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SEVERITIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Channels</Label>
                <div className="flex gap-2">
                  {CHANNELS.map((c) => (
                    <Button
                      key={c}
                      type="button"
                      size="sm"
                      variant={editing.channels.includes(c) ? "default" : "outline"}
                      onClick={() => setEditing({
                        ...editing,
                        channels: editing.channels.includes(c)
                          ? editing.channels.filter((x) => x !== c)
                          : [...editing.channels, c],
                      })}
                    >
                      {c}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ar-cooldown">Cooldown (seconds)</Label>
                <Input
                  id="ar-cooldown"
                  type="number"
                  value={editing.cooldown_seconds}
                  onChange={(e) => setEditing({ ...editing, cooldown_seconds: Number(e.target.value) })}
                />
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  id="ar-enabled"
                  checked={editing.enabled}
                  onCheckedChange={(v) => setEditing({ ...editing, enabled: v })}
                />
                <Label htmlFor="ar-enabled">Rule enabled</Label>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button disabled={busy} onClick={() => void saveRule()}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save rule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
