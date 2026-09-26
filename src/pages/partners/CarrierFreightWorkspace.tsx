/**
 * Carrier freight workspace — /partner/freight
 *
 * The supply side of Phase 5, scoped to the carrier organisations the signed-in
 * partner user belongs to. Row-level security and every operation re-check that
 * membership server-side: a carrier can only ever see and act on its own
 * invitations, quotations, awards, bookings, capacity and score.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertTriangle, Boxes, FileText, Gauge, RefreshCw, ShieldCheck, Truck } from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { useAuth } from "@/hooks/useAuth";
import {
  COMPLIANCE_REQUIREMENTS,
  availableKg,
  carrierComplianceState,
  carrierScorecard,
  listAwards,
  listBookings,
  listCapabilities,
  listCapacitySlots,
  listCarriers,
  listComplianceItems,
  listInvitations,
  listQuotations,
  listReservations,
  listRfqs,
  quoteTotalPreview,
  recordCompliance,
  respondToAward,
  respondToInvitation,
  saveCapability,
  saveCapacitySlot,
  slotOperationalState,
  submitQuote,
  transitionBooking,
  type AwardRow,
  type BookingRow,
  type CapabilityRow,
  type CapacitySlotRow,
  type CarrierProfileRow,
  type ComplianceItemRow,
  type ComplianceVerdict,
  type InvitationRow,
  type QuotationRow,
  type ReservationRow,
  type RfqRow,
} from "@/lib/logistics/procurement/procurementEngine";

const tone: Record<string, string> = {
  success: "bg-success/10 text-success border-success/30",
  info: "bg-info/10 text-info border-info/30",
  warning: "bg-warning/10 text-warning border-warning/30",
  danger: "bg-destructive/10 text-destructive border-destructive/30",
  muted: "bg-muted text-muted-foreground border-border",
};
const stateTone = (s: string) =>
  ["PASS", "AVAILABLE", "ACCEPTED", "COMPLETED", "VERIFIED", "AWARDED", "ACTIVE"].includes(s) ? tone.success
  : ["BLOCKED", "DECLINED", "CANCELLED", "FAILED", "EXPIRED", "REJECTED", "LEGAL_REVIEW_REQUIRED"].includes(s) ? tone.danger
  : ["PENDING_REVIEW", "OWNER_CONFIGURATION_REQUIRED", "RESERVED", "INVITED"].includes(s) ? tone.warning
  : tone.info;

const fmt = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("en-KE", { timeZone: "Africa/Nairobi", dateStyle: "medium", timeStyle: "short" }) : "—";
const money = (v?: number | null, ccy = "KES") =>
  v == null ? "—" : `${ccy} ${Number(v).toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;
const localInput = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString().slice(0, 16);

export default function CarrierFreightWorkspace() {
  const { user, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [carriers, setCarriers] = useState<CarrierProfileRow[]>([]);
  const [carrierId, setCarrierId] = useState<string>("");
  const [verdict, setVerdict] = useState<ComplianceVerdict | null>(null);
  const [score, setScore] = useState<Record<string, unknown> | null>(null);
  const [capabilities, setCapabilities] = useState<CapabilityRow[]>([]);
  const [complianceItems, setComplianceItems] = useState<ComplianceItemRow[]>([]);
  const [slots, setSlots] = useState<CapacitySlotRow[]>([]);
  const [reservations, setReservations] = useState<ReservationRow[]>([]);
  const [invitations, setInvitations] = useState<InvitationRow[]>([]);
  const [rfqs, setRfqs] = useState<RfqRow[]>([]);
  const [quotes, setQuotes] = useState<QuotationRow[]>([]);
  const [awards, setAwards] = useState<AwardRow[]>([]);
  const [bookings, setBookings] = useState<BookingRow[]>([]);

  const [quoteTarget, setQuoteTarget] = useState<RfqRow | null>(null);
  const [quoteForm, setQuoteForm] = useState({
    baseFreight: "", fuelSurcharge: "", waitingCharge: "", tollCharge: "", handlingCharge: "",
    loadingCharge: "", protectionCharge: "", taxAmount: "", discount: "",
    capacityKg: "", transitHours: "", sla: "", vehicleType: "", slotId: "",
    validUntil: localInput(72), conditions: "",
  });
  const [slotForm, setSlotForm] = useState({
    vehicleType: "", offeredKg: "", originAreaCode: "", destinationAreaCode: "",
    exclusive: false, from: localInput(1), until: localInput(72),
  });
  const [capForm, setCapForm] = useState({ vehicleType: "", maxPayloadKg: "", crossBorder: false, temperature: false });
  const [docForm, setDocForm] = useState({
    requirementCode: COMPLIANCE_REQUIREMENTS[0].code, referenceNumber: "", issuingAuthority: "",
    expiresOn: "", evidencePath: "",
  });
  const [declineTarget, setDeclineTarget] = useState<{ kind: "invitation" | "award"; id: string; rfqId?: string; label: string } | null>(null);
  const [declineReason, setDeclineReason] = useState("");

  const loadCarriers = useCallback(async () => {
    try {
      const rows = await listCarriers();
      setCarriers(rows);
      setCarrierId((prev) => prev || rows[0]?.id || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your carrier organisations.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCarrierData = useCallback(async (id: string) => {
    if (!id) return;
    setLoading(true);
    try {
      const [v, sc, cap, comp, sl, res, inv, r, q, aw, bk] = await Promise.all([
        carrierComplianceState(id), carrierScorecard(id), listCapabilities(id), listComplianceItems(id),
        listCapacitySlots(id), listReservations(id), listInvitations(undefined, id), listRfqs(),
        listQuotations(undefined, id), listAwards(id), listBookings(id),
      ]);
      setVerdict(v); setScore(sc); setCapabilities(cap); setComplianceItems(comp);
      setSlots(sl); setReservations(res); setInvitations(inv); setRfqs(r);
      setQuotes(q); setAwards(aw); setBookings(bk);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your freight workspace.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadCarriers(); }, [loadCarriers]);
  useEffect(() => { if (carrierId) void loadCarrierData(carrierId); }, [carrierId, loadCarrierData]);

  const act = async (key: string, fn: () => Promise<{ ok: boolean; code?: string; message?: string }>, ok: string) => {
    setBusy(key);
    try {
      const res = await fn();
      if (!res.ok) { toast.error(res.message ?? res.code ?? "The operation was refused."); return null; }
      toast.success(ok);
      await loadCarrierData(carrierId);
      return res;
    } finally { setBusy(null); }
  };

  const openInvitations = useMemo(
    () => invitations.filter((i) => ["INVITED", "VIEWED"].includes(i.state)),
    [invitations],
  );
  const rfqFor = useCallback((id: string) => rfqs.find((r) => r.id === id), [rfqs]);
  const preview = quoteTotalPreview({
    base_freight: Number(quoteForm.baseFreight || 0),
    fuel_surcharge: Number(quoteForm.fuelSurcharge || 0),
    waiting_charge: Number(quoteForm.waitingCharge || 0),
    toll_charge: Number(quoteForm.tollCharge || 0),
    handling_charge: Number(quoteForm.handlingCharge || 0),
    loading_charge: Number(quoteForm.loadingCharge || 0),
    protection_charge: Number(quoteForm.protectionCharge || 0),
    discount: Number(quoteForm.discount || 0),
    tax_amount: Number(quoteForm.taxAmount || 0),
  });

  if (authLoading || (loading && carriers.length === 0 && !error)) {
    return <div className="mx-auto max-w-6xl space-y-4 p-6"><Skeleton className="h-10 w-80" /><Skeleton className="h-64 w-full" /></div>;
  }

  if (!user) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <Helmet><title>Carrier freight workspace | SAFARID Partners</title></Helmet>
        <Card className="p-8 text-center">
          <h1 className="text-xl font-semibold">Sign in to your carrier account</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Freight invitations, quotations and capacity are scoped to your carrier organisation.
          </p>
          <Button asChild className="mt-4"><Link to="/auth">Sign in</Link></Button>
        </Card>
      </main>
    );
  }

  if (carriers.length === 0) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <Helmet>
          <title>Carrier freight workspace | SAFARID Partners</title>
          <meta name="description" content="Respond to freight tenders, quote, manage capacity and track awarded jobs as a SAFARID carrier partner." />
        </Helmet>
        <Card className="p-8">
          <h1 className="text-xl font-semibold">No carrier organisation is linked to your account</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Freight sourcing is open to onboarded carrier partners. Apply through SAFARID Partners and the integration
            desk will link your organisation, after which invitations appear here.
          </p>
          <div className="mt-4 flex gap-2">
            <Button data-analytics="carrier_freight_apply" asChild><Link to="/partners/apply">Apply as a carrier</Link></Button>
            <Button asChild variant="outline"><Link to="/partner/workspace">Partner workspace</Link></Button>
          </div>
        </Card>
      </main>
    );
  }

  const carrier = carriers.find((c) => c.id === carrierId);

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-6">
      <Helmet>
        <title>Carrier freight workspace | SAFARID Partners</title>
        <meta name="description" content="Respond to freight tenders, submit quotations, publish capacity and manage awarded jobs as a SAFARID carrier partner." />
        <link rel="canonical" href="https://yalla.africa/partner/freight" />
      </Helmet>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Truck className="h-6 w-6 text-primary" aria-hidden /> Carrier freight workspace
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Your invitations, quotations, awarded jobs, capacity and performance — all scoped to your organisation.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {carriers.length > 1 && (
            <Select value={carrierId} onValueChange={setCarrierId}>
              <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
              <SelectContent>{carriers.map((c) => <SelectItem key={c.id} value={c.id}>{c.legal_entity_name}</SelectItem>)}</SelectContent>
            </Select>
          )}
          <Button variant="outline" onClick={() => void loadCarrierData(carrierId)}>
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden /> Refresh
          </Button>
        </div>
      </header>

      {error && <Alert variant="destructive"><AlertTriangle className="h-4 w-4" aria-hidden /><AlertDescription>{error}</AlertDescription></Alert>}

      {verdict && verdict.state !== "PASS" && (
        <Alert>
          <ShieldCheck className="h-4 w-4" aria-hidden />
          <AlertDescription className="text-sm">
            <strong>Compliance: {verdict.state}</strong>
            {verdict.blocking.length > 0 && (
              <> — {verdict.blocking.map((b) => b.code + (b.requirement ? ` (${b.requirement})` : "")).join(", ")}.</>
            )}{" "}
            You may quote, but SAFARID cannot award work until this clears.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {[
          { label: "Open invitations", value: openInvitations.length },
          { label: "Live quotations", value: quotes.filter((q) => q.state === "SUBMITTED").length },
          { label: "Awarded jobs", value: awards.filter((a) => a.status === "AWARDED").length },
          { label: "Capacity free", value: `${slots.filter((s) => s.availability_status === "AVAILABLE").reduce((n, s) => n + availableKg(s), 0).toLocaleString()} kg` },
          { label: "Reliability", value: score?.reliability_score == null ? "—" : String(score.reliability_score) },
        ].map((m) => (
          <Card key={m.label} className="p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{m.label}</p>
            <p className="mt-1 text-2xl font-semibold">{m.value}</p>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="tenders">
        <TabsList className="flex-wrap">
          <TabsTrigger value="tenders">Invitations &amp; quotes</TabsTrigger>
          <TabsTrigger value="jobs">Awards &amp; jobs</TabsTrigger>
          <TabsTrigger value="capacity">Capacity</TabsTrigger>
          <TabsTrigger value="profile">Capability &amp; documents</TabsTrigger>
          <TabsTrigger value="performance">Performance &amp; settlement</TabsTrigger>
        </TabsList>

        {/* ------------------------------------------------ tenders */}
        <TabsContent value="tenders" className="space-y-4">
          <Card className="p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Freight invitations</h2>
            {invitations.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No tender invitations yet.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-muted-foreground">
                    <tr><th className="py-2">Tender</th><th>Lane</th><th>Deadline</th><th>Status</th><th className="text-right">Actions</th></tr>
                  </thead>
                  <tbody>
                    {invitations.map((i) => {
                      const r = rfqFor(i.rfq_id);
                      const mine = quotes.find((q) => q.rfq_id === i.rfq_id && ["SUBMITTED", "ACCEPTED"].includes(q.state));
                      return (
                        <tr key={i.id} className="border-t">
                          <td className="py-2">
                            <p className="font-medium">{r?.title ?? "Tender"}</p>
                            <p className="font-mono text-xs text-muted-foreground">{r?.rfq_number ?? i.rfq_id.slice(0, 8)}</p>
                          </td>
                          <td className="text-xs">{r?.sourcing_mode === "SINGLE" ? "Direct award sourcing" : "Competitive tender"}</td>
                          <td className="text-xs">{fmt(r?.response_deadline)}</td>
                          <td>
                            <Badge variant="outline" className={stateTone(i.state)}>{i.state}</Badge>
                            {mine && <Badge variant="outline" className={`ml-2 ${tone.info}`}>{money(mine.total, mine.currency)}</Badge>}
                          </td>
                          <td className="space-x-1 text-right">
                            <Button size="sm" variant="outline"
                              disabled={!r || !["OPEN", "RESPONSES_RECEIVED"].includes(r.state)}
                              title={r && ["OPEN", "RESPONSES_RECEIVED"].includes(r.state) ? "Submit a quotation" : "This tender is not accepting quotations"}
                              onClick={async () => {
                                if (!r) return;
                                await respondToInvitation(r.id, carrierId, "VIEW");
                                setQuoteTarget(r);
                                setQuoteForm((f) => ({ ...f, capacityKg: f.capacityKg || "", validUntil: localInput(72) }));
                              }}>
                              {mine ? "Revise quote" : "Quote"}
                            </Button>
                            {i.state !== "DECLINED" && i.state !== "RESPONDED" && (
                              <Button size="sm" variant="ghost" className="text-destructive"
                                onClick={() => { setDeclineTarget({ kind: "invitation", id: i.id, rfqId: i.rfq_id, label: r?.rfq_number ?? "" }); setDeclineReason(""); }}>
                                Decline
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Your quotations</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              A submitted quotation is a commercial commitment: its money is frozen. Revising it issues a new version
              and supersedes the old one, so the history stays reconstructable.
            </p>
            {quotes.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No quotations submitted yet.</p>
            ) : (
              <table className="mt-3 w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr><th className="py-2">Quote</th><th>Tender</th><th>Total</th><th>Capacity</th><th>Valid until</th><th>State</th></tr>
                </thead>
                <tbody>
                  {quotes.map((q) => (
                    <tr key={q.id} className="border-t">
                      <td className="py-2 font-mono text-xs">{q.quote_number} v{q.version}</td>
                      <td className="text-xs">{rfqFor(q.rfq_id)?.rfq_number ?? "—"}</td>
                      <td>{money(q.total, q.currency)}</td>
                      <td>{Number(q.capacity_offered_kg).toLocaleString()} kg</td>
                      <td className="text-xs">{fmt(q.valid_until)}</td>
                      <td><Badge variant="outline" className={stateTone(q.state)}>{q.state}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </TabsContent>

        {/* ------------------------------------------------ jobs */}
        <TabsContent value="jobs" className="space-y-4">
          <Card className="p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Awarded jobs</h2>
            {bookings.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No awarded jobs yet.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-muted-foreground">
                    <tr><th className="py-2">Job</th><th>Agreed</th><th>Pickup</th><th>Delivery</th><th>State</th><th className="text-right">Actions</th></tr>
                  </thead>
                  <tbody>
                    {bookings.map((b) => (
                      <tr key={b.id} className="border-t">
                        <td className="py-2 font-mono text-xs">{b.booking_number}</td>
                        <td>{money(b.agreed_total, b.currency)}</td>
                        <td className="text-xs">{fmt(b.planned_pickup)}</td>
                        <td className="text-xs">{fmt(b.planned_delivery)}</td>
                        <td><Badge variant="outline" className={stateTone(b.state)}>{b.state}</Badge></td>
                        <td className="space-x-1 text-right">
                          {["CREATED", "CARRIER_ASSIGNED"].includes(b.state) && !b.carrier_accepted_at && (
                            <>
                              <Button size="sm" disabled={busy === `ac-${b.id}`}
                                onClick={() => void act(`ac-${b.id}`, () => respondToAward(b.id, "ACCEPT"), "Award accepted.")}>
                                Accept
                              </Button>
                              <Button size="sm" variant="ghost" className="text-destructive"
                                onClick={() => { setDeclineTarget({ kind: "award", id: b.id, label: b.booking_number }); setDeclineReason(""); }}>
                                Decline
                              </Button>
                            </>
                          )}
                          {b.state === "DISPATCHED" && (
                            <Button size="sm" variant="outline" disabled={busy === `st-${b.id}`}
                              onClick={() => void act(`st-${b.id}`, () => transitionBooking(b.id, "EXECUTING"), "Job started.")}>
                              Start job
                            </Button>
                          )}
                          {b.state === "EXECUTING" && (
                            <Button size="sm" variant="outline" disabled={busy === `fi-${b.id}`}
                              onClick={() => void act(`fi-${b.id}`, () => transitionBooking(b.id, "COMPLETED"), "Job completed.")}>
                              Complete
                            </Button>
                          )}
                          {b.carrier_accepted_at && !["CANCELLED", "FAILED"].includes(b.state) && (
                            <span className="text-xs text-muted-foreground">accepted {fmt(b.carrier_accepted_at)}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Award record</h2>
            {awards.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No awards recorded.</p>
            ) : (
              <table className="mt-3 w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr><th className="py-2">Award</th><th>Total</th><th>Status</th><th>Awarded</th></tr>
                </thead>
                <tbody>
                  {awards.map((a) => (
                    <tr key={a.id} className="border-t">
                      <td className="py-2 font-mono text-xs">{a.award_number}</td>
                      <td>{money(a.awarded_total, a.currency)}</td>
                      <td><Badge variant="outline" className={stateTone(a.status)}>{a.status}</Badge></td>
                      <td className="text-xs">{fmt(a.awarded_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </TabsContent>

        {/* ------------------------------------------------ capacity */}
        <TabsContent value="capacity" className="space-y-4">
          <Card className="p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              <Boxes className="h-4 w-4" aria-hidden /> Publish capacity
            </h2>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <Input placeholder="Vehicle type" value={slotForm.vehicleType} onChange={(e) => setSlotForm((f) => ({ ...f, vehicleType: e.target.value }))} />
              <Input type="number" placeholder="Offered kg" value={slotForm.offeredKg} onChange={(e) => setSlotForm((f) => ({ ...f, offeredKg: e.target.value }))} />
              <Input placeholder="Origin area code" value={slotForm.originAreaCode} onChange={(e) => setSlotForm((f) => ({ ...f, originAreaCode: e.target.value }))} />
              <Input placeholder="Destination area code" value={slotForm.destinationAreaCode} onChange={(e) => setSlotForm((f) => ({ ...f, destinationAreaCode: e.target.value }))} />
              <Input type="datetime-local" value={slotForm.from} onChange={(e) => setSlotForm((f) => ({ ...f, from: e.target.value }))} />
              <Input type="datetime-local" value={slotForm.until} onChange={(e) => setSlotForm((f) => ({ ...f, until: e.target.value }))} />
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={slotForm.exclusive} onCheckedChange={(v) => setSlotForm((f) => ({ ...f, exclusive: v }))} />
                Exclusive vehicle
              </label>
            </div>
            <Button className="mt-3" disabled={busy === "slot"} onClick={() => {
              if (!slotForm.vehicleType.trim() || !Number(slotForm.offeredKg)) return toast.error("Vehicle type and capacity are required.");
              void act("slot", () => saveCapacitySlot({
                carrierId, vehicleType: slotForm.vehicleType.trim(), offeredKg: Number(slotForm.offeredKg),
                originAreaCode: slotForm.originAreaCode.trim() || undefined,
                destinationAreaCode: slotForm.destinationAreaCode.trim() || undefined,
                exclusiveVehicle: slotForm.exclusive,
                effectiveFrom: new Date(slotForm.from).toISOString(),
                effectiveUntil: new Date(slotForm.until).toISOString(),
              }), "Capacity published.");
            }}>Publish capacity</Button>
          </Card>

          <Card className="p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Your capacity</h2>
            {slots.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No capacity published. SAFARID can only award work against published capacity.</p>
            ) : (
              <table className="mt-3 w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr><th className="py-2">Slot</th><th>Type</th><th>Offered</th><th>Reserved</th><th>Committed</th><th>Free</th><th>State</th><th>Window</th></tr>
                </thead>
                <tbody>
                  {slots.map((s) => (
                    <tr key={s.id} className="border-t">
                      <td className="py-2 font-mono text-xs">{s.slot_reference}</td>
                      <td>{s.vehicle_type}</td>
                      <td>{Number(s.offered_kg).toLocaleString()}</td>
                      <td>{Number(s.reserved_kg).toLocaleString()}</td>
                      <td>{Number(s.committed_kg).toLocaleString()}</td>
                      <td className="font-semibold">{availableKg(s).toLocaleString()}</td>
                      <td><Badge variant="outline" className={stateTone(slotOperationalState(s))}>{slotOperationalState(s)}</Badge></td>
                      <td className="text-xs">{fmt(s.effective_from)} → {fmt(s.effective_until)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {reservations.length > 0 && (
              <>
                <Separator className="my-4" />
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Reservations held against your capacity</p>
                <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                  {reservations.map((r) => (
                    <li key={r.id}>
                      <span className="font-mono">{r.reservation_reference}</span> — {Number(r.qty_kg).toLocaleString()} kg,
                      {" "}{r.state}, expires {fmt(r.expires_at)}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>
        </TabsContent>

        {/* ------------------------------------------------ profile */}
        <TabsContent value="profile" className="space-y-4">
          <Card className="p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Declare capability</h2>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <Input placeholder="Vehicle type" value={capForm.vehicleType} onChange={(e) => setCapForm((f) => ({ ...f, vehicleType: e.target.value }))} />
              <Input type="number" placeholder="Max payload (kg)" value={capForm.maxPayloadKg} onChange={(e) => setCapForm((f) => ({ ...f, maxPayloadKg: e.target.value }))} />
              <div className="space-y-1 text-sm">
                <label className="flex items-center gap-2"><Switch checked={capForm.crossBorder} onCheckedChange={(v) => setCapForm((f) => ({ ...f, crossBorder: v }))} /> Cross-border</label>
                <label className="flex items-center gap-2"><Switch checked={capForm.temperature} onCheckedChange={(v) => setCapForm((f) => ({ ...f, temperature: v }))} /> Temperature controlled</label>
              </div>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Hazardous-goods capability is not self-declared: it requires an authority reference recorded by the
              SAFARID compliance desk.
            </p>
            <Button className="mt-3" disabled={busy === "cap"} onClick={() => {
              if (!capForm.vehicleType.trim() || !Number(capForm.maxPayloadKg)) return toast.error("Vehicle type and payload are required.");
              void act("cap", () => saveCapability({
                carrierId, vehicleType: capForm.vehicleType.trim(), maxPayloadKg: Number(capForm.maxPayloadKg),
                crossBorderCapable: capForm.crossBorder, temperatureControlled: capForm.temperature,
              }), "Capability saved.");
            }}>Save capability</Button>

            {capabilities.length > 0 && (
              <table className="mt-4 w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr><th className="py-2">Vehicle type</th><th>Max payload</th><th>Cross-border</th><th>Temperature</th><th>Container</th></tr>
                </thead>
                <tbody>
                  {capabilities.map((c) => (
                    <tr key={c.id} className="border-t">
                      <td className="py-2">{c.vehicle_type}</td>
                      <td>{Number(c.max_payload_kg).toLocaleString()} kg</td>
                      <td>{c.cross_border_capable ? "yes" : "no"}</td>
                      <td>{c.temperature_controlled ? "yes" : "no"}</td>
                      <td>{c.container_capable ? "yes" : "no"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              <FileText className="h-4 w-4" aria-hidden /> Submit compliance document
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Submitted evidence is reviewed by SAFARID. A carrier can never mark its own document verified.
            </p>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <Select value={docForm.requirementCode} onValueChange={(v) => setDocForm((f) => ({ ...f, requirementCode: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{COMPLIANCE_REQUIREMENTS.map((r) => <SelectItem key={r.code} value={r.code}>{r.label}</SelectItem>)}</SelectContent>
              </Select>
              <Input placeholder="Reference number" value={docForm.referenceNumber} onChange={(e) => setDocForm((f) => ({ ...f, referenceNumber: e.target.value }))} />
              <Input placeholder="Issuing authority" value={docForm.issuingAuthority} onChange={(e) => setDocForm((f) => ({ ...f, issuingAuthority: e.target.value }))} />
              <Input type="date" value={docForm.expiresOn} onChange={(e) => setDocForm((f) => ({ ...f, expiresOn: e.target.value }))} />
              <Input placeholder="Evidence storage path" value={docForm.evidencePath} onChange={(e) => setDocForm((f) => ({ ...f, evidencePath: e.target.value }))} />
            </div>
            <Button className="mt-3" disabled={busy === "doc"} onClick={() => {
              const meta = COMPLIANCE_REQUIREMENTS.find((r) => r.code === docForm.requirementCode)!;
              if (!docForm.referenceNumber.trim()) return toast.error("A reference number is required.");
              void act("doc", () => recordCompliance({
                carrierId, requirementCode: meta.code, requirementLabel: meta.label, category: meta.category,
                state: "PENDING_REVIEW", referenceNumber: docForm.referenceNumber.trim(),
                issuingAuthority: docForm.issuingAuthority.trim() || undefined,
                expiresOn: docForm.expiresOn || undefined,
                evidenceStoragePath: docForm.evidencePath.trim() || undefined,
              }), "Document submitted for review.");
            }}>Submit for review</Button>

            {complianceItems.length > 0 && (
              <table className="mt-4 w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr><th className="py-2">Requirement</th><th>State</th><th>Reference</th><th>Expires</th></tr>
                </thead>
                <tbody>
                  {complianceItems.map((i) => (
                    <tr key={i.id} className="border-t">
                      <td className="py-2">{i.requirement_label}</td>
                      <td><Badge variant="outline" className={stateTone(i.state)}>{i.state}</Badge></td>
                      <td className="text-xs">{i.reference_number ?? "—"}</td>
                      <td className="text-xs">{i.expires_on ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </TabsContent>

        {/* ------------------------------------------------ performance */}
        <TabsContent value="performance">
          <Card className="p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              <Gauge className="h-4 w-4" aria-hidden /> Performance
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Measured from your real jobs, deliveries, proof of delivery and exceptions. These figures are read-only.
            </p>
            <div className="mt-4 grid gap-4 md:grid-cols-3 xl:grid-cols-4">
              {[
                ["Tender response rate", "tender_response_rate_pct"],
                ["Acceptance rate", "acceptance_rate_pct"],
                ["On-time delivery", "on_time_delivery_pct"],
                ["Cancellation rate", "cancellation_rate_pct"],
                ["Failure rate", "failure_rate_pct"],
                ["POD compliance", "pod_compliance_pct"],
                ["Exception rate", "exception_rate_pct"],
                ["Reliability score", "reliability_score"],
              ].map(([label, key]) => (
                <div key={key} className="rounded-md border p-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
                  <p className="mt-1 text-xl font-semibold">
                    {score?.[key] == null ? "—" : `${score[key]}${key === "reliability_score" ? "" : "%"}`}
                  </p>
                </div>
              ))}
            </div>

            <Separator className="my-5" />
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Settlement terms</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {carrier
                ? `Payment terms ${carrier.payment_terms_days} days, settled in ${carrier.settlement_currency}. Contract status: ${carrier.contract_status}.`
                : "—"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Completed jobs post their agreed and actual amounts into the freight price lineage, which is what SAFARID
              finance reconciles and settles against. Invoices are never adjusted without an adjustment record.
            </p>
          </Card>
        </TabsContent>
      </Tabs>

      {/* -------------------------------------------------- quote dialog */}
      <Dialog open={!!quoteTarget} onOpenChange={(o) => !o && setQuoteTarget(null)}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader><DialogTitle>Quote — {quoteTarget?.title}</DialogTitle></DialogHeader>
          <div className="grid gap-3 md:grid-cols-3">
            {([
              ["Base freight", "baseFreight"], ["Fuel surcharge", "fuelSurcharge"], ["Waiting", "waitingCharge"],
              ["Tolls", "tollCharge"], ["Handling", "handlingCharge"], ["Loading/unloading", "loadingCharge"],
              ["Protection", "protectionCharge"], ["Discount", "discount"], ["Tax", "taxAmount"],
            ] as const).map(([label, key]) => (
              <div key={key} className="space-y-1">
                <Label htmlFor={`q-${key}`}>{label}</Label>
                <Input id={`q-${key}`} type="number" value={quoteForm[key]}
                  onChange={(e) => setQuoteForm((f) => ({ ...f, [key]: e.target.value }))} />
              </div>
            ))}
            <div className="space-y-1"><Label htmlFor="q-cap">Capacity offered (kg)</Label>
              <Input id="q-cap" type="number" value={quoteForm.capacityKg} onChange={(e) => setQuoteForm((f) => ({ ...f, capacityKg: e.target.value }))} /></div>
            <div className="space-y-1"><Label htmlFor="q-tt">Transit time (hours)</Label>
              <Input id="q-tt" type="number" value={quoteForm.transitHours} onChange={(e) => setQuoteForm((f) => ({ ...f, transitHours: e.target.value }))} /></div>
            <div className="space-y-1"><Label htmlFor="q-valid">Valid until</Label>
              <Input id="q-valid" type="datetime-local" value={quoteForm.validUntil} onChange={(e) => setQuoteForm((f) => ({ ...f, validUntil: e.target.value }))} /></div>
            <div className="space-y-1"><Label htmlFor="q-sla">SLA committed</Label>
              <Input id="q-sla" value={quoteForm.sla} onChange={(e) => setQuoteForm((f) => ({ ...f, sla: e.target.value }))} placeholder="Next-day by 17:00" /></div>
            <div className="space-y-1"><Label htmlFor="q-vt">Vehicle type</Label>
              <Input id="q-vt" value={quoteForm.vehicleType} onChange={(e) => setQuoteForm((f) => ({ ...f, vehicleType: e.target.value }))} /></div>
            <div className="space-y-1">
              <Label>Capacity slot</Label>
              <Select value={quoteForm.slotId} onValueChange={(v) => setQuoteForm((f) => ({ ...f, slotId: v }))}>
                <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                <SelectContent>
                  {slots.filter((s) => s.availability_status === "AVAILABLE").map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.slot_reference} · {availableKg(s).toLocaleString()} kg free</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 md:col-span-3">
              <Label htmlFor="q-cond">Conditions</Label>
              <Textarea id="q-cond" rows={2} value={quoteForm.conditions} onChange={(e) => setQuoteForm((f) => ({ ...f, conditions: e.target.value }))} />
            </div>
          </div>
          <div className="rounded-md border p-3 text-sm">
            Subtotal <strong>{money(preview.subtotal)}</strong> · Total <strong>{money(preview.total)}</strong>
            <p className="text-xs text-muted-foreground">The server recomputes this total; the figure it stores is authoritative.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setQuoteTarget(null)}>Cancel</Button>
            <Button
              disabled={busy === "quote"}
              onClick={async () => {
                if (!quoteTarget) return;
                if (!Number(quoteForm.baseFreight)) return toast.error("Enter the base freight.");
                if (!Number(quoteForm.capacityKg)) return toast.error("State the capacity you are offering.");
                const res = await act("quote", () => submitQuote({
                  rfqId: quoteTarget.id, carrierId, baseFreight: Number(quoteForm.baseFreight),
                  capacityOfferedKg: Number(quoteForm.capacityKg),
                  validUntil: new Date(quoteForm.validUntil).toISOString(),
                  fuelSurcharge: Number(quoteForm.fuelSurcharge || 0),
                  waitingCharge: Number(quoteForm.waitingCharge || 0),
                  tollCharge: Number(quoteForm.tollCharge || 0),
                  handlingCharge: Number(quoteForm.handlingCharge || 0),
                  loadingCharge: Number(quoteForm.loadingCharge || 0),
                  protectionCharge: Number(quoteForm.protectionCharge || 0),
                  discount: Number(quoteForm.discount || 0),
                  taxAmount: Number(quoteForm.taxAmount || 0),
                  transitTimeHours: quoteForm.transitHours ? Number(quoteForm.transitHours) : undefined,
                  slaCommitted: quoteForm.sla.trim() || undefined,
                  vehicleType: quoteForm.vehicleType.trim() || undefined,
                  capacitySlotId: quoteForm.slotId || undefined,
                  conditions: quoteForm.conditions.trim() || undefined,
                }), "Quotation submitted.");
                if (res?.ok) setQuoteTarget(null);
              }}
            >
              Submit quotation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* -------------------------------------------------- decline dialog */}
      <Dialog open={!!declineTarget} onOpenChange={(o) => !o && setDeclineTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Decline {declineTarget?.kind === "award" ? "award" : "invitation"}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            {declineTarget?.label} — a reason is required and is recorded against your tender-response record.
            {declineTarget?.kind === "award" && " Declining releases the capacity SAFARID reserved with you."}
          </p>
          <Textarea rows={3} value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} placeholder="Reason" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeclineTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={busy === "decline"}
              onClick={async () => {
                if (!declineTarget) return;
                if (!declineReason.trim()) return toast.error("A reason is required.");
                const res = declineTarget.kind === "award"
                  ? await act("decline", () => respondToAward(declineTarget.id, "DECLINE", declineReason.trim()), "Award declined; capacity released.")
                  : await act("decline", () => respondToInvitation(declineTarget.rfqId!, carrierId, "DECLINE", declineReason.trim()), "Invitation declined.");
                if (res?.ok) setDeclineTarget(null);
              }}
            >
              Decline
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
