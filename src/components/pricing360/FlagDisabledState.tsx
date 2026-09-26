/**
 * Truthful disabled state for a flag-gated Pricing 360 surface.
 *
 * A switched-off surface is never blank and never shows a zero: it names the
 * flag, what the operator is missing, who owns it, and where to re-enable it.
 */
import { Link } from "react-router-dom";
import { EyeOff, Settings2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { flagDefinition, type PricingFlagKey } from "@/lib/pricing360/featureFlags";

export function FlagDisabledState({
  flag,
  source = "store",
}: {
  flag: PricingFlagKey;
  /** Whether the off-state came from the store or from registry defaults. */
  source?: "store" | "defaults";
}) {
  const def = flagDefinition(flag);
  return (
    <Card className="border-dashed">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <EyeOff className="h-4 w-4" aria-hidden />
          {def.label} is switched off
        </CardTitle>
        <CardDescription>
          This surface is disabled by the <code>{def.key}</code> feature flag — no figures are
          being withheld or estimated. {def.surface}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-muted-foreground">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">Owner: {def.owner}</Badge>
          <Badge variant="outline">
            {source === "store" ? "Set by an administrator" : "Registry default (flag store unreachable)"}
          </Badge>
        </div>
        <Link
          to="/dashboard/admin/pricing-360?tab=access"
          className="inline-flex items-center gap-2 font-medium text-primary hover:underline"
        >
          <Settings2 className="h-4 w-4" aria-hidden />
          Manage Pricing 360 flags &amp; access
        </Link>
      </CardContent>
    </Card>
  );
}

export default FlagDisabledState;
