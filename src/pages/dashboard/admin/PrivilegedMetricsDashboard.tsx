/**
 * Privileged Metrics dashboard.
 * - Forbidden-attempt trend chart (last 24h, hourly buckets, per role).
 * - Top offenders (actor_user_id + role) with counts.
 * - Alert frequency SLA-style chart from alerts_events (privileged-metrics-monitor).
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShieldAlert, Users, Activity } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend, CartesianGrid,
} from "recharts";

type Attempt = {
  id: string;
  occurred_at: string;
  actor_user_id: string | null;
  actor_role: string | null;
  target_table: string | null;
  reason: string | null;
};
type AlertEvent = {
  id: string; created_at: string; severity: string; message: string; context: any;
};

const HOURS = 24;

function hourBucket(iso: string) {
  const d = new Date(iso); d.setMinutes(0, 0, 0); return d.toISOString();
}

export default function PrivilegedMetricsDashboard() {
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [alerts, setAlerts] = useState<AlertEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const since = new Date(Date.now() - HOURS * 3600_000).toISOString();
      const [{ data: a }, { data: e }] = await Promise.all([
        (supabase as any).from("forbidden_update_attempts")
          .select("id, occurred_at, actor_user_id, actor_role, target_table, reason")
          .gte("occurred_at", since).order("occurred_at", { ascending: true }).limit(5000),
        (supabase as any).from("alerts_events")
          .select("id, created_at, severity, message, context")
          .eq("rule_id", "privileged-metrics-monitor")
          .gte("created_at", since).order("created_at", { ascending: true }).limit(500),
      ]);
      if (cancelled) return;
      setAttempts((a ?? []) as Attempt[]);
      setAlerts((e ?? []) as AlertEvent[]);
      setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  const trend = useMemo(() => {
    const roles = new Set<string>();
    const perBucket = new Map<string, Record<string, number>>();
    for (const r of attempts) {
      const b = hourBucket(r.occurred_at);
      const role = r.actor_role ?? "unknown";
      roles.add(role);
      const rec = perBucket.get(b) ?? {};
      rec[role] = (rec[role] ?? 0) + 1;
      perBucket.set(b, rec);
    }
    // Fill empty hours for continuity
    const now = Date.now();
    const rows: unknown[] = [];
    for (let i = HOURS - 1; i >= 0; i--) {
      const b = hourBucket(new Date(now - i * 3600_000).toISOString());
      const rec = perBucket.get(b) ?? {};
      rows.push({ hour: new Date(b).toLocaleTimeString([], { hour: "2-digit" }), ...rec });
    }
    return { rows, roles: Array.from(roles) };
  }, [attempts]);

  const topOffenders = useMemo(() => {
    const map = new Map<string, { user: string; role: string; count: number }>();
    for (const r of attempts) {
      const key = `${r.actor_user_id ?? "anon"}|${r.actor_role ?? "unknown"}`;
      const entry = map.get(key) ?? { user: r.actor_user_id ?? "anon", role: r.actor_role ?? "unknown", count: 0 };
      entry.count += 1;
      map.set(key, entry);
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count).slice(0, 10);
  }, [attempts]);

  const alertFreq = useMemo(() => {
    const buckets = new Map<string, number>();
    for (const a of alerts) {
      const b = hourBucket(a.created_at);
      buckets.set(b, (buckets.get(b) ?? 0) + 1);
    }
    const now = Date.now();
    const rows: unknown[] = [];
    for (let i = HOURS - 1; i >= 0; i--) {
      const b = hourBucket(new Date(now - i * 3600_000).toISOString());
      rows.push({ hour: new Date(b).toLocaleTimeString([], { hour: "2-digit" }), alerts: buckets.get(b) ?? 0 });
    }
    return rows;
  }, [alerts]);

  const roleColors = ["hsl(var(--chart-1))", "hsl(var(--status-danger))", "hsl(var(--status-success))", "hsl(var(--chart-4))", "hsl(var(--chart-6))", "hsl(var(--chart-2))"];

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-center gap-3">
        <ShieldAlert className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">Privileged Metrics Dashboard</h1>
        <Badge variant="outline">Last {HOURS}h</Badge>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Forbidden attempts</CardTitle></CardHeader>
          <CardContent><div className="text-3xl font-bold">{attempts.length}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Distinct roles</CardTitle></CardHeader>
          <CardContent><div className="text-3xl font-bold">{trend.roles.length}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Critical alerts fired</CardTitle></CardHeader>
          <CardContent><div className="text-3xl font-bold">{alerts.length}</div></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" /> Forbidden-attempt trend by role
          </CardTitle>
        </CardHeader>
        <CardContent style={{ height: 320 }}>
          {loading ? <div className="text-sm text-muted-foreground">Loading…</div> : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend.rows}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="hour" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Legend />
                {trend.roles.map((role, i) => (
                  <Line key={role} type="monotone" dataKey={role}
                    stroke={roleColors[i % roleColors.length]} strokeWidth={2} dot={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" /> Top offenders
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left">
                <tr><th className="p-2">Actor</th><th className="p-2">Role</th><th className="p-2">Attempts</th></tr>
              </thead>
              <tbody>
                {topOffenders.length === 0 && <tr><td colSpan={3} className="p-3 text-center text-muted-foreground">No offenders.</td></tr>}
                {topOffenders.map((o) => (
                  <tr key={o.user + o.role} className="border-t">
                    <td className="p-2 font-mono text-xs">{o.user.slice(0, 8)}…</td>
                    <td className="p-2"><Badge variant="outline">{o.role}</Badge></td>
                    <td className="p-2 font-semibold">{o.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-primary" /> Alert frequency (SLA)
            </CardTitle>
          </CardHeader>
          <CardContent style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={alertFreq}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="hour" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="alerts" fill="hsl(var(--status-danger))" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
