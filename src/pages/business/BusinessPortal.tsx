import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { BarChart3, Building2, Car, ClipboardList, Package, Plus, ArrowRight } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import MarketingLayout from "@/components/marketing/MarketingLayout";

type Organisation = { id: string; name: string; contact_email: string; status: string };
type Request = { id: string; service_type: string; vehicle_type: string; quantity: number; status: string; created_at: string; details: string };
type Booking = { id: string; status: string; total_fare: number | null; created_at: string };

const services = [
  { value: "fleet", label: "Fleet" }, { value: "vehicle", label: "Vehicle" },
  { value: "charter", label: "Charter" }, { value: "delivery", label: "Delivery" },
  { value: "logistics", label: "Logistics" },
];

export default function BusinessPortal() {
  const { user, loading: authLoading } = useAuth();
  const [organisation, setOrganisation] = useState<Organisation | null>(null);
  const [requests, setRequests] = useState<Request[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [service, setService] = useState("fleet");
  const [vehicle, setVehicle] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [details, setDetails] = useState("");

  const refresh = async (userId: string) => {
    setLoading(true);
    setError("");
    const { data: org, error: orgError } = await supabase.from("business_organisations")
      .select("id,name,contact_email,status").eq("owner_id", userId).maybeSingle();
    if (orgError) { setError(orgError.message); setLoading(false); return; }
    setOrganisation(org as Organisation | null);
    if (org) {
      const [requestResult, bookingResult] = await Promise.all([
        supabase.from("business_requests").select("id,service_type,vehicle_type,quantity,status,created_at,details").eq("organisation_id", org.id).order("created_at", { ascending: false }),
        supabase.from("trip_bookings").select("id,status,total_fare,created_at").eq("rider_user_id", userId).eq("intent", "corporate").order("created_at", { ascending: false }).limit(500),
      ]);
      if (requestResult.error) setError(requestResult.error.message);
      else setRequests((requestResult.data ?? []) as Request[]);
      // Personal corporate bookings only; never infer organisation-wide totals from another account.
      setBookings(bookingResult.error ? [] : (bookingResult.data ?? []) as Booking[]);
    }
    setLoading(false);
  };

  useEffect(() => { if (user?.id) void refresh(user.id); else setLoading(false); }, [user?.id]);

  const chart = useMemo(() => ["pending", "in_review", "completed", "cancelled"].map(status => ({
    name: status.replace("_", " "), count: requests.filter(request => request.status === status).length,
  })), [requests]);
  const completed = bookings.filter(booking => booking.status === "completed");
  const completedValue = completed.reduce((sum, booking) => sum + (Number(booking.total_fare) || 0), 0);

  const createOrganisation = async (event: FormEvent) => {
    event.preventDefault();
    if (!user) return;
    setSaving(true); setError("");
    const { error: saveError } = await supabase.from("business_organisations").insert({ owner_id: user.id, name: name.trim(), contact_email: email.trim() });
    if (saveError) setError(saveError.message);
    else await refresh(user.id);
    setSaving(false);
  };

  const createRequest = async (event: FormEvent) => {
    event.preventDefault();
    if (!user || !organisation) return;
    setSaving(true); setError("");
    const { error: saveError } = await supabase.from("business_requests").insert({
      organisation_id: organisation.id, requested_by: user.id, service_type: service,
      vehicle_type: vehicle.trim(), quantity, details: details.trim(),
    });
    if (saveError) setError(saveError.message);
    else { setVehicle(""); setQuantity(1); setDetails(""); await refresh(user.id); }
    setSaving(false);
  };

  return <MarketingLayout>
    <main className="min-h-screen bg-background pb-20">
      <header className="border-b bg-secondary/50"><div className="container mx-auto px-4 py-12 md:py-16">
        <p className="text-sm font-semibold uppercase text-primary">Power Business</p>
        <h1 className="mt-3 text-4xl font-bold text-foreground md:text-5xl">{organisation?.name ?? "TaxiD Business"}</h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">Fleet, vehicle and transport requests in one place.</p>
      </div></header>
      <div className="container mx-auto space-y-12 px-4 pt-10">
        {authLoading || loading ? <p role="status">Loading your business account…</p> : !user ?
          <div className="space-y-4"><p>Sign in to create your organisation and manage requests.</p><Button asChild><Link to="/auth?redirect=%2Fbusiness%2Fportal">Sign in <ArrowRight className="ml-2 h-4 w-4" /></Link></Button><p className="text-sm text-muted-foreground">New to TaxiD? <Link className="text-primary underline" to="/auth?tab=signup&as=corporate&redirect=%2Fbusiness%2Fportal">Create an account</Link></p></div> : !organisation ?
          <section className="max-w-lg space-y-6"><h2 className="text-2xl font-semibold">Create your organisation</h2>
            <form onSubmit={createOrganisation} className="space-y-4">
              <div><Label htmlFor="org-name">Organisation name</Label><Input id="org-name" required minLength={2} maxLength={180} value={name} onChange={event => setName(event.target.value)} /></div>
              <div><Label htmlFor="org-email">Contact email</Label><Input id="org-email" type="email" required value={email} onChange={event => setEmail(event.target.value)} /></div>
              <Button disabled={saving} type="submit">{saving ? "Creating…" : "Create organisation"}</Button>
            </form>
          </section> : <>
          <section aria-label="Business dashboard" className="space-y-5">
            <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm font-semibold text-primary">Business dashboard</p><h2 className="text-2xl font-bold">Your activity</h2></div><span className="text-sm text-muted-foreground">Organisation review: {organisation.status}</span></div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { icon: Car, label: "Your corporate bookings", value: bookings.length.toLocaleString() },
                { icon: BarChart3, label: "Completed trip value", value: `KES ${completedValue.toLocaleString("en-KE")}` },
                { icon: ClipboardList, label: "Pending requests", value: requests.filter(request => request.status === "pending" || request.status === "in_review").length.toLocaleString() },
                { icon: Building2, label: "Agent performance", value: "Not tracked" },
              ].map(metric => <div key={metric.label} className="rounded-md border bg-card p-5"><metric.icon className="mb-4 h-5 w-5 text-primary"/><p className="text-sm text-muted-foreground">{metric.label}</p><p className="mt-1 text-2xl font-semibold">{metric.value}</p></div>)}
            </div>
            <p className="text-xs text-muted-foreground">Bookings and trip value reflect only trips booked by this account, not organisation-wide revenue. Trip value is not payment settlement.</p>
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="border-t pt-6"><h3 className="mb-6 font-semibold">Request status</h3><div className="h-56" role="img" aria-label="Business requests by status"><ResponsiveContainer width="100%" height="100%"><BarChart data={chart}><CartesianGrid stroke="hsl(var(--chart-grid))" vertical={false}/><XAxis dataKey="name"/><YAxis allowDecimals={false}/><Tooltip/><Bar dataKey="count" fill="hsl(var(--chart-1))" radius={[4,4,0,0]}/></BarChart></ResponsiveContainer></div></div>
              <div className="border-t pt-6"><h3 className="mb-6 font-semibold">Trip status</h3><div className="space-y-4">{["pending","in_progress","completed","cancelled"].map(status => <div key={status} className="flex justify-between border-b pb-3 text-sm"><span className="capitalize">{status.replace("_", " ")}</span><strong>{bookings.filter(booking => booking.status === status).length}</strong></div>)}</div></div>
            </div>
          </section>
          <section className="grid gap-10 border-t pt-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
            <div><div className="mb-6 flex items-center gap-2"><Plus className="h-5 w-5 text-primary"/><h2 className="text-2xl font-bold">Request a quote</h2></div><p className="mb-6 text-sm text-muted-foreground">Tell us what you need. A request is an enquiry, not a confirmed booking or price.</p>
              <form onSubmit={createRequest} className="space-y-4">
                <div><Label htmlFor="service">Service</Label><Select value={service} onValueChange={setService}><SelectTrigger id="service"><SelectValue/></SelectTrigger><SelectContent>{services.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></div>
                <div><Label htmlFor="vehicle">Vehicle or fleet type</Label><Input id="vehicle" required minLength={2} maxLength={120} value={vehicle} onChange={event => setVehicle(event.target.value)} placeholder="e.g. 25-seat minibus" /></div>
                <div><Label htmlFor="quantity">Quantity</Label><Input id="quantity" required type="number" min={1} max={10000} value={quantity} onChange={event => setQuantity(Number(event.target.value))} /></div>
                <div><Label htmlFor="details">Journey and requirements</Label><Textarea id="details" required minLength={10} maxLength={3000} rows={5} value={details} onChange={event => setDetails(event.target.value)} placeholder="Route, dates, passengers or cargo, and any special requirements" /></div>
                <Button type="submit" disabled={saving}>{saving ? "Sending…" : "Send quote request"}</Button>
              </form>
            </div>
            <div><div className="mb-6 flex items-center gap-2"><Package className="h-5 w-5 text-primary"/><h2 className="text-2xl font-bold">Requests & orders</h2></div>
              {requests.length === 0 ? <p className="text-sm text-muted-foreground">No requests yet. Your first enquiry will appear here.</p> : <div className="divide-y border-y">{requests.map(request => <article key={request.id} className="flex flex-wrap justify-between gap-3 py-5"><div><h3 className="font-semibold capitalize">{request.service_type} · {request.vehicle_type}</h3><p className="mt-1 text-sm text-muted-foreground">{request.quantity} requested · {new Date(request.created_at).toLocaleDateString("en-KE")}</p><p className="mt-2 max-w-lg text-sm">{request.details}</p></div><span className="h-fit rounded-sm bg-secondary px-2 py-1 text-xs font-medium capitalize">{request.status.replace("_", " ")}</span></article>)}</div>}
              <div className="mt-8 flex flex-wrap gap-3"><Button variant="outline" asChild><Link to="/marketplace?family=charter">Explore charter</Link></Button><Button variant="outline" asChild><Link to="/marketplace?family=rental">Explore vehicles</Link></Button><Button variant="outline" asChild><Link to="/marketplace?family=logistics">Explore logistics</Link></Button></div>
            </div>
          </section>
        </>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </div>
    </main>
  </MarketingLayout>;
}