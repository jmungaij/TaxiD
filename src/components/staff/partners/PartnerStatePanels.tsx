/**
 * TaxiD PARTNERS 360 — profile state history and lifecycle audit trail.
 *
 * Two staff-only read surfaces over server-written records:
 *   • Profile history — every captured state of a partner intent profile, with
 *     the fields that changed, and a one-click revert to any earlier state
 *     (authorised and re-captured in the database, never client-side);
 *   • Lifecycle audit — each stage move for a visitor session, the stage it came
 *     from, the selections behind it and the staff task it raised. Append-only.
 */
import { useCallback, useEffect, useState } from "react";
import { History, RotateCcw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CHANGE_KIND_LABEL, HISTORY_FIELD_LABEL, listLifecycleAudit, listProfileHistory,
  revertProfileState, type PartnerLifecycleAuditRow, type PartnerProfileHistoryRow,
} from "@/lib/partners/history";
import { REVERT_DENIAL_REASON, usePartnerPermissions } from "@/lib/partners/permissions";
import { labelOf } from "@/lib/partners/journeyDrill";


const fmt = (iso: string) => new Date(iso).toLocaleString("en-KE");

export function ProfileHistoryPanel({
  profileId, onReverted,
}: { profileId: string; onReverted?: () => void }) {
  const [rows, setRows] = useState<PartnerProfileHistoryRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { canRevertProfile, loading: permsLoading } = usePartnerPermissions();

  const load = useCallback(async () => {
    try {
      setRows(await listProfileHistory(profileId));
    } catch {
      setRows([]);
    }
  }, [profileId]);

  useEffect(() => { void load(); }, [load]);

  const revert = async (row: PartnerProfileHistoryRow) => {
    setBusy(row.id);
    const res = await revertProfileState(row.id);
    setBusy(null);
    if (!res.ok) {
      toast.error("Could not revert this profile", {
        description: (res.reason && REVERT_DENIAL_REASON[res.reason]) ?? res.reason,
      });
      return;
    }
    toast.success("Profile reverted", { description: `Restored the state captured ${fmt(row.created_at)}.` });
    await load();
    onReverted?.();
  };


  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4" aria-hidden /> Intent state history
        </CardTitle>
        <CardDescription>
          Every captured state of this partner profile — what they bring, the category, the maturity level
          and the lifecycle stage — newest first. Reverting restores an earlier state and is itself recorded.
          {!permsLoading && !canRevertProfile && (
            <span className="mt-1 block">
              Your role can read this history but not revert it — reverting is restricted to super admin,
              admin, director and general manager roles.
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows === null ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No captured states for this profile yet.</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((r, i) => (
              <li key={r.id} className="rounded-xl border border-border bg-card p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={r.change_kind === "reverted" ? "secondary" : "outline"}>
                    {CHANGE_KIND_LABEL[r.change_kind]}
                  </Badge>
                  {i === 0 && <Badge>Current</Badge>}
                  <span className="text-xs text-muted-foreground">{fmt(r.created_at)}</span>
                  {i > 0 && !permsLoading && canRevertProfile && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="ml-auto"
                      disabled={busy === r.id}
                      onClick={() => void revert(r)}
                    >
                      <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                      {busy === r.id ? "Reverting…" : "Revert to this state"}
                    </Button>
                  )}
                </div>

                <dl className="mt-2 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  {([
                    ["bring", "What they bring", r.intent_bring],
                    ["category", "Partner category", r.network_category],
                    ["level", "Maturity level", r.maturity_level],
                    ["stage", "Lifecycle stage", r.lifecycle_stage],
                  ] as const).map(([key, label, value]) => (
                    <div key={label}>
                      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
                      <dd className="mt-0.5 font-medium">{labelOf(key, value ?? undefined)}</dd>
                    </div>
                  ))}
                </dl>
                {r.changed_fields.length > 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Changed: {r.changed_fields.map((f) => HISTORY_FIELD_LABEL[f] ?? f).join(", ")}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function LifecycleAuditPanel({ sessionId }: { sessionId: string }) {
  const [rows, setRows] = useState<PartnerLifecycleAuditRow[] | null>(null);

  useEffect(() => {
    let live = true;
    listLifecycleAudit(sessionId)
      .then((r) => { if (live) setRows(r); })
      .catch(() => { if (live) setRows([]); });
    return () => { live = false; };
  }, [sessionId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4" aria-hidden /> Lifecycle audit trail
        </CardTitle>
        <CardDescription>
          Append-only record of every lifecycle stage move for this session, written server-side — the stage
          it came from, the selections declared and the partner-desk task it raised.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows === null ? (
          <Skeleton className="h-24 w-full" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No lifecycle stage changes audited for this session.</p>
        ) : (
          <ol className="space-y-2">
            {rows.map((r) => (
              <li key={r.id} className="rounded-xl border border-border bg-card p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  {r.previous_stage && (
                    <>
                      <Badge variant="outline">{labelOf("stage", r.previous_stage)}</Badge>
                      <span aria-hidden className="text-muted-foreground">→</span>
                    </>
                  )}
                  <Badge>{labelOf("stage", r.lifecycle_stage)}</Badge>
                  <span className="text-xs text-muted-foreground">{fmt(r.created_at)}</span>
                  {r.work_item_id && <Badge variant="secondary">Task raised</Badge>}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {[
                    r.intent_bring ? `Brings ${labelOf("bring", r.intent_bring)}` : null,
                    r.network_category ? `Category ${labelOf("category", r.network_category)}` : null,
                    r.maturity_level ? `Level ${labelOf("level", r.maturity_level)}` : null,
                    r.ab_variant ? `Variant ${labelOf("variant", r.ab_variant)}` : null,
                    r.page_source,
                  ].filter(Boolean).join(" · ") || "No additional context declared"}
                </p>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
