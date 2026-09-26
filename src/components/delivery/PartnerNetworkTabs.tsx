/**
 * Partner network onboarding tabs.
 *
 * Split into its own default-exported chunk so the heavy onboarding wizard,
 * KYC panel and vehicle registry are code-split out of the public module page
 * and only fetched when a visitor actually scrolls to the partner section.
 */
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Users, FileCheck, Car } from "lucide-react";
import type { ModuleMeta } from "./ModuleShell";
import { OnboardingWizard, KycDocumentsPanel, VehiclesPanel } from "./ModulePanels";

export default function PartnerNetworkTabs({ module }: { module: ModuleMeta }) {
  return (
    <Tabs defaultValue="onboarding" className="space-y-6">
      <TabsList className="grid grid-cols-3">
        <TabsTrigger value="onboarding">
          <Users className="mr-1.5 h-3.5 w-3.5" /> Onboarding
        </TabsTrigger>
        <TabsTrigger value="kyc">
          <FileCheck className="mr-1.5 h-3.5 w-3.5" /> KYC &amp; docs
        </TabsTrigger>
        <TabsTrigger value="vehicles">
          <Car className="mr-1.5 h-3.5 w-3.5" /> Vehicles
        </TabsTrigger>
      </TabsList>

      <TabsContent value="onboarding">
        <OnboardingWizard module={module} />
      </TabsContent>
      <TabsContent value="kyc">
        <KycDocumentsPanel module={module} />
      </TabsContent>
      <TabsContent value="vehicles">
        <VehiclesPanel module={module} />
      </TabsContent>
    </Tabs>
  );
}
