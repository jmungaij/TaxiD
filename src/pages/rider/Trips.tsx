import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { RiderShell } from "@/components/rider/RiderShell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MapPin, ArrowRight } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface Booking {
  id: string;
  booking_number: string;
  pickup_address: string;
  dropoff_address: string;
  status: string;
  total_fare: number | null;
  created_at: string;
  scheduled_for: string | null;
}

const statusColor: Record<string, string> = {
  pending: "bg-status-warning/15 text-status-warning dark:text-status-warning",
  scheduled: "bg-ai/15 text-ai dark:text-ai",
  dispatched: "bg-ai/15 text-ai dark:text-ai",
  in_progress: "bg-status-success/15 text-status-success dark:text-status-success",
  completed: "bg-muted text-muted-foreground",
  cancelled: "bg-destructive/15 text-destructive",
};

export default function RiderTripsPage() {
  const { user } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("trip_bookings")
      .select("id,booking_number,pickup_address,dropoff_address,status,total_fare,created_at,scheduled_for")
      .eq("rider_user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data }) => {
        setBookings((data as Booking[]) ?? []);
        setLoading(false);
      });

    const channel = supabase
      .channel("rider-bookings")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "trip_bookings", filter: `rider_user_id=eq.${user.id}` },
        (payload) => {
          setBookings((prev) => {
            const next = [...prev];
            const idx = next.findIndex((b) => b.id === (payload.new as any)?.id);
            if (payload.eventType === "INSERT") return [payload.new as Booking, ...prev];
            if (idx >= 0 && payload.new) next[idx] = payload.new as Booking;
            return next;
          });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  return (
    <RiderShell>
      <h1 className="text-2xl font-bold mb-4">Your trips</h1>
      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!loading && bookings.length === 0 && (
        <Card className="p-8 text-center">
          <MapPin className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="font-medium">No trips yet</p>
          <p className="text-sm text-muted-foreground">Your bookings will appear here.</p>
        </Card>
      )}
      <div className="space-y-2">
        {bookings.map((b) => (
          <Link key={b.id} to={`/rider/trips/${b.id}`}>
            <Card className="p-4 hover:bg-muted/40 transition-colors">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-mono text-muted-foreground">{b.booking_number}</span>
                    <Badge className={statusColor[b.status] ?? "bg-muted"}>{b.status}</Badge>
                  </div>
                  <div className="text-sm truncate">
                    <span className="text-muted-foreground">From</span> {b.pickup_address}
                  </div>
                  <div className="text-sm truncate">
                    <span className="text-muted-foreground">To</span> {b.dropoff_address}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {formatDistanceToNow(new Date(b.created_at), { addSuffix: true })}
                  </div>
                </div>
                <div className="text-right">
                  {b.total_fare !== null && <div className="font-bold">KES {Number(b.total_fare).toLocaleString()}</div>}
                  <ArrowRight className="h-4 w-4 text-muted-foreground ml-auto mt-2" />
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </RiderShell>
  );
}
