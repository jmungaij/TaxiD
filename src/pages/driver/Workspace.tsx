import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Car, CheckCircle2, Loader2, MapPin, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { untypedDb } from "@/integrations/supabase/untyped";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Driver = { id: string; first_name: string; last_name: string; driver_code: string; verification_status: string };
type Vehicle = { id: string; plate_number: string; make: string | null; model: string | null; status: string };
type Trip = { id: string; booking_number: string; pickup_address: string; dropoff_address: string; status: string; total_fare: number | null; driver_id: string | null; scheduled_for: string | null; business_request_id: string | null };
type Earning = { amount: number; created_at: string };

const NEXT: Record<string, { to: string; label: string }> = {
  accepted: { to: "arrived", label: "Arrived at pickup" },
  arrived: { to: "in_progress", label: "Start trip" },
  in_progress: { to: "completed", label: "Complete trip" },
};
const kes = (n: number) => `KES ${n.toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;

export default function DriverWorkspace() {
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(true);
  const [driver, setDriver] = useState<Driver | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [earnings, setEarnings] = useState<Earning[]>([]);
  const [form, setForm] = useState({ first_name: "", last_name: "", phone: "", plate: "", make: "", model: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSignedIn(false); setLoading(false); return; }
    const { data: d } = await untypedDb.from("drivers").select("id,first_name,last_name,driver_code,verification_status").eq("user_id", user.id).maybeSingle();
    setDriver(d as Driver | null);
    if (d) {
      const [v, t, e] = await Promise.all([
        untypedDb.from("vehicles").select("id,plate_number,make,model,status").eq("driver_id", d.id),
        untypedDb.from("trip_bookings").select("id,booking_number,pickup_address,dropoff_address,status,total_fare,driver_id,scheduled_for,business_request_id").or(`driver_id.eq.${d.id},and(driver_id.is.null,status.in.(pending,scheduled))`).order("created_at", { ascending: false }).limit(100),
        untypedDb.from("driver_earnings").select("amount,created_at").eq("driver_id", d.id),
      ]);
      setVehicles((v.data ?? []) as Vehicle[]);
      setTrips((t.data ?? []) as Trip[]);
      setEarnings((e.data ?? []) as Earning[]);
    }
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function register() {
    if (!form.first_name.trim() || !form.plate.trim()) return toast.error("Enter your first name and vehicle plate.");
    setBusy(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data: d, error } = await untypedDb.from("drivers").insert({ user_id: user!.id, first_name: form.first_name.trim(), last_name: form.last_name.trim(), phone: form.phone.trim() || null }).select("id").single();
    if (!error && d) await untypedDb.from("vehicles").insert({ driver_id: d.id, plate_number: form.plate.trim().toUpperCase(), make: form.make.trim() || null, model: form.model.trim() || null });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Driver profile created"); void load();
  }
  async function call(fn: string, args: Record<string, unknown>, ok: string) {
    setBusy(true);
    const { error } = await untypedDb.rpc(fn, args);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(ok); void load();
  }

  if (loading) return <div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  if (!signedIn) return <div className="mx-auto max-w-md p-10 text-center"><p className="mb-4">Sign in to open your driver workspace.</p><Button asChild><Link to="/auth?redirect=%2Fdriver%2Fworkspace">Sign in</Link></Button></div>;

  if (!driver) return (
    <div className="mx-auto max-w-xl p-6">
      <Card><CardHeader><CardTitle>Become a TaxiD driver</CardTitle><CardDescription>Create your driver profile and add your vehicle. Verification is done by TaxiD staff.</CardDescription></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {([ ["first_name","First name"],["last_name","Last name"],["phone","Phone"],["plate","Vehicle plate"],["make","Make"],["model","Model"] ] as const).map(([k, l]) =>
            <Input key={k} placeholder={l} value={form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} />)}
          <Button className="sm:col-span-2" onClick={() => void register()} disabled={busy}>Create driver profile</Button>
        </CardContent></Card>
    </div>
  );

  const now = new Date(); const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()); const weekStart = new Date(dayStart); weekStart.setDate(dayStart.getDate() - 6);
  const sum = (from?: Date) => earnings.filter(e => !from || new Date(e.created_at) >= from).reduce((a, e) => a + Number(e.amount), 0);
  const open = trips.filter(t => !t.driver_id);
  const mine = trips.filter(t => t.driver_id === driver.id);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b pb-5">
        <div><p className="text-sm font-semibold text-primary">Driver workspace · {driver.driver_code}</p><h1 className="text-3xl font-bold">Hello, {driver.first_name || "driver"}</h1></div>
        <div className="flex gap-2"><Badge variant="outline">Verification: {driver.verification_status}</Badge><Button variant="outline" asChild><Link to="/business/dashboard">Power Business</Link></Button></div>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        {[["Today", sum(dayStart)], ["Last 7 days", sum(weekStart)], ["All time", sum()]].map(([l, v]) =>
          <Card key={l as string}><CardContent className="p-5"><Wallet className="h-5 w-5 text-primary" /><p className="mt-2 text-sm text-muted-foreground">{l} earnings</p><p className="text-2xl font-bold">{kes(v as number)}</p></CardContent></Card>)}
      </div>

      <Card><CardHeader><CardTitle className="flex items-center gap-2"><Car className="h-5 w-5" />Vehicle status</CardTitle></CardHeader>
        <CardContent className="space-y-3">{vehicles.length ? vehicles.map(v =>
          <div key={v.id} className="flex flex-wrap items-center justify-between gap-3 border-t pt-3"><span className="font-medium">{v.plate_number} {[v.make, v.model].filter(Boolean).join(" ")}</span>
            {v.status === "on_trip" ? <Badge>On trip</Badge> :
            <Select value={v.status} onValueChange={s => void call("driver_set_vehicle_status", { _vehicle_id: v.id, _status: s }, "Vehicle status updated")}><SelectTrigger className="w-44"><SelectValue /></SelectTrigger><SelectContent>{["available","offline","maintenance"].map(s => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}</SelectContent></Select>}
          </div>) : <p className="text-sm text-muted-foreground">No vehicle registered.</p>}</CardContent></Card>

      <Card><CardHeader><CardTitle>Available trips and fleet quotes</CardTitle><CardDescription>Accept a trip to take it. It then appears under your trips.</CardDescription></CardHeader>
        <CardContent className="space-y-3">{open.length ? open.map(t =>
          <div key={t.id} className="flex flex-wrap items-center justify-between gap-3 border-t pt-3"><div><p className="font-medium flex items-center gap-1"><MapPin className="h-4 w-4 text-primary" />{t.pickup_address} → {t.dropoff_address}</p><p className="text-xs text-muted-foreground">{t.booking_number} · {t.total_fare ? kes(Number(t.total_fare)) : "Fare on completion"}{t.scheduled_for ? ` · ${new Date(t.scheduled_for).toLocaleString("en-KE")}` : ""}</p></div>
            <Button disabled={busy} onClick={() => void call("driver_accept_trip", { _booking_id: t.id }, "Trip accepted")}>Accept</Button></div>) : <p className="text-sm text-muted-foreground">No open trips right now.</p>}</CardContent></Card>

      <Card><CardHeader><CardTitle>My trips</CardTitle></CardHeader>
        <CardContent className="space-y-3">{mine.length ? mine.map(t =>
          <div key={t.id} className="flex flex-wrap items-center justify-between gap-3 border-t pt-3"><div><p className="font-medium">{t.pickup_address} → {t.dropoff_address}</p><p className="text-xs text-muted-foreground">{t.booking_number}{t.business_request_id ? " · Business fleet" : ""}</p></div>
            <div className="flex items-center gap-2"><Badge variant="outline" className="capitalize">{t.status.replace("_", " ")}</Badge>
              {NEXT[t.status] ? <Button size="sm" disabled={busy} onClick={() => void call("driver_update_trip_status", { _booking_id: t.id, _status: NEXT[t.status].to }, "Trip updated")}>{NEXT[t.status].label}</Button> : t.status === "completed" && <CheckCircle2 className="h-5 w-5 text-primary" />}</div></div>) : <p className="text-sm text-muted-foreground">You have no trips yet.</p>}</CardContent></Card>
    </div>
  );
}
