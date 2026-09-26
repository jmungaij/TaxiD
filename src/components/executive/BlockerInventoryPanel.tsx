/**
 * Lean P1 — Production Blocker Inventory Panel.
 *
 * Renders the deterministic ranked inventory produced by
 * `composeBlockerInventory`. No new state; pure presentation over
 * governance/validation/execution/acceptance/vault/closure reports.
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertOctagon, ArrowRight, ShieldAlert, ShieldCheck, Wrench, Zap } from "lucide-react";
import { Link } from "react-router-dom";
import type { BlockerInventory, Blocker } from "@/lib/workspace360/blockerInventory";

const SEVERITY_TONE: Record<Blocker["severity"], string> = {
  critical: "bg-status-danger/15 text-status-danger border-status-danger/40",
  major: "bg-status-warning/15 text-status-warning border-status-warning/40",
  minor: "bg-muted-foreground/15 text-muted-foreground border-border/40",
};

const EFFORT_TONE: Record<Blocker["effort"], string> = {
  low: "bg-status-success/15 text-status-success border-status-success/40",
  medium: "bg-status-warning/15 text-status-warning border-status-warning/40",
  high: "bg-status-danger/15 text-status-danger border-status-danger/40",
};

export function BlockerInventoryPanel({
  inventory,
  title = "Production Blocker Inventory (P1)",
  maxRows = 10,
}: {
  inventory: BlockerInventory;
  title?: string;
  maxRows?: number;
}) {
  const rows = inventory.blockers.slice(0, maxRows);
  const empty = inventory.total === 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          {empty ? (
            <ShieldCheck className="h-4 w-4 text-status-success" />
          ) : (
            <ShieldAlert className="h-4 w-4 text-status-danger" />
          )}
          {title}
          <Badge variant="outline">{inventory.total} blocker{inventory.total === 1 ? "" : "s"}</Badge>
          <Badge variant="outline" className="font-mono">
            Decision: {inventory.decision}
          </Badge>
          <Badge
            variant="outline"
            className={inventory.correlationRatchet.passed
              ? "bg-status-success/10 text-status-success border-status-success/40"
              : "bg-status-danger/10 text-status-danger border-status-danger/40"}
            title={inventory.correlationRatchet.failures.slice(0, 6).join(" | ")}
          >
            Correlation: {inventory.correlationRatchet.passed ? "COMPLETE" : `INCOMPLETE (${inventory.correlationRatchet.incompleteBlockers})`}
          </Badge>
          <span className="text-[11px] text-muted-foreground font-mono ml-auto flex items-center gap-3">
            <span className="inline-flex items-center gap-1">
              <Wrench className="h-3 w-3" /> auto-fixable {inventory.autoFixableCount}/{inventory.total}
            </span>
            <span className="inline-flex items-center gap-1">
              <Zap className="h-3 w-3" /> expected +{inventory.expectedTotalGain} pts
            </span>
            <span className="font-mono">fp {inventory.fingerprint}</span>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {empty ? (
          <div className="rounded-md border border-status-success/40 bg-status-success/5 px-3 py-4 text-sm text-status-success flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            No blocking gates outstanding — every certifier is passing. Ratchet echoes the upstream decision.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3">#</th>
                  <th className="py-2 pr-3">Blocker</th>
                  <th className="py-2 pr-3">Source</th>
                  <th className="py-2 pr-3">Missing evidence</th>
                  <th className="py-2 pr-3">Owner</th>
                  <th className="py-2 pr-3 text-right">Impact</th>
                  <th className="py-2 pr-3 text-right">Gain</th>
                  <th className="py-2 pr-3">Effort</th>
                  <th className="py-2 pr-3">Auto-fix</th>
                  <th className="py-2 pr-3 text-right">Score</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((b, idx) => (
                  <tr key={b.id} className="border-t border-border/60 align-top">
                    <td className="py-2 pr-3 text-muted-foreground font-mono text-xs">{idx + 1}</td>
                    <td className="py-2 pr-3">
                      <div className="font-medium flex items-center gap-2">
                        <AlertOctagon className="h-3.5 w-3.5 text-muted-foreground" />
                        {b.title}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">{b.rootCause}</div>
                      <div className="text-[11px] mt-1">
                        <Badge variant="outline" className={SEVERITY_TONE[b.severity]}>{b.severity}</Badge>{" "}
                        {b.correlation && (
                          <>
                            <Badge variant="outline" className="uppercase tracking-wide">
                              {b.correlation.domain}
                            </Badge>{" "}
                          </>
                        )}
                        <span className="text-muted-foreground">{b.requiredFix}</span>
                      </div>
                      {b.correlation && (
                        <div className="mt-1 text-[11px] text-muted-foreground space-y-0.5">
                          <div>
                            <span className="font-medium text-foreground/80">First failing:</span>{" "}
                            <span className="font-mono">{b.correlation.firstFailingDependency}</span>
                          </div>
                          {b.correlation.businessJourney && (
                            <div>
                              <span className="font-medium text-foreground/80">Journey:</span>{" "}
                              <span className="font-mono">{b.correlation.businessJourney}</span>
                            </div>
                          )}
                          <div className="flex flex-wrap gap-1">
                            {b.correlation.evidenceChain.slice(0, 5).map((l) => (
                              <span
                                key={`${l.kind}:${l.ref}`}
                                className="inline-flex items-center rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px]"
                                title={l.label}
                              >
                                {l.kind}:{l.ref}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-3 font-mono text-[11px] text-muted-foreground">{b.source}</td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground max-w-[240px]">
                      {b.missingEvidence}
                      {b.correlation && (
                        <div className="mt-1 text-[11px]">
                          <span className="font-medium text-foreground/80">Expected evidence:</span>{" "}
                          {b.correlation.recovery.expectedEvidence}
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-xs">
                      {b.owner}
                      {b.correlation && (
                        <div className="text-[11px] text-muted-foreground">
                          approval: <span className="font-mono">{b.correlation.recovery.approvalRole}</span>
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono">{b.releaseImpact}</td>
                    <td className="py-2 pr-3 text-right font-mono text-status-success">+{b.expectedReadinessGain}</td>
                    <td className="py-2 pr-3">
                      <Badge variant="outline" className={EFFORT_TONE[b.effort]}>{b.effort}</Badge>
                    </td>
                    <td className="py-2 pr-3">
                      {b.autoFixable ? (
                        b.autoFixHref ? (
                          <Button asChild size="sm" variant="outline" className="h-7 px-2 text-xs">
                            <Link to={b.autoFixHref} aria-label={`Verify ${b.title}`}>
                              Verify <ArrowRight className="h-3 w-3 ml-1" />
                            </Link>
                          </Button>
                        ) : (
                          <Badge variant="outline" className="bg-status-success/10 text-status-success border-status-success/40">
                            YES
                          </Badge>
                        )
                      ) : (
                        <Badge variant="outline">NO</Badge>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono font-semibold">{b.priorityScore}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {inventory.total > rows.length && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Showing top {rows.length} of {inventory.total}. Remaining blockers rank below the cut-line.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
