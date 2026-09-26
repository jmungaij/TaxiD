/**
 * DriverStickyCta — mobile-only sticky action bar for one-handed navigation.
 * Presentation only; targets the existing onboarding wizard section.
 */
import { ArrowRight } from "lucide-react";
import { AppButton } from "@/components/nav/AppButton";

export function DriverStickyCta({ resumeAvailable }: { resumeAvailable?: boolean }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 p-3 backdrop-blur-md md:hidden">
      <div className="flex items-center gap-2">
        <AppButton
          className="min-h-11 flex-1"
          analytics="driver_landing_sticky_apply"
          action="scroll"
          target="#application-journey"
        >
          {resumeAvailable ? "Resume Application" : "Complete Application"}
          <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
        </AppButton>
        <AppButton
          variant="outline"
          className="min-h-11"
          analytics="driver_landing_sticky_support"
          action="navigate"
          target="/driver/support"
        >
          Support
        </AppButton>
      </div>
    </div>
  );
}

export default DriverStickyCta;
