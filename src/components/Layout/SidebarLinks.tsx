
import { HomeIcon, Users, Car, Navigation, LineChart, Settings, HelpCircle, CreditCard } from "lucide-react";

export const SIDEBAR_LINKS = [
  {
    title: "Dashboard",
    href: "/",
    icon: HomeIcon,
  },
  {
    title: "Passengers",
    href: "/passengers",
    icon: Users,
  },
  {
    title: "Drivers",
    href: "/drivers",
    icon: Car,
  },
  {
    title: "Trips",
    href: "/trips",
    icon: Navigation,
  },
  {
    title: "Payments",
    href: "/payments",
    icon: CreditCard,
  },
  {
    title: "Analytics",
    href: "/analytics",
    icon: LineChart,
  },
  {
    title: "Settings",
    href: "/settings",
    icon: Settings,
  },
  {
    title: "Help & Support",
    href: "/help",
    icon: HelpCircle,
  }
];
