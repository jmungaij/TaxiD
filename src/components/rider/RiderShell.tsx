import { ReactNode } from "react";
import BrandLogo from "@/components/brand/BrandLogo";
import { Link, NavLink, useLocation, Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Skeleton } from "@/components/ui/skeleton";
import { Car, CarFront, MapPin, Wallet, Shield, Heart, Gift, Calendar, Plane, Bell, LogOut, Inbox } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Breadcrumbs } from "@/components/nav/Breadcrumbs";
import { MobileBottomNav } from "@/components/nav/MobileBottomNav";

const NAV = [
  { to: "/rider", label: "Book", icon: Car, end: true },
  { to: "/rider/trips", label: "Trips", icon: MapPin },
  { to: "/rider/schedule", label: "Scheduled", icon: Calendar },
  { to: "/rider/airport", label: "Airport", icon: Plane },
  { to: "/rider/rentals", label: "Rentals", icon: CarFront },
  { to: "/rider/wallet", label: "Wallet", icon: Wallet },
  { to: "/rider/inbox", label: "Support inbox", icon: Inbox },
  { to: "/rider/favorites", label: "Favorites", icon: Heart },
  { to: "/rider/safety", label: "Safety", icon: Shield },
  { to: "/rider/rewards", label: "Rewards", icon: Gift },
];

export function RiderShell({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="p-6 space-y-2">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (!user) return <Navigate to={`/auth?redirect=${encodeURIComponent(location.pathname)}`} replace />;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link to="/rider" className="flex items-center" aria-label="TaxiD rider home">
            <BrandLogo className="h-7 max-w-[150px]" />
          </Link>
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Notifications"
              data-testid="rider-notifications"
              data-analytics="rider.notifications.open"
              onClick={() => {
                void import("@/lib/cta").then(({ trackCta }) =>
                  trackCta({ buttonName: "rider.notifications.open", actionType: "dialog" })
                );
              }}
            >
              <Bell className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                await supabase.auth.signOut();
                window.location.href = "/";
              }}
            >
              <LogOut className="h-4 w-4 mr-1" /> Sign out
            </Button>
          </div>
        </div>
      </header>
      <div className="max-w-7xl mx-auto px-4 py-6 grid lg:grid-cols-[220px_1fr] gap-6 pb-20 md:pb-6">
        <nav className="hidden lg:block lg:sticky lg:top-20 lg:self-start">
          <ul className="grid grid-cols-1 gap-1">
            {NAV.map((n) => (
              <li key={n.to}>
                <NavLink
                  to={n.to}
                  end={n.end}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors",
                      isActive ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"
                    )
                  }
                >
                  <n.icon className="h-4 w-4" />
                  <span>{n.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <main>
          <Breadcrumbs className="mb-4" />
          {children}
        </main>
      </div>
      <MobileBottomNav variant="rider" />
    </div>
  );
}
