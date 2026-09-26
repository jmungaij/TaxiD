/**
 * Per-corporate Account Command Centre.
 *
 * One page per corporate account: upcoming trips, pending approvals, monthly
 * spend, department budgets, compliance status, invoices/receipts and a
 * downloadable statement. All derivation lives in
 * `src/lib/corporate/accountCommandCentre.ts` (pure).
 */
import * as React from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SeoHead } from "@/components/seo/SeoHead";
import { AlertTriangle, ArrowLeft, RefreshCw } from "lucide-react";
import { ReportExportMenu } from "@/components/executive/ReportExportMenu";
import {
  budgetsReport, invoiceLedgerReport, monthlySpendReport, statementReport,
} from "@/lib/corporate/executiveExports";
import {
  complianceStatus, departmentBudgets, formatKes,
  invoiceLedger, monthlySpend, pendingApprovals, spendTrend, statementTotals,
  upcomingTrips,
  type AccountApprovalRow, type AccountDepartmentRow, type AccountDocumentRow,
  type AccountInvoiceItemRow, type AccountInvoiceRow,
} from "@/lib/corporate/accountCommandCentre";

interface Dataset {
  name: string;
  status: string | null;
  paymentTermsDays: number | null;
  creditLimitKes: number;
  approvals: AccountApprovalRow[];
  invoices: AccountInvoiceRow[];
  items: AccountInvoiceItemRow[];
  departments: AccountDepartmentRow[];
  documents: AccountDocumentRow[];
}

const EMPTY: Dataset = {
  name: "Corporate account", status: null, paymentTermsDays: null, creditLimitKes: 0,
  approvals: [], invoices: [], items: [], departments: [], documents: [],
};

const BAND_TONE: Record<string, string> = {
  healthy: "bg-primary/15 text-primary border-primary/30",
  watch: "bg-status-warning/15 text-status-warning border-status-warning/30 dark:text-status-warning",
  at_limit: "bg-status-warning/20 text-status-warning border-status-warning/40 dark:text-status-warning",
  over: "bg-destructive/15 text-destructive border-destructive/30",
};

const COMPLIANCE_TONE: Record<string, string> = {
  compliant: "bg-primary/15 text-primary border-primary/30",
  expiring: "bg-status-warning/15 text-status-warning border-status-warning/30 dark:text-status-warning",
  expired: "bg-destructive/15 text-destructive border-destructive/30",
  pending_review: "bg-muted text-muted-foreground",
  rejected: "bg-destructive/15 text-destructive border-destructive/30",
  missing: "bg-destructive/10 text-destructive border-destructive/20",
};

const dt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" }) : "—";

export default function CorporateAccountCommandCentre() {
  const { corporateId = "" } = useParams();
  const [data, setData] = React.useState<Dataset>(EMPTY);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    if (!corporateId) return;
    setLoading(true);
    setError(null);
    try {
      const [acct, appr, inv, dept, docs] = await Promise.all([
        supabase.from("corporate_accounts")
          .select("id,legal_name,trading_name,status,payment_terms_days,credit_limit_cents")
          .eq("id", corporateId).maybeSingle(),
        supabase.from("corporate_ride_approvals")
          .select("id,status,ride_type,pickup_address,dropoff_address,estimated_fare_cents,scheduled_for,created_at,expires_at,department_id,requested_by")
          .eq("corporate_id", corporateId).order("created_at", { ascending: false }).limit(500),
        supabase.from("corporate_invoices")
          .select("id,invoice_number,status,total_cents,paid_cents,balance_cents,issued_at,due_at,paid_at,created_at")
          .eq("corporate_id", corporateId).order("created_at", { ascending: false }).limit(300),
        supabase.from("corporate_departments")
          .select("id,name,code,cost_center,monthly_budget_cents,active")
          .eq("corporate_id", corporateId).limit(200),
        supabase.from("corporate_documents")
          .select("id,doc_type,document_number,status,expiry_date,reviewed_at,uploaded_at")
          .eq("corporate_id", corporateId).limit(200),
      ]);

      const row = (r: unknown) => r as Record<string, unknown>;
      const cents = (v: unknown) => (Number(v) || 0) / 100;
      const a = acct.data ? row(acct.data) : null;

      const invoices: AccountInvoiceRow[] = ((inv.data ?? []) as unknown[]).map((r) => {
        const i = row(r);
        return {
          id: String(i.id),
          invoiceNumber: (i.invoice_number as string) ?? null,
          status: String(i.status ?? "draft"),
          totalKes: cents(i.total_cents),
          paidKes: cents(i.paid_cents),
          balanceKes: cents(i.balance_cents),
          issuedAt: (i.issued_at as string) ?? null,
          dueAt: (i.due_at as string) ?? null,
          paidAt: (i.paid_at as string) ?? null,
          createdAt: String(i.created_at),
        };
      });

      let items: AccountInvoiceItemRow[] = [];
      if (invoices.length) {
        const { data: itemRows } = await supabase.from("corporate_invoice_items")
          .select("invoice_id,department,cost_center,employee_name,description,trip_origin,trip_destination,trip_started_at,total_cents")
          .in("invoice_id", invoices.slice(0, 100).map((i) => i.id))
          .limit(2000);
        items = ((itemRows ?? []) as unknown[]).map((r) => {
          const it = row(r);
          return {
            invoiceId: String(it.invoice_id),
            department: (it.department as string) ?? null,
            costCenter: (it.cost_center as string) ?? null,
            employeeName: (it.employee_name as string) ?? null,
            description: (it.description as string) ?? null,
            tripOrigin: (it.trip_origin as string) ?? null,
            tripDestination: (it.trip_destination as string) ?? null,
            tripStartedAt: (it.trip_started_at as string) ?? null,
            totalKes: cents(it.total_cents),
          };
        });
      }

      setData({
        name: (a?.trading_name as string) || (a?.legal_name as string) || "Corporate account",
        status: (a?.status as string) ?? null,
        paymentTermsDays: Number(a?.payment_terms_days) || null,
        creditLimitKes: cents(a?.credit_limit_cents),
        approvals: ((appr.data ?? []) as unknown[]).map((r) => {
          const x = row(r);
          return {
            id: String(x.id),
            status: String(x.status ?? "pending"),
            rideType: (x.ride_type as string) ?? null,
            pickup: (x.pickup_address as string) ?? null,
            dropoff: (x.dropoff_address as string) ?? null,
            estimatedFareKes: cents(x.estimated_fare_cents),
            scheduledFor: (x.scheduled_for as string) ?? null,
            createdAt: String(x.created_at),
            expiresAt: (x.expires_at as string) ?? null,
            departmentId: (x.department_id as string) ?? null,
            requestedBy: (x.requested_by as string) ?? null,
          };
        }),
        invoices,
        items,
        departments: ((dept.data ?? []) as unknown[]).map((r) => {
          const d = row(r);
          return {
            id: String(d.id),
            name: String(d.name ?? "Department"),
            code: (d.code as string) ?? null,
            costCenter: (d.cost_center as string) ?? null,
            monthlyBudgetKes: cents(d.monthly_budget_cents),
            active: d.active !== false,
          };
        }),
        documents: ((docs.data ?? []) as unknown[]).map((r) => {
          const d = row(r);
          return {
            id: String(d.id),
            docType: String(d.doc_type ?? ""),
            documentNumber: (d.document_number as string) ?? null,
            status: String(d.status ?? "pending"),
            expiryDate: (d.expiry_date as string) ?? null,
            reviewedAt: (d.reviewed_at as string) ?? null,
            uploadedAt: String(d.uploaded_at ?? d.reviewed_at ?? new Date().toISOString()),
          };
        }),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load account");
    } finally {
      setLoading(false);
    }
  }, [corporateId]);

  React.useEffect(() => { void load(); }, [load]);

  const trips = React.useMemo(() => upcomingTrips(data.approvals), [data.approvals]);
  const pending = React.useMemo(() => pendingApprovals(data.approvals), [data.approvals]);
  const spend = React.useMemo(() => monthlySpend(data.invoices, data.items), [data.invoices, data.items]);
  const trend = React.useMemo(() => spendTrend(data.invoices), [data.invoices]);
  const budgets = React.useMemo(
    () => departmentBudgets(data.departments, data.items, data.invoices),
    [data.departments, data.items, data.invoices],
  );
  const compliance = React.useMemo(() => complianceStatus(data.documents), [data.documents]);
  const ledger = React.useMemo(() => invoiceLedger(data.invoices), [data.invoices]);
  const totals = React.useMemo(() => statementTotals(data.invoices), [data.invoices]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-72" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SeoHead
        title={`${data.name} · Account Command Centre`}
        description="Corporate account command centre: trips, approvals, spend, budgets, compliance, invoices and statements."
        path={`/dashboard/admin/corporates/${corporateId}/command-centre`}
      />

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Button asChild size="sm" variant="ghost" className="mb-1 -ml-2">
            <Link to="/dashboard/admin/corporates"><ArrowLeft className="mr-1 h-4 w-4" /> Corporate Control Tower</Link>
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight">{data.name}</h1>
          <p className="text-sm text-muted-foreground">
            Account command centre · status {data.status ?? "unknown"} ·
            {data.paymentTermsDays ? ` ${data.paymentTermsDays}-day terms` : " prepaid"} ·
            {data.creditLimitKes > 0 ? ` limit ${formatKes(data.creditLimitKes)}` : " no credit limit"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void load()}>
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh
          </Button>
          <ReportExportMenu
            label="Download statement"
            variant="default"
            disabled={!data.invoices.length}
            build={() => statementReport(data.name, ledger, totals)}
          />
        </div>
      </header>

      {error && (
        <Card className="border-destructive/40">
          <CardContent className="flex items-center gap-2 pt-5 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4" /> {error}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card><CardContent className="pt-5">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Spend this month</p>
          <p className="mt-1 text-2xl font-semibold">{formatKes(spend.invoicedKes)}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {spend.tripCount} trips · avg {formatKes(spend.avgTripKes)}
            {spend.deltaVsPrevPct != null && ` · ${spend.deltaVsPrevPct >= 0 ? "+" : ""}${spend.deltaVsPrevPct.toFixed(1)}% MoM`}
          </p>
        </CardContent></Card>
        <Card><CardContent className="pt-5">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Pending approvals</p>
          <p className={`mt-1 text-2xl font-semibold ${pending.overdue ? "text-destructive" : ""}`}>{pending.count}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {pending.overdue} overdue · exposure {formatKes(pending.exposureKes)}
          </p>
        </CardContent></Card>
        <Card><CardContent className="pt-5">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Upcoming trips (14d)</p>
          <p className="mt-1 text-2xl font-semibold">{trips.length}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {trips.filter((t) => t.approved).length} approved · next {trips[0] ? dt(trips[0].when) : "—"}
          </p>
        </CardContent></Card>
        <Card><CardContent className="pt-5">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Outstanding</p>
          <p className={`mt-1 text-2xl font-semibold ${totals.overdueKes ? "text-destructive" : ""}`}>
            {formatKes(totals.outstandingKes)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatKes(totals.overdueKes)} overdue · compliance {compliance.scorePct.toFixed(0)}%
          </p>
        </CardContent></Card>
      </div>

      <Tabs defaultValue="trips">
        <TabsList className="flex-wrap">
          <TabsTrigger value="trips">Trips</TabsTrigger>
          <TabsTrigger value="approvals">Approvals</TabsTrigger>
          <TabsTrigger value="spend">Spend & budgets</TabsTrigger>
          <TabsTrigger value="compliance">Compliance</TabsTrigger>
          <TabsTrigger value="billing">Invoices & receipts</TabsTrigger>
        </TabsList>

        <TabsContent value="trips" className="mt-4">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Upcoming trips · next 14 days</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {trips.length === 0 && <p className="text-sm text-muted-foreground">No scheduled trips in the window.</p>}
              {trips.map((t) => (
                <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{t.route}</p>
                    <p className="text-xs text-muted-foreground">
                      {dt(t.when)} · in {t.hoursAway < 24 ? `${t.hoursAway.toFixed(1)}h` : `${(t.hoursAway / 24).toFixed(1)}d`} · {t.rideType}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm tabular-nums">{formatKes(t.estimatedFareKes)}</span>
                    <Badge variant="outline" className={t.approved ? BAND_TONE.healthy : BAND_TONE.watch}>{t.status}</Badge>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="approvals" className="mt-4">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Pending approvals</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {pending.items.length === 0 && <p className="text-sm text-muted-foreground">Approval queue is clear.</p>}
              {pending.items.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{p.route}</p>
                    <p className="text-xs text-muted-foreground">
                      Raised {dt(p.requestedAt)} · waiting {p.ageHours.toFixed(1)}h
                      {p.expiresInHours != null && ` · expires in ${p.expiresInHours.toFixed(1)}h`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm tabular-nums">{formatKes(p.estimatedFareKes)}</span>
                    {p.overdue && <Badge variant="outline" className={BAND_TONE.over}>overdue</Badge>}
                  </div>
                </div>
              ))}
              <Button asChild size="sm" variant="outline" className="mt-2">
                <Link to="/dashboard/admin/corporates/approvals">Decide in approvals inbox</Link>
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="spend" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">Department budgets · {spend.monthKey}</CardTitle>
                <ReportExportMenu
                  label="Export budgets"
                  disabled={!budgets.length}
                  build={() => budgetsReport(data.name, budgets)}
                />
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {budgets.length === 0 && <p className="text-sm text-muted-foreground">No active departments configured.</p>}
              {budgets.map((b) => (
                <div key={b.id}>
                  <div className="flex items-center justify-between text-sm">
                    <span>{b.name}{b.code ? ` · ${b.code}` : ""}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {formatKes(b.spentKes)} / {formatKes(b.budgetKes)}
                      <Badge variant="outline" className={`ml-2 ${BAND_TONE[b.band]}`}>{b.band.replace("_", " ")}</Badge>
                    </span>
                  </div>
                  <Progress value={Math.min(100, b.utilisationPct)} className="mt-1 h-2" />
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">Spend trend · 6 months</CardTitle>
                <ReportExportMenu
                  label="Export spend"
                  disabled={!trend.length}
                  build={() => monthlySpendReport(data.name, spend, trend)}
                />
              </div>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {trend.map((m) => (
                <div key={m.monthKey} className="rounded-md border border-border/60 p-3">
                  <p className="text-xs text-muted-foreground">{m.monthKey}</p>
                  <p className="text-sm font-semibold">{formatKes(m.invoicedKes)}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="compliance" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                Compliance status · {compliance.compliant ? "compliant" : `${compliance.blocking.length} blocking`}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {compliance.items.map((i) => (
                <div key={i.docType} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 p-3">
                  <div>
                    <p className="text-sm font-medium">{i.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {i.documentNumber ? `${i.documentNumber} · ` : ""}
                      {i.expiryDate ? `expires ${i.expiryDate}${i.daysToExpiry != null ? ` (${i.daysToExpiry}d)` : ""}` : "no expiry recorded"}
                    </p>
                  </div>
                  <Badge variant="outline" className={COMPLIANCE_TONE[i.state]}>{i.state.replace("_", " ")}</Badge>
                </div>
              ))}
              <Button asChild size="sm" variant="outline" className="mt-2">
                <Link to="/dashboard/admin/corporate-kyb">Open KYB review queue</Link>
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="billing" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">Invoices &amp; receipts</CardTitle>
                <ReportExportMenu
                  label="Export invoices"
                  disabled={!ledger.length}
                  build={() => invoiceLedgerReport(data.name, ledger)}
                />
              </div>
            </CardHeader>

            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase text-muted-foreground">
                    <tr className="border-b border-border/60">
                      <th className="py-2 text-left">Type</th>
                      <th className="py-2 text-left">Reference</th>
                      <th className="py-2 text-left">Date</th>
                      <th className="py-2 text-right">Amount</th>
                      <th className="py-2 text-right">Balance</th>
                      <th className="py-2 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.length === 0 && (
                      <tr><td colSpan={6} className="py-4 text-muted-foreground">No billing records yet.</td></tr>
                    )}
                    {ledger.map((e) => (
                      <tr key={e.id} className="border-b border-border/40">
                        <td className="py-2 capitalize">{e.kind}</td>
                        <td className="py-2">{e.reference}</td>
                        <td className="py-2">{dt(e.date)}</td>
                        <td className="py-2 text-right tabular-nums">{formatKes(e.amountKes)}</td>
                        <td className="py-2 text-right tabular-nums">{formatKes(e.balanceKes)}</td>
                        <td className="py-2">
                          <Badge variant="outline" className={e.overdue ? BAND_TONE.over : BAND_TONE.healthy}>
                            {e.overdue ? "overdue" : e.status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Invoiced {formatKes(totals.invoicedKes)} · paid {formatKes(totals.paidKes)} · outstanding {formatKes(totals.outstandingKes)}
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
