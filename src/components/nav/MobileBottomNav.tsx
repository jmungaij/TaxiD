import { useMemo } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Home, Car, MapPin, Wallet, User, LayoutDashboard, Package, Users, CheckCircle2, BarChart3, HeadphonesIcon, Shield, Activity, type LucideIcon } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { logUiEvent } from "@/lib/navLog";

export type BottomNavVariant = "rider" | "driver" | "corporate" | "admin" | "marketing";

interface Tab {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

const TABS: Record<BottomNavVariant, Tab[]> = {
  rider: [
    { to: "/rider", label: "Book", icon: Car, end: true },
    { to: "/rider/trips", label: "Trips", icon: MapPin },
    { to: "/rider/wallet", label: "Wallet", icon: Wallet },
    { to: "/rider/safety", label: "Safety", icon: Shield },
    { to: "/dashboard/rider", label: "Account", icon: User },
  ],
  driver: [
    { to: "/dashboard/driver", label: "Home", icon: LayoutDashboard, end: true },
    { to: "/dashboard/driver/trips", label: "Trips", icon: MapPin },
    { to: "/dashboard/driver/wallet", label: "Wallet", icon: Wallet },
    { to: "/driver/wealth", label: "Wealth", icon: BarChart3 },
    { to: "/dashboard/driver/support", label: "Support", icon: HeadphonesIcon },
  ],
  corporate: [
    { to: "/dashboard/corporate", label: "Overview", icon: LayoutDashboard, end: true },
    { to: "/dashboard/corporate/employees", label: "Team", icon: Users },
    { to: "/dashboard/corporate/approvals", label: "Approve", icon: CheckCircle2 },
    { to: "/dashboard/corporate/spend", label: "Spend", icon: BarChart3 },
    { to: "/dashboard/corporate/wallet", label: "Wallet", icon: Wallet },
  ],
  admin: [
    { to: "/dashboard/admin", label: "Overview", icon: LayoutDashboard, end: true },
    { to: "/dashboard/admin/operations", label: "Ops", icon: Activity },
    { to: "/dashboard/admin/finance-center", label: "Finance", icon: Wallet },
    { to: "/dashboard/admin/compliance", label: "Compliance", icon: Shield },
    { to: "/dashboard/admin/system", label: "System", icon: LayoutDashboard },
  ],
  marketing: [
    { to: "/", label: "Home", icon: Home, end: true },
    { to: "/riders", label: "Ride", icon: Car },
    { to: "/drivers", label: "Drive", icon: User },
    { to: "/delivery", label: "Deliver", icon: Package },
    { to: "/auth", label: "Sign in", icon: LayoutDashboard },
  ],
};

export interface MobileBottomNavProps {
  /** Force a variant. Otherwise auto-detect from path + roles. */
  variant?: BottomNavVariant;
  className?: string;
}

function detectVariant(pathname: string, roles: string[]): BottomNavVariant {
  if (pathname.startsWith("/dashboard/admin")) return "admin";
  if (pathname.startsWith("/dashboard/driver") || pathname.startsWith("/driver")) return "driver";
  if (pathname.startsWith("/dashboard/corporate")) return "corporate";
  if (pathname.startsWith("/dashboard/rider") || pathname.startsWith("/rider")) return "rider";
  if (pathname.startsWith("/dashboard")) {
    if (roles.includes("admin") || roles.includes("super_admin")) return "admin";
    if (roles.includes("driver")) return "driver";
    if (roles.includes("corporate_admin") || roles.includes("corporate_employee")) return "corporate";
    return "rider";
  }
  return "marketing";
}

export function MobileBottomNav({ variant, className }: MobileBottomNavProps) {
  const { pathname } = useLocation();
  const { roles } = useAuth();
  const resolved = useMemo<BottomNavVariant>(
    () => variant ?? detectVariant(pathname, roles),
    [variant, pathname, roles],
  );
  const tabs = TABS[resolved];

  return (
    <nav
      aria-label="Primary"
      className={cn(
        "md:hidden fixed bottom-0 inset-x-0 z-40 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80",
        "pb-[env(safe-area-inset-bottom)]",
        className,
      )}
    >
      <ul className="grid grid-cols-5">
        {tabs.map((tab) => (
          <li key={tab.to}>
            <NavLink
              to={tab.to}
              end={tab.end}
              onClick={() => {
                void logUiEvent({
                  elementId: `bottomnav:${tab.to}`,
                  elementLabel: tab.label,
                  action: "navigate",
                  success: true,
                  payload: { to: tab.to, variant: resolved },
                });
              }}
              className={({ isActive }) =>
                cn(
                  "flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium transition-colors",
                  isActive ? "text-primary" : "text-muted-foreground hover:text-foreground",
                )
              }
            >
              <tab.icon className="h-5 w-5" aria-hidden />
              <span>{tab.label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export default MobileBottomNav;
