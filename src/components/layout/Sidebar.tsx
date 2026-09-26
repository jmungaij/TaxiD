import React from 'react';
import BrandLogo from "@/components/brand/BrandLogo";
import { NavLink } from 'react-router-dom';
import { cn } from "@/lib/utils";
import {
  Home, Users, Car, MapPin, Calendar, Settings,
  BarChart3, MessageSquare, LogOut, X
} from 'lucide-react';
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { supabase } from "@/integrations/supabase/client";
import { trackCta } from "@/lib/cta";
import { AnalyticsEvents } from "@/lib/analyticsEvents";

type NavItemProps = {
  to: string;
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
};

const NavItem = ({ to, icon, label, onClick }: NavItemProps) => (
  <NavLink
    to={to}
    end={to === "/"}
    className={({ isActive }) =>
      cn(
        "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors duration-base ease-enterprise",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
        isActive
          ? "bg-sidebar-primary text-sidebar-primary-foreground font-semibold shadow-enterprise-sm"
          : "text-sidebar-foreground/85 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
      )
    }
    onClick={onClick}
  >
    {({ isActive }) => (
      <>
        <span
          aria-hidden="true"
          className={cn(
            "absolute left-0 top-1/2 -translate-y-1/2 h-6 w-0.5 rounded-r-full transition-all",
            isActive ? "bg-sidebar-primary" : "bg-transparent group-hover:bg-sidebar-primary/40"
          )}
        />
        <span className={cn("shrink-0", isActive ? "text-sidebar-primary" : "text-sidebar-foreground/70")}>{icon}</span>
        <span className="truncate">{label}</span>
      </>
    )}
  </NavLink>
);

interface SidebarProps {
  isSidebarOpen: boolean;
  toggleSidebar: () => void;
}

const Sidebar = ({ isSidebarOpen, toggleSidebar }: SidebarProps) => {
  const isMobile = useIsMobile();

  const sidebarClasses = cn(
    "flex flex-col bg-sidebar text-sidebar-foreground h-full w-sidebar border-r border-sidebar-border transition-transform duration-slow ease-enterprise z-20",
    isMobile
      ? cn(
          "fixed inset-y-0 left-0 shadow-enterprise-xl",
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        )
      : "sticky top-0"
  );

  const overlayClasses = cn(
    "fixed inset-0 bg-foreground/50 backdrop-blur-sm z-10 lg:hidden transition-opacity duration-base",
    isSidebarOpen ? "opacity-100" : "opacity-0 pointer-events-none"
  );

  return (
    <>
      <div className={overlayClasses} onClick={toggleSidebar} aria-hidden="true" />

      <aside className={sidebarClasses} aria-label="Primary navigation">
        {isMobile && (
          <div className="flex justify-end p-3">
            <Button
              variant="ghost" size="icon"
              onClick={toggleSidebar}
              aria-label="Close menu"
              className="text-sidebar-foreground hover:bg-sidebar-accent"
            >
              <X size={20} aria-hidden="true" />
            </Button>
          </div>
        )}

        {/* Brand */}
        <div className="flex items-center gap-3 px-5 h-header border-b border-sidebar-border">
          <BrandLogo tone="light" className="h-7 max-w-[150px]" />
          <div className="min-w-0 border-l border-sidebar-border pl-3">
            <div className="text-[11px] uppercase tracking-wider text-sidebar-foreground/55">Enterprise OS</div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto" aria-label="Sections">
          <NavItem to="/" icon={<Home size={18} />} label="Dashboard" onClick={isMobile ? toggleSidebar : undefined} />
          <NavItem to="/riders" icon={<Users size={18} />} label="Riders" onClick={isMobile ? toggleSidebar : undefined} />
          <NavItem to="/drivers" icon={<Car size={18} />} label="Drivers" onClick={isMobile ? toggleSidebar : undefined} />
          <NavItem to="/trips" icon={<MapPin size={18} />} label="Trips" onClick={isMobile ? toggleSidebar : undefined} />
          <NavItem to="/schedule" icon={<Calendar size={18} />} label="Schedule" onClick={isMobile ? toggleSidebar : undefined} />
          <NavItem to="/analytics" icon={<BarChart3 size={18} />} label="Analytics" onClick={isMobile ? toggleSidebar : undefined} />
          <NavItem to="/messages" icon={<MessageSquare size={18} />} label="Messages" onClick={isMobile ? toggleSidebar : undefined} />
          <NavItem to="/settings" icon={<Settings size={18} />} label="Settings" onClick={isMobile ? toggleSidebar : undefined} />
        </nav>

        <div className="p-3 border-t border-sidebar-border">
          <Button
            variant="ghost"
            onClick={async () => {
              void trackCta({ buttonName: AnalyticsEvents.ADMIN_SIGN_OUT, actionType: "submit" });
              await supabase.auth.signOut();
              window.location.href = "/";
            }}
            aria-label="Sign out of your account"
            data-testid="sidebar-logout"
            data-analytics={AnalyticsEvents.ADMIN_SIGN_OUT}
            className="w-full justify-start gap-3 text-sidebar-foreground/85 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <LogOut size={18} aria-hidden="true" />
            <span>Sign out</span>
          </Button>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
