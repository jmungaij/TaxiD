import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { untypedDb } from "@/integrations/supabase/untyped";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MapPin, CalendarClock, XCircle, TrendingDown } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";

/**
 * Extension pack for the Corporate Dashboard (Priority 1 — reuse only).
 * - CorporateLiveTripsCard   → active corporate trips (requested/assigned/in_transit)
 * - CorporateTripKpis        → scheduled + cancelled counters (30d window)
 * - SpendByDepartmentCard    → bar chart of debits from corporate_cash_ledger
 *
 * All reads reuse existing tables — no schema changes.
 * Corporate ↔ trip_bookings join uses corporate_employees.user_id → rider_user_id
 * (matches the pattern already used in CompletedRides.tsx).
 */

// Everything that is booked but not yet finished — a newly booked trip must show
// here immediately, so "pending" and "scheduled" are included.
const ACTIVE = [
  "pending", "scheduled", "requested", "assigned", "accepted",
  "arrived", "in_transit", "in_progress",
];

async function loadEmployeeIds(corporateId: string): Promise<{ ids: string[]; nameById: Record<string, string> }> {
  const { data } = await supabase
    .from("corporate_employees")
    .select("user_id,full_name,email")
    .eq("corporate_id", corporateId)
    .not("user_id", "is", null);
  const nameById: Record<string, string> = {};
  const ids: string[] = [];
  (data ?? []).forEach((e: any) => {
    if (e.user_id) { ids.push(e.user_id); nameById[e.user_id] = e.full_name || e.email || e.user_id; }
  });
  return { ids, nameById };
}

/* ------------------------------------------------------------------ */
/* Live trips                                                          */
/* ------------------------------------------------------------------ */
interface LiveTrip {
  id: string; booking_number: string; rider_user_id: string;
  pickup_address: string; dropoff_address: string; status: string;
  started_at: string | null; total_fare: number | null;
}

export function CorporateLiveTripsCard({ corporateId }: { corporateId: string | null }) {
  const [rows, setRows] = useState<LiveTrip[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!corporateId) { setLoading(false); return; }
    (async () => {
      setLoading(true);
      const { ids, nameById } = await loadEmployeeIds(corporateId);
      if (cancelled) return;
      setNames(nameById);
      if (ids.length === 0) { setRows([]); setLoading(false); return; }
      const { data } = await supabase
        .from("trip_bookings")
        .select("id,booking_number,rider_user_id,pickup_address,dropoff_address,status,started_at,total_fare")
        .in("rider_user_id", ids)
        .eq("intent", "corporate")
        .in("status", ACTIVE)
        .order("created_at", { ascending: false })
        .limit(25);
      if (!cancelled) { setRows((data ?? []) as LiveTrip[]); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [corporateId]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <MapPin className="h-4 w-4 text-primary" /> Live Corporate Rides
        </CardTitle>
        <Badge variant="outline">{rows.length} in progress</Badge>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-sm text-muted-foreground py-4">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-muted-foreground py-4">No corporate rides currently in progress.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ride</TableHead>
                <TableHead>Employee</TableHead>
                <TableHead>Route</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Fare</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.booking_number}</TableCell>
                  <TableCell className="text-sm">{names[r.rider_user_id] ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[260px] truncate">
                    {r.pickup_address} → {r.dropoff_address}
                  </TableCell>
                  <TableCell><Badge variant="outline" className="capitalize">{r.status.replace(/_/g, " ")}</Badge></TableCell>
                  <TableCell className="text-right">KES {Number(r.total_fare ?? 0).toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Scheduled + Cancelled KPI counters                                  */
/* ------------------------------------------------------------------ */
export function useCorporateTripCounts(corporateId: string | null) {
  const [counts, setCounts] = useState({ scheduled: 0, cancelled30d: 0, active: 0 });

  useEffect(() => {
    if (!corporateId) return;
    (async () => {
      const { ids } = await loadEmployeeIds(corporateId);
      if (ids.length === 0) return;
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      const [scheduledRes, cancelledRes, activeRes] = await Promise.all([
        untypedDb.from("trip_bookings").select("id", { count: "exact", head: true })
          .in("rider_user_id", ids).eq("intent", "corporate")
          .in("status", ["scheduled", "requested"])
          .not("scheduled_for", "is", null)
          .gte("scheduled_for", new Date().toISOString()),
        untypedDb.from("trip_bookings").select("id", { count: "exact", head: true })
          .in("rider_user_id", ids).eq("intent", "corporate")
          .eq("status", "cancelled").gte("cancelled_at", since),
        untypedDb.from("trip_bookings").select("id", { count: "exact", head: true })
          .in("rider_user_id", ids).eq("intent", "corporate").in("status", ACTIVE),
      ]);
      setCounts({
        scheduled: scheduledRes.count ?? 0,
        cancelled30d: cancelledRes.count ?? 0,
        active: activeRes.count ?? 0,
      });
    })();
  }, [corporateId]);

  return counts;
}

/* ------------------------------------------------------------------ */
/* Spend by department                                                 */
/* ------------------------------------------------------------------ */
interface DeptSpend { department: string; spend: number }

export function SpendByDepartmentCard({ corporateId }: { corporateId: string | null }) {
  const [data, setData] = useState<DeptSpend[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!corporateId) { setLoading(false); return; }
    (async () => {
      setLoading(true);
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      const [ledgerRes, deptRes] = await Promise.all([
        untypedDb.from("corporate_cash_ledger")
          .select("amount_cents,metadata,occurred_at")
          .eq("corporate_id", corporateId)
          .gte("occurred_at", since)
          .lt("amount_cents", 0)
          .limit(2000),
        untypedDb.from("corporate_departments")
          .select("id,name")
          .eq("corporate_id", corporateId),
      ]);
      if (cancelled) return;
      const deptName: Record<string, string> = {};
      (deptRes.data ?? []).forEach((d: any) => { deptName[d.id] = d.name; });
      const totals: Record<string, number> = {};
      (ledgerRes.data ?? []).forEach((r: any) => {
        const deptId = r.metadata?.department_id as string | undefined;
        const key = deptId && deptName[deptId] ? deptName[deptId] : "Unassigned";
        totals[key] = (totals[key] ?? 0) + Math.abs(Number(r.amount_cents ?? 0)) / 100;
      });
      const rows = Object.entries(totals)
        .map(([department, spend]) => ({ department, spend: Math.round(spend) }))
        .sort((a, b) => b.spend - a.spend)
        .slice(0, 8);
      setData(rows);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [corporateId]);

  const total = useMemo(() => data.reduce((s, r) => s + r.spend, 0), [data]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingDown className="h-4 w-4 text-primary" /> Spend by Department · 30d
        </CardTitle>
        <Badge variant="outline">KES {total.toLocaleString()}</Badge>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-sm text-muted-foreground py-4">Loading…</div>
        ) : data.length === 0 ? (
          <div className="text-sm text-muted-foreground py-4">No department-tagged spend in the last 30 days.</div>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 24 }}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis dataKey="department" tick={{ fontSize: 11 }} angle={-20} textAnchor="end" interval={0} height={50} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => [`KES ${v.toLocaleString()}`, "Spend"]} />
                <Bar dataKey="spend" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Compact KPI tiles for scheduled + cancelled                         */
/* ------------------------------------------------------------------ */
export function ScheduledKpiTile({ value }: { value: number }) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Scheduled trips</span>
        <CalendarClock className="h-4 w-4 text-primary" />
      </div>
      <p className="text-2xl font-bold mt-2">{value.toLocaleString()}</p>
      <p className="text-xs text-muted-foreground mt-1">Upcoming corporate bookings</p>
    </div>
  );
}

export function CancelledKpiTile({ value }: { value: number }) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Cancelled · 30d</span>
        <XCircle className="h-4 w-4 text-status-danger" />
      </div>
      <p className="text-2xl font-bold mt-2">{value.toLocaleString()}</p>
      <p className="text-xs text-muted-foreground mt-1">Corporate rides cancelled</p>
    </div>
  );
}
