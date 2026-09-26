/**
 * Charter Business Portal.
 *
 * The commercial workspace for chartered services. Everything that used to sit
 * on the public marketing pages — mission planning/booking, the enterprise
 * procurement spine, the approval chain, budget & corporate wallet, and the
 * operator price settings — now lives behind authentication here. The public
 * site is marketing and lead capture only.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ArrowRight, Briefcase, CheckCircle2, Loader2, Plane, ShieldCheck, SlidersHorizontal, Wallet,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useTabDeepLink } from "@/hooks/useTabDeepLink";
import { EnterpriseProcurementPanel } from "@/components/charter/EnterpriseProcurementPanel";
import { CharterPriceSettingsPanel } from "@/components/charter/CharterPriceSettingsPanel";
import { CharterIcon } from "@/components/charter/CharterIcon";
import {
  CHARTER_GROUPS, categoriesByGroup, categoryBySlug, defaultCostSettings, formatMoney,
  type CostSettings,
} from "@/lib/charter/catalog";
import { domainLexicon } from "@/lib/charter/assetDomains";
import {
  approvalChain, emptyProcurement, procurementBlockers, type ProcurementDetails,
} from "@/lib/charter/corporateApproval";
import {
  loadPricingProfile, loadProcurementProfile, savePricingProfile, saveProcurementProfile,
} from "@/lib/charter/portalProfile";
import { charterApi, type CharterBookingRow, type CorporateWalletRow } from "@/lib/charter/api";
import { charterPortalAccess } from "@/lib/charter/portalRbac";
import { ApprovalChainWorkflow } from "@/components/charter/ApprovalChainWorkflow";
import { WalletFundingWizard } from "@/components/charter/WalletFundingWizard";
import { FundingLifecycleTable } from "@/components/charter/FundingLifecycleTable";
import type { FundingRequestRow } from "@/lib/charter/walletFunding";
import {
  buildWorkflow, currentStep, loadWorkflow, notifyApprovalStep, saveWorkflow, type ApprovalWorkflow,
} from "@/lib/charter/approvalWorkflow";
import { leadFromSearch, leadHeadline, type CharterLead } from "@/lib/charter/charterLeads";
import { useLocation } from "react-router-dom";

const TABS = ["overview", "missions", "procurement", "budget", "pricing"] as const;

const PRICING_CONSOLES = [
  { path: "/dashboard/admin/asset-pricing", label: "Asset pricing profiles", desc: "Rate cards per asset class and category." },
  { path: "/dashboard/admin/smartfare-pricing", label: "SmartFare settings", desc: "Dynamic fare governance and guardrails." },
  { path: "/dashboard/admin/smartfare-what-if", label: "What-if simulator", desc: "Model a pricing change before publishing." },
  { path: "/dashboard/admin/smartfare-versions", label: "Version diff & audit", desc: "Who changed which rate, and when." },
  { path: "/dashboard/admin/charter-pricing-alerts", label: "Pricing alerts", desc: "Breaches of floor, ceiling and margin rules." },
];

const CORPORATE_CONSOLES = [
  { path: "/dashboard/corporate/approvals", label: "Approvals queue", desc: "Authorise travel and settlement requests." },
  { path: "/dashboard/corporate/approval-setup", label: "Approval chain setup", desc: "Signatories, thresholds and escalation." },
  { path: "/dashboard/corporate/cost-centers", label: "Cost centres", desc: "Segment charter spend by cost centre." },
  { path: "/dashboard/corporate/expense-codes", label: "Expense codes", desc: "Codes stamped onto charter invoices." },
  { path: "/dashboard/corporate/wallet", label: "Corporate wallet", desc: "Pre-funded balance used for settlement." },
  { path: "/dashboard/corporate/invoicing", label: "Invoicing & statements", desc: "Consolidated corporate invoices." },
];

const money = (n: number) => `KSh ${Math.round(n || 0).toLocaleString("en-KE")}`;

export default function CharterBusinessPortal() {
  const { user, roles } = useAuth();
  const { tab, onTabChange, goTo } = useTabDeepLink(TABS, "overview");
  const location = useLocation();
  const access = useMemo(() => charterPortalAccess(roles), [roles]);
  const lead = useMemo<CharterLead | null>(() => leadFromSearch(location.search), [location.search]);
  const [workflow, setWorkflow] = useState<ApprovalWorkflow | null>(() => loadWorkflow());

  const [procurement, setProcurement] = useState<ProcurementDetails>(() => {
    const seed = leadFromSearch(window.location.search);
    return {
      ...emptyProcurement({
        name: seed?.name ?? "",
        email: seed?.email ?? "",
        phone: seed?.phone ?? "",
        company: seed?.company ?? "",
      }),
      ...(loadProcurementProfile() ?? {}),
      ...(seed
        ? {
            organizationName: seed.company || "",
            approverName: seed.name || "",
            approverTitle: seed.approverTitle || "",
            costCenter: seed.costCenter || "",
            billingContactName: seed.name || "",
            billingContactEmail: seed.email || "",
          }
        : {}),
    };
  });

  const roadCategory = categoryBySlug("bus-charter");
  const [pricing, setPricing] = useState<CostSettings>(() => ({
    ...(roadCategory ? defaultCostSettings(roadCategory) : {
      fuelPrice: 190, fuelBurn: 38, airportFees: 3700, crewCost: 3500,
      demandIndex: 1, seasonIndex: 1, emptyLegDiscountPct: 0,
    } as CostSettings),
    ...(loadPricingProfile() ?? {}),
  }));

  const [bookings, setBookings] = useState<CharterBookingRow[]>([]);
  const [wallets, setWallets] = useState<CorporateWalletRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fundingRequests, setFundingRequests] = useState<FundingRequestRow[]>([]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.allSettled([
      charterApi.listBookings(),
      charterApi.listCorporateWallets(),
      charterApi.listFundingRequests({ limit: 25 }),
    ])
      .then(([b, w, f]) => {
        if (!alive) return;
        if (b.status === "fulfilled") setBookings(b.value);
        if (w.status === "fulfilled") setWallets(w.value.wallets);
        if (f.status === "fulfilled") setFundingRequests(f.value.requests);
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const errors = useMemo(() => procurementBlockers(procurement), [procurement]);
  const chain = useMemo(() => approvalChain(procurement), [procurement]);
  const wallet = useMemo(() => {
    const org = procurement.organizationName.trim().toLowerCase();
    return wallets.find((w) => w.organization_name.toLowerCase() === org) ?? wallets[0] ?? null;
  }, [wallets, procurement.organizationName]);

  const unpaid = bookings.filter((b) => !["paid", "completed", "cancelled"].includes(b.status));
  const committed = bookings.reduce((s, b) => s + (Number(b.amount) || 0), 0);

  const saveProcurement = () => {
    saveProcurementProfile(procurement);
    toast({
      title: "Procurement profile saved",
      description: "Applied to every mission planned from this portal.",
    });
  };

  const savePricing = () => {
    savePricingProfile(pricing);
    toast({ title: "Price settings saved", description: "Applied to portal quotations." });
  };

  /**
   * Provisions the wallet on demand. Provisioning never moves money — credits
   * happen only inside the verified M-Pesa callback path.
   */
  const ensureWallet = async (): Promise<CorporateWalletRow> => {
    if (wallet) return wallet;
    const res = await charterApi.ensureCorporateWallet({
      organization_name: procurement.organizationName.trim(),
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


  const updateWorkflow = (w: ApprovalWorkflow) => {
    setWorkflow(w);
    saveWorkflow(w);
  };

  const openWorkflow = async () => {
    if (Object.keys(errors).length > 0) {
      toast({
        title: "Complete the procurement spine first",
        description: Object.values(errors)[0],
        variant: "destructive",
      });
      return;
    }
    const w = buildWorkflow(procurement, {
      reference: `CHT-${Date.now().toString(36).toUpperCase()}`,
      label: lead ? leadHeadline(lead) : `${procurement.organizationName} charter mission`,
      amountKes: committed,
    });
    updateWorkflow(w);
    const next = currentStep(w);
    if (next) {
      const res = await notifyApprovalStep(w, next, "assigned");
      toast({
        title: "Submitted for authorisation",
        description: res.ok ? `${next.assigneeName} notified by email.` : "Chain opened. Email notification could not be delivered.",
      });
    }
  };

  return (
    <div className="space-y-6">
      <header className="rounded-2xl border border-border bg-gradient-to-br from-primary/10 via-card to-primary-glow/10 p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">Charter business portal</p>
        <h1 className="mt-2 text-2xl md:text-3xl font-bold tracking-tight">
          Plan, authorise and settle chartered mobility.
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Mission planning, enterprise procurement, the approval chain, budget and price settings — governed in
          one authenticated workspace. Public charter pages now handle marketing and enquiries only.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">{access.label}</Badge>
          <span className="text-xs text-muted-foreground">{access.scope}</span>
        </div>
        {lead && (
          <div className="mt-4 rounded-xl border border-primary/30 bg-primary/10 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">Quote lead pre-filled</p>
            <p className="mt-1 text-sm">{leadHeadline(lead)}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Mission, sector details and procurement contact carried over from the marketing enquiry — nothing to retype.
            </p>
          </div>
        )}
        <div className="mt-5 flex flex-wrap gap-3">
          <Button onClick={() => goTo("missions", "portal-missions")}>
            Plan a mission<ArrowRight className="ml-2 h-4 w-4" />
          </Button>
          <Button variant="outline" onClick={() => goTo("procurement", "enterprise-procurement")}>
            Enterprise procurement
          </Button>
        </div>
      </header>

      <Tabs value={tab} onValueChange={onTabChange}>
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="missions">Missions &amp; booking</TabsTrigger>
          <TabsTrigger value="procurement">Procurement &amp; approvals</TabsTrigger>
          {access.can("view_budget") && <TabsTrigger value="budget">Budget &amp; wallet</TabsTrigger>}
          {access.can("view_pricing") && <TabsTrigger value="pricing">Price settings</TabsTrigger>}
        </TabsList>

        {/* ── Overview ─────────────────────────────────────────────── */}
        <TabsContent value="overview" className="mt-6 space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi icon={Plane} label="Charter bookings" value={loading ? "…" : String(bookings.length)} />
            <Kpi icon={ShieldCheck} label="Awaiting settlement" value={loading ? "…" : String(unpaid.length)} />
            <Kpi icon={Briefcase} label="Committed value" value={loading ? "…" : money(committed)} />
            <Kpi icon={Wallet} label="Wallet balance" value={wallet ? money(wallet.balance_kes) : "Not provisioned"} />
          </div>

          <Card>
            <CardHeader><CardTitle className="text-base">Corporate governance consoles</CardTitle></CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {CORPORATE_CONSOLES.map((c) => (
                <Link
                  key={c.path}
                  to={c.path}
                  className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40"
                >
                  <p className="text-sm font-semibold">{c.label}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{c.desc}</p>
                </Link>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Missions & booking ───────────────────────────────────── */}
        <TabsContent value="missions" className="mt-6 space-y-6">
          <section id="portal-missions" className="scroll-mt-24 space-y-6">
            {CHARTER_GROUPS.map((group) => (
              <Card key={group.key}>
                <CardHeader>
                  <CardTitle className="text-base">{group.title}</CardTitle>
                  <p className="text-sm text-muted-foreground">{group.blurb}</p>
                </CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-3">
                  {categoriesByGroup(group.key).map((c) => (
                    <Link
                      key={c.slug}
                      to={`/dashboard/charter/book/${c.slug}`}
                      className="group rounded-xl border border-border bg-card p-4 transition-all hover:border-primary/40 hover:shadow-elegant"
                    >
                      <CharterIcon name={c.icon} className="h-6 w-6 text-primary" />
                      <p className="mt-3 text-sm font-semibold">{c.label}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{c.menuDesc}</p>
                      <span className="mt-3 inline-flex items-center text-xs text-primary">
                        Plan mission
                        <ArrowRight className="ml-1 h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
                      </span>
                    </Link>
                  ))}
                </CardContent>
              </Card>
            ))}
          </section>

          <Card>
            <CardHeader><CardTitle className="text-base">Recent charter bookings</CardTitle></CardHeader>
            <CardContent>
              {loading ? (
                <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading bookings…
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Reference</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bookings.slice(0, 10).map((b) => (
                      <TableRow key={b.id}>
                        <TableCell className="font-mono text-xs">{b.reference}</TableCell>
                        <TableCell><Badge variant="outline" className="capitalize">{b.status}</Badge></TableCell>
                        <TableCell className="text-right">{formatMoney(Number(b.amount) || 0, (b.currency === "USD" ? "USD" : "KES"))}</TableCell>
                      </TableRow>
                    ))}
                    {bookings.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                          No charter bookings yet — plan a mission above.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Procurement & approvals ──────────────────────────────── */}
        <TabsContent value="procurement" className="mt-6 space-y-6">
          {access.can("edit_procurement") ? (
            <EnterpriseProcurementPanel
              value={procurement}
              onChange={setProcurement}
              signedIn={Boolean(user)}
            />
          ) : (
            <Card>
              <CardHeader><CardTitle className="text-base">Enterprise procurement</CardTitle></CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Your role can review authorisations but not edit the procurement spine.
              </CardContent>
            </Card>
          )}

          <ApprovalChainWorkflow
            workflow={workflow}
            onChange={updateWorkflow}
            canApprove={access.can("approve_step")}
            canAssign={access.can("submit_for_approval")}
            onCreate={openWorkflow}
          />

          <Card>
            <CardHeader><CardTitle className="text-base">Approval chain</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <ol className="space-y-2">
                {chain.map((entry, i) => (
                  <li key={entry} className="flex items-start gap-3 text-sm">
                    <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                      {i + 1}
                    </span>
                    <span>{entry}</span>
                  </li>
                ))}
              </ol>
              {Object.keys(errors).length > 0 ? (
                <p className="text-xs text-destructive">
                  Complete the procurement fields above before missions can be authorised.
                </p>
              ) : (
                <p className="flex items-center gap-2 text-xs text-primary">
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Chain complete and ready to authorise.
                </p>
              )}
              {access.can("edit_procurement") && (
                <Button onClick={saveProcurement}>Save procurement profile</Button>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Budget & wallet ──────────────────────────────────────── */}
        <TabsContent value="budget" className="mt-6 space-y-6">
          <Card>
            <CardHeader><CardTitle className="text-base">Charter budget &amp; corporate wallet</CardTitle></CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-3">
                <Kpi icon={Wallet} label="Available balance" value={wallet ? money(wallet.balance_kes) : "Not provisioned"} />
                <Kpi icon={Briefcase} label="Committed to missions" value={money(committed)} />
                <Kpi icon={ShieldCheck} label="Cost centre" value={procurement.costCenter.trim() || "Unassigned"} />
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
                onWalletChange={(w) =>
                  setWallets((prev) => [w, ...prev.filter((x) => x.id !== w.id)])
                }
                onFundingChange={refreshFunding}
              />
              <p className="text-xs text-muted-foreground">
                Balances increase only when Safaricom confirms the payment. Every cleared funding writes one
                immutable ledger entry stamped with the approving authority and cost centre.
              </p>

              <FundingLifecycleTable requests={fundingRequests} />


              <div className="rounded-xl border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Organisation</TableHead>
                      <TableHead>Approving authority</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {wallets.map((w) => (
                      <TableRow key={w.id}>
                        <TableCell className="font-medium">{w.organization_name}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {w.approver_name ?? "—"}{w.approver_title ? ` · ${w.approver_title}` : ""}
                        </TableCell>
                        <TableCell className="text-right">{money(w.balance_kes)}</TableCell>
                      </TableRow>
                    ))}
                    {wallets.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                          No charter wallet provisioned yet.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Price settings ───────────────────────────────────────── */}
        <TabsContent value="pricing" className="mt-6 space-y-6">
          <CharterPriceSettingsPanel
            value={pricing}
            onChange={setPricing}
            onReset={() => roadCategory && setPricing(defaultCostSettings(roadCategory))}
            currency={roadCategory?.currency ?? "KES"}
            unitLabel={roadCategory ? "day" : "day"}
            feesLabel={domainLexicon("bus-charter").feesLabel}
            crewLabel={domainLexicon("bus-charter").crewLabel}
          />
          {access.can("edit_pricing") && <Button onClick={savePricing}>Save price settings</Button>}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <SlidersHorizontal className="h-4 w-4 text-primary" aria-hidden="true" />
                Pricing governance consoles
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {PRICING_CONSOLES.map((c) => (
                <Link
                  key={c.path}
                  to={c.path}
                  className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40"
                >
                  <p className="text-sm font-semibold">{c.label}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{c.desc}</p>
                </Link>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

const Kpi = ({
  icon: Icon, label, value,
}: { icon: typeof Wallet; label: string; value: string }) => (
  <div className="rounded-xl border border-border bg-card p-4">
    <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
    <p className="mt-3 text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
    <p className="mt-1 text-lg font-semibold">{value}</p>
  </div>
);
