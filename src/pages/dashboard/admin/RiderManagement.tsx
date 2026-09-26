import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Users, Wallet, MapPin, LifeBuoy, LayoutDashboard, IdCard,
  TrendingUp, ShieldCheck, Sparkles,
} from "lucide-react";
import { workspace360Path } from "@/lib/workspace360/links";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { createTtlCache } from "@/lib/cache/ttlCache";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

const riderSecondaryCache = createTtlCache<{ wallets: WalletRow[]; txns: TxnRow[] }>(60_000);

/**
 * Cache invalidation hook — call from any rider mutation (wallet adjust, profile edit)
 * to force the next Rider Management render to refetch instead of serving stale rows.
 */
export function invalidateRiderCache() {
  riderSecondaryCache.invalidate();
}

/**
 * Rider Management System — enterprise Rider 360 command surface.
 * Centralises Overview, Directory, Wallet, Profile, Trips and Support
 * into a single admin-grade dashboard under People & Partners.
 */
const TABS = [
  { id: "overview",  label: "Rider Overview",  icon: LayoutDashboard },
  { id: "directory", label: "Rider Directory", icon: Users },
  { id: "wallet",    label: "Rider Wallet",    icon: Wallet },
  { id: "profile",   label: "Rider Profile",   icon: IdCard },
  { id: "trips",     label: "Rider Trips",     icon: MapPin },
  { id: "support",   label: "Rider Support",   icon: LifeBuoy },
] as const;
type TabId = typeof TABS[number]["id"];

interface RiderRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  phone_number: string | null;
  email: string | null;
  status: string | null;
  rider_tier: string | null;
  lifetime_trips: number | null;
  rating_avg: number | null;
}

interface WalletRow {
  id: string;
  user_id: string;
  balance: number;
  currency: string;
  status: string;
}

interface TxnRow {
  id: string;
  user_id: string;
  txn_type: string;
  amount: number;
  currency: string;
  reference: string | null;
  created_at: string;
}

export default function RiderManagement() {
  const [params, setParams] = useSearchParams();
  const active = (params.get("tab") as TabId) || "overview";
  const urlQ = params.get("q") ?? "";

  const setTab = (t: string) => {
    const next = new URLSearchParams(params);
    next.set("tab", t);
    setParams(next, { replace: true });
  };

  const [riders, setRiders] = useState<RiderRow[]>([]);
  const [wallets, setWallets] = useState<WalletRow[]>([]);
  const [txns, setTxns] = useState<TxnRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingSecondary, setLoadingSecondary] = useState(true);
  const [q, setQ] = useState(urlQ);

  const debouncedQ = useDebouncedValue(q.trim(), 300);

  // Persist search term to URL (deep-linkable). Replace history entry to avoid noise.
  useEffect(() => {
    const next = new URLSearchParams(params);
    if (debouncedQ) next.set("q", debouncedQ);
    else next.delete("q");
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ]);


  // SWR: paint cached wallets/txns instantly, refetch in background when stale.
  useEffect(() => {
    const swr = riderSecondaryCache.getWithFreshness();
    if (swr) {
      setWallets(swr.value.wallets);
      setTxns(swr.value.txns);
      setLoadingSecondary(false);
      if (swr.fresh) return;
    }
    void (async () => {
      if (!swr) setLoadingSecondary(true);
      const c: any = supabase;
      const [wRes, tRes] = await Promise.all([
        c.from("rider_wallets")
          .select("id,user_id,balance,currency,status")
          .order("balance", { ascending: false })
          .limit(200),
        c.from("rider_wallet_transactions")
          .select("id,user_id,txn_type,amount,currency,reference,created_at")
          .order("created_at", { ascending: false })
          .limit(50),
      ]);
      const w = (wRes.data as WalletRow[]) ?? [];
      const t = (tRes.data as TxnRow[]) ?? [];
      setWallets(w);
      setTxns(t);
      riderSecondaryCache.set({ wallets: w, txns: t });
      setLoadingSecondary(false);
    })();
  }, []);


  // 3A — Server-side rider search: refetch on debounced query using indexed columns.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const c: any = supabase;
      let query = c.from("rider_profiles")
        .select("id,first_name,last_name,display_name,phone_number,email,status,rider_tier,lifetime_trips,rating_avg")
        .order("created_at", { ascending: false })
        .limit(200);
      if (debouncedQ) {
        const esc = debouncedQ.replace(/[,()]/g, " ");
        const pat = `%${esc}%`;
        query = query.or(
          `first_name.ilike.${pat},last_name.ilike.${pat},display_name.ilike.${pat},email.ilike.${pat},phone_number.ilike.${pat}`,
        );
      }
      const { data } = await query;
      if (cancelled) return;
      setRiders((data as RiderRow[]) ?? []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [debouncedQ]);

  const kpis = useMemo(() => {
    const active = riders.filter((r) => (r.status ?? "").toLowerCase() === "active").length;
    const trips = riders.reduce((s, r) => s + (r.lifetime_trips ?? 0), 0);
    const totalBalance = wallets.reduce((s, w) => s + Number(w.balance ?? 0), 0);
    const avgRating = riders.length
      ? (riders.reduce((s, r) => s + Number(r.rating_avg ?? 0), 0) / riders.length).toFixed(2)
      : "0.00";
    return { total: riders.length, active, trips, totalBalance, avgRating };
  }, [riders, wallets]);

  // Filtering now happens server-side; the resolved list is the display list.
  const filteredRiders = riders;

  const riderName = (r: RiderRow) =>
    r.display_name || [r.first_name, r.last_name].filter(Boolean).join(" ") || "—";

  // Global filter: when a search is active, scope Wallet + Trip activity to matched riders.
  const matchedIds = useMemo(() => {
    if (!debouncedQ) return null;
    return new Set(riders.map((r) => r.id));
  }, [riders, debouncedQ]);
  const filteredWallets = useMemo(
    () => (matchedIds ? wallets.filter((w) => matchedIds.has(w.user_id)) : wallets),
    [wallets, matchedIds],
  );
  const filteredTxns = useMemo(
    () => (matchedIds ? txns.filter((t) => matchedIds.has(t.user_id)) : txns),
    [txns, matchedIds],
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-primary" />
            Rider Management System
          </h1>
          <p className="text-sm text-muted-foreground">
            AI-driven Rider 360 command surface — Overview, Directory, Wallet, Profile, Trips & Support.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <Input
            type="search"
            placeholder="Search all riders (name, email, phone)…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-full sm:w-80"
            aria-label="Global rider search"
          />
          <Badge variant="outline" className="text-xs">Enterprise · Production</Badge>
        </div>
      </div>

      {debouncedQ && (
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          Filtering all views by <span className="font-semibold text-foreground">"{debouncedQ}"</span> ·
          <span className="ml-1">{filteredRiders.length} rider(s), {filteredWallets.length} wallet(s), {filteredTxns.length} txn(s)</span>
          <button
            type="button"
            onClick={() => setQ("")}
            className="ml-2 underline hover:text-foreground"
          >
            Clear
          </button>
        </div>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <KpiCard icon={Users}       label="Total Riders"       value={kpis.total.toLocaleString()} />
        <KpiCard icon={ShieldCheck} label="Active Riders"      value={kpis.active.toLocaleString()} />
        <KpiCard icon={MapPin}      label="Lifetime Trips"     value={kpis.trips.toLocaleString()} />
        <KpiCard icon={Wallet}      label="Wallet Balances"    value={`KES ${kpis.totalBalance.toLocaleString()}`} />
        <KpiCard icon={TrendingUp}  label="Avg Rating"         value={kpis.avgRating} />
      </div>


      <Tabs value={active} onValueChange={setTab} className="space-y-4">
        <TabsList className="flex flex-wrap h-auto">
          {TABS.map((t) => (
            <TabsTrigger key={t.id} value={t.id} className="gap-2">
              <t.icon className="h-4 w-4" />
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview">
          <Card>
            <CardHeader><CardTitle className="text-base">Rider Overview</CardTitle></CardHeader>
            <CardContent className="grid md:grid-cols-2 gap-4">
              <StatBlock label="Newly onboarded riders (last 200)" value={kpis.total.toLocaleString()} />
              <StatBlock label="Active rider ratio"
                value={`${kpis.total ? Math.round((kpis.active / kpis.total) * 100) : 0}%`} />
              <StatBlock label="Aggregate wallet float (KES)" value={kpis.totalBalance.toLocaleString()} />
              <StatBlock label="Platform average rating" value={kpis.avgRating} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="directory">
          <Card>
            <CardHeader><CardTitle className="text-base">Rider Directory</CardTitle></CardHeader>
            <CardContent className="space-y-3">

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Rider</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Tier</TableHead>
                    <TableHead className="text-right">Trips</TableHead>
                    <TableHead className="text-right">Rating</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading && (
                    <TableRow><TableCell colSpan={6} className="py-6 text-center text-muted-foreground">Loading…</TableCell></TableRow>
                  )}
                  {!loading && filteredRiders.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="py-6 text-center text-muted-foreground">No riders.</TableCell></TableRow>
                  )}
                  {filteredRiders.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <Link to={workspace360Path("rider", r.id)} className="font-medium hover:underline">
                          {riderName(r)}
                        </Link>
                      </TableCell>
                      <TableCell className="text-xs">
                        {r.email ?? "—"}<br />{r.phone_number ?? "—"}
                      </TableCell>
                      <TableCell><Badge variant="outline">{r.status ?? "—"}</Badge></TableCell>
                      <TableCell>{r.rider_tier ?? "—"}</TableCell>
                      <TableCell className="text-right">{r.lifetime_trips ?? 0}</TableCell>
                      <TableCell className="text-right">{Number(r.rating_avg ?? 0).toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="wallet">
          <Card>
            <CardHeader><CardTitle className="text-base">Rider Wallets</CardTitle></CardHeader>
            <CardContent>
              <WalletTable
                columns={[
                  { key: "wallet", header: "Wallet",
                    sortValue: (w) => w.user_id,
                    render: (w) => (
                      <Link
                        to={workspace360Path("rider", w.user_id, "financial")}
                        className="font-mono text-xs hover:underline"
                      >
                        {w.user_id}
                      </Link>
                    ),
                  },
                  { key: "currency", header: "Currency", sortValue: (w) => w.currency, render: (w) => w.currency },
                  { key: "status", header: "Status", sortValue: (w) => w.status,
                    render: (w) => <Badge variant="outline">{w.status}</Badge> },
                  { key: "balance", header: "Balance", align: "right",
                    sortValue: (w) => Number(w.balance ?? 0),
                    render: (w) => <span className="font-semibold">{w.currency} {Number(w.balance ?? 0).toLocaleString()}</span> },
                ]}
                rows={filteredWallets}
                rowKey={(w) => w.id}
                loading={loadingSecondary}
                loadingMessage="Loading wallets…"
                emptyMessage={debouncedQ
                  ? `No wallets match "${debouncedQ}". Clear the search to see all wallets.`
                  : "No rider wallets have been provisioned yet."}
              />

            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="profile">
          <Card>
            <CardHeader><CardTitle className="text-base">Rider Profiles</CardTitle></CardHeader>
            <CardContent className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
              {filteredRiders.slice(0, 12).map((r) => (
                <Link
                  key={r.id}
                  to={workspace360Path("rider", r.id)}
                  className="rounded-lg border p-4 hover:bg-muted/50 transition"
                >
                  <div className="flex items-center justify-between">
                    <div className="font-medium">{riderName(r)}</div>
                    <Badge variant="outline" className="text-[10px]">{r.rider_tier ?? "—"}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">{r.email ?? r.phone_number ?? "—"}</div>
                  <div className="flex justify-between text-xs mt-3">
                    <span>Trips: <strong>{r.lifetime_trips ?? 0}</strong></span>
                    <span>Rating: <strong>{Number(r.rating_avg ?? 0).toFixed(2)}</strong></span>
                  </div>
                </Link>
              ))}
              {filteredRiders.length === 0 && (
                <p className="text-sm text-muted-foreground">No rider profiles match the current filter.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="trips">
          <Card>
            <CardHeader><CardTitle className="text-base">Recent Rider Wallet Activity (Trip Charges & Top-ups)</CardTitle></CardHeader>
            <CardContent>
              <TxnTable
                columns={[
                  { key: "type", header: "Type", sortValue: (t) => t.txn_type,
                    render: (t) => <span className="capitalize">{t.txn_type.replace(/_/g, " ")}</span> },
                  { key: "ref", header: "Reference", sortValue: (t) => t.reference ?? "",
                    render: (t) => <span className="text-xs">{t.reference ?? "—"}</span> },
                  { key: "rider", header: "Rider", sortValue: (t) => t.user_id,
                    render: (t) => (
                      <Link
                        to={workspace360Path("rider", t.user_id, "timeline")}
                        className="font-mono text-xs hover:underline"
                      >
                        {t.user_id}
                      </Link>
                    ),
                  },
                  { key: "amount", header: "Amount", align: "right",
                    sortValue: (t) => Number(t.amount),
                    render: (t) => <>{t.currency} {Number(t.amount).toLocaleString()}</> },
                  { key: "when", header: "When", align: "right",
                    sortValue: (t) => new Date(t.created_at).getTime(),
                    render: (t) => (
                      <span className="text-xs text-muted-foreground">{new Date(t.created_at).toLocaleString()}</span>
                    ) },
                ]}
                rows={filteredTxns}
                rowKey={(t) => t.id}
                loading={loadingSecondary}
                loadingMessage="Loading recent transactions…"
                emptyMessage={debouncedQ
                  ? `No transactions match "${debouncedQ}". Clear the search to see recent activity.`
                  : "No wallet activity in the last window. Top-ups and trip charges will appear here."}
              />

            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="support">
          <Card>
            <CardHeader><CardTitle className="text-base">Rider Support</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Route rider incidents, SOS alerts, and support tickets to the Trust &amp; Safety and Support Center consoles.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline"><Link to="/dashboard/admin/contact-submissions">Open Support Center</Link></Button>
                <Button asChild variant="outline"><Link to="/dashboard/admin/riders">Open Full Directory</Link></Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function KpiCard({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <p className="text-xl font-bold mt-2">{value}</p>
    </div>
  );
}

function StatBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold mt-1">{value}</div>
    </div>
  );
}

type ActivityColumn<T> = {
  key: string;
  header: string;
  align?: "left" | "right";
  render: (row: T) => ReactNode;
  /** Return a sortable primitive for this column. Omit to make the column non-sortable. */
  sortValue?: (row: T) => string | number | null | undefined;
};

type ActivityTableProps<T> = {
  columns: ActivityColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  emptyMessage?: string;
  loadingMessage?: string;
};

// Pre-bound aliases: generic JSX call syntax (<ActivityTable<T>>) breaks the
// dev-mode instrumentation transform, so bind the row types here instead.
const WalletTable: (props: ActivityTableProps<WalletRow>) => ReactNode = ActivityTable;
const TxnTable: (props: ActivityTableProps<TxnRow>) => ReactNode = ActivityTable;

function ActivityTable<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  emptyMessage = "No records.",
  loadingMessage = "Loading…",
}: ActivityTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const toggleSort = (key: string) => {
    if (sortKey !== key) { setSortKey(key); setSortDir("asc"); return; }
    if (sortDir === "asc") { setSortDir("desc"); return; }
    setSortKey(null); // third click clears sort
  };

  const sortedRows = useMemo(() => {
    if (!sortKey) return rows;
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.sortValue) return rows;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = col.sortValue!(a);
      const bv = col.sortValue!(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [rows, columns, sortKey, sortDir]);

  const statusMessage = loading
    ? loadingMessage
    : sortedRows.length === 0
      ? emptyMessage
      : `${sortedRows.length} row${sortedRows.length === 1 ? "" : "s"} shown${sortKey ? `, sorted by ${columns.find((c) => c.key === sortKey)?.header} ${sortDir === "asc" ? "ascending" : "descending"}` : ""}.`;

  return (
    <div>
      {/* SR-only live region so screen-reader users hear loading / empty / sort-change updates. */}
      <div role="status" aria-live="polite" className="sr-only">{statusMessage}</div>
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((c) => {
              const sortable = !!c.sortValue;
              const isActive = sortKey === c.key;
              const Icon = !sortable ? null : !isActive ? ArrowUpDown : sortDir === "asc" ? ArrowUp : ArrowDown;
              const ariaSort: "ascending" | "descending" | "none" | undefined = !sortable
                ? undefined
                : !isActive
                  ? "none"
                  : sortDir === "asc"
                    ? "ascending"
                    : "descending";
              return (
                <TableHead
                  key={c.key}
                  scope="col"
                  aria-sort={ariaSort}
                  className={c.align === "right" ? "text-right" : undefined}
                >
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(c.key)}
                      onKeyDown={(e) => {
                        // Explicit Enter / Space handling — buttons already do this, but be defensive
                        // on browsers/AT combos that swallow default activation on custom widgets.
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggleSort(c.key);
                        }
                      }}
                      className={`inline-flex items-center gap-1 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded ${c.align === "right" ? "flex-row-reverse" : ""}`}
                      aria-label={
                        isActive
                          ? `Sort by ${c.header}, currently ${sortDir === "asc" ? "ascending" : "descending"}. Activate to ${sortDir === "asc" ? "sort descending" : "clear sorting"}.`
                          : `Sort by ${c.header}`
                      }
                    >
                      <span>{c.header}</span>
                      {Icon && <Icon className="h-3 w-3 opacity-70" aria-hidden="true" />}
                    </button>
                  ) : (
                    c.header
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading && (
            <TableRow>
              <TableCell colSpan={columns.length} className="py-6 text-center text-muted-foreground">
                <span className="inline-flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-primary animate-pulse" aria-hidden="true" />
                  {loadingMessage}
                </span>
              </TableCell>
            </TableRow>
          )}
          {!loading && sortedRows.length === 0 && (
            <TableRow>
              <TableCell colSpan={columns.length} className="py-6 text-center text-muted-foreground">
                {emptyMessage}
              </TableCell>
            </TableRow>
          )}
          {!loading && sortedRows.map((row) => (
            <TableRow key={rowKey(row)}>
              {columns.map((c) => (
                <TableCell key={c.key} className={c.align === "right" ? "text-right" : undefined}>
                  {c.render(row)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

