import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2 } from "lucide-react";
import { AsyncState } from "@/components/dashboard/AsyncState";

interface Booking {
  id: string;
  booking_number: string;
  rider_user_id: string;
  pickup_address: string;
  dropoff_address: string;
  total_fare: number | null;
  payment_method: string | null;
  intent: string | null;
  completed_at: string | null;
  status: string;
}

export default function CorporateCompletedRides({ corporateId }: { corporateId: string | null }) {
  const [rows, setRows] = useState<Booking[]>([]);
  const [nameById, setNameById] = useState<Record<string, string>>({});
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!corporateId) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const empRes = await supabase
        .from("corporate_employees")
        .select("user_id,full_name,email")
        .eq("corporate_id", corporateId)
        .not("user_id", "is", null);
      if (empRes.error) throw empRes.error;
      const emps = empRes.data ?? [];
      const ids = emps.map(e => e.user_id!).filter(Boolean);
      const nm: Record<string, string> = {};
      emps.forEach(e => { if (e.user_id) nm[e.user_id] = e.full_name || e.email; });
      setNameById(nm);
      if (ids.length === 0) { setRows([]); return; }
      const { data, error: err } = await supabase
        .from("trip_bookings")
        .select("id,booking_number,rider_user_id,pickup_address,dropoff_address,total_fare,payment_method,intent,completed_at,status")
        .in("rider_user_id", ids)
        .eq("intent", "corporate")
        .eq("status", "completed")
        .order("completed_at", { ascending: false })
        .limit(200);
      if (err) throw err;
      setRows((data ?? []) as Booking[]);
    } catch (e) {
      setError((e as Error).message ?? "Failed to load completed rides.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [corporateId]);

  const filtered = useMemo(() => {
    if (!q) return rows;
    const s = q.toLowerCase();
    return rows.filter(r =>
      r.booking_number.toLowerCase().includes(s) ||
      (nameById[r.rider_user_id] ?? "").toLowerCase().includes(s) ||
      r.pickup_address.toLowerCase().includes(s) ||
      r.dropoff_address.toLowerCase().includes(s)
    );
  }, [rows, q, nameById]);

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2"><CheckCircle2 className="h-5 w-5" />Completed Rides</h2>
          <p className="text-sm text-muted-foreground">Searchable ledger of completed corporate trips. Export from Reconciliation for billing.</p>
        </div>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by ride ID, rider, address…" className="w-72" />
      </div>
      <AsyncState
        loading={loading}
        error={error}
        isEmpty={!loading && !error && filtered.length === 0}
        emptyTitle="No completed corporate rides"
        emptyMessage={q ? "No rides match your search." : "Completed corporate trips will appear here."}
        onRetry={load}
      >
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Ride</TableHead>
              <TableHead>Employee</TableHead>
              <TableHead>Route</TableHead>
              <TableHead>Fare</TableHead>
              <TableHead>Payment</TableHead>
              <TableHead>Completed</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {filtered.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.booking_number}</TableCell>
                  <TableCell>{nameById[r.rider_user_id] ?? r.rider_user_id.slice(0, 8)}</TableCell>
                  <TableCell className="max-w-[260px]">
                    <div className="truncate text-sm">{r.pickup_address}</div>
                    <div className="truncate text-xs text-muted-foreground">→ {r.dropoff_address}</div>
                  </TableCell>
                  <TableCell>{r.total_fare != null ? `KES ${Number(r.total_fare).toLocaleString()}` : "—"}</TableCell>
                  <TableCell><Badge variant="secondary">{r.payment_method ?? "—"}</Badge></TableCell>
                  <TableCell className="text-xs">{r.completed_at ? new Date(r.completed_at).toLocaleString() : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </AsyncState>

    </div>
  );
}
