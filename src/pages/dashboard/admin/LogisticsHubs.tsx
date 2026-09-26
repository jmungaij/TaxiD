import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertTriangle, Building2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  CROSS_DOCK_STAGES,
  HUB_CAPABILITIES,
  HUB_STATUSES,
  HUB_TYPES,
  WEEKDAYS,
  assignOperator,
  auditDiff,
  availableCapacity,
  deleteClosure,
  deleteServiceArea,
  hubOpenAt,
  hubReadiness,
  hubServesLocation,
  loadClosures,
  loadContacts,
  loadHubAudit,
  loadHubs,
  loadOperatingHours,
  loadServiceAreas,
  loadStageRows,
  processPackage,
  retireContact,
  saveClosure,
  saveContact,
  saveHub,
  saveServiceArea,
  setHubCapabilities,
  setHubCapacity,
  setHubStatus,
  setOperatingHours,
  type AreaType,
  type CrossDockStage,
  type HubAuditEntry,
  type HubClosure,
  type HubContact,
  type HubInput,
  type HubOperatingHour,
  type HubRecord,
  type HubServiceArea,
  type HubStageRow,
  type HubStatus,
} from "@/lib/logistics/hubs/hubEngine";

const EMPTY_FORM: HubInput = {
  id: null,
  code: "",
  name: "",
  hubType: "depot",
  city: "",
  address: "",
  lat: null,
  lng: null,
  region: "",
  countryCode: "KE",
  timezone: "Africa/Nairobi",
  capabilities: [],
  capacityUnit: "parcels",
  maxCapacity: null,
  contactName: "",
  contactPhone: "",
  contactEmail: "",
  notes: "",
};

function toForm(hub: HubRecord): HubInput {
  return {
    id: hub.id,
    code: hub.code,
    name: hub.name,
    hubType: hub.hub_type,
    city: hub.city ?? "",
    address: hub.address ?? "",
    lat: hub.lat,
    lng: hub.lng,
    region: hub.region ?? "",
    countryCode: hub.country_code ?? "KE",
    timezone: hub.timezone ?? "Africa/Nairobi",
    capabilities: hub.capabilities ?? [],
    capacityUnit: hub.capacity_unit ?? "parcels",
    maxCapacity: hub.max_capacity,
    contactName: hub.contact_name ?? "",
    contactPhone: hub.contact_phone ?? "",
    contactEmail: hub.contact_email ?? "",
    responsibleOperatorId: hub.responsible_operator_id,
    notes: hub.notes ?? "",
  };
}

const STATUS_VARIANT: Record<HubStatus, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "outline",
  active: "default",
  suspended: "destructive",
  inactive: "secondary",
};

/**
 * Hub Administration — the owner surface over `logistics_hubs` and its
 * satellites (service areas, operating hours, contacts, cross-dock staging).
 * Every control executes a permission-checked server RPC that records history;
 * nothing on this page mutates a row directly.
 */
export default function LogisticsHubs() {
  const [hubs, setHubs] = useState<HubRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<HubStatus | "all">("all");
  const [capabilityFilter, setCapabilityFilter] = useState<string>("all");
  const [form, setForm] = useState<HubInput | null>(null);
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState<HubRecord | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await loadHubs(true);
      setHubs(rows);
      setDetail((d) => (d ? rows.find((r) => r.id === d.id) ?? null : null));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load hubs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return hubs.filter((h) => {
      if (statusFilter !== "all" && h.status !== statusFilter) return false;
      if (capabilityFilter !== "all" && !(h.capabilities ?? []).includes(capabilityFilter)) return false;
      if (!q) return true;
      return [h.code, h.name, h.city ?? "", h.region ?? ""].some((v) => v.toLowerCase().includes(q));
    });
  }, [hubs, search, statusFilter, capabilityFilter]);

  const stats = useMemo(
    () => ({
      total: hubs.length,
      active: hubs.filter((h) => h.status === "active").length,
      dispatch: hubs.filter((h) => h.status === "active" && (h.capabilities ?? []).includes("dispatch")).length,
      crossDock: hubs.filter((h) => h.status === "active" && (h.capabilities ?? []).includes("cross_dock")).length,
    }),
    [hubs],
  );

  async function onSave() {
    if (!form) return;
    if (!form.code.trim() || !form.name.trim()) {
      toast.error("Hub code and name are required");
      return;
    }
    setSaving(true);
    try {
      await saveHub(form);
      toast.success(form.id ? "Hub updated" : "Hub created as draft");
      setForm(null);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function onStatus(hub: HubRecord, status: HubStatus) {
    try {
      await setHubStatus(hub.id, status);
      toast.success(`Hub ${status}`);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Status change failed");
    }
  }

  function patch(next: Partial<HubInput>) {
    setForm((f) => (f ? { ...f, ...next } : f));
  }

  function toggleCapability(value: string) {
    setForm((f) => {
      if (!f) return f;
      const current = f.capabilities ?? [];
      return {
        ...f,
        capabilities: current.includes(value)
          ? current.filter((c) => c !== value)
          : [...current, value],
      };
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Building2 className="h-6 w-6" /> Hub Administration
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Depots, warehouses, cross-docks and returns points. Capability flags, service area and
            lifecycle status decide what the manifest and dispatch spine may use a hub for.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw className="h-4 w-4 mr-2" /> Refresh
          </Button>
          <Button onClick={() => setForm({ ...EMPTY_FORM })}>
            <Plus className="h-4 w-4 mr-2" /> New hub
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Hubs", value: stats.total },
          { label: "Active", value: stats.active },
          { label: "Dispatch-capable", value: stats.dispatch },
          { label: "Cross-dock", value: stats.crossDock },
        ].map((s) => (
          <Card key={s.label} className="p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{s.label}</div>
            <div className="text-2xl font-semibold mt-1">{s.value}</div>
          </Card>
        ))}
      </div>

      {hubs.length === 0 && !loading && (
        <Card className="p-4 border-dashed">
          <div className="text-sm">
            <Badge variant="outline" className="mr-2">OWNER_CONFIGURATION_REQUIRED</Badge>
            No hub has been configured yet. The administrator workflow is complete and ready — hub
            operations report as unconfigured until a real hub is created and activated.
          </div>
        </Card>
      )}

      <Card className="p-4 space-y-4">
        <div className="flex flex-wrap gap-3">
          <Input
            placeholder="Search by code, name, city or region"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-sm"
          />
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as HubStatus | "all")}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {HUB_STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={capabilityFilter} onValueChange={setCapabilityFilter}>
            <SelectTrigger className="w-52">
              <SelectValue placeholder="Capability" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All capabilities</SelectItem>
              {HUB_CAPABILITIES.map((c) => (
                <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4" /> {error}
          </div>
        )}

        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-sm text-muted-foreground py-6 text-center">
            No hubs match this view.
          </div>
        ) : (
          <div className="divide-y">
            {filtered.map((hub) => (
              <div key={hub.id} className="py-3 flex flex-wrap items-center gap-3">
                <div className="min-w-[220px] flex-1">
                  <div className="font-medium flex items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{hub.code}</span>
                    {hub.name}
                    <Badge variant={STATUS_VARIANT[hub.status]}>{hub.status}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {HUB_TYPES.find((t) => t.value === hub.hub_type)?.label ?? hub.hub_type}
                    {hub.city ? ` · ${hub.city}` : ""}
                    {hub.region ? ` · ${hub.region}` : ""}
                    {` · ${hub.country_code} · ${hub.timezone}`}
                    {hub.max_capacity !== null
                      ? ` · ${availableCapacity(hub)}/${hub.max_capacity} ${hub.capacity_unit} free`
                      : ""}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1 max-w-sm">
                  {(hub.capabilities ?? []).length === 0 ? (
                    <span className="text-xs text-muted-foreground">No capabilities declared</span>
                  ) : (
                    (hub.capabilities ?? []).map((c) => (
                      <Badge key={c} variant="secondary" className="text-[10px]">
                        {HUB_CAPABILITIES.find((x) => x.value === c)?.label ?? c}
                      </Badge>
                    ))
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => setForm(toForm(hub))}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDetail(hub)}>
                    Details
                  </Button>
                  <Select value={hub.status} onValueChange={(v) => void onStatus(hub, v as HubStatus)}>
                    <SelectTrigger className="w-32 h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {HUB_STATUSES.map((s) => (
                        <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ------------------------------ hub editor ----------------------------- */}
      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form?.id ? "Edit hub" : "New hub"}</DialogTitle>
          </DialogHeader>
          {form && (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label>Code</Label>
                  <Input
                    value={form.code}
                    onChange={(e) => patch({ code: e.target.value.toUpperCase() })}
                    placeholder="NBO-DEPOT-01"
                  />
                </div>
                <div>
                  <Label>Name</Label>
                  <Input value={form.name} onChange={(e) => patch({ name: e.target.value })} />
                </div>
                <div>
                  <Label>Type</Label>
                  <Select value={String(form.hubType)} onValueChange={(v) => patch({ hubType: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {HUB_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Timezone</Label>
                  <Input
                    value={form.timezone ?? ""}
                    onChange={(e) => patch({ timezone: e.target.value })}
                    placeholder="Africa/Nairobi"
                  />
                </div>
                <div>
                  <Label>Country code</Label>
                  <Input
                    value={form.countryCode ?? "KE"}
                    onChange={(e) => patch({ countryCode: e.target.value.toUpperCase() })}
                  />
                </div>
                <div>
                  <Label>City</Label>
                  <Input value={form.city ?? ""} onChange={(e) => patch({ city: e.target.value })} />
                </div>
                <div>
                  <Label>Region</Label>
                  <Input value={form.region ?? ""} onChange={(e) => patch({ region: e.target.value })} />
                </div>
                <div>
                  <Label>Address</Label>
                  <Input value={form.address ?? ""} onChange={(e) => patch({ address: e.target.value })} />
                </div>
                <div>
                  <Label>Latitude</Label>
                  <Input
                    type="number"
                    value={form.lat ?? ""}
                    onChange={(e) => patch({ lat: e.target.value === "" ? null : Number(e.target.value) })}
                  />
                </div>
                <div>
                  <Label>Longitude</Label>
                  <Input
                    type="number"
                    value={form.lng ?? ""}
                    onChange={(e) => patch({ lng: e.target.value === "" ? null : Number(e.target.value) })}
                  />
                </div>
                <div>
                  <Label>Capacity unit</Label>
                  <Input
                    value={form.capacityUnit ?? "parcels"}
                    onChange={(e) => patch({ capacityUnit: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Maximum capacity</Label>
                  <Input
                    type="number"
                    value={form.maxCapacity ?? ""}
                    onChange={(e) =>
                      patch({ maxCapacity: e.target.value === "" ? null : Number(e.target.value) })
                    }
                  />
                </div>
              </div>

              <div>
                <Label>Capabilities</Label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {HUB_CAPABILITIES.map((c) => {
                    const on = (form.capabilities ?? []).includes(c.value);
                    return (
                      <Button
                        key={c.value}
                        type="button"
                        size="sm"
                        variant={on ? "default" : "outline"}
                        onClick={() => toggleCapability(c.value)}
                      >
                        {c.label}
                      </Button>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  A hub cannot be activated without at least one capability, and cross-dock movements
                  are rejected server-side when the matching capability is missing.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <Label>Site contact</Label>
                  <Input value={form.contactName ?? ""} onChange={(e) => patch({ contactName: e.target.value })} />
                </div>
                <div>
                  <Label>Contact phone</Label>
                  <Input value={form.contactPhone ?? ""} onChange={(e) => patch({ contactPhone: e.target.value })} />
                </div>
                <div>
                  <Label>Contact email</Label>
                  <Input value={form.contactEmail ?? ""} onChange={(e) => patch({ contactEmail: e.target.value })} />
                </div>
              </div>

              <div>
                <Label>Responsible operator (staff user id)</Label>
                <Input
                  value={form.responsibleOperatorId ?? ""}
                  onChange={(e) => patch({ responsibleOperatorId: e.target.value || null })}
                  placeholder="Existing staff identity — validated server-side"
                />
              </div>

              <div>
                <Label>Operational notes</Label>
                <Textarea value={form.notes ?? ""} onChange={(e) => patch({ notes: e.target.value })} rows={3} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)} disabled={saving}>Cancel</Button>
            <Button onClick={() => void onSave()} disabled={saving}>
              {saving ? "Saving…" : "Save hub"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {detail && <HubDetail hub={detail} onClose={() => setDetail(null)} onChanged={() => void refresh()} />}
    </div>
  );
}

/* ========================================================================== */
/* Hub detail — capacity, capabilities, areas, hours, contacts, cross-dock.   */
/* ========================================================================== */

function HubDetail({
  hub,
  onClose,
  onChanged,
}: {
  hub: HubRecord;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [areas, setAreas] = useState<HubServiceArea[]>([]);
  const [hours, setHours] = useState<HubOperatingHour[]>([]);
  const [closures, setClosures] = useState<HubClosure[]>([]);
  const [contacts, setContacts] = useState<HubContact[]>([]);
  const [stages, setStages] = useState<HubStageRow[]>([]);
  const [audit, setAudit] = useState<HubAuditEntry[]>([]);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [a, h, c, ct, st, au] = await Promise.all([
        loadServiceAreas(hub.id),
        loadOperatingHours(hub.id),
        loadClosures(hub.id),
        loadContacts(hub.id),
        loadStageRows(hub.id),
        loadHubAudit(hub.id),
      ]);
      setAreas(a);
      setHours(
        WEEKDAYS.map((d) =>
          h.find((x) => x.weekday === d.value) ?? { weekday: d.value, opens: "08:00", closes: "18:00", closed: true },
        ),
      );
      setClosures(c);
      setContacts(ct);
      setStages(st);
      setAudit(au);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load hub detail");
    }
  }, [hub.id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const readiness = hubReadiness(hub, {
    areas: areas.filter((a) => a.active).length,
    hours: hours.filter((h) => !h.closed).length,
    contacts: contacts.filter((c) => c.active).length,
    movements: stages.length,
  });

  async function run(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    try {
      await action();
      toast.success(message);
      await reload();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">{hub.code}</span>
            {hub.name}
            <Badge variant={STATUS_VARIANT[hub.status]}>{hub.status}</Badge>
            <Badge variant="outline">{readiness}</Badge>
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="capacity">
          <TabsList className="flex flex-wrap h-auto">
            <TabsTrigger value="capacity">Capacity</TabsTrigger>
            <TabsTrigger value="capabilities">Capabilities</TabsTrigger>
            <TabsTrigger value="areas">Service area</TabsTrigger>
            <TabsTrigger value="hours">Operating hours</TabsTrigger>
            <TabsTrigger value="contacts">Contacts</TabsTrigger>
            <TabsTrigger value="operator">Operator</TabsTrigger>
            <TabsTrigger value="crossdock">Cross-dock</TabsTrigger>
            <TabsTrigger value="audit">History</TabsTrigger>
          </TabsList>

          <TabsContent value="capacity" className="pt-4">
            <CapacityPanel hub={hub} busy={busy} run={run} />
          </TabsContent>

          <TabsContent value="capabilities" className="pt-4">
            <CapabilitiesPanel hub={hub} busy={busy} run={run} />
          </TabsContent>

          <TabsContent value="areas" className="pt-4">
            <AreasPanel hub={hub} areas={areas} busy={busy} run={run} />
          </TabsContent>

          <TabsContent value="hours" className="pt-4">
            <HoursPanel
              hub={hub}
              hours={hours}
              closures={closures}
              setHours={setHours}
              busy={busy}
              run={run}
            />
          </TabsContent>

          <TabsContent value="contacts" className="pt-4">
            <ContactsPanel hub={hub} contacts={contacts} busy={busy} run={run} />
          </TabsContent>

          <TabsContent value="operator" className="pt-4">
            <OperatorPanel hub={hub} busy={busy} run={run} />
          </TabsContent>

          <TabsContent value="crossdock" className="pt-4">
            <CrossDockPanel hub={hub} stages={stages} busy={busy} run={run} />
          </TabsContent>

          <TabsContent value="audit" className="pt-4">
            {audit.length === 0 ? (
              <div className="text-sm text-muted-foreground">No recorded changes yet.</div>
            ) : (
              <div className="space-y-3">
                {audit.map((entry) => {
                  const diff = auditDiff(entry);
                  return (
                    <div key={entry.id} className="border rounded-md p-3">
                      <div className="flex items-center justify-between">
                        <Badge variant="secondary">{entry.action}</Badge>
                        <span className="text-xs text-muted-foreground">
                          {new Date(entry.created_at).toLocaleString("en-KE", { timeZone: "Africa/Nairobi" })}
                        </span>
                      </div>
                      {diff.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {diff.slice(0, 12).map((d) => (
                            <div key={d.field} className="text-xs font-mono break-all">
                              <span className="text-muted-foreground">{d.field}:</span> {d.from} → {d.to}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

type Runner = (action: () => Promise<unknown>, message: string) => Promise<void>;

function CapacityPanel({ hub, busy, run }: { hub: HubRecord; busy: boolean; run: Runner }) {
  const [max, setMax] = useState<string>(hub.max_capacity?.toString() ?? "");
  const [current, setCurrent] = useState<string>(String(hub.current_capacity ?? 0));
  const [unit, setUnit] = useState(hub.capacity_unit ?? "parcels");

  const maxNum = max === "" ? null : Number(max);
  const currentNum = Number(current || 0);
  const available = maxNum === null ? null : Math.max(0, maxNum - currentNum);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-4">
        <div>
          <Label>Maximum</Label>
          <Input type="number" value={max} onChange={(e) => setMax(e.target.value)} />
        </div>
        <div>
          <Label>Current</Label>
          <Input type="number" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </div>
        <div>
          <Label>Unit</Label>
          <Input value={unit} onChange={(e) => setUnit(e.target.value)} />
        </div>
        <div>
          <Label>Available</Label>
          <div className="h-10 flex items-center text-sm">
            {available === null ? "Uncapped" : `${available} ${unit}`}
          </div>
        </div>
      </div>
      <Button
        disabled={busy}
        onClick={() => void run(() => setHubCapacity(hub.id, maxNum, currentNum, unit), "Capacity updated")}
      >
        Save capacity
      </Button>
      <p className="text-xs text-muted-foreground">
        The server rejects negative values and a current load above the maximum.
      </p>
    </div>
  );
}

function CapabilitiesPanel({ hub, busy, run }: { hub: HubRecord; busy: boolean; run: Runner }) {
  const [caps, setCaps] = useState<string[]>(hub.capabilities ?? []);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {HUB_CAPABILITIES.map((c) => {
          const on = caps.includes(c.value);
          return (
            <Button
              key={c.value}
              size="sm"
              variant={on ? "default" : "outline"}
              onClick={() =>
                setCaps((prev) => (on ? prev.filter((x) => x !== c.value) : [...prev, c.value]))
              }
            >
              {c.label}
            </Button>
          );
        })}
      </div>
      <Button disabled={busy} onClick={() => void run(() => setHubCapabilities(hub.id, caps), "Capabilities updated")}>
        Save capabilities
      </Button>
    </div>
  );
}

function AreasPanel({
  hub,
  areas,
  busy,
  run,
}: {
  hub: HubRecord;
  areas: HubServiceArea[];
  busy: boolean;
  run: Runner;
}) {
  const [areaType, setAreaType] = useState<AreaType>("radius");
  const [label, setLabel] = useState("");
  const [city, setCity] = useState("");
  const [region, setRegion] = useState("");
  const [corridor, setCorridor] = useState("");
  const [lat, setLat] = useState(hub.lat?.toString() ?? "");
  const [lng, setLng] = useState(hub.lng?.toString() ?? "");
  const [radius, setRadius] = useState("10");
  const [polygon, setPolygon] = useState("");
  const [testLat, setTestLat] = useState("");
  const [testLng, setTestLng] = useState("");
  const [testResult, setTestResult] = useState<string | null>(null);

  async function add() {
    let parsedPolygon: number[][] | null = null;
    if (areaType === "polygon") {
      try {
        parsedPolygon = JSON.parse(polygon) as number[][];
      } catch {
        toast.error("Polygon must be JSON like [[lng,lat],[lng,lat],[lng,lat]]");
        return;
      }
    }
    await run(
      () =>
        saveServiceArea({
          hubId: hub.id,
          areaType,
          label: label || null,
          city: city || null,
          region: region || null,
          corridorCode: corridor || null,
          centerLat: areaType === "radius" ? Number(lat) : null,
          centerLng: areaType === "radius" ? Number(lng) : null,
          radiusKm: areaType === "radius" ? Number(radius) : null,
          polygon: parsedPolygon,
        }),
      "Service area added",
    );
  }

  async function test() {
    try {
      const ok = await hubServesLocation(hub.id, {
        lat: testLat ? Number(testLat) : undefined,
        lng: testLng ? Number(testLng) : undefined,
        city: city || undefined,
      });
      setTestResult(ok ? "SERVED" : "NOT SERVED");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Serviceability check failed");
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {areas.length === 0 ? (
          <div className="text-sm text-muted-foreground">No service area defined.</div>
        ) : (
          areas.map((a) => (
            <div key={a.id} className="flex items-center justify-between border rounded-md p-2 text-sm">
              <div>
                <Badge variant="secondary" className="mr-2">{a.area_type}</Badge>
                {a.label ?? a.city ?? a.region ?? a.corridor_code ?? ""}
                {a.area_type === "radius" && ` · ${a.radius_km} km of ${a.center_lat}, ${a.center_lng}`}
              </div>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void run(() => deleteServiceArea(a.id), "Service area removed")}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))
        )}
      </div>

      <div className="border-t pt-4 grid gap-3 sm:grid-cols-3">
        <div>
          <Label>Area type</Label>
          <Select value={areaType} onValueChange={(v) => setAreaType(v as AreaType)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {(["radius", "polygon", "city", "region", "corridor"] as AreaType[]).map((t) => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Label</Label>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        {areaType === "radius" && (
          <>
            <div>
              <Label>Centre latitude</Label>
              <Input type="number" value={lat} onChange={(e) => setLat(e.target.value)} />
            </div>
            <div>
              <Label>Centre longitude</Label>
              <Input type="number" value={lng} onChange={(e) => setLng(e.target.value)} />
            </div>
            <div>
              <Label>Radius (km)</Label>
              <Input type="number" value={radius} onChange={(e) => setRadius(e.target.value)} />
            </div>
          </>
        )}
        {areaType === "polygon" && (
          <div className="sm:col-span-3">
            <Label>Polygon [[lng,lat], …]</Label>
            <Textarea rows={3} value={polygon} onChange={(e) => setPolygon(e.target.value)} />
          </div>
        )}
        {areaType === "city" && (
          <div>
            <Label>City</Label>
            <Input value={city} onChange={(e) => setCity(e.target.value)} />
          </div>
        )}
        {areaType === "region" && (
          <div>
            <Label>Region</Label>
            <Input value={region} onChange={(e) => setRegion(e.target.value)} />
          </div>
        )}
        {areaType === "corridor" && (
          <div>
            <Label>Corridor code</Label>
            <Input value={corridor} onChange={(e) => setCorridor(e.target.value)} />
          </div>
        )}
      </div>
      <Button disabled={busy} onClick={() => void add()}>Add service area</Button>

      <div className="border-t pt-4 space-y-2">
        <Label>Serviceability check (server-authoritative)</Label>
        <div className="flex flex-wrap gap-2 items-end">
          <Input className="w-40" placeholder="lat" value={testLat} onChange={(e) => setTestLat(e.target.value)} />
          <Input className="w-40" placeholder="lng" value={testLng} onChange={(e) => setTestLng(e.target.value)} />
          <Button variant="outline" onClick={() => void test()}>Check</Button>
          {testResult && <Badge variant={testResult === "SERVED" ? "default" : "destructive"}>{testResult}</Badge>}
        </div>
      </div>
    </div>
  );
}

function HoursPanel({
  hub,
  hours,
  closures,
  setHours,
  busy,
  run,
}: {
  hub: HubRecord;
  hours: HubOperatingHour[];
  closures: HubClosure[];
  setHours: (h: HubOperatingHour[]) => void;
  busy: boolean;
  run: Runner;
}) {
  const [closureDate, setClosureDate] = useState("");
  const [closureReason, setClosureReason] = useState("");
  const [openNow, setOpenNow] = useState<string | null>(null);

  function update(weekday: number, next: Partial<HubOperatingHour>) {
    setHours(hours.map((h) => (h.weekday === weekday ? { ...h, ...next } : h)));
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Evaluated in the hub timezone ({hub.timezone}), never UTC.
      </p>
      <div className="space-y-2">
        {hours.map((h) => (
          <div key={h.weekday} className="flex flex-wrap items-center gap-2">
            <span className="w-24 text-sm">{WEEKDAYS.find((d) => d.value === h.weekday)?.label}</span>
            <Input
              type="time"
              className="w-32"
              value={h.opens ?? ""}
              disabled={h.closed}
              onChange={(e) => update(h.weekday, { opens: e.target.value })}
            />
            <Input
              type="time"
              className="w-32"
              value={h.closes ?? ""}
              disabled={h.closed}
              onChange={(e) => update(h.weekday, { closes: e.target.value })}
            />
            <Button
              size="sm"
              variant={h.closed ? "destructive" : "outline"}
              onClick={() => update(h.weekday, { closed: !h.closed })}
            >
              {h.closed ? "Closed" : "Open"}
            </Button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Button disabled={busy} onClick={() => void run(() => setOperatingHours(hub.id, hours), "Operating hours saved")}>
          Save hours
        </Button>
        <Button
          variant="outline"
          onClick={async () => {
            try {
              setOpenNow((await hubOpenAt(hub.id)) ? "OPEN NOW" : "CLOSED NOW");
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Check failed");
            }
          }}
        >
          Check open now
        </Button>
        {openNow && <Badge variant={openNow === "OPEN NOW" ? "default" : "secondary"}>{openNow}</Badge>}
      </div>

      <div className="border-t pt-4 space-y-2">
        <Label>Dated closures / exceptions</Label>
        {closures.length === 0 ? (
          <div className="text-sm text-muted-foreground">No closures recorded.</div>
        ) : (
          closures.map((c) => (
            <div key={c.id} className="flex items-center justify-between border rounded-md p-2 text-sm">
              <span>
                {c.closure_date} — {c.closed ? "closed" : `${c.opens}–${c.closes}`}
                {c.reason ? ` · ${c.reason}` : ""}
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void run(() => deleteClosure(c.id), "Closure removed")}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))
        )}
        <div className="flex flex-wrap gap-2 items-end">
          <Input type="date" className="w-44" value={closureDate} onChange={(e) => setClosureDate(e.target.value)} />
          <Input
            className="w-64"
            placeholder="Reason (public holiday, stock take…)"
            value={closureReason}
            onChange={(e) => setClosureReason(e.target.value)}
          />
          <Button
            variant="outline"
            disabled={busy || !closureDate}
            onClick={() =>
              void run(() => saveClosure(hub.id, closureDate, closureReason || null, true), "Closure saved")
            }
          >
            Add closure
          </Button>
        </div>
      </div>
    </div>
  );
}

function ContactsPanel({
  hub,
  contacts,
  busy,
  run,
}: {
  hub: HubRecord;
  contacts: HubContact[];
  busy: boolean;
  run: Runner;
}) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [primary, setPrimary] = useState(false);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {contacts.length === 0 ? (
          <div className="text-sm text-muted-foreground">No contacts recorded.</div>
        ) : (
          contacts.map((c) => (
            <div key={c.id} className="flex items-center justify-between border rounded-md p-2 text-sm">
              <div>
                {c.name}
                {c.contact_role ? ` · ${c.contact_role}` : ""}
                {c.phone ? ` · ${c.phone}` : ""}
                {c.email ? ` · ${c.email}` : ""}
                {c.is_primary && <Badge className="ml-2">Primary</Badge>}
                {!c.active && <Badge variant="secondary" className="ml-2">Retired</Badge>}
              </div>
              {c.active && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void run(() => retireContact(c.id), "Contact retired")}
                >
                  Retire
                </Button>
              )}
            </div>
          ))
        )}
      </div>
      <div className="border-t pt-4 grid gap-3 sm:grid-cols-4">
        <div>
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label>Role</Label>
          <Input value={role} onChange={(e) => setRole(e.target.value)} />
        </div>
        <div>
          <Label>Phone</Label>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div>
          <Label>Email</Label>
          <Input value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
      </div>
      <div className="flex gap-2 items-center">
        <Button size="sm" variant={primary ? "default" : "outline"} onClick={() => setPrimary((p) => !p)}>
          {primary ? "Primary contact" : "Mark as primary"}
        </Button>
        <Button
          disabled={busy}
          onClick={() =>
            void run(
              () =>
                saveContact({
                  hubId: hub.id,
                  name,
                  contactRole: role || null,
                  phone: phone || null,
                  email: email || null,
                  isPrimary: primary,
                }),
              "Contact saved",
            )
          }
        >
          Add contact
        </Button>
      </div>
    </div>
  );
}

function OperatorPanel({ hub, busy, run }: { hub: HubRecord; busy: boolean; run: Runner }) {
  const [operator, setOperator] = useState(hub.responsible_operator_id ?? "");
  return (
    <div className="space-y-3">
      <Label>Responsible operator (staff user id)</Label>
      <Input value={operator} onChange={(e) => setOperator(e.target.value)} />
      <p className="text-xs text-muted-foreground">
        Validated against the existing staff identity model; the change is audited.
      </p>
      <Button
        disabled={busy}
        onClick={() => void run(() => assignOperator(hub.id, operator || null), "Responsible operator updated")}
      >
        Assign operator
      </Button>
    </div>
  );
}

function CrossDockPanel({
  hub,
  stages,
  busy,
  run,
}: {
  hub: HubRecord;
  stages: HubStageRow[];
  busy: boolean;
  run: Runner;
}) {
  const [packageId, setPackageId] = useState("");
  const [stage, setStage] = useState<CrossDockStage>("received");
  const [manifestId, setManifestId] = useState("");

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Package → inbound manifest → hub receipt → sort → staging → outbound manifest → dispatch.
        Every movement writes to the existing package chain of custody.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label>Package id</Label>
          <Input value={packageId} onChange={(e) => setPackageId(e.target.value)} />
        </div>
        <div>
          <Label>Stage</Label>
          <Select value={stage} onValueChange={(v) => setStage(v as CrossDockStage)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {CROSS_DOCK_STAGES.map((s) => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Manifest id (optional)</Label>
          <Input value={manifestId} onChange={(e) => setManifestId(e.target.value)} />
        </div>
      </div>
      <Button
        disabled={busy || !packageId}
        onClick={() =>
          void run(
            () => processPackage(hub.id, packageId, stage, manifestId || null),
            "Movement recorded with custody",
          )
        }
      >
        Record movement
      </Button>

      <div className="border-t pt-4 space-y-2">
        <Label>Packages currently at this hub</Label>
        {stages.length === 0 ? (
          <div className="text-sm text-muted-foreground">No packages staged at this hub.</div>
        ) : (
          stages.map((s) => (
            <div key={s.id} className="flex items-center justify-between border rounded-md p-2 text-xs font-mono">
              <span>{s.package_id}</span>
              <Badge variant="secondary">{s.stage}</Badge>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
