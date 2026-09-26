/**
 * Pinned banner shown while a super admin is operating inside a specific
 * corporate account. Purely presentational: it reflects the session cached by
 * `manageAs.ts` and offers a one-click exit. Access control always remains
 * server-side.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Building2, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { endManageAs, readManageAsSession, type ManageAsSession } from "@/lib/corporate/manageAs";
import { workspace360Path } from "@/lib/workspace360/links";

function minutesLeft(session: ManageAsSession): number {
  return Math.max(0, Math.round((Date.parse(session.expires_at) - Date.now()) / 60000));
}

export function ManageAsBanner() {
  const [session, setSession] = useState<ManageAsSession | null>(() => readManageAsSession());
  const [ending, setEnding] = useState(false);

  const refresh = useCallback(() => setSession(readManageAsSession()), []);

  useEffect(() => {
    window.addEventListener("yalla:manage-as-changed", refresh);
    const timer = window.setInterval(refresh, 30_000);
    return () => {
      window.removeEventListener("yalla:manage-as-changed", refresh);
      window.clearInterval(timer);
    };
  }, [refresh]);

  if (!session) return null;

  return (
    <div
      data-testid="manage-as-banner"
      className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/40 bg-primary/5 px-4 py-3"
    >
      <ShieldCheck className="h-5 w-5 shrink-0 text-primary" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">
          Managing as {session.corporate_name}
        </p>
        <p className="text-xs text-muted-foreground">
          Time-boxed admin session · every action is audited · expires in {minutesLeft(session)} min
        </p>
      </div>
      <Button asChild size="sm" variant="outline">
        <Link to={workspace360Path("corporate", session.corporate_id)}>
          <Building2 className="mr-2 h-4 w-4" aria-hidden />
          Open Corporate 360
        </Link>
      </Button>
      <Button
        size="sm"
        variant="ghost"
        data-testid="manage-as-exit"
        disabled={ending}
        onClick={async () => {
          setEnding(true);
          try {
            await endManageAs(session.id);
          } finally {
            setEnding(false);
            refresh();
          }
        }}
      >
        <X className="mr-2 h-4 w-4" aria-hidden />
        {ending ? "Ending…" : "Exit session"}
      </Button>
    </div>
  );
}
