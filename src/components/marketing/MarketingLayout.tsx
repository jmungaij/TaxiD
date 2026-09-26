import { ReactNode } from "react";
import MarketingHeader from "./MarketingHeader";
import MarketingFooter from "./MarketingFooter";
import RouteSEO from "./RouteSEO";
import { Breadcrumbs } from "@/components/nav/Breadcrumbs";
import { MobileBottomNav } from "@/components/nav/MobileBottomNav";

const MarketingLayout = ({ children }: { children: ReactNode }) => (
  <div className="min-h-screen flex flex-col bg-background">
    <RouteSEO />
    <MarketingHeader />
    <div className="max-w-7xl mx-auto w-full px-4 pt-3">
      <Breadcrumbs />
    </div>
    <main className="flex-1 pb-16 md:pb-0">{children}</main>
    <MarketingFooter />
    <MobileBottomNav />
  </div>
);

export default MarketingLayout;
