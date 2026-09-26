/**
 * Corporate "Request a ride" — the operational entry point.
 *
 * Everything on this screen is live: passengers, departments, cost centres and
 * vehicle categories come from the organisation's own records, and submitting
 * calls the server routine that evaluates the spending policy and then either
 * creates the ride or raises an approval. The verdict shown after submitting is
 * the server's, never the browser's.
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, CheckCircle2, Clock, Loader2, Send } from "lucide-react";
import { AsyncState } from "@/components/dashboard/AsyncState";
import { toast } from "@/hooks/use-toast";
import { requestCorporateRide, type RideRequestResult } from "@/lib/corporateRides";
import { PaymentMethodChoice } from "@/components/corporate/PaymentMethodChoice";
import { TripPaymentStep } from "@/components/corporate/TripPaymentStep";
import type { PaymentMode } from "@/lib/corporate/payments";

interface Employee { id: string; email: string; full_name: string | null; user_id: string | null; department_id: string | null }
interface Department { id: string; name: string }
interface CostCenter { code: string; name: string }
interface RideType { id: string; name: string }

const money = (cents: number) => `KSh ${(cents / 100).toLocaleString("en-KE")}`;

export default function CorporateRequestRide({ corporateId }: { corporateId: string | null }) {
  const [emps, setEmps] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [rideTypes, setRideTypes] = useState<RideType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<RideRequestResult | null>(null);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>("CASH");
  const [submittedFareCents, setSubmittedFareCents] = useState(0);

  const [form, setForm] = useState({
    employee_id: "",
    pickup_address: "",
    dropoff_address: "",
    ride_type_id: "",
    when: "now" as "now" | "later",
    scheduled_for: "",
    passenger_count: "1",
    department_id: "",
    cost_center_code: "",
    purpose: "",
    estimate_kes: "",
  });

  const load = async () => {
    if (!corporateId) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const [e, d, c, r] = await Promise.all([
        supabase.from("corporate_employees")
          .select("id,email,full_name,user_id,department_id")
          .eq("corporate_id", corporateId).eq("status", "active")
          .not("user_id", "is", null).order("full_name"),
        supabase.from("corporate_departments")
          .select("id,name").eq("corporate_id", corporateId).eq("active", true).order("name"),
        supabase.from("cost_centers")
          .select("code,name").eq("corporate_id", corporateId).order("code"),
        supabase.from("ride_types").select("id,name").eq("is_active", true).order("sort_order"),
      ]);
      if (e.error) throw e.error;
      if (d.error) throw d.error;
      if (r.error) throw r.error;
      setEmps((e.data ?? []) as Employee[]);
      setDepartments((d.data ?? []) as Department[]);
      setCostCenters((c.data ?? []) as CostCenter[]);
      setRideTypes((r.data ?? []) as RideType[]);
    } catch (err) {
      setError((err as Error).message ?? "Failed to load booking data.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [corporateId]);

  const selectedEmployee = useMemo(
    () => emps.find((e) => e.id === form.employee_id) ?? null,
    [emps, form.employee_id],
  );
  const selectedRideType = useMemo(
    () => rideTypes.find((r) => r.id === form.ride_type_id) ?? null,
    [rideTypes, form.ride_type_id],
  );

  const fareCents = Math.round((parseFloat(form.estimate_kes) || 0) * 100);

  const submit = async () => {
    if (!corporateId) return;
    if (!form.employee_id || !form.pickup_address.trim() || !form.dropoff_address.trim()) {
      toast({ title: "Missing details", description: "Passenger, pickup and drop-off are required.", variant: "destructive" });
      return;
    }
    if (fareCents <= 0) {
      toast({ title: "Estimated value required", description: "Enter the expected trip value so policy can be applied.", variant: "destructive" });
      return;
    }
    if (form.when === "later" && !form.scheduled_for) {
      toast({ title: "Pick a date and time", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    setResult(null);
    setSubmittedFareCents(fareCents);
    try {
      const res = await requestCorporateRide({
        corporateId,
        employeeId: form.employee_id,
        rideType: selectedRideType?.name ?? "standard",
        rideTypeId: form.ride_type_id || null,
        pickupAddress: form.pickup_address.trim(),
        dropoffAddress: form.dropoff_address.trim(),
        fareCents,
        scheduledFor: form.when === "later" ? new Date(form.scheduled_for).toISOString() : null,
        passengerCount: parseInt(form.passenger_count, 10) || 1,
        departmentId: form.department_id || selectedEmployee?.department_id || null,
        costCenterCode: form.cost_center_code || null,
        purpose: form.purpose.trim() || null,
      });
      setResult(res);
      if (res.decision === "allow") {
        toast({ title: "Ride created", description: `Booking ${res.booking_number ?? ""} is in dispatch.` });
        setForm((f) => ({ ...f, pickup_address: "", dropoff_address: "", purpose: "", estimate_kes: "" }));
      } else if (res.decision === "requires_approval") {
        toast({ title: "Sent for approval", description: res.reason });
      } else {
        toast({ title: "Blocked by policy", description: res.reason, variant: "destructive" });
      }
    } catch (err) {
      toast({
        title: "Request failed",
        description: (err as Error).message ?? "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AsyncState loading={loading} error={error} onRetry={load}>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="p-5 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Passenger</Label>
              <Select value={form.employee_id} onValueChange={(v) => setForm({ ...form, employee_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select an active employee" /></SelectTrigger>
                <SelectContent>
                  {emps.map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.full_name || e.email}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {emps.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No active employees with a linked account yet. Invite staff under Staff first.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Pickup</Label>
              <Input value={form.pickup_address} onChange={(e) => setForm({ ...form, pickup_address: e.target.value })} placeholder="ABC Place, Westlands" />
            </div>
            <div className="space-y-1.5">
              <Label>Drop-off</Label>
              <Input value={form.dropoff_address} onChange={(e) => setForm({ ...form, dropoff_address: e.target.value })} placeholder="JKIA Terminal 1A" />
            </div>

            <div className="space-y-1.5">
              <Label>Vehicle category</Label>
              <Select value={form.ride_type_id} onValueChange={(v) => setForm({ ...form, ride_type_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {rideTypes.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Passengers</Label>
              <Input type="number" min="1" value={form.passenger_count} onChange={(e) => setForm({ ...form, passenger_count: e.target.value })} />
            </div>

            <div className="space-y-1.5">
              <Label>When</Label>
              <Select value={form.when} onValueChange={(v) => setForm({ ...form, when: v as "now" | "later" })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="now">As soon as possible</SelectItem>
                  <SelectItem value="later">Schedule for later</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.when === "later" && (
              <div className="space-y-1.5">
                <Label>Date &amp; time</Label>
                <Input type="datetime-local" value={form.scheduled_for} onChange={(e) => setForm({ ...form, scheduled_for: e.target.value })} />
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Department</Label>
              <Select value={form.department_id} onValueChange={(v) => setForm({ ...form, department_id: v })}>
                <SelectTrigger><SelectValue placeholder="Employee's department" /></SelectTrigger>
                <SelectContent>
                  {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Cost centre</Label>
              <Select value={form.cost_center_code} onValueChange={(v) => setForm({ ...form, cost_center_code: v })}>
                <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                <SelectContent>
                  {costCenters.map((c) => <SelectItem key={c.code} value={c.code}>{c.code} — {c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Estimated value (KSh)</Label>
              <Input type="number" min="1" step="1" value={form.estimate_kes} onChange={(e) => setForm({ ...form, estimate_kes: e.target.value })} placeholder="e.g. 4800" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Trip purpose / reference</Label>
              <Textarea rows={2} value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} placeholder="Client meeting — reference PO-2291" />
            </div>
          </div>

          {corporateId && fareCents > 0 ? (
            <PaymentMethodChoice
              corporateId={corporateId}
              amountCents={fareCents}
              onDecision={(d) => setPaymentMode(d.requested_mode ?? "CASH")}
            />
          ) : null}

          <div className="flex items-center justify-between gap-3 border-t pt-4">
            <p className="text-xs text-muted-foreground">
              Your organisation's spending policy is applied on submission. Trips over the limit go to your approver.
            </p>
            <Button onClick={submit} disabled={submitting} className="gap-2">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Submit request
            </Button>
          </div>
        </Card>

        <div className="space-y-4">
          <Card className="p-4 space-y-2">
            <h3 className="text-sm font-semibold">Request summary</h3>
            <dl className="text-sm space-y-1">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Passenger</dt>
                <dd className="text-right">{selectedEmployee ? (selectedEmployee.full_name || selectedEmployee.email) : "—"}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Category</dt>
                <dd className="text-right">{selectedRideType?.name ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Estimated value</dt>
                <dd className="text-right">{fareCents > 0 ? money(fareCents) : "—"}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Cost centre</dt>
                <dd className="text-right">{form.cost_center_code || "—"}</dd>
              </div>
            </dl>
          </Card>

          {result && (
            <Card className="p-4 space-y-2">
              <div className="flex items-center gap-2">
                {result.decision === "allow" && <Badge className="gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> Approved by policy</Badge>}
                {result.decision === "requires_approval" && <Badge variant="secondary" className="gap-1"><Clock className="h-3.5 w-3.5" /> Awaiting approval</Badge>}
                {result.decision === "block" && <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3.5 w-3.5" /> Blocked</Badge>}
              </div>
              <p className="text-sm text-muted-foreground">{result.reason}</p>
              {result.booking_number && (
                <p className="text-sm">Booking <span className="font-semibold">{result.booking_number}</span> is now in dispatch.</p>
              )}
              {result.decision === "requires_approval" && (
                <p className="text-sm">Your approver will see this under Trips → Approvals.</p>
              )}
            </Card>
          )}

          {corporateId && result?.decision === "allow" && result.booking_id && submittedFareCents > 0 && (
            <TripPaymentStep
              corporateId={corporateId}
              amountCents={submittedFareCents}
              bookingId={result.booking_id}
              requestedMode={paymentMode}
              idempotencyKey={`booking:${result.booking_id}`}
            />
          )}
        </div>
      </div>
    </AsyncState>
  );
}
