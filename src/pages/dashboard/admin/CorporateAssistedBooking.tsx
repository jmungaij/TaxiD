/**
 * Assisted Booking Desk — lets an admin facilitate a booking on behalf of a
 * corporate account (the Uber "book for a rider" concession desk pattern).
 *
 * It reuses the existing Enterprise Booking Centre wizard rather than
 * duplicating sector logic; this page only supplies the corporate context and
 * the audited "manage as" session that authorises acting on their behalf.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AccessNotice } from "@/components/auth/AccessNotice";
import { ManageAsBanner } from "@/components/corporate/ManageAsBanner";
import { EnterpriseBookingCentre } from "@/components/charter/EnterpriseBookingCentre";
import { readManageAsSession, type ManageAsSession } from "@/lib/corporate/manageAs";
import { workspace360Path } from "@/lib/workspace360/links";

export default function CorporateAssistedBooking() {
  const [params] = useSearchParams();
  const corporateId = params.get("corporate") ?? "";
  const [session, setSession] = useState<ManageAsSession | null>(() => readManageAsSession());

  useEffect(() => {
    const refresh = () => setSession(readManageAsSession());
    window.addEventListener("yalla:manage-as-changed", refresh);
    return () => window.removeEventListener("yalla:manage-as-changed", refresh);
  }, []);

  const scoped = useMemo(
    () => Boolean(session && (!corporateId || session.corporate_id === corporateId)),
    [session, corporateId],
  );

  return (
    <div className="space-y-4" data-testid="corporate-assisted-booking">
      <ManageAsBanner />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Assisted Booking Desk</h1>
          <p className="text-sm text-muted-foreground">
            Facilitate a booking on behalf of a corporate account. Every step is audited.
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link to="/dashboard/admin/corporates">
            <ArrowLeft className="mr-2 h-4 w-4" aria-hidden />
            Control Tower
          </Link>
        </Button>
      </div>

      {!scoped ? (
        <AccessNotice
          kind="role"
          title="Start a manage-as session first"
          description="Assisted bookings must be attached to a time-boxed, audited session for the corporate you are helping. Open the Control Tower and choose Book on the account."
          actionTo="/dashboard/admin/corporates"
          actionLabel="Open Control Tower"
        />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Booking on behalf of {session!.corporate_name}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Charges settle against this corporate's pre-funded wallet and policy rules.{" "}
              <Link className="underline" to={workspace360Path("corporate", session!.corporate_id)}>
                Review the account
              </Link>{" "}
              before confirming a high-value trip.
            </CardContent>
          </Card>
          <EnterpriseBookingCentre organizationName={session!.corporate_name} />
        </>
      )}
    </div>
  );
}
