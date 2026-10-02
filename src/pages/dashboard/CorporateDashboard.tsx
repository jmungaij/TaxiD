import { useAuth } from "@/hooks/useAuth";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  Wallet, Users, ClipboardCheck, BarChart3, Shield, Building2, AlertTriangle,
  Receipt, BookOpen, LogOut, Award, UserCheck, Radio, CheckCircle2,
  LayoutDashboard, Car, Settings as SettingsIcon, ShieldCheck, PiggyBank,
  FileSpreadsheet, FolderOpen, ChevronRight, Clock, Globe, Hash, UserX, KeyRound,
  AlertOctagon, Building, LineChart, Landmark, HeartPulse, ScrollText, CreditCard,
  History, Ticket, Mail, Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CorporatePaybillCard } from "@/components/dashboard/CorporatePaybillCard";
import { TransactionsList } from "@/components/dashboard/TransactionsList";
import { SectionErrorBoundary } from "@/components/dashboard/SectionErrorBoundary";
import { cn } from "@/lib/utils";
import { CONTACT, ADMIN_MAILTO } from "@/config/contact";
import {
  CORPORATE_ROLES, CORPORATE_EMPLOYEE_SELECT_FIELDS,
  normalizeCorporateRole, corporateRoleLabel, type CorporateRole,
} from "@/lib/corporateRoles";
import CorporateEmployees from "./corporate/Employees";
import CorporateDepartments from "./corporate/Departments";
import CorporateCostCenters from "./corporate/CostCenters";
import CorporateDesignations from "./corporate/Designations";
import CorporateApprovalSetup from "./corporate/ApprovalSetup";
import CorporateManualDispatch from "./corporate/ManualDispatch";
import CorporateRequestRide from "./corporate/RequestRide";

import CorporateCompletedRides from "./corporate/CompletedRides";
import CorporatePolicies from "./corporate/Policies";
import CorporateApprovals from "./corporate/Approvals";
import { PendingTripDecisions } from "@/components/corporate/PendingTripDecisions";
import { CreditStatusCard } from "@/components/corporate/CreditStatusCard";
import CorporateViolations from "./corporate/Violations";
import CorporateExpenseCodes from "./corporate/ExpenseCodes";
import CorporateCashLedger from "./corporate/CashLedger";
import CorporateMyPaybillProofs from "./corporate/MyPaybillProofs";
import CorporateAuditLog from "./corporate/AuditLog";
import CorporateReconciliation from "./corporate/Reconciliation";
import CorporateDocuments from "./corporate/Documents";
import CorporateInvoicing from "./corporate/Invoicing";
import CorporateOrganisation from "./corporate/Organisation";
import TripLimitsPanel from "@/components/corporate/TripLimitsPanel";
import AllowedServicesPanel from "@/components/corporate/AllowedServicesPanel";
import DepartmentBudgetsPanel from "@/components/corporate/DepartmentBudgetsPanel";
import {
  CorporateLiveTripsCard, SpendByDepartmentCard,
  ScheduledKpiTile, CancelledKpiTile, useCorporateTripCounts,
} from "@/components/dashboard/CorporateOpsCards";
import { createKeyedTtlCache } from "@/lib/cache/ttlCache";

type CorporateContext = { corporateId: string; corporateName: string; walletId: string; balance: number };
type CorporateCounts = { employees: number; pending: number; violations: number };
const corporateContextCache = createKeyedTtlCache<string, CorporateContext>(60_000);
const corporateCountsCache = createKeyedTtlCache<string, CorporateCounts>(30_000);



/* ------------------------------------------------------------------ */
/*  Top-tab + sub-nav configuration                                    */
/* ------------------------------------------------------------------ */

type SubItem = { key: string; label: string; icon: React.ComponentType<{ className?: string }> };
type TopTab = {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** vertical = left sidebar sub-nav, horizontal = underline tabs at top of panel */
  layout?: "vertical" | "horizontal";
  sub?: SubItem[];
};

const TOP_TABS: TopTab[] = [
  { key: "dashboard",   label: "Dashboard",   icon: LayoutDashboard },
  { key: "staff",       label: "Staff",       icon: Users, layout: "horizontal",
    sub: [
      { key: "active",       label: "Active",       icon: CheckCircle2 },
      { key: "invited",      label: "Invited",      icon: Mail },
      { key: "suspended",    label: "Suspended",    icon: UserX },
      { key: "removed",      label: "Removed",      icon: UserX },
      { key: "designations", label: "Designations", icon: Award },
    ] },
  { key: "trips",       label: "Trips",       icon: Car, layout: "horizontal",
    sub: [
      // Audit #5 — rename inner "Trips › Trips" to "Completed" (mounts CorporateCompletedRides).
      { key: "request",     label: "Request a Ride",  icon: Send },
      { key: "trips",       label: "Completed",       icon: Car },

      { key: "tickets",     label: "Tickets",         icon: Ticket },
      { key: "approvals",   label: "Approvals",       icon: ClipboardCheck },
      { key: "dispatch",    label: "Manual Dispatch", icon: Radio },
      { key: "statistics",  label: "Statistics",      icon: BarChart3 },
    ] },
  { key: "settings",    label: "Settings",    icon: SettingsIcon, layout: "vertical",
    sub: [
      { key: "services",         label: "Services",         icon: SettingsIcon },
      { key: "approval-feature", label: "Approval Feature", icon: ShieldCheck },
      { key: "vehicles",         label: "Vehicles",         icon: Car },
      { key: "trip-limits",      label: "Trip Limits",      icon: AlertTriangle },
      { key: "trip-approvers",   label: "Trip Approvers",   icon: UserCheck },
      { key: "ticket-expiry",    label: "Ticket Expiry",    icon: Clock },
      { key: "hours",            label: "Hours",            icon: Clock },
      { key: "intercountry",     label: "InterCountry",     icon: Globe },
      { key: "codes",            label: "Codes",            icon: Hash },
      { key: "block-preferred",  label: "BlockPreferred",   icon: UserX },
      { key: "trip-otp",         label: "Trip OTP",         icon: KeyRound },
      { key: "policies",         label: "Policies",         icon: Shield },
      { key: "violations",       label: "Violations",       icon: AlertOctagon },
    ] },
  { key: "departments", label: "Departments", icon: Building, layout: "vertical",
    sub: [
      { key: "list",         label: "Departments",  icon: Building },
      { key: "cost-centers", label: "Cost Centers", icon: Landmark },
    ] },
  { key: "admins",      label: "Admins",      icon: ShieldCheck },
  { key: "budget",      label: "Budget",      icon: PiggyBank, layout: "vertical",
    sub: [
      { key: "summary",      label: "Summary",      icon: LineChart },
      { key: "corporate",    label: "Corporate",    icon: Building2 },
      { key: "departmental", label: "Departmental", icon: Building },
      { key: "insurance",    label: "Insurance",    icon: HeartPulse },
    ] },
  { key: "billing",     label: "Billing",     icon: FileSpreadsheet, layout: "vertical",
    sub: [
      { key: "statement",      label: "Statement",       icon: ScrollText },
      { key: "payments",       label: "Payments",        icon: CreditCard },
      { key: "cash-ledger",    label: "Cash Ledger",     icon: BookOpen },
      { key: "paybill-proofs", label: "Paybill Proofs",  icon: Receipt },
      { key: "reconciliation", label: "Reconciliation",  icon: BarChart3 },
      { key: "audit-log",      label: "Audit Log",       icon: Landmark },
    ] },
  { key: "organisation", label: "Organisation", icon: Building2 },
  { key: "documents",   label: "Documents",   icon: FolderOpen },
];

// Legacy last-segment paths that should map to a new (top, sub) tab pair.
const LEGACY_MAP: Record<string, [string, string?]> = {
  overview: ["dashboard"],
  employees: ["staff", "active"],
  designations: ["staff", "designations"],
  "approval-setup": ["settings", "trip-approvers"],
  policies: ["settings", "policies"],
  "expense-codes": ["settings", "codes"],
  violations: ["settings", "violations"],
  "manual-dispatch": ["trips", "dispatch"],
  approvals: ["trips", "approvals"],
  "completed-rides": ["trips", "trips"],
  spend: ["trips", "statistics"],
  invoicing: ["billing", "statement"],
  "pre-billing": ["billing", "statement"],

  "cash-ledger": ["billing", "cash-ledger"],
  "paybill-proofs": ["billing", "paybill-proofs"],
  reconciliation: ["billing", "reconciliation"],
  "audit-log": ["billing", "audit-log"],
  wallet: ["billing", "cash-ledger"],
  departments: ["departments"],
};

function parsePath(pathname: string): { top: string; sub?: string } {
  const parts = pathname.replace(/^\/dashboard\/corporate\/?/, "").split("/").filter(Boolean);
  if (parts.length === 0) return { top: "dashboard" };
  const [a, b] = parts;
  if (parts.length === 1 && LEGACY_MAP[a]) {
    const [t, s] = LEGACY_MAP[a];
    return { top: t, sub: s };
  }
  const tab = TOP_TABS.find(t => t.key === a);
  if (!tab) return { top: "dashboard" };
  if (tab.sub && b) {
    const s = tab.sub.find(x => x.key === b);
    return { top: a, sub: s?.key ?? tab.sub[0].key };
  }
  return { top: a, sub: tab.sub?.[0].key };
}

/* ------------------------------------------------------------------ */
/*  Main dashboard component                                          */
/* ------------------------------------------------------------------ */

export default function CorporateDashboard() {
  const { user, isCorporateAdmin, isAnyAdmin } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [balance, setBalance] = useState<number>(0);
  const [walletId, setWalletId] = useState<string>("");
  const [corporateId, setCorporateId] = useState<string | null>(null);
  const [corporateName, setCorporateName] = useState<string>("");
  const [counts, setCounts] = useState({ employees: 0, pending: 0, violations: 0 });
  const [contextLoading, setContextLoading] = useState(true);
  const [contextError, setContextError] = useState<string | null>(null);

  const canManage = isCorporateAdmin || isAnyAdmin;
  const { top, sub } = useMemo(() => parsePath(location.pathname), [location.pathname]);
  const activeTop = TOP_TABS.find(t => t.key === top) ?? TOP_TABS[0];
  const activeSub = activeTop.sub?.find(s => s.key === sub);

  // Audit #16 — no-op when target matches current (top, sub). Avoids stray history entries + re-renders.
  const goto = (t: string, s?: string) => {
    if (t === top && (s ?? undefined) === (sub ?? undefined)) return;
    navigate(`/dashboard/corporate${t === "dashboard" ? "" : `/${t}${s ? `/${s}` : ""}`}`);
  };

  const handleLogout = async () => {
    const returnTo = window.location.pathname + window.location.search;
    await supabase.auth.signOut();
    navigate(returnTo.startsWith("/dashboard/corporate")
      ? `/corporate/login?redirect=${encodeURIComponent(returnTo)}`
      : "/corporate/login", { replace: true });
  };

  // Stale-while-revalidate: paint cached instantly, refetch in background so tab switches feel instant.
  useEffect(() => {
    if (!user) { setContextLoading(false); return; }
    const swr = corporateContextCache.getWithFreshness(user.id);
    if (swr) {
      setCorporateId(swr.value.corporateId);
      setCorporateName(swr.value.corporateName);
      setWalletId(swr.value.walletId);
      setBalance(swr.value.balance);
      setContextLoading(false);
      if (swr.fresh) return; // still fresh → no background refetch
    }
    let cancelled = false;
    (async () => {
      if (!swr) setContextLoading(true);
      setContextError(null);
      try {
        const { data: emp, error: eErr } = await supabase
          .from("corporate_employees")
          .select("corporate_id, corporate_accounts(legal_name)")
          .eq("user_id", user.id).eq("status", "active").maybeSingle();
        if (eErr) throw eErr;
        if (cancelled) return;
        let cid = "", cname = "";
        if (emp?.corporate_id) {
          cid = emp.corporate_id;
          const ca = emp.corporate_accounts as unknown as { legal_name: string } | null;
          cname = ca?.legal_name ?? "";
          setCorporateId(cid);
          setCorporateName(cname);
        }
        const { data: w, error: wErr } = await supabase.from("wallets").select("id,balance_cents")
          .eq("user_id", user.id).eq("wallet_type", "corporate").maybeSingle();
        if (wErr) throw wErr;
        if (cancelled) return;
        let wid = "", bal = 0;
        if (w) { bal = w.balance_cents; wid = w.id; setBalance(bal); setWalletId(wid); }
        if (cid) corporateContextCache.set(user.id, { corporateId: cid, corporateName: cname, walletId: wid, balance: bal });
      } catch (e) {
        if (!cancelled) setContextError(e instanceof Error ? e.message : "Unable to load your corporate profile.");
      } finally {
        if (!cancelled) setContextLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  // Counts — same SWR pattern; expose `refreshCounts` so mutations (role change) can invalidate.
  const refreshCounts = useMemo(() => {
    return async () => {
      if (!corporateId) return;
      corporateCountsCache.invalidate(corporateId);
      try {
        const [{ count: empCount }, { count: pendCount }, { count: vCount }] = await Promise.all([
          supabase.from("corporate_employees").select("*", { count: "exact", head: true }).eq("corporate_id", corporateId).eq("status", "active"),
          supabase.from("corporate_ride_approvals").select("*", { count: "exact", head: true }).eq("corporate_id", corporateId).eq("status", "pending"),
          supabase.from("corporate_policy_violations").select("*", { count: "exact", head: true }).eq("corporate_id", corporateId).gte("created_at", new Date(Date.now() - 30*86400000).toISOString()),
        ]);
        const next = { employees: empCount ?? 0, pending: pendCount ?? 0, violations: vCount ?? 0 };
        setCounts(next);
        corporateCountsCache.set(corporateId, next);
      } catch { /* non-critical */ }
    };
  }, [corporateId]);

  useEffect(() => {
    if (!corporateId) return;
    const swr = corporateCountsCache.getWithFreshness(corporateId);
    if (swr) {
      setCounts(swr.value);
      if (swr.fresh) return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [{ count: empCount }, { count: pendCount }, { count: vCount }] = await Promise.all([
          supabase.from("corporate_employees").select("*", { count: "exact", head: true }).eq("corporate_id", corporateId).eq("status", "active"),
          supabase.from("corporate_ride_approvals").select("*", { count: "exact", head: true }).eq("corporate_id", corporateId).eq("status", "pending"),
          supabase.from("corporate_policy_violations").select("*", { count: "exact", head: true }).eq("corporate_id", corporateId).gte("created_at", new Date(Date.now() - 30*86400000).toISOString()),
        ]);
        if (cancelled) return;
        const next = { employees: empCount ?? 0, pending: pendCount ?? 0, violations: vCount ?? 0 };
        setCounts(next);
        corporateCountsCache.set(corporateId, next);
      } catch { /* non-critical */ }
    })();
    return () => { cancelled = true; };
  }, [corporateId]);


  const visibleTabs = canManage ? TOP_TABS : TOP_TABS.filter(t => ["dashboard", "billing"].includes(t.key));

  return (
    <div className="space-y-5">
      {/* Corporate identity header — one per corporate account */}
      <div className="rounded-xl border bg-card shadow-sm px-5 py-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <h1
              className="text-xl md:text-2xl font-bold tracking-tight uppercase truncate"
              style={{ color: "hsl(var(--primary))" }}
              title={corporateName || "Corporate account"}
            >
              {corporateName || (contextLoading ? "Loading…" : "Corporate account")}
            </h1>
            {!canManage && (
              <span className="text-xs text-muted-foreground hidden md:inline">Employee view</span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <CorporatePaybillCard corporateId={corporateId} corporateName={corporateName} balanceCents={balance} />
            <Button variant="outline" size="sm" onClick={handleLogout} className="gap-2">
              <LogOut className="h-4 w-4" /> Log out
            </Button>
          </div>
        </div>

        {/* Top-tab bar — flush under identity header */}
        <div className="mt-4 -mx-5 -mb-4 px-3 pt-2 pb-2 border-t overflow-x-auto">
          <nav className="flex items-center gap-1 min-w-max" aria-label="Corporate sections">
            {visibleTabs.map((t) => {
              const Icon = t.icon;
              const active = t.key === top;
              const badge = t.key === "trips" && counts.pending > 0 ? counts.pending : null;
              return (
                <button
                  key={t.key}
                  onClick={() => goto(t.key, t.sub?.[0].key)}
                  className={cn(
                    "relative flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap",
                    active
                      ? "bg-primary text-primary-foreground shadow-md"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span>{t.label}</span>
                  {badge && (
                    <span className="ml-1 px-1.5 py-0.5 rounded-full bg-status-warning text-ice text-[10px] font-bold">
                      {badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {contextError && (
        <div className="rounded-xl border border-status-danger/30 bg-status-danger/10 dark:bg-status-danger/20 p-4 text-sm text-status-danger dark:text-status-danger">
          <p className="font-semibold">Couldn't load your corporate profile</p>
          <p className="mt-1 opacity-80">{contextError}</p>
        </div>
      )}
      {!contextLoading && !contextError && !corporateId && (
        <div className="rounded-xl border bg-status-warning/10 dark:bg-status-warning/30 p-4 text-sm">
          You are not yet linked to a corporate account. Ask your corporate admin to invite you, or contact{" "}
          <a className="underline" href={ADMIN_MAILTO}>{CONTACT.adminEmail}</a>.
        </div>
      )}

      {/* Audit #11 — in-page breadcrumb so deep sub-tabs indicate location. */}
      <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
        <ol className="flex flex-wrap items-center gap-1">
          <li>Corporate</li>
          <li aria-hidden="true">›</li>
          <li className={cn(!activeSub && "text-foreground font-medium")}>{activeTop.label}</li>
          {activeSub && (
            <>
              <li aria-hidden="true">›</li>
              <li className="text-foreground font-medium">{activeSub.label}</li>
            </>
          )}
        </ol>
      </nav>

      {/* Body layout */}
      <SectionErrorBoundary sectionName={activeSub ? `${activeTop.label} › ${activeSub.label}` : activeTop.label}>
        {activeTop.sub && activeTop.layout === "vertical" ? (
          <div className="grid gap-6 md:grid-cols-[220px_1fr]">
            <aside className="rounded-xl border bg-card shadow-sm p-2 h-fit md:sticky md:top-4">
              <ul className="space-y-0.5">
                {activeTop.sub.map((s) => {
                  const Icon = s.icon;
                  const active = s.key === sub;
                  return (
                    <li key={s.key}>
                      <button
                        onClick={() => goto(activeTop.key, s.key)}
                        className={cn(
                          "w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-left transition-colors",
                          active
                            ? "bg-primary text-primary-foreground font-semibold shadow-sm"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="flex-1 truncate">{s.label}</span>
                        {active && <ChevronRight className="h-3.5 w-3.5" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </aside>
            <section className="min-w-0">
              <SectionPanel top={top} sub={sub!} corporateId={corporateId} walletId={walletId} counts={counts} balance={balance} refreshCounts={refreshCounts} />
            </section>
          </div>
        ) : activeTop.sub && activeTop.layout === "horizontal" ? (
          <div className="rounded-xl border bg-card shadow-sm">
            <div className="border-b px-4 pt-2 overflow-x-auto">
              <div className="flex items-center gap-1 min-w-max">
                {activeTop.sub.map((s) => {
                  const active = s.key === sub;
                  return (
                    <button
                      key={s.key}
                      onClick={() => goto(activeTop.key, s.key)}
                      className={cn(
                        "px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap",
                        active
                          ? "border-primary text-primary"
                          : "border-transparent text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {s.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="p-6">
              <SectionPanel top={top} sub={sub!} corporateId={corporateId} walletId={walletId} counts={counts} balance={balance} refreshCounts={refreshCounts} />
            </div>
          </div>
        ) : (
          <SectionPanel top={top} sub={sub} corporateId={corporateId} walletId={walletId} counts={counts} balance={balance} refreshCounts={refreshCounts} />
        )}
      </SectionErrorBoundary>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Section renderer — maps (top, sub) → module                        */
/* ------------------------------------------------------------------ */

function SectionPanel({
  top, sub, corporateId, walletId, counts, balance, refreshCounts,
}: {
  top: string; sub?: string; corporateId: string | null; walletId: string;
  counts: { employees: number; pending: number; violations: number }; balance: number;
  refreshCounts?: () => Promise<void>;
}) {
  // Dashboard
  if (top === "dashboard") {
    return <DashboardOverview corporateId={corporateId} walletId={walletId} counts={counts} balance={balance} />;
  }

  // Staff
  if (top === "staff") {
    if (sub === "designations") return <CorporateDesignations corporateId={corporateId} />;
    if (sub === "invited")      return <CorporateEmployees corporateId={corporateId} statusFilter="invited" />;
    if (sub === "suspended")    return <CorporateEmployees corporateId={corporateId} statusFilter="suspended" />;
    if (sub === "removed")      return <CorporateEmployees corporateId={corporateId} statusFilter="removed" />;
    return <CorporateEmployees corporateId={corporateId} statusFilter="active" />;
  }

  // Trips
  if (top === "trips") {
    if (sub === "request")    return <CorporateRequestRide corporateId={corporateId} />;
    if (sub === "approvals")  return <CorporateApprovals corporateId={corporateId} />;

    if (sub === "dispatch")   return <CorporateManualDispatch corporateId={corporateId} />;
    if (sub === "statistics") return <EmptyPanel note="Spend analytics coming next — pulls from settled trips and wallet transactions." />;
    if (sub === "tickets")    return <ComingSoon feature="Support tickets & rider incident tracking" />;
    return <CorporateCompletedRides corporateId={corporateId} />;
  }

  // Settings
  if (top === "settings") {
    if (sub === "policies")         return <Panel title="Policies"><CorporatePolicies corporateId={corporateId} /></Panel>;
    if (sub === "violations")       return <Panel title="Violations"><CorporateViolations corporateId={corporateId} /></Panel>;
    if (sub === "codes")            return <Panel title="Expense Codes"><CorporateExpenseCodes corporateId={corporateId} /></Panel>;
    if (sub === "trip-approvers")   return <Panel title="Trip Approvers"><CorporateApprovalSetup corporateId={corporateId} /></Panel>;
    if (sub === "approval-feature") return <Panel title="Approval Feature"><ComingSoon feature="Per-department approval toggle" /></Panel>;
    if (sub === "vehicles")         return <Panel title="Vehicles & Services"><AllowedServicesPanel corporateId={corporateId} /></Panel>;
    if (sub === "trip-limits")      return <Panel title="Trip Limits"><TripLimitsPanel corporateId={corporateId} /></Panel>;
    if (sub === "ticket-expiry")    return <Panel title="Ticket Expiry"><ComingSoon feature="Booking hold expiry (days & hours) per department" /></Panel>;
    if (sub === "hours")            return <Panel title="Booking Hours"><TripLimitsPanel corporateId={corporateId} /></Panel>;
    if (sub === "intercountry")     return <Panel title="InterCountry"><ComingSoon feature="Cross-border ride permissions" /></Panel>;
    if (sub === "block-preferred")  return <Panel title="Block / Preferred Drivers"><ComingSoon feature="Preferred and blocked driver lists" /></Panel>;
    if (sub === "trip-otp")         return <Panel title="Trip OTP"><ComingSoon feature="One-time PIN required to start a ride" /></Panel>;
    return <Panel title="Services"><AllowedServicesPanel corporateId={corporateId} /></Panel>;
  }

  // Departments
  if (top === "departments") {
    if (sub === "cost-centers") return <Panel title="Cost Centers"><CorporateCostCenters corporateId={corporateId} /></Panel>;
    return <Panel title="Department Management"><CorporateDepartments corporateId={corporateId} /></Panel>;
  }

  // Admins
  if (top === "admins") return <Panel title="Administrator Management"><AdminsPanel corporateId={corporateId} onRoleChanged={refreshCounts} /></Panel>;

  // Budget
  if (top === "budget") {
    if (sub === "corporate")    return <BudgetSummary balance={balance} />;
    if (sub === "departmental") return <Panel title="Departmental Budgets"><DepartmentBudgetsPanel corporateId={corporateId} /></Panel>;
    if (sub === "insurance")    return <ComingSoon feature="Passenger accident cover enrolment per department" />;
    return <BudgetSummary balance={balance} />;
  }

  // Billing (wallet-funded model)
  if (top === "billing") {
    if (sub === "payments")       return <TransactionsList walletId={walletId} />;
    if (sub === "cash-ledger")    return <CorporateCashLedger corporateId={corporateId} />;
    if (sub === "paybill-proofs") return <CorporateMyPaybillProofs corporateId={corporateId} />;
    if (sub === "reconciliation") return <CorporateReconciliation corporateId={corporateId} />;
    if (sub === "audit-log")      return <CorporateAuditLog corporateId={corporateId} />;
    return <CorporateInvoicing corporateId={corporateId} />;
  }

  // Documents
  if (top === "documents") return <CorporateDocuments corporateId={corporateId} />;

  // Organisation — tenant settings, sign-in policy, pending applications, approved bookings
  if (top === "organisation") return <CorporateOrganisation corporateId={corporateId} />;




  return null;
}

/* ------------------------------------------------------------------ */
/*  Small presentational helpers                                       */
/* ------------------------------------------------------------------ */

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card shadow-sm">
      <div className="px-6 py-4 border-b">
        <h2 className="font-semibold text-lg">{title}</h2>
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

function DashboardOverview({
  corporateId, walletId, counts, balance,
}: {
  corporateId: string | null; walletId: string;
  counts: { employees: number; pending: number; violations: number }; balance: number;
}) {
  const tripCounts = useCorporateTripCounts(corporateId);
  return (
    <div className="space-y-6">
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <KpiCard icon={<Wallet className="h-5 w-5 text-primary" />} label="Wallet Balance" value={`KES ${(balance / 100).toLocaleString()}`} />
        <KpiCard icon={<Users className="h-5 w-5 text-primary" />} label="Active employees" value={counts.employees} />
        <KpiCard icon={<ClipboardCheck className="h-5 w-5 text-status-warning" />} label="Pending approvals" value={counts.pending} />
        <KpiCard icon={<AlertTriangle className="h-5 w-5 text-status-danger" />} label="Violations (30d)" value={counts.violations} />
        <ScheduledKpiTile value={tripCounts.scheduled} />
        <CancelledKpiTile value={tripCounts.cancelled30d} />
      </div>

      <SectionErrorBoundary sectionName="Payment and credit status">
        <CreditStatusCard corporateId={corporateId} />
      </SectionErrorBoundary>

      <SectionErrorBoundary sectionName="Trip requests awaiting a decision">
        <PendingTripDecisions corporateId={corporateId} />
      </SectionErrorBoundary>

      <SectionErrorBoundary sectionName="Live corporate rides">
        <CorporateLiveTripsCard corporateId={corporateId} />
      </SectionErrorBoundary>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <SectionErrorBoundary sectionName="Spend by department">
            <SpendByDepartmentCard corporateId={corporateId} />
          </SectionErrorBoundary>
        </div>
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <h2 className="font-semibold mb-4 flex items-center gap-2"><BarChart3 className="h-4 w-4" />Cash Ledger</h2>
          <TransactionsList walletId={walletId} />
        </div>
      </div>

      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <h2 className="font-semibold mb-3 flex items-center gap-2"><Shield className="h-4 w-4" />Travel Policy Compliance</h2>
        <p className="text-sm text-muted-foreground">
          Configure ride-type restrictions, fare caps, time windows, and approval workflows in the <b>Settings → Policies</b> panel.
        </p>
        <div className="mt-3 rounded-lg bg-primary/5 border border-primary/20 p-3 text-xs">
          <b>Payment model:</b> TaxiD corporates fund their wallet via M-Pesa Paybill{" "}
          <span className="font-mono">4573823</span> (Yalla Beena Limited). Rides are debited from your wallet balance in real time.
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3 text-center">
          <MiniStat label="Approval rate" value={counts.pending === 0 ? "100%" : "—"} />
          <MiniStat label="Open violations" value={counts.violations} />
          <MiniStat label="Active rides now" value={tripCounts.active} />
        </div>
      </div>
    </div>
  );
}



function KpiCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        {icon}
      </div>
      <p className="text-2xl font-bold mt-2">{value}</p>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-muted/40 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function EmptyPanel({ note }: { note: string }) {
  return <div className="text-sm text-muted-foreground">{note}</div>;
}

function ComingSoon({ feature }: { feature: string }) {
  return (
    <div className="text-center py-12">
      <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 mb-3">
        <SettingsIcon className="h-6 w-6 text-primary" />
      </div>
      <p className="font-semibold">{feature}</p>
      <p className="text-sm text-muted-foreground mt-1">This module is scheduled in the corporate roadmap and will be enabled shortly.</p>
    </div>
  );
}

function BudgetSummary({ balance }: { balance: number }) {
  const kes = (balance / 100);
  return (
    <div className="space-y-6">
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <p className="text-sm text-muted-foreground">Corporate Balance</p>
          <p className="text-4xl font-bold text-primary mt-1">KES {kes.toLocaleString()}</p>
        </div>
        <div>
          <p className="text-sm text-muted-foreground">Total Spent (all-time)</p>
          <p className="text-4xl font-bold mt-1">—</p>
        </div>
      </div>
      <div className="rounded-lg bg-primary/5 border border-primary/20 p-4 text-sm">
        Departmental budgets, insurance enrolment and forecasted burn-rate visualisations will populate here once
        department spend records accumulate.
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  AdminsPanel — role management + audit log                          */
/* ------------------------------------------------------------------ */

type AdminRow = {
  id: string;
  name: string;
  email: string;
  role: CorporateRole;
  created_at: string;
};

type AuditRow = {
  id: string;
  changed_by_email: string | null;
  previous_role: string | null;
  new_role: string;
  created_at: string;
};

function AdminsPanel({ corporateId, onRoleChanged }: { corporateId: string | null; onRoleChanged?: () => Promise<void> }) {
  const { user } = useAuth();
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [showAudit, setShowAudit] = useState(false);
  const [roleFilter, setRoleFilter] = useState<"admins" | "managers" | "all">("admins");
  const [search, setSearch] = useState("");

  const loadAll = async () => {
    if (!corporateId) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const [empRes, auditRes] = await Promise.all([
        supabase
          .from("corporate_employees")
          .select(CORPORATE_EMPLOYEE_SELECT_FIELDS.join(","))
          .eq("corporate_id", corporateId)
          .order("created_at", { ascending: true }),
        supabase
          .from("corporate_role_audit_log")
          .select("id, changed_by_email, previous_role, new_role, created_at")
          .eq("corporate_id", corporateId)
          .order("created_at", { ascending: false })
          .limit(50),
      ]);
      if (empRes.error) throw empRes.error;
      if (auditRes.error) throw auditRes.error;

      setRows(((empRes.data ?? []) as unknown as Array<{
        id: string; full_name: string | null; email: string | null;
        role: string | null; created_at: string;
      }>).map((r) => ({
        id: r.id,
        name: r.full_name ?? "—",
        email: r.email ?? "—",
        role: normalizeCorporateRole(r.role),
        created_at: r.created_at,
      })));
      setAudit((auditRes.data ?? []) as AuditRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load administrators.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadAll();   }, [corporateId]);

  const changeRole = async (row: AdminRow, next: CorporateRole) => {
    if (!corporateId || next === row.role) return;

    // Guardrail #1 — self-demotion: prevent the acting user from removing their own admin power.
    const isSelf = !!(user?.email && row.email && user.email.toLowerCase() === row.email.toLowerCase());
    if (isSelf && row.role === "corporate_admin" && next !== "corporate_admin") {
      setError("You cannot remove your own Corporate Admin role. Ask another admin to make this change.");
      return;
    }

    // Guardrail #2 — last-admin: never allow the final Corporate Admin to be demoted.
    if (row.role === "corporate_admin" && next !== "corporate_admin") {
      const remainingAdmins = rows.filter((r) => r.role === "corporate_admin" && r.id !== row.id).length;
      if (remainingAdmins === 0) {
        setError("At least one Corporate Admin must remain. Promote another team member first.");
        return;
      }
    }

    // Guardrail #3 — confirmation for any privilege change (promote or demote).
    const ok = window.confirm(
      `Change role for ${row.name || row.email}?\n\n  ${corporateRoleLabel(row.role)}  →  ${corporateRoleLabel(next)}\n\nThis is audit-logged and takes effect immediately.`,
    );
    if (!ok) return;

    setError(null);
    setSavingId(row.id);
    try {
      const { error: uErr } = await supabase
        .from("corporate_employees")
        .update({ role: next })
        .eq("id", row.id);
      if (uErr) throw uErr;

      // Audit trail — best-effort; failure of audit must not roll back the change UI-wise.
      const { error: aErr } = await supabase.from("corporate_role_audit_log").insert({
        corporate_id: corporateId,
        employee_id: row.id,
        changed_by: user?.id ?? null,
        changed_by_email: user?.email ?? null,
        previous_role: row.role,
        new_role: next,
        reason: null,
      });
      if (aErr) console.warn("Role audit insert failed:", aErr.message);

      // Cache invalidation — refresh corporate counts so KPI tiles + badges reflect the change.
      await Promise.all([loadAll(), onRoleChanged?.() ?? Promise.resolve()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update role.");
    } finally {
      setSavingId(null);
    }
  };


  if (loading) return <p className="text-sm text-muted-foreground">Loading team members…</p>;
  if (error) return (
    <div className="rounded-lg border border-status-danger/30 bg-status-danger/10 dark:bg-status-danger/20 p-4 text-sm text-status-danger dark:text-status-danger">
      <p className="font-semibold mb-1">Couldn't load administrators</p>
      <p className="opacity-80">{error}</p>
      <Button size="sm" variant="outline" className="mt-3" onClick={loadAll}>Retry</Button>
    </div>
  );
  if (!rows.length) {
    // Audit #1 — empty AdminsPanel had no bootstrap path. Provide a direct link to Staff invite.
    return (
      <div className="rounded-lg border bg-muted/30 p-6 text-sm text-center space-y-3">
        <p className="text-muted-foreground">No staff yet. Invite your first team member to get started.</p>
        <Button asChild size="sm">
          <a href="/dashboard/corporate/employees">Invite staff</a>
        </Button>
      </div>
    );
  }

  const s = search.trim().toLowerCase();
  const filteredRows = rows.filter((r) => {
    if (roleFilter === "admins" && r.role !== "corporate_admin") return false;
    if (roleFilter === "managers" && r.role !== "corporate_manager" && r.role !== "corporate_admin") return false;
    if (!s) return true;
    return r.name.toLowerCase().includes(s) || r.email.toLowerCase().includes(s);
  });

  const counts = {
    admins: rows.filter((r) => r.role === "corporate_admin").length,
    managers: rows.filter((r) => r.role === "corporate_manager").length,
    all: rows.length,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="inline-flex rounded-lg border bg-muted/40 p-0.5">
          {(["admins", "managers", "all"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setRoleFilter(k)}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-medium transition-colors capitalize",
                roleFilter === k ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {k === "all" ? "All team" : k} <span className="ml-1 opacity-60">({counts[k]})</span>
            </button>
          ))}
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or email…"
          className="h-9 w-full sm:w-64 rounded-md border bg-background px-3 text-sm"
          aria-label="Search team members"
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground border-b">
            <tr>
              <th className="py-2 pr-4">Name</th>
              <th className="py-2 pr-4">Email</th>
              <th className="py-2 pr-4">Role</th>
              <th className="py-2 pr-4">Created</th>
              <th className="py-2 pr-4 w-56">Assign role</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 && (
              <tr><td colSpan={5} className="py-6 text-center text-muted-foreground">No matching team members.</td></tr>
            )}
            {filteredRows.map((r) => (
              <tr key={r.id} className="border-b last:border-0">
                <td className="py-3 pr-4 font-medium">{r.name}</td>
                <td className="py-3 pr-4">{r.email}</td>
                <td className="py-3 pr-4">
                  <span className={cn(
                    "px-2 py-0.5 rounded-full text-xs font-semibold",
                    r.role === "corporate_admin"    && "bg-status-success/10 text-status-success dark:text-status-success",
                    r.role === "corporate_manager"  && "bg-ai/10 text-ai dark:text-ai",
                    r.role === "corporate_employee" && "bg-muted text-muted-foreground",
                  )}>
                    {corporateRoleLabel(r.role)}
                  </span>
                </td>
                <td className="py-3 pr-4 text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</td>
                <td className="py-3 pr-4">
                  <select
                    className="w-full rounded-md border bg-background px-2 py-1.5 text-sm disabled:opacity-50"
                    value={r.role}
                    disabled={savingId === r.id}
                    onChange={(e) => void changeRole(r, e.target.value as CorporateRole)}
                    aria-label={`Change role for ${r.name}`}
                  >
                    {CORPORATE_ROLES.map((role) => (
                      <option key={role} value={role}>{corporateRoleLabel(role)}</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>


      <section id="admin-audit-log" className="border-t pt-4" aria-labelledby="admin-audit-log-title">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-primary" aria-hidden="true" />
            <h3 id="admin-audit-log-title" className="text-sm font-semibold">
              Permission change audit log
            </h3>
            <span className="text-xs text-muted-foreground">({audit.length} record{audit.length === 1 ? "" : "s"})</span>
          </div>
          <button
            type="button"
            className="text-xs font-medium text-primary hover:underline"
            onClick={() => setShowAudit((v) => !v)}
            aria-expanded={showAudit}
            aria-controls="admin-audit-log-body"
          >
            {showAudit ? "Hide" : "Show"} history
          </button>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Every role change is recorded here with the acting admin, previous role, new role, and timestamp.
        </p>
        {showAudit && (
          <div id="admin-audit-log-body" className="mt-3 rounded-lg border bg-muted/30">
            {audit.length === 0 ? (
              <p className="text-sm text-muted-foreground p-4">No role changes recorded yet.</p>
            ) : (
              <ul className="divide-y" role="list">
                {audit.map((a) => (
                  <li key={a.id} className="p-3 text-sm flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="font-medium">
                        <span className="text-foreground">{a.changed_by_email ?? "System"}</span>
                        {" "}changed role from{" "}
                        <span className="font-mono text-xs">{a.previous_role ?? "—"}</span>
                        {" "}to{" "}
                        <span className="font-mono text-xs font-semibold">{a.new_role}</span>
                      </div>
                    </div>
                    <time
                      className="text-xs text-muted-foreground whitespace-nowrap"
                      dateTime={a.created_at}
                    >
                      {new Date(a.created_at).toLocaleString()}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
