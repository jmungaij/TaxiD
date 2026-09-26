/**
 * Corporate Charter Business workspace.
 *
 * The merged commercial workspace for chartered mobility: Overview, Employee
 * mobility, Executive travel, Booking Centre, Wallets, Billing, Policies,
 * Reports and Integrations. It consolidates what previously lived across the
 * standalone Charter Business Portal and the corporate consoles, while every
 * legacy route (/dashboard/charter/portal, /dashboard/corporate/*) keeps
 * working and is linked from here.
 *
 * Capabilities are role-derived (see portalRbac) and tier-gated (Premium).
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowRight, Briefcase, Building2, CalendarClock, Crown, FileText, Plug, Receipt, ShieldCheck, Users, Wallet } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useEntitlements } from "@/hooks/useEntitlements";
import { useTabDeepLink } from "@/hooks/useTabDeepLink";
import { EnterpriseBookingCentre } from "@/components/charter/EnterpriseBookingCentre";
import { EnterpriseProcurementPanel } from "@/components/charter/EnterpriseProcurementPanel";
import { CharterPriceSettingsPanel } from "@/components/charter/CharterPriceSettingsPanel";
import { WalletFundingWizard } from "@/components/charter/WalletFundingWizard";
import { FundingLifecycleTable } from "@/components/charter/FundingLifecycleTable";
import type { FundingRequestRow } from "@/lib/charter/walletFunding";

import { charterPortalAccess } from "@/lib/charter/portalRbac";
import { charterApi, type CharterBookingRow, type CorporateWalletRow } from "@/lib/charter/api";
import {
  emptyProcurement, procurementBlockers, approvalChain, type ProcurementDetails,
} from "@/lib/charter/corporateApproval";
import {
  loadPricingProfile, loadProcurementProfile, savePricingProfile, saveProcurementProfile,
} from "@/lib/charter/portalProfile";
import { categoryBySlug, defaultCostSettings, type CostSettings } from "@/lib/charter/catalog";

const TABS = [
  "overview", "employee", "executive", "booking", "wallets",
  "billing", "policies", "reports", "integrations",
] as const;

const money = (n: number) => `KSh ${Math.round(n || 0).toLocaleString("en-KE")}`;

/** Legacy destinations preserved and surfaced from the merged workspace. */
const LEGACY_LINKS = [
  { path: "/dashboard/charter/portal", label: "Charter Business Portal (legacy)", desc: "Original commercial desk — still live." },
  { path: "/dashboard/charter/analytics", label: "Charter Analytics", desc: "Demand, conversion and yield." },
  { path: "/dashboard/charter/operator-portal", label: "Operator Portal", desc: "Operator-side fleet and availability." },
  { path: "/dashboard/corporate/approvals", label: "Approvals queue", desc: "Authorise travel and settlement." },
  { path: "/dashboard/corporate/approval-setup", label: "Approval chain setup", desc: "Signatories and thresholds." },
  { path: "/dashboard/corporate/cost-centers", label: "Cost centres", desc: "Segment charter spend." },
  { path: "/dashboard/corporate/expense-codes", label: "Expense codes", desc: "Codes stamped on invoices." },
  { path: "/dashboard/corporate/invoicing", label: "Invoicing & statements", desc: "Consolidated invoices." },
  { path: "/dashboard/corporate/audit-log", label: "Corporate audit log", desc: "Immutable corporate trail." },
];

const INTEGRATIONS = [
  { name: "M-Pesa (Daraja)", desc: "STK push settlement for missions under KSh 250,000.", path: "/dashboard/admin/mpesa" },
  { name: "Corporate wallet ledger", desc: "Hash-chained pre-funded balance movements.", path: "/dashboard/corporate/cash-ledger" },
  { name: "Charter webhooks", desc: "Signed booking and payment event fan-out.", path: "/dashboard/charter/portal" },
  { name: "Document verification API", desc: "QR + SHA-256 dossier authenticity checks.", path: "/verify" },
  { name: "eTIMS / KRA", desc: "Tax invoice submission for settled charter revenue.", path: "/dashboard/admin/tax" },
  { name: "Email notifications", desc: "Approval-step and quotation alerts.", path: "/dashboard/admin/alert-rules" },
];

export default function CorporateCharterWorkspace() {
  const { user, roles } = useAuth();
  const { label: tierLabel, isElite } = useEntitlements();
  const { tab, onTabChange, goTo } = useTabDeepLink(TABS, "overview");
  const access = useMemo(() => charterPortalAccess(roles), [roles]);

  const [bookings, setBookings] = useState<CharterBookingRow[]>([]);
  const [wallets, setWallets] = useState<CorporateWalletRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fundingRequests, setFundingRequests] = useState<FundingRequestRow[]>([]);


  const [procurement, setProcurement] = useState<ProcurementDetails>(() => ({
    ...emptyProcurement({ name: "", email: "", phone: "", company: "" }),
    ...(loadProcurementProfile() ?? {}),
  }));

  const roadCategory = categoryBySlug("bus-charter");
  const [pricing, setPricing] = useState<CostSettings>(() => ({
    ...(roadCategory
      ? defaultCostSettings(roadCategory)
      : ({
          fuelPrice: 190, fuelBurn: 38, airportFees: 3700, crewCost: 3500,
          demandIndex: 1, seasonIndex: 1, emptyLegDiscountPct: 0,
        } as CostSettings)),
    ...(loadPricingProfile() ?? {}),
  }));

  useEffect(() => {
    let alive = true;
    Promise.allSettled([charterApi.listBookings(), charterApi.listCorporateWallets()])
      .then(([b, w]) => {
        if (!alive) return;
        if (b.status === "fulfilled") setBookings(b.value);
        if (w.status === "fulfilled") setWallets(w.value.wallets);
      })
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  const errors = useMemo(() => procurementBlockers(procurement), [procurement]);
  const chain = useMemo(() => approvalChain(procurement), [procurement]);

  const wallet = useMemo(() => {
    const org = procurement.organizationName.trim().toLowerCase();
    return wallets.find((w) => w.organization_name.toLowerCase() === org) ?? wallets[0] ?? null;
  }, [wallets, procurement.organizationName]);

  const stats = useMemo(() => {
    const committed = bookings.reduce((s, b) => s + (Number(b.amount) || 0), 0);
    const unpaid = bookings.filter((b) => !["paid", "completed", "cancelled"].includes(b.payment_status));
    const balance = wallets.reduce((s, w) => s + (Number(w.balance_kes) || 0), 0);
    return { committed, unpaid, balance };
  }, [bookings, wallets]);

  const employeeBookings = bookings.filter((b) => b.category_slug.includes("bus") || b.category_slug.includes("rental"));
  const executiveBookings = bookings.filter((b) => !b.category_slug.includes("bus") && !b.category_slug.includes("rental"));

  /**
   * Wallets are provisioned on demand, but they are NEVER credited here.
   * Every credit must come from a verified M-Pesa callback (see
   * WalletFundingWizard + charter_wallet_apply_funding_callback).
   */
  const ensureWallet = async (): Promise<CorporateWalletRow> => {
    if (wallet) return wallet;
    const res = await charterApi.ensureCorporateWallet({
      organization_name: procurement.organizationName.trim() || "Corporate account",
      approver_name: procurement.approverName.trim(),
      approver_title: procurement.approverTitle.trim(),
    });
    setWallets((prev) => [res.wallet, ...prev.filter((w) => w.id !== res.wallet.id)]);
    return res.wallet;
  };

  const refreshFunding = async () => {
    try {
      const [funding, walletList] = await Promise.all([
        charterApi.listFundingRequests({ limit: 25 }),
        charterApi.listCorporateWallets(),
      ]);
      setFundingRequests(funding.requests);
      setWallets(walletList.wallets);
    } catch { /* non-blocking */ }
  };

  useEffect(() => { void refreshFunding(); }, []);


  return (
    <div className="space-y-6">
      <header className="rounded-2xl border border-border bg-gradient-to-br from-primary/10 via-card to-primary-glow/10 p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">Corporate Charter Business</p>
        <h1 className="mt-2 text-2xl md:text-3xl font-bold tracking-tight">
          One workspace for corporate charter, leasing and rental mobility.
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Employee mobility and executive travel, a single Enterprise Booking Centre for every sector, corporate
          wallets, billing, policy governance, reporting and integrations — merged from the charter portal and
          corporate consoles with all legacy routes preserved.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">{access.label}</Badge>
          <Badge variant="outline" className="gap-1">
            <Crown className="h-3 w-3" aria-hidden /> {tierLabel}
          </Badge>
          <span className="text-xs text-muted-foreground">{access.scope}</span>
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <Button onClick={() => goTo("booking", "ccb-booking")}>
            Open Booking Centre<ArrowRight className="ml-2 h-4 w-4" aria-hidden />
          </Button>
          <Button variant="outline" onClick={() => goTo("wallets", "ccb-wallets")}>Corporate wallets</Button>
          {isElite && (
            <Button asChild variant="secondary">
              <Link to="/dashboard/admin/ccb-operations">Operations Centre</Link>
            </Button>
          )}
        </div>
      </header>

      <Tabs value={tab} onValueChange={onTabChange}>
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="employee">Employee mobility</TabsTrigger>
          <TabsTrigger value="executive">Executive travel</TabsTrigger>
          <TabsTrigger value="booking">Booking Centre</TabsTrigger>
          {access.can("view_budget") && <TabsTrigger value="wallets">Wallets</TabsTrigger>}
          {access.can("view_budget") && <TabsTrigger value="billing">Billing</TabsTrigger>}
          <TabsTrigger value="policies">Policies</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview" className="mt-6 space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi icon={Briefcase} label="Charter missions" value={loading ? null : String(bookings.length)} />
            <Kpi icon={Receipt} label="Awaiting settlement" value={loading ? null : String(stats.unpaid.length)} />
            <Kpi icon={Building2} label="Committed value" value={loading ? null : money(stats.committed)} />
            <Kpi icon={Wallet} label="Wallet balance" value={loading ? null : money(stats.balance)} />
          </div>

          <Card>
            <CardHeader><CardTitle className="text-base">Merged navigation — legacy destinations preserved</CardTitle></CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              {LEGACY_LINKS.map((l) => (
                <Link
                  key={l.path}
                  to={l.path}
                  className="rounded-xl border border-border p-4 transition-colors hover:border-primary/40 hover:bg-primary/5"
                >
                  <p className="font-medium">{l.label}</p>
                  <p className="text-sm text-muted-foreground">{l.desc}</p>
                </Link>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Employee mobility */}
        <TabsContent value="employee" className="mt-6 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="h-4 w-4 text-primary" aria-hidden /> Employee mobility
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Staff shuttles, delegate movements and pooled rentals booked against departmental cost centres.
              </p>
              <BookingTable rows={employeeBookings} loading={loading} empty="No employee mobility missions yet." />
              <Button variant="outline" onClick={() => goTo("booking", "ccb-booking")}>
                Book employee mobility<ArrowRight className="ml-2 h-4 w-4" aria-hidden />
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Executive travel */}
        <TabsContent value="executive" className="mt-6 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Crown className="h-4 w-4 text-primary" aria-hidden /> Executive travel
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Board and C-suite movements — private aircraft, helicopter and marine missions with counter-signed
                authorisation.
              </p>
              <BookingTable rows={executiveBookings} loading={loading} empty="No executive missions yet." />
              <div className="rounded-xl border border-border p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Approval chain</p>
                <ol className="mt-2 space-y-1 text-sm">
                  {chain.length > 0
                    ? chain.map((s, i) => <li key={s}>{i + 1}. {s}</li>)
                    : <li className="text-muted-foreground">Complete the procurement spine under Policies to derive the chain.</li>}
                </ol>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Booking Centre */}
        <TabsContent value="booking" className="mt-6 space-y-6">
          <section id="ccb-booking" className="space-y-4">
            <h2 className="text-lg font-semibold">Enterprise Booking Centre</h2>
            <EnterpriseBookingCentre
              costCenter={procurement.costCenter}
              organizationName={procurement.organizationName}
            />
          </section>
        </TabsContent>

        {/* Wallets */}
        {access.can("view_budget") && (
          <TabsContent value="wallets" className="mt-6 space-y-6">
            <section id="ccb-wallets" className="space-y-4">
              <Card>
                <CardHeader><CardTitle className="text-base">Corporate wallets</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Kpi icon={Wallet} label="Total balance" value={loading ? null : money(stats.balance)} />
                    <Kpi icon={Building2} label="Wallets" value={loading ? null : String(wallets.length)} />
                    <Kpi icon={Receipt} label="Unsettled missions" value={loading ? null : String(stats.unpaid.length)} />
                  </div>

                  <WalletFundingWizard
                    wallet={wallet}
                    canFund={access.can("fund_wallet")}
                    ensureWallet={ensureWallet}
                    defaults={{
                      costCenter: procurement.costCenter.trim(),
                      approverName: procurement.approverName.trim(),
                      approverTitle: procurement.approverTitle.trim(),
                    }}
                    onWalletChange={(w) => setWallets((prev) => [w, ...prev.filter((x) => x.id !== w.id)])}
                    onFundingChange={refreshFunding}
                  />

                  <FundingLifecycleTable requests={fundingRequests} />


                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Organisation</TableHead>
                        <TableHead>Approving authority</TableHead>
                        <TableHead className="text-right">Balance</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {wallets.length === 0 && (
                        <TableRow><TableCell colSpan={3} className="text-muted-foreground">No corporate wallet yet.</TableCell></TableRow>
                      )}
                      {wallets.map((w) => (
                        <TableRow key={w.id}>
                          <TableCell className="font-medium">{w.organization_name}</TableCell>
                          <TableCell>{w.approver_name || "—"}</TableCell>
                          <TableCell className="text-right tabular-nums">{money(w.balance_kes)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </section>
          </TabsContent>
        )}

        {/* Billing */}
        {access.can("view_budget") && (
          <TabsContent value="billing" className="mt-6 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Receipt className="h-4 w-4 text-primary" aria-hidden /> Billing & settlement
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <BookingTable rows={stats.unpaid} loading={loading} empty="Everything is settled." highlightUnpaid />
                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    { to: "/dashboard/corporate/invoicing", label: "Invoices & statements" },
                    { to: "/dashboard/corporate/pre-billing", label: "Pre-billing review" },
                    { to: "/dashboard/corporate/reconciliation", label: "Reconciliation" },
                    { to: "/dashboard/corporate/cash-ledger", label: "Cash ledger" },
                    { to: "/dashboard/corporate-charter/wallets", label: "Charter wallets" },
                  ].map((l) => (

                    <Button key={l.to} asChild variant="secondary" className="justify-between">
                      <Link to={l.to}>{l.label}<ArrowRight className="h-4 w-4" aria-hidden /></Link>
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Policies */}
        <TabsContent value="policies" className="mt-6 space-y-6">
          <section id="ccb-procurement" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ShieldCheck className="h-4 w-4 text-primary" aria-hidden /> Procurement spine & travel policy
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <EnterpriseProcurementPanel value={procurement} onChange={setProcurement} signedIn={Boolean(user)} />
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => {
                      saveProcurementProfile(procurement);
                      toast({ title: "Procurement profile saved", description: "Applied to every mission booked here." });
                    }}
                    disabled={!access.can("edit_procurement")}
                  >
                    Save procurement profile
                  </Button>
                  <Button asChild variant="outline"><Link to="/dashboard/corporate/policies">Ride policies</Link></Button>
                  <Button asChild variant="outline"><Link to="/dashboard/corporate/approval-setup">Approval chain setup</Link></Button>
                </div>
                {Object.keys(errors).length > 0 && (
                  <p className="text-sm text-muted-foreground">
                    Outstanding: {Object.values(errors).join(" · ")}
                  </p>
                )}
              </CardContent>
            </Card>

            {access.can("view_pricing") && (
              <Card>
                <CardHeader><CardTitle className="text-base">Governed price settings</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <fieldset disabled={!access.can("edit_pricing")} className="disabled:opacity-70">
                    <CharterPriceSettingsPanel value={pricing} onChange={setPricing} currency="KES" />
                  </fieldset>

                  {access.can("edit_pricing") && (
                    <Button
                      onClick={() => {
                        savePricingProfile(pricing);
                        toast({ title: "Price settings saved", description: "Applied to workspace quotations." });
                      }}
                    >
                      Save price settings
                    </Button>
                  )}
                </CardContent>
              </Card>
            )}
          </section>
        </TabsContent>

        {/* Reports */}
        <TabsContent value="reports" className="mt-6 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4 text-primary" aria-hidden /> Reports & analytics
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <Kpi icon={CalendarClock} label="Missions this period" value={loading ? null : String(bookings.length)} />
                <Kpi icon={Building2} label="Employee mobility" value={loading ? null : String(employeeBookings.length)} />
                <Kpi icon={Crown} label="Executive travel" value={loading ? null : String(executiveBookings.length)} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  { to: "/dashboard/corporate-charter/booking", label: "Enterprise booking centre" },
                  { to: "/dashboard/charter/analytics", label: "Charter analytics" },
                  { to: "/dashboard/corporate/spend", label: "Corporate spend" },
                  { to: "/dashboard/corporate/completed-rides", label: "Completed missions" },
                  { to: "/dashboard/corporate/audit-log", label: "Audit log" },
                ].map((l) => (

                  <Button key={l.to} asChild variant="secondary" className="justify-between">
                    <Link to={l.to}>{l.label}<ArrowRight className="h-4 w-4" aria-hidden /></Link>
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Integrations */}
        <TabsContent value="integrations" className="mt-6 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Plug className="h-4 w-4 text-primary" aria-hidden /> Integrations
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              {INTEGRATIONS.map((i) => (
                <Link
                  key={i.name}
                  to={i.path}
                  className="rounded-xl border border-border p-4 transition-colors hover:border-primary/40 hover:bg-primary/5"
                >
                  <p className="font-medium">{i.name}</p>
                  <p className="text-sm text-muted-foreground">{i.desc}</p>
                </Link>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
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
        {value === null ? (
          <Skeleton className="mt-2 h-7 w-24" />
        ) : (
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
          <TableHead>Status</TableHead>
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
