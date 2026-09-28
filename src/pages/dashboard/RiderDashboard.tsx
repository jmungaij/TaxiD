import { useAuth } from "@/hooks/useAuth";
import { Wallet, ArrowRight, Clock, ShieldCheck, MapPin, LifeBuoy, Car } from "lucide-react";
import { TopUpDialog } from "@/components/dashboard/TopUpDialog";
import { TransactionsList } from "@/components/dashboard/TransactionsList";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { isActiveTrip, tripStatusLabel } from "@/lib/rider/tripStatus";
import riderImage from "@/assets/rider/taxid-rider-daylight.jpg";

interface Trip {
  id: string;
  booking_number: string;
  pickup_address: string;
  dropoff_address: string;
  status: string;
  total_fare: number | null;
  created_at: string;
}

export default function RiderDashboard() {
  const { user } = useAuth();
  const [balance, setBalance] = useState<number | null>(null);
  const [walletId, setWalletId] = useState<string>("");
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [tripError, setTripError] = useState(false);

  useEffect(() => {
    if (!user) return;
    let mounted = true;
    const refresh = async () => {
      const [{ data: wallet }, { data: bookings, error }] = await Promise.all([
        supabase.from("wallets").select("id,balance_cents").eq("user_id", user.id).eq("wallet_type", "personal").maybeSingle(),
        supabase.from("trip_bookings").select("id,booking_number,pickup_address,dropoff_address,status,total_fare,created_at")
          .eq("rider_user_id", user.id).order("created_at", { ascending: false }).limit(20),
      ]);
      if (!mounted) return;
      setBalance(wallet ? Number(wallet.balance_cents) : null);
      setWalletId(wallet?.id ?? "");
      setTrips((bookings ?? []) as Trip[]);
      setTripError(Boolean(error));
      setLoading(false);
    };
    void refresh();
    const channel = supabase.channel(`rider-overview-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "trip_bookings", filter: `rider_user_id=eq.${user.id}` }, () => { void refresh(); })
      .subscribe();
    return () => { mounted = false; void supabase.removeChannel(channel); };
  }, [user]);

  const active = trips.find((trip) => isActiveTrip(trip.status));
  const completed = trips.filter((trip) => trip.status === "completed");
  const thisMonth = completed.filter((trip) => {
    const date = new Date(trip.created_at);
    const now = new Date();
    return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
  });
  const monthSpend = thisMonth.reduce((sum, trip) => sum + Number(trip.total_fare ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-md bg-[#031D7C] text-white">
        <img src={riderImage} alt="TaxiD rider with a driver partner" className="absolute inset-0 h-full w-full object-cover object-[65%_center]" width={1600} height={1008} />
        <div className="absolute inset-0 bg-gradient-to-r from-[#031D7C] via-[#031D7C]/90 to-[#031D7C]/20" />
        <div className="relative max-w-xl px-6 py-12 md:px-10 md:py-16">
          <p className="text-sm font-semibold uppercase tracking-widest text-[#FDBB03]">Your TaxiD</p>
          <h1 className="mt-3 text-3xl font-bold md:text-4xl">Welcome back, your journey starts here.</h1>
          <p className="mt-3 text-sm text-white/80">Book a ride, send a package or review your recent trips and wallet.</p>
          <div className="mt-7 flex flex-wrap gap-2">
            <Button asChild><Link to="/rider"><Car className="mr-2 h-4 w-4" />Book a ride</Link></Button>
            <Button asChild variant="secondary"><Link to="/delivery">Package delivery</Link></Button>
          </div>
        </div>
      </div>
      {walletId && <div className="flex justify-end"><TopUpDialog walletType="personal" walletId={walletId} onSuccess={(b) => setBalance(b)} /></div>}

      {active && <Card className="border-primary p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><p className="text-sm font-semibold">Current trip · {active.booking_number}</p>
            <p className="mt-1 text-sm text-muted-foreground">{active.pickup_address} → {active.dropoff_address}</p>
            <p className="mt-1 text-sm text-primary">{tripStatusLabel(active.status)}</p></div>
          <Button asChild><Link to={`/rider/trips/${active.id}`}>Track trip <ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
        </div>
      </Card>}

      <div className="grid sm:grid-cols-3 gap-4">
        <div className="rounded-md border bg-card p-5">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Wallet Balance</span>
            <Wallet className="h-5 w-5 text-primary" />
          </div>
          <p className="text-2xl font-bold mt-2">{balance === null ? "—" : `KES ${(balance / 100).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</p>
        </div>
        <div className="rounded-md border bg-card p-5">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Recent completed trips</span>
            <MapPin className="h-5 w-5 text-primary" />
          </div>
          <p className="text-2xl font-bold mt-2">{loading ? "—" : completed.length}</p>
        </div>
        <div className="rounded-md border bg-card p-5">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Recent trip spend this month</span>
            <Clock className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="text-2xl font-bold mt-2">{loading ? "—" : `KES ${monthSpend.toLocaleString("en-KE")}`}</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 border bg-card p-6">
          <div className="mb-4 flex items-center justify-between"><h2 className="font-semibold">Recent trips</h2><Link className="text-sm text-primary" to="/rider/trips">See all</Link></div>
          {tripError ? <p role="alert" className="text-sm text-destructive">Trips could not be loaded right now.</p> : loading ? <p className="text-sm text-muted-foreground">Loading trips…</p> : trips.length === 0 ? <p className="text-sm text-muted-foreground">No trips yet. Your bookings will appear here.</p> :
            <ul className="divide-y">{trips.slice(0, 5).map((trip) => <li key={trip.id}><Link to={`/rider/trips/${trip.id}`} className="flex justify-between gap-3 py-3 text-sm hover:text-primary"><span className="min-w-0 truncate">{trip.dropoff_address}<span className="block text-xs text-muted-foreground">{new Date(trip.created_at).toLocaleDateString("en-KE")}</span></span><span className="shrink-0 text-right">{trip.total_fare != null ? `KES ${Number(trip.total_fare).toLocaleString("en-KE")}` : ""}<span className="block text-xs text-muted-foreground">{tripStatusLabel(trip.status)}</span></span></Link></li>)}</ul>}
        </div>
        <div className="border bg-card p-6">
          <h2 className="font-semibold mb-4">Wallet Transactions</h2>
          <TransactionsList walletId={walletId} />
        </div>
      </div>
      <div className="flex flex-wrap gap-3 text-sm"><Button asChild variant="outline"><Link to="/rider/support"><LifeBuoy className="mr-2 h-4 w-4" />Get support</Link></Button><Button asChild variant="outline"><Link to="/rider/safety"><ShieldCheck className="mr-2 h-4 w-4" />Safety</Link></Button></div>
    </div>
  );
}
