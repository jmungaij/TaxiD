import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Hotel, Plane, UserPlus } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import type { CompanyPlace } from "./CompanyPlacesPanel";
import { TravellerPanel, LiveTravelDesk } from "./TravelDeskPanels";

export const GUEST_KINDS = {
  employee: "Employee",
  guest: "Guest ride",
  client: "Client ride",
  hotel_guest: "Hotel guest ride",
  hotel_transfer: "Hotel transfer",
  airport_transfer: "Airport transfer",
} as const;
const STATUS: Record<string, { label: string; v: "default" | "secondary" | "destructive" | "outline" }> = {
  pending_approval: { label: "Waiting for approval", v: "secondary" },
  confirmed: { label: "Confirmed", v: "default" },
  rejected: { label: "Rejected", v: "destructive" },
  cancelled: { label: "Cancelled", v: "outline" },
  completed: { label: "Completed", v: "default" },
};
const ERR: Record<string, string> = {
  NOT_AUTHORISED: "Only company admins and managers can use the TravelDesk.",
  NOT_AN_ACTIVE_EMPLOYEE: "Choose an active employee.",
  PURPOSE_REQUIRED: "This program needs a trip purpose.",
  COMPANY_NOT_ACTIVE: "This company account isn't active yet.",
  PASSENGER_NAME_REQUIRED: "Enter the passenger's name.",
  LOCATIONS_REQUIRED: "Choose or enter both pickup and drop-off locations.",
  FLIGHT_NUMBER_REQUIRED: "Airport transfers need a flight number.",
  TIME_IN_PAST: "The pickup time is in the past.",
  BOOKING_CODES_REQUIRED: "Your company requires project, client, PO or accounting codes on every booking.",
  COMPANY_FUNDS_INSUFFICIENT: "The company wallet and credit don't cover this fare.",
};

export interface GuestBooking {
  id: string; reference: string; booking_kind: keyof typeof GUEST_KINDS; passenger_name: string; passenger_phone: string | null;
  hotel_room: string | null; flight_number: string | null; pickup_address: string; dropoff_address: string; scheduled_for: string | null;
  estimated_fare_cents: number; distance_km: number; project_code: string | null; client_code: string | null; po_code: string | null;
  accounting_code: string | null; status: string; created_at: string; cost_center_code?: string | null; purpose?: string | null;
}

const kes = (c: number) => `KES ${(c / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

/** Table of guest/client/hotel/airport bookings — reused on the Cash Ledger page. */
export function GuestBookingsTable({ corporateId, refreshKey = 0, allowCancel = false }: { corporateId: string; refreshKey?: number; allowCancel?: boolean }) {
  const [rows, setRows] = useState<GuestBooking[]>([]);
  const load = async () => {
    const { data } = await supabase.from("corporate_guest_bookings").select("*").eq("corporate_id", corporateId).order("created_at", { ascending: false }).limit(200);
    setRows((data ?? []) as GuestBooking[]);
  };
  useEffect(() => { load(); }, [corporateId, refreshKey]);
  const cancel = async (id: string) => {
    if (!confirm("Cancel this booking?")) return;
    const { data } = await supabase.rpc("corporate_guest_cancel", { _id: id });
    if (!(data as { ok?: boolean })?.ok) toast({ title: "Couldn't cancel", variant: "destructive" });
    load();
  };
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No guest, client or hotel bookings yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-muted-foreground"><tr>
          <th className="p-2">Reference</th><th className="p-2">Type</th><th className="p-2">Passenger</th><th className="p-2">Route</th>
          <th className="p-2">Codes</th><th className="p-2 text-right">Estimated fare</th><th className="p-2">Status</th>{allowCancel && <th />}
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t align-top">
              <td className="p-2 font-mono">{r.reference}<div className="text-xs text-muted-foreground">{new Date(r.scheduled_for ?? r.created_at).toLocaleString()}</div></td>
              <td className="p-2">{GUEST_KINDS[r.booking_kind]}{r.flight_number && <div className="text-xs">Flight {r.flight_number}</div>}{r.hotel_room && <div className="text-xs">Room {r.hotel_room}</div>}</td>
              <td className="p-2">{r.passenger_name}</td>
              <td className="p-2">{r.pickup_address} → {r.dropoff_address}<div className="text-xs text-muted-foreground">{r.distance_km} km</div></td>
              <td className="p-2 text-xs">{[r.project_code && `Project ${r.project_code}`, r.client_code && `Client ${r.client_code}`, r.po_code && `PO ${r.po_code}`, r.accounting_code && `GL ${r.accounting_code}`, r.cost_center_code && `CC ${r.cost_center_code}`].filter(Boolean).join(" · ") || "—"}</td>
              <td className="p-2 text-right">{kes(r.estimated_fare_cents)}</td>
              <td className="p-2"><Badge variant={STATUS[r.status]?.v ?? "outline"}>{STATUS[r.status]?.label ?? r.status}</Badge></td>
              {allowCancel && <td className="p-2">{["pending_approval", "confirmed"].includes(r.status) && <Button size="sm" variant="ghost" onClick={() => cancel(r.id)}>Cancel</Button>}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type Pt = { address: string; lat: string; lng: string };
const emptyPt: Pt = { address: "", lat: "", lng: "" };

function PointField({ label, value, onChange, places }: { label: string; value: Pt; onChange: (p: Pt) => void; places: CompanyPlace[] }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {places.length > 0 && (
        <Select onValueChange={(id) => { const p = places.find((x) => x.id === id); if (p) onChange({ address: p.address || p.name, lat: String(p.lat), lng: String(p.lng) }); }}>
          <SelectTrigger><SelectValue placeholder="Choose a company place…" /></SelectTrigger>
          <SelectContent>{places.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
        </Select>
      )}
      <Input placeholder="Address" value={value.address} onChange={(e) => onChange({ ...value, address: e.target.value })} />
      <div className="grid grid-cols-2 gap-2">
        <Input placeholder="Latitude" value={value.lat} onChange={(e) => onChange({ ...value, lat: e.target.value })} />
        <Input placeholder="Longitude" value={value.lng} onChange={(e) => onChange({ ...value, lng: e.target.value })} />
      </div>
    </div>
  );
}

/** Book rides for non-employees: guests, clients, hotel guests, hotel and airport transfers. */
export function GuestRides({ corporateId }: { corporateId: string }) {
  const [rideTypes, setRideTypes] = useState<{ id: string; name: string }[]>([]);
  const [places, setPlaces] = useState<CompanyPlace[]>([]);
  const [kind, setKind] = useState<keyof typeof GUEST_KINDS>("employee");
  const [emps, setEmps] = useState<{ id: string; full_name: string | null; email: string | null }[]>([]);
  const [programs, setPrograms] = useState<{ id: string; name: string }[]>([]);
  const [empId, setEmpId] = useState("");
  const [programId, setProgramId] = useState("none");
  const [cc, setCc] = useState("");
  const [purpose, setPurpose] = useState("");
  const [p, setP] = useState({ name: "", phone: "", email: "", room: "", flight: "", passengers: "1", luggage: "0", when: "", ride: "", project: "", client: "", po: "", acct: "", notes: "" });
  const [from, setFrom] = useState<Pt>(emptyPt);
  const [to, setTo] = useState<Pt>(emptyPt);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    supabase.from("ride_types").select("id,name").eq("is_active", true).order("sort_order").then(({ data }) => {
      const list = (data ?? []).map((r) => ({ id: r.id, name: String(r.name).replace(/^(SAFARID|TaxiD)\s+/i, "") }));
      setRideTypes(list); if (list[0]) setP((x) => ({ ...x, ride: x.ride || list[0].id }));
    });
    supabase.from("corporate_employees").select("id,full_name,email").eq("corporate_id", corporateId).eq("status", "active").order("full_name").then(({ data }) => setEmps(data ?? []));
    supabase.from("corporate_programs").select("id,name").eq("corporate_id", corporateId).eq("active", true).order("name").then(({ data }) => setPrograms(data ?? []));
    supabase.from("corporate_locations").select("*").eq("corporate_id", corporateId).eq("active", true).order("name").then(({ data }) => setPlaces((data ?? []) as CompanyPlace[]));
  }, [corporateId]);

  const submit = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc("corporate_guest_book", {
      _corporate_id: corporateId, _kind: kind, _passenger_name: p.name, _passenger_phone: p.phone,
      _pickup_address: from.address || "Pickup", _plat: parseFloat(from.lat), _plng: parseFloat(from.lng),
      _dropoff_address: to.address || "Drop-off", _dlat: parseFloat(to.lat), _dlng: parseFloat(to.lng),
      _ride_type_id: p.ride, _scheduled_for: p.when ? new Date(p.when).toISOString() : null,
      _details: { employee_id: kind === "employee" ? empId : null, program_id: programId === "none" ? null : programId, cost_center_code: cc, purpose, passenger_email: p.email, hotel_room: p.room, flight_number: p.flight, passengers: Number(p.passengers), luggage: Number(p.luggage),
        project_code: p.project, client_code: p.client, po_code: p.po, accounting_code: p.acct, notes: p.notes },
    });
    setBusy(false);
    const res = data as { ok?: boolean; error?: string; reference?: string; state?: string; fare_cents?: number; message?: string; policy?: { reasons?: { message: string }[] } } | null;
    if (error || !res?.ok) {
      const reasons = res?.policy?.reasons?.map((r) => r.message).join("; ");
      toast({ title: "Booking not made", description: res?.error === "POLICY_BLOCKED" ? `Not allowed by company policy: ${reasons}` : ERR[res?.error ?? ""] ?? error?.message ?? res?.error, variant: "destructive" });
      return;
    }
    toast({ title: `${res.reference} — ${res.state === "confirmed" ? "confirmed" : "sent for approval"}`, description: `Estimated fare ${kes(res.fare_cents ?? 0)}, charged to the company.` });
    setP({ ...p, name: "", phone: "", email: "", room: "", flight: "", notes: "" }); setFrom(emptyPt); setTo(emptyPt); setRefresh((n) => n + 1);
  };

  const isHotel = kind === "hotel_guest" || kind === "hotel_transfer";
  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-4">
        <div>
          <h3 className="font-semibold flex items-center gap-2"><UserPlus className="h-4 w-4" /> TravelDesk — book for staff, guests, clients or hotel guests</h3>
          <p className="text-sm text-muted-foreground">The company pays. Guests don't need a TaxiD account. Hotels can book guest rides and hotel or airport transfers. TaxiD works out the fare and checks the traveller's policies, program and limits before booking.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(GUEST_KINDS) as (keyof typeof GUEST_KINDS)[]).map((k) => (
            <Button key={k} size="sm" variant={k === kind ? "default" : "outline"} onClick={() => setKind(k)} className="gap-1">
              {k === "airport_transfer" ? <Plane className="h-3 w-3" /> : k.startsWith("hotel") ? <Hotel className="h-3 w-3" /> : null}{GUEST_KINDS[k]}
            </Button>
          ))}
        </div>
        {kind === "employee" && (
          <div className="grid gap-3 md:grid-cols-2">
            <div><Label>Employee *</Label>
              <Select value={empId} onValueChange={setEmpId}><SelectTrigger><SelectValue placeholder="Choose an employee…" /></SelectTrigger>
                <SelectContent>{emps.map((e) => <SelectItem key={e.id} value={e.id}>{e.full_name || e.email}</SelectItem>)}</SelectContent></Select>
            </div>
            {empId && <TravellerPanel corporateId={corporateId} employeeId={empId} />}
          </div>
        )}
        <div className="grid gap-3 md:grid-cols-3">
          <div><Label>Travel program</Label>
            <Select value={programId} onValueChange={setProgramId}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="none">No program</SelectItem>{programs.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select>
          </div>
          <div><Label>Cost centre</Label><Input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="Program default if empty" /></div>
          <div><Label>Business purpose</Label><Input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Client meeting" /></div>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {kind !== "employee" && <div><Label>Passenger name *</Label><Input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} /></div>}
          <div><Label>Passenger phone</Label><Input value={p.phone} onChange={(e) => setP({ ...p, phone: e.target.value })} placeholder="+2547…" /></div>
          <div><Label>Passenger email</Label><Input value={p.email} onChange={(e) => setP({ ...p, email: e.target.value })} /></div>
          {isHotel && <div><Label>Room number</Label><Input value={p.room} onChange={(e) => setP({ ...p, room: e.target.value })} /></div>}
          {(kind === "airport_transfer" || kind === "hotel_transfer") && <div><Label>Flight number{kind === "airport_transfer" ? " *" : ""}</Label><Input value={p.flight} onChange={(e) => setP({ ...p, flight: e.target.value })} placeholder="KQ101" /></div>}
          <div><Label>Passengers</Label><Input type="number" min={1} value={p.passengers} onChange={(e) => setP({ ...p, passengers: e.target.value })} /></div>
          <div><Label>Bags</Label><Input type="number" min={0} value={p.luggage} onChange={(e) => setP({ ...p, luggage: e.target.value })} /></div>
          <div><Label>Pickup time (empty = now)</Label><Input type="datetime-local" value={p.when} onChange={(e) => setP({ ...p, when: e.target.value })} /></div>
          <div><Label>Car type</Label>
            <Select value={p.ride} onValueChange={(v) => setP({ ...p, ride: v })}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{rideTypes.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent></Select>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <PointField label="Pickup *" value={from} onChange={setFrom} places={places} />
          <PointField label="Drop-off *" value={to} onChange={setTo} places={places} />
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          <div><Label>Project code</Label><Input value={p.project} onChange={(e) => setP({ ...p, project: e.target.value })} /></div>
          <div><Label>Client code</Label><Input value={p.client} onChange={(e) => setP({ ...p, client: e.target.value })} /></div>
          <div><Label>PO number</Label><Input value={p.po} onChange={(e) => setP({ ...p, po: e.target.value })} /></div>
          <div><Label>Accounting / GL code</Label><Input value={p.acct} onChange={(e) => setP({ ...p, acct: e.target.value })} /></div>
        </div>
        <div><Label>Notes for the driver</Label><Textarea value={p.notes} onChange={(e) => setP({ ...p, notes: e.target.value })} placeholder="e.g. Meet at hotel lobby with a name sign" /></div>
        <Button onClick={submit} disabled={busy}>{busy ? "Booking…" : "Book and charge the company"}</Button>
      </Card>
      <LiveTravelDesk corporateId={corporateId} refreshKey={refresh} />
      <Card className="p-4 space-y-2">
        <h3 className="font-semibold">TravelDesk bookings</h3>
        <GuestBookingsTable corporateId={corporateId} refreshKey={refresh} allowCancel />
      </Card>
    </div>
  );
}
