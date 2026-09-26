import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Radio, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { requestCorporateRide } from "@/lib/corporateRides";


interface Employee { id: string; email: string; full_name: string | null; user_id: string | null }
interface RideType { id: string; name: string }

export default function CorporateManualDispatch({ corporateId }: { corporateId: string | null }) {
  const [emps, setEmps] = useState<Employee[]>([]);
  const [rideTypes, setRideTypes] = useState<RideType[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    employee_id: "",
    pickup_address: "",
    dropoff_address: "",
    ride_type_id: "",
    when: "now" as "now" | "later",
    scheduled_for: "",
    passenger_count: "1",
    estimate_kes: "",
  });


  const load = async () => {
    if (!corporateId) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const [r1, r2] = await Promise.all([
        supabase.from("corporate_employees").select("id,email,full_name,user_id").eq("corporate_id", corporateId).eq("status", "active").not("user_id", "is", null).order("full_name"),
        supabase.from("ride_types").select("id,name").eq("is_active", true).order("sort_order"),
      ]);
      if (r1.error) throw r1.error;
      if (r2.error) throw r2.error;
      setEmps((r1.data ?? []) as Employee[]);
      setRideTypes((r2.data ?? []) as RideType[]);
    } catch (e) {
      setError((e as Error).message ?? "Failed to load dispatch data.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [corporateId]);

  const submit = async () => {
    if (!corporateId) return;
    if (!form.employee_id || !form.pickup_address || !form.dropoff_address) {
      toast({ title: "Missing fields", description: "Rider, pickup and drop-off are required.", variant: "destructive" });
      return;
    }
    const fareCents = Math.round((parseFloat(form.estimate_kes) || 0) * 100);
    if (fareCents <= 0) {
      toast({ title: "Estimated value required", description: "The spending policy needs an expected trip value.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    // Goes through the server routine so the organisation's spending policy,
    // approval rules and audit trail apply to staff-booked rides too.
    try {
      const rideTypeName = rideTypes.find((r) => r.id === form.ride_type_id)?.name ?? "standard";
      const res = await requestCorporateRide({
        corporateId,
        employeeId: form.employee_id,
        rideType: rideTypeName,
        rideTypeId: form.ride_type_id || null,
        pickupAddress: form.pickup_address,
        dropoffAddress: form.dropoff_address,
        fareCents,
        passengerCount: parseInt(form.passenger_count) || 1,
        scheduledFor: form.when === "later" && form.scheduled_for ? new Date(form.scheduled_for).toISOString() : null,
      });
      if (res.decision === "allow") {
        toast({ title: "Ride dispatched", description: `Booking ${res.booking_number ?? ""} is awaiting driver assignment.` });
        setForm({ ...form, pickup_address: "", dropoff_address: "", scheduled_for: "", estimate_kes: "" });
      } else if (res.decision === "requires_approval") {
        toast({ title: "Sent for approval", description: res.reason });
      } else {
        toast({ title: "Blocked by policy", description: res.reason, variant: "destructive" });
      }
    } catch (e) {
      toast({ title: "Failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };


  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold flex items-center gap-2"><Radio className="h-5 w-5" />Manual Dispatch</h2>
        <p className="text-sm text-muted-foreground">Book a ride on behalf of an employee. Ideal for guest travel and executive arrangements.</p>
      </div>

      {loading && (
        <div className="rounded-xl border bg-card p-10 flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" /> <span className="text-sm">Loading dispatch options…</span>
        </div>
      )}
      {error && !loading && (
        <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-destructive mt-0.5" />
          <div className="text-sm">
            <p className="font-medium">Couldn't load dispatch data</p>
            <p className="text-muted-foreground">{error}</p>
          </div>
        </div>
      )}
      {!loading && !error && emps.length === 0 && (
        <div className="rounded-xl border bg-muted/30 p-6 text-sm text-muted-foreground">
          No active employees with a linked account to dispatch for. Invite them from the Employees tab first.
        </div>
      )}

      {!loading && !error && emps.length > 0 && (
      <div className="grid lg:grid-cols-2 gap-6">

        <div className="rounded-xl border bg-card p-6 space-y-4">
          <div>
            <Label>Ride for *</Label>
            <Select value={form.employee_id} onValueChange={(v) => setForm({ ...form, employee_id: v })}>
              <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
              <SelectContent>
                {emps.map(e => <SelectItem key={e.id} value={e.id}>{e.full_name || e.email}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Estimated value (KSh) *</Label>
            <Input type="number" min={1} value={form.estimate_kes} onChange={(e) => setForm({ ...form, estimate_kes: e.target.value })} placeholder="e.g. 3200" />
          </div>


          <div>
            <Label>Pickup address *</Label>
            <Input value={form.pickup_address} onChange={(e) => setForm({ ...form, pickup_address: e.target.value })} placeholder="e.g. Sarit Centre, Westlands" />
          </div>
          <div>
            <Label>Drop-off address *</Label>
            <Input value={form.dropoff_address} onChange={(e) => setForm({ ...form, dropoff_address: e.target.value })} placeholder="e.g. JKIA Terminal 1A" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Vehicle class</Label>
              <Select value={form.ride_type_id} onValueChange={(v) => setForm({ ...form, ride_type_id: v })}>
                <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
                <SelectContent>
                  {rideTypes.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Passengers</Label>
              <Input type="number" min={1} max={8} value={form.passenger_count} onChange={(e) => setForm({ ...form, passenger_count: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>When</Label>
              <Select value={form.when} onValueChange={(v) => setForm({ ...form, when: v as "now" | "later" })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="now">Ride now</SelectItem>
                  <SelectItem value="later">Schedule for later</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.when === "later" && (
              <div>
                <Label>Pickup time</Label>
                <Input type="datetime-local" value={form.scheduled_for} onChange={(e) => setForm({ ...form, scheduled_for: e.target.value })} />
              </div>
            )}
          </div>
          <Button onClick={submit} disabled={submitting} className="w-full">
            {submitting ? "Dispatching…" : "Dispatch ride"}
          </Button>
        </div>

        <div className="rounded-xl border bg-muted/30 p-6 text-sm text-muted-foreground">
          <p className="font-medium text-foreground mb-2">How it works</p>
          <ul className="list-disc list-inside space-y-1">
            <li>The booking is created against the selected employee's account.</li>
            <li>Fare is debited from the corporate wallet (payment method: corporate).</li>
            <li>Dispatch picks the closest available driver in the vehicle class.</li>
            <li>Scheduled rides appear in Approve Bookings if the employee requires approval.</li>
          </ul>
        </div>
      </div>
      )}

    </div>
  );
}
