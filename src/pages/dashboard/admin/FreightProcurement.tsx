/**
 * Freight Procurement Control Tower — /dashboard/admin/freight-procurement
 *
 * Operates the Phase 5 transaction: demand → RFQ → tender → carrier bids →
 * comparison → award → capacity reservation → booking → existing route,
 * vehicle and driver → dispatch → completion → freight price lineage.
 *
 * Every control here calls an authoritative database operation. Capacity is
 * never computed in this file; award readiness is explained here but decided
 * by the server, which refuses anything this screen would have allowed.
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
import {
  AlertTriangle, Boxes, ClipboardList, Gavel, PackageSearch, RefreshCw, ShieldCheck, Truck,
} from "lucide-react";
import { toast } from "sonner";
import { COMPLIANCE_REQUIREMENTS, attachExecution, availableKg, awardBlockers, awardTender, bidComparison, capacitySearch, carrierComplianceState, carrierScorecard, createBooking, createRequirement, createRfq, inviteCarriers, issueRfq, listAttachableRoutes, listAwards, listBookings, listCapacitySlots, listCarriers, listComplianceItems, listFleetVehicles, listLineage, listPartnersForCarrier, listProcurementAudit, listQuotations, listRequirements, listReservations, listRfqs, listTenderPolicies, recordCompliance, saveCapability, saveCapacitySlot, saveCarrier, saveServiceArea, slotOperationalState, transitionBooking, transitionCapacity, type AwardRow, type BidComparison, type BookingRow, type CapacitySearchResult, type CapacitySlotRow, type CarrierProfileRow, type ComplianceItemRow, type ComplianceVerdict, type LineageRow, type QuotationRow, type RequirementRow, type ReservationRow, type RfqRow } from "@/lib/logistics/procurement/procurementEngine";

const tone: Record<string, string> = {
  success: "bg-success/10 text-success border-success/30",
  info: "bg-info/10 text-info border-info/30",
  warning: "bg-warning/10 text-warning border-warning/30",
  danger: "bg-destructive/10 text-destructive border-destructive/30",
  muted: "bg-muted text-muted-foreground border-border",
};

const stateTone = (s: string) =>
  ["PASS", "AVAILABLE", "AWARDED", "COMPLETED", "ACTIVE", "VERIFIED", "SIGNED"].includes(s) ? tone.success
  : ["BLOCKED", "CANCELLED", "FAILED", "EXPIRED", "REJECTED", "LEGAL_REVIEW_REQUIRED"].includes(s) ? tone.danger
  : ["OWNER_CONFIGURATION_REQUIRED", "PENDING_REVIEW", "RESERVED", "SOURCING", "OPEN", "RESPONSES_RECEIVED"].includes(s) ? tone.warning
  : tone.info;

const fmt = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("en-KE", { timeZone: "Africa/Nairobi", dateStyle: "medium", timeStyle: "short" }) : "—";
const money = (v: number | null | undefined, ccy = "KES") =>
  v == null ? "—" : `${ccy} ${Number(v).toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;

const nowLocal = (offsetHours = 0) =>
  new Date(Date.now() + offsetHours * 3_600_000).toISOString().slice(0, 16);

export default function FreightProcurement() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [carriers, setCarriers] = useState<CarrierProfileRow[]>([]);
  const [partners, setPartners] = useState<{ id: string; partner_code: string; legal_name: string }[]>([]);
  const [compliance, setCompliance] = useState<ComplianceItemRow[]>([]);
  const [slots, setSlots] = useState<CapacitySlotRow[]>([]);
  const [reservations, setReservations] = useState<ReservationRow[]>([]);
  const [requirements, setRequirements] = useState<RequirementRow[]>([]);
  const [rfqs, setRfqs] = useState<RfqRow[]>([]);
  const [quotes, setQuotes] = useState<QuotationRow[]>([]);
  const [awards, setAwards] = useState<AwardRow[]>([]);
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [lineage, setLineage] = useState<LineageRow[]>([]);
  const [audit, setAudit] = useState<Awaited<ReturnType<typeof listProcurementAudit>>>([]);
  const [policies, setPolicies] = useState<Awaited<ReturnType<typeof listTenderPolicies>>>([]);
  const [routes, setRoutes] = useState<Awaited<ReturnType<typeof listAttachableRoutes>>>([]);
  const [vehicles, setVehicles] = useState<Awaited<ReturnType<typeof listFleetVehicles>>>([]);

  const [verdicts, setVerdicts] = useState<Record<string, ComplianceVerdict>>({});
  const [scores, setScores] = useState<Record<string, Record<string, unknown>>>({});
  const [search, setSearch] = useState<CapacitySearchResult | null>(null);
  const [comparison, setComparison] = useState<BidComparison | null>(null);
  const [selectedRfq, setSelectedRfq] = useState<string>("");
  const [selectedRequirement, setSelectedRequirement] = useState<string>("");
  const [awardTarget, setAwardTarget] = useState<{ rfqId: string; quotationId: string; label: string; blockers: string[] } | null>(null);
  const [awardNote, setAwardNote] = useState("");
  const [resourceTarget, setResourceTarget] = useState<BookingRow | null>(null);
  const [resourceForm, setResourceForm] = useState({ routeId: "", vehicleId: "", driverUserId: "" });

  const [carrierForm, setCarrierForm] = useState({
    partnerId: "", legalEntityName: "", operatingStatus: "ONBOARDING", contractStatus: "NONE",
    paymentTermsDays: 30, corridors: "", countries: "KE", categories: "",
  });
  const [capForm, setCapForm] = useState({
    carrierId: "", vehicleType: "", maxPayloadKg: "", crossBorder: false, temperature: false, container: false, lineHaul: false,
  });
  const [areaForm, setAreaForm] = useState({ carrierId: "", areaKind: "CITY", areaCode: "", areaLabel: "", direction: "BOTH" });
  const [compForm, setCompForm] = useState({
    carrierId: "", requirementCode: COMPLIANCE_REQUIREMENTS[0].code, referenceNumber: "",
    issuingAuthority: "", expiresOn: "", evidencePath: "", state: "PENDING_REVIEW" as ComplianceItemRow["state"],
    legalReviewReason: "",
  });
  const [slotForm, setSlotForm] = useState({
    carrierId: "", vehicleId: "", vehicleType: "", offeredKg: "", originAreaCode: "", destinationAreaCode: "",
    exclusiveVehicle: false, from: nowLocal(1), until: nowLocal(72),
  });
  const [reqForm, setReqForm] = useState({
    originLabel: "", originAreaCode: "", destinationLabel: "", destinationAreaCode: "",
    pickupStart: nowLocal(4), pickupEnd: nowLocal(8), deliveryEnd: nowLocal(30),
    weightKg: "", packageCount: "1", vehicleType: "", targetBudget: "", crossBorder: false,
    temperature: false, isTest: false, instructions: "",
  });
  const [rfqForm, setRfqForm] = useState({ requirementId: "", title: "", deadline: nowLocal(24), sourcingMode: "MULTI", notes: "" });
  const [inviteSelection, setInviteSelection] = useState<string[]>([]);

  const carrierName = useCallback(
    (id: string) => carriers.find((c) => c.id === id)?.legal_entity_name ?? id.slice(0, 8),
    [carriers],
  );

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [c, p, comp, s, res, req, r, q, a, b, l, au, pol, rt, veh] = await Promise.all([
        listCarriers(), listPartnersForCarrier(), listComplianceItems(), listCapacitySlots(),
        listReservations(), listRequirements(), listRfqs(), listQuotations(), listAwards(),
        listBookings(), listLineage(), listProcurementAudit(), listTenderPolicies(),
        listAttachableRoutes(), listFleetVehicles(),
      ]);
      setCarriers(c); setPartners(p); setCompliance(comp); setSlots(s); setReservations(res);
      setRequirements(req); setRfqs(r); setQuotes(q); setAwards(a); setBookings(b);
      setLineage(l); setAudit(au); setPolicies(pol); setRoutes(rt); setVehicles(veh);

      const verdictEntries = await Promise.all(c.map(async (x) => [x.id, await carrierComplianceState(x.id)] as const));
      setVerdicts(Object.fromEntries(verdictEntries));
      const scoreEntries = await Promise.all(c.map(async (x) => [x.id, await carrierScorecard(x.id)] as const));
      setScores(Object.fromEntries(scoreEntries));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load procurement state.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const act = async (key: string, fn: () => Promise<{ ok: boolean; code?: string; message?: string }>, ok: string) => {
    setBusy(key);
    try {
      const res = await fn();
      if (!res.ok) { toast.error(res.message ?? res.code ?? "The operation was refused."); return null; }
      toast.success(ok);
      await load();
      return res;
    } finally { setBusy(null); }
  };

  const metrics = useMemo(() => {
    const openTenders = rfqs.filter((r) => ["OPEN", "INVITED", "RESPONSES_RECEIVED", "EVALUATION"].includes(r.state)).length;
    const offered = slots.reduce((n, s) => n + Number(s.offered_kg), 0);
    const free = slots.filter((s) => s.availability_status === "AVAILABLE").reduce((n, s) => n + availableKg(s), 0);
    const compliant = carriers.filter((c) => verdicts[c.id]?.state === "PASS").length;
    return {
      carriers: carriers.length, compliant, openTenders,
      awards: awards.filter((a) => a.status === "AWARDED").length,
      liveBookings: bookings.filter((b) => !["COMPLETED", "CANCELLED", "FAILED"].includes(b.state)).length,
      offered, free,
      activeReservations: reservations.filter((r) => r.state === "ACTIVE").length,
    };
  }, [carriers, verdicts, rfqs, awards, bookings, slots, reservations]);

  const selectedRfqRow = rfqs.find((r) => r.id === selectedRfq) ?? null;
  const selectedRfqRequirement = requirements.find((r) => r.id === selectedRfqRow?.requirement_id) ?? null;

  const runComparison = async (rfqId: string) => {
    setSelectedRfq(rfqId);
    setBusy(`cmp-${rfqId}`);
    const res = await bidComparison(rfqId);
    setBusy(null);
    if (!res.ok) { toast.error(res.code ?? "Comparison unavailable"); return; }
    setComparison(res);
  };

  if (loading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-10 w-96" /><Skeleton className="h-28 w-full" /><Skeleton className="h-72 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Gavel className="h-6 w-6 text-primary" aria-hidden /> Freight Procurement Control Tower
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Demand → RFQ → tender → carrier bids → award → capacity reservation → booking, handed to the existing
            route, vehicle, driver and dispatch systems. Capacity arithmetic, compliance verdicts and award rules are
            decided in the database; this console cannot overrule them.
          </p>
        </div>
        <Button variant="outline" onClick={() => void load()}>
          <RefreshCw className="mr-2 h-4 w-4" aria-hidden /> Refresh
        </Button>
      </header>

      {error && (
        <Alert variant="destructive"><AlertTriangle className="h-4 w-4" aria-hidden /><AlertDescription>{error}</AlertDescription></Alert>
      )}

      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        {[
          { label: "Carriers", value: metrics.carriers, hint: `${metrics.compliant} compliance-clear` },
          { label: "Open tenders", value: metrics.openTenders, hint: `${rfqs.length} total RFQs` },
          { label: "Live awards", value: metrics.awards, hint: `${metrics.liveBookings} bookings in flight` },
          { label: "Capacity offered", value: `${metrics.offered.toLocaleString()} kg`, hint: "declared by carriers" },
          { label: "Capacity free", value: `${metrics.free.toLocaleString()} kg`, hint: "bookable right now" },
          { label: "Active reservations", value: metrics.activeReservations, hint: "expire automatically" },
        ].map((m) => (
          <Card key={m.label} className="p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{m.label}</p>
            <p className="mt-1 text-2xl font-semibold">{m.value}</p>
            <p className="text-xs text-muted-foreground">{m.hint}</p>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="sourcing">
        <TabsList className="flex-wrap">
          <TabsTrigger value="sourcing">Demand &amp; sourcing</TabsTrigger>
          <TabsTrigger value="tenders">Tenders &amp; bids</TabsTrigger>
          <TabsTrigger value="execution">Awards &amp; execution</TabsTrigger>
          <TabsTrigger value="capacity">Capacity</TabsTrigger>
          <TabsTrigger value="carriers">Carriers &amp; compliance</TabsTrigger>
          <TabsTrigger value="performance">Scorecards</TabsTrigger>
          <TabsTrigger value="audit">Lineage &amp; audit</TabsTrigger>
        </TabsList>

        {/* ------------------------------------------------ demand & sourcing */}
        <TabsContent value="sourcing" className="space-y-4">
          <Card className="p-5">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <PackageSearch className="h-5 w-5 text-primary" aria-hidden /> Capture freight requirement
            </h2>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <div className="space-y-2"><Label htmlFor="o-label">Origin</Label>
                <Input id="o-label" value={reqForm.originLabel} onChange={(e) => setReqForm((f) => ({ ...f, originLabel: e.target.value }))} placeholder="Industrial Area, Nairobi" /></div>
              <div className="space-y-2"><Label htmlFor="o-code">Origin area code</Label>
                <Input id="o-code" value={reqForm.originAreaCode} onChange={(e) => setReqForm((f) => ({ ...f, originAreaCode: e.target.value }))} placeholder="NBO" /></div>
              <div className="space-y-2"><Label htmlFor="veh">Vehicle type required</Label>
                <Input id="veh" value={reqForm.vehicleType} onChange={(e) => setReqForm((f) => ({ ...f, vehicleType: e.target.value }))} placeholder="10T truck" /></div>
              <div className="space-y-2"><Label htmlFor="d-label">Destination</Label>
                <Input id="d-label" value={reqForm.destinationLabel} onChange={(e) => setReqForm((f) => ({ ...f, destinationLabel: e.target.value }))} placeholder="Mombasa Port" /></div>
              <div className="space-y-2"><Label htmlFor="d-code">Destination area code</Label>
                <Input id="d-code" value={reqForm.destinationAreaCode} onChange={(e) => setReqForm((f) => ({ ...f, destinationAreaCode: e.target.value }))} placeholder="MSA" /></div>
              <div className="space-y-2"><Label htmlFor="wt">Weight (kg)</Label>
                <Input id="wt" type="number" value={reqForm.weightKg} onChange={(e) => setReqForm((f) => ({ ...f, weightKg: e.target.value }))} /></div>
              <div className="space-y-2"><Label htmlFor="ps">Pickup window start</Label>
                <Input id="ps" type="datetime-local" value={reqForm.pickupStart} onChange={(e) => setReqForm((f) => ({ ...f, pickupStart: e.target.value }))} /></div>
              <div className="space-y-2"><Label htmlFor="pe">Pickup window end</Label>
                <Input id="pe" type="datetime-local" value={reqForm.pickupEnd} onChange={(e) => setReqForm((f) => ({ ...f, pickupEnd: e.target.value }))} /></div>
              <div className="space-y-2"><Label htmlFor="de">Delivery by</Label>
                <Input id="de" type="datetime-local" value={reqForm.deliveryEnd} onChange={(e) => setReqForm((f) => ({ ...f, deliveryEnd: e.target.value }))} /></div>
              <div className="space-y-2"><Label htmlFor="pc">Packages</Label>
                <Input id="pc" type="number" value={reqForm.packageCount} onChange={(e) => setReqForm((f) => ({ ...f, packageCount: e.target.value }))} /></div>
              <div className="space-y-2"><Label htmlFor="tb">Target budget (KES)</Label>
                <Input id="tb" type="number" value={reqForm.targetBudget} onChange={(e) => setReqForm((f) => ({ ...f, targetBudget: e.target.value }))} /></div>
              <div className="flex flex-col justify-end gap-2 text-sm">
                <label className="flex items-center gap-2"><Switch checked={reqForm.crossBorder} onCheckedChange={(v) => setReqForm((f) => ({ ...f, crossBorder: v }))} /> Cross-border</label>
                <label className="flex items-center gap-2"><Switch checked={reqForm.temperature} onCheckedChange={(v) => setReqForm((f) => ({ ...f, temperature: v }))} /> Temperature controlled</label>
                <label className="flex items-center gap-2"><Switch checked={reqForm.isTest} onCheckedChange={(v) => setReqForm((f) => ({ ...f, isTest: v }))} /> Test tenant (sandbox events)</label>
              </div>
              <div className="space-y-2 md:col-span-3"><Label htmlFor="ins">Special instructions</Label>
                <Textarea id="ins" value={reqForm.instructions} onChange={(e) => setReqForm((f) => ({ ...f, instructions: e.target.value }))} rows={2} /></div>
            </div>
            <Button
              className="mt-4"
              disabled={busy === "req"}
              onClick={() => {
                if (!reqForm.originLabel.trim() || !reqForm.destinationLabel.trim()) return toast.error("Origin and destination are required.");
                if (!Number(reqForm.weightKg)) return toast.error("Enter the freight weight in kilograms.");
                void act("req", () => createRequirement({
                  originLabel: reqForm.originLabel.trim(), destinationLabel: reqForm.destinationLabel.trim(),
                  originAreaCode: reqForm.originAreaCode.trim() || undefined,
                  destinationAreaCode: reqForm.destinationAreaCode.trim() || undefined,
                  pickupWindowStart: new Date(reqForm.pickupStart).toISOString(),
                  pickupWindowEnd: new Date(reqForm.pickupEnd).toISOString(),
                  deliveryWindowEnd: reqForm.deliveryEnd ? new Date(reqForm.deliveryEnd).toISOString() : undefined,
                  weightKg: Number(reqForm.weightKg), packageCount: Number(reqForm.packageCount) || 1,
                  vehicleTypeRequired: reqForm.vehicleType.trim() || undefined,
                  targetBudget: reqForm.targetBudget ? Number(reqForm.targetBudget) : undefined,
                  crossBorder: reqForm.crossBorder, temperatureControlled: reqForm.temperature,
                  specialInstructions: reqForm.instructions.trim() || undefined, isTest: reqForm.isTest,
                }), "Freight requirement captured.");
              }}
            >
              Capture requirement
            </Button>
          </Card>

          <Card className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Requirements</h3>
              <Select value={selectedRequirement} onValueChange={async (v) => {
                setSelectedRequirement(v);
                const res = await capacitySearch(v);
                if (!res.ok) toast.error(res.code ?? "Search failed"); else setSearch(res);
              }}>
                <SelectTrigger className="w-80"><SelectValue placeholder="Search carrier capacity for…" /></SelectTrigger>
                <SelectContent>
                  {requirements.map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.requirement_number} · {r.origin_label} → {r.destination_label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {requirements.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No freight requirements captured yet.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-muted-foreground">
                    <tr><th className="py-2">Requirement</th><th>Lane</th><th>Weight</th><th>Pickup</th><th>State</th><th className="text-right">Action</th></tr>
                  </thead>
                  <tbody>
                    {requirements.map((r) => (
                      <tr key={r.id} className="border-t">
                        <td className="py-2 font-mono text-xs">{r.requirement_number}{r.is_test && <Badge variant="outline" className={`ml-2 ${tone.warning}`}>test</Badge>}</td>
                        <td>{r.origin_label} → {r.destination_label}</td>
                        <td>{Number(r.weight_kg).toLocaleString()} kg</td>
                        <td className="text-xs">{fmt(r.pickup_window_start)}</td>
                        <td><Badge variant="outline" className={stateTone(r.state)}>{r.state}</Badge></td>
                        <td className="text-right">
                          <Button size="sm" variant="ghost" onClick={() => {
                            setRfqForm((f) => ({ ...f, requirementId: r.id, title: `${r.origin_label} → ${r.destination_label}` }));
                            toast.info("Requirement selected for RFQ.");
                          }}>Raise RFQ</Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {search && (
            <Card className="p-5">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Capacity match {search.state === "OWNER_CONFIGURATION_REQUIRED" && (
                  <Badge variant="outline" className={`ml-2 ${tone.warning}`}>OWNER_CONFIGURATION_REQUIRED</Badge>)}
              </h3>
              {search.candidates.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  No carrier capacity satisfies this requirement right now. Rejections are listed below with their reasons.
                </p>
              ) : (
                <table className="mt-3 w-full text-sm">
                  <thead className="text-left text-xs uppercase text-muted-foreground">
                    <tr><th className="py-2">Carrier</th><th>Slot</th><th>Vehicle type</th><th>Available</th><th>Compliance</th><th>Score</th><th className="text-right">Invite</th></tr>
                  </thead>
                  <tbody>
                    {search.candidates.map((c) => (
                      <tr key={c.slot_id} className="border-t">
                        <td className="py-2">{c.carrier_name}</td>
                        <td className="font-mono text-xs">{c.slot_reference}</td>
                        <td>{c.vehicle_type}</td>
                        <td>{Number(c.available_kg).toLocaleString()} kg</td>
                        <td><Badge variant="outline" className={stateTone(c.compliance_state)}>{c.compliance_state}</Badge></td>
                        <td>{c.match_score}</td>
                        <td className="text-right">
                          <Button size="sm" variant="outline"
                            onClick={() => setInviteSelection((s) => s.includes(c.carrier_id) ? s : [...s, c.carrier_id])}>
                            Shortlist
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {search.rejected.length > 0 && (
                <>
                  <Separator className="my-4" />
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Not matched</p>
                  <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                    {search.rejected.map((r) => (
                      <li key={r.slot_id}>
                        <span className="font-medium text-foreground">{r.carrier_name}</span>{" "}
                        — {r.blocking.map((b) => b.code).join(", ")}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Card>
          )}

          <Card className="p-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              <ClipboardList className="h-4 w-4" aria-hidden /> Raise RFQ
            </h3>
            <div className="mt-3 grid gap-3 md:grid-cols-4">
              <Select value={rfqForm.requirementId} onValueChange={(v) => setRfqForm((f) => ({ ...f, requirementId: v }))}>
                <SelectTrigger><SelectValue placeholder="Requirement" /></SelectTrigger>
                <SelectContent>
                  {requirements.filter((r) => ["SUBMITTED", "SOURCING", "DRAFT"].includes(r.state)).map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.requirement_number}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input placeholder="Tender title" value={rfqForm.title} onChange={(e) => setRfqForm((f) => ({ ...f, title: e.target.value }))} />
              <Input type="datetime-local" value={rfqForm.deadline} onChange={(e) => setRfqForm((f) => ({ ...f, deadline: e.target.value }))} />
              <Select value={rfqForm.sourcingMode} onValueChange={(v) => setRfqForm((f) => ({ ...f, sourcingMode: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="MULTI">Multi-carrier tender</SelectItem>
                  <SelectItem value="SINGLE">Single-carrier sourcing</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {inviteSelection.map((id) => (
                <Badge key={id} variant="outline" className={tone.info}>
                  {carrierName(id)}
                  <button className="ml-2" aria-label={`Remove ${carrierName(id)}`} onClick={() => setInviteSelection((s) => s.filter((x) => x !== id))}>×</button>
                </Badge>
              ))}
              {inviteSelection.length === 0 && <span className="text-xs text-muted-foreground">Shortlist carriers from the capacity match above, or invite from the carrier list.</span>}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                disabled={busy === "rfq"}
                onClick={async () => {
                  if (!rfqForm.requirementId) return toast.error("Choose the requirement being sourced.");
                  if (!rfqForm.title.trim()) return toast.error("Give the tender a title.");
                  const res = await act("rfq", () => createRfq({
                    requirementId: rfqForm.requirementId, title: rfqForm.title.trim(),
                    responseDeadline: new Date(rfqForm.deadline).toISOString(),
                    sourcingMode: rfqForm.sourcingMode as "SINGLE" | "MULTI",
                    scopeNotes: rfqForm.notes.trim() || undefined,
                  }), "RFQ created.");
                  const rfqId = (res as { rfq_id?: string } | null)?.rfq_id;
                  if (rfqId && inviteSelection.length > 0) {
                    await act("invite", () => inviteCarriers(rfqId, inviteSelection), "Carriers invited.");
                    setInviteSelection([]);
                  }
                  if (rfqId) setSelectedRfq(rfqId);
                }}
              >
                Create RFQ &amp; invite shortlist
              </Button>
            </div>
          </Card>
        </TabsContent>

        {/* ------------------------------------------------ tenders & bids */}
        <TabsContent value="tenders" className="space-y-4">
          <Card className="p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Tenders</h3>
            {rfqs.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No tenders yet.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-muted-foreground">
                    <tr><th className="py-2">RFQ</th><th>Title</th><th>Mode</th><th>State</th><th>Deadline</th><th>Bids</th><th className="text-right">Actions</th></tr>
                  </thead>
                  <tbody>
                    {rfqs.map((r) => {
                      const bids = quotes.filter((q) => q.rfq_id === r.id && ["SUBMITTED", "ACCEPTED"].includes(q.state)).length;
                      return (
                        <tr key={r.id} className="border-t">
                          <td className="py-2 font-mono text-xs">{r.rfq_number}</td>
                          <td>{r.title}</td>
                          <td className="text-xs">{r.sourcing_mode}</td>
                          <td><Badge variant="outline" className={stateTone(r.state)}>{r.state}</Badge></td>
                          <td className="text-xs">{fmt(r.response_deadline)}</td>
                          <td>{bids}</td>
                          <td className="space-x-1 text-right">
                            {["DRAFT", "INVITED"].includes(r.state) && (
                              <Button size="sm" variant="outline" disabled={busy === `iss-${r.id}`}
                                onClick={() => void act(`iss-${r.id}`, () => issueRfq(r.id), "Tender issued to invited carriers.")}>
                                Issue
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" onClick={() => void runComparison(r.id)}>Compare bids</Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {comparison?.ok && (
            <Card className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Bid comparison — {selectedRfqRow?.rfq_number}
                </h3>
                <Badge variant="outline" className={stateTone(comparison.policy.state)}>
                  policy: {comparison.policy.state === "CONFIGURED" ? comparison.policy.policy_code : "OWNER_CONFIGURATION_REQUIRED"}
                </Badge>
              </div>
              {comparison.policy.state === "CONFIGURED" && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Weighted on price {comparison.policy.weights?.price}, transit {comparison.policy.weights?.transit},
                  capacity {comparison.policy.weights?.capacity}, performance {comparison.policy.weights?.performance},
                  compliance {comparison.policy.weights?.compliance}. Lowest price alone never decides an award.
                </p>
              )}
              {comparison.bids.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">No carrier has quoted on this tender yet.</p>
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs uppercase text-muted-foreground">
                      <tr><th className="py-2">Carrier</th><th>Total</th><th>Transit</th><th>Capacity</th><th>Compliance</th><th>Reliability</th><th>Score</th><th className="text-right">Award</th></tr>
                    </thead>
                    <tbody>
                      {comparison.bids.map((b) => {
                        const blockers = awardBlockers(b, Number(selectedRfqRequirement?.weight_kg ?? 0), comparison);
                        return (
                          <tr key={b.quotation_id} className="border-t align-top">
                            <td className="py-2">
                              <p className="font-medium">{b.carrier_name}</p>
                              <p className="font-mono text-xs text-muted-foreground">{b.quote_number} v{b.version}</p>
                            </td>
                            <td>
                              {money(b.total, b.currency)}
                              {b.is_lowest_price && <Badge variant="outline" className={`ml-2 ${tone.success}`}>lowest</Badge>}
                            </td>
                            <td>{b.transit_time_hours != null ? `${b.transit_time_hours} h` : "—"}</td>
                            <td>{Number(b.capacity_offered_kg).toLocaleString()} kg{!b.capacity_sufficient && <Badge variant="outline" className={`ml-2 ${tone.danger}`}>short</Badge>}</td>
                            <td><Badge variant="outline" className={stateTone(b.compliance_state)}>{b.compliance_state}</Badge></td>
                            <td>{b.reliability_score ?? "—"}</td>
                            <td className="font-semibold">{b.weighted_score}</td>
                            <td className="text-right">
                              <Button size="sm" disabled={blockers.length > 0}
                                title={blockers.join("; ") || "Award this carrier"}
                                onClick={() => { setAwardTarget({ rfqId: b.quotation_id ? selectedRfq : "", quotationId: b.quotation_id, label: `${b.carrier_name} · ${money(b.total, b.currency)}`, blockers }); setAwardNote(""); }}>
                                Award
                              </Button>
                              {blockers.length > 0 && (
                                <p className="mt-1 max-w-[220px] text-right text-xs text-destructive">{blockers.join("; ")}</p>
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
          )}
        </TabsContent>

        {/* ------------------------------------------------ awards & execution */}
        <TabsContent value="execution" className="space-y-4">
          <Card className="p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Awards</h3>
            {awards.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No awards yet.</p>
            ) : (
              <table className="mt-3 w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr><th className="py-2">Award</th><th>Carrier</th><th>Total</th><th>Status</th><th>Reservation</th><th>Awarded</th><th className="text-right">Action</th></tr>
                </thead>
                <tbody>
                  {awards.map((a) => {
                    const booked = bookings.find((b) => b.award_id === a.id);
                    return (
                      <tr key={a.id} className="border-t">
                        <td className="py-2 font-mono text-xs">{a.award_number}
                          {a.lowest_price_bypassed && <Badge variant="outline" className={`ml-2 ${tone.warning}`}>not lowest</Badge>}</td>
                        <td>{carrierName(a.carrier_id)}</td>
                        <td>{money(a.awarded_total, a.currency)}</td>
                        <td><Badge variant="outline" className={stateTone(a.status)}>{a.status}</Badge></td>
                        <td className="font-mono text-xs">{a.reservation_id ? a.reservation_id.slice(0, 8) : "—"}</td>
                        <td className="text-xs">{fmt(a.awarded_at)}</td>
                        <td className="text-right">
                          {booked ? <span className="text-xs text-muted-foreground">{booked.booking_number}</span> : (
                            <Button size="sm" disabled={a.status !== "AWARDED" || busy === `bk-${a.id}`}
                              onClick={() => void act(`bk-${a.id}`, () => createBooking(a.id, `booking:${a.id}`), "Freight booking created.")}>
                              Create booking
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Card>

          <Card className="p-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              <Truck className="h-4 w-4" aria-hidden /> Bookings → existing route, vehicle, driver
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Bookings attach to routes planned in Route Control and drivers from the driver register. This screen
              creates no second route, vehicle or dispatch system.
            </p>
            {bookings.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No bookings yet.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-muted-foreground">
                    <tr><th className="py-2">Booking</th><th>Carrier</th><th>State</th><th>Route</th><th>Vehicle</th><th>Driver</th><th>Total</th><th className="text-right">Actions</th></tr>
                  </thead>
                  <tbody>
                    {bookings.map((b) => (
                      <tr key={b.id} className="border-t">
                        <td className="py-2 font-mono text-xs">{b.booking_number}</td>
                        <td>{carrierName(b.carrier_id)}</td>
                        <td><Badge variant="outline" className={stateTone(b.state)}>{b.state}</Badge></td>
                        <td className="text-xs">{routes.find((r) => r.id === b.route_id)?.route_number ?? "—"}</td>
                        <td className="text-xs">{vehicles.find((v) => v.id === b.vehicle_id)?.number_plate ?? "—"}</td>
                        <td className="text-xs">{b.driver_user_id ? "assigned" : "—"}</td>
                        <td>{money(b.agreed_total, b.currency)}</td>
                        <td className="space-x-1 text-right">
                          <Button size="sm" variant="outline"
                            onClick={() => { setResourceTarget(b); setResourceForm({ routeId: b.route_id ?? "", vehicleId: b.vehicle_id ?? "", driverUserId: b.driver_user_id ?? "" }); }}>
                            Resources
                          </Button>
                          {["CREATED", "CARRIER_ASSIGNED", "RESOURCED"].includes(b.state) && (
                            <Button size="sm" disabled={busy === `dp-${b.id}`}
                              onClick={() => void act(`dp-${b.id}`, () => transitionBooking(b.id, "DISPATCHED"), "Booking dispatched.")}>
                              Dispatch
                            </Button>
                          )}
                          {b.state === "DISPATCHED" && (
                            <Button size="sm" variant="outline" onClick={() => void act(`ex-${b.id}`, () => transitionBooking(b.id, "EXECUTING"), "Booking executing.")}>
                              Start
                            </Button>
                          )}
                          {b.state === "EXECUTING" && (
                            <Button size="sm" variant="outline" onClick={() => void act(`cp-${b.id}`, () => transitionBooking(b.id, "COMPLETED"), "Booking completed; capacity consumed.")}>
                              Complete
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </TabsContent>

        {/* ------------------------------------------------ capacity */}
        <TabsContent value="capacity" className="space-y-4">
          <Card className="p-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              <Boxes className="h-4 w-4" aria-hidden /> Declare capacity
            </h3>
            <div className="mt-3 grid gap-3 md:grid-cols-4">
              <Select value={slotForm.carrierId} onValueChange={(v) => setSlotForm((f) => ({ ...f, carrierId: v }))}>
                <SelectTrigger><SelectValue placeholder="Carrier" /></SelectTrigger>
                <SelectContent>{carriers.map((c) => <SelectItem key={c.id} value={c.id}>{c.legal_entity_name}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={slotForm.vehicleId} onValueChange={(v) => setSlotForm((f) => ({ ...f, vehicleId: v }))}>
                <SelectTrigger><SelectValue placeholder="Existing vehicle (optional)" /></SelectTrigger>
                <SelectContent>{vehicles.map((v) => <SelectItem key={v.id} value={v.id}>{v.number_plate} · {v.vehicle_type}</SelectItem>)}</SelectContent>
              </Select>
              <Input placeholder="Vehicle type" value={slotForm.vehicleType} onChange={(e) => setSlotForm((f) => ({ ...f, vehicleType: e.target.value }))} />
              <Input type="number" placeholder="Offered kg" value={slotForm.offeredKg} onChange={(e) => setSlotForm((f) => ({ ...f, offeredKg: e.target.value }))} />
              <Input placeholder="Origin area code" value={slotForm.originAreaCode} onChange={(e) => setSlotForm((f) => ({ ...f, originAreaCode: e.target.value }))} />
              <Input placeholder="Destination area code" value={slotForm.destinationAreaCode} onChange={(e) => setSlotForm((f) => ({ ...f, destinationAreaCode: e.target.value }))} />
              <Input type="datetime-local" value={slotForm.from} onChange={(e) => setSlotForm((f) => ({ ...f, from: e.target.value }))} />
              <Input type="datetime-local" value={slotForm.until} onChange={(e) => setSlotForm((f) => ({ ...f, until: e.target.value }))} />
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={slotForm.exclusiveVehicle} onCheckedChange={(v) => setSlotForm((f) => ({ ...f, exclusiveVehicle: v }))} />
                Exclusive vehicle (no shared loads)
              </label>
            </div>
            <Button className="mt-3" disabled={busy === "slot"} onClick={() => {
              if (!slotForm.carrierId || !slotForm.vehicleType.trim() || !Number(slotForm.offeredKg)) {
                return toast.error("Carrier, vehicle type and offered capacity are required.");
              }
              void act("slot", () => saveCapacitySlot({
                carrierId: slotForm.carrierId, vehicleType: slotForm.vehicleType.trim(),
                offeredKg: Number(slotForm.offeredKg), vehicleId: slotForm.vehicleId || null,
                originAreaCode: slotForm.originAreaCode.trim() || undefined,
                destinationAreaCode: slotForm.destinationAreaCode.trim() || undefined,
                exclusiveVehicle: slotForm.exclusiveVehicle,
                effectiveFrom: new Date(slotForm.from).toISOString(),
                effectiveUntil: new Date(slotForm.until).toISOString(),
              }), "Capacity declared.");
            }}>Declare capacity</Button>
          </Card>

          <Card className="p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Capacity inventory</h3>
            {slots.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No capacity declared yet.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-muted-foreground">
                    <tr><th className="py-2">Slot</th><th>Carrier</th><th>Type</th><th>Offered</th><th>Reserved</th><th>Committed</th><th>Consumed</th><th>Free</th><th>Operational state</th><th>Window</th></tr>
                  </thead>
                  <tbody>
                    {slots.map((s) => (
                      <tr key={s.id} className="border-t">
                        <td className="py-2 font-mono text-xs">{s.slot_reference}</td>
                        <td>{carrierName(s.carrier_id)}</td>
                        <td>{s.vehicle_type}</td>
                        <td>{Number(s.offered_kg).toLocaleString()}</td>
                        <td>{Number(s.reserved_kg).toLocaleString()}</td>
                        <td>{Number(s.committed_kg).toLocaleString()}</td>
                        <td>{Number(s.consumed_kg).toLocaleString()}</td>
                        <td className="font-semibold">{availableKg(s).toLocaleString()}</td>
                        <td><Badge variant="outline" className={stateTone(slotOperationalState(s))}>{slotOperationalState(s)}</Badge></td>
                        <td className="text-xs">{fmt(s.effective_from)} → {fmt(s.effective_until)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card className="p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Reservations</h3>
            {reservations.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No capacity reservations.</p>
            ) : (
              <table className="mt-3 w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr><th className="py-2">Reference</th><th>Carrier</th><th>Qty</th><th>State</th><th>Expires</th><th className="text-right">Actions</th></tr>
                </thead>
                <tbody>
                  {reservations.map((r) => (
                    <tr key={r.id} className="border-t">
                      <td className="py-2 font-mono text-xs">{r.reservation_reference}</td>
                      <td>{carrierName(r.carrier_id)}</td>
                      <td>{Number(r.qty_kg).toLocaleString()} kg</td>
                      <td><Badge variant="outline" className={stateTone(r.state)}>{r.state}</Badge></td>
                      <td className="text-xs">{fmt(r.expires_at)}</td>
                      <td className="space-x-1 text-right">
                        {["ACTIVE", "COMMITTED"].includes(r.state) && (
                          <Button size="sm" variant="ghost" className="text-destructive" disabled={busy === `rl-${r.id}`}
                            onClick={() => void act(`rl-${r.id}`, () => transitionCapacity(r.id, "RELEASE", "Released by operator"), "Capacity released.")}>
                            Release
                          </Button>
                        )}
                        {r.state === "ACTIVE" && (
                          <Button size="sm" variant="outline" disabled={busy === `cm-${r.id}`}
                            onClick={() => void act(`cm-${r.id}`, () => transitionCapacity(r.id, "COMMIT", "Committed by operator"), "Capacity committed.")}>
                            Commit
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </TabsContent>

        {/* ------------------------------------------------ carriers */}
        <TabsContent value="carriers" className="space-y-4">
          <Card className="p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Onboard carrier (from an existing partner)</h3>
            <div className="mt-3 grid gap-3 md:grid-cols-4">
              <Select value={carrierForm.partnerId} onValueChange={(v) => setCarrierForm((f) => ({ ...f, partnerId: v, legalEntityName: partners.find((p) => p.id === v)?.legal_name ?? f.legalEntityName }))}>
                <SelectTrigger><SelectValue placeholder="Partner" /></SelectTrigger>
                <SelectContent>{partners.map((p) => <SelectItem key={p.id} value={p.id}>{p.legal_name}</SelectItem>)}</SelectContent>
              </Select>
              <Input placeholder="Legal entity name" value={carrierForm.legalEntityName} onChange={(e) => setCarrierForm((f) => ({ ...f, legalEntityName: e.target.value }))} />
              <Select value={carrierForm.operatingStatus} onValueChange={(v) => setCarrierForm((f) => ({ ...f, operatingStatus: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{["ONBOARDING", "ACTIVE", "SUSPENDED", "OFFBOARDED"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={carrierForm.contractStatus} onValueChange={(v) => setCarrierForm((f) => ({ ...f, contractStatus: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{["NONE", "DRAFT", "SIGNED", "EXPIRED", "TERMINATED"].map((s) => <SelectItem key={s} value={s}>contract: {s}</SelectItem>)}</SelectContent>
              </Select>
              <Input placeholder="Corridors (comma separated)" value={carrierForm.corridors} onChange={(e) => setCarrierForm((f) => ({ ...f, corridors: e.target.value }))} />
              <Input placeholder="Countries" value={carrierForm.countries} onChange={(e) => setCarrierForm((f) => ({ ...f, countries: e.target.value }))} />
              <Input placeholder="Service categories" value={carrierForm.categories} onChange={(e) => setCarrierForm((f) => ({ ...f, categories: e.target.value }))} />
              <Input type="number" placeholder="Payment terms (days)" value={carrierForm.paymentTermsDays}
                onChange={(e) => setCarrierForm((f) => ({ ...f, paymentTermsDays: Number(e.target.value) }))} />
            </div>
            <Button className="mt-3" disabled={busy === "carrier"} onClick={() => {
              if (!carrierForm.partnerId || !carrierForm.legalEntityName.trim()) return toast.error("Partner and legal entity name are required.");
              const csv = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
              void act("carrier", () => saveCarrier({
                partnerId: carrierForm.partnerId, legalEntityName: carrierForm.legalEntityName.trim(),
                corridors: csv(carrierForm.corridors), operatingCountries: csv(carrierForm.countries),
                serviceCategories: csv(carrierForm.categories), paymentTermsDays: carrierForm.paymentTermsDays,
                operatingStatus: carrierForm.operatingStatus as CarrierProfileRow["operating_status"],
                contractStatus: carrierForm.contractStatus as CarrierProfileRow["contract_status"],
              }), "Carrier saved.");
            }}>Save carrier</Button>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-5">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Declare capability</h3>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <Select value={capForm.carrierId} onValueChange={(v) => setCapForm((f) => ({ ...f, carrierId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Carrier" /></SelectTrigger>
                  <SelectContent>{carriers.map((c) => <SelectItem key={c.id} value={c.id}>{c.legal_entity_name}</SelectItem>)}</SelectContent>
                </Select>
                <Input placeholder="Vehicle type" value={capForm.vehicleType} onChange={(e) => setCapForm((f) => ({ ...f, vehicleType: e.target.value }))} />
                <Input type="number" placeholder="Max payload (kg)" value={capForm.maxPayloadKg} onChange={(e) => setCapForm((f) => ({ ...f, maxPayloadKg: e.target.value }))} />
                <div className="space-y-1 text-sm">
                  <label className="flex items-center gap-2"><Switch checked={capForm.crossBorder} onCheckedChange={(v) => setCapForm((f) => ({ ...f, crossBorder: v }))} /> Cross-border</label>
                  <label className="flex items-center gap-2"><Switch checked={capForm.temperature} onCheckedChange={(v) => setCapForm((f) => ({ ...f, temperature: v }))} /> Temperature</label>
                  <label className="flex items-center gap-2"><Switch checked={capForm.container} onCheckedChange={(v) => setCapForm((f) => ({ ...f, container: v }))} /> Container</label>
                  <label className="flex items-center gap-2"><Switch checked={capForm.lineHaul} onCheckedChange={(v) => setCapForm((f) => ({ ...f, lineHaul: v }))} /> Line-haul</label>
                </div>
              </div>
              <Button className="mt-3" disabled={busy === "cap"} onClick={() => {
                if (!capForm.carrierId || !capForm.vehicleType.trim() || !Number(capForm.maxPayloadKg)) {
                  return toast.error("Carrier, vehicle type and payload are required.");
                }
                void act("cap", () => saveCapability({
                  carrierId: capForm.carrierId, vehicleType: capForm.vehicleType.trim(),
                  maxPayloadKg: Number(capForm.maxPayloadKg), crossBorderCapable: capForm.crossBorder,
                  temperatureControlled: capForm.temperature, containerCapable: capForm.container,
                  lineHaulCapable: capForm.lineHaul,
                }), "Capability declared.");
              }}>Save capability</Button>

              <Separator className="my-4" />
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Service area</h3>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <Select value={areaForm.carrierId} onValueChange={(v) => setAreaForm((f) => ({ ...f, carrierId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Carrier" /></SelectTrigger>
                  <SelectContent>{carriers.map((c) => <SelectItem key={c.id} value={c.id}>{c.legal_entity_name}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={areaForm.areaKind} onValueChange={(v) => setAreaForm((f) => ({ ...f, areaKind: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{["CITY", "COUNTY", "COUNTRY", "CORRIDOR", "ZONE"].map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}</SelectContent>
                </Select>
                <Input placeholder="Area code (e.g. NBO)" value={areaForm.areaCode} onChange={(e) => setAreaForm((f) => ({ ...f, areaCode: e.target.value }))} />
                <Input placeholder="Area label" value={areaForm.areaLabel} onChange={(e) => setAreaForm((f) => ({ ...f, areaLabel: e.target.value }))} />
                <Select value={areaForm.direction} onValueChange={(v) => setAreaForm((f) => ({ ...f, direction: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{["BOTH", "ORIGIN", "DESTINATION"].map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <Button className="mt-3" variant="outline" disabled={busy === "area"} onClick={() => {
                if (!areaForm.carrierId || !areaForm.areaCode.trim()) return toast.error("Carrier and area code are required.");
                void act("area", () => saveServiceArea({
                  carrierId: areaForm.carrierId, areaKind: areaForm.areaKind,
                  areaCode: areaForm.areaCode.trim(), areaLabel: areaForm.areaLabel.trim() || areaForm.areaCode.trim(),
                  direction: areaForm.direction,
                }), "Service area saved.");
              }}>Save service area</Button>
            </Card>

            <Card className="p-5">
              <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                <ShieldCheck className="h-4 w-4" aria-hidden /> Record compliance evidence
              </h3>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <Select value={compForm.carrierId} onValueChange={(v) => setCompForm((f) => ({ ...f, carrierId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Carrier" /></SelectTrigger>
                  <SelectContent>{carriers.map((c) => <SelectItem key={c.id} value={c.id}>{c.legal_entity_name}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={compForm.requirementCode} onValueChange={(v) => setCompForm((f) => ({ ...f, requirementCode: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{COMPLIANCE_REQUIREMENTS.map((r) => <SelectItem key={r.code} value={r.code}>{r.label}</SelectItem>)}</SelectContent>
                </Select>
                <Input placeholder="Reference number" value={compForm.referenceNumber} onChange={(e) => setCompForm((f) => ({ ...f, referenceNumber: e.target.value }))} />
                <Input placeholder="Issuing authority" value={compForm.issuingAuthority} onChange={(e) => setCompForm((f) => ({ ...f, issuingAuthority: e.target.value }))} />
                <Input type="date" value={compForm.expiresOn} onChange={(e) => setCompForm((f) => ({ ...f, expiresOn: e.target.value }))} />
                <Input placeholder="Evidence storage path" value={compForm.evidencePath} onChange={(e) => setCompForm((f) => ({ ...f, evidencePath: e.target.value }))} />
                <Select value={compForm.state} onValueChange={(v) => setCompForm((f) => ({ ...f, state: v as ComplianceItemRow["state"] }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["PENDING_REVIEW", "VERIFIED", "REJECTED", "LEGAL_REVIEW_REQUIRED", "EXPIRED", "MISSING"].map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input placeholder="Legal review reason (if applicable)" value={compForm.legalReviewReason}
                  onChange={(e) => setCompForm((f) => ({ ...f, legalReviewReason: e.target.value }))} />
              </div>
              <Button className="mt-3" disabled={busy === "comp"} onClick={() => {
                if (!compForm.carrierId) return toast.error("Choose the carrier.");
                const meta = COMPLIANCE_REQUIREMENTS.find((r) => r.code === compForm.requirementCode)!;
                void act("comp", () => recordCompliance({
                  carrierId: compForm.carrierId, requirementCode: meta.code, requirementLabel: meta.label,
                  category: meta.category, state: compForm.state,
                  referenceNumber: compForm.referenceNumber.trim() || undefined,
                  issuingAuthority: compForm.issuingAuthority.trim() || undefined,
                  expiresOn: compForm.expiresOn || undefined,
                  evidenceStoragePath: compForm.evidencePath.trim() || undefined,
                  legalReviewReason: compForm.legalReviewReason.trim() || undefined,
                }), "Compliance evidence recorded.");
              }}>Record evidence</Button>
            </Card>
          </div>

          <Card className="p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Carrier register</h3>
            {carriers.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No carriers onboarded yet.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-muted-foreground">
                    <tr><th className="py-2">Carrier</th><th>Status</th><th>Contract</th><th>Compliance</th><th>Blocking</th><th>Evidence</th><th>Capacity slots</th></tr>
                  </thead>
                  <tbody>
                    {carriers.map((c) => {
                      const v = verdicts[c.id];
                      const items = compliance.filter((i) => i.carrier_id === c.id);
                      return (
                        <tr key={c.id} className="border-t align-top">
                          <td className="py-2">
                            <p className="font-medium">{c.legal_entity_name}</p>
                            <p className="font-mono text-xs text-muted-foreground">{c.carrier_code}</p>
                          </td>
                          <td><Badge variant="outline" className={stateTone(c.operating_status)}>{c.operating_status}</Badge></td>
                          <td><Badge variant="outline" className={stateTone(c.contract_status)}>{c.contract_status}</Badge></td>
                          <td><Badge variant="outline" className={stateTone(v?.state ?? "UNKNOWN")}>{v?.state ?? "…"}</Badge></td>
                          <td className="max-w-[260px] text-xs text-muted-foreground">
                            {(v?.blocking ?? []).map((b) => b.code + (b.requirement ? ` (${b.requirement})` : "")).join(", ") || "—"}
                          </td>
                          <td className="text-xs">{items.filter((i) => i.state === "VERIFIED").length}/{items.length} verified</td>
                          <td className="text-xs">{slots.filter((s) => s.carrier_id === c.id).length}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </TabsContent>

        {/* ------------------------------------------------ performance */}
        <TabsContent value="performance">
          <Card className="p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Carrier scorecards</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Computed from bookings, deliveries, proof of delivery and exceptions. A dash means there is nothing to
              measure yet — never a flattering zero. Carriers cannot edit these figures.
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr><th className="py-2">Carrier</th><th>Bookings</th><th>Tender response</th><th>Acceptance</th><th>On-time delivery</th><th>Cancellation</th><th>Failure</th><th>POD compliance</th><th>Exceptions</th><th>Reliability</th></tr>
                </thead>
                <tbody>
                  {carriers.map((c) => {
                    const s = scores[c.id] as Record<string, unknown> | undefined;
                    const pct = (k: string) => (s?.[k] == null ? "—" : `${s[k]}%`);
                    const sample = (s?.sample as { bookings?: number } | undefined)?.bookings ?? 0;
                    return (
                      <tr key={c.id} className="border-t">
                        <td className="py-2">{c.legal_entity_name}</td>
                        <td>{sample}</td>
                        <td>{pct("tender_response_rate_pct")}</td>
                        <td>{pct("acceptance_rate_pct")}</td>
                        <td>{pct("on_time_delivery_pct")}</td>
                        <td>{pct("cancellation_rate_pct")}</td>
                        <td>{pct("failure_rate_pct")}</td>
                        <td>{pct("pod_compliance_pct")}</td>
                        <td>{pct("exception_rate_pct")}</td>
                        <td className="font-semibold">{s?.reliability_score == null ? "—" : String(s.reliability_score)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {policies.length === 0 && (
              <Alert className="mt-4">
                <AlertTriangle className="h-4 w-4" aria-hidden />
                <AlertDescription className="text-xs">
                  <strong>OWNER_CONFIGURATION_REQUIRED</strong> — no award policy exists yet. Awards fall back to the
                  default weighting (price 40, transit 15, capacity 10, performance 20, compliance 15) and require a
                  compliance pass. Configure a policy to change the rules.
                </AlertDescription>
              </Alert>
            )}
          </Card>
        </TabsContent>

        {/* ------------------------------------------------ audit */}
        <TabsContent value="audit" className="space-y-4">
          <Card className="p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Freight price lineage</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Requested → quoted → accepted → actual → invoiced → settled. Append-only, and the foundation for freight audit.
            </p>
            {lineage.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No priced freight yet.</p>
            ) : (
              <table className="mt-3 w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr><th className="py-2">Requirement</th><th>Stage</th><th>Amount</th><th>Variance vs accepted</th><th>Recorded</th></tr>
                </thead>
                <tbody>
                  {lineage.map((l) => (
                    <tr key={l.id} className="border-t">
                      <td className="py-2 font-mono text-xs">
                        {requirements.find((r) => r.id === l.requirement_id)?.requirement_number ?? l.requirement_id.slice(0, 8)}
                      </td>
                      <td><Badge variant="outline" className={tone.info}>{l.stage}</Badge></td>
                      <td>{money(l.amount, l.currency)}</td>
                      <td>{l.variance_vs_accepted == null ? "—" : money(l.variance_vs_accepted, l.currency)}</td>
                      <td className="text-xs">{fmt(l.recorded_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card className="p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Procurement audit trail</h3>
            {audit.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No procurement activity recorded yet.</p>
            ) : (
              <table className="mt-3 w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr><th className="py-2">When</th><th>Entity</th><th>Action</th><th>Transition</th><th>Actor</th><th>Reason</th></tr>
                </thead>
                <tbody>
                  {audit.map((a) => (
                    <tr key={a.id} className="border-t">
                      <td className="py-2 text-xs">{fmt(a.created_at)}</td>
                      <td className="text-xs">{a.entity_type}</td>
                      <td className="font-mono text-xs">{a.action}</td>
                      <td className="text-xs">{a.from_state ?? "—"} → {a.to_state ?? "—"}</td>
                      <td className="text-xs">{a.actor_role}</td>
                      <td className="max-w-[260px] truncate text-xs text-muted-foreground">{a.reason ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </TabsContent>
      </Tabs>

      {/* -------------------------------------------------- award dialog */}
      <Dialog open={!!awardTarget} onOpenChange={(o) => !o && setAwardTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Award tender</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Awarding {awardTarget?.label}. The award reserves carrier capacity in the same transaction and cannot be
            repeated for this tender.
          </p>
          <Label htmlFor="award-note">Award justification (recorded permanently)</Label>
          <Textarea id="award-note" rows={3} value={awardNote} onChange={(e) => setAwardNote(e.target.value)}
            placeholder="Why this carrier — capacity, reliability, transit time, compliance…" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAwardTarget(null)}>Cancel</Button>
            <Button
              disabled={busy === "award"}
              onClick={async () => {
                if (!awardNote.trim()) return toast.error("An award justification is required.");
                if (!awardTarget) return;
                const res = await act("award", () => awardTender({
                  rfqId: selectedRfq, quotationId: awardTarget.quotationId, justification: awardNote.trim(),
                  idempotencyKey: `award:${awardTarget.quotationId}`,
                }), "Tender awarded and capacity reserved.");
                if (res?.ok) { setAwardTarget(null); void runComparison(selectedRfq); }
              }}
            >
              Award &amp; reserve capacity
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --------------------------------------------- resource dialog */}
      <Dialog open={!!resourceTarget} onOpenChange={(o) => !o && setResourceTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Attach existing execution resources</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            {resourceTarget?.booking_number} — choose a route already planned in Route Control, a registered vehicle
            and an eligible driver. The server re-checks driver eligibility before accepting.
          </p>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Route</Label>
              <Select value={resourceForm.routeId} onValueChange={(v) => setResourceForm((f) => ({ ...f, routeId: v }))}>
                <SelectTrigger><SelectValue placeholder="Planned route" /></SelectTrigger>
                <SelectContent>{routes.map((r) => <SelectItem key={r.id} value={r.id}>{r.route_number} · {r.status}</SelectItem>)}</SelectContent>
              </Select>
              {routes.length === 0 && <p className="text-xs text-warning">No plannable routes — create one in Route Control first.</p>}
            </div>
            <div className="space-y-1">
              <Label>Vehicle</Label>
              <Select value={resourceForm.vehicleId} onValueChange={(v) => setResourceForm((f) => ({ ...f, vehicleId: v }))}>
                <SelectTrigger><SelectValue placeholder="Registered vehicle" /></SelectTrigger>
                <SelectContent>{vehicles.map((v) => <SelectItem key={v.id} value={v.id}>{v.number_plate} · {v.vehicle_type}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="drv">Driver user id</Label>
              <Input id="drv" value={resourceForm.driverUserId} onChange={(e) => setResourceForm((f) => ({ ...f, driverUserId: e.target.value }))}
                placeholder="Driver from the existing driver register" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResourceTarget(null)}>Cancel</Button>
            <Button
              disabled={busy === "attach"}
              onClick={async () => {
                if (!resourceTarget) return;
                const res = await act("attach", () => attachExecution({
                  bookingId: resourceTarget.id,
                  routeId: resourceForm.routeId || undefined,
                  vehicleId: resourceForm.vehicleId || undefined,
                  driverUserId: resourceForm.driverUserId.trim() || undefined,
                }), "Execution resources attached.");
                if (res?.ok) setResourceTarget(null);
              }}
            >
              Attach resources
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
