/**
 * Corporate Control Tower — the super-admin view of the whole corporate book
 * of business (Uber-for-Business / Ola Corporate style).
 *
 * One portfolio call feeds: a KPI strip, saved segment views, search + sort,
 * risk flags per account, multi-select bulk account actions, and the
 * "manage as" hand-off into Corporate 360 or the assisted booking desk.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertTriangle, Building2, CheckCircle2, Loader2, RefreshCw, Search, Wallet,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { workspace360Path } from "@/lib/workspace360/links";
import { ManageAsBanner } from "@/components/corporate/ManageAsBanner";
import { invokeCorporateConsole, startManageAs } from "@/lib/corporate/manageAs";
import {
  applySavedView, buildPortfolio, portfolioTotals, RISK_LABELS, SAVED_VIEWS,
  searchPortfolio, sortPortfolio,
  type PortfolioRaw, type PortfolioRow, type PortfolioSortKey, type SavedViewKey,
} from "@/lib/corporate/portfolio";

const money = (cents: number, currency = "KES") =>
  `${currency} ${Math.round(cents / 100).toLocaleString("en-KE")}`;

type BulkAction = "suspend" | "reactivate" | "set_credit_limit" | "set_payment_terms";

const BULK_LABELS: Record<BulkAction, string> = {
  suspend: "Suspend accounts",
  reactivate: "Reactivate accounts",
  set_credit_limit: "Set credit limit (KES)",
  set_payment_terms: "Set payment terms (days)",
};

export default function CorporateControlTower() {
  const navigate = useNavigate();
  const [raw, setRaw] = useState<PortfolioRaw | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<SavedViewKey>("all");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<PortfolioSortKey>("spend30d");
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkAction, setBulkAction] = useState<BulkAction>("suspend");
  const [bulkValue, setBulkValue] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await invokeCorporateConsole<PortfolioRaw>({ op: "portfolio" });
      setRaw(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const rows = useMemo(() => (raw ? buildPortfolio(raw) : []), [raw]);
  const totals = useMemo(() => portfolioTotals(rows), [rows]);
  const visible = useMemo(
    () => sortPortfolio(searchPortfolio(applySavedView(rows, view), query), sortKey),
    [rows, view, query, sortKey],
  );

  const allVisibleSelected = visible.length > 0 && visible.every((r) => selected.includes(r.id));

  async function runBulk() {
    const needsValue = bulkAction === "set_credit_limit" || bulkAction === "set_payment_terms";
    if (needsValue && !bulkValue.trim()) {
      toast({ title: "Value required", description: BULK_LABELS[bulkAction], variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const value = needsValue
        ? (bulkAction === "set_credit_limit"
            ? Math.round(Number(bulkValue) * 100)
            : Math.round(Number(bulkValue)))
        : undefined;
      const res = await invokeCorporateConsole<{ applied: string[]; failed: Array<{ reason: string }> }>({
        op: "bulk_action",
        action: bulkAction,
        corporate_ids: selected,
        ...(value !== undefined ? { value } : {}),
      });
      toast({
        title: `${res.applied.length} account(s) updated`,
        description: res.failed.length ? `${res.failed.length} failed — see audit log` : "Change is audited.",
      });
      setSelected([]);
      setBulkValue("");
      await load();
    } catch (e) {
      toast({ title: "Bulk action failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function manageAs(row: PortfolioRow, destination: "360" | "booking") {
    setBusy(true);
    try {
      await startManageAs(row.id, `control_tower_${destination}`);
      navigate(
        destination === "booking"
          ? `/dashboard/admin/corporates/assisted-booking?corporate=${row.id}`
          : workspace360Path("corporate", row.id),
      );
    } catch (e) {
      toast({ title: "Could not start session", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  const kpis = [
    { label: "Corporates", value: totals.corporates.toLocaleString("en-KE"), hint: `${totals.active} active · ${totals.suspended} suspended`, icon: Building2 },
    { label: "Wallet float", value: money(totals.walletFloatCents), hint: "Pre-funded balance held", icon: Wallet },
    { label: "Arrears", value: money(totals.overdueCents), hint: `${totals.atRisk} accounts flagged`, icon: AlertTriangle },
    { label: "Open approvals", value: totals.pendingApprovals.toLocaleString("en-KE"), hint: `${totals.pendingKyb} awaiting KYB`, icon: CheckCircle2 },
  ];

  return (
    <div className="space-y-4" data-testid="corporate-control-tower">
      <ManageAsBanner />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Corporate Control Tower</h1>
          <p className="text-sm text-muted-foreground">
            Administer every corporate account, act on their behalf and facilitate bookings.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/dashboard/admin/corporates/approvals">Approvals inbox</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link to="/dashboard/admin/corporates/booking-ops">Booking ops</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link to="/dashboard/admin/corporates/support">Support desk</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link to="/dashboard/admin/corporates/alerts">Alerting</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link to="/dashboard/admin/corporates/audit">Audit log</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link to="/dashboard/admin/corporates/permissions">Permissions</Link>
          </Button>

          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((k) => (
          <Card key={k.label}>
            <CardContent className="pt-6">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">{k.label}</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">{k.value}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{k.hint}</p>
                </div>
                <k.icon className="h-5 w-5 text-muted-foreground" aria-hidden />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Portfolio segments">
        {SAVED_VIEWS.map((v) => (
          <Button
            key={v.key}
            role="tab"
            aria-selected={view === v.key}
            size="sm"
            variant={view === v.key ? "default" : "outline"}
            title={v.description}
            data-testid={`portfolio-view-${v.key}`}
            onClick={() => setView(v.key)}
          >
            {v.label}
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base">
            Portfolio <span className="text-muted-foreground font-normal">({visible.length})</span>
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
              <Input
                aria-label="Search corporates"
                placeholder="Search name, KRA PIN, email…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full pl-8 sm:w-64"
              />
            </div>
            <Select value={sortKey} onValueChange={(v) => setSortKey(v as PortfolioSortKey)}>
              <SelectTrigger className="w-44" aria-label="Sort portfolio">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="spend30d">Spend (30d)</SelectItem>
                <SelectItem value="wallet">Wallet balance</SelectItem>
                <SelectItem value="overdue">Arrears</SelectItem>
                <SelectItem value="approvals">Open approvals</SelectItem>
                <SelectItem value="employees">Employees</SelectItem>
                <SelectItem value="risk">Risk flags</SelectItem>
                <SelectItem value="name">Name</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {error && (
            <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
              Could not load the portfolio: {error}
            </div>
          )}

          {selected.length > 0 && (
            <div
              data-testid="bulk-toolbar"
              className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 p-3"
            >
              <span className="text-sm font-medium">{selected.length} selected</span>
              <Select value={bulkAction} onValueChange={(v) => setBulkAction(v as BulkAction)}>
                <SelectTrigger className="w-56" aria-label="Bulk action"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(BULK_LABELS) as BulkAction[]).map((a) => (
                    <SelectItem key={a} value={a}>{BULK_LABELS[a]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {(bulkAction === "set_credit_limit" || bulkAction === "set_payment_terms") && (
                <Input
                  aria-label="Bulk action value"
                  className="w-32"
                  inputMode="numeric"
                  value={bulkValue}
                  onChange={(e) => setBulkValue(e.target.value.replace(/[^\d.]/g, ""))}
                  placeholder={bulkAction === "set_credit_limit" ? "500000" : "30"}
                />
              )}
              <Button size="sm" data-analytics="admin.control_tower.bulk_apply" disabled={busy} onClick={() => void runBulk()} data-testid="bulk-apply">
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
                Apply to selected accounts
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected([])}>Clear</Button>
            </div>
          )}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    aria-label="Select all visible corporates"
                    checked={allVisibleSelected}
                    onCheckedChange={(checked) =>
                      setSelected(checked ? visible.map((r) => r.id) : [])
                    }
                  />
                </TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Wallet</TableHead>
                <TableHead className="text-right">Spend 30d</TableHead>
                <TableHead className="text-right">Arrears</TableHead>
                <TableHead className="text-right">Staff</TableHead>
                <TableHead>Risk</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow><TableCell colSpan={9} className="py-8 text-center text-muted-foreground">Loading portfolio…</TableCell></TableRow>
              )}
              {!loading && visible.length === 0 && (
                <TableRow><TableCell colSpan={9} className="py-8 text-center text-muted-foreground">No corporates match this view.</TableCell></TableRow>
              )}
              {visible.map((r) => (
                <TableRow key={r.id} data-testid={`portfolio-row-${r.id}`}>
                  <TableCell>
                    <Checkbox
                      aria-label={`Select ${r.name}`}
                      checked={selected.includes(r.id)}
                      onCheckedChange={(checked) =>
                        setSelected((prev) =>
                          checked ? [...new Set([...prev, r.id])] : prev.filter((id) => id !== r.id),
                        )
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Link to={workspace360Path("corporate", r.id)} className="font-medium hover:underline">
                      {r.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {r.kraPin ?? "No KRA PIN"} · {r.paymentTermsDays}d terms
                    </p>
                  </TableCell>
                  <TableCell><Badge variant="outline">{r.status}</Badge></TableCell>
                  <TableCell className="text-right text-xs tabular-nums">{money(r.walletBalanceCents, r.currency)}</TableCell>
                  <TableCell className="text-right text-xs tabular-nums">{money(r.spend30dCents, r.currency)}</TableCell>
                  <TableCell className="text-right text-xs tabular-nums">{money(r.overdueCents, r.currency)}</TableCell>
                  <TableCell className="text-right text-xs tabular-nums">{r.activeEmployees}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {r.risks.length === 0 && <span className="text-xs text-muted-foreground">Healthy</span>}
                      {r.risks.map((flag) => (
                        <Badge key={flag} variant="secondary" className="text-[10px]">{RISK_LABELS[flag]}</Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        data-testid={`manage-as-${r.id}`}
                        onClick={() => void manageAs(r, "360")}
                      >
                        Manage as
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        data-testid={`assisted-book-${r.id}`}
                        onClick={() => void manageAs(r, "booking")}
                      >
                        Book
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
