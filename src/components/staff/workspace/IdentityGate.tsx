import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { claimMyStaffProfile, linkMyStaffProfile } from "@/lib/workspace/api";
import { IdentityDiagnostics } from "@/components/staff/workspace/IdentityDiagnostics";
import { toast } from "sonner";

/**
 * IDENTITY GATE — shown when the authenticated login cannot be securely mapped
 * to a SAFARID staff record. No personal work, customer, document or calendar
 * information may render behind this state.
 *
 * Platform administrators get a self-service repair action; it calls a
 * SECURITY DEFINER RPC that re-checks the admin role server-side.
 */
export function IdentityGate({
  diagnosticRef,
  onRetry,
}: {
  diagnosticRef: string | null;
  onRetry: () => void;
}) {
  const { roles } = useAuth();
  const isAdmin = roles.some((r) => r === "admin" || r === "super_admin");
  const [linking, setLinking] = useState(false);

  const link = async () => {
    setLinking(true);
    try {
      // Any employee may connect their own record (verified-email match,
      // enforced server-side); administrators can additionally provision one.
      const claimed = await claimMyStaffProfile();
      if (!claimed) {
        if (!isAdmin) throw new Error("No staff record carries your verified work email yet.");
        await linkMyStaffProfile();
      }
      toast.success("Staff profile linked", { description: "Loading your workspace." });
      onRetry();
    } catch (e) {
      toast.error("Could not link your staff profile", {
        description: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setLinking(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-4">
      <Card className="border-warning/40">
        <CardContent className="space-y-4 pt-6">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-warning">
            <ShieldAlert className="h-3.5 w-3.5" /> Workspace withheld
          </div>
          <h2 className="text-xl font-semibold tracking-tight">
            We couldn't securely connect this login to a SAFARID Staff profile.
          </h2>
          <p className="text-sm text-muted-foreground">
            Your personal workspace is temporarily withheld to protect your account and customer
            information. Nothing has been substituted or estimated in its place.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={onRetry}>
              Retry
            </Button>
            <Button size="sm" variant="secondary" onClick={link} disabled={linking}>
              {linking ? "Connecting…" : "Connect my staff profile"}
            </Button>
            {isAdmin && (
              <Button size="sm" variant="outline" asChild>
                <a href="/staff/org/links">Open staff link backfill</a>
              </Button>
            )}
            <Button size="sm" variant="outline" asChild>
              <a href="mailto:support@yalla.africa?subject=Staff%20profile%20link%20request">
                Contact administrator
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>
      <IdentityDiagnostics diagnosticRef={diagnosticRef} />
    </div>
  );
}
