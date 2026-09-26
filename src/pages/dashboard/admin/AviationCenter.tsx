import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Lock, RefreshCw } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  charterApi, type CharterAuditRow, type CharterBookingRow,
  type CharterInventoryRow, type CharterQuoteRow,
} from "@/lib/charter/api";
import { CHARTER_CATALOG } from "@/lib/charter/catalog";
import { InventoryBulkEditor } from "@/components/charter/InventoryBulkEditor";
import { FlightEventDialog } from "@/components/charter/FlightEventDialog";
import { downloadAuditCsv } from "@/lib/charter/auditExport";
import { AuditEvidenceCell } from "@/components/charter/AuditEvidenceCell";
import { FLIGHT_REASON_CODES } from "@/lib/charter/access";
import { SortableHead, TablePagination } from "@/components/charter/TableControls";
import { useTableView } from "@/lib/charter/useTableView";
import { charterAccess, reasonLabel } from "@/lib/charter/access";
import { useAuth } from "@/hooks/useAuth";

const INVENTORY_STATUS = ["available", "limited", "on-request", "maintenance", "retired"];
const QUOTE_STATUS = ["requested", "priced", "accepted", "declined", "expired", "converted"];

const lastEvent = (b: CharterBookingRow) =>
  (b.flight_events ?? []).slice(-1)[0] ?? null;

/** Sort accessors — keys must match the SortableHead sortKey props below. */
const AUDIT_SORTERS = {
  created_at: (a: CharterAuditRow) => Date.parse(a.created_at),
  action: (a: CharterAuditRow) => a.action,
  reference: (a: CharterAuditRow) => a.reference,
  actor_email: (a: CharterAuditRow) => a.actor_email,
  total: (a: CharterAuditRow) => Number(a.total ?? 0),
  evidence_url: (a: CharterAuditRow) => a.evidence_url ?? "",
};

const BOOKING_SORTERS = {
  reference: (b: CharterBookingRow) => b.reference,
  asset_name: (b: CharterBookingRow) => b.asset_name,
  amount: (b: CharterBookingRow) => Number(b.amount ?? 0),
  payment_status: (b: CharterBookingRow) => `${b.payment_method} ${b.payment_status}`,
  flight_status: (b: CharterBookingRow) => b.flight_status,
  last_event: (b: CharterBookingRow) => (lastEvent(b) ? Date.parse(lastEvent(b)!.at) : null),
};

export default function AviationCenter() {
  const { roles, loading: authLoading } = useAuth();
  const access = useMemo(() => charterAccess(roles), [roles]);
  const [inventory, setInventory] = useState<CharterInventoryRow[]>([]);
  const [quotes, setQuotes] = useState<CharterQuoteRow[]>([]);
  const [bookings, setBookings] = useState<CharterBookingRow[]>([]);
  const [audit, setAudit] = useState<CharterAuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<string>("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [auditQuery, setAuditQuery] = useState("");
  const [auditActor, setAuditActor] = useState("");
  const [auditFrom, setAuditFrom] = useState("");
  const [auditTo, setAuditTo] = useState("");
  const [auditReason, setAuditReason] = useState("all");


  const filteredAudit = useMemo(() => {
    const q = auditQuery.trim().toLowerCase();
    const actor = auditActor.trim().toLowerCase();
    const fromTs = auditFrom ? Date.parse(auditFrom) : null;
    const toTs = auditTo ? Date.parse(auditTo) + 86_399_000 : null;
    return audit.filter((a) => {
      if (q && ![a.reference, a.entity_id, a.asset_name, a.action]
        .some((v) => String(v ?? "").toLowerCase().includes(q))) return false;
      if (actor && !String(a.actor_email ?? "").toLowerCase().includes(actor)) return false;
      const ts = Date.parse(a.created_at);
      if (fromTs && ts < fromTs) return false;
      if (toTs && ts > toTs) return false;
      if (auditReason !== "all") {
        const rc = (a.breakdown as { reason_code?: string } | null)?.reason_code
          ?? (a.cost_settings as { reason_code?: string } | null)?.reason_code;
        if (rc !== auditReason) return false;
      }
      return true;
    });
  }, [audit, auditQuery, auditActor, auditFrom, auditTo, auditReason]);

  const auditView = useTableView<CharterAuditRow>(filteredAudit, AUDIT_SORTERS);
  const bookingView = useTableView<CharterBookingRow>(bookings, BOOKING_SORTERS);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [inv, qs, bs, au] = await Promise.all([
        charterApi.inventory(),
        charterApi.listQuotes(),
        charterApi.listBookings(),
        access.canViewPricingAudit
          ? charterApi.auditTrail().catch(() => [] as CharterAuditRow[])
          : Promise.resolve([] as CharterAuditRow[]),
      ]);
      setInventory(inv);
      setQuotes(qs);
      setBookings(bs);
      setAudit(au);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [access.canViewPricingAudit]);


  useEffect(() => {
    if (!authLoading) void load();
  }, [load, authLoading]);

  const filteredInventory = useMemo(
    () => (category === "all" ? inventory : inventory.filter((i) => i.category_slug === category)),
    [inventory, category],
  );

  const patch = async (table: string, id: string, body: Record<string, unknown>) => {
    try {
      await charterApi.adminUpdate(table, id, body);
      toast({ title: "Updated", description: "Change saved." });
      void load();
    } catch (e) {
      toast({ title: "Update failed", description: e instanceof Error ? e.message : "Error", variant: "destructive" });
    }
  };

  const allSelected = filteredInventory.length > 0 && selected.length === filteredInventory.length;

  const toggleSelect = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  /** Persist an availability window, rejecting inverted ranges. */
  const saveWindow = (row: CharterInventoryRow, from: string, to: string) => {
    if (from && to && from > to) {
      toast({ title: "Invalid window", description: "End date is before the start date.", variant: "destructive" });
      return;
    }
    const next: Record<string, unknown> = {};
    if (from !== (row.available_from?.slice(0, 10) ?? "")) next.available_from = from || null;
    if (to !== (row.available_to?.slice(0, 10) ?? "")) next.available_to = to || null;
    if (Object.keys(next).length) patch("charter_inventory", row.id, next);
  };



  const kpis = [
    { label: "Active assets", value: inventory.filter((i) => i.active).length },
    { label: "Open quotes", value: quotes.filter((q) => !["converted", "declined", "expired"].includes(q.status)).length },
    { label: "Confirmed bookings", value: bookings.filter((b) => b.status === "confirmed").length },
    { label: "In flight", value: bookings.filter((b) => ["departed", "en_route", "boarding"].includes(b.flight_status)).length },
  ];

  if (authLoading || loading) return <Skeleton className="h-96 w-full" />;
  if (!access.isOperator) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Lock className="h-4 w-4" /> Aviation Center is restricted
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          You need a charter operator or aviation admin role to open this workspace.
        </CardContent>
      </Card>
    );
  }
  if (error) return <p className="text-destructive">{error}</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Aviation &amp; Charter Center</h1>
          <p className="text-sm text-muted-foreground">
            Manage inventory, availability, quote requests and bookings.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge variant="outline">{access.isAdmin ? "Aviation admin" : "Charter operator"}</Badge>
            <Badge variant="outline">Inventory: {access.canManageInventory ? "manage" : "read-only"}</Badge>
            <Badge variant="outline">Pricing audit: {access.canViewPricingAudit ? "full" : "restricted"}</Badge>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          <RefreshCw className="mr-2 h-4 w-4" /> Refresh
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k) => (
          <Card key={k.label}>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">{k.label}</CardTitle></CardHeader>
            <CardContent><p className="text-3xl font-semibold">{k.value}</p></CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="inventory">
        <TabsList>
          <TabsTrigger value="inventory">Inventory &amp; availability</TabsTrigger>
          {access.canManageCommercial && <TabsTrigger value="quotes">Quote requests</TabsTrigger>}
          <TabsTrigger value="bookings">Bookings &amp; flight status</TabsTrigger>
          {access.canViewPricingAudit && <TabsTrigger value="audit">Pricing audit</TabsTrigger>}
        </TabsList>

        <TabsContent value="inventory" className="mt-4 space-y-4">
          <div className="w-64">
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger aria-label="Filter by category"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {CHARTER_CATALOG.map((c) => (
                  <SelectItem key={c.slug} value={c.slug}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selected.length > 0 && (
            <InventoryBulkEditor
              selectedIds={selected}
              statuses={INVENTORY_STATUS}
              onSaved={() => void load()}
              onClear={() => setSelected([])}
            />
          )}

          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        aria-label="Select all assets"
                        checked={allSelected}
                        onCheckedChange={(v) =>
                          setSelected(v === true ? filteredInventory.map((i) => i.id) : [])
                        }
                      />
                    </TableHead>
                    <TableHead>Asset</TableHead><TableHead>Category</TableHead><TableHead>Operator</TableHead>
                    <TableHead>Rate</TableHead><TableHead>Status</TableHead>
                    <TableHead>Availability window</TableHead><TableHead>Empty leg</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredInventory.map((i) => (
                    <TableRow key={i.id} data-state={selected.includes(i.id) ? "selected" : undefined}>
                      <TableCell>
                        <Checkbox
                          aria-label={`Select ${i.name}`}
                          checked={selected.includes(i.id)}
                          onCheckedChange={() => toggleSelect(i.id)}
                        />
                      </TableCell>
                      <TableCell>
                        <p className="font-medium">{i.name}</p>
                        <p className="text-xs text-muted-foreground">{i.capacity}</p>
                      </TableCell>
                      <TableCell className="text-sm">{i.category_slug}</TableCell>
                      <TableCell className="text-sm">{i.operator_name ?? "—"}</TableCell>
                      <TableCell>
                        <Input
                          className="w-28"
                          aria-label={`Base rate for ${i.name}`}
                          defaultValue={String(i.base_rate)}
                          inputMode="decimal"
                          onBlur={(e) => {
                            const n = Number(e.target.value);
                            if (!Number.isFinite(n) || n < 0) {
                              toast({ title: "Invalid rate", description: "Enter a positive number.", variant: "destructive" });
                              e.target.value = String(i.base_rate);
                              return;
                            }
                            if (n !== Number(i.base_rate)) patch("charter_inventory", i.id, { base_rate: n });
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        <Select value={i.status} onValueChange={(v) => patch("charter_inventory", i.id, { status: v })}>
                          <SelectTrigger className="w-36" aria-label={`Status for ${i.name}`}><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {INVENTORY_STATUS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Input
                            type="date" className="w-36" aria-label={`Available from for ${i.name}`}
                            defaultValue={i.available_from?.slice(0, 10) ?? ""}
                            onBlur={(e) => saveWindow(i, e.target.value, i.available_to?.slice(0, 10) ?? "")}
                          />
                          <Input
                            type="date" className="w-36" aria-label={`Available to for ${i.name}`}
                            defaultValue={i.available_to?.slice(0, 10) ?? ""}
                            onBlur={(e) => saveWindow(i, i.available_from?.slice(0, 10) ?? "", e.target.value)}
                          />
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Input
                            className="w-40" placeholder="Offer label" aria-label={`Empty-leg label for ${i.name}`}
                            defaultValue={i.offer_label ?? ""}
                            onBlur={(e) => {
                              if (e.target.value !== (i.offer_label ?? "")) {
                                patch("charter_inventory", i.id, { offer_label: e.target.value.slice(0, 80) });
                              }
                            }}
                          />
                          <Input
                            className="w-20" inputMode="decimal" placeholder="%" aria-label={`Empty-leg discount for ${i.name}`}
                            defaultValue={String(i.offer_discount_pct ?? 0)}
                            onBlur={(e) => {
                              const d = Number(e.target.value);
                              if (!Number.isFinite(d) || d < 0 || d > 90) {
                                toast({ title: "Invalid discount", description: "Use 0–90%.", variant: "destructive" });
                                e.target.value = String(i.offer_discount_pct ?? 0);
                                return;
                              }
                              if (d !== Number(i.offer_discount_pct ?? 0)) patch("charter_inventory", i.id, { offer_discount_pct: d });
                            }}
                          />
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="ghost" onClick={() => patch("charter_inventory", i.id, { active: !i.active })}>
                          {i.active ? "Delist" : "Relist"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!filteredInventory.length && (
                    <TableRow><TableCell colSpan={9} className="text-sm text-muted-foreground">No inventory for this category.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>



        <TabsContent value="quotes" className="mt-4">
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reference</TableHead><TableHead>Asset</TableHead><TableHead>Duration</TableHead>
                    <TableHead>Total</TableHead><TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {quotes.map((q) => (
                    <TableRow key={q.id}>
                      <TableCell className="font-mono text-xs">{q.reference}</TableCell>
                      <TableCell>{q.asset_name}</TableCell>
                      <TableCell>{q.duration} × {q.quantity}</TableCell>
                      <TableCell>{q.currency} {Number(q.total).toLocaleString()}</TableCell>
                      <TableCell>
                        <Select value={q.status} onValueChange={(v) => patch("charter_quotes", q.id, { status: v })}>
                          <SelectTrigger className="w-40" aria-label={`Status for ${q.reference}`}><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {QUOTE_STATUS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!quotes.length && <TableRow><TableCell colSpan={5} className="text-sm text-muted-foreground">No quote requests yet.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="bookings" className="mt-4">
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableHead label="Reference" sortKey="reference" sort={bookingView.sort} onSort={bookingView.toggleSort} />
                    <SortableHead label="Asset" sortKey="asset_name" sort={bookingView.sort} onSort={bookingView.toggleSort} />
                    <SortableHead label="Amount" sortKey="amount" sort={bookingView.sort} onSort={bookingView.toggleSort} />
                    <SortableHead label="Payment" sortKey="payment_status" sort={bookingView.sort} onSort={bookingView.toggleSort} />
                    <SortableHead label="Flight status" sortKey="flight_status" sort={bookingView.sort} onSort={bookingView.toggleSort} />
                    <TableHead className="text-right">Status event</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bookingView.rows.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell className="font-mono text-xs">{b.reference}</TableCell>
                      <TableCell>{b.asset_name}</TableCell>
                      <TableCell>{b.currency} {Number(b.amount).toLocaleString()}</TableCell>
                      <TableCell><Badge variant="outline">{b.payment_method} · {b.payment_status}</Badge></TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <Badge variant="secondary" className="w-fit">{b.flight_status}</Badge>
                          {lastEvent(b) && (
                            <span className="text-xs text-muted-foreground">
                              {new Date(lastEvent(b)!.at).toLocaleString()}
                              {lastEvent(b)!.reason_code ? ` · ${reasonLabel(lastEvent(b)!.reason_code)}` : ""}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {access.canManageFlightStatus
                          ? <FlightEventDialog booking={b} onSaved={() => void load()} />
                          : <span className="text-xs text-muted-foreground">Read-only</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!bookings.length && <TableRow><TableCell colSpan={6} className="text-sm text-muted-foreground">No bookings yet.</TableCell></TableRow>}
                </TableBody>
              </Table>
              <TablePagination
                info={bookingView.info} pageSize={bookingView.pageSize} label="bookings"
                onPageChange={bookingView.setPage} onPageSizeChange={bookingView.setPageSize}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit" className="mt-4 space-y-3">
          <Card>
            <CardContent className="grid gap-3 p-4 md:grid-cols-5">
              <div>
                <label htmlFor="au-q" className="text-xs text-muted-foreground">Booking / reference</label>
                <Input id="au-q" className="mt-1" placeholder="CH-… or booking ID"
                  value={auditQuery} onChange={(e) => setAuditQuery(e.target.value)} />
              </div>
              <div>
                <label htmlFor="au-actor" className="text-xs text-muted-foreground">Operator / admin</label>
                <Input id="au-actor" className="mt-1" placeholder="email"
                  value={auditActor} onChange={(e) => setAuditActor(e.target.value)} />
              </div>
              <div>
                <label htmlFor="au-from" className="text-xs text-muted-foreground">From</label>
                <Input id="au-from" type="date" className="mt-1"
                  value={auditFrom} onChange={(e) => setAuditFrom(e.target.value)} />
              </div>
              <div>
                <label htmlFor="au-to" className="text-xs text-muted-foreground">To</label>
                <Input id="au-to" type="date" className="mt-1"
                  value={auditTo} onChange={(e) => setAuditTo(e.target.value)} />
              </div>
              <div>
                <label htmlFor="au-reason" className="text-xs text-muted-foreground">Reason code</label>
                <Select value={auditReason} onValueChange={setAuditReason}>
                  <SelectTrigger id="au-reason" className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All reason codes</SelectItem>
                    {FLIGHT_REASON_CODES.map((r) => (
                      <SelectItem key={r.code} value={r.code}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Showing {filteredAudit.length} of {audit.length} entries
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => {
                setAuditQuery(""); setAuditActor(""); setAuditFrom(""); setAuditTo(""); setAuditReason("all");
              }}>Clear filters</Button>
              <Button data-analytics="aviationcenter.export_csv"
                size="sm" variant="outline" disabled={!filteredAudit.length}
                onClick={() => downloadAuditCsv(filteredAudit)}
              >
                <Download className="mr-2 h-4 w-4" /> Export CSV ({filteredAudit.length})
              </Button>
            </div>
          </div>
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableHead label="When" sortKey="created_at" sort={auditView.sort} onSort={auditView.toggleSort} />
                    <SortableHead label="Action" sortKey="action" sort={auditView.sort} onSort={auditView.toggleSort} />
                    <SortableHead label="Reference" sortKey="reference" sort={auditView.sort} onSort={auditView.toggleSort} />
                    <SortableHead label="Actor" sortKey="actor_email" sort={auditView.sort} onSort={auditView.toggleSort} />
                    <TableHead>Changed pricing fields</TableHead>
                    <SortableHead label="Total" sortKey="total" sort={auditView.sort} onSort={auditView.toggleSort} />
                    <TableHead>Evidence</TableHead>
                    <SortableHead label="Document" sortKey="evidence_url" sort={auditView.sort} onSort={auditView.toggleSort} />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {auditView.rows.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="text-xs">{new Date(a.created_at).toLocaleString()}</TableCell>
                      <TableCell><Badge variant="outline">{a.action}</Badge></TableCell>
                      <TableCell className="font-mono text-xs">{a.reference ?? "—"}</TableCell>
                      <TableCell className="text-xs">{a.actor_email ?? "—"}</TableCell>
                      <TableCell className="text-xs">
                        {a.changed_fields?.length
                          ? a.changed_fields.map((c) => `${c.field}: ${String(c.from ?? "—")} → ${String(c.to ?? "—")}`).join(", ")
                          : "No pricing changes"}
                      </TableCell>
                      <TableCell className="text-xs">{a.currency} {Number(a.total).toLocaleString()}</TableCell>
                      <TableCell className="font-mono text-xs">{a.evidence_hash}</TableCell>
                      <TableCell>
                        <AuditEvidenceCell entry={a} canEdit={access.canManageInventory} onSaved={() => void load()} />
                      </TableCell>
                    </TableRow>
                  ))}
                  {!filteredAudit.length && (
                    <TableRow><TableCell colSpan={8} className="text-sm text-muted-foreground">No pricing audit entries match these filters.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
              <TablePagination
                info={auditView.info} pageSize={auditView.pageSize} label="audit entries"
                onPageChange={auditView.setPage} onPageSizeChange={auditView.setPageSize}
              />
            </CardContent>

          </Card>
        </TabsContent>
      </Tabs>

    </div>
  );
}
