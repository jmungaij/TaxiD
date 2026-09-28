import { type ReactNode } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Mail,
  Inbox,
  ChevronDown,
  UserPlus,
  Compass, Building2, Users, TrendingUp, Network, HeartHandshake,
  GraduationCap, BookOpen, Lightbulb, Brain, ShieldCheck, Search, Workflow, Gauge, Bot, Layers, Activity, ScanSearch, Radar, GitBranch, Link2, Globe2, Target, ListChecks, FileText, Receipt, UserSearch, Megaphone, LogOut, AlertTriangle, CalendarDays,
  Rocket,
} from "lucide-react";

import BrandLogo from "@/components/brand/BrandLogo";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import OperatingContextSwitch from "@/components/platform/OperatingContextSwitch";
import { useStaffAccess } from "@/components/staff/StaffAccessProvider";
import type { StaffScope } from "@/lib/staff/access";
import { canOpenStaffPath } from "@/lib/staff/routeScopes";

/**
 * Minimum data scope each navigation SECTION requires. "My work" is personal and
 * always available to an employee whose identity resolved; everything wider needs
 * a platform role that grants that scope.
 */
const SECTION_SCOPE: Record<string, StaffScope> = {
  "Primary": "self",
  "My commercial book": "self",
  "Daily operations": "self",
  "TaxiD 360": "department",
  "Organisation & people": "department",
  "Commercial engines": "commercial",
  "Automation & analysis": "department",
  "Governance & audit": "enterprise",
};

/** Sections that stay expanded by default; the rest are disclosed on demand. */
const DEFAULT_OPEN_SECTIONS = new Set(["Primary", "My commercial book"]);

/**
 * Navigation is grouped by what a person is DOING, not by which phase built it.
 * "Primary" holds the four employee environments (performance, commercial system
 * of record, execution cockpit, communication); everything below is disclosed
 * progressively so the rail behaves like a command interface, not a site menu.
 */
const NAV: { to: string; label: string; icon: typeof Compass; section: string }[] = [
  // The four employee environments
  { to: "/staff/dashboard", label: "My dashboard", icon: Gauge, section: "Primary" },
  { to: "/staff/sales", label: "Sales portal", icon: TrendingUp, section: "Primary" },
  { to: "/staff/sales/pipeline", label: "Lead pipeline", icon: TrendingUp, section: "Primary" },
  { to: "/staff/sales/access", label: "Sales access", icon: ShieldCheck, section: "Primary" },
  { to: "/staff/workspace", label: "My workspace", icon: ListChecks, section: "Primary" },
  { to: "/staff/communications", label: "Communication", icon: Mail, section: "Primary" },
  { to: "/staff/calendar", label: "Calendar", icon: CalendarDays, section: "Primary" },
  { to: "/staff/meetings", label: "Meetings", icon: CalendarDays, section: "Primary" },

  // Personal projections of the commercial system of record
  { to: "/staff/workspace/work-queue", label: "Work queue", icon: ListChecks, section: "My commercial book" },
  { to: "/staff/workspace/exceptions", label: "Exception centre", icon: AlertTriangle, section: "My commercial book" },
  { to: "/staff/workspace/meetings", label: "Meetings", icon: CalendarDays, section: "My commercial book" },
  { to: "/staff/workspace/inbox", label: "Inbox", icon: Inbox, section: "My commercial book" },
  { to: "/staff/workspace/book", label: "Commercial book", icon: BookOpen, section: "My commercial book" },
  { to: "/staff/workspace/approvals", label: "Approvals", icon: ShieldCheck, section: "My commercial book" },
  { to: "/staff/workspace/accounts", label: "My accounts", icon: Building2, section: "My commercial book" },
  { to: "/staff/workspace/opportunities", label: "My opportunities", icon: Target, section: "My commercial book" },
  { to: "/staff/workspace/pipeline", label: "Pipeline inspection", icon: Activity, section: "My commercial book" },
  { to: "/staff/workspace/field", label: "Field mode", icon: Activity, section: "My commercial book" },
  { to: "/staff/workspace/quotes", label: "My quotes & proposals", icon: FileText, section: "My commercial book" },
  { to: "/staff/workspace/contracts", label: "My contracts", icon: Receipt, section: "My commercial book" },
  { to: "/staff/workspace/activation", label: "Activation plan", icon: Rocket, section: "My commercial book" },

  // Daily operations
  { to: "/staff/sales/manager-desk", label: "Sales manager desk", icon: Gauge, section: "Daily operations" },
  { to: "/staff/team", label: "My team", icon: Users, section: "Daily operations" },
  { to: "/staff/onboarding", label: "Staff onboarding", icon: UserPlus, section: "Daily operations" },
  { to: "/staff/board", label: "Operations command board", icon: Gauge, section: "Daily operations" },
  { to: "/staff/stream", label: "Orchestration stream", icon: Workflow, section: "Daily operations" },
  { to: "/staff/search", label: "Universal search", icon: Search, section: "Daily operations" },

  // TaxiD 360 profiles
  { to: "/staff/360", label: "Staff 360", icon: Compass, section: "TaxiD 360" },
  { to: "/staff/recruitment", label: "Recruitment 360", icon: UserSearch, section: "TaxiD 360" },
  { to: "/staff/recruitment/publication-health", label: "Vacancy publication health", icon: Radar, section: "TaxiD 360" },
  { to: "/staff/customers", label: "Customer 360", icon: Users, section: "TaxiD 360" },
  { to: "/staff/customers/accounts", label: "Account 360", icon: Building2, section: "TaxiD 360" },
  { to: "/staff/customers/documents", label: "Document OS", icon: FileText, section: "TaxiD 360" },
  { to: "/staff/marketplace", label: "Marketplace 360", icon: HeartHandshake, section: "TaxiD 360" },
  { to: "/staff/partners", label: "TaxiD Partners 360", icon: HeartHandshake, section: "TaxiD 360" },
  { to: "/staff/partners/work", label: "Partner work queues", icon: HeartHandshake, section: "TaxiD 360" },
  { to: "/staff/partners/fleet-owner-conversion", label: "Fleet Owner conversion", icon: HeartHandshake, section: "TaxiD 360" },
  { to: "/staff/partners/fleet-owner-queue", label: "Fleet Owner work queue", icon: HeartHandshake, section: "TaxiD 360" },
  { to: "/staff/partners/supply", label: "Partner supply tower", icon: HeartHandshake, section: "TaxiD 360" },
  { to: "/staff/partners/matching", label: "Partner demand desk", icon: HeartHandshake, section: "TaxiD 360" },
  { to: "/staff/partners/risk", label: "Partner risk centre", icon: HeartHandshake, section: "TaxiD 360" },
  { to: "/staff/partners/funnel", label: "Partner funnel comparison", icon: HeartHandshake, section: "TaxiD 360" },
  { to: "/staff/partners/tasks", label: "Partner lifecycle task queue", icon: HeartHandshake, section: "TaxiD 360" },
  { to: "/staff/partners/white-label", label: "White-label ops console", icon: HeartHandshake, section: "TaxiD 360" },
  { to: "/staff/recruitment/comparison", label: "Candidate comparison", icon: UserSearch, section: "TaxiD 360" },
  { to: "/staff/recruitment/questions", label: "Assessment question governance", icon: UserSearch, section: "TaxiD 360" },
  { to: "/staff/recruitment/assessments", label: "Assessment blueprints & papers", icon: UserSearch, section: "TaxiD 360" },
  { to: "/staff/revenue", label: "Revenue intelligence", icon: TrendingUp, section: "TaxiD 360" },
  { to: "/staff/intelligence", label: "Enterprise intelligence", icon: Brain, section: "TaxiD 360" },

  // Organisation & people
  { to: "/staff/admin", label: "Admin portal", icon: ShieldCheck, section: "Organisation & people" },
  { to: "/staff/org", label: "Organisation management", icon: Building2, section: "Organisation & people" },
  { to: "/staff/workforce/blueprints", label: "Role blueprints", icon: Target, section: "Organisation & people" },
  { to: "/staff/workforce/launchpad", label: "Workforce launchpad", icon: GraduationCap, section: "Organisation & people" },
  { to: "/staff/interns", label: "Interns 360", icon: GraduationCap, section: "Organisation & people" },
  { to: "/staff/organisation", label: "Operating model", icon: Building2, section: "Organisation & people" },
  { to: "/staff/departments", label: "Departments", icon: Network, section: "Organisation & people" },
  { to: "/staff/org/people", label: "Staff register", icon: Users, section: "Organisation & people" },
  { to: "/staff/org/links", label: "Staff link backfill", icon: Link2, section: "Organisation & people" },
  { to: "/staff/org/objectives", label: "Objectives & KPIs", icon: Target, section: "Organisation & people" },
  { to: "/staff/org/work", label: "Work queue", icon: ListChecks, section: "Organisation & people" },
  { to: "/staff/org/performance", label: "Performance scorecards", icon: Gauge, section: "Organisation & people" },
  { to: "/staff/org/baseline", label: "Sales baseline", icon: Gauge, section: "Organisation & people" },
  { to: "/staff/people", label: "People & capability", icon: GraduationCap, section: "Organisation & people" },

  // Commercial & marketplace engines
  { to: "/staff/commercial/charter", label: "Corporate charter pricing", icon: Receipt, section: "Commercial engines" },
  { to: "/staff/commercial/documents", label: "Commercial documents", icon: FileText, section: "Commercial engines" },
  { to: "/staff/commercial/templates", label: "Document templates", icon: FileText, section: "Commercial engines" },
  { to: "/staff/commercial/proforma", label: "Proforma invoices", icon: FileText, section: "Commercial engines" },
  { to: "/staff/commercial/invoices", label: "Invoices & receipts", icon: FileText, section: "Commercial engines" },
  { to: "/staff/commercial/collections", label: "Payment collections", icon: Receipt, section: "Commercial engines" },
  { to: "/staff/commercial/amendment-billing", label: "Amendment billing", icon: FileText, section: "Commercial engines" },
  { to: "/staff/commercial/rate-cards", label: "Rate cards", icon: Receipt, section: "Commercial engines" },
  { to: "/staff/commerce-os", label: "Commerce OS", icon: GitBranch, section: "Commercial engines" },
  { to: "/staff/closure", label: "Closure control tower", icon: Link2, section: "Commercial engines" },
  { to: "/staff/ask-yalla", label: "Ask TaxiD", icon: Brain, section: "Commercial engines" },
  { to: "/staff/control-tower", label: "Executive control tower", icon: Radar, section: "Commercial engines" },
  { to: "/staff/orchestration", label: "Platform orchestration", icon: Workflow, section: "Commercial engines" },
  { to: "/staff/adaptive-marketplace", label: "Adaptive marketplace", icon: Radar, section: "Commercial engines" },
  { to: "/staff/providers", label: "Provider supply review", icon: ShieldCheck, section: "Commercial engines" },
  { to: "/staff/expansion", label: "Market expansion", icon: Globe2, section: "Commercial engines" },
  { to: "/staff/marketing/social", label: "Social publishing", icon: Megaphone, section: "Commercial engines" },

  // Legacy operational surfaces & automation
  { to: "/staff/operations", label: "Operations analytics", icon: Activity, section: "Automation & analysis" },
  { to: "/staff/workflow", label: "End-to-end workflow", icon: Workflow, section: "Automation & analysis" },
  { to: "/staff/agentic", label: "Agentic TaxiD", icon: Bot, section: "Automation & analysis" },
  { to: "/staff/adaptive", label: "Adaptive enterprise", icon: Activity, section: "Automation & analysis" },
  { to: "/staff/value", label: "Value & excellence", icon: Layers, section: "Automation & analysis" },
  { to: "/staff/knowledge", label: "Knowledge", icon: BookOpen, section: "Automation & analysis" },
  { to: "/staff/innovation", label: "Innovation", icon: Lightbulb, section: "Automation & analysis" },

  // Governance
  { to: "/staff/governance", label: "Governance", icon: ShieldCheck, section: "Governance & audit" },
  { to: "/staff/org/audit", label: "Operational audit trail", icon: ShieldCheck, section: "Governance & audit" },
  { to: "/staff/forensics", label: "Forensic audit", icon: ScanSearch, section: "Governance & audit" },
];

const ALL_SECTIONS = [...new Set(NAV.map((i) => i.section))];



/**
 * Staff 360 shell — intelligent, precise, calm. The first layer stays simple:
 * one rail, one search field, one working surface. Complexity is disclosed by
 * the page the employee opens, not by the chrome.
 */
export function StaffShell({ children }: { children?: ReactNode }) {
  const { user } = useAuth();
  const { scopes, identity } = useStaffAccess();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  /**
   * The chrome never advertises a surface the caller cannot open. Items are
   * filtered by their OWN route scope (not just the coarse section scope), so a
   * visible link always renders its page instead of the withheld panel.
   */
  const inScopeNav = NAV.filter(
    (i) => scopes.has(SECTION_SCOPE[i.section] ?? "enterprise") && canOpenStaffPath(i.to, scopes),
  );
  const SECTIONS = ALL_SECTIONS.filter((s) => inScopeNav.some((i) => i.section === s));
  const visibleNav = inScopeNav;
  /** A surface the chrome does not offer is not silently rendered either. */
  const surfaceAllowed = canOpenStaffPath(pathname, scopes);

  return (
    <div className="min-h-dvh flex w-full bg-background text-foreground">
      <aside
        className="hidden lg:flex w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
        aria-label="Staff 360 navigation"
      >
        <div className="flex items-center gap-3 h-header px-5 border-b border-sidebar-border">
          <BrandLogo tone="light" className="h-7 max-w-[130px]" />
          <span className="text-[11px] uppercase tracking-wider text-sidebar-foreground/60 border-l border-sidebar-border pl-3">
            Staff 360
          </span>
        </div>
        <nav className="flex-1 overflow-y-auto p-3 space-y-3">
          {SECTIONS.map((section) => {
            const items = inScopeNav.filter((i) => i.section === section);
            const holdsActive = items.some((i) => pathname === i.to || pathname.startsWith(`${i.to}/`));
            return (
              <details key={section} open={holdsActive || DEFAULT_OPEN_SECTIONS.has(section)} className="group">
                <summary className="flex cursor-pointer list-none items-center justify-between rounded-md px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-sidebar-foreground/50 hover:text-sidebar-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring">
                  <span>{section}</span>
                  <ChevronDown
                    size={12}
                    aria-hidden="true"
                    className="transition-transform duration-base group-open:rotate-180"
                  />
                </summary>
                <div className="mt-0.5 space-y-0.5">
                  {items.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.to === "/staff/org" || item.to === "/staff/workspace"}
                      className={({ isActive }) =>
                        cn(
                          "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-base",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                          isActive || pathname === item.to
                            ? "bg-sidebar-primary text-sidebar-primary-foreground font-semibold"
                            : "text-sidebar-foreground/85 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                        )
                      }
                    >
                      <item.icon size={18} aria-hidden="true" />
                      <span className="truncate">{item.label}</span>
                    </NavLink>
                  ))}
                </div>
              </details>
            );
          })}
        </nav>

        <div className="p-4 border-t border-sidebar-border text-xs text-sidebar-foreground/70 space-y-1.5">
          <div className="truncate font-medium text-sidebar-foreground">
            {identity?.fullName ?? user?.email ?? "Signed in"}
          </div>
          {/* Employees are identified by their job title, never by their
              internal platform role key (e.g. "rider"). */}
          {identity?.position ? (
            <div className="truncate text-sidebar-foreground/60">
              {identity.position}
              {identity.unit ? ` · ${identity.unit}` : ""}
            </div>
          ) : user?.email ? (
            <div className="truncate text-sidebar-foreground/60">{user.email}</div>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            className="mt-1 w-full justify-start gap-2 px-2 text-sidebar-foreground/85 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            onClick={async () => {
              await supabase.auth.signOut();
              window.location.href = "/";
            }}
            aria-label="Log out of the staff workspace"
            data-testid="staff-shell-logout"
          >
            <LogOut size={16} aria-hidden="true" />
            <span>Log out</span>
          </Button>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-header shrink-0 border-b bg-card flex items-center gap-4 px-4 sm:px-6">
          <form
            className="relative flex-1 max-w-xl"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              const q = new FormData(e.currentTarget).get("q");
              navigate(`/staff/search${q ? `?q=${encodeURIComponent(String(q))}` : ""}`);
            }}
          >
            <label className="sr-only" htmlFor="yalla-universal-search">TaxiD Universal Search</label>
            <Search
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="yalla-universal-search"
              name="q"
              type="search"
              placeholder="Search people, customers, partners, bookings, knowledge…"
              className="pl-9"
              aria-label="TaxiD Universal Search"
            />
          </form>
          <OperatingContextSwitch />
          <nav className="lg:hidden flex-1 overflow-x-auto" aria-label="Staff sections">
            <div className="flex gap-1">
              {visibleNav.map((i) => (
                <NavLink
                  key={i.to}
                  to={i.to}
                  className={({ isActive }) =>
                    cn(
                      "whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs",
                      isActive ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                    )
                  }
                >
                  {i.label}
                </NavLink>
              ))}
            </div>
          </nav>
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8" role="main">
          <div className="mx-auto w-full max-w-[1400px]">
            {surfaceAllowed ? (
              children ?? <Outlet />
            ) : (
              <div className="max-w-2xl space-y-3 rounded-lg border border-warning/40 p-6">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-warning">
                  Not in your scope
                </div>
                <h1 className="text-xl font-semibold tracking-tight">
                  This surface is outside your current data scope.
                </h1>
                <p className="text-sm text-muted-foreground">
                  Your workspace covers the work assigned to you. Wider operational, commercial and
                  governance surfaces require an additional platform role.
                </p>
                <button
                  type="button"
                  className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
                  onClick={() => navigate("/staff/workspace")}
                >
                  Back to my workspace
                </button>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

export default StaffShell;
