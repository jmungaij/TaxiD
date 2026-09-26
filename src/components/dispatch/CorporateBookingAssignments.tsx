import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Building2, RefreshCw, UserCheck, PlayCircle, CheckCircle2 } from "lucide-react";

interface CorporateBooking {
  id: string;
  booking_number: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  status: string;
  total_fare: number | null;
  driver_id: string | null;
  scheduled_for: string | null;
  created_at: string;
}

interface DriverOption {
  id: string;
  label: string;
}

const ACTIVE_STATUSES = ["pending", "scheduled", "assigned", "in_progress"];

export function CorporateBookingAssignments() {
  const [rows, setRows] = useState<CorporateBooking[]>([]);
  const [drivers, setDrivers] = useState<DriverOption[]>([]);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [bookings, driverRows] = await Promise.all([
      supabase
        .from("trip_bookings")
        .select(
          "id,booking_number,pickup_address,dropoff_address,status,total_fare,driver_id,scheduled_for,created_at",
        )
        .eq("intent", "corporate")
        .in("status", ACTIVE_STATUSES)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("drivers")
        .select("id,first_name,last_name,driver_code,status")
        .eq("status", "active")
        .order("first_name")
        .limit(100),
    ]);

    if (bookings.error) toast.error("Could not load corporate rides");
    setRows((bookings.data ?? []) as CorporateBooking[]);
    setDrivers(
      (driverRows.data ?? []).map((d) => ({
        id: d.id as string,
        label: `${[d.first_name, d.last_name].filter(Boolean).join(" ") || "Driver"} · ${d.driver_code ?? ""}`.trim(),
      })),
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const assign = async (bookingId: string) => {
    const driverId = choice[bookingId];
    if (!driverId) {
      toast.error("Choose a driver first");
      return;
    }
    setBusy(bookingId);
    const { error } = await supabase.rpc("assign_corporate_booking", {
      _booking_id: bookingId,
      _driver_id: driverId,
    });
    setBusy(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Driver assigned");
    void load();
  };

  const progress = async (bookingId: string, status: "in_progress" | "completed") => {
    setBusy(bookingId);
    const { error } = await supabase.rpc("set_corporate_booking_progress", {
      _booking_id: bookingId,
      _status: status,
    });
    setBusy(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(
      status === "completed"
        ? "Trip completed — invoice line and wallet charge recorded"
        : "Trip started",
    );
    void load();
  };

  return (
    <Card className="p-4" data-analytics-id="dispatch-corporate-assignments">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="font-semibold flex items-center gap-2">
            <Building2 className="h-4 w-4 text-ai" /> Corporate rides awaiting dispatch
          </h2>
          <p className="text-xs text-muted-foreground">
            Approved corporate requests. Completing a trip records revenue, the invoice line and the
            wallet charge.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {rows.length === 0 ? (
        <div className="text-sm text-muted-foreground italic py-6 text-center">
          No corporate rides are waiting right now.
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.id} className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-mono text-xs text-muted-foreground">
                    {r.booking_number ?? r.id.slice(0, 8)}
                  </div>
                  <div className="text-sm truncate">
                    {r.pickup_address ?? "—"} → {r.dropoff_address ?? "—"}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <Badge variant="outline">{r.status}</Badge>
                  <div className="text-xs text-muted-foreground mt-1">
                    KSh {Number(r.total_fare ?? 0).toLocaleString()}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {!r.driver_id && (
                  <>
                    <select
                      className="h-9 rounded-md border bg-background px-2 text-sm"
                      value={choice[r.id] ?? ""}
                      onChange={(e) => setChoice((c) => ({ ...c, [r.id]: e.target.value }))}
                    >
                      <option value="">Select driver…</option>
                      {drivers.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                    <Button size="sm" disabled={busy === r.id} onClick={() => void assign(r.id)}>
                      <UserCheck className="h-4 w-4 mr-1" /> Assign
                    </Button>
                  </>
                )}
                {r.driver_id && r.status === "assigned" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === r.id}
                    onClick={() => void progress(r.id, "in_progress")}
                  >
                    <PlayCircle className="h-4 w-4 mr-1" /> Start trip
                  </Button>
                )}
                {r.driver_id && ["assigned", "in_progress"].includes(r.status) && (
                  <Button
                    size="sm"
                    disabled={busy === r.id}
                    onClick={() => void progress(r.id, "completed")}
                  >
                    <CheckCircle2 className="h-4 w-4 mr-1" /> Complete trip
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export default CorporateBookingAssignments;
