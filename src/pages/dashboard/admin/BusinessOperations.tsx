import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, CalendarDays, Car, CheckCircle2, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { untypedDb } from "@/integrations/supabase/untyped";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

type Organisation = { id: string; name: string; contact_email: string; status: string; created_at: string };
type Request = { id: string; organisation_id: string; service_type: string; vehicle_type: string; quantity: number; origin: string | null; destination: string | null; requested_date: string | null; status: string; details: string; admin_notes: string | null; created_at: string };
type Trip = { id: string; booking_number: string; pickup_address: string; dropoff_address: string; status: string; scheduled_for: string | null };

export default function BusinessOperations() {
  const [organisations, setOrganisations] = useState<Organisation[]>([]);
  const [requests, setRequests] = useState<Request[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [query, setQuery] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    const [orgs, reqs, tripRows] = await Promise.all([
      supabase.from("business_organisations").select("id,name,contact_email,status,created_at").order("created_at", { ascending: false }),
      supabase.from("business_requests").select("id,organisation_id,service_type,vehicle_type,quantity,origin,destination,requested_date,status,details,admin_notes,created_at").order("created_at", { ascending: false }).limit(500),
      supabase.from("trip_bookings").select("id,booking_number,pickup_address,dropoff_address,status,scheduled_for").eq("intent", "corporate").order("created_at", { ascending: false }).limit(250),
    ]);
    const error = orgs.error ?? reqs.error ?? tripRows.error;
    if (error) toast.error(error.message);
    setOrganisations((orgs.data ?? []) as Organisation[]);
    setRequests((reqs.data ?? []) as Request[]);
    setTrips((tripRows.data ?? []) as Trip[]);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const orgNames = useMemo(() => Object.fromEntries(organisations.map(item => [item.id, item.name])), [organisations]);
  const filtered = useMemo(() => requests.filter(item => `${orgNames[item.organisation_id] ?? ""} ${item.service_type} ${item.vehicle_type} ${item.origin ?? ""} ${item.destination ?? ""}`.toLowerCase().includes(query.toLowerCase())), [requests, orgNames, query]);
  const metrics = [
    { icon: Building2, label: "Organisations", total: organisations.length },
    { icon: CalendarDays, label: "Open requests", total: requests.filter(item => ["pending", "in_review"].includes(item.status)).length },
    { icon: Car, label: "Corporate trips", total: trips.length },
  ];
  async function reviewOrganisation(id: string, status: string) {
    const { error } = await untypedDb.rpc("admin_review_business_organisation", { _organisation_id: id, _status: status });
    if (error) return toast.error(error.message);
    toast.success("Organisation review updated"); void load();
  }
  async function updateRequest(id: string, status: string) {
    const { error } = await untypedDb.rpc("admin_update_business_request", { _request_id: id, _status: status, _admin_notes: notes[id] ?? null });
    if (error) return toast.error(error.message);
    toast.success("Request updated"); void load();
  }
  return <div className="space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-4 border-b pb-6"><div><p className="flex items-center gap-2 text-sm font-semibold text-primary"><Building2 className="h-4 w-4" /> Administration</p><h1 className="mt-2 text-3xl font-bold">Business Operations</h1><p className="mt-2 text-sm text-muted-foreground">Review organisations, progress quote requests and inspect corporate trips.</p></div><Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh</Button></header>
    <div className="grid gap-3 sm:grid-cols-3">{metrics.map(({ icon: Icon, label, total }) => <Card key={label}><CardContent className="p-5"><Icon className="h-5 w-5 text-primary"/><p className="mt-3 text-sm text-muted-foreground">{label}</p><p className="text-2xl font-bold">{total}</p></CardContent></Card>)}</div>
    <Card><CardHeader><CardTitle>Organisation accounts</CardTitle></CardHeader><CardContent><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Organisation</TableHead><TableHead>Contact</TableHead><TableHead>Status</TableHead><TableHead>Review</TableHead></TableRow></TableHeader><TableBody>{organisations.map(item => <TableRow key={item.id}><TableCell className="font-medium">{item.name}</TableCell><TableCell>{item.contact_email}</TableCell><TableCell><Badge variant="secondary">{item.status}</Badge></TableCell><TableCell><Select value={item.status} onValueChange={value => void reviewOrganisation(item.id, value)}><SelectTrigger className="w-36"><SelectValue/></SelectTrigger><SelectContent>{["pending","approved","declined"].map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></TableCell></TableRow>)}</TableBody></Table></div></CardContent></Card>
    <Card><CardHeader><CardTitle>Fleet and vehicle requests</CardTitle></CardHeader><CardContent className="space-y-4"><label className="relative block max-w-md"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground"/><Input className="pl-9" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search organisation, service or route"/></label><div className="space-y-4">{filtered.map(item => <article key={item.id} className="grid gap-4 border-t pt-5 lg:grid-cols-[1fr_260px]"><div><div className="flex flex-wrap gap-2"><h3 className="font-semibold">{orgNames[item.organisation_id] ?? "Organisation"}</h3><Badge>{item.status.replace("_", " ")}</Badge></div><p className="mt-1 text-sm capitalize">{item.service_type} · {item.quantity} × {item.vehicle_type}</p>{(item.origin || item.destination) && <p className="mt-1 text-sm text-muted-foreground">{item.origin || "Origin not supplied"} → {item.destination || "Destination not supplied"}</p>}<p className="mt-2 text-sm">{item.details}</p>{item.requested_date && <p className="mt-2 text-xs text-muted-foreground">Requested date: {new Date(item.requested_date).toLocaleDateString("en-KE")}</p>}</div><div className="space-y-2"><Textarea value={notes[item.id] ?? item.admin_notes ?? ""} onChange={event => setNotes(current => ({ ...current, [item.id]: event.target.value }))} placeholder="Administrative notes" rows={2}/><Select value={item.status} onValueChange={value => void updateRequest(item.id, value)}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{["pending","in_review","completed","cancelled"].map(value => <SelectItem key={value} value={value}>{value.replace("_", " ")}</SelectItem>)}</SelectContent></Select></div></article>)}</div></CardContent></Card>
    <Card><CardHeader><CardTitle>Corporate trips</CardTitle></CardHeader><CardContent>{trips.length ? <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Booking</TableHead><TableHead>Route</TableHead><TableHead>Status</TableHead><TableHead>Scheduled</TableHead></TableRow></TableHeader><TableBody>{trips.map(item => <TableRow key={item.id}><TableCell>{item.booking_number}</TableCell><TableCell>{item.pickup_address} → {item.dropoff_address}</TableCell><TableCell><Badge variant="outline">{item.status}</Badge></TableCell><TableCell>{item.scheduled_for ? new Date(item.scheduled_for).toLocaleString("en-KE") : "On demand"}</TableCell></TableRow>)}</TableBody></Table></div> : <p className="flex items-center gap-2 text-sm text-muted-foreground"><CheckCircle2 className="h-4 w-4"/>No corporate trips are stored yet.</p>}</CardContent></Card>
  </div>;
}