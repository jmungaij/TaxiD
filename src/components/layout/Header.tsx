import React from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Bell, Search, Menu, Zap, Sparkles, LogOut, Settings as SettingsIcon, User as UserIcon } from 'lucide-react';
import { useIsMobile } from "@/hooks/use-mobile";
import { trackCta } from "@/lib/cta";
import { AnalyticsEvents } from "@/lib/analyticsEvents";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface HeaderProps {
  toggleSidebar: () => void;
}

const Header = ({ toggleSidebar }: HeaderProps) => {
  const isMobile = useIsMobile();

  const handleNotifications = () => {
    void trackCta({ buttonName: AnalyticsEvents.ADMIN_HEADER_NOTIFICATIONS, actionType: "dialog" });
    toast({ title: "Notifications", description: "You're all caught up." });
  };
  const handleToggle = () => {
    void trackCta({ buttonName: AnalyticsEvents.ADMIN_HEADER_TOGGLE_SIDEBAR, actionType: "noop" });
    toggleSidebar();
  };
  const handleQuickAction = () => {
    void trackCta({ buttonName: "admin_header_quick_actions", actionType: "dialog" });
    toast({ title: "Quick Actions", description: "Choose an action from the palette." });
  };
  const handleAiAssist = () => {
    void trackCta({ buttonName: "admin_header_ai_assist", actionType: "dialog" });
    toast({ title: "AI Assistant", description: "Ask anything about your workspace." });
  };

  return (
    <header
      className="sticky top-0 z-30 w-full h-header bg-card/85 backdrop-blur-md border-b border-border shadow-enterprise-sm"
      role="banner"
    >
      <div className="flex h-full items-center justify-between gap-4 px-4 sm:px-6">
        {isMobile && (
          <Button
            variant="ghost" size="icon"
            onClick={handleToggle}
            aria-label="Toggle menu"
            data-testid="header-toggle-sidebar"
            data-analytics={AnalyticsEvents.ADMIN_HEADER_TOGGLE_SIDEBAR}
          >
            <Menu size={20} aria-hidden="true" />
          </Button>
        )}

        {/* Global search */}
        <div className="flex-1 max-w-xl">
          <label htmlFor="enterprise-global-search" className="sr-only">Global search</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id="enterprise-global-search"
              type="search"
              placeholder="Search workspaces, riders, drivers, trips…"
              aria-label="Global search"
              className="w-full pl-9 h-10 bg-background/60 border-border focus-visible:ring-ring rounded-lg"
            />
          </div>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2">
          <Button
            variant="ghost" size="icon"
            onClick={handleAiAssist}
            aria-label="AI Assistant"
            className="relative text-ai hover:text-ai hover:bg-ai/10"
          >
            <Sparkles size={18} aria-hidden="true" />
          </Button>

          <Button
            variant="ghost" size="icon"
            onClick={handleQuickAction}
            aria-label="Quick actions"
            className="hover:bg-secondary"
          >
            <Zap size={18} aria-hidden="true" />
          </Button>

          <Button
            variant="ghost" size="icon"
            onClick={handleNotifications}
            aria-label="Notifications"
            data-testid="header-notifications"
            data-analytics={AnalyticsEvents.ADMIN_HEADER_NOTIFICATIONS}
            className="relative hover:bg-secondary"
          >
            <Bell size={18} aria-hidden="true" />
            <span
              className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-status-danger ring-2 ring-card"
              aria-hidden="true"
            />
            <span className="sr-only">Unread notifications</span>
          </Button>

          <div className="w-px h-6 bg-border mx-1 hidden sm:block" aria-hidden="true" />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label="Open user menu"
                className="flex items-center gap-2 rounded-full pl-1 pr-2 py-1 hover:bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Avatar className="h-8 w-8 ring-1 ring-border">
                  <AvatarImage src="https://github.com/shadcn.png" alt="" />
                  <AvatarFallback>AB</AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>My Account</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem><UserIcon className="mr-2 h-4 w-4" />Profile</DropdownMenuItem>
              <DropdownMenuItem><SettingsIcon className="mr-2 h-4 w-4" />Settings</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={async () => {
                  await supabase.auth.signOut();
                  window.location.href = "/";
                }}
                className="text-destructive focus:text-destructive"
              >
                <LogOut className="mr-2 h-4 w-4" />Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
};

export default Header;
