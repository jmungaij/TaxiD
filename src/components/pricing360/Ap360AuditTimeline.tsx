import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { History, RefreshCw, ShieldAlert, Ban, ExternalLink } from "lucide-react";
import { AppButton } from "@/components/nav/AppButton";
import {
  queryPricingAudit, rowDiff, rowOutcome, rowEvent, rowBlockedReason, rowRelatedTarget,
  type PricingAuditRow,
} from "@/lib/pricing360/audit";


const OUTCOME_TONE: Record<string, string> = {
  allowed: "bg-success/10 text-success",
  denied: "bg-destructive/10 text-destructive",
  error: "bg-warning/10 text-warning-foreground",
};

const ACTION_LABEL: Record<string, string> = {
  save: "Saved / drafted",
  approve: "Approved",
  reject: "Rejected",
  publish: "Published",
  simulate: "Quoted",
  export: "Exported",
  view: "Viewed",
};

function stamp(iso: string): string {
  return new Date(iso).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" });
}

function short(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export interface Ap360AuditTimelineProps {
  /** Governed version whose history is shown. Omit for the whole AP360 domain. */
  versionId?: string;
  /** Label of the pricing record, used in the empty-state copy. */
  subject?: string;
  /** Set false when the backend says this operator may not read governance. */
  permitted?: boolean;
}

/**
 * Asset Pricing 360 audit timeline.
 *
 * Every save, validation, submission, approval, rejection, schedule and
 * publication recorded against a pricing version, with the actor's identity,
 * the server timestamp and the field-level payload diff exactly as it was
 * written to `pricing_audit_events`. Nothing is reconstructed or inferred: when
 * a governed action produced no audit row, the timeline says so rather than
 * implying the change never happened.
 */
export function Ap360AuditTimeline({ versionId, subject, permitted = true }: Ap360AuditTimelineProps) {
  const [rows, setRows] = useState<PricingAuditRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!permitted) return;
    setLoading(true);
    setError(null);
    try {
      setRows(await queryPricingAudit({
        // Version lifecycle rows and withheld-quote / authorization-denial rows
        // (`ap360_quote`) belong on the same governance timeline.
        entity: versionId ? "ap360_version" : "ap360",
        entityId: versionId,
        limit: 100,
      }));

    } catch (e) {
      setRows(null);
      setError(e instanceof Error ? e.message : "The audit stream could not be read");
    } finally {
      setLoading(false);
    }
  }, [permitted, versionId]);

  useEffect(() => { void load(); }, [load]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4" aria-hidden /> Governance audit trail
            </CardTitle>
            <CardDescription>
              {versionId
                ? `Every recorded action on ${subject ?? "this pricing version"} — actor, timestamp and payload diff.`
                : "Every recorded action across Asset Pricing 360 — actor, timestamp and payload diff."}
            </CardDescription>
          </div>
          <AppButton
            action="submit"
            analytics="ap360_audit_refresh"
            variant="outline"
            size="sm"
            onClick={() => void load()}
            disabled={loading || !permitted}
          >
            <RefreshCw className="mr-2 h-3.5 w-3.5" aria-hidden /> Refresh audit trail
          </AppButton>
        </div>
      </CardHeader>
      <CardContent>
        {!permitted ? (
          <p className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-warning-foreground">
            <ShieldAlert className="h-4 w-4" aria-hidden />
            Insufficient permissions — pricing governance history is restricted to staff with pricing authority.
          </p>
        ) : loading && rows === null ? (
          <Skeleton className="h-40 w-full" />
        ) : error ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            Audit stream unavailable — {error}. No history is shown rather than an incomplete one.
          </p>
        ) : (rows ?? []).length === 0 ? (
          <p className="rounded-lg border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
            No governed action has been recorded {versionId ? "on this version" : "in Asset Pricing 360"} yet.
          </p>
        ) : (
          <ol className="space-y-3">
            {(rows ?? []).map((row) => {
              const outcome = rowOutcome(row);
              const diff = rowDiff(row);
              const event = rowEvent(row);
              const blocked = rowBlockedReason(row);
              const related = rowRelatedTarget(row);
              return (
                <li key={row.id} className="rounded-lg border border-border/70 bg-muted/10 p-3" data-testid="ap360-audit-row">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{ACTION_LABEL[row.action] ?? row.action}</Badge>
                      <Badge className={OUTCOME_TONE[outcome] ?? "bg-muted"}>{outcome}</Badge>
                      {event && <Badge variant="outline" className="font-mono text-[10px]">{event}</Badge>}
                      <span className="text-sm font-medium">{row.actor_email ?? "system"}</span>
                    </div>
                    <time className="text-xs text-muted-foreground" dateTime={row.created_at}>{stamp(row.created_at)}</time>
                  </div>
                  {row.reason && <p className="mt-1.5 text-sm text-muted-foreground">{row.reason}</p>}
                  {blocked && (
                    <p
                      data-testid="ap360-audit-blocked-reason"
                      className="mt-2 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive"
                    >
                      <Ban className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                      <span>
                        <span className="font-semibold">Price withheld — </span>
                        {blocked} No authoritative price was applied.
                      </span>
                    </p>
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">
                    {related.to ? (
                      <Link
                        to={related.to}
                        data-testid="ap360-audit-related-link"
                        className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
                      >
                        <ExternalLink className="h-3 w-3" aria-hidden /> {related.label}
                      </Link>
                    ) : (
                      <span data-testid="ap360-audit-related-link">
                        {related.label} — no originating booking or quote route was recorded.
                      </span>
                    )}
                  </p>

                  {diff.length > 0 && (
                    <>
                      <Separator className="my-2" />
                      <ul className="space-y-1 text-xs">
                        {diff.map((d) => (
                          <li key={d.field} className="flex flex-wrap items-baseline gap-2">
                            <span className="font-medium">{d.field}</span>
                            <span className="text-muted-foreground line-through">{short(d.from)}</span>
                            <span aria-hidden>→</span>
                            <span className="text-primary">{short(d.to)}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {row.entity_id && !versionId && (
                    <p className="mt-2 font-mono text-[11px] text-muted-foreground">version {row.entity_id}</p>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

export default Ap360AuditTimeline;
