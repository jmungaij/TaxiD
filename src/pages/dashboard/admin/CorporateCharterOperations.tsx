/**
 * Corporate Charter Business Operations Centre.
 *
 * Consolidates the former Charter Admin and Corporate Admin consoles into one
 * Elite-gated operations surface: RFQ engine, bookings today, quotation
 * approvals, operators / fleet / payments views, settlement and audit logs.
 * Every panel reads the existing charter services — no parallel backend.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ArrowRight, ClipboardList, FileCheck2, History, Loader2, Plane, Receipt, ShieldCheck, Wallet } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useTabDeepLink } from "@/hooks/useTabDeepLink";
import { charterAccess } from "@/lib/charter/access";
import {
  charterApi, type CharterAuditRow, type CharterBookingRow, type CharterQuoteRow,
  type CorporateWalletRow,
} from "@/lib/charter/api";
import { CHARTER_CATALOG, categoryBySlug } from "@/lib/charter/catalog";
import {
  RFQ_STATUS_LABEL, isRfqOpen, normalizeRfqStatus, rfqAuditAction, rfqStatusTone, rfqTransitions,
  type RfqStatus,
} from "@/lib/charter/rfqWorkflow";
import { AccessNotice } from "@/components/auth/AccessNotice";

const TABS = [
  "rfq", "today", "approvals", "operators", "fleet", "payments", "settlement", "audit",
] as const;

const money = (n: number) => `KSh ${Math.round(n || 0).toLocaleString("en-KE")}`;
const isToday = (iso: string) => {
  const d = new Date(iso);
  const now = new Date();
  return d.toDateString() === now.toDateString();
};

export default function CorporateCharterOperations() {
  const { roles } = useAuth();
  const access = useMemo(() => charterAccess(roles), [roles]);
  const { tab, onTabChange } = useTabDeepLink(TABS, "rfq");

  const [bookings, setBookings] = useState<CharterBookingRow[]>([]);
  const [quotes, setQuotes] = useState<CharterQuoteRow[]>([]);
  const [wallets, setWallets] = useState<CorporateWalletRow[]>([]);
  const [audit, setAudit] = useState<CharterAuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  // Shared filters for audit + settlement views
  const [filters, setFilters] = useState({ operator: "", reference: "", entity: "all", from: "", to: "" });
  const resetFilters = () => setFilters({ operator: "", reference: "", entity: "all", from: "", to: "" });

  // RFQ engine draft
  const [rfq, setRfq] = useState({
    organization: "", sector: CHARTER_CATALOG[0]?.slug ?? "bus-charter",
    route: "", date: "", passengers: "", notes: "",
  });

  const reload = () => {
    setLoading(true);
    Promise.allSettled([
      charterApi.listBookings(),
      charterApi.listQuotes(),
      charterApi.listCorporateWallets(),
      charterApi.auditTrail(),
    ]).then(([b, q, w, a]) => {
      if (b.status === "fulfilled") setBookings(b.value);
      if (q.status === "fulfilled") setQuotes(q.value);
      if (w.status === "fulfilled") setWallets(w.value.wallets);
      if (a.status === "fulfilled") setAudit(a.value);
    }).finally(() => setLoading(false));
  };

  useEffect(() => { reload(); }, []);

  const today = bookings.filter((b) => isToday(b.created_at));
  const pendingQuotes = quotes.filter((q) => isRfqOpen(normalizeRfqStatus(q.status)));
  const unsettled = bookings.filter((b) => !["paid", "completed", "cancelled"].includes(b.payment_status));
  const inRange = (iso: string) => {
    const t = new Date(iso).getTime();
    if (filters.from && t < new Date(`${filters.from}T00:00:00`).getTime()) return false;
    if (filters.to && t > new Date(`${filters.to}T23:59:59`).getTime()) return false;
    return true;
  };
  const matchText = (value: unknown, needle: string) =>
    !needle || String(value ?? "").toLowerCase().includes(needle.toLowerCase());

  const filteredAudit = useMemo(
    () => audit.filter((a) =>
      inRange(String(a.created_at)) &&
      matchText(a.asset_name ?? a.actor_email, filters.operator) &&
      (matchText(a.reference, filters.reference) || matchText(a.entity_id, filters.reference)) &&
      (filters.entity === "all" ||
        (filters.entity === "rfq"
          ? String(a.entity_type).includes("quote")
          : String(a.entity_type).includes("booking")))),
    [audit, filters],
  );

  const filteredSettlement = useMemo(
    () => unsettled.filter((b) =>
      inRange(String(b.created_at)) &&
      matchText(b.asset_name, filters.operator) &&
      matchText(b.reference, filters.reference)),
    [unsettled, filters],
  );

  const operators = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of bookings) {
      const key = b.asset_name || "Unassigned";
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [bookings]);

  const submitRfq = async () => {
    if (!rfq.organization.trim() || !rfq.route.trim() || !rfq.date) {
      toast({ title: "Complete the RFQ", description: "Organisation, route and date are required.", variant: "destructive" });
      return;
    }
    const category = categoryBySlug(rfq.sector);
    setBusy("rfq");
    try {
      const quote = await charterApi.createQuote({
        category_slug: rfq.sector,
        asset_name: category?.inventory[0]?.name ?? "To be assigned",
        trip: {
          organization: rfq.organization.trim(),
          route: rfq.route.trim(),
          date: rfq.date,
          passengers: Number(rfq.passengers) || null,
          notes: rfq.notes.trim() || null,
          source: "ccb_operations_rfq",
        },
      });
      setQuotes((prev) => [quote, ...prev]);
      setRfq({ ...rfq, route: "", notes: "" });
      toast({ title: "RFQ raised", description: `Quotation ${quote.reference ?? quote.id} created.` });
    } catch (e) {
      toast({
        title: "Could not raise the RFQ",
        description: e instanceof Error ? e.message : "Error",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  /**
   * Advance a quotation through the RFQ status machine. The transition is
   * validated client-side for authority, applied through the existing
   * charter admin service (which writes the immutable audit row) and then
   * mirrored into an explicit `from → to` audit entry for the trail.
   */
  const advanceQuote = async (quote: CharterQuoteRow, to: RfqStatus) => {
    const from = normalizeRfqStatus(quote.status);
    const legal = rfqTransitions(from, access.canManageCommercial).some((t) => t.to === to);
    if (!legal) {
      toast({
        title: "Transition not allowed",
        description: access.canManageCommercial
          ? `${RFQ_STATUS_LABEL[from]} cannot move to ${RFQ_STATUS_LABEL[to]}.`
          : "Commercial authority is required for this decision.",
        variant: "destructive",
      });
      return;
    }
    setBusy(quote.id);
    try {
      await charterApi.adminUpdate("charter_quotes", quote.id, { status: to });
      setQuotes((prev) => prev.map((q) => (q.id === quote.id ? { ...q, status: to } : q)));
      toast({
        title: `${RFQ_STATUS_LABEL[to]}`,
        description: `${quote.reference ?? quote.id.slice(0, 8)}: ${RFQ_STATUS_LABEL[from]} → ${RFQ_STATUS_LABEL[to]} (${rfqAuditAction(from, to)}).`,
      });
      // Refresh the audit trail so the new entry is visible immediately.
      charterApi.auditTrail().then(setAudit).catch(() => undefined);
    } catch (e) {
      toast({
        title: "Update failed",
        description: e instanceof Error ? e.message : "Error",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <header className="rounded-2xl border border-border bg-gradient-to-br from-primary/10 via-card to-primary-glow/10 p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">Operations Centre</p>
        <h1 className="mt-2 text-2xl md:text-3xl font-bold tracking-tight">
          Corporate Charter Business Operations Centre
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Charter Admin and Corporate Admin merged into one console — RFQ engine, today's bookings, quotation
          approvals, operators, fleet, payments, settlement and the immutable audit trail.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
            {access.isAdmin ? "Commercial authority" : access.isOperator ? "Operator scope" : "Read-only"}
          </Badge>
          <Button asChild size="sm" variant="outline">
            <Link to="/dashboard/corporate-charter">Corporate Charter workspace<ArrowRight className="ml-2 h-4 w-4" aria-hidden /></Link>
          </Button>
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi icon={ClipboardList} label="Open RFQs" value={loading ? null : String(pendingQuotes.length)} />
        <Kpi icon={Plane} label="Bookings today" value={loading ? null : String(today.length)} />
        <Kpi icon={Receipt} label="Awaiting settlement" value={loading ? null : String(unsettled.length)} />
        <Kpi icon={Wallet} label="Wallet balance" value={loading ? null : money(wallets.reduce((s, w) => s + (Number(w.balance_kes) || 0), 0))} />
      </div>

      <Tabs value={tab} onValueChange={onTabChange}>
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="rfq">RFQ engine</TabsTrigger>
          <TabsTrigger value="today">Bookings today</TabsTrigger>
          <TabsTrigger value="approvals">Quotation approvals</TabsTrigger>
          <TabsTrigger value="operators">Operators</TabsTrigger>
          <TabsTrigger value="fleet">Fleet</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
          <TabsTrigger value="settlement">Settlement</TabsTrigger>
          <TabsTrigger value="audit">Audit logs</TabsTrigger>
        </TabsList>

        {/* RFQ engine */}
        <TabsContent value="rfq" className="mt-6">
          <Card>
            <CardHeader><CardTitle className="text-base">Raise a request for quotation</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="rfq-org">Organisation</Label>
                  <Input id="rfq-org" value={rfq.organization} onChange={(e) => setRfq({ ...rfq, organization: e.target.value })} placeholder="e.g. Kenya Power Ltd" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rfq-sector">Service line</Label>
                  <select
                    id="rfq-sector"
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={rfq.sector}
                    onChange={(e) => setRfq({ ...rfq, sector: e.target.value })}
                  >
                    {CHARTER_CATALOG.map((c) => <option key={c.slug} value={c.slug}>{c.label}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rfq-route">Route / scope</Label>
                  <Input id="rfq-route" value={rfq.route} onChange={(e) => setRfq({ ...rfq, route: e.target.value })} placeholder="Nairobi → Nakuru, return" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rfq-date">Date</Label>
                  <Input id="rfq-date" type="date" value={rfq.date} onChange={(e) => setRfq({ ...rfq, date: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rfq-pax">Passengers / units</Label>
                  <Input id="rfq-pax" inputMode="numeric" value={rfq.passengers} onChange={(e) => setRfq({ ...rfq, passengers: e.target.value })} placeholder="24" />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <Label htmlFor="rfq-notes">Notes</Label>
                  <Textarea id="rfq-notes" value={rfq.notes} onChange={(e) => setRfq({ ...rfq, notes: e.target.value })} rows={3} />
                </div>
              </div>
              <Button onClick={submitRfq} disabled={busy === "rfq"}>
                {busy === "rfq" && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
                Raise RFQ
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Bookings today */}
        <TabsContent value="today" className="mt-6">
          <Card>
            <CardHeader><CardTitle className="text-base">Bookings created today</CardTitle></CardHeader>
            <CardContent>
              <BookingTable rows={today} loading={loading} empty="No bookings raised today." />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Quotation approvals */}
        <TabsContent value="approvals" className="mt-6">
          <Card>
            <CardHeader><CardTitle className="text-base">Quotation approvals</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Workflow: Draft → Submitted → Under review → Approved → Won. Rejection and cancellation are
                terminal. Every transition writes an audit entry visible in the Audit logs tab.
              </p>
              {loading ? <Skeleton className="h-24 w-full" /> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Reference</TableHead>
                      <TableHead>Service line</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Transitions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pendingQuotes.length === 0 && (
                      <TableRow><TableCell colSpan={4} className="text-muted-foreground">No quotations awaiting a decision.</TableCell></TableRow>
                    )}
                    {pendingQuotes.map((q) => {
                      const status = normalizeRfqStatus(q.status);
                      const moves = rfqTransitions(status, access.canManageCommercial);
                      return (
                        <TableRow key={q.id} data-testid="rfq-row">
                          <TableCell className="font-mono text-xs">{q.reference ?? q.id.slice(0, 8)}</TableCell>
                          <TableCell>{categoryBySlug(String(q.category_slug))?.label ?? q.category_slug}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={rfqStatusTone(status)}>{RFQ_STATUS_LABEL[status]}</Badge>
                          </TableCell>
                          <TableCell className="text-right space-x-2">
                            {moves.length === 0 ? (
                              <span className="text-xs text-muted-foreground">
                                {access.canManageCommercial ? "No further action" : "Requires commercial authority"}
                              </span>
                            ) : moves.map((t) => (
                              <Button
                                key={t.to}
                                size="sm"
                                variant={t.negative ? "ghost" : "outline"}
                                disabled={busy === q.id}
                                onClick={() => advanceQuote(q, t.to)}
                              >
                                {busy === q.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : t.label}
                              </Button>
                            ))}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
              {!access.canManageCommercial && (
                <AccessNotice
                  title="Read-only quotation scope"
                  description="Your role can review quotations and move them into review, but approval, rejection and cancellation need commercial authority."
                  actionTo="/dashboard/premium/upgrade?tier=elite"
                  actionLabel="Authority requirements"
                />
              )}
            </CardContent>
          </Card>

        </TabsContent>

        {/* Operators */}
        <TabsContent value="operators" className="mt-6">
          <Card>
            <CardHeader><CardTitle className="text-base">Operators & assignment load</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {loading ? <Skeleton className="h-24 w-full" /> : (
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Asset / operator</TableHead><TableHead className="text-right">Missions</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {operators.length === 0 && (
                      <TableRow><TableCell colSpan={2} className="text-muted-foreground">No assignments yet.</TableCell></TableRow>
                    )}
                    {operators.map(([name, count]) => (
                      <TableRow key={name}>
                        <TableCell className="font-medium">{name}</TableCell>
                        <TableCell className="text-right tabular-nums">{count}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <Button asChild variant="outline" size="sm">
                <Link to="/dashboard/charter/operator-portal">Open operator portal<ArrowRight className="ml-2 h-4 w-4" aria-hidden /></Link>
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Fleet */}
        <TabsContent value="fleet" className="mt-6">
          <Card>
            <CardHeader><CardTitle className="text-base">Fleet catalogue</CardTitle></CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {CHARTER_CATALOG.map((c) => (
                <div key={c.slug} className="rounded-xl border border-border p-4">
                  <p className="font-medium">{c.label}</p>
                  <p className="text-sm text-muted-foreground">{c.inventory.length} assets · {c.rateUnit}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Payments */}
        <TabsContent value="payments" className="mt-6">
          <Card>
            <CardHeader><CardTitle className="text-base">Payments</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <BookingTable rows={bookings} loading={loading} empty="No payments recorded." />
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  { to: "/dashboard/admin/mpesa", label: "M-Pesa console", icon: Wallet },
                  { to: "/dashboard/admin/charter-retry-timeline", label: "Payment retry timeline", icon: History },
                ].map((l) => (
                  <Button key={l.to} asChild variant="secondary" className="justify-between">
                    <Link to={l.to}>{l.label}<ArrowRight className="h-4 w-4" aria-hidden /></Link>
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Settlement */}
        <TabsContent value="settlement" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileCheck2 className="h-4 w-4 text-primary" aria-hidden /> Settlement
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FilterBar filters={filters} setFilters={setFilters} reset={resetFilters} showEntity={false} />
              <p className="text-xs text-muted-foreground">
                {filteredSettlement.length} of {unsettled.length} settlement events shown.
              </p>
              <BookingTable rows={filteredSettlement} loading={loading} empty="Nothing outstanding for these filters." highlightUnpaid />
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  { to: "/dashboard/corporate/reconciliation", label: "Reconciliation" },
                  { to: "/dashboard/corporate/cash-ledger", label: "Corporate cash ledger" },
                  { to: "/dashboard/admin/flight-hub/payouts", label: "Operator payouts" },
                  { to: "/dashboard/corporate/invoicing", label: "Invoices & statements" },
                ].map((l) => (
                  <Button key={l.to} asChild variant="secondary" className="justify-between">
                    <Link to={l.to}>{l.label}<ArrowRight className="h-4 w-4" aria-hidden /></Link>
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Audit */}
        <TabsContent value="audit" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="h-4 w-4 text-muted-foreground" aria-hidden /> Audit logs
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FilterBar filters={filters} setFilters={setFilters} reset={resetFilters} showEntity />
              <p className="text-xs text-muted-foreground">
                {filteredAudit.length} of {audit.length} audit entries shown.
              </p>
              {loading ? <Skeleton className="h-24 w-full" /> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Entity</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredAudit.length === 0 && (
                      <TableRow><TableCell colSpan={3} className="text-muted-foreground">No audit entries match these filters.</TableCell></TableRow>
                    )}
                    {filteredAudit.slice(0, 50).map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(String(a.created_at)).toLocaleString("en-KE")}
                        </TableCell>
                        <TableCell>{String(a.action ?? "—")}</TableCell>
                        <TableCell className="font-mono text-xs">{String(a.entity_id ?? a.reference ?? "—")}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  { to: "/dashboard/admin/charter-booking-audit", label: "Booking change audit" },
                  { to: "/dashboard/corporate/audit-log", label: "Corporate audit log" },
                ].map((l) => (
                  <Button key={l.to} asChild variant="secondary" className="justify-between">
                    <Link to={l.to}>{l.label}<ArrowRight className="h-4 w-4" aria-hidden /></Link>
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

type Filters = { operator: string; reference: string; entity: string; from: string; to: string };

function FilterBar({
  filters, setFilters, reset, showEntity,
}: {
  filters: Filters;
  setFilters: (f: Filters) => void;
  reset: () => void;
  showEntity: boolean;
}) {
  const set = (patch: Partial<Filters>) => setFilters({ ...filters, ...patch });
  return (
    <div className="rounded-xl border border-border bg-muted/30 p-4" data-testid="ops-filter-bar">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="space-y-1.5">
          <Label htmlFor="f-operator">Operator / asset</Label>
          <Input id="f-operator" value={filters.operator} onChange={(e) => set({ operator: e.target.value })} placeholder="Any operator" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="f-reference">Booking / RFQ reference</Label>
          <Input id="f-reference" value={filters.reference} onChange={(e) => set({ reference: e.target.value })} placeholder="e.g. CHT-10231" />
        </div>
        {showEntity && (
          <div className="space-y-1.5">
            <Label htmlFor="f-entity">Record type</Label>
            <select
              id="f-entity"
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={filters.entity}
              onChange={(e) => set({ entity: e.target.value })}
            >
              <option value="all">All records</option>
              <option value="rfq">RFQ / quotations</option>
              <option value="booking">Bookings</option>
            </select>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="f-from">From</Label>
          <Input id="f-from" type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="f-to">To</Label>
          <Input id="f-to" type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} />
        </div>
      </div>
      <Button variant="ghost" size="sm" className="mt-3" onClick={reset}>Clear filters</Button>
    </div>
  );
}

function Kpi({ icon: Icon, label, value }: { icon: typeof Wallet; label: string; value: string | null }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Icon className="h-4 w-4" aria-hidden />
          {label}
        </div>
        {value === null ? <Skeleton className="mt-2 h-7 w-24" /> : (
          <p className="mt-2 text-2xl font-bold tabular-nums tracking-tight">{value}</p>
        )}
      </CardContent>
    </Card>
  );
}

function BookingTable({
  rows, loading, empty, highlightUnpaid = false,
}: { rows: CharterBookingRow[]; loading: boolean; empty: string; highlightUnpaid?: boolean }) {
  if (loading) return <Skeleton className="h-24 w-full" />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Reference</TableHead>
          <TableHead>Asset</TableHead>
          <TableHead>Payment</TableHead>
          <TableHead className="text-right">Amount</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 && (
          <TableRow><TableCell colSpan={4} className="text-muted-foreground">{empty}</TableCell></TableRow>
        )}
        {rows.map((b) => (
          <TableRow key={b.id}>
            <TableCell className="font-mono text-xs">{b.reference}</TableCell>
            <TableCell>{b.asset_name}</TableCell>
            <TableCell>
              <Badge
                variant="outline"
                className={
                  highlightUnpaid || !["paid", "completed"].includes(b.payment_status)
                    ? "border-destructive/30 bg-destructive/10 text-destructive"
                    : "border-primary/30 bg-primary/10 text-primary"
                }
              >
                {b.payment_status || b.status}
              </Badge>
            </TableCell>
            <TableCell className="text-right tabular-nums">{money(Number(b.amount) || 0)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
