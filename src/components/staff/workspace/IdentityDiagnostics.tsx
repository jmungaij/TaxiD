/**
 * IDENTITY DIAGNOSTICS — the honest "why" behind a withheld workspace.
 *
 * Reads a SECURITY DEFINER function that reports on the CALLER'S OWN login
 * only, and translates the reason code into the exact administrator action
 * required. No other employee's record is ever exposed here.
 */
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Stethoscope } from "lucide-react";
import {
  fetchStaffLinkDiagnostics,
  type StaffLinkDiagnostics,
  type StaffLinkReason,
} from "@/lib/workspace/api";

const EXPLANATION: Record<StaffLinkReason, { title: string; cause: string; action: string }> = {
  linked: {
    title: "Your login is linked",
    cause: "A staff record is connected to this login.",
    action: "If the workspace is still withheld, reload the page.",
  },
  claimable: {
    title: "A staff record matches your verified email",
    cause: "The record exists but is not yet connected to this login.",
    action: "Use “Connect my staff profile” below — no administrator needed.",
  },
  no_staff_record: {
    title: "No staff record carries this email address",
    cause:
      "Nothing on the TaxiD staff register uses your work or personal email, so no record can be matched.",
    action:
      "Ask an administrator to add you to the staff register with this exact email, then run the staff link backfill.",
  },
  email_unverified: {
    title: "Your email address is not verified yet",
    cause:
      "Linking is only ever done against a verified email address, so an unverified login cannot be matched.",
    action: "Confirm the verification email sent to this address, then retry.",
  },
  ambiguous_email_match: {
    title: "More than one staff record uses this email",
    cause: "An ambiguous match is never linked automatically — that could attach the wrong record.",
    action: "Ask an administrator to de-duplicate the staff register for this email address.",
  },
  match_inactive: {
    title: "The matching staff record is not active",
    cause: "A record matches your email but its employment status is not active.",
    action: "Ask an administrator to reactivate the employment record.",
  },
  record_inactive: {
    title: "Your linked staff record is not active",
    cause: "The record connected to this login is no longer marked active.",
    action: "Ask an administrator to reactivate your employment record.",
  },
  not_authenticated: {
    title: "You are signed out",
    cause: "No session was present when diagnostics ran.",
    action: "Sign in again.",
  },
  unavailable: {
    title: "Diagnostics unavailable",
    cause: "The diagnostic check could not be completed for this login.",
    action: "Retry, and quote the reference below to your administrator if it persists.",
  },
};

export function IdentityDiagnostics({ diagnosticRef }: { diagnosticRef?: string | null }) {
  const [diag, setDiag] = useState<StaffLinkDiagnostics | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let live = true;
    setLoading(true);
    void fetchStaffLinkDiagnostics()
      .then((d) => live && setDiag(d))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [nonce]);

  const info = EXPLANATION[diag?.reason ?? "unavailable"];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Stethoscope className="h-4 w-4 text-primary" aria-hidden /> Why your workspace is withheld
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {loading ? (
          <div className="space-y-2" aria-busy>
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="font-mono text-[10px] uppercase">
                {diag?.reason ?? "unavailable"}
              </Badge>
              <span className="font-medium">{info.title}</span>
            </div>
            <p className="text-muted-foreground">{info.cause}</p>
            <p>
              <span className="font-medium">Action needed: </span>
              <span className="text-muted-foreground">{info.action}</span>
            </p>
            <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
              <Row label="Sign-in email" value={diag?.email ?? "—"} />
              <Row label="Email verified" value={diag?.emailVerified ? "Yes" : "No"} />
              <Row
                label="Unlinked records matching your email"
                value={String(diag?.unlinkedEmailMatches ?? 0)}
              />
              <Row label="Linked staff record" value={diag?.linkedStaffId ? "Present" : "None"} />
              {diag?.matchStatus && <Row label="Matching record status" value={diag.matchStatus} />}
              {diag?.linkedStatus && <Row label="Your record status" value={diag.linkedStatus} />}
            </dl>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => setNonce((n) => n + 1)}>
                Re-run diagnostics
              </Button>
              {diagnosticRef && (
                <span className="text-xs text-muted-foreground">
                  Reference: <span className="font-mono">{diagnosticRef}</span>
                </span>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-dashed py-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

export default IdentityDiagnostics;
