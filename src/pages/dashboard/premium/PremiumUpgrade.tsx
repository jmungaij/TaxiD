/**
 * Elite Premium upgrade / ineligibility surface.
 *
 * RequireTier redirects here instead of showing a hard 403 so an ineligible
 * user always sees what was blocked, which tier is needed, and the exact next
 * step to obtain it.
 */
import { Link, useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Crown, Lock, ArrowRight, ShieldCheck } from "lucide-react";
import { useEntitlements } from "@/hooks/useEntitlements";
import { TIER_LABEL, gateReasonFor, type PlatformTier } from "@/lib/platform/entitlements";

const TIER_BENEFITS: Record<PlatformTier, string[]> = {
  standard: ["Booking centre", "Personal wallet", "Trip receipts"],
  premium: [
    "Corporate Charter Business workspace",
    "Enterprise procurement spine and approval chains",
    "Corporate wallets, billing and settlement views",
    "SmartFare and asset pricing consoles",
  ],
  elite: [
    "Elite Premium tier cockpit with executive KPIs",
    "Corporate Charter Business Operations Centre",
    "RFQ engine, quotation authority and settlement release",
    "Immutable audit log access and pricing governance",
  ],
};

export default function PremiumUpgrade() {
  const [params] = useSearchParams();
  const from = params.get("from") ?? "";
  const required = (params.get("tier") as PlatformTier) || "premium";
  const { tier, label } = useEntitlements();

  return (
    <div className="space-y-6">
      <header className="rounded-2xl border border-border bg-gradient-to-br from-primary/10 via-card to-primary-glow/10 p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">Tier entitlement</p>
        <h1 className="mt-2 flex items-center gap-2 text-2xl md:text-3xl font-bold tracking-tight">
          <Lock className="h-6 w-6 text-primary" aria-hidden />
          {TIER_LABEL[required]} access required
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          {from
            ? <>Your account is on <strong>{label}</strong>, and <code className="rounded bg-muted px-1">{from}</code>{" "}
              needs {TIER_LABEL[required]}.</>
            : <>Your account is on <strong>{label}</strong>. This area needs {TIER_LABEL[required]}.</>}
          {from && gateReasonFor(from) ? ` Blocked surface: ${gateReasonFor(from)}.` : ""}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">Current: {label}</Badge>
          <Badge variant="outline">Required: {TIER_LABEL[required]}</Badge>
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Crown className="h-4 w-4 text-primary" aria-hidden />
              What {TIER_LABEL[required]} unlocks
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {TIER_BENEFITS[required].map((b) => (
                <li key={b} className="flex items-start gap-2">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">How to get access</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              Tiers are derived from the roles granted to your account. Ask a platform administrator to grant a
              {required === "elite" ? " corporate administrator or finance administrator " : " commercial or approving officer "}
              role, then sign out and back in.
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button asChild variant="outline" size="sm">
                <Link to="/dashboard">Back to my dashboard</Link>
              </Button>
              <Button asChild size="sm">
                <Link to="/contact">
                  Request an upgrade<ArrowRight className="ml-2 h-4 w-4" aria-hidden />
                </Link>
              </Button>
            </div>
            {tier !== "standard" && (
              <p className="pt-2 text-xs">
                Already upgraded? Your session may hold stale roles — sign out and back in to refresh entitlements.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
