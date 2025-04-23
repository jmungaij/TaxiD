
import { cn } from "@/lib/utils";
import { HTMLAttributes } from "react";
import { NavLink } from "react-router-dom";
import { 
  BarChart3Icon,
  UsersIcon,
  CarIcon,
  MapIcon,
  CalendarIcon,
  Settings2Icon,
  HelpCircleIcon,
  LogOutIcon,
  HomeIcon,
} from "lucide-react";

interface SidebarProps extends HTMLAttributes<HTMLDivElement> {}

const Sidebar = ({ className, ...props }: SidebarProps) => {
  return (
    <div
      className={cn(
        "flex flex-col h-screen bg-sidebar border-r border-sidebar-border",
        className
      )}
      {...props}
    >
      <div className="p-6">
        <div className="flex items-center gap-2 px-2">
          <MapIcon className="h-8 w-8 text-teal-500" />
          <div className="font-bold text-2xl text-sidebar-foreground">
            RideNexus
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-auto py-2">
        <nav className="grid gap-1 px-4">
          <NavLink
            to="/"
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-base transition-all hover:text-sidebar-foreground",
                isActive
                  ? "bg-sidebar-accent text-sidebar-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50"
              )
            }
          >
            <HomeIcon className="h-5 w-5" />
            Dashboard
          </NavLink>
          <NavLink
            to="/passengers"
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-base transition-all hover:text-sidebar-foreground",
                isActive
                  ? "bg-sidebar-accent text-sidebar-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50"
              )
            }
          >
            <UsersIcon className="h-5 w-5" />
            Passengers
          </NavLink>
          <NavLink
            to="/trips"
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-base transition-all hover:text-sidebar-foreground",
                isActive
                  ? "bg-sidebar-accent text-sidebar-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50"
              )
            }
          >
            <CalendarIcon className="h-5 w-5" />
            Trips
          </NavLink>
          <NavLink
            to="/drivers"
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-base transition-all hover:text-sidebar-foreground",
                isActive
                  ? "bg-sidebar-accent text-sidebar-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50"
              )
            }
          >
            <CarIcon className="h-5 w-5" />
            Drivers
          </NavLink>
          <NavLink
            to="/analytics"
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-base transition-all hover:text-sidebar-foreground",
                isActive
                  ? "bg-sidebar-accent text-sidebar-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50"
              )
            }
          >
            <BarChart3Icon className="h-5 w-5" />
            Analytics
          </NavLink>

          <div className="mt-6 pt-6 border-t border-sidebar-border/50">
            <NavLink
              to="/settings"
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-base transition-all hover:text-sidebar-foreground",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50"
                )
              }
            >
              <Settings2Icon className="h-5 w-5" />
              Settings
            </NavLink>
            <NavLink
              to="/help"
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-base transition-all hover:text-sidebar-foreground",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50"
                )
              }
            >
              <HelpCircleIcon className="h-5 w-5" />
              Help & Support
            </NavLink>
          </div>
        </nav>
      </div>
      <div className="mt-auto p-4">
        <button className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-base text-sidebar-foreground/70 hover:text-sidebar-foreground transition-all hover:bg-sidebar-accent/50">
          <LogOutIcon className="h-5 w-5" />
          Logout
        </button>
      </div>
    </div>
  );
};

export default Sidebar;
