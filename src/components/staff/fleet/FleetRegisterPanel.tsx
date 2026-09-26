/**
 * THE REAL DRIVERS AND VEHICLES.
 *
 * Each record carries the driver's own details, photograph and licence, or the
 * vehicle's registration, type and papers. Activation assignments choose from
 * this register, so nothing on a contract is a typed-in name.
 */
import * as React from "react";
import { Car, IdCard, Loader2, Plus, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  DRIVER_STATUSES,
  DRIVER_TYPES,
  VEHICLE_STATUSES,
  VEHICLE_TYPES,
  loadFleetRegister,
  saveDriver,
  saveVehicle,
  uploadFleetFile,
  type FleetRegister,
} from "@/lib/fleet/register";

const pretty = (s?: string | null) => (s ? s.replace(/_/g, " ") : "not recorded");

function DriverForm({ register, onDone }: { register: FleetRegister; onDone: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [f, setF] = React.useState({
    firstName: "",
    lastName: "",
    phoneNumber: "",
    nationalId: "",
    kraPin: "",
    driverType: "fleet_driver",
    status: "pending",
    licenceNumber: "",
    licenceExpiry: "",
  });
  const [photo, setPhoto] = React.useState<File | null>(null);
  const [licence, setLicence] = React.useState<File | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }));

  const submit = async () => {
    if (!f.firstName.trim() || !f.lastName.trim()) return toast.error("A driver needs a first and last name.");
    if (f.licenceExpiry && !f.licenceNumber.trim()) return toast.error("Record the licence number too.");
    setBusy(true);
    try {
      const photoUrl = photo ? await uploadFleetFile("driver-photos", photo) : undefined;
      const licenceUrl = licence ? await uploadFleetFile("driver-documents", licence) : undefined;
      await saveDriver({
        ...f,
        licenceNumber: f.licenceNumber.trim() || undefined,
        licenceExpiry: f.licenceExpiry || undefined,
        photoUrl,
        licenceFileUrl: licenceUrl,
        licenceFileName: licence?.name,
      });
      toast.success("Driver added to the register.");
      setOpen(false);
      setPhoto(null);
      setLicence(null);
      setF({
        firstName: "",
        lastName: "",
        phoneNumber: "",
        nationalId: "",
        kraPin: "",
        driverType: "fleet_driver",
        status: "pending",
        licenceNumber: "",
        licenceExpiry: "",
      });
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The driver was not added.");
    }
    setBusy(false);
  };

  if (!register.may_write) return null;
  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Add a driver
      </Button>
    );
  }

  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs" htmlFor="dfn">
            First name
          </Label>
          <Input id="dfn" value={f.firstName} onChange={set("firstName")} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs" htmlFor="dln">
            Last name
          </Label>
          <Input id="dln" value={f.lastName} onChange={set("lastName")} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs" htmlFor="dph">
            Phone
          </Label>
          <Input id="dph" value={f.phoneNumber} onChange={set("phoneNumber")} placeholder="+2547…" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs" htmlFor="did">
            National ID
          </Label>
          <Input id="did" value={f.nationalId} onChange={set("nationalId")} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs" htmlFor="dkra">
            KRA PIN
          </Label>
          <Input id="dkra" value={f.kraPin} onChange={set("kraPin")} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Driver type</Label>
          <Select value={f.driverType} onValueChange={(v) => setF((p) => ({ ...p, driverType: v }))}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DRIVER_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {pretty(t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Status</Label>
          <Select value={f.status} onValueChange={(v) => setF((p) => ({ ...p, status: v }))}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DRIVER_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {pretty(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs" htmlFor="dlic">
            Licence number
          </Label>
          <Input id="dlic" value={f.licenceNumber} onChange={set("licenceNumber")} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs" htmlFor="dlex">
            Licence expiry
          </Label>
          <Input id="dlex" type="date" value={f.licenceExpiry} onChange={set("licenceExpiry")} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs" htmlFor="dpho">
            Photograph
          </Label>
          <Input id="dpho" type="file" accept="image/*" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs" htmlFor="dlf">
            Licence file
          </Label>
          <Input
            id="dlf"
            type="file"
            accept="image/*,application/pdf"
            onChange={(e) => setLicence(e.target.files?.[0] ?? null)}
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={submit} disabled={busy}>
          {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />} Save driver
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function VehicleForm({ register, onDone }: { register: FleetRegister; onDone: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const empty = {
    numberPlate: "",
    vehicleType: "car",
    vehicleCategory: "",
    make: "",
    model: "",
    year: "",
    color: "",
    seatingCapacity: "",
    status: "pending",
    documentTypeId: "",
    documentNumber: "",
    documentExpiryDate: "",
  };
  const [f, setF] = React.useState(empty);
  const [doc, setDoc] = React.useState<File | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }));

  const submit = async () => {
    if (!f.numberPlate.trim()) return toast.error("A vehicle needs its registration number.");
    setBusy(true);
    try {
      const fileUrl = doc ? await uploadFleetFile("vehicle-documents", doc) : undefined;
      await saveVehicle({
        ...f,
        documentTypeId: f.documentTypeId || undefined,
        documentNumber: f.documentNumber.trim() || undefined,
        documentExpiryDate: f.documentExpiryDate || undefined,
        documentFileUrl: fileUrl,
        documentFileName: doc?.name,
      });
      toast.success("Vehicle added to the register.");
      setOpen(false);
      setDoc(null);
      setF(empty);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The vehicle was not added.");
    }
    setBusy(false);
  };

  if (!register.may_write) return null;
  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Add a vehicle
      </Button>
    );
  }

  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs" htmlFor="vpl">
            Registration
          </Label>
          <Input id="vpl" value={f.numberPlate} onChange={set("numberPlate")} placeholder="KDA 123A" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Vehicle type</Label>
          <Select value={f.vehicleType} onValueChange={(v) => setF((p) => ({ ...p, vehicleType: v }))}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VEHICLE_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {pretty(t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs" htmlFor="vcat">
            Class
          </Label>
          <Input id="vcat" value={f.vehicleCategory} onChange={set("vehicleCategory")} placeholder="comfort, xl…" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs" htmlFor="vmk">
            Make
          </Label>
          <Input id="vmk" value={f.make} onChange={set("make")} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs" htmlFor="vmd">
            Model
          </Label>
          <Input id="vmd" value={f.model} onChange={set("model")} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs" htmlFor="vyr">
            Year
          </Label>
          <Input id="vyr" type="number" value={f.year} onChange={set("year")} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs" htmlFor="vcl">
            Colour
          </Label>
          <Input id="vcl" value={f.color} onChange={set("color")} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs" htmlFor="vst">
            Seats
          </Label>
          <Input id="vst" type="number" value={f.seatingCapacity} onChange={set("seatingCapacity")} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Status</Label>
          <Select value={f.status} onValueChange={(v) => setF((p) => ({ ...p, status: v }))}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VEHICLE_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {pretty(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Paper to file (optional)</Label>
          <Select value={f.documentTypeId} onValueChange={(v) => setF((p) => ({ ...p, documentTypeId: v }))}>
            <SelectTrigger>
              <SelectValue placeholder="Insurance, inspection…" />
            </SelectTrigger>
            <SelectContent>
              {register.vehicle_document_types.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {f.documentTypeId && (
          <>
            <div className="space-y-1">
              <Label className="text-xs" htmlFor="vdn">
                Document number
              </Label>
              <Input id="vdn" value={f.documentNumber} onChange={set("documentNumber")} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs" htmlFor="vde">
                Expires
              </Label>
              <Input id="vde" type="date" value={f.documentExpiryDate} onChange={set("documentExpiryDate")} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs" htmlFor="vdf">
                File
              </Label>
              <Input
                id="vdf"
                type="file"
                accept="image/*,application/pdf"
                onChange={(e) => setDoc(e.target.files?.[0] ?? null)}
              />
            </div>
          </>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={submit} disabled={busy}>
          {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />} Save vehicle
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function FleetRegisterPanel() {
  const [register, setRegister] = React.useState<FleetRegister | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      setRegister(await loadFleetRegister());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The fleet register could not be read.");
    }
    setLoading(false);
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  if (loading && !register) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Reading the fleet register…
      </div>
    );
  }
  if (error) return <p className="py-4 text-sm text-destructive">{error}</p>;
  if (!register) return null;

  const today = new Date().toISOString().slice(0, 10);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Drivers and vehicles</CardTitle>
        <Button size="sm" variant="outline" onClick={() => void load()}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Refresh
        </Button>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="drivers">
          <TabsList>
            <TabsTrigger value="drivers">
              <IdCard className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Drivers ({register.drivers.length})
            </TabsTrigger>
            <TabsTrigger value="vehicles">
              <Car className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Vehicles ({register.vehicles.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="drivers" className="space-y-3 pt-3">
            <DriverForm register={register} onDone={() => void load()} />
            {register.drivers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No driver is on the register yet.</p>
            ) : (
              register.drivers.map((d) => (
                <div key={d.driver_id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{d.label ?? d.driver_code ?? "Name not recorded"}</p>
                    <p className="text-xs text-muted-foreground">
                      {pretty(d.driver_type)} · {d.phone_number ?? "no phone"} ·{" "}
                      {d.licence_number
                        ? `licence ${d.licence_number}${d.licence_expiry ? ` to ${d.licence_expiry}` : ""}`
                        : "no licence recorded"}
                      {d.assignments > 0 ? ` · on ${d.assignments} contract${d.assignments === 1 ? "" : "s"}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {d.licence_expiry && d.licence_expiry < today && (
                      <Badge variant="destructive" className="text-[10px]">
                        Licence expired
                      </Badge>
                    )}
                    <Badge variant={d.status === "active" ? "default" : "secondary"} className="text-[10px]">
                      {pretty(d.status)}
                    </Badge>
                  </div>
                </div>
              ))
            )}
          </TabsContent>

          <TabsContent value="vehicles" className="space-y-3 pt-3">
            <VehicleForm register={register} onDone={() => void load()} />
            {register.vehicles.length === 0 ? (
              <p className="text-sm text-muted-foreground">No vehicle is on the register yet.</p>
            ) : (
              register.vehicles.map((v) => (
                <div key={v.vehicle_id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{v.label ?? "Registration not recorded"}</p>
                    <p className="text-xs text-muted-foreground">
                      {pretty(v.vehicle_type)}
                      {v.vehicle_category ? ` · ${v.vehicle_category}` : ""}
                      {v.make || v.model ? ` · ${[v.make, v.model, v.year].filter(Boolean).join(" ")}` : ""}
                      {v.seating_capacity ? ` · ${v.seating_capacity} seats` : ""}
                      {v.documents.length > 0
                        ? ` · ${v.documents.length} paper${v.documents.length === 1 ? "" : "s"} filed`
                        : " · no papers filed"}
                      {v.assignments > 0 ? ` · on ${v.assignments} contract${v.assignments === 1 ? "" : "s"}` : ""}
                    </p>
                  </div>
                  <Badge variant={v.status === "active" ? "default" : "secondary"} className="text-[10px]">
                    {pretty(v.status)}
                  </Badge>
                </div>
              ))
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
