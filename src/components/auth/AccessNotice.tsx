/**
 * Consistent permission / entitlement notice.
 *
 * Used everywhere an action or panel is unavailable so tier gating and role
 * gating read identically: what is blocked, why, and the next step. Keeps
 * read-only surfaces informative instead of silently disabled.
 */
import { Link } from "react-router-dom";
import { Lock, ShieldAlert, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  kind?: "role" | "tier";
  title: string;
  description: string;
  /** Optional upgrade/appeal destination. */
  actionTo?: string;
  actionLabel?: string;
}

export function AccessNotice({ kind = "role", title, description, actionTo, actionLabel }: Props) {
  const Icon = kind === "tier" ? Lock : ShieldAlert;
  return (
    <div
      role="note"
      data-testid="access-notice"
      className="rounded-xl border border-border bg-muted/40 p-4 flex items-start gap-3"
    >
      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="space-y-2">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
        {actionTo && (
          <Button asChild size="sm" variant="outline">
            <Link to={actionTo}>
              {actionLabel ?? "See what's required"}
              <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}
