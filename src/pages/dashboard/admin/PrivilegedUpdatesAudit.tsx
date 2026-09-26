import type { LooseRow } from "@/lib/types/loose";
/**
 * Admin dashboard for privileged_update_audit + forbidden_update_attempts
 * with filters by actor, target table, and time range. Also renders the
 * live triage feed for alerts_events created by flag_repeated_forbidden_updates
 * and notify_forbidden_update_email.
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { ShieldAlert, Activity, Bell } from "lucide-react";

type Row = Record<string, unknown> & { id: string; occurred_at?: string; created_at?: string };

const TABLES = ["", "corporate_ride_approvals", "mpesa_transactions", "trip_bookings"];

function useAuditFeed(view: "success" | "forbidden" | "alerts", filters: { actor: string; table: string; from: string; to: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const source =
        view === "success" ? "privileged_update_audit"
        : view === "forbidden" ? "forbidden_update_attempts"
        : "alerts_events";
      let q = (supabase as LooseRow).from(source).select("*").order(
        view === "alerts" ? "created_at" : "occurred_at",
        { ascending: false }
      ).limit(200);
      if (view !== "alerts") {
        if (filters.actor) q = q.eq("actor_user_id", filters.actor);
        if (filters.table) q = q.eq("target_table", filters.table);
        const ts = view === "success" ? "occurred_at" : "occurred_at";
        if (filters.from) q = q.gte(ts, filters.from);
        if (filters.to) q = q.lte(ts, filters.to);
      } else {
        if (filters.from) q = q.gte("created_at", filters.from);
        if (filters.to) q = q.lte("created_at", filters.to);
      }
      const { data, error } = await q;
      if (cancelled) return;
      if (error) toast.error(error.message);
      setRows((data ?? []) as Row[]);
      setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, [view, filters.actor, filters.table, filters.from, filters.to]);

  return { rows, loading };
}

export default function PrivilegedUpdatesAudit() {
  const [tab, setTab] = useState<"success" | "forbidden" | "alerts">("forbidden");
  const [actor, setActor] = useState("");
  const [table, setTable] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const filters = useMemo(() => ({ actor, table, from, to }), [actor, table, from, to]);
  const { rows, loading } = useAuditFeed(tab, filters);

  async function ackAlert(id: string) {
    const { error } = await (supabase as LooseRow)
      .from("alerts_events")
      .update({ acknowledged_at: new Date().toISOString() })
      .eq("id", id);
    if (error) toast.error(error.message);
    else toast.success("Acknowledged");
  }

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-center gap-3">
        <ShieldAlert className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">Privileged Updates & Security Alerts</h1>
      </header>

      <Card>
        <CardHeader><CardTitle className="text-base">Filters</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-4">
          <div>
            <Label htmlFor="actor">Actor user ID</Label>
            <Input id="actor" value={actor} onChange={(e) => setActor(e.target.value)} placeholder="UUID" />
          </div>
          <div>
            <Label>Target table</Label>
            <Select value={table} onValueChange={setTable}>
              <SelectTrigger><SelectValue placeholder="All tables" /></SelectTrigger>
              <SelectContent>
                {TABLES.map((t) => (
                  <SelectItem key={t || "all"} value={t || "__all"}>{t || "All tables"}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="from">From</Label>
            <Input id="from" type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="to">To</Label>
            <Input id="to" type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="forbidden"><ShieldAlert className="h-4 w-4 mr-1" />Forbidden attempts</TabsTrigger>
          <TabsTrigger value="success"><Activity className="h-4 w-4 mr-1" />Successful privileged updates</TabsTrigger>
          <TabsTrigger value="alerts"><Bell className="h-4 w-4 mr-1" />Alert triage</TabsTrigger>
        </TabsList>

        <TabsContent value="forbidden">
          <Card><CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left">
                <tr><th className="p-3">When</th><th className="p-3">Actor</th><th className="p-3">Table</th><th className="p-3">Reason</th><th className="p-3">Columns</th><th className="p-3">IP</th></tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Loading…</td></tr>}
                {!loading && rows.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No records.</td></tr>}
                {rows.map((r: LooseRow) => (
                  <tr key={r.id} className="border-t">
                    <td className="p-3 whitespace-nowrap">{new Date(r.occurred_at).toLocaleString()}</td>
                    <td className="p-3 font-mono text-xs">{r.actor_user_id ?? "—"}</td>
                    <td className="p-3">{r.target_table}</td>
                    <td className="p-3"><Badge variant="destructive">{r.reason}</Badge></td>
                    <td className="p-3 font-mono text-xs">{(r.attempted_columns ?? []).join(", ")}</td>
                    <td className="p-3 font-mono text-xs">{r.ip_address ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="success">
          <Card><CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left">
                <tr><th className="p-3">When</th><th className="p-3">Actor / role</th><th className="p-3">Table</th><th className="p-3">Row</th><th className="p-3">Columns</th></tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">Loading…</td></tr>}
                {!loading && rows.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No records.</td></tr>}
                {rows.map((r: LooseRow) => (
                  <tr key={r.id} className="border-t">
                    <td className="p-3 whitespace-nowrap">{new Date(r.occurred_at).toLocaleString()}</td>
                    <td className="p-3">
                      <div className="font-mono text-xs">{r.actor_user_id ?? "—"}</div>
                      <Badge variant="outline">{r.actor_role ?? "unknown"}</Badge>
                    </td>
                    <td className="p-3">{r.target_table}</td>
                    <td className="p-3 font-mono text-xs">{r.target_row_id}</td>
                    <td className="p-3 font-mono text-xs">{(r.changed_columns ?? []).join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="alerts">
          <Card><CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left">
                <tr><th className="p-3">When</th><th className="p-3">Rule</th><th className="p-3">Severity</th><th className="p-3">Message</th><th className="p-3">Channels</th><th className="p-3"></th></tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Loading…</td></tr>}
                {!loading && rows.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No alerts.</td></tr>}
                {rows.map((r: LooseRow) => (
                  <AlertRow key={r.id} row={r} onAck={() => ackAlert(r.id)} />
                ))}
              </tbody>
            </table>
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AlertRow({ row, onAck }: { row: LooseRow; onAck: () => void }) {
  const [open, setOpen] = useState(false);
  const [triggers, setTriggers] = useState<LooseRow[] | null>(null);
  const [metrics, setMetrics] = useState<LooseRow[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadContext() {
    if (triggers && metrics) { setOpen((v) => !v); return; }
    setLoading(true); setOpen(true);
    const ctx = row.context ?? {};
    const winStart = ctx.window_start ?? new Date(Date.now() - 15 * 60_000).toISOString();
    const winEnd = ctx.window_end ?? row.created_at ?? new Date().toISOString();
    try {
      // Rows that triggered the spike
      let q = (supabase as LooseRow)
        .from("forbidden_update_attempts")
        .select("id, occurred_at, actor_user_id, actor_role, target_table, reason, attempted_columns, ip_address")
        .gte("occurred_at", winStart).lte("occurred_at", winEnd)
        .order("occurred_at", { ascending: false }).limit(50);
      if (ctx.role) q = q.eq("actor_role", ctx.role);
      const { data: trigRows } = await q;
      setTriggers((trigRows ?? []) as LooseRow[]);

      // Matching v_privileged_update_metrics window
      const { data: mRows } = await (supabase as LooseRow)
        .from("v_privileged_update_metrics")
        .select("*")
        .order("bucket", { ascending: false })
        .limit(24);
      setMetrics((mRows ?? []) as LooseRow[]);
    } catch (e) {
      console.warn("triage context failed", e);
      setTriggers([]); setMetrics([]);
    }
    setLoading(false);
  }

  return (
    <>
      <tr className="border-t">
        <td className="p-3 whitespace-nowrap">{new Date(row.created_at).toLocaleString()}</td>
        <td className="p-3">{row.rule_name}</td>
        <td className="p-3">
          <Badge variant={row.severity === "critical" ? "destructive" : "secondary"}>{row.severity}</Badge>
        </td>
        <td className="p-3">{row.message}</td>
        <td className="p-3 text-xs">{(row.channels_dispatched ?? []).join(", ")}</td>
        <td className="p-3 space-x-2 whitespace-nowrap">
          <Button size="sm" variant="ghost" onClick={loadContext}>
            {open ? "Hide" : "Open triage"}
          </Button>
          {!row.acknowledged_at && (
            <Button size="sm" variant="outline" onClick={onAck}>Acknowledge</Button>
          )}
        </td>
      </tr>
      {open && (
        <tr className="bg-muted/20">
          <td colSpan={6} className="p-4">
            {loading && <div className="text-sm text-muted-foreground">Loading triage context…</div>}
            {!loading && (
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <div className="text-xs font-semibold mb-2">Triggering forbidden attempts ({triggers?.length ?? 0})</div>
                  <div className="max-h-64 overflow-y-auto rounded border bg-background">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/40"><tr><th className="p-2 text-left">When</th><th className="p-2 text-left">Role</th><th className="p-2 text-left">Table</th><th className="p-2 text-left">Reason</th></tr></thead>
                      <tbody>
                        {(triggers ?? []).map((t) => (
                          <tr key={t.id} className="border-t">
                            <td className="p-2 whitespace-nowrap">{new Date(t.occurred_at).toLocaleTimeString()}</td>
                            <td className="p-2">{t.actor_role ?? "—"}</td>
                            <td className="p-2">{t.target_table}</td>
                            <td className="p-2">{t.reason}</td>
                          </tr>
                        ))}
                        {(triggers ?? []).length === 0 && (
                          <tr><td colSpan={4} className="p-3 text-center text-muted-foreground">No rows in window.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold mb-2">Matching v_privileged_update_metrics ({metrics?.length ?? 0})</div>
                  <div className="max-h-64 overflow-y-auto rounded border bg-background">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/40"><tr><th className="p-2 text-left">Bucket</th><th className="p-2 text-left">Role</th><th className="p-2 text-left">Success</th><th className="p-2 text-left">Forbidden</th></tr></thead>
                      <tbody>
                        {(metrics ?? []).map((m: LooseRow, i) => (
                          <tr key={i} className="border-t">
                            <td className="p-2 whitespace-nowrap">{m.bucket ? new Date(m.bucket).toLocaleString() : "—"}</td>
                            <td className="p-2">{m.actor_role ?? m.role ?? "—"}</td>
                            <td className="p-2">{m.success_count ?? m.successes ?? 0}</td>
                            <td className="p-2">{m.forbidden_count ?? m.forbiddens ?? 0}</td>
                          </tr>
                        ))}
                        {(metrics ?? []).length === 0 && (
                          <tr><td colSpan={4} className="p-3 text-center text-muted-foreground">No metric rows.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
