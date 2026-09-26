/**
 * RENTAL FLEET & BOOKINGS — the commercial team's control of real stock.
 *
 * Availability shown on the public rentals pages is derived from this register
 * alone. A vehicle is only quotable once it is mapped to a published rate-card
 * class and marked Available, so the website can never offer a vehicle that does
 * not exist or is already committed.
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertTriangle, CalendarOff, Car, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  UNIT_STATUS_LABEL,
  blockUnit,
  isQuotable,
  listCommitments,
  listFleetUnits,
  listStaffBookings,
  removeCommitment,
  runStaffAction,
  saveFleetUnit,
  setUnitStatus,
  type FleetUnit,
  type StaffAction,
  type StaffBooking,
  type UnitCommitment,
  type UnitDraft,
  type UnitStatus,
} from "@/lib/rentals/fleetAdmin";
import { fetchPublicRateCard, kes, type PublicRateCard } from "@/lib/marketing/publicRateCard";

const STATUS_TONE: Record<string, string> = {
  AVAILABLE: "bg-status-success/15 text-status-success",
  UNDER_SERVICE: "bg-status-warning/15 text-status-warning",
  RETIRED: "bg-muted text-muted-foreground",
  CONFIRMED: "bg-primary/10 text-primary",
  AWAITING_ALLOCATION: "bg-status-warning/15 text-status-warning",
  PICKED_UP: "bg-ai/15 text-ai",
  RETURNED: "bg-muted text-muted-foreground",
  CANCELLED: "bg-destructive/10 text-destructive",
};

const bandValue = (assetClass: string, label: string) => `${assetClass}|${label}`;

const emptyDraft = (): UnitDraft => ({
  plate: "",
  make: "",
  model: "",
  year: "",
  seats: "",
  transmission: "",
  home_branch: "",
  asset_class: "",
  band_label: "",
  self_drive: false,
  chauffeur: false,
  status: "UNDER_SERVICE",
  notes: "",
});

export default function RentalFleet() {
  const [loading, setLoading] = useState(true);
  const [units, setUnits] = useState<FleetUnit[]>([]);
  const [commitments, setCommitments] = useState<UnitCommitment[]>([]);
  const [bookings, setBookings] = useState<StaffBooking[]>([]);
  const [card, setCard] = useState<PublicRateCard | null>(null);

  const [editing, setEditing] = useState<UnitDraft | null>(null);
  const [blocking, setBlocking] = useState<FleetUnit | null>(null);
  const [blockFrom, setBlockFrom] = useState("");
  const [blockTo, setBlockTo] = useState("");
  const [blockNote, setBlockNote] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [u, c, b, rc] = await Promise.all([
        listFleetUnits(),
        listCommitments(),
        listStaffBookings(),
        fetchPublicRateCard(),
      ]);
      setUnits(u);
      setCommitments(c);
      setBookings(b);
      setCard(rc);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load the rental fleet.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const quotableCount = useMemo(() => units.filter(isQuotable).length, [units]);
  const unmapped = useMemo(() => units.filter((u) => !u.asset_class || !u.band_label), [units]);
  const commitmentsByUnit = useMemo(() => {
    const map = new Map<string, UnitCommitment[]>();
    for (const c of commitments) {
      const list = map.get(c.unit_id) ?? [];
      list.push(c);
      map.set(c.unit_id, list);
    }
    return map;
  }, [commitments]);

  const openChanges = useMemo(() => bookings.filter((b) => b.change_request), [bookings]);

  const onSave = async () => {
    if (!editing) return;
    if (!editing.plate.trim() || !editing.make.trim() || !editing.model.trim()) {
      toast.error("Plate, make and model are required.");
      return;
    }
    try {
      await saveFleetUnit(editing);
      toast.success("Vehicle saved.");
      setEditing(null);
      void refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the vehicle.");
    }
  };

  const onStatus = async (unit: FleetUnit, status: UnitStatus) => {
    if (status === "AVAILABLE" && (!unit.asset_class || !unit.band_label)) {
      toast.error("Map this vehicle to a rate-card class before making it available.");
      return;
    }
    try {
      await setUnitStatus(unit.id, status);
      void refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not change the status.");
    }
  };

  const onBlock = async () => {
    if (!blocking || !blockFrom || !blockTo) {
      toast.error("Choose the dates to block out.");
      return;
    }
    const result = await blockUnit({
      unitId: blocking.id,
      startDate: blockFrom,
      endDate: blockTo,
      source: "SERVICE",
      note: blockNote,
    });
    if (!result.ok) {
      toast.error(result.message ?? "Could not block those dates.");
      return;
    }
    toast.success("Dates blocked.");
    setBlocking(null);
    setBlockFrom("");
    setBlockTo("");
    setBlockNote("");
    void refresh();
  };

  const onStaffAction = async (booking: StaffBooking, action: StaffAction) => {
    const result = await runStaffAction(booking.booking_reference, action);
    if (!result.ok) {
      toast.error(result.message ?? "Could not complete that action.");
      return;
    }
    toast.success("Done.");
    void refresh();
  };

  if (loading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Rental fleet &amp; bookings</h1>
          <p className="text-sm text-muted-foreground">
            {quotableCount} of {units.length} vehicles can be quoted on the website right now.
            {card ? ` Rate card v${card.version}.` : " No rate card is published, so nothing can be quoted."}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void refresh()}>
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh
          </Button>
          <Button onClick={() => setEditing(emptyDraft())}>
            <Plus className="mr-2 h-4 w-4" /> Add vehicle
          </Button>
        </div>
      </div>

      {unmapped.length > 0 ? (
        <Card className="border-status-warning/40 bg-status-warning/5 p-4">
          <div className="flex gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 text-status-warning" />
            <div className="text-sm">
              <p className="font-medium">
                {unmapped.length} vehicle{unmapped.length === 1 ? "" : "s"} not yet mapped to a rate-card class
              </p>
              <p className="text-muted-foreground">
                These were imported from the vehicle register. Set the real class for each one, then mark it
                Available. Until then they are never offered or priced on the website.
              </p>
            </div>
          </div>
        </Card>
      ) : null}

      <Tabs defaultValue="fleet">
        <TabsList>
          <TabsTrigger value="fleet">Vehicles ({units.length})</TabsTrigger>
          <TabsTrigger value="bookings">Bookings ({bookings.length})</TabsTrigger>
          <TabsTrigger value="requests">Requests ({openChanges.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="fleet" className="mt-4 space-y-3">
          {units.length === 0 ? (
            <Card className="p-8 text-center">
              <Car className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
              <p className="font-medium">No vehicles yet</p>
              <p className="text-sm text-muted-foreground">Add your first rental vehicle to start quoting.</p>
            </Card>
          ) : null}
          {units.map((u) => {
            const busy = commitmentsByUnit.get(u.id) ?? [];
            return (
              <Card key={u.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">
                        {u.make} {u.model}
                        {u.year ? ` (${u.year})` : ""}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">{u.plate}</span>
                      <Badge className={STATUS_TONE[u.status]}>{UNIT_STATUS_LABEL[u.status]}</Badge>
                      {isQuotable(u) ? (
                        <Badge className="bg-primary/10 text-primary">Quotable</Badge>
                      ) : (
                        <Badge variant="outline">Not quotable</Badge>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {u.band_label ? `${u.band_label} · ${u.asset_class}` : "No rate-card class set"}
                      {u.seats ? ` · ${u.seats} seats` : ""}
                      {u.transmission ? ` · ${u.transmission}` : ""}
                      {u.home_branch ? ` · ${u.home_branch}` : ""}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Offered: {[u.self_drive ? "self-drive" : null, u.chauffeur ? "chauffeured" : null]
                        .filter(Boolean)
                        .join(" and ") || "not offered on any service"}
                    </p>
                    {busy.length > 0 ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Committed:{" "}
                        {busy
                          .map((c) => `${c.start_date} → ${c.end_date}${c.source === "BOOKING" ? "" : " (blocked)"}`)
                          .join(" · ")}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Select value={u.status} onValueChange={(v) => void onStatus(u, v as UnitStatus)}>
                      <SelectTrigger className="w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(UNIT_STATUS_LABEL) as UnitStatus[]).map((s) => (
                          <SelectItem key={s} value={s}>
                            {UNIT_STATUS_LABEL[s]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button variant="outline" size="sm" onClick={() => setBlocking(u)}>
                      <CalendarOff className="mr-2 h-4 w-4" /> Block dates
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setEditing({
                          id: u.id,
                          plate: u.plate,
                          make: u.make,
                          model: u.model,
                          year: u.year ? String(u.year) : "",
                          seats: u.seats ? String(u.seats) : "",
                          transmission: u.transmission ?? "",
                          home_branch: u.home_branch ?? "",
                          asset_class: u.asset_class ?? "",
                          band_label: u.band_label ?? "",
                          self_drive: u.self_drive,
                          chauffeur: u.chauffeur,
                          status: u.status,
                          notes: u.notes ?? "",
                        })
                      }
                    >
                      Edit
                    </Button>
                  </div>
                </div>
                {busy.filter((c) => c.source !== "BOOKING").length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {busy
                      .filter((c) => c.source !== "BOOKING")
                      .map((c) => (
                        <Button
                          key={c.id}
                          variant="ghost"
                          size="sm"
                          onClick={async () => {
                            await removeCommitment(c.id);
                            void refresh();
                          }}
                        >
                          <Trash2 className="mr-1 h-3.5 w-3.5" /> Release {c.start_date} → {c.end_date}
                        </Button>
                      ))}
                  </div>
                ) : null}
              </Card>
            );
          })}
        </TabsContent>

        <TabsContent value="bookings" className="mt-4 space-y-3">
          {bookings.length === 0 ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              No rental bookings yet. A booking is created the moment a quotation is paid.
            </Card>
          ) : null}
          {bookings.map((b) => (
            <Card key={b.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{b.booking_reference}</span>
                    <Badge className={STATUS_TONE[b.status] ?? "bg-muted"}>{b.status.replace(/_/g, " ")}</Badge>
                    {b.change_request ? (
                      <Badge className="bg-status-warning/15 text-status-warning">
                        {b.change_request === "RESCHEDULE" ? "Reschedule requested" : "Cancellation requested"}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 font-medium">
                    {b.band_label} · {b.start_date} → {b.end_date}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {b.contact_name}
                    {b.company_name ? ` · ${b.company_name}` : ""} · {b.contact_phone} · {b.pickup_location}
                  </p>
                  <p className="mt-1 text-sm">
                    Paid {kes(b.amount_paid_kes)} of {kes(b.total_kes)}
                    {b.mpesa_receipt ? ` · M-Pesa ${b.mpesa_receipt}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {b.status === "CONFIRMED" ? (
                    <Button size="sm" onClick={() => void onStaffAction(b, "CONFIRM_PICKUP")}>
                      Confirm collection
                    </Button>
                  ) : null}
                  {b.status === "PICKED_UP" ? (
                    <Button size="sm" onClick={() => void onStaffAction(b, "CONFIRM_RETURN")}>
                      Record return
                    </Button>
                  ) : null}
                </div>
              </div>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="requests" className="mt-4 space-y-3">
          {openChanges.length === 0 ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              No open reschedule or cancellation requests.
            </Card>
          ) : null}
          {openChanges.map((b) => (
            <Card key={b.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-xs text-muted-foreground">{b.booking_reference}</p>
                  <p className="mt-1 font-medium">
                    {b.change_request === "RESCHEDULE"
                      ? `Move ${b.start_date} → ${b.end_date} to ${b.requested_start_date} → ${b.requested_end_date}`
                      : "Cancellation requested"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {b.contact_name} · {b.contact_phone}
                    {b.change_reason ? ` · "${b.change_reason}"` : ""}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Paid {kes(b.amount_paid_kes)}. Any refund is decided by finance — no refund rule is applied
                    automatically.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() =>
                      void onStaffAction(
                        b,
                        b.change_request === "RESCHEDULE" ? "APPROVE_RESCHEDULE" : "APPROVE_CANCELLATION",
                      )
                    }
                  >
                    Approve
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void onStaffAction(b, "DECLINE_CHANGE")}>
                    Decline
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </TabsContent>
      </Tabs>

      {/* ------------------------------- edit vehicle ------------------------------ */}
      <Dialog open={editing !== null} onOpenChange={(open) => (open ? null : setEditing(null))}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit vehicle" : "Add vehicle"}</DialogTitle>
          </DialogHeader>
          {editing ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="rf-plate">Number plate</Label>
                <Input
                  id="rf-plate"
                  value={editing.plate}
                  onChange={(e) => setEditing({ ...editing, plate: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="rf-branch">Home branch</Label>
                <Input
                  id="rf-branch"
                  value={editing.home_branch ?? ""}
                  onChange={(e) => setEditing({ ...editing, home_branch: e.target.value })}
                  placeholder="e.g. Westlands"
                />
              </div>
              <div>
                <Label htmlFor="rf-make">Make</Label>
                <Input
                  id="rf-make"
                  value={editing.make}
                  onChange={(e) => setEditing({ ...editing, make: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="rf-model">Model</Label>
                <Input
                  id="rf-model"
                  value={editing.model}
                  onChange={(e) => setEditing({ ...editing, model: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="rf-year">Year</Label>
                <Input
                  id="rf-year"
                  inputMode="numeric"
                  value={editing.year ?? ""}
                  onChange={(e) => setEditing({ ...editing, year: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="rf-seats">Seats</Label>
                <Input
                  id="rf-seats"
                  inputMode="numeric"
                  value={editing.seats ?? ""}
                  onChange={(e) => setEditing({ ...editing, seats: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="rf-trans">Transmission</Label>
                <Select
                  value={editing.transmission || ""}
                  onValueChange={(v) => setEditing({ ...editing, transmission: v })}
                >
                  <SelectTrigger id="rf-trans">
                    <SelectValue placeholder="Choose" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="automatic">Automatic</SelectItem>
                    <SelectItem value="manual">Manual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="rf-band">Rate-card class</Label>
                <Select
                  value={
                    editing.asset_class && editing.band_label
                      ? bandValue(editing.asset_class, editing.band_label)
                      : ""
                  }
                  onValueChange={(v) => {
                    const [assetClass, label] = v.split("|");
                    setEditing({ ...editing, asset_class: assetClass, band_label: label });
                  }}
                >
                  <SelectTrigger id="rf-band">
                    <SelectValue placeholder={card ? "Choose the real class" : "No rate card published"} />
                  </SelectTrigger>
                  <SelectContent>
                    {(card?.rows ?? []).map((r) => (
                      <SelectItem key={bandValue(r.assetClass, r.label)} value={bandValue(r.assetClass, r.label)}>
                        {r.label} · {r.assetClass}
                        {r.seats ? ` · ${r.seats} seats` : ""} · {kes(r.minKes)}/day
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="mt-1 text-xs text-muted-foreground">
                  Pick the class this vehicle genuinely belongs to. This sets the price customers pay.
                </p>
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <Label htmlFor="rf-self">Offer self-drive</Label>
                <Switch
                  id="rf-self"
                  checked={editing.self_drive}
                  onCheckedChange={(v) => setEditing({ ...editing, self_drive: v })}
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <Label htmlFor="rf-chauffeur">Offer chauffeured</Label>
                <Switch
                  id="rf-chauffeur"
                  checked={editing.chauffeur}
                  onCheckedChange={(v) => setEditing({ ...editing, chauffeur: v })}
                />
              </div>
              <div>
                <Label htmlFor="rf-status">Status</Label>
                <Select
                  value={editing.status}
                  onValueChange={(v) => setEditing({ ...editing, status: v as UnitStatus })}
                >
                  <SelectTrigger id="rf-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(UNIT_STATUS_LABEL) as UnitStatus[]).map((s) => (
                      <SelectItem key={s} value={s}>
                        {UNIT_STATUS_LABEL[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="rf-notes">Notes</Label>
                <Textarea
                  id="rf-notes"
                  rows={2}
                  value={editing.notes ?? ""}
                  onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
                />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={() => void onSave()}>Save vehicle</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* -------------------------------- block dates ------------------------------ */}
      <Dialog open={blocking !== null} onOpenChange={(open) => (open ? null : setBlocking(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Block {blocking?.make} {blocking?.model} ({blocking?.plate})
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="rf-from">From</Label>
              <Input id="rf-from" type="date" value={blockFrom} onChange={(e) => setBlockFrom(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="rf-to">To</Label>
              <Input id="rf-to" type="date" value={blockTo} onChange={(e) => setBlockTo(e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="rf-note">Reason</Label>
              <Input
                id="rf-note"
                value={blockNote}
                onChange={(e) => setBlockNote(e.target.value)}
                placeholder="Service, owner use, inspection…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBlocking(null)}>
              Cancel
            </Button>
            <Button onClick={() => void onBlock()}>Block dates</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
