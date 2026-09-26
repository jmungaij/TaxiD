import { useEffect, useState } from "react";
import OperatingContextSwitch from "@/components/platform/OperatingContextSwitch";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import {
  SidebarProvider, Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { AppLink } from "@/components/nav/AppLink";
import { Breadcrumbs } from "@/components/nav/Breadcrumbs";
import { MobileBottomNav } from "@/components/nav/MobileBottomNav";
import { sidebarFor, primaryGroupFor, routeFor, canAccess, ROUTE_BY_PATH, type RouteDef } from "@/lib/routes";
import { WORKSPACES } from "@/lib/workspaces/config";
import { buildDomainNav, type DomainNavGroup } from "@/lib/navigation/buildDomainNav";
import { useEntitlements } from "@/hooks/useEntitlements";
import { logNavigation, logAccessDenial } from "@/lib/navLog";
import {
  canViewCorporateControls,
  corporateControlFor,
  isCorporateControlPath,
  trackCorporateControlClick,
} from "@/lib/navigation/corporateControls";
import { useCorporateControlAnalytics } from "@/hooks/useCorporateControlAnalytics";

import { ChevronRight } from "lucide-react";
import {
  LayoutDashboard, Users, Shield, CreditCard, Wallet, MapPin, HeadphonesIcon,
  BarChart3, CheckCircle2, Receipt, Database, Activity, Crown, Radar, UserCog,
  FileCheck, GitBranch, GraduationCap, Building, Mail, Package, Car, ShieldAlert,
  ShieldCheck, Lock, AlertTriangle, Gavel, History, SlidersHorizontal,
  MousePointerClick, Brain, Settings, LayoutGrid, ClipboardCheck,
  Plane, PlaneTakeoff, Truck, Calculator, FileSearch, Handshake, LifeBuoy,
  Headset, Key, Newspaper, Route as RouteIcon, Boxes, Building2, Briefcase, BusFront, Coins, Power, PackageCheck, Plug, type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard, Users, Shield, CreditCard, Wallet, MapPin, HeadphonesIcon,
  BarChart3, CheckCircle2, Receipt, Database, Activity, Crown, Radar, UserCog,
  FileCheck, GitBranch, GraduationCap, Building, Mail, Package, Car, ShieldAlert,
  ShieldCheck, Lock, AlertTriangle, Gavel, History, SlidersHorizontal,
  MousePointerClick, Brain, Settings, LayoutGrid, ClipboardCheck,
  Plane, PlaneTakeoff, Truck, Calculator, FileSearch, Handshake, LifeBuoy,
  Headset, Key, Newspaper, Route: RouteIcon, Boxes, Building2, Briefcase, BusFront, Coins, Power, PackageCheck, Plug,
};


const EXPAND_KEY = "yeos.sidebar.workspaces.v1";
function loadExpanded(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(EXPAND_KEY) || "{}"); } catch { return {}; }
}
function saveExpanded(state: Record<string, boolean>) {
  try { localStorage.setItem(EXPAND_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}


function IconFor({ name }: { name?: string }) {
  const Cmp = name ? ICONS[name] : undefined;
  const Fallback = LayoutDashboard;
  const C = Cmp ?? Fallback;
  return <C className="h-4 w-4" />;
}

export function DashboardLayout() {
  const { user, loading, roles } = useAuth();
  const entitlements = useEntitlements();

  const navigate = useNavigate();
  const location = useLocation();
  // Usage measurement for the Corporate Controls destinations (page opens).
  useCorporateControlAnalytics();

  useEffect(() => {
    if (loading || !user) return;
    if (location.pathname === "/dashboard") {
      const group = primaryGroupFor(roles);
      navigate(`/dashboard/${group}`, { replace: true });
    }
  }, [loading, user, roles, location.pathname, navigate]);

  if (loading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background">
        <div className="space-y-2 w-64">
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      </div>
    );
  }
  if (!user) return <Navigate to={`/auth?redirect=${encodeURIComponent(location.pathname)}`} replace />;

  // Per-route role enforcement
  const route = routeFor(location.pathname);
  if (route && route.rolesAllowed.length > 0 && !canAccess(route, roles)) {
    void logNavigation({ route: location.pathname, success: false, errorMessage: "FORBIDDEN_FOR_ROLE" });
    void logAccessDenial({
      surface: "route",
      requestedPath: location.pathname,
      reason: "forbidden_for_role",
      requiredRoles: route.rolesAllowed,
      userRoles: roles,
      riskScore: 35,
    });
    const control = corporateControlFor(`${location.pathname}${location.search}`);
    return (
      <div className="p-8 max-w-lg mx-auto text-center" role="alert" data-testid="access-denied">
        <h1 className="text-2xl font-semibold mb-2">Access denied (403)</h1>
        <p className="text-muted-foreground mb-2">
          {control
            ? `${control.label} is a governed corporate control and is restricted to platform administrators.`
            : "You don't have permission to view this page."}
        </p>
        <p className="text-sm text-muted-foreground mb-4">
          Required permission: {route.rolesAllowed.join(" or ")}. Your roles: {roles.length ? roles.join(", ") : "none"}.
          Ask a Super Admin to grant access.
        </p>
        <AppLink to="/" className="text-primary underline" trackId="access-denied:home">Return home</AppLink>
      </div>
    );
  }


  // Sidebar visibility = role access AND tier entitlement. Both are derived
  // from server-granted roles, so a premium item can never be revealed by
  // tampering with client storage.
  // Role-denied items are hidden entirely; tier-locked items stay visible but
  // disabled with a lock so the upgrade path is discoverable and consistent.
  const items = sidebarFor(roles);
  const otherItems = items.filter((i) => !(i.group === "admin" && i.center));

  // Turn admin routes into 10-workspace YEOS groups (config-driven).
  const workspaceGroups = WORKSPACES.map((ws) => {
    // Workspace-level role gate
    if (ws.roles.length > 0 && !ws.roles.some((r) => roles.includes(r))) return null;
    // Filter items to routes that (a) exist, (b) the user can access and
    // (c) are within the user's tier entitlement.
    const visible = ws.items
      .map((it): WorkspaceItem | null => {
        // Deep-link items carry a query string (e.g. "?tab=wallet"); the route
        // registry is keyed by pathname only, so resolve on the pathname and
        // keep the full href for navigation.
        const [pathname] = it.path.split("?");
        const route = ROUTE_BY_PATH.get(pathname);
        if (!route || !canAccess(route, roles)) return null;
        if (!entitlements.can(pathname)) return null;
        // Corporate controls are governed administration surfaces: ONE gate
        // decides visibility, and it never yields to a non-admin identity.
        if (isCorporateControlPath(it.path) && !canViewCorporateControls(roles)) return null;


        return {
          path: it.path,
          label: it.label ?? route.title,
          icon: route.icon as string | undefined,
          section: it.section,
        };
      })
      .filter((x): x is WorkspaceItem => x !== null);

    if (visible.length === 0) return null;
    return { workspace: ws, items: visible };
  }).filter((g): g is NonNullable<typeof g> => g !== null);

  // Fold the workspaces into the eight business domains that form the rail.
  const domainGroups = buildDomainNav(workspaceGroups, roles);


  const renderItem = (item: RouteDef) => {
    const locked = !entitlements.can(item.path);
    if (locked) {
      return (
        <SidebarMenuItem key={item.path}>
          <SidebarMenuButton asChild isActive={false}>
            <AppLink
              to={`/dashboard/premium/upgrade?from=${encodeURIComponent(item.path)}&tier=${entitlements.requiredTierFor(item.path)}`}
              trackId={`sidebar-locked:${item.path}`}
              trackLabel={item.title}
              aria-disabled="true"
              data-locked="true"
              title={`${item.title} requires a higher tier`}
              className="flex items-center gap-2 opacity-60"
            >
              <Lock className="h-4 w-4" aria-hidden />
              <span>{item.title}</span>
            </AppLink>
          </SidebarMenuButton>
        </SidebarMenuItem>
      );
    }
    return (
    <SidebarMenuItem key={item.path}>
      <SidebarMenuButton asChild isActive={location.pathname === item.path}>
        <AppLink
          to={item.path}
          trackId={`sidebar:${item.path}`}
          trackLabel={item.title}
          className="flex items-center gap-2"
        >
          <IconFor name={item.icon} />
          <span>{item.title}</span>
        </AppLink>
      </SidebarMenuButton>
    </SidebarMenuItem>
    );
  };

  return (
    <SidebarProvider>
      <div className="min-h-dvh flex w-full bg-background text-foreground">
        <Sidebar collapsible="icon">
          <SidebarContent>
            {otherItems.length > 0 && (
              <SidebarGroup>
                <SidebarGroupLabel>Menu</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>{otherItems.map(renderItem)}</SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            )}
            {domainGroups.length > 0 && (
              <DomainsNav groups={domainGroups} currentPath={location.pathname} currentSearch={location.search} />
            )}
          </SidebarContent>
        </Sidebar>


        <div className="flex-1 flex flex-col min-w-0">
          <header
            className="sticky top-0 z-30 h-header border-b border-border bg-card/85 backdrop-blur-md shadow-enterprise-sm flex items-center px-4 sm:px-6 gap-3"
            role="banner"
          >
            <SidebarTrigger aria-label="Toggle sidebar" />
            <div className="ml-auto flex items-center gap-2 sm:gap-3">
              <OperatingContextSwitch />
              <Button
                variant="outline"
                size="sm"
                className="gap-2 rounded-lg"
                onClick={() => {
                  window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
                }}
                aria-label="Open global search"
              >
                <span>Search</span>
                <kbd className="hidden sm:inline px-1.5 py-0.5 rounded bg-muted text-[11px] font-medium">⌘K</kbd>
              </Button>
              <span className="text-sm text-muted-foreground hidden md:inline truncate max-w-[180px]">{user.email}</span>
              <Button
                variant="outline"
                size="sm"
                className="rounded-lg"
                onClick={async () => { await supabase.auth.signOut(); navigate("/"); }}
              >
                Sign out
              </Button>
            </div>
          </header>
          <main className="flex-1 p-4 sm:p-6 lg:p-8 pb-20 md:pb-8 overflow-y-auto" role="main">
            <div className="mx-auto w-full max-w-[1600px]">
              <Breadcrumbs className="mb-4" />
              <Outlet />
            </div>
          </main>
        </div>
        <MobileBottomNav />
      </div>
    </SidebarProvider>
  );
}

// -------- YEOS Workspaces sidebar block --------
interface WorkspaceItem {
  path: string;
  label: string;
  icon: string | undefined;
  section?: string;
}

/**
 * Eight-domain business rail. Each domain is a collapsible command group whose
 * children are grouped by workflow section. Destinations themselves are still
 * owned by the route registry — this component only presents them.
 */
function DomainsNav({
  groups,
  currentPath,
  currentSearch = "",
}: {
  groups: DomainNavGroup[];
  currentPath: string;
  currentSearch?: string;
}) {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";

  /**
   * Item hrefs may carry a query string ("/x?tab=wallet"). An item is active
   * when its pathname matches AND every query param it declares is present in
   * the current URL — so tab deep links highlight individually instead of all
   * siblings lighting up at once.
   */
  const isItemActive = (href: string) => {
    const [pathname, query] = href.split("?");
    if (pathname !== currentPath) return false;
    if (!query) return true;
    const current = new URLSearchParams(currentSearch);
    return [...new URLSearchParams(query).entries()].every(([k, v]) => current.get(k) === v);
  };

  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    const saved = loadExpanded();
    const next = { ...saved };
    for (const g of groups) {
      if (next[g.domain.key] === undefined) {
        next[g.domain.key] = g.items.some((i) => i.path.split("?")[0] === currentPath);
      }
    }
    return next;
  });

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      saveExpanded(next);
      return next;
    });
  };

  return (
    <>
      {groups.map(({ domain, items }) => {
        const Icon = ICONS[domain.icon] ?? LayoutDashboard;
        const isOpen = expanded[domain.key] ?? false;
        const hasActive = items.some((i) => isItemActive(i.path)) || domain.landing === currentPath;
        return (
          <SidebarGroup key={domain.key}>
            <Collapsible open={isOpen || collapsed} onOpenChange={() => !collapsed && toggle(domain.key)}>
              <CollapsibleTrigger asChild disabled={collapsed}>
                <SidebarGroupLabel
                  className={`cursor-pointer flex items-center gap-2 rounded-md px-2 py-1.5 h-auto hover:bg-sidebar-accent/40 ${
                    hasActive ? "bg-sidebar-accent/50 text-sidebar-accent-foreground" : ""
                  }`}
                  aria-expanded={isOpen}
                >
                  <Icon className={`h-4 w-4 shrink-0 ${hasActive ? "text-sidebar-primary" : ""}`} aria-hidden />
                  {!collapsed && (
                    <span className="min-w-0 flex-1 text-left">
                      <span className="block truncate text-[13px] font-semibold tracking-tight">
                        {domain.label}
                      </span>
                      <span className="block truncate text-[10px] font-normal uppercase tracking-[0.1em] text-sidebar-foreground/50">
                        {domain.sublabel}
                      </span>
                    </span>
                  )}
                  {!collapsed && (
                    <ChevronRight
                      className={`h-3 w-3 shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`}
                      aria-hidden
                    />
                  )}
                </SidebarGroupLabel>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {items.map((item, idx) => {
                      const showSection = item.section !== items[idx - 1]?.section;
                      return (
                        <div key={item.path}>
                          {showSection && (
                            <div className="px-6 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/50">
                              {item.section}
                            </div>
                          )}
                          <SidebarMenuItem>
                            <SidebarMenuButton asChild isActive={isItemActive(item.path)} size="sm">
                              <AppLink
                                to={item.path}
                                trackId={`sidebar:${item.path}`}
                                trackLabel={item.label}
                                data-corporate-control={
                                  isCorporateControlPath(item.path) ? item.path : undefined
                                }
                                onClick={() => {
                                  const control = corporateControlFor(item.path);
                                  if (control) trackCorporateControlClick(control);
                                }}
                                className="flex items-center gap-2 pl-6"
                              >
                                <IconFor name={item.icon} />
                                <span className="truncate">{item.label}</span>
                              </AppLink>
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        </div>
                      );
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </CollapsibleContent>
            </Collapsible>
          </SidebarGroup>
        );
      })}
    </>
  );
}



